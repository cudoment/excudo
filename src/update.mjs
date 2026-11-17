// Registry reads use npm alone. Installing and refreshing skills always requires --apply.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { format } from "./labels.mjs"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
export const engineVersion = manifest.version
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/

/** Compare semantic versions, including numeric and named prerelease identifiers. */
export function compareVersions(left, right) {
  const a = left.match(VERSION), b = right.match(VERSION)
  if (!a || !b) throw new Error("Invalid semantic version")
  for (let i = 1; i <= 3; i++) if (BigInt(a[i]) !== BigInt(b[i])) return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1
  if (a[4] === b[4]) return 0
  if (!a[4] || !b[4]) return a[4] ? -1 : 1
  const parts = [a[4].split("."), b[4].split(".")]
  for (let i = 0; i < Math.max(...parts.map((value) => value.length)); i++) {
    const [x, y] = parts.map((value) => value[i])
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const numeric = [x, y].map((value) => /^\d+$/.test(value))
    if (numeric.every(Boolean)) return BigInt(x) > BigInt(y) ? 1 : -1
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

/** npm_execpath also lets tests substitute an offline npm CLI on every platform. */
export function runNpm(args, { cwd, apply = false, binary = "npm" } = {}) {
  const candidate = process.env.npm_execpath
  const entry = candidate && /^npm-cli\.[cm]?js$/i.test(basename(candidate)) ? candidate : null
  const cli = binary === "npx" && entry ? join(dirname(entry), "npx-cli.js") : entry
  const options = { cwd, encoding: "utf8", timeout: apply ? 300000 : 10000, maxBuffer: 4 * 1024 * 1024 }
  if (cli && /\.[cm]?js$/i.test(cli) && existsSync(cli)) return spawnSync(process.execPath, [cli, ...args], options)
  // Windows launches npm.cmd through cmd; every argument below is fixed or validated as semver.
  return spawnSync(process.platform === "win32" ? `${binary}.cmd` : binary, args, { ...options, shell: process.platform === "win32" })
}

/** Only release sections newer than installed and no newer than the selected channel. */
export function changelogBetween(text, installed, latest) {
  const sections = [...String(text ?? "").replaceAll("\r\n", "\n").matchAll(/^## (?:\[)?(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)(?:\])?[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    .filter(([, version]) => compareVersions(version, installed) > 0 && compareVersions(version, latest) <= 0)
  return [...new Map(sections.reverse().map((section) => [section[1], section])).values()]
    .sort((a, b) => compareVersions(b[1], a[1]))
    .map(([section]) => section.trim()).join("\n\n")
}

/** Classify npm failures without suggesting login for network errors or offline retries for missing tags. */
export function npmFailure(response, tag) {
  let code = response?.error?.code ?? ""
  try { code ||= JSON.parse(response.stdout).error?.code ?? "" } catch {}
  code ||= String(response?.stderr ?? "").match(/\bcode\s+(E[A-Z\d_]+|ERR_[A-Z_]+)/i)?.[1]?.toUpperCase() ?? ""
  code ||= String(response?.stderr ?? "").match(/\b(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b/)?.[0] ?? ""
  const network = /^(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|FETCH_ERROR)$/.test(code)
    || /network|offline|timed? ?out|socket hang up|connection reset/i.test(`${response?.stderr ?? ""} ${response?.error?.message ?? ""}`)
  return { tag, code: code || "UNKNOWN", kind: /^(?:E401|E403|ENEEDAUTH|EAUTH)$/.test(code) ? "auth"
    : /^(?:E404|ETARGET)$/.test(code) ? "missing" : network ? "network" : "registry" }
}

const SKILLS_COMMAND = "npx --no-install excudo skills --force"

export async function updatePackage(ws, { channel, apply = false, npm = runNpm,
  installed = engineVersion, changelog } = {}) {
  const m = ws.labels.update
  // Without --channel, a prerelease install follows next; every other install follows latest.
  channel ??= installed.includes("-") ? "next" : "latest"
  if (!["latest", "next"].includes(channel)) throw new Error(m["update-channel"])
  const result = { installed, channel, latest: null, newer: false, state: "unavailable", changelog: "", commands: [], applied: false, note: "", code: 0, warnings: [] }
  const versions = []
  for (const tag of channel === "next" ? ["next", "latest"] : ["latest"]) {
    let viewed
    try {
      viewed = npm(["view", `excudo@${tag}`, "version", "--json"], { cwd: ws.root })
      if (viewed.status !== 0 || viewed.error) throw new Error("registry")
      const version = JSON.parse(viewed.stdout)
      if (typeof version !== "string" || !VERSION.test(version)) throw new Error("version")
      versions.push({ tag, version })
    } catch (error) {
      const failure = npmFailure(viewed ?? { error }, tag)
      result.warnings.push({ ...failure, note: format(m[`update-${failure.kind}`], failure) })
    }
  }
  if (!versions.length) { result.note = result.warnings[0].note; return result }
  versions.sort((a, b) => compareVersions(b.version, a.version))
  result.latest = versions[0].version
  result.selectedChannel = versions[0].tag
  result.newer = compareVersions(result.latest, installed) > 0
  result.state = result.newer ? "available" : "current"
  result.note = format(m[result.newer ? "update-available" : "update-current"], result)
  // A workspace already on the newest engine may still have skills the last attempt did not refresh.
  if (!result.newer && !apply) return result
  if (result.newer) {
    result.releaseUrl = `https://github.com/cudoment/excudo/releases/tag/v${result.latest}`
    result.changelogUrl = `https://github.com/cudoment/excudo/blob/v${result.latest}/CHANGELOG.md`
    result.commands = [`npm install excudo@^${result.latest}`, SKILLS_COMMAND]
    if (changelog === undefined) {
      try { changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8") } catch { changelog = "" }
    }
    result.changelog = changelogBetween(changelog, installed, result.latest)
    try {
      const metadata = npm(["view", `excudo@${result.latest}`, "--json"], { cwd: ws.root })
      if (metadata.status === 0 && !metadata.error) {
        const data = JSON.parse(metadata.stdout)
        const published = data.excudoReleaseNotes?.version === result.latest ? data.excudoReleaseNotes.markdown : null
        const notes = changelogBetween(published ?? data.changelog ?? data.CHANGELOG ?? data.readme ?? "", installed, result.latest)
        if (notes) result.changelog = changelogBetween(`${notes}\n\n${result.changelog}`, installed, result.latest)
      }
    } catch { /* Notes remain reachable through the versioned GitHub URLs. */ }
    if (!result.changelog) result.changelogNote = m["update-no-notes"]
    // Name releases between the installed one and the target that no notes above describe.
    try {
      const listed = npm(["view", "excudo", "versions", "--json"], { cwd: ws.root })
      if (listed.status === 0 && !listed.error) {
        const wanted = JSON.parse(listed.stdout)
        const shown = new Set([...result.changelog.matchAll(/^## (?:\[)?(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)/gm)].map((match) => match[1]))
        const prerelease = (version) => version.includes("-")
        result.missingVersions = (Array.isArray(wanted) ? wanted : [wanted]).filter((version) => typeof version === "string" && VERSION.test(version)
          && compareVersions(version, installed) > 0 && compareVersions(version, result.latest) <= 0
          && (!prerelease(version) || prerelease(result.latest) || prerelease(installed)) && !shown.has(version))
          .sort(compareVersions)
        if (result.missingVersions.length) result.missingNote = format(m["update-missing-notes"], { versions: result.missingVersions.join(", "), url: result.changelogUrl })
      }
    } catch { /* The list is a courtesy; the links above still lead to every release. */ }
  } else result.commands = [SKILLS_COMMAND]
  if (!apply) return result
  if (!ws.hasConfig) throw new Error(m["update-workspace"])
  const steps = [["npm", ["install", `excudo@^${result.latest}`]], ["npx", ["--no-install", "excudo", "skills", "--force"]]]
    .slice(result.newer ? 0 : 1)
  const shown = (step) => `${step[0]} ${step[1].join(" ")}`
  for (const [index, [binary, args]] of steps.entries()) {
    let ran
    try { ran = npm(args, { cwd: ws.root, apply: true, binary }) } catch (error) { ran = { status: 1, error } }
    if (ran.status !== 0 || ran.error) {
      result.state = "failed"; result.code = 1
      result.failedCommand = shown(steps[index])
      result.remainingCommands = steps.slice(index + 1).map(shown)
      result.note = format(m["update-apply-failed"], { command: result.failedCommand })
      result.stderr = String(ran.stderr || ran.error?.message || ran.stdout || `Command exited ${ran.status}`).split("\n").slice(-8).join("\n").slice(-2000)
      return result
    }
    if (binary === "npx") result.skillRefreshOutput = String(ran.stdout ?? "").trim()
  }
  result.applied = true
  result.note = format(m[result.newer ? "update-applied" : "update-refreshed"], result)
  result.followUp = ["npx --no-install excudo start --report", "node .agents/skills/excudo-setup/scripts/check.mjs"]
  return result
}
