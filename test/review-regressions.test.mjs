import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { createHash } from "node:crypto"
import { build, check, find, keepCandidates, review, walkGraph } from "../src/index.mjs"
import { history } from "../src/history.mjs"
import { workspace, put, read } from "./helpers.mjs"

const now = new Date("2026-10-01T12:00:00Z")
const cliPath = resolve("bin/excudo.mjs")
const hasKind = (item, kind) => item.reasons.some((reason) => reason.kind === kind)
function git(ws, args, date) {
  const result = spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8", env: { ...process.env,
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repo(ws) {
  git(ws, ["init", "-q"])
  git(ws, ["config", "user.name", "Test User"])
  git(ws, ["config", "user.email", "test@example.invalid"])
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws, ["add", "."])
  git(ws, ["commit", "-qm", "Initial notes"], "2026-07-01T12:00:00Z")
}
function cli(ws, ...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args, "--root", ws.root], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr + result.stdout)
  return result.stdout
}

test("committed and uncommitted collapse changes do not age a node, task or parent summary", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- TODO work\n\t- detail\n" })
  build(ws); repo(ws)
  const path = "A/Child.md"
  const original = read(ws, path)
  put(ws.root, path, original.replace("- TODO work\n", "- TODO work\n  collapsed:: true\n"))
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)
  assert.equal((await history(ws, now)).file(path, read(ws, path)).dirty, false)
  git(ws, ["add", "notes"]); git(ws, ["commit", "-qm", "Fold a task"], "2026-09-30T12:00:00Z")
  const result = await review(ws, { now })
  assert.equal(result.top.summaryBehind, 0)
  assert.ok(!result.candidates.some((item) => hasKind(item, "summary-behind")))
  assert.ok(result.candidates.some((item) => item.node === "A/Child" && hasKind(item, "node-stale")))
  assert.ok(result.candidates.some((item) => hasKind(item, "task-stale")))
  put(ws.root, path, original)
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)
  git(ws, ["add", "notes"]); git(ws, ["commit", "-qm", "Expand a task"], "2026-09-30T13:00:00Z")
  assert.equal((await review(ws, { now })).top.summaryBehind, 0)
  put(ws.root, path, original.replace("detail", "changed detail"))
  assert.equal((await check(ws, { now })).top.summaryBehind, 1)
})

test("generated-only commits do not count as authored changes, while deleted body lines do", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n\n- detail to remove\n",
    "A/Child/Leaf.md": "# Leaf\n\nL.\n" })
  build(ws); repo(ws)
  put(ws.root, "A/Child.md", read(ws, "A/Child.md").replace("[[Leaf]] · L.", "[[Leaf]] · display edit"))
  git(ws, ["add", "notes"]); git(ws, ["commit", "-qm", "Update display only"], "2026-09-30T12:00:00Z")
  assert.equal((await review(ws, { now })).top.summaryBehind, 0)
  put(ws.root, "A/Child.md", read(ws, "A/Child.md").replace("- detail to remove\n", ""))
  git(ws, ["add", "notes"]); git(ws, ["commit", "-qm", "Remove a body line"], "2026-09-30T13:00:00Z")
  assert.equal((await review(ws, { now })).top.summaryBehind, 1)
})

test("continuation DEADLINE and SCHEDULED dates belong to their own task", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO expired deadline\n  DEADLINE: <2026-07-02 Thu>\n- TODO expired schedule\n  SCHEDULED: <2026-07-02 Thu>\n- TODO future parent\n  DEADLINE: <2026-12-01 Tue>\n\t- TODO expired child\n\t  DEADLINE: <2026-07-02 Thu>\n- TODO example\n  ```text\n  DEADLINE: <2026-07-02 Thu>\n  ```\n- TODO invalid\n  DEADLINE: <2026-02-30 Mon>\n" })
  const candidates = (await review(ws, { now })).candidates.filter((item) => hasKind(item, "task-overdue"))
  assert.deepEqual(candidates.map((item) => item.text), ["TODO expired deadline", "TODO expired schedule", "TODO expired child"])
  assert.ok(candidates.every((item) => item.properties.length === 1))
})

test("a changed task deadline resets task age without requiring its title to change", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO work\n  DEADLINE: <2026-07-02 Thu>\n" })
  repo(ws)
  assert.ok((await review(ws, { now })).candidates.some((item) => hasKind(item, "task-stale")))
  put(ws.root, "A.md", read(ws, "A.md").replace("2026-07-02 Thu", "2026-12-01 Tue"))
  const candidates = (await review(ws, { now })).candidates
  assert.ok(!candidates.some((item) => hasKind(item, "task-stale") || hasKind(item, "task-overdue")))
})

