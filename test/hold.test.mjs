import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { archive, batchesOf, build, idle, ingest, queueItems, queueReport, receive, taskHash } from "../src/index.mjs"
import { heldWithin } from "../src/git.mjs"
import { saveGraph } from "../src/save.mjs"
import { put, read, workspace } from "./helpers.mjs"

// A scheduled run holds the files someone else is changing (EXCUDO_HOLD): every engine command that
// writes the memo leaves them as they are and takes up their work at a later run.
function hold(t, ...files) {
  const before = process.env.EXCUDO_HOLD
  process.env.EXCUDO_HOLD = files.join("\n")
  t.after(() => { if (before === undefined) delete process.env.EXCUDO_HOLD; else process.env.EXCUDO_HOLD = before })
}
const release = () => { delete process.env.EXCUDO_HOLD }
function git(dir, ...args) {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=Owner", "-c", "user.email=owner@example.invalid", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
const jira = { name: "jira", label: "Jira", url: "https://jira.example.com/issues", key: "[A-Z]+-\\d+", complete: true, finished: "settle" }
const issue = (key, extra = {}) => ({ id: key, title: `Work on ${key}`, url: `https://jira.example.com/browse/${key}`, ...extra })
const now = new Date(2026, 9, 12, 9)

test("build leaves the generated section of a held page for a later build", async (t) => {
  const ws = await workspace({ "projects/Docs.md": "# Docs\nDocs work.\n", "projects/Docs/Search.md": "# Search\nThe search demo.\n" }, { locale: "en" })
  assert.equal(build(ws).blocked.length, 0)
  put(ws.root, "projects/Docs/Guide.md", "# Guide\nA new guide.\n")
  const before = read(ws, "projects/Docs.md")
  hold(t, "notes/projects/Docs.md")
  const built = build(ws)
  assert.equal(built.blocked.length, 0)
  assert.equal(read(ws, "projects/Docs.md"), before)
  release()
  build(ws)
  assert.match(read(ws, "projects/Docs.md"), /\[\[Guide\]\]/)
})

test("a queued task on a held page takes no report until the page is free", async (t) => {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n- TODO Check the links #agent\n" }, { locale: "en" })
  const [task] = queueItems(ws)
  const before = read(ws, "projects/Site.md")
  hold(t, "notes/projects")
  assert.throws(() => queueReport(ws, task.key, { summary: "Two links are broken" }), /held by this run/)
  assert.equal(read(ws, "projects/Site.md"), before)
  release()
  queueReport(ws, task.key, { summary: "Two links are broken" })
  assert.match(read(ws, "projects/Site.md"), /WAITING Review: Two links are broken/)
})

test("a collection takes no item for a held page and settles nothing there; the next one does both", async (t) => {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nDocs work.\n\n- TODO Close PRJ-30 [PRJ-30](https://jira.example.com/browse/PRJ-30)\n",
    "projects/Docs/Search.md": "# Search\nThe search demo for PRJ-12.\n\n- Note\n",
  }, { sources: [jira], locale: "en" })
  assert.equal(build(ws).blocked.length, 0)
  const search = read(ws, "projects/Docs/Search.md")
  const docs = read(ws, "projects/Docs.md")
  hold(t, "notes/projects/Docs/Search.md", "notes/projects/Docs.md")
  const first = ingest(ws, "jira", [issue("PRJ-12"), issue("PRJ-30", { done: true })], { now })
  assert.deepEqual(first.held.map((item) => [item.id, item.to]), [["PRJ-12", "projects/Docs/Search.md"]])
  assert.deepEqual(first.added, [])
  assert.deepEqual(first.settled, [])
  assert.equal(read(ws, "projects/Docs/Search.md"), search)
  assert.equal(read(ws, "projects/Docs.md"), docs)
  release()
  const second = ingest(ws, "jira", [issue("PRJ-12"), issue("PRJ-30", { done: true })], { now })
  assert.deepEqual(second.added.map((item) => item.id), ["PRJ-12"])
  assert.match(read(ws, "projects/Docs/Search.md"), /TODO Work on PRJ-12/)
  assert.match(read(ws, "projects/Docs.md"), /- DONE Close PRJ-30/)
})

test("a half-written held page does not stop a save of other pages, and stays out of its commit", async (t) => {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n", "projects/Other.md": "# Other\nAnother page.\n" }, { locale: "en" })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws.root, "init", "-q")
  git(ws.root, "config", "user.name", "Owner")
  git(ws.root, "config", "user.email", "owner@example.invalid")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Notes")
  put(ws.root, "projects/Site.md", "# Sit\n")
  put(ws.root, "projects/Other.md", "# Other\nAnother page, updated.\n")
  assert.equal((await saveGraph(ws, "Run", { only: ["projects/Other.md"] })).code, 1)
  hold(t, "notes/projects/Site.md")
  assert.equal((await saveGraph(ws, "Run", { only: ["projects/Other.md"] })).code, 0)
  assert.match(git(ws.root, "show", "HEAD:notes/projects/Other.md"), /updated/)
  assert.equal(git(ws.root, "show", "HEAD:notes/projects/Site.md"), "# Site\nThe website.\n")
  assert.equal(read(ws, "projects/Site.md"), "# Sit\n")
})

