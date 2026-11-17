import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadWorkspace } from "../src/index.mjs"

const made = []
process.on("exit", () => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// No test reaches the owner's own GitHub or Vercel CLI, schedules or clock: both CLIs are absent unless
// a test sets a stand-in, LaunchAgents go to a folder of the test's own, and waiting polls at once.
// These are set whatever the shell running the tests holds, so a value exported there is never used.
const sandbox = mkdtempSync(join(tmpdir(), "excudo-sandbox-"))
made.push(sandbox)
process.env.EXCUDO_GH = join(sandbox, "no-gh")
process.env.EXCUDO_VERCEL = join(sandbox, "no-vercel")
process.env.EXCUDO_LAUNCH_AGENTS = join(sandbox, "LaunchAgents")
process.env.EXCUDO_LAUNCHCTL = "/usr/bin/true"
process.env.EXCUDO_POLL_MS = "5"

/** Test subprocesses must never install global skills into the runner's real profile. */
export const homeEnv = (home, env = process.env) => ({ ...env, HOME: home, USERPROFILE: home })

/** A temporary folder that is removed when the test file finishes. */
export function tempDir(prefix = "excudo-") {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/** A throwaway workspace: excudo.config.mjs plus the given files inside the graph folder. */
export async function workspace(files, config = {}) {
  const root = tempDir()
  writeFileSync(join(root, "excudo.config.mjs"), `export default ${JSON.stringify({ graph: "notes", ...config })}\n`)
  for (const [rel, text] of Object.entries(files)) put(root, rel, text)
  return loadWorkspace({ root })
}

export function put(root, rel, text) {
  const path = join(root, "notes", rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export const read = (ws, rel) => readFileSync(join(ws.graphDir, rel), "utf8")

/** (depth, page) for every tree line of an outline. */
export function outline(text) {
  return text
    .split("\n")
    .filter((ln) => /^\t*- \[\[/.test(ln))
    .map((ln) => [ln.length - ln.trimStart().length, ln.match(/\[\[([^\]]+)/)[1]])
}

export const codes = (issues) => issues.map((issue) => issue.code).sort()

/*
 * A stand-in for the GitHub CLI: an account, repositories with issues, and a log of every call, kept in
 * a state file beside it. `auth login` prints a device code and waits for Enter, as the real one does.
 */
const FAKE_GH = `#!/usr/bin/env node
const fs = require("fs"), path = require("path")
const dir = __dirname, file = path.join(dir, "state.json")
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { repos: {} }
const save = () => fs.writeFileSync(file, JSON.stringify(state))
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify(args) + "\\n")
const opt = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const [a, b, c] = args
if (state.errors?.[b]) { console.error(state.errors[b]); process.exit(1) }
if (state.hang === b) { setInterval(() => {}, 1000); return }
if (a === "api" && b === "user") { if (!state.user) { console.error("not logged in"); process.exit(1) } console.log(state.user); process.exit(0) }
if (a === "auth" && b === "login") {
  console.error("! First copy your one-time code: ABCD-1234\\nPress Enter to open https://github.com/login/device in your browser...")
  process.stdin.once("data", () => { state.user = state.loginAs ?? "owner"; save(); process.exit(0) })
  return
}
if (a === "repo" && b === "view") { const repo = state.repos[c]; if (!repo) { console.error("not found"); process.exit(1) } console.log(JSON.stringify({ visibility: repo.visibility, hasIssuesEnabled: repo.issuesOn })); process.exit(0) }
if (a === "repo" && b === "create") { state.repos[c] = { visibility: args.includes("--private") ? "PRIVATE" : "PUBLIC", issuesOn: true, issues: [] }; save(); process.exit(0) }
if (a === "repo" && b === "edit") { state.repos[c].issuesOn = true; save(); process.exit(0) }
if (a === "issue" && b === "list") {
  if (state.down) { console.error("HTTP 401"); process.exit(1) }
  const repo = state.repos[opt("--repo")] ?? { issues: [] }
  console.log(JSON.stringify(repo.issues.filter((issue) => !issue.closed)))
  process.exit(0)
}
if (a === "issue" && b === "close") { const issue = state.repos[opt("--repo")].issues.find((item) => String(item.number) === c); issue.closed = opt("--reason"); save(); process.exit(0) }
console.error("unknown " + args.join(" ")); process.exit(9)
`

/** A stand-in gh in a folder of its own: `state()` reads or changes its account, repositories and issues. */
export function fakeGh(initial = { repos: {} }) {
  const dir = tempDir("excudo-gh-")
  writeFileSync(join(dir, "gh"), FAKE_GH, { mode: 0o755 })
  writeFileSync(join(dir, "state.json"), JSON.stringify(initial))
  const file = join(dir, "state.json")
  return {
    path: join(dir, "gh"), dir,
    state: (change) => {
      const current = JSON.parse(readFileSync(file, "utf8"))
      if (change) writeFileSync(file, JSON.stringify(typeof change === "function" ? change(current) ?? current : { ...current, ...change }))
      return JSON.parse(readFileSync(file, "utf8"))
    },
    calls: () => { try { return readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) } catch { return [] } },
  }
}

/** Runs `body` with the given environment variables set, and puts them back after. */
export async function withEnv(change, body) {
  const before = Object.fromEntries(Object.keys(change).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(change)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  try { return await body() } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
}