test("identical task occurrences get separate ids and independent keep decisions", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n\n- TODO same request\n  DEADLINE: <2026-07-02 Thu>\n- TODO same request\n  DEADLINE: <2026-07-02 Thu>\n" })
  repo(ws)
  const tasks = (await review(ws, { now })).candidates.filter((item) => item.scope === "line")
  assert.equal(tasks.length, 2)
  assert.notEqual(tasks[0].id, tasks[1].id)
  assert.ok(tasks.every((item) => hasKind(item, "task-overdue") && hasKind(item, "task-stale")))
  await keepCandidates(ws, [tasks[0].id], { now })
  const remaining = (await review(ws, { now })).candidates.filter((item) => item.scope === "line")
  assert.deepEqual(remaining.map((item) => item.id), [tasks[1].id])
  // Adding unrelated earlier lines does not invalidate the occurrence's decision.
  put(ws.root, "A.md", read(ws, "A.md").replace("A.\n", "A.\n\n## Requests\n"))
  assert.deepEqual((await review(ws, { now })).candidates.filter((item) => item.scope === "line").map((item) => item.id), [tasks[1].id])
})

test("one reference question combines reasons and accepts a reason id as a grouped keep", async () => {
  const ws = await workspace({ "Reference.md": "# Reference\n\nA reusable method.\n" })
  const first = await review(ws, { now })
  assert.equal(first.candidates.length, 1)
  assert.deepEqual(first.candidates[0].reasons.map((reason) => reason.kind), ["top-inactive", "node-idle"])
  assert.match(first.candidates[0].recommendation, /Ask.*keep/i)
  assert.equal(first.stats.questions, 1)
  assert.equal(first.stats.mergedReasons, 1)
  await keepCandidates(ws, [first.candidates[0].reasons[1].id], { now })
  const second = await review(ws, { now })
  assert.equal(second.candidates.length, 0)
  assert.equal(second.stats.suppressedQuestions, 1)
  assert.equal((await review(ws, { now: new Date("2027-02-01T12:00:00Z") })).candidates.length, 1)
  put(ws.root, "Reference.md", read(ws, "Reference.md").replace("reusable", "updated"))
  assert.equal((await review(ws, { now })).candidates.length, 1)
})

test("visible Home rows follow expansion choices and preserve lookup to folded descendants", async () => {
  const ws = await workspace({ "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n",
    "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n", "A/Child/Leaf.md": "# Leaf\n\nSearchable zebra detail.\n", "B.md": "# B\n\nB.\n" })
  build(ws)
  assert.equal((await check(ws)).top.visibleLines, 2)
  put(ws.root, "Home.md", read(ws, "Home.md").replace("  collapsed:: true\n", ""))
  assert.equal((await check(ws)).top.visibleLines, 3)
  put(ws.root, "Home.md", read(ws, "Home.md").replace("\t  collapsed:: true\n", ""))
  assert.equal((await check(ws)).top.visibleLines, 4)
  assert.ok(find(ws, "zebra").matches.some((item) => item.path === "A/Child/Leaf.md"))
})

test("CLI interview batch applies keep, move and reschedule, saves separately and reverts the entire batch", async () => {
  const ws = await workspace({ "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n",
    "projects/Active.md": "# Active\n\nCurrent work.\n\n- TODO active work\n",
    "projects/Reference.md": "# Reference\n\nReusable zebra method.\n",
    "projects/Reference/Method.md": "# Method\n\nDetailed method.\n",
    "projects/Keep.md": "# Keep\n\nFrequently used reference.\n",
    "projects/Dates.md": "# Dates\n\nRequests.\n\n- TODO draft\n  DEADLINE: <2026-07-02 Thu>\n" })
  build(ws); repo(ws)
  put(ws.root, "projects/Active.md", read(ws, "projects/Active.md").replace("Current work.", "Current work and owner update."))
  put(ws.root, "projects/Reference/Method.md", read(ws, "projects/Reference/Method.md").replace("Detailed method.", "Owner's detailed method."))
  const priorReview = '{"kept":{"owner-choice":{"at":"2026-09-01T12:00:00Z"}}}\n'
  writeFileSync(join(ws.root, "review.json"), priorReview)
  cli(ws, "snapshot")
  const snapshot = git(ws, ["rev-parse", "HEAD"])
  const before = new Map(walkGraph(ws).pages.map((page) => [page.rel, readFileSync(page.path, "utf8")]))
  const questions = JSON.parse(cli(ws, "review", "--json")).candidates
  const kept = questions.find((item) => item.node === "projects/Keep" && item.scope === "node")
  const moved = questions.find((item) => item.node === "projects/Reference" && item.scope === "node")
  const rescheduled = questions.find((item) => item.node === "projects/Dates" && hasKind(item, "task-overdue"))
  assert.ok(kept && moved && rescheduled)
  assert.ok(hasKind(kept, "top-inactive") && hasKind(kept, "node-idle"))
  // Fixture answers: keep this reference, move that method below Active, reschedule the request.
  cli(ws, "review", "keep", kept.id)
  cli(ws, "move", "Reference", "Active")
  put(ws.root, "projects/Dates.md", read(ws, "projects/Dates.md").replace("2026-07-02 Thu", "2027-12-01 Wed"))
  put(ws.root, "projects/Active.md", read(ws, "projects/Active.md").replace("Current work and owner update.", "Current work, owner update and reusable method."))
  cli(ws, "save", "Keep reference, file method and reschedule request")
  const batch = git(ws, ["rev-parse", "HEAD"])
  assert.notEqual(batch, snapshot)
  assert.equal(git(ws, ["rev-parse", "HEAD^"]), snapshot)
  const files = git(ws, ["show", "--format=", "--name-only", "HEAD"])
  assert.match(files, /review\.json/)
  assert.match(files, /notes\/projects\/Active\/Reference\.md/)
  const remaining = JSON.parse(cli(ws, "review", "--json")).candidates
  assert.ok(!remaining.some((item) => item.id === kept.id || item.id === rescheduled.id))
  assert.ok(!remaining.some((item) => item.node === "projects/Reference"))
  assert.ok(find(ws, "zebra").matches.some((item) => item.path === "projects/Active/Reference.md"))
  assert.equal((await check(ws)).top.count, 3)
  git(ws, ["revert", "--no-edit", batch])
  assert.equal(readFileSync(join(ws.root, "review.json"), "utf8"), priorReview)
  const after = new Map(walkGraph(ws).pages.map((page) => [page.rel, readFileSync(page.path, "utf8")]))
  assert.deepEqual(after, before)
  assert.match(read(ws, "projects/Active.md"), /owner update/)
  assert.ok(JSON.parse(cli(ws, "review", "--json")).candidates.some((item) => item.id === kept.id))
  assert.equal(build(ws).blocked.length, 0, "cache state must not block the restored generated output")
})

