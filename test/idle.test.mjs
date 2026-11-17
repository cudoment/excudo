import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { check, commitGraph, commitSettled, idle, idleSettled, withGraph } from "../src/index.mjs"
import { uncommitted } from "../src/skillkit.mjs"
import { codes, put, workspace } from "./helpers.mjs"

function git(dir, ...args) {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=Owner", "-c", "user.email=owner@example.invalid", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}
async function repo(files = {}) {
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n", ...files }, { locale: "en" })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws.root, "init", "-q")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Notes")
  return ws
}
const minutesAgo = (path, minutes) => { const time = new Date(Date.now() - minutes * 60000); utimesSync(path, time, time) }

test("a scheduled run may start only when nobody holds the memo, nobody edits it, and it is not paused", async () => {
  const ws = await repo()
  assert.equal(idle(ws).state, "idle")
  // An edit in progress: a graph file left uncommitted that changed in the last minutes.
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  const result = idle(ws)
  assert.equal(result.state, "busy")
  assert.deepEqual(result.recent.map((item) => item.file), ["projects/Site.md"])
  // An edit left long ago waits for a snapshot, not for its writer.
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 30)
  assert.equal(idle(ws).state, "idle")
  assert.equal(idle(ws, { minutes: 60 }).state, "busy")
  // A command holding the graph lock.
  assert.equal(withGraph(ws, () => idle(ws).state), "busy")
  assert.equal(idle(ws).state, "idle")
  // The pause line, in either language, on any page, stops every run.
  put(ws.root, "projects/Site.md", "# Site\nThe website.\n\n- automation:: paused\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 30)
  assert.deepEqual(idle(ws), { state: "paused", paused: ["projects/Site.md"], locked: false, recent: [], minutes: 10 })
  put(ws.root, "projects/Site.md", "# Site\nThe website.\n")
  put(ws.root, "journals/2026_10_16.md", "- 자동 실행:: 멈춤\n")
  assert.equal(idle(ws, { minutes: 0 }).state, "paused")
})

test("check warns about a copy a sync app left and about new lines that look private, naming only the place", async () => {
  const ws = await repo({ "projects/Site/Old.md": "# Old\nThe old site.\n\n- account 1234 5678 9012 kept on purpose\n" })
  put(ws.root, "projects/Site.sync-conflict-20261016-101500-ABCDEFG.md", "# Site\nThe website from the phone.\n")
  put(ws.root, "projects/Site.md", "# Site\nThe website.\n\n- the login is pw: hunter2\n- ship 1.0.0 on 2026-10-16\n")
  put(ws.root, "projects/New.md", "# New\nA new page.\n\n- token " + "sk_" + "live_0123456789abcdefghijklmnopqrstuv\n")
  const { issues } = await check(ws)
  const conflict = issues.find((issue) => issue.code === "sync-conflict")
  assert.equal(conflict.severity, "warning")
  assert.equal(conflict.file, "projects/Site.sync-conflict-20261016-101500-ABCDEFG.md")
  assert.match(conflict.message, /into Site\.md/)
  const lines = issues.filter((issue) => issue.code === "private-line")
  assert.deepEqual(lines.map((issue) => [issue.file, issue.line, issue.severity]), [["projects/Site.md", 4, "warning"], ["projects/New.md", 4, "warning"]])
  // A tracked page with a Korean name is judged too: git would quote its path unless told not to.
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "More notes")
  put(ws.root, "projects/Site/Old.md", "# Old\nThe old site.\n\n- account 1234 5678 9012 kept on purpose\n")
  put(ws.root, "projects/사이트 메모.md", "# 사이트 메모\n웹사이트입니다.\n")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Korean page")
  // A name with a space too: git ends the path in its diff header with a tab.
  put(ws.root, "projects/사이트 메모.md", "# 사이트 메모\n웹사이트입니다.\n\n- 비밀번호는 hunter2\n")
  assert.deepEqual((await check(ws)).issues.filter((issue) => issue.code === "private-line").map((issue) => [issue.file, issue.line]), [["projects/사이트 메모.md", 4]])
  // The words never reach the message; a committed line is not raised again.
  assert.ok(lines.every((issue) => !issue.message.includes("hunter2") && !issue.message.includes("sk_live")))
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "More notes")
  assert.deepEqual(codes((await check(ws)).issues).filter((code) => code === "private-line"), [])
})

test("a generated page left uncommitted is nobody's edit in progress", async () => {
  const ws = await repo({ "Status.md": "generated:: views/Status.mdx\n\n# Status\nOld.\n" })
  put(ws.root, "Status.md", "generated:: views/Status.mdx\n\n# Status\nNew.\n")
  assert.equal(idle(ws).state, "idle")
  put(ws.root, "상황.md", "생성:: views/상황.mdx\n\n# 상황\n새 글.\n")
  assert.equal(idle(ws).state, "idle")
})

