#!/usr/bin/env node
// Usage: node scripts/raw.mjs [<file> | -] [--json]
// Run in the workspace when the owner pastes an unorganized memo and asks to organize it. Reads the
// pasted text from <file> (or standard input) and sorts each line against the memo: a node it names,
// an open task, a finished or archived line, or a note that already says it, or new; a `similar`
// match is only likely. Prints one line per pasted line with the memo line it matched, or with
// --json the entries (save that file: the owner's answers go into each entry's `answer`, and the
// skill's check reads it with --raw). It only reads: it never changes a file.
// Exit 0 when sorted, 2 on a usage error.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { memoLines, sortRaw } from "./lib/raw-match.mjs"

const USAGE = "Usage: node scripts/raw.mjs [<file> | -] [--json]"
let values, positionals
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } } }))
} catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(2) }
if (values.help) { console.log(USAGE); process.exit(0) }

const kit = await import(pathToFileURL(kitPath()).href)
const ws = await kit.engine.loadWorkspace()
if (!ws.hasConfig) { console.error(`${ws.root} is no Excudo workspace.\n\n${USAGE}`); process.exit(2) }
let text
try { text = readFileSync(!positionals[0] || positionals[0] === "-" ? 0 : positionals[0], "utf8") } catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(2) }

const files = kit.graphNow(ws)
const memo = memoLines(files, ws.labels)
const nodes = [...new Set(memo.map((line) => line.node).concat(files.map(({ file }) => file.split("/").at(-1).replace(/\.md$/, "").normalize("NFC"))))]
const lines = sortRaw(text, memo, nodes)
const counts = {}
for (const entry of lines) {
  const kind = entry.how === "similar" ? "similar" : entry.kind
  counts[kind] = (counts[kind] ?? 0) + 1
}
if (values.json) console.log(JSON.stringify({ at: new Date().toISOString(), counts, lines }, null, 2))
else {
  for (const entry of lines) {
    const kind = entry.how === "similar" ? "similar" : entry.kind
    const where = entry.match?.file ? ` → ${entry.match.file}:${entry.match.line}${entry.match.marker ? ` ${entry.match.marker}` : ""} ${entry.match.text}` : entry.match?.node ? ` → [[${entry.match.node}]]` : ""
    console.log(`${String(entry.n).padStart(3)} ${kind.padEnd(7)} ${"  ".repeat(entry.depth)}${entry.text}${where}`)
  }
  console.log(Object.entries(counts).map(([kind, n]) => `${kind} ${n}`).join(", "))
}

function kitPath() {
  for (const from of [import.meta.url, `${process.env.EXCUDO_ROOT || process.cwd()}/`, `${process.cwd()}/`])
    try { return createRequire(from).resolve("excudo/skill-kit") } catch {}
  console.error("The excudo engine is missing: run npm install in the workspace.")
  process.exit(2)
}
