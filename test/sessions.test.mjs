import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { agentSessions, claudeStore } from "../src/index.mjs"
import { putSession, withRecords } from "../src/records.mjs"
import { tempDir, workspace } from "./helpers.mjs"

const cli = fileURLToPath(new URL("../bin/excudo.mjs", import.meta.url))
const span = (cwd, day, hour) => ({ day, cwd, start: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, end: `${day}T${String(hour).padStart(2, "0")}:30:00Z`, turns: 1 })
const session = (tool, id, title, spans, batch = false) => ({ tool, id, title, batch, skills: [], prs: [], cost: null, spans, checks: [] })
const ids = (found) => found.map((item) => item.id)

// Site sits under Web; Docs moved from a folder that is gone. The records hold what `activity` read:
// two Claude Code sessions on Site, a Codex one on Docs, a Claude Code one from Docs' old folder and a
// scheduled run.
async function setup() {
  const site = tempDir("site-")
  const docs = tempDir("docs-")
  const logs = tempDir("logs-")
  const old = join(tempDir("old-"), "docs")
  const ws = await workspace({
    "projects/Web.md": "# Web\nThe web work.\n",
    "projects/Web/Site.md": `# Site\nThe website.\n\n## Workspace\n\`${site}\` · \`main\`\n`,
    "projects/Docs.md": `# Docs\nThe documents.\n\n## Workspace\n\`${docs}\` · \`main\`\n`,
  }, { locale: "en", conversations: { claude: join(logs, "claude"), codex: join(logs, "codex") }, moved: { [old]: docs } })
  withRecords(ws, (db) => {
    putSession(db, "claude:a", session("claude", "a", "Header", [span(site, "2026-10-12", 10)]))
    putSession(db, "claude:b", session("claude", "b", "It's later", [span(site, "2026-10-13", 11)]))
    putSession(db, "codex:c", session("codex", "c", null, [span(docs, "2026-10-13", 9)]))
    putSession(db, "claude:d", session("claude", "d", "Old docs", [span(old, "2026-10-11", 9)]))
    putSession(db, "claude:e", session("claude", "e", "Scheduled", [span(site, "2026-10-13", 12)], true))
  }, { write: true })
  return { ws, site, docs, old, claude: join(logs, "claude") }
}

test("sessions lists a node's sessions and its children's, newest first, with the command that resumes each", async () => {
  const { ws, site } = await setup()
  const web = agentSessions(ws, { node: "Web", refresh: false })
  // The scheduled run is left out: no one resumes it.
  assert.deepEqual(ids(web), ["b", "a"])
  assert.equal(web[0].resume, `cd '${site}' && claude --resume 'b'`)
  assert.equal(web[0].node, "Site")
  assert.equal(web[0].exists, true)
  assert.deepEqual(ids(agentSessions(ws, { node: "Site", refresh: false })), ["b", "a"])
  assert.deepEqual(ids(agentSessions(ws, { refresh: false })), ["b", "c", "a", "d"])
  assert.throws(() => agentSessions(ws, { node: "Nowhere", refresh: false }), /No node named Nowhere/)
})

test("a session from a moved folder resumes in the new folder, and says where Claude Code still keeps it", async () => {
  const { ws, docs, old, claude } = await setup()
  mkdirSync(join(claude, claudeStore(old)), { recursive: true })
  writeFileSync(join(claude, claudeStore(old), "d.jsonl"), "")
  let found = agentSessions(ws, { node: "Docs", refresh: false })
  assert.deepEqual(ids(found), ["c", "d"])
  assert.equal(found[0].resume, `cd '${docs}' && codex resume 'c'`)
  const moved = found[1]
  assert.equal(moved.folder, docs)
  assert.equal(moved.was, old)
  assert.equal(moved.resume, `cd '${docs}' && claude --resume 'd'`)
  assert.equal(moved.store, join(claude, claudeStore(old)))
  // Once the transcript is in the new folder's store, Claude Code finds it from there.
  mkdirSync(join(claude, claudeStore(docs)), { recursive: true })
  writeFileSync(join(claude, claudeStore(docs), "d.jsonl"), "")
  found = agentSessions(ws, { node: "Docs", refresh: false })
  assert.equal(found[1].store, undefined)
  assert.equal(claudeStore("/Users/me/work/feature-PRJ.1"), "-Users-me-work-feature-PRJ-1")
})

test("sessions narrows to a folder by its old or new path, to the last days, and to a number", async () => {
  const { ws, docs, old } = await setup()
  assert.deepEqual(ids(agentSessions(ws, { path: old, refresh: false })), ["c", "d"])
  assert.deepEqual(ids(agentSessions(ws, { path: docs, refresh: false })), ["c", "d"])
  assert.deepEqual(ids(agentSessions(ws, { days: 1, now: new Date("2026-10-13T12:00:00Z"), refresh: false })), ["b", "c"])
  assert.deepEqual(ids(agentSessions(ws, { limit: 1, refresh: false })), ["b"])
})

test("sessions prints each session with its resume command and notes, or JSON", async () => {
  const { ws, docs, old, claude } = await setup()
  mkdirSync(join(claude, claudeStore(old)), { recursive: true })
  writeFileSync(join(claude, claudeStore(old), "d.jsonl"), "")
  const run = (...args) => spawnSync(process.execPath, [cli, "sessions", ...args, "--root", ws.root], { encoding: "utf8", timeout: 60000 })
  let result = run("Docs")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Claude · Docs · Old docs\n {2}cd '.+' && claude --resume 'd'\n/)
  assert.ok(result.stdout.includes(`(the folder moved from ${old})`))
  assert.ok(result.stdout.includes(`(Claude Code keeps this transcript in ${join(claude, claudeStore(old))};`))
  result = run("--path", docs, "--json")
  assert.deepEqual(ids(JSON.parse(result.stdout)), ["c", "d"])
  result = run("--limit", "0")
  assert.notEqual(result.status, 0)
})
