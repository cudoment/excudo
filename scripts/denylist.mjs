#!/usr/bin/env node
// Usage: node scripts/denylist.mjs [--list <file>] [--root <repository>] [--json]
// Keeps words that must never be published out of the repository: a maintainer's own names, hosts,
// issue keys. It reads one word per line from the list (private/denylist.txt unless given; git
// ignores private/, so the list itself is never committed; `#` starts a comment) and looks for each,
// ignoring case, in the paths and contents of the files git tracks or would add (not ignored),
// committed or not. Without the list there is nothing to compare and it passes. Exit 0 when no file
// holds a listed word, 1 when one does, 2 when it cannot run.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

let values
try {
  ({ values } = parseArgs({ options: { list: { type: "string" }, root: { type: "string" }, json: { type: "boolean" } } }))
} catch (error) {
  console.error(`${error.message}\nUsage: node scripts/denylist.mjs [--list <file>] [--root <repository>] [--json]`)
  process.exit(2)
}
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."))
const list = resolve(root, values.list ?? "private/denylist.txt")
const report = (result) => {
  if (values.json) console.log(JSON.stringify(result, null, 2))
  else if (result.skipped) console.log(`- denylist: no ${result.list}; nothing to compare.`)
  else if (!result.found.length) console.log(`✓ denylist: no file holds any of ${result.words} listed word(s).`)
  else for (const item of result.found) console.log(`✗ denylist: ${item.file}${item.line ? `:${item.line}` : " (path)"} holds a listed word`)
}

if (!existsSync(list)) {
  report({ ok: true, skipped: true, list: values.list ?? "private/denylist.txt", found: [] })
  process.exit(0)
}
const words = readFileSync(list, "utf8").split("\n").map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean)
  .map((word) => word.normalize("NFC").toLowerCase())
const git = (...args) => spawnSync("git", ["-C", root, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const listed = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
if (listed.status !== 0) {
  console.error(listed.stderr.trim() || `${root} is not a git repository.`)
  process.exit(2)
}
const holds = (text) => words.some((word) => text.normalize("NFC").toLowerCase().includes(word))
const found = []
for (const file of [...new Set(listed.stdout.split("\0").filter(Boolean))]) {
  // The listed word itself is never shown, so the report does not spread it either.
  if (holds(file)) found.push({ file })
  const path = join(root, file)
  if (!existsSync(path) || !statSync(path).isFile()) continue
  const data = readFileSync(path)
  if (data.includes(0)) continue
  data.toString("utf8").split("\n").forEach((line, index) => { if (holds(line)) found.push({ file, line: index + 1 }) })
}
report({ ok: !found.length, skipped: false, words: words.length, found })
process.exitCode = found.length ? 1 : 0
