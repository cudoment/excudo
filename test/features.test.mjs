import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { archive, build, check, commitGraph, find, keepCandidates, loadWorkspace, move, remove, renderTree, review } from "../src/index.mjs"
import { legacyReasonId, subtreeFingerprint } from "../src/keeps.mjs"
import { plain } from "../src/tree.mjs"
import { prepare } from "../src/build.mjs"
import { tempDir, workspace, put, read } from "./helpers.mjs"

function git(root, args, date) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env,
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repo(ws, date = "2026-07-01T12:00:00Z") {
  git(ws.root, ["init", "-q"])
  git(ws.root, ["config", "user.name", "Test User"])
  git(ws.root, ["config", "user.email", "test@example.invalid"])
  git(ws.root, ["add", "."])
  git(ws.root, ["commit", "-qm", "Initial notes"], date)
}
const now = new Date("2026-10-01T12:00:00Z")
const hasKind = (item, kind) => item.reasons.some((reason) => reason.kind === kind)
async function messy(date) {
  const root = tempDir()
  cpSync(new URL("fixtures/messy", import.meta.url), root, { recursive: true })
  const ws = await loadWorkspace({ root }); repo(ws, date)
  put(root, "projects/Current/Detail.md", "# Detail\n\nThe feature now includes another step.\n\n- TODO current work\n")
  git(root, ["add", "notes"]); git(root, ["commit", "-qm", "Update detail"], "2026-09-30T12:00:00Z")
  return ws
}

test("review covers every candidate kind, orders top candidates first and is deterministic", async () => {
  const ws = await messy()
  const first = await review(ws, { now })
  assert.deepEqual(first, await review(ws, { now }))
  assert.equal(first.ageAvailable, true)
  const kinds = new Set(first.candidates.flatMap((item) => item.reasons.map((reason) => reason.kind)))
  for (const kind of ["top-warning", "summary-behind", "top-inactive", "node-idle", "node-body-long", "task-overdue", "task-stale", "node-stale", "check-pile", "idea-old", "duplicate", "journal-old"]) assert.ok(kinds.has(kind), kind)
  assert.equal(first.candidates[0].kind, "top-warning")
  assert.equal(first.top.count, 3)
  assert.equal(first.top.summaryBehind, 1)
  assert.equal(first.top.doing, 3)
  assert.ok((await check(ws, { now })).issues.some((issue) => issue.code === "doing-wide"))
  assert.equal((await review(ws, { now, limit: 2 })).candidates.length, 2)
  assert.ok((await review(ws, { now, node: "Old" })).candidates.every((item) => item.node === "projects/Old"))
  assert.ok(first.candidates.every((item) => item.id.split(":").length === 3 && item.evidence && item.recommendation))
})

test("short git history omits ages but still finds an outdated summary and overdue tasks", async () => {
  const ws = await messy("2026-09-29T12:00:00Z")
  const result = await review(ws, { now })
  assert.equal(result.ageAvailable, false)
  assert.ok(result.notice)
  for (const kind of ["task-stale", "node-stale", "idea-old", "journal-old"]) assert.ok(!result.candidates.some((item) => hasKind(item, kind)))
  assert.ok(result.candidates.some((item) => hasKind(item, "summary-behind")))
  assert.ok(result.candidates.some((item) => hasKind(item, "task-overdue")))
  put(ws.root, "projects/Current/Detail.md", "# Detail\n\nUncommitted change.\n\n- TODO work\n")
  assert.equal((await check(ws, { now })).top.summaryBehind, 1)
})

test("a kept outdated summary is no longer counted in the first-list status until its subtree changes again", async () => {
  const ws = await messy()
  const behind = (await review(ws, { now })).candidates.filter((item) => hasKind(item, "summary-behind"))
  await keepCandidates(ws, behind.map((item) => item.id), { now })
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)
  assert.equal((await review(ws, { now })).top.summaryBehind, 0)
  put(ws.root, "projects/Current/Detail.md", "# Detail\n\nAnother change.\n\n- TODO current work\n")
  assert.equal((await check(ws, { now })).top.summaryBehind, 1)
})

test("a summary kept under an id from an earlier version is not counted either", async () => {
  const ws = await messy()
  const { model } = prepare(ws)
  const ids = (await review(ws, { now })).candidates.filter((item) => hasKind(item, "summary-behind")).map((item) => model.find(item.node))
  const kept = Object.fromEntries(ids.map((id) => {
    const doc = model.docs.get(id)
    return [legacyReasonId(ws, doc, "summary-behind", plain(doc.tree.children[1]), subtreeFingerprint(ws, model, doc)), { at: now.toISOString() }]
  }))
  writeFileSync(join(ws.root, "review.json"), JSON.stringify({ kept }))
  assert.equal((await review(ws, { now })).candidates.filter((item) => hasKind(item, "summary-behind")).length, 0)
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)
})

