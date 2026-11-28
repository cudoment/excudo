import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "../src/index.mjs"
import { conversationsOf } from "../src/requests.mjs"
import { insertRequests, withRecords } from "../src/records.mjs"
import { tempDir, workspace } from "./helpers.mjs"

export const engine = fileURLToPath(new URL("..", import.meta.url))
const blocked = tempDir("excudo-cli-offline-")
for (const command of ["npm", "npx", "gh", "vercel", "curl", "wget", "pbcopy"]) {
  writeFileSync(join(blocked, command), "#!/bin/sh\necho 'Unexpected external command' >&2\nexit 97\n", { mode: 0o755 })
}
export const offlineEnv = { ...process.env, PATH: `${blocked}${delimiter}${process.env.PATH}`, npm_config_offline: "true" }

export function runCli(ws, args) {
  return spawnSync(process.execPath, [join(engine, "bin/excudo.mjs"), ...args, "--root", ws.root], {
    // All smoke commands share this child budget, including preparation and missing-argument runs.
    cwd: ws.root, encoding: "utf8", timeout: 120000, env: offlineEnv,
  })
}
export function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: offlineEnv })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
export async function cliWorkspace() {
  // Disable every log source: these smoke tests read only synthetic cached requests.
  const conversations = Object.fromEntries(Object.keys(conversationsOf({ root: engine, conversations: true }))
    .map((key) => [key, key === "exclude" ? [] : false]))
  const ws = await workspace({
    "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n",
    "Projects.md": "# Projects\nWork to finish.\n",
    "Projects/Task.md": "# Task\nA small task.\n\n- TODO Check the links #agent\n",
    "Scratch.md": "# Scratch\nA temporary note.\n",
    "Plans.md": "# Plans\nThe current list.\n\n## List\n- ### Books\n\t- read a book\n",
  }, { locale: "en", conversations,
    mirrors: [{ name: "plans", places: [{ page: "Plans", section: "List" }, { note: "note" }] }] })
  build(ws)
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws.root, ["init", "-q"])
  git(ws.root, ["config", "user.name", "Test User"])
  git(ws.root, ["config", "user.email", "test@example.invalid"])
  git(ws.root, ["add", "."])
  git(ws.root, ["commit", "-qm", "Initial notes"])
  return ws
}
export function seedRequests(ws) {
  const ts = new Date(Date.now() - 60000).toISOString()
  withRecords(ws, (db) => insertRequests(db, [1, 2, 3].map((n) => ({
    tool: "test", session: `session-${n}`, ts, cwd: "/work/project",
    text: "Write a brief changelog from the merged changes for this release",
  }))), { write: true })
}
export function write(root, relative, text) {
  const file = join(root, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

/** A release-check copy whose git, npm, denylist, build and lint stay inside a temp folder. */
export function releaseFixture(options = {}) {
  const root = tempDir("excudo-release-cli-")
  const commands = join(root, "commands")
  mkdirSync(commands)
  write(root, "commands/package.json", '{"type":"commonjs"}\n')
  for (const name of ["release-check.mjs", "dependencies.mjs", "changelog.mjs", "ranges.mjs", "docs.mjs"]) {
    mkdirSync(join(root, "scripts"), { recursive: true })
    cpSync(join(engine, "scripts", name), join(root, "scripts", name))
  }
  write(root, "package.json", JSON.stringify({ name: "fixture", version: options.version ?? "1.2.3", type: "module", excudoReleaseNotes: { version: options.version ?? "1.2.3", markdown: "## 1.2.3\n\nRelease changes.\n" } }))
  const languages = "English | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)"
  const readme = (range) => `${languages}\n\nnpx -y excudo@^${range} init my-memo\n`
  write(root, "README.md", readme(options.readmeRange ?? (options.staleReadme ? "1.2.0" : "1.2.3")))
  write(root, "CHANGELOG.md", options.missingChangelog ? "# Changelog\n" : "# Changelog\n\n## 1.2.3\n\nRelease changes.\n")
  write(root, "README.ko.md", `[English](README.md) | 한국어 | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)\n\nnpx -y excudo@^${options.koRange ?? options.readmeRange ?? "1.2.3"} init my-memo\n`)
  write(root, "README.ja.md", `[English](README.md) | [한국어](README.ko.md) | 日本語 | [简体中文](README.zh-CN.md)\n\nnpx -y excudo@^${options.jaRange ?? options.readmeRange ?? "1.2.3"} init my-memo\n`)
  write(root, "README.zh-CN.md", `[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 简体中文\n\nnpx -y excudo@^${options.zhRange ?? options.readmeRange ?? "1.2.3"} init my-memo\n`)
  write(root, "skills/excudo-setup/SKILL.md", `excudo@^${options.setupRange ?? options.version ?? "1.2.3"}\n`)
  write(root, "scripts/denylist.mjs", 'console.log(JSON.stringify({ skipped: true }))\n')
  write(root, "bin/excudo.mjs", `import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n")
if (args[0] === "skills") { console.log(JSON.stringify([{ name: "excudo-setup", ok: true, score: 100 }])); process.exitCode = ${options.lintCode ?? 0} }
else { console.log("Built example"); process.exitCode = ${options.buildCode ?? 0} }
`)
  write(root, "commands/git", `#!${process.execPath}
const args = process.argv.slice(2)
if (args.includes("--abbrev-ref")) console.log(${JSON.stringify(options.branch ?? "main")})
else if (args.includes("--verify")) process.exitCode = 1
else if (args.includes("log")) console.log(${JSON.stringify(options.newestSubject ?? "")})
else if (!args.includes("status")) process.exitCode = 9
`)
  chmodSync(join(commands, "git"), 0o755)
  const npm = `#!${process.execPath}
const { appendFileSync, writeFileSync } = require("node:fs")
const { spawn } = require("node:child_process")
const args = process.argv.slice(2)
appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n")
if (args[0] === "pack") {
  console.log(JSON.stringify([{ files: ["bin/excudo.mjs", "src/skillkit.mjs", "skills/excudo-setup/scripts/check.mjs"].map(path => ({ path })) }]))
  process.exitCode = ${options.packCode ?? 0}
} else if (args[0] === "test") {
  ${options.slow ? `const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync('grandchild.pid', String(process.pid)); setInterval(() => {}, 1000)"], { stdio: "ignore" })
  writeFileSync("child.pid", String(process.pid))
  setInterval(() => {}, 1000)` : `console.log("# tests 2\\n# pass 2\\n# fail 0"); process.exitCode = ${options.testCode ?? 0}`}
} else process.exitCode = 9
`
  write(root, "commands/npm", npm)
  chmodSync(join(commands, "npm"), 0o755)
  return { root, commands, env: { ...offlineEnv, PATH: `${commands}${delimiter}${offlineEnv.PATH}` },
    script: join(root, "scripts/release-check.mjs"),
    calls: () => readFileSync(join(root, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) }
}
