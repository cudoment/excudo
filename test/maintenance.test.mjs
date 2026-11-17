import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { archive, build, check, find, init, keepCandidates, move, remove, review } from "../src/index.mjs"
import { git as gitAsync, gitOutput, history } from "../src/history.mjs"
import { bulletParagraphs, taskLines, tightenHeadings } from "../src/dialects/logseq.mjs"
import { workspace, put, read, tempDir } from "./helpers.mjs"

const now = new Date("2026-10-01T12:00:00Z")
const view = "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n"
const kindsOf = (result, node) => result.candidates.filter((item) => item.node === node).flatMap((item) => item.reasons.map((reason) => reason.kind))
function git(ws, args, date) {
  const result = spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8", env: { ...process.env,
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repo(ws, date = "2026-06-01T12:00:00Z") {
  git(ws, ["init", "-q"])
  git(ws, ["config", "user.name", "Test User"])
  git(ws, ["config", "user.email", "test@example.invalid"])
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws, ["add", "."])
  git(ws, ["commit", "-qm", "Initial notes"], date)
}
function commit(ws, message, date) {
  git(ws, ["add", "-A"])
  git(ws, ["commit", "-qm", message], date)
}

test("unreadable git history is reported instead of dating every node now", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- first\n" })
  build(ws); repo(ws)
  put(ws.root, "A/Child.md", read(ws, "A/Child.md").replace("- first", "- second"))
  commit(ws, "Edit child", "2026-07-01T12:00:00Z")
  const blob = git(ws, ["rev-parse", "HEAD~1:notes/A/Child.md"])
  rmSync(join(ws.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)))
  assert.equal((await history(ws, now)).failed, true)
  const result = await review(ws, { now })
  assert.equal(result.notice, ws.labels.messages["history-failed"])
  assert.equal(result.top.summaryBehind, 0)
  assert.ok(!result.candidates.some((item) => item.reasons.some((reason) => ["summary-behind", "node-stale"].includes(reason.kind))))
  assert.ok((await check(ws, { now })).issues.some((issue) => issue.code === "history-failed"))
})

test("git output that overflows its buffer counts as a failure, not as complete output", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n" })
  repo(ws)
  assert.ok(gitOutput(ws.root, ["log", "--format=%H%n%s%n%b"]))
  assert.equal(gitOutput(ws.root, ["log", "--format=%H%n%s%n%b"], undefined, 8), undefined)
})

test("async git output that overflows its buffer or fails resolves to undefined", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n" })
  repo(ws)
  assert.ok(await gitAsync(ws.root, ["log", "--format=%H%n%s%n%b"]))
  assert.equal(await gitAsync(ws.root, ["log", "--format=%H%n%s%n%b"], { maxBuffer: 8 }), undefined)
  assert.equal(await gitAsync(ws.root, ["no-such-command"]), undefined)
  assert.equal(await gitAsync(ws.root, ["hash-object", "--stdin"], { input: "x" }), "c1b0730e0133447badcfd47fd144e254807b06e1\n")
})

test("line times are read only after loading, and loading several files gives each its own blame", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO a\n", "B.md": "# B\n\nB.\n\n- TODO b\n" })
  repo(ws)
  put(ws.root, "B.md", read(ws, "B.md").replace("- TODO b", "- TODO b changed"))
  commit(ws, "Change B", "2026-07-01T12:00:00Z")
  const h = await history(ws, now)
  assert.throws(() => h.file("A.md", read(ws, "A.md")).times, /not loaded/)
  await h.loadTimes(["A.md", "B.md"].map((path) => ({ path, text: read(ws, path) })))
  assert.equal(h.file("A.md", read(ws, "A.md")).times[4], Date.parse("2026-06-01T12:00:00Z"))
  assert.equal(h.file("B.md", read(ws, "B.md")).times[4], Date.parse("2026-07-01T12:00:00Z"))
})

test("deepening a shallow clone refreshes cached blame dates", async () => {
  const origin = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- TODO old task\n- note\n" })
  build(origin); repo(origin, "2026-01-01T12:00:00Z")
  put(origin.root, "A/Child.md", read(origin, "A/Child.md").replace("- note", "- newer note"))
  commit(origin, "Edit note", "2026-09-01T12:00:00Z")
  const root = join(tempDir(), "clone")
  const clone = spawnSync("git", ["clone", "-q", "--depth", "1", `file://${origin.root}`, root], { encoding: "utf8" })
  assert.equal(clone.status, 0, clone.stderr)
  const ws = await (await import("../src/index.mjs")).loadWorkspace({ root })
  const taskTime = async () => { const h = await history(ws, now); const time = (await h.times("A/Child.md", read(ws, "A/Child.md")))[4]; h.save(); return time }
  assert.equal(await taskTime(), Date.parse("2026-09-01T12:00:00Z"))
  const deepen = spawnSync("git", ["-C", root, "fetch", "-q", "--unshallow"], { encoding: "utf8" })
  assert.equal(deepen.status, 0, deepen.stderr)
  assert.equal(await taskTime(), Date.parse("2026-01-01T12:00:00Z"))
})

