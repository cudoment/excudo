#!/usr/bin/env node
// Usage: node scripts/where.mjs --source <name> --input <file> [--all] [--json]
// Run in the workspace before bringing a followed note into the memo. For each block the note's
// `changes` reports (added, changed, removed; with --all every block it holds now), lists the memo
// lines that already hold its heading and lines, best first, so the same thought is merged into the
// place that has it and only a thought nothing holds gets a new place. For a removed block it lists
// the open tasks that still hold its lines. `--input` is what the source's page script returned.
// Reads only; exit 0, or 2 on a usage error.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { memoLines, placesOf, stillOpen } from "./lib/match.mjs"

const USAGE = "Usage: node scripts/where.mjs --source <name> --input <file> [--all] [--json]"
let values
try {
  ({ values } = parseArgs({ options: { source: { type: "string" }, input: { type: "string" }, all: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } }))
} catch (error) { console.error(`${error.message}\n${USAGE}`); process.exit(2) }
if (values.help) { console.log(USAGE); process.exit(0) }
if (!values.source || !values.input) { console.error(USAGE); process.exit(2) }

const kit = await import(pathToFileURL(kitPath()).href)
const { engine } = kit
const ws = await engine.loadWorkspace()
const input = readFileSync(values.input === "-" ? 0 : values.input, "utf8")
const [found] = engine.changes(ws, { name: values.source, input })
if (found.kind !== "note") { console.error(`${values.source} is not a note source.`); process.exit(2) }
const memo = memoLines(kit.graphNow(ws), ws.labels)
const current = engine.noteRegion(JSON.parse(input), found.between).blocks
const kept = current.flatMap((block) => [block.heading, ...block.lines])
// A removed line the note still has elsewhere moved; the open tasks listed for the others are what to settle.
const gone = (line) => ({ line, moved: kept.includes(line), open: kept.includes(line) ? [] : stillOpen(line, memo, kept).map(({ node, file, line: at }) => ({ node, file, line: at })) })
const place = (line) => ({ line, places: placesOf(line, memo).map(({ node, file, line: at, score, text }) => ({ node, file, line: at, score: Math.round(score * 100), text: text.trim() })) })
const look = (kind, block) => ({ kind, heading: block.heading, ...(block.was ? { was: block.was } : {}),
  rows: kind === "removed" ? [block.heading, ...block.lines].map(gone) : [block.heading, ...(kind === "changed" ? block.added : block.lines)].map(place),
  ...(kind === "changed" ? { removedLines: block.removed.map(gone) } : {}) })

const detail = found.detail ?? {}
const blocks = found.status === "unmarked" ? []
  : values.all || found.status === "new" ? current.map((block) => look("added", block))
  : [...(detail.added ?? []).map((block) => look("added", block)), ...(detail.changed ?? []).map((block) => look("changed", block)), ...(detail.removed ?? []).map((block) => look("removed", block))]
const result = { source: found.name, status: found.status, between: found.between, removed: found.removed, token: found.token, skipped: detail.skipped ?? 0, blocks }

if (values.json) console.log(JSON.stringify(result, null, 2))
else {
  if (found.status === "unmarked") console.log(`${found.name}: no part between two “${found.between}” lines. Ask the owner to put them around what to follow.`)
  else if (!blocks.length) console.log(`${found.name}: ${found.status}; nothing to bring into the memo.`)
  const sign = { added: "+", changed: "~", removed: "-" }
  const note = (row) => row.moved ? "  ← moved: the note still has it" : row.open.length ? `  ← still open: ${row.open.map((at) => `${at.node} (${at.file}:${at.line})`).join(", ")}` : ""
  for (const block of blocks) {
    console.log(`${sign[block.kind]} ${block.heading}${block.was ? ` (was ${block.was})` : ""}`)
    for (const row of block.rows) {
      if (block.kind === "removed") { console.log(`    ${row.line}${note(row)}`); continue }
      console.log(`    ${row.line}`)
      for (const at of row.places) console.log(`      → ${at.node} (${at.file}:${at.line}) ${at.score}%: ${at.text.slice(0, 80)}`)
      if (!row.places.length) console.log("      → nothing in the memo holds this yet")
    }
    for (const row of block.removedLines ?? []) console.log(`    - ${row.line}${note(row)}`)
  }
  if (result.skipped) console.log(`${result.skipped} private line(s) were left out in the page and are not shown.`)
}

function kitPath() {
  for (const from of [import.meta.url, `${process.env.EXCUDO_ROOT || process.cwd()}/`, `${process.cwd()}/`])
    try { return createRequire(from).resolve("excudo/skill-kit") } catch {}
  console.error("The excudo engine is missing: run npm install in the workspace.")
  process.exit(2)
}