test("a run holds the files someone else is changing: idle lets it start, commits and save checks leave them as they were", async (t) => {
  const ws = await repo({ "projects/Other.md": "# Other\nAnother page.\n" })
  git(ws.root, "config", "user.name", "Owner")
  git(ws.root, "config", "user.email", "owner@example.invalid")
  const before = process.env.EXCUDO_HOLD
  t.after(() => { if (before === undefined) delete process.env.EXCUDO_HOLD; else process.env.EXCUDO_HOLD = before })
  // Someone is writing Site.md and a learned skill; the run writes Other.md.
  put(ws.root, "projects/Site.md", "# Site\nThe website, half rewritten.\n")
  mkdirSync(join(ws.root, "skills/tool"), { recursive: true })
  writeFileSync(join(ws.root, "skills/tool/run.mjs"), "// in progress\n")
  assert.equal(idle(ws).state, "busy")
  process.env.EXCUDO_HOLD = "notes/projects/Site.md\nskills/tool\n"
  assert.equal(idle(ws).state, "idle")
  put(ws.root, "projects/Other.md", "# Other\nAnother page, updated by the run.\n")
  assert.deepEqual(uncommitted(ws, ["skills"]), [" M notes/projects/Other.md"])
  // A snapshot sweeps the graph and the learned skills, but not what is held.
  assert.equal(commitGraph(ws, "Run", { includeReview: true }), "committed")
  const status = spawnSync("git", ["-C", ws.root, "-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).stdout
  assert.deepEqual(status.split("\n").filter(Boolean).sort(), [" M notes/projects/Site.md", "?? skills/tool/run.mjs"])
  assert.match(spawnSync("git", ["-C", ws.root, "show", "HEAD:notes/projects/Other.md"], { encoding: "utf8" }).stdout, /updated by the run/)
  assert.equal(readFileSync(join(ws.graphDir, "projects/Site.md"), "utf8"), "# Site\nThe website, half rewritten.\n")
  // Naming a held page in `only` commits nothing of it; with nothing else to commit, the graph is clean.
  assert.equal(commitGraph(ws, "Run", { only: ["projects/Site.md"] }), "clean")
  assert.deepEqual(uncommitted(ws, ["skills"]), [])
  delete process.env.EXCUDO_HOLD
  assert.equal(uncommitted(ws, ["skills"]).length, 2)
})

test("an edit left untouched for a while that passes the check is settled, not in progress", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n" })
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt.\n")
  // Both changed a moment ago: still being written.
  let result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.recent.map((item) => item.file).sort(), ["projects/Site.md", "projects/Web.md"])
  assert.deepEqual(result.settled, [])
  assert.equal(result.state, "busy")
  // Six minutes untouched: finished, so a run commits it on its own and works on the page.
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 6)
  result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.settled.map((item) => item.file), ["projects/Site.md"])
  assert.deepEqual(result.recent.map((item) => item.file), ["projects/Web.md"])
  // A page left half written (its title broken) is still in progress, however quiet.
  put(ws.root, "projects/Site.md", "# Sit\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 6)
  result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.settled, [])
  assert.deepEqual(result.recent.map((item) => item.file).sort(), ["projects/Site.md", "projects/Web.md"])
  // An old edit that passes is settled too, so it gets a commit of its own instead of joining a run's.
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 60)
  minutesAgo(join(ws.graphDir, "projects/Web.md"), 60)
  result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.settled.map((item) => item.file).sort(), ["projects/Site.md", "projects/Web.md"])
  assert.equal(result.state, "idle")
  // Without settle, idle stays as it was.
  assert.equal("settled" in idle(ws), false)
})

test("the two names of a rename settle together", async () => {
  const ws = await repo({ "projects/Old.md": "# Old\nOld page.\n" })
  git(ws.root, "mv", "notes/projects/Old.md", "notes/projects/New.md")
  put(ws.root, "projects/New.md", "# Old\nOld page.\n")
  const back = new Date(Date.now() - 6 * 60000)
  for (const dir of ["", "projects"]) utimesSync(join(ws.graphDir, dir), back, back)
  utimesSync(join(ws.graphDir, "projects/New.md"), back, back)
  // The new name breaks the title rule, so neither name settles: the deletion waits with the page.
  let result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.settled, [])
  put(ws.root, "projects/New.md", "# New\nOld page.\n")
  utimesSync(join(ws.graphDir, "projects/New.md"), back, back)
  utimesSync(join(ws.graphDir, "projects"), back, back)
  result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.settled.map((item) => item.file).sort(), ["projects/New.md", "projects/Old.md"])
})