test("an unreadable blame is a history failure, but a node written again after its deletion is not", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- first\n", "B.md": "# B\n\nB.\n" })
  repo(ws)
  put(ws.root, "A.md", read(ws, "A.md").replace("- first", "- second"))
  rmSync(join(ws.graphDir, "B.md"))
  commit(ws, "Edit A and remove B", "2026-07-01T12:00:00Z")
  put(ws.root, "B.md", "# B\n\nB again.\n")
  const warm = await history(ws, now)
  assert.equal(warm.failed, false)
  assert.deepEqual(await warm.times("B.md", read(ws, "B.md")), [now.getTime(), now.getTime(), now.getTime(), now.getTime()])
  assert.equal(warm.failed, false)
  warm.save()
  const blob = git(ws, ["rev-parse", "HEAD~1:notes/A.md"])
  rmSync(join(ws.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)))
  const h = await history(ws, now)
  assert.equal(h.failed, false)
  assert.deepEqual(await h.times("A.md", read(ws, "A.md")), [])
  assert.equal(h.failed, true)
})

test("archive stops before writing when unreadable history would misdate overflow", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO a\n- DONE new item\n", "Done.md": "# Done\n\nRecent.\n\n- DONE old item\n" }, { doneKeep: 1 })
  build(ws); repo(ws)
  put(ws.root, "Done.md", read(ws, "Done.md").replace("Recent.", "Recently finished."))
  commit(ws, "Reword Done", "2026-07-01T12:00:00Z")
  const warm = await history(ws, now)
  warm.save()
  const blob = git(ws, ["rev-parse", "HEAD~1:notes/Done.md"])
  rmSync(join(ws.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)))
  const before = [read(ws, "A.md"), read(ws, "Done.md")]
  await assert.rejects(archive(ws, { now }), { message: ws.labels.messages["history-failed"] })
  assert.deepEqual([read(ws, "A.md"), read(ws, "Done.md")], before)
})

test("remove reads the build state before deleting, so a corrupt cache leaves the graph intact", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/C.md": "# C\n\nC.\n" })
  build(ws)
  writeFileSync(join(ws.cacheDir, "build.json"), "{ not json")
  assert.throws(() => remove(ws, "A"))
  assert.ok(existsSync(join(ws.graphDir, "A.md")) && existsSync(join(ws.graphDir, "A", "C.md")))
})

test("a repository without commits has no history but has not failed", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n" })
  git(ws, ["init", "-q"])
  const h = await history(ws, now)
  assert.equal(h.failed, false)
  assert.equal(h.available, false)
  assert.ok(!(await check(ws, { now })).issues.some((issue) => issue.code === "history-failed"))
})

test("bounded blob batches and the history cache give the same dates, and generated views are skipped", async () => {
  const ws = await workspace({ "views/Home.mdx": view, "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- TODO work\n", "B.md": "# B\n\nB.\n" })
  build(ws); repo(ws)
  put(ws.root, "A/Child.md", read(ws, "A/Child.md").replace("C.", "Changed."))
  build(ws); commit(ws, "Edit child", "2026-07-01T12:00:00Z")
  const paths = ["A.md", "A/Child.md", "B.md"]
  const dates = async (h) => {
    await h.loadTimes(paths.map((path) => ({ path, text: read(ws, path) })))
    return paths.map((path) => { const f = h.file(path, read(ws, path)); return [f.dirty, f.last, f.times] })
  }
  const whole = await history(ws, now)
  const expected = await dates(whole)
  assert.deepEqual(await dates(await history(ws, now, { chunkBytes: 1 })), expected)
  whole.save()
  const cache = JSON.parse(readFileSync(join(ws.cacheDir, "history.json"), "utf8"))
  assert.ok(!(git(ws, ["rev-parse", "HEAD:notes/Home.md"]) in cache.blobs))
  assert.ok(git(ws, ["rev-parse", "HEAD:notes/A/Child.md"]) in cache.blobs)
  assert.deepEqual(Object.keys(cache.blame).sort(), paths.map((path) => `notes/${path}`))
  assert.deepEqual(await dates(await history(ws, now)), expected)
})

