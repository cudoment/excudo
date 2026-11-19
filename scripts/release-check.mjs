#!/usr/bin/env node
// Usage: node scripts/release-check.mjs [--quick] (npm run release:check -- --quick)
// Exit 0 after the requested checks pass; --quick leaves full release verification incomplete.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { localDependencies } from "./dependencies.mjs"
import { groupSubjects, ownerActionsOf } from "./changelog.mjs"
import { READMES, expectedRange, staleRanges } from "./ranges.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const results = []
const children = new Set()
let interrupted, stopping
const check = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? "✓" : "✗"} ${id}: ${detail}`)
}
const kill = (child, signal) => {
  if (!child.pid) return
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) { if (error.code !== "ESRCH") throw error }
}
const stop = async (list) => {
  if (process.platform === "win32") {
    await Promise.all(list.filter((child) => child.pid).map((child) => new Promise((resolve) => {
      const task = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      task.once("error", resolve)
      task.once("close", resolve)
    })))
    return
  }
  for (const child of list) kill(child, "SIGTERM")
  // Kill the whole group even if npm has exited before its test runner does.
  await new Promise((resolve) => setTimeout(resolve, 500))
  for (const child of list) kill(child, "SIGKILL")
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  if (interrupted) return
  interrupted = signal
  console.log(`Interrupted by ${signal}; ${results.length} completed check(s) above, remaining checks incomplete.`)
  stopping = stop([...children])
})

async function run(command, args, { timeout = 60000 } = {}) {
  if (interrupted) throw new Error(interrupted)
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
    children.add(child)
    let stdout = "", stderr = "", error, timedOut = false, cleanup
    const limit = 64 * 1024 * 1024
    const capture = (text, chunk) => (text + chunk).slice(-limit)
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout = capture(stdout, chunk) })
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = capture(stderr, chunk) })
    child.on("error", (cause) => { error = cause })
    const timer = setTimeout(() => { timedOut = true; cleanup = stop([child]) }, timeout)
    child.on("close", async (status, signal) => {
      clearTimeout(timer)
      if (cleanup) await cleanup
      children.delete(child)
      resolve({ status, signal, stdout, stderr, error, timedOut })
    })
  })
  if (interrupted) throw new Error(interrupted)
  return result
}
const passed = (result) => result.status === 0 && !result.error && !result.timedOut
const failure = (result) => result.timedOut ? "command timed out"
  : result.error?.message || result.stderr.trim().slice(-300) || result.stdout.trim().slice(-300) || `command exited ${result.status ?? result.signal}`

async function main() {
  const { values } = parseArgs({ options: { quick: { type: "boolean" } } })
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const { version } = manifest
  const status = await run("git", ["status", "--porcelain"])
  const dirty = status.stdout.trim()
  check("committed", passed(status) && !dirty, !passed(status) ? failure(status)
    : dirty ? `uncommitted: ${dirty.split("\n").slice(0, 5).join(", ")}` : "the working tree is clean")
  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])
  check("branch", passed(branch) && (values.quick || branch.stdout.trim() === "main"), passed(branch) ? `on ${branch.stdout.trim()}${values.quick ? "; publication requires main" : ""}` : failure(branch))
  const tag = await run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/v${version}`])
  check("version", tag.status === 1 && !tag.error && !tag.timedOut, passed(tag) ? `v${version} is already tagged: raise the version`
    : tag.status === 1 ? `v${version} is new` : failure(tag))
  const local = localDependencies(manifest)
  check("dependencies", !local.length, local.length
    ? `not from the registry: ${local.map((item) => `${item.name} ${item.spec}`).join(", ")}; install the published versions first`
    : "every dependency comes from the registry")
  const setup = readFileSync(join(root, "skills", "excudo-setup", "SKILL.md"), "utf8")
  // The setup skill follows the version; the READMEs follow it too, or the last stable release while it is a prerelease.
  const rangeFiles = [["skills/excudo-setup/SKILL.md", setup, "setup"], ...READMES.map((file) => [file, readFileSync(join(root, file), "utf8"), "readme"])]
  const outdated = staleRanges(rangeFiles, version)
  const wanted = [...new Set(rangeFiles.filter(([name]) => outdated.includes(name)).map(([, , kind]) => expectedRange(kind, version)))].join(" / ")
  check("setup-range", !outdated.length, outdated.length ? `${outdated.join(", ")} must install ${wanted} (every range, at least one); raise the ranges with the version`
    : `the setup skill and all four READMEs install ${version.includes("-") ? `${version} (setup) and a stable release (READMEs)` : `excudo@^${version}`}`)
  const denied = await run(process.execPath, ["scripts/denylist.mjs", "--json"])
  let deny = {}
  try { deny = JSON.parse(denied.stdout) } catch {}
  check("denylist", passed(denied), deny.skipped ? "no private/denylist.txt to compare with"
    : deny.found?.length ? `a listed word in ${deny.found.slice(0, 5).map((item) => item.line ? `${item.file}:${item.line}` : item.file).join(", ")}`
    : deny.words !== undefined ? `no file holds any of ${deny.words} listed word(s)` : failure(denied))
  // The two full READMEs keep the same outline; the Japanese and Chinese ones are short guides.
  const headings = (file) => readFileSync(join(root, file), "utf8").split("\n").filter((line) => /^#{1,3} /.test(line)).length
  const en = headings("README.md"), ko = headings("README.ko.md")
  const unlinked = READMES.filter((file) => {
    const first = readFileSync(join(root, file), "utf8").split("\n").slice(0, 6).join("\n")
    return READMES.some((other) => other !== file && !first.includes(`(${other})`))
  })
  check("readmes", en === ko && !unlinked.length, en !== ko ? `README.md ${en} headings, README.ko.md ${ko} headings`
    : unlinked.length ? `${unlinked.join(", ")} must link the other READMEs in a language line near the top`
    : `README.md and README.ko.md have ${en} headings; all four link each other`)

  // Package contents are cheap to inspect, without waiting for the skill checks to run.
  const names = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "skills", entry.name, "SKILL.md"))).map((entry) => entry.name)
  const packed = await run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"])
  let files = []
  try {
    const listed = JSON.parse(packed.stdout)
    files = (Array.isArray(listed) ? listed[0] : Object.values(listed)[0]).files.map((file) => file.path)
  } catch {}
  const stray = files.filter((file) => /^(?:test|scripts|private|public|\.github)\/|^(?:AGENTS|CLAUDE)(?:\.\w+)?\.md$|\.excudo\//.test(file))
  const needed = ["bin/excudo.mjs", "src/skillkit.mjs", ...names.map((name) => `skills/${name}/scripts/check.mjs`)].filter((file) => !files.includes(file))
  check("package", passed(packed) && files.length > 0 && !stray.length && !needed.length,
    !passed(packed) ? failure(packed) : stray.length ? `must not ship: ${stray.join(", ")}`
    : needed.length ? `missing: ${needed.join(", ")}` : `${files.length} files`)

  if (values.quick) {
    for (const id of ["tests", "example", "skills"]) console.log(`- ${id}: skipped (--quick).`)
  } else {
    const notes = existsSync(join(root, "CHANGELOG.md")) ? readFileSync(join(root, "CHANGELOG.md"), "utf8") : ""
    const lines = notes.split("\n").map((line) => line.trim())
    const begin = lines.indexOf(`## ${version}`)
    const end = lines.findIndex((line, index) => index > begin && line.startsWith("## "))
    const section = begin < 0 ? [] : lines.slice(begin + 1, end < 0 ? undefined : end)
    // The newest commit that changed more than the release notes must already be listed in them.
    const newest = await run("git", ["log", "-1", "--format=%s", "--", ".", ":!CHANGELOG.md", ":!package.json", ":!package-lock.json"])
    const subject = passed(newest) ? newest.stdout.trim() : ""
    const entry = subject ? groupSubjects([subject])[0]?.summaries[0] : undefined
    const stale = entry !== undefined && !section.includes(`- ${entry}`)
    const published = manifest.excudoReleaseNotes
    // Owner actions of every version travel in the metadata, beyond the recent sections the markdown keeps.
    const actionsStale = JSON.stringify(published?.ownerActions ?? []) !== JSON.stringify(ownerActionsOf(notes))
    const packaged = !published || published.version !== version || (entry !== undefined && !String(published.markdown).includes(`- ${entry}`)) || actionsStale
    check("changelog", begin >= 0 && !stale && !packaged,
      begin < 0 ? `CHANGELOG.md has no section for ${version}`
        : stale ? `CHANGELOG.md ${version} lacks the newest commit "${subject}"; run scripts/changelog.mjs --since <previous-release-ref> --write ${version}`
        : packaged ? `package.json excudoReleaseNotes is not current for ${version}; run scripts/changelog.mjs --write ${version}`
        : `CHANGELOG.md has a section for ${version} that lists the newest commit`)
    console.log("Running tests...")
    const tests = await run("npm", ["test"], { timeout: 600000 })
    const summary = (tests.stdout.match(/(?:ℹ |# )(?:tests|pass|fail) \d+/g) ?? []).join(", ")
    check("tests", passed(tests), summary || failure(tests))

    console.log("Rebuilding example...")
    const built = await run(process.execPath, ["bin/excudo.mjs", "build", "--root", "example"])
    const example = await run("git", ["status", "--porcelain", "--", "example"])
    const changed = example.stdout.trim()
    check("example", passed(built) && passed(example) && !changed, !passed(built) ? failure(built)
      : !passed(example) ? failure(example) : changed ? `npm run example changed: ${changed}` : "the example is up to date")

    console.log("Checking skills...")
    const lint = await run(process.execPath, ["bin/excudo.mjs", "skills", "lint", "--json"], { timeout: 600000 })
    let skills = []
    try { skills = JSON.parse(lint.stdout) } catch {}
    const short = Array.isArray(skills) ? skills.filter((skill) => !skill.ok || skill.score < 100) : []
    check("skills", passed(lint) && Array.isArray(skills) && skills.length > 0 && !short.length,
      !passed(lint) ? failure(lint) : short.length ? short.map((skill) => `${skill.name} ${skill.score}/100`).join(", ") : `${skills.length ?? 0} skills at 100/100`)
  }
  console.log("- install: not run here (it needs the network); run npm run test:install before publishing.")
  const failed = results.filter((item) => !item.ok).length
  if (failed) console.log(`${failed} to fix before publishing ${version}.`)
  if (values.quick) console.log(`Quick checks finished; a full release check is required before publishing ${version}.`)
  else if (!failed) console.log(`Ready to publish ${version}.`)
  process.exitCode = failed ? 1 : 0
}
try { await main() } catch (error) {
  if (interrupted) {
    await stopping
    process.exitCode = interrupted === "SIGINT" ? 130 : 143
  } else {
    console.error(`Release check stopped: ${error.message}`)
    process.exitCode = 1
  }
}