test("review keep hides a candidate until its content changes or keepDays expires", async () => {
  const ws = await messy()
  const candidate = (await review(ws, { now })).candidates.find((item) => hasKind(item, "node-idle"))
  await keepCandidates(ws, [candidate.id], { now })
  assert.ok(!(await review(ws, { now })).candidates.some((item) => item.id === candidate.id))
  const expired = new Date(now.getTime() + 91 * 86400000)
  assert.ok((await review(ws, { now: expired })).candidates.some((item) => item.id === candidate.id))
  put(ws.root, "projects/Reference.md", read(ws, "projects/Reference.md").replace("both versions", "all versions"))
  assert.ok((await review(ws, { now })).candidates.some((item) => hasKind(item, "node-idle") && item.id !== candidate.id))
  await assert.rejects(keepCandidates(ws, ["missing"]), /Unknown review/)
})

test("meta nodes go last without explicit order and do not count toward width; tree path retains summaries", async () => {
  const ws = await workspace({
    "Done.md": "# Done\n\nFinished.\n", "Record.md": "# Record\n\nHistory.\n",
    "projects/Z.md": "# Z\n\nWork.\n", "projects/Z/Child.md": "# Child\n\nDetails.\n",
  }, { widthMax: 1 })
  assert.equal((await check(ws)).top.count, 1)
  assert.ok(!(await check(ws)).issues.some((item) => item.code === "list-wide"))
  assert.match(renderTree(ws), /\[\[Z\]\][\s\S]*\[\[Done\]\][\s\S]*\[\[Record\]\]/)
  assert.equal(renderTree(ws, { path: "Child" }), "- [[Z]] · Work.\n\t- [[Child]] · Details.")
})

test("move carries descendants and links, rejects cycles and collisions, and can promote a node", async () => {
  const ws = await workspace({ "projects/A.md": "# A\n\nA.\n", "projects/A/Child.md": "# Child\n\nC.\n",
    "projects/B.md": "# B\n\nB. [[Child]]\n" })
  await assert.rejects(move(ws, "A", "Child"), /below itself/)
  assert.equal((await move(ws, "A", "B")).to, "projects/B/A.md")
  assert.ok(existsSync(join(ws.graphDir, "projects/B/A/Child.md")))
  assert.match(read(ws, "projects/B.md"), /\[\[Child\]\]/)
  assert.equal(build(ws).errors.length, 0)
  assert.match(renderTree(ws), /\[\[B\]\][\s\S]*\t- \[\[A\]\][\s\S]*\t\t- \[\[Child\]\]/)
  assert.equal((await move(ws, "A", "projects/")).top.count, 2)
  await assert.rejects(move(ws, "A", "../"), /Unknown parent/)
})

test("remove protects tasks and decisions below a node and returns remaining link locations", async () => {
  const ws = await workspace({ "projects/A.md": "# A\n\nA.\n", "projects/A/Child.md": "# Child\n\nC.\n\n- TODO work\n- Decision: retain method\n",
    "projects/B.md": "# B\n\nB.\n\n- See [[child]]\n" })
  assert.throws(() => remove(ws, "A"), /open tasks or decisions/)
  const result = remove(ws, "A", { force: true })
  assert.equal(result.removed.length, 2)
  assert.deepEqual(result.links.map((hit) => [hit.path, hit.line]), [["projects/B.md", 5]])
  assert.ok(!existsSync(join(ws.graphDir, "projects/A")))
})

test("monthly archives retain all DONE lines, pick the date of arrival via blame, and stay collapsed", async () => {
  const ws = await workspace({ "Done.md": "# Done\n\nFinished.\n\n- DONE September work\n",
    "projects/A.md": "# A\n\nA.\n\n- DONE October work\n", "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n```\n" }, { doneKeep: 0, widthMax: 1 })
  repo(ws, "2026-09-15T12:00:00Z")
  const result = await archive(ws, { now })
  assert.equal(result.removed, 2)
  assert.match(read(ws, "Done/Done 2026/Done 2026-09.md"), /- DONE September work/)
  assert.match(read(ws, "Done/Done 2026/Done 2026-10.md"), /- DONE A · October work/)
  assert.equal((await archive(ws, { now })).removed, 0)
  assert.equal(build(ws).errors.length, 0)
  assert.match(read(ws, "Home.md"), /\[\[Done 2026\]\].*\n\t  collapsed:: true/)
  assert.ok(!(await check(ws)).issues.some((issue) => issue.code === "list-wide"))
  const found = find(ws, "work")
  assert.equal(found.matches.filter((item) => /^- DONE/.test(item.text)).length, 2)
})