test("moving a node keeps its authored age, while editing it renews the age", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO a\n", "B.md": "# B\n\nB.\n\n- TODO b\n", "A/Old.md": "# Old\n\nOld.\n\n- TODO dusty\n" })
  build(ws); repo(ws)
  assert.ok(kindsOf(await review(ws, { now }), "A/Old").includes("node-stale"))
  await move(ws, "Old", "B"); build(ws)
  commit(ws, "Move Old below B", "2026-09-30T12:00:00Z")
  assert.deepEqual(kindsOf(await review(ws, { now }), "B/Old").filter((kind) => kind.endsWith("stale")).sort(), ["node-stale", "task-stale"])
  put(ws.root, "B/Old.md", read(ws, "B/Old.md").replace("Old.", "Old, revisited."))
  commit(ws, "Revisit Old", "2026-09-30T13:00:00Z")
  assert.ok(!kindsOf(await review(ws, { now }), "B/Old").includes("node-stale"))
})

test("archive refuses metadata in any letter case and nodes already inside Done", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO a\n", "Done.md": "# Done\n\nRecent.\n", "Record.md": "# Record\n\nLog.\n\n- batch 1\n",
    "Finished.md": "# Finished\n\nShipped.\n" })
  build(ws)
  for (const name of ["record", "RECORD", "done"]) await assert.rejects(archive(ws, { node: name, now }), /cannot be archived/)
  assert.ok(existsSync(join(ws.graphDir, "Record.md")))
  await archive(ws, { node: "Finished", now }); build(ws)
  await assert.rejects(archive(ws, { node: "finished", now }), /cannot be archived/)
  await assert.rejects(archive(ws, { node: "done 2026-10", now }), /cannot be archived/)
})

test("archived nodes and the record log are not reviewed as idle, stale, old ideas or outdated summaries", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO a\n", "Done.md": "# Done\n\nRecent.\n", "A/Finished.md": "# Finished\n\nShipped.\n\n- Idea: follow-up\n",
    "Record.md": "# Record\n\nLog.\n", "Record/Batch.md": "# Batch\n\nFirst batch.\n" })
  build(ws); repo(ws)
  await archive(ws, { node: "Finished", now }); build(ws)
  commit(ws, "Archive Finished", "2026-06-02T12:00:00Z")
  const result = await review(ws, { now })
  for (const node of ["Done", "Done/Done 2026/Done 2026-10/Finished", "Record", "Record/Batch"]) assert.deepEqual(kindsOf(result, node), [])
  assert.equal(result.top.summaryBehind, 0)
})

test("removing a node releases its generated region, so a new node with that name builds", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/C.md": "# C\n\nC.\n" })
  build(ws)
  remove(ws, "A")
  put(ws.root, "A.md", "# A\n\nA again.\n")
  put(ws.root, "A/D.md", "# D\n\nD.\n")
  assert.deepEqual(build(ws).blocked, [])
  assert.match(read(ws, "A.md"), /\[\[D\]\]/)
})

test("history search ignores letter case like the current search", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- Renew Passport at city hall\n" })
  build(ws); repo(ws)
  put(ws.root, "A.md", "# A\n\nA.\n")
  commit(ws, "Remove passport line", "2026-07-01T12:00:00Z")
  for (const term of ["passport", "PASSPORT"]) assert.equal(find(ws, term, { history: true }).history.length, 1)
})

test("history search shows every removed line of a matching commit, like git show did", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- renew passport\n", "B.md": "# B\n\nB.\n\n- passport tomorrow\n" })
  build(ws); repo(ws)
  put(ws.root, "A.md", "# A\n\nA.\n")
  put(ws.root, "B.md", read(ws, "B.md").replace("passport tomorrow", "passport Friday"))
  commit(ws, "Renew and reschedule", "2026-07-01T12:00:00Z")
  assert.deepEqual(find(ws, "passport", { history: true }).history.map((hit) => [hit.path, hit.text]).sort(),
    [["notes/A.md", "- renew passport"], ["notes/B.md", "- passport tomorrow"]])

  // Moving a node that still holds the words is not a removal.
  put(ws.root, "C.md", "# C\n\nC.\n")
  commit(ws, "Add C", "2026-07-02T12:00:00Z")
  await move(ws, "B", "C")
  commit(ws, "Move B below C", "2026-07-03T12:00:00Z")
  assert.equal(find(ws, "passport", { history: true }).history.length, 2)
})