test("task continuation reasons are grouped and shared deadline properties are not duplicates", async () => {
  const ws = await workspace({
    "A.md": "# A\n\nA.\n\n- TODO first request\n  DEADLINE: <2026-07-02 Thu>\n  Awaiting an answer #check\n",
    "B.md": "# B\n\nB.\n\n- TODO different request\n  DEADLINE: <2026-07-02 Thu>\n",
  })
  const candidates = (await review(ws, { now })).candidates
  assert.ok(!candidates.some((item) => hasKind(item, "duplicate")))
  const first = candidates.filter((item) => item.node === "A" && item.scope === "line")
  assert.equal(first.length, 1)
  assert.ok(hasKind(first[0], "task-overdue") && hasKind(first[0], "check-pile"))
  await keepCandidates(ws, [first[0].id], { now })
  assert.ok(!(await review(ws, { now })).candidates.some((item) => item.node === "A" && item.scope === "line"))
})

test("separate width and summary warnings remain as two reasons in the same question", async () => {
  const ws = await workspace({ "A.md": `# A\n\n${"long summary ".repeat(8).trim()}\n`, "B.md": "# B\n\nB.\n" }, { widthMax: 1 })
  const group = (await review(ws, { now })).candidates.find((item) => item.node === "A")
  const warnings = group.reasons.filter((reason) => reason.kind === "top-warning")
  assert.equal(warnings.length, 2)
  assert.notEqual(warnings[0].id, warnings[1].id)
})

test("unambiguous legacy keep ids remain honored but ambiguous identical tasks are reviewed", async () => {
  const reference = "# Reference\n\nUseful method.\n"
  const ws = await workspace({ "Reference.md": reference,
    "A.md": "# A\n\nA.\n\n- TODO same 2026-07-02\n- TODO same 2026-07-02\n" })
  const legacyId = (node, kind, text, body = "") => `${node}:${kind}:${createHash("sha256").update(`${text}\n\n${body}`).digest("hex").slice(0, 16)}`
  const refId = legacyId("Reference", "node-idle", reference, reference)
  const taskId = legacyId("A", "task-overdue", "TODO same 2026-07-02")
  writeFileSync(join(ws.root, "review.json"), JSON.stringify({ kept: { [refId]: { at: now.toISOString() }, [taskId]: { at: now.toISOString() } } }))
  const result = await review(ws, { now })
  assert.ok(!result.candidates.some((item) => item.node === "Reference"))
  assert.equal(result.candidates.filter((item) => hasKind(item, "task-overdue")).length, 2)
})

test("a merged body update is dated from the merge and is clean against HEAD", async () => {
  const ws = await workspace({ "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nOriginal summary.\n" })
  repo(ws)
  const main = git(ws, ["branch", "--show-current"])
  git(ws, ["checkout", "-qb", "body-update"])
  put(ws.root, "A/Child.md", read(ws, "A/Child.md").replace("Original", "Changed"))
  git(ws, ["add", "notes"]); git(ws, ["commit", "-qm", "Change body"], "2026-08-01T12:00:00Z")
  git(ws, ["checkout", "-q", main])
  git(ws, ["merge", "--no-ff", "-qm", "Merge body update", "body-update"], "2026-09-30T12:00:00Z")
  const file = (await history(ws, now)).file("A/Child.md", read(ws, "A/Child.md"))
  assert.equal(file.dirty, false)
  assert.equal(file.last, new Date("2026-09-30T12:00:00Z").getTime())
  assert.equal((await review(ws, { now })).top.summaryBehind, 1)
})