test("archive node rejects open descendants and preserves a finished node subtree", async () => {
  const ws = await workspace({ "projects/A.md": "# A\n\nA.\n", "projects/A/Child.md": "# Child\n\nC.\n\n- TODO work\n" })
  await assert.rejects(archive(ws, { node: "A", now }), /open tasks/)
  put(ws.root, "projects/A/Child.md", "# Child\n\nC.\n\n- DONE work\n")
  await archive(ws, { node: "A", now })
  assert.ok(existsSync(join(ws.graphDir, "Done/Done 2026/Done 2026-10/A/Child.md")))
  assert.match(read(ws, "Done/Done 2026/Done 2026-10.md"), /1 nodes/)
})

test("find returns current lines and deleted lines with commit/date through git -S", async () => {
  const ws = await workspace({ "projects/A.md": "# A\n\nA useful reference.\n\n- TODO obsolete zebra detail\n" })
  repo(ws)
  put(ws.root, "projects/A.md", "# A\n\nA useful reference.\n")
  git(ws.root, ["add", "notes"]); git(ws.root, ["commit", "-qm", "Remove old detail"], "2026-09-30T12:00:00Z")
  assert.equal(find(ws, "useful").matches[0].line, 3)
  const result = find(ws, "zebra", { history: true })
  assert.equal(result.matches.length, 0)
  assert.equal(result.history.length, 1)
  assert.match(result.history[0].commit, /^[0-9a-f]{40}$/)
  assert.equal(result.history[0].path, "notes/projects/A.md")
  assert.equal(result.history[0].line, 5)
})

test("save commit scope includes review.json and leaves unrelated staged changes alone", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n" }); repo(ws)
  writeFileSync(join(ws.root, "unrelated.txt"), "untouched\n"); git(ws.root, ["add", "unrelated.txt"])
  const candidate = (await review(ws, { now })).candidates[0]
  await keepCandidates(ws, [candidate.id], { now })
  assert.equal(commitGraph(ws, "Keep reference", { includeReview: true }), "committed")
  assert.equal(git(ws.root, ["show", "--format=", "--name-only", "HEAD"]), "review.json")
  assert.match(git(ws.root, ["status", "--porcelain"]), /A  unrelated.txt/)
})

test("NFD paths work for review ids, moves, tree paths, archives and remove", async () => {
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace({ [nfd("projects/개발.md")]: "# 개발\n\n요약.\n",
    [nfd("projects/개발/참고.md")]: "# 참고\n\n나중에 읽을 내용.\n", [nfd("projects/본인.md")]: "# 본인\n\n요약.\n" }, { locale: "ko" })
  assert.ok((await review(ws, { now })).candidates.every((item) => item.id === item.id.normalize("NFC")))
  await move(ws, "참고", "본인")
  assert.match(renderTree(ws, { path: "참고" }), /\[\[본인\]\][\s\S]*\[\[참고\]\]/)
  await archive(ws, { node: "참고", now })
  assert.ok(find(ws, "나중에").matches.length)
  remove(ws, "참고")
  assert.equal((await check(ws)).issues.filter((issue) => issue.severity === "error").length, 0)
})

test("overdue candidates recognize ISO, SCHEDULED, M/D and Korean dates, skipping invalid dates and code", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO ISO 2026-07-02\n- TODO SCHEDULED: <2026-07-02 Thu>\n- TODO short 7/2\n- TODO Korean 7월 2일\n- TODO invalid 2026-02-30\n\n## Code\n\n```text\n- TODO code 2026-07-02\n```\n" })
  const candidates = (await review(ws, { now })).candidates.filter((item) => item.kind === "task-overdue")
  assert.equal(candidates.length, 4)
  assert.deepEqual(candidates.map((item) => item.line), [5, 6, 7, 8])
})

test("git age detection and history search work with NFD Korean file names", async () => {
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace({ [nfd("projects/계획.md")]: "# 계획\n\n현재 계획입니다.\n\n- TODO old zebra note\n" }, { locale: "ko" })
  repo(ws)
  assert.ok((await review(ws, { now })).candidates.some((item) => item.kind === "task-stale" && item.node === "projects/계획"))
  put(ws.root, nfd("projects/계획.md"), "# 계획\n\n현재 계획입니다.\n")
  git(ws.root, ["add", "notes"]); git(ws.root, ["commit", "-qm", "Remove detail"], "2026-09-30T12:00:00Z")
  assert.equal(find(ws, "zebra", { history: true }).history[0].path, "notes/projects/계획.md")
})