test("changing a returned review or task result does not change later results", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO renew\n  DEADLINE: <2026-07-02 Thu>\n" })
  build(ws)
  const first = await review(ws, { now })
  const overdue = (result) => result.candidates.flatMap((item) => item.reasons).find((reason) => reason.kind === "task-overdue")
  overdue(first).properties.push("DEADLINE: <2099-01-01 Thu>")
  taskLines(read(ws, "A.md"), ws.labels.region)[0].ownLines.length = 0
  assert.deepEqual(overdue(await review(ws, { now })).properties, ["DEADLINE: <2026-07-02 Thu>"])
  assert.deepEqual(taskLines(read(ws, "A.md"), ws.labels.region)[0].ownLines, [4, 5])
})

test("overriding one review word keeps the other words of every group", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "B.md": "# B\n\nB.\n\n- TODO b 2026-01-01\n" },
    { labels: { review: { "node-idle": "custom idle" }, recommendations: { "task-overdue": "custom overdue" } } })
  build(ws)
  const reasons = (await review(ws, { now })).candidates.flatMap((item) => item.reasons)
  assert.ok(reasons.every((reason) => reason.evidence && reason.recommendation))
  assert.ok(!reasons.some((reason) => /undefined/.test(reason.evidence)))
  assert.equal(reasons.find((reason) => reason.kind === "node-idle").evidence, "custom idle")
  assert.equal(reasons.find((reason) => reason.kind === "task-overdue").recommendation, "custom overdue")
  assert.equal(ws.labels.messages.clean, "No issues.")
})

test("a date without a year means its nearest occurrence", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO renew card 1/5\n- TODO 1월 5일 갱신\n- TODO send cards 12/20\n" })
  build(ws)
  const overdue = async (date) => (await review(ws, { now: new Date(date) })).candidates
    .filter((item) => item.reasons.some((reason) => reason.kind === "task-overdue")).map((item) => item.text)
  assert.deepEqual(await overdue("2026-12-21T12:00:00"), ["TODO send cards 12/20"])
  assert.deepEqual(await overdue("2027-01-10T12:00:00"), ["TODO renew card 1/5", "TODO 1월 5일 갱신", "TODO send cards 12/20"])
  put(ws.root, "A.md", "# A\n\nA.\n\n- TODO leap-day renewal 2/29\n")
  assert.deepEqual(await overdue("2026-01-01T12:00:00"), ["TODO leap-day renewal 2/29"])
})

test("init refuses a non-English locale with the English example", async () => {
  await assert.rejects(init(tempDir(), { locale: "ko", example: true }), /영어로만/)
})

test("recording a keep drops decisions that have already expired", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n" })
  build(ws)
  writeFileSync(join(ws.root, "review.json"), JSON.stringify({ kept: { "gone:node:0": { at: "2026-01-01T00:00:00Z", reasons: [] },
    "recent:node:0": { at: "2026-09-01T00:00:00Z", reasons: [] } } }))
  await keepCandidates(ws, [(await review(ws, { now })).candidates[0].id], { now })
  const kept = JSON.parse(readFileSync(join(ws.root, "review.json"), "utf8")).kept
  assert.ok(!("gone:node:0" in kept))
  assert.ok("recent:node:0" in kept)
  assert.equal(Object.keys(kept).length, 2)
})

