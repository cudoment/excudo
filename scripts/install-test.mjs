#!/usr/bin/env node
// Usage: node scripts/install-test.mjs (npm run test:install)
// Packs this repository and installs the tarball the way a new owner does, for each locale, in a temporary
// folder: init, npm install, git init, the start report, check and --version. It needs the network for the
// dependencies, so it is not part of npm test; run it before publishing. Everything it writes (the cache and
// a home folder too) stays inside the temporary folder, which is removed on success and kept on failure.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
const temp = realpathSync(mkdtempSync(join(tmpdir(), "excudo-install-")))
const home = join(temp, "home")
mkdirSync(home)
const env = { ...process.env, HOME: home, USERPROFILE: home, npm_config_cache: join(temp, "npm-cache"), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" }
for (const name of Object.keys(env)) if (/^npm_config_(?:prefix|global|userconfig|globalconfig)$/i.test(name) || /^NODE_OPTIONS$/.test(name)) delete env[name]
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const npx = process.platform === "win32" ? "npx.cmd" : "npx"

const rows = []
const step = (label, command, args, cwd, { json = false, timeout = 600000 } = {}) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 })
  const tail = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.trim().split("\n").slice(-8).join("\n")
  let data
  if (json && result.status === 0) { try { data = JSON.parse(result.stdout) } catch { return { ok: false, detail: "output is not JSON", tail } } }
  return { ok: result.status === 0 && !result.error, detail: result.status === 0 ? "" : `exit ${result.status ?? result.signal}`, tail, data, stdout: result.stdout ?? "" }
}
const record = (scope, label, outcome, extra) => {
  const ok = outcome.ok && (extra === undefined || extra === true)
  rows.push({ scope, label, ok, detail: ok ? "" : typeof extra === "string" ? extra : outcome.detail || "failed", tail: ok ? "" : outcome.tail })
  return ok
}

const dist = join(temp, "dist")
mkdirSync(dist)
const packed = step("pack", npm, ["pack", "--pack-destination", dist], root)
let tarball
if (record("all", "npm pack", packed)) tarball = join(dist, readdirSync(dist).find((file) => file.endsWith(".tgz")) ?? "")

for (const locale of tarball ? ["en", "ko"] : []) {
  const base = join(temp, locale)
  mkdirSync(base)
  const work = join(base, "my-work")
  const scope = locale
  const run = (label, command, args, cwd, options, verify) => {
    const outcome = step(label, command, args, cwd, options)
    return record(scope, label, outcome, verify ? verify(outcome) : undefined)
  }
  run("init", npx, ["-y", "--package", tarball, "excudo", "init", "my-work", "--locale", locale], base)
    && run("npm install tarball", npm, ["install", "--save-dev", tarball], work)
    && run("git init", "git", ["init", "-q"], work)
    && run("git identity", "git", ["config", "user.email", "install-test@example.invalid"], work)
    && run("git identity name", "git", ["config", "user.name", "Install Test"], work)
    && run("start report", npx, ["--no-install", "excudo", "start", "--report", "--json"], work, { json: true }, ({ data }) => {
      const steps = data?.steps ?? []
      const missing = ["workspace", "install", "git", "skills"].filter((id) => steps.find((item) => item.id === id)?.state !== "done")
      return missing.length ? `not done: ${missing.join(", ")}` : true
    })
    && run("check", npx, ["--no-install", "excudo", "check"], work)
    && run("--version", npx, ["--no-install", "excudo", "--version"], work, {}, ({ stdout }) => stdout.trim() === version ? true : `printed ${JSON.stringify(stdout.trim())}, expected ${version}`)
}

const failed = rows.filter((row) => !row.ok)
for (const row of rows) console.log(`${row.ok ? "✓" : "✗"} ${row.scope.padEnd(3)} ${row.label}${row.detail ? `: ${row.detail}` : ""}`)
for (const row of failed) if (row.tail) console.log(`\n${row.scope} ${row.label} output (last lines):\n${row.tail}`)
if (failed.length) {
  console.log(`\n${failed.length} failed; kept ${temp} for inspection.`)
  process.exit(1)
}
rmSync(temp, { recursive: true, force: true })
console.log(`\nInstall test passed for excudo ${version} (en, ko).`)