test("snapshot --only commits just the edits it names", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n" })
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt.\n")
  assert.equal(commitGraph(ws, "Edits", { only: ["projects/Site.md"] }), "committed")
  const status = spawnSync("git", ["-C", ws.root, "status", "--porcelain"], { encoding: "utf8" }).stdout
  assert.match(status, /projects\/Web\.md/)
  assert.doesNotMatch(status, /projects\/Site\.md/)
})

test("an old edit that fails the check is unsettled, and one changed while the check ran is not settled", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n" })
  put(ws.root, "projects/Site.md", "# Sit\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 60)
  let result = await idleSettled(ws, { settle: 5 })
  assert.deepEqual(result.recent, [])
  assert.deepEqual(result.settled, [])
  assert.deepEqual(result.unsettled.map((item) => item.file), ["projects/Site.md"])
  // Changed during the check: still being written.
  put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt.\n")
  minutesAgo(join(ws.graphDir, "projects/Web.md"), 6)
  result = await idleSettled(ws, { settle: 5, failing: () => { put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt again.\n"); return new Set(["projects/Site.md"]) } })
  assert.deepEqual(result.settled, [])
})

test("snapshot --settle commits only the settled edits", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n" })
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt.\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 6)
  const result = await commitSettled(ws, { settle: 5 })
  assert.deepEqual(result.committed, ["projects/Site.md"])
  assert.deepEqual(result.recent.map((item) => item.file), ["projects/Web.md"])
  const status = spawnSync("git", ["-C", ws.root, "status", "--porcelain"], { encoding: "utf8" }).stdout
  assert.match(status, /projects\/Web\.md/)
  assert.doesNotMatch(status, /projects\/Site\.md/)
})

test("a page first changed while the check ran is in progress, and a folder's error keeps its page from settling", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n", "projects/Parent.md": "# Parent\nThe parent.\n", "projects/Parent/Child.md": "# Child\nThe child.\n" })
  put(ws.root, "projects/Site.md", "# Site\nThe website, rebuilt.\n")
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 6)
  const result = await idleSettled(ws, { settle: 5, failing: () => { put(ws.root, "projects/Web.md", "# Web\nThe web page, rebuilt.\n"); return new Set() } })
  assert.deepEqual(result.settled.map((item) => item.file), ["projects/Site.md"])
  assert.deepEqual(result.recent.map((item) => item.file), ["projects/Web.md"])
  // The parent page deleted long ago leaves its folder behind: the check's error names the folder.
  git(ws.root, "checkout", "--", "notes/projects/Web.md")
  rmSync(join(ws.graphDir, "projects/Parent.md"))
  put(ws.root, "projects/Parent/Child.md", "# Child\nThe child, rebuilt.\n")
  minutesAgo(join(ws.graphDir, "projects/Parent/Child.md"), 60)
  const back = new Date(Date.now() - 60 * 60000)
  utimesSync(join(ws.graphDir, "projects"), back, back)
  const failing = await import("../src/idle.mjs").then((m) => m.failingFiles(ws))
  assert.ok(failing.has("projects/Parent"))
  const parent = await idleSettled(ws, { settle: 5, failing })
  assert.deepEqual(parent.settled.map((item) => item.file), ["projects/Site.md"])
  assert.deepEqual(parent.unsettled.map((item) => item.file).sort(), ["projects/Parent.md", "projects/Parent/Child.md"])
})

test("a settled edit is committed as the check passed it, and nothing is committed while the memo is paused", async () => {
  const ws = await repo({ "projects/Web.md": "# Web\nThe web page.\n" })
  const { commitContents } = await import("../src/git.mjs")
  // An editor wrote again after the check: the commit takes the checked content and leaves the new one.
  put(ws.root, "projects/Site.md", "# Site\nWritten later.\n")
  assert.equal(commitContents(ws, "Edits", [{ file: "projects/Site.md", content: Buffer.from("# Site\nThe website, rebuilt.\n") }]), "committed")
  const show = spawnSync("git", ["-C", ws.root, "show", "HEAD:notes/projects/Site.md"], { encoding: "utf8" }).stdout
  assert.equal(show, "# Site\nThe website, rebuilt.\n")
  assert.equal(readFileSync(join(ws.graphDir, "projects/Site.md"), "utf8"), "# Site\nWritten later.\n")
  const status = spawnSync("git", ["-C", ws.root, "status", "--porcelain"], { encoding: "utf8" }).stdout
  assert.match(status, /^ M notes\/projects\/Site\.md/m)
  // Paused: the settled edit stays uncommitted.
  put(ws.root, "projects/Web.md", "# Web\nThe web page.\n\n- automation:: paused\n")
  minutesAgo(join(ws.graphDir, "projects/Web.md"), 6)
  minutesAgo(join(ws.graphDir, "projects/Site.md"), 6)
  const result = await commitSettled(ws, { settle: 5 })
  assert.equal(result.state, "paused")
  assert.deepEqual(result.committed, [])
})