test("a moved node and its descendants get their new location without a blocked build", async () => {
  const ws = await workspace({ "views/Home.mdx": view, "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n", "A/Child/Leaf.md": "# Leaf\n\nL.\n", "B.md": "# B\n\nB.\n" })
  build(ws)
  assert.match(read(ws, "A/Child/Leaf.md"), /Location: \[\[Home\]\] › \[\[A\]\] › \[\[Child\]\] › Leaf\n$/)
  await move(ws, "Child", "B")
  assert.deepEqual(build(ws).blocked, [])
  assert.match(read(ws, "B/Child.md"), /## Subpages\nLocation: \[\[Home\]\] › \[\[B\]\] › Child\n\n- \[\[Leaf\]\]/)
  assert.match(read(ws, "B/Child/Leaf.md"), /Location: \[\[Home\]\] › \[\[B\]\] › \[\[Child\]\] › Leaf\n$/)
  assert.ok(read(ws, "A.md").endsWith("## Subpages\nLocation: [[Home]] › A\n"))
})

test("the location starts at the top node without a Home view and follows the locale", async () => {
  const plain = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n" })
  build(plain)
  assert.match(read(plain, "A/Child.md"), /Location: \[\[A\]\] › Child\n$/)
  const korean = await workspace({ "views/홈.mdx": view.replace("# Home", "# 홈"), "가.md": "# 가\n\n요약.\n", "가/나.md": "# 나\n\n요약.\n" }, { locale: "ko" })
  build(korean)
  assert.ok(read(korean, "가/나.md").endsWith("## 하위 문서\n위치: [[홈]] › [[가]] › 나\n"))
})

test("init pins Home in the outliner favorites", async () => {
  for (const [locale, home] of [["en", "Home"], ["ko", "홈"]]) {
    const root = tempDir()
    await init(root, { locale })
    assert.match(readFileSync(join(root, "notes", "logseq", "config.edn"), "utf8"), new RegExp(`:favorites \\["${home}"\\]`))
  }
})

test("headings take their content on the next line and one blank line above, outside code", async () => {
  const before = "# Title\n\nSummary.\n\n- TODO a\ntext\n## Notes\n\n- note\n\n## Empty\n\n## Last\n\n```text\n## not a heading\n\nkept\n```\n"
  const after = "# Title\nSummary.\n\n- TODO a\ntext\n\n## Notes\n- note\n\n## Empty\n\n## Last\n```text\n## not a heading\n\nkept\n```\n"
  assert.equal(tightenHeadings(before), after)
  assert.equal(tightenHeadings(after), after)
  const ws = await workspace({ "A.md": before, "B.md": after.replace("text\n\n## Notes", "- more\n\n## Notes") })
  build(ws)
  const issues = (await check(ws)).issues.filter((issue) => issue.code === "heading-spacing")
  assert.deepEqual(issues.map((issue) => [issue.file, issue.line]), [["A.md", 1], ["A.md", 7], ["A.md", 13]])
})

test("generated pages follow the heading layout", async () => {
  const home = "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n\n## Now\n\n```outline\n- In progress\n```\n"
  const ws = await workspace({ "views/Home.mdx": home, "A.md": "# A\nA.\n\n- TODO a\n- DONE b\n", "A/Child.md": "# Child\nC.\n" }, { doneKeep: 0 })
  build(ws)
  assert.match(read(ws, "Home.md"), /\n\n## Now\n- In progress/)
  await archive(ws, { now })
  build(ws)
  for (const path of ["Done.md", "Done/Done 2026.md", "Done/Done 2026/Done 2026-10.md"]) assert.match(read(ws, path), /^# [^\n]+\n[^\n]/)
  assert.deepEqual((await check(ws, { now })).issues.filter((issue) => issue.code === "heading-spacing"), [])
})

test("changing only blank lines neither ages a node nor outdates its parent summary", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- note\n" })
  build(ws); repo(ws)
  for (const path of ["A.md", "A/Child.md"]) put(ws.root, path, tightenHeadings(read(ws, path)))
  build(ws); commit(ws, "Tighten headings", "2026-09-30T12:00:00Z")
  const result = await review(ws, { now })
  assert.equal(result.top.summaryBehind, 0)
  assert.ok(kindsOf(result, "A/Child").includes("node-stale"))
  assert.equal((await history(ws, now)).file("A/Child.md", read(ws, "A/Child.md")).last, Date.parse("2026-06-01T12:00:00Z"))
})

test("text after a blank line under a heading becomes list items, and the check reports what is left", async () => {
  const before = "# T\nSummary.\n\nBackground\ncontinued.\n\n`path` · `main`\n\n- TODO a\n\n## Section\nOne.\n\nTwo.\n\n## Code\nText.\n\n```\ncode\n```\n"
  const after = "# T\nSummary.\n\n- Background\n  continued.\n- `path` · `main`\n- TODO a\n\n## Section\nOne.\n\n- Two.\n\n## Code\nText.\n\n```\ncode\n```\n"
  assert.equal(bulletParagraphs(before), after)
  assert.equal(bulletParagraphs(after), after)
  const ws = await workspace({ "A.md": before, "B.md": after })
  build(ws)
  const gaps = (await check(ws)).issues.filter((issue) => issue.code === "paragraph-gap")
  assert.deepEqual(gaps.map((issue) => [issue.file, issue.line]), [["A.md", 4], ["A.md", 7], ["A.md", 14], ["A.md", 19], ["B.md", 17]])
  assert.match(read(ws, "B.md"), /^# T\nSummary\.\n/)
})

test("turning paragraphs into list items neither ages a node nor outdates its parent summary", async () => {
  const ws = await workspace({ "A.md": "# A\nA.\n", "A/Child.md": "# Child\nC.\n\nBackground.\n\n`path` · `main`\n\n- note\n" })
  build(ws); repo(ws)
  put(ws.root, "A/Child.md", bulletParagraphs(read(ws, "A/Child.md")))
  build(ws); commit(ws, "Bullet paragraphs", "2026-09-30T12:00:00Z")
  const result = await review(ws, { now })
  assert.equal(result.top.summaryBehind, 0)
  assert.ok(kindsOf(result, "A/Child").includes("node-stale"))
})