test("a page deleted or renamed a moment ago is an edit in progress, both names of a rename with it", async () => {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n", "projects/Old.md": "# Old\nOld page.\n" }, { locale: "en" })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws.root, "init", "-q")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Notes")
  rmSync(join(ws.graphDir, "projects/Old.md"))
  assert.deepEqual(idle(ws).recent.map((item) => item.file), ["projects/Old.md"])
  git(ws.root, "checkout", "--", "notes/projects/Old.md")
  git(ws.root, "mv", "notes/projects/Site.md", "notes/projects/Web.md")
  assert.deepEqual(idle(ws).recent.map((item) => item.file).sort(), ["projects/Site.md", "projects/Web.md"])
  assert.ok(existsSync(join(ws.graphDir, "projects/Web.md")) && !existsSync(join(ws.graphDir, "projects/Site.md")))
})

test("renaming a page written long ago is an edit in progress too, staged or not", async () => {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n", "archive/Old.md": "# Old\nOld page.\n" }, { locale: "en" })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws.root, "init", "-q")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Notes")
  const dayAgo = new Date(Date.now() - 86400000)
  for (const file of ["projects/Site.md", "archive/Old.md"]) utimesSync(join(ws.graphDir, file), dayAgo, dayAgo)
  assert.deepEqual(idle(ws).recent, [])
  // Not staged: git sees the old name deleted and the new one untracked.
  renameSync(join(ws.graphDir, "projects/Site.md"), join(ws.graphDir, "archive/Web.md"))
  assert.deepEqual(idle(ws).recent.map((item) => item.file).sort(), ["archive/Web.md", "projects/Site.md"])
  // Staged: one rename with both names.
  git(ws.root, "add", "-A", "notes")
  assert.deepEqual(idle(ws).recent.map((item) => item.file).sort(), ["archive/Web.md", "projects/Site.md"])
})

test("archive leaves the finished items of a held page, and moves nothing while the done node is held", async (t) => {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nDocs work.\n\n- TODO still open\n- DONE wrote the intro\n",
    "projects/Site.md": "# Site\nThe website.\n\n- DONE shipped the page\n",
    "Done.md": "# Done\nRecently finished.\n",
  }, { locale: "en" })
  const docs = read(ws, "projects/Docs.md")
  hold(t, "notes/projects/Docs.md")
  const result = await archive(ws)
  assert.deepEqual(result.items.map((item) => item.page), ["Site"])
  assert.equal(read(ws, "projects/Docs.md"), docs)
  process.env.EXCUDO_HOLD = "notes/Done.md"
  const done = read(ws, "Done.md")
  await assert.rejects(archive(ws), /held by this run/)
  assert.equal(read(ws, "projects/Docs.md"), docs)
  assert.equal(read(ws, "Done.md"), done)
})

test("a change from the website to a held page waits, unrecorded, and its batch stays open", async (t) => {
  const ws = await workspace({ "projects/Work.md": "# Work\nCurrent work.\n\n- TODO Write the plan\n" })
  const change = { id: "change-0001", kind: "task", page: "projects/Work.md", line: 4, hash: taskHash("TODO Write the plan"), from: "TODO", to: "DONE", at: new Date().toISOString() }
  const batches = () => batchesOf({ format: "excudo-changes", version: 1, site: "memo-1", entries: [change] })
  hold(t, "notes/projects/Work.md")
  const first = receive(ws, batches())
  assert.deepEqual(first.results.map((item) => item.status), ["held"])
  assert.deepEqual(first.batches.map((batch) => batch.done), [false])
  assert.equal(read(ws, "projects/Work.md"), "# Work\nCurrent work.\n\n- TODO Write the plan\n")
  release()
  const second = receive(ws, batches())
  assert.deepEqual(second.results.map((item) => item.status), ["applied"])
  assert.match(read(ws, "projects/Work.md"), /- DONE Write the plan/)
})

test("a change from the website that would be noted in a held journal waits too", async (t) => {
  const ws = await workspace({ "projects/Work.md": "# Work\nCurrent work.\n\n- TODO Write the plan\n" })
  const now = new Date(2026, 10, 3, 12)
  const change = { id: "change-0002", kind: "task", page: "projects/Gone.md", line: 4, hash: taskHash("TODO Write the plan"), from: "TODO", to: "DONE", at: now.toISOString() }
  const batches = () => batchesOf({ format: "excudo-changes", version: 1, site: "memo-1", entries: [change] })
  hold(t, "notes/journals/2026_11_03.md")
  const first = receive(ws, batches(), { now })
  assert.deepEqual(first.results.map((item) => item.status), ["held"])
  assert.deepEqual(first.batches.map((batch) => batch.done), [false])
  assert.ok(!existsSync(join(ws.graphDir, "journals/2026_11_03.md")))
  release()
  const second = receive(ws, batches(), { now })
  assert.deepEqual(second.results.map((item) => item.status), ["uncertain"])
  assert.ok(existsSync(join(ws.graphDir, "journals/2026_11_03.md")))
})

test("a held file inside a skill's folder holds the skill", async (t) => {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n" }, { locale: "en" })
  hold(t, "skills/tool/SKILL.md")
  assert.equal(heldWithin(ws, join(ws.root, "skills/tool")), true)
  assert.equal(heldWithin(ws, join(ws.root, "skills/other")), false)
  assert.equal(heldWithin(ws, join(ws.root, "skills/tool/SKILL.md")), true)
})
