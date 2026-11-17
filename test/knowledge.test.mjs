import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { build, changes, check, commitGraph, ingest, keepCandidates, listSources, markChanges, prepare, review, sourceScript, withLock } from "../src/index.mjs"
import { nodeSubject, questionId, subtreeFingerprint } from "../src/keeps.mjs"
import { tempDir, workspace } from "./helpers.mjs"

const git = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repository() {
  const dir = tempDir("excudo-repo-")
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(join(dir, "README.md"), "# Project\n")
  git(dir, "add", ".")
  git(dir, "commit", "-qm", "Start")
  return dir
}
const notice = (id, title) => ({ id, title, url: `https://news.example.com/t/${id}` })
const nodes = {
  "projects/Project.md": "# Project\nThe project.\n",
  "Knowledge.md": "# Knowledge\nWhat agents keep from sources.\n",
  "Knowledge/Topic.md": "# Topic\nA cross-cutting topic.\n",
  "Knowledge/News.md": "# News\nNotices from the news board.\n",
}

test("a repository source reports commits and uncommitted changes since its last mark, with scan-compatible fingerprints", async () => {
  const repo = repository()
  const ws = await workspace(nodes, { sources: [{ name: "project", kind: "repo", path: repo, node: "Project" }] })
  const at = new Date(2026, 9, 13, 9)
  assert.equal(changes(ws)[0].status, "new")
  markChanges(ws, ["project"], { now: at })
  const head = git(repo, "rev-parse", "HEAD")
  const empty = createHash("sha256").update("").digest("hex").slice(0, 12)
  const state = JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8")).project.watch
  assert.deepEqual([state.mode, state.fingerprint, state.branch, state.markedAt], ["git", `${head.slice(0, 12)}+${empty}`, "main", at.toISOString()])
  assert.equal(changes(ws)[0].status, "same")

  writeFileSync(join(repo, "notes.md"), "draft\n")
  let [result] = changes(ws)
  assert.deepEqual([result.status, result.detail.commits, result.detail.dirty, result.detail.range], ["changed", 0, 1, undefined])
  git(repo, "add", ".")
  git(repo, "commit", "-qm", "Add notes")
  ;[result] = changes(ws)
  assert.deepEqual([result.status, result.detail.commits, result.detail.dirty], ["changed", 1, 0])
  assert.match(result.detail.range, /^[0-9a-f]{12}\.\.[0-9a-f]{12}$/)

  // A mark written in the same format by another tool counts as the same state.
  const imported = JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8"))
  imported.project.watch = { mode: "git", head: git(repo, "rev-parse", "HEAD"), fingerprint: `${git(repo, "rev-parse", "HEAD").slice(0, 12)}+${empty}`, markedAt: at.toISOString() }
  writeFileSync(join(ws.root, "sources.json"), JSON.stringify(imported))
  assert.equal(changes(ws)[0].status, "same")
})

test("a folder source lists the files changed since its mark, and a foreign mark falls back to times and counts", async () => {
  const folder = tempDir("excudo-folder-")
  mkdirSync(join(folder, "songs"))
  mkdirSync(join(folder, "node_modules"))
  writeFileSync(join(folder, "songs", "a.md"), "a\n")
  writeFileSync(join(folder, "node_modules", "skip.js"), "x\n")
  const old = new Date(2026, 9, 1)
  utimesSync(join(folder, "songs", "a.md"), old, old)
  const ws = await workspace(nodes, { sources: [{ name: "studio", kind: "repo", path: folder, node: "Project" }] })
  markChanges(ws, ["studio"], { now: new Date(2026, 9, 2) })
  assert.equal(changes(ws)[0].status, "same")
  writeFileSync(join(folder, "node_modules", "skip.js"), "changed\n")
  assert.equal(changes(ws)[0].status, "same", "dependencies are not the project's content")
  writeFileSync(join(folder, "songs", "b.md"), "b\n")
  const [result] = changes(ws)
  assert.deepEqual([result.status, result.detail.files, result.detail.newer, result.detail.recent], ["changed", 2, 1, ["songs/b.md"]])

  const state = JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8"))
  state.studio.watch = { mode: "path", fingerprint: "a95a7eb007d9", files: 2, markedAt: new Date(Date.now() + 60000).toISOString() }
  writeFileSync(join(ws.root, "sources.json"), JSON.stringify(state))
  assert.equal(changes(ws)[0].status, "same", "no newer file and the same count")
  state.studio.watch.files = 1
  writeFileSync(join(ws.root, "sources.json"), JSON.stringify(state))
  assert.equal(changes(ws)[0].status, "changed")
})

test("a page source compares the ids its script returned, and turned-off or item sources stay out of changes", async () => {
  const sources = [
    { name: "news", kind: "page", url: "https://news.example.com/latest", node: "News", script: "() => []" },
    { name: "old", kind: "repo", path: "~/no-such-folder-excudo", node: "Project", enabled: false },
    { name: "jira", url: "https://jira.example.com" },
  ]
  const ws = await workspace(nodes, { sources })
  assert.deepEqual(changes(ws).map((item) => [item.name, item.status]), [["news", "browser"]])
  assert.deepEqual(changes(ws, { all: true }).map((item) => [item.name, item.status]), [["news", "browser"], ["old", "missing"]])
  assert.equal(changes(ws, { name: "old" })[0].path, resolve(homedir(), "no-such-folder-excudo"))
  assert.throws(() => changes(ws, { name: "jira" }), /items|항목/)
  assert.throws(() => markChanges(ws, ["news"]), /--input/)
  assert.throws(() => markChanges(ws, ["old"]), /does not exist/)
  assert.throws(() => ingest(ws, "news", []), /changes/)
  assert.match(sourceScript(ws, "news"), /"since":null/)

  const first = [notice(1, "Maintenance"), notice(2, "Release")]
  assert.equal(changes(ws, { name: "news", input: JSON.stringify(first) })[0].status, "new")
  markChanges(ws, ["news"], { input: JSON.stringify(JSON.stringify(first)), now: new Date(2026, 9, 13) })
  assert.match(sourceScript(ws, "news"), /"since":"2026-10-1\d/)
  // A new title or view count is no change; a new or removed id is.
  assert.equal(changes(ws, { name: "news", input: [notice(2, "Release v2"), notice(1, "Maintenance")] })[0].status, "same")
  const [result] = changes(ws, { name: "news", input: { items: [notice(2, "Release"), notice(3, "Outage")] } })
  assert.deepEqual([result.status, result.detail.added.map((item) => item.title), result.detail.removed.map((item) => item.title)], ["changed", ["Outage"], ["Maintenance"]])
  assert.equal(changes(ws, { name: "news", input: { version: "1.2" } })[0].status, "changed", "other JSON compares as a whole")

  const listed = listSources(ws)
  assert.deepEqual(listed.map((source) => [source.name, source.kind, source.enabled, Boolean(source.markedAt)]), [["news", "page", true, true], ["old", "repo", false, false], ["jira", "items", true, false]])
})

test("knowledge nodes are kept by agents: review skips their length, age and repeats, and check reports unknown names", async () => {
  const long = Array.from({ length: 30 }, (_, i) => `- Fact ${i} about the project.`).join("\n")
  const ws = await workspace({
    ...nodes,
    "projects/Project/Project repo.md": `# Project repo\nWhat the repository holds.\n\n${long}\n`,
    "Knowledge/Topic.md": `# Topic\nA cross-cutting topic.\n\n${long}\n- Shared line in two places.\n`,
    "projects/Plain.md": `# Plain\nThe owner's own notes.\n\n${long}\n- Shared line in two places.\n`,
  }, { knowledge: ["Knowledge", "Missing"], sources: [{ name: "project", kind: "repo", path: tempDir(), node: "Project repo" }] })
  assert.equal(build(ws).blocked.length, 0)
  const { issues } = await check(ws)
  assert.deepEqual(issues.filter((issue) => issue.code === "knowledge-missing").map((issue) => issue.message), ["Missing is listed in `knowledge`, but there is no such node."])
  const kinds = (await review(ws)).candidates.flatMap((candidate) => candidate.reasons.map((reason) => `${pagePart(candidate.node)}:${reason.kind}`))
  assert.ok(kinds.includes("Plain:node-body-long"))
  for (const node of ["Topic", "Project repo", "Knowledge"]) assert.ok(!kinds.some((kind) => kind.startsWith(`${node}:`) && /body-long|idle|stale|duplicate/.test(kind)), node)
  assert.ok(!kinds.includes("Plain:duplicate"), "a line repeated only in knowledge is no duplicate")
  await assert.rejects(check(await workspace(nodes, { knowledge: "Knowledge" })), /list of node names/)
})

const pagePart = (id) => id.split("/").at(-1)

test("reflect.json and the settings travel with the graph, and reflect.json must stay valid JSON", async () => {
  const ws = await workspace(nodes)
  git(ws.root, "init", "-q", "-b", "main")
  assert.equal(build(ws).blocked.length, 0)
  writeFileSync(join(ws.root, "reflect.json"), "{ \"candidates\": {} }\n")
  writeFileSync(join(ws.root, "other.txt"), "not part of the memo\n")
  assert.equal(commitGraph(ws, "Start", { includeReview: true }), "committed")
  assert.deepEqual(git(ws.root, "show", "--name-only", "--format=", "HEAD").split("\n").filter((file) => !file.startsWith("notes/")), ["excudo.config.mjs", "reflect.json"])
  writeFileSync(join(ws.root, "reflect.json"), "{ broken\n")
  assert.ok((await check(ws)).issues.some((issue) => issue.code === "reflect-invalid" && issue.severity === "error"))
})

test("the changes command prints what changed and marks a source", async () => {
  const repo = repository()
  const ws = await workspace(nodes, { sources: [{ name: "project", kind: "repo", path: repo, node: "Project" }] })
  const cli = (...args) => spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "--root", ws.root, ...args], { encoding: "utf8" })
  assert.match(cli("changes").stdout, /^\+ project → Project: never marked/m)
  assert.match(cli("changes", "mark", "project").stdout, /Marked: project/)
  writeFileSync(join(repo, "more.md"), "more\n")
  git(repo, "add", ".")
  git(repo, "commit", "-qm", "More")
  const out = cli("changes").stdout
  assert.match(out, /^~ project → Project: 1 new commit\(s\) [0-9a-f]{12}\.\.[0-9a-f]{12}, 0 uncommitted change\(s\) on main \[[0-9a-f]{12}\+[0-9a-f]{12}~[0-9a-f]{12}\]$/m)
  assert.match(out, /^1 changed, 0 unchanged, 0 never marked, 0 to read in a browser, 0 missing\.$/m)
  assert.match(cli("sources").stdout, /^project \(project\) · repo · .+ → Project · last marked 20/m)
})

test("an uncommitted file edited again, a same-size edit and a removed file all count as changes", async () => {
  const repo = repository()
  writeFileSync(join(repo, "README.md"), "# Project, edited\n")
  const folder = tempDir("excudo-folder-")
  writeFileSync(join(folder, "a.md"), "aaaa\n")
  writeFileSync(join(folder, "b.md"), "bbbb\n")
  const ws = await workspace(nodes, { sources: [
    { name: "project", kind: "repo", path: repo, node: "Project" },
    { name: "studio", kind: "repo", path: folder, node: "Project" },
  ] })
  markChanges(ws, ["project"])
  markChanges(ws, ["studio"])
  writeFileSync(join(repo, "README.md"), "# Project, edited twice\n")
  const [project] = changes(ws, { name: "project" })
  assert.deepEqual([project.status, project.detail.edited, project.previous === project.current], ["changed", true, true])

  const stat = (file) => readFileSync(join(folder, file))
  writeFileSync(join(folder, "a.md"), "AAAA\n")
  const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 500)
  utimesSync(join(folder, "a.md"), at, at)
  rmSync(join(folder, "b.md"))
  writeFileSync(join(folder, "c.md"), "c\n")
  const [studio] = changes(ws, { name: "studio" })
  // Alone: a same-size edit within the same second.
  const quiet = tempDir("excudo-folder-")
  writeFileSync(join(quiet, "a.md"), "aaaa\n")
  const before = statSync(join(quiet, "a.md")).mtimeMs
  const same = { ...ws, sources: [{ name: "quiet", kind: "repo", path: quiet, node: "Project" }] }
  markChanges(same, ["quiet"])
  writeFileSync(join(quiet, "a.md"), "bbbb\n")
  const nudged = new Date(Math.floor(before / 1000) * 1000 + (Math.floor(before % 1000) + 500) % 1000)
  utimesSync(join(quiet, "a.md"), nudged, nudged)
  assert.equal(changes(same, { name: "quiet" })[0].status, "changed")
  assert.equal(stat("a.md").toString(), "AAAA\n")
  assert.deepEqual([studio.status, studio.detail.added.shown, studio.detail.modified.shown, studio.detail.removed.shown], ["changed", ["c.md"], ["a.md"], ["b.md"]])
})

test("an edit inside a repository nested in a watched one counts as a change", async () => {
  const repo = repository()
  const inner = join(repo, "vendor")
  mkdirSync(inner)
  git(inner, "init", "-q", "-b", "main")
  writeFileSync(join(inner, "lib.md"), "v1\n")
  git(inner, "add", ".")
  git(inner, "commit", "-qm", "Start")
  writeFileSync(join(inner, "lib.md"), "v2\n")
  const ws = await workspace(nodes, { sources: [{ name: "project", kind: "repo", path: repo, node: "Project" }] })
  markChanges(ws, ["project"])
  assert.equal(changes(ws, { name: "project" })[0].status, "same")
  writeFileSync(join(inner, "lib.md"), "v3, longer\n")
  assert.equal(changes(ws, { name: "project" })[0].status, "changed")
})

test("marking checks that the source is still in the state that was read, and state updates wait for each other", async () => {
  const repo = repository()
  const ws = await workspace(nodes, { sources: [{ name: "project", kind: "repo", path: repo, node: "Project" }] })
  const read = changes(ws)[0].token
  writeFileSync(join(repo, "late.md"), "arrived after reading\n")
  assert.throws(() => markChanges(ws, ["project"], { expect: read }), /changed again since it was read/)
  markChanges(ws, ["project"], { expect: changes(ws)[0].token })
  assert.equal(changes(ws)[0].status, "same")
  const file = join(tempDir(), "state.json")
  assert.equal(withLock(file, () => withLock(`${file}.other`, () => "inner", "busy"), "busy"), "inner")
  assert.throws(() => withLock(file, () => withLock(file, () => "never", "busy", { wait: 100 }), "busy"), /busy/)
})

test("a knowledge node added or updated below an owner's node does not make the owner's summary outdated", async () => {
  const ws = await workspace({ "projects/Project.md": "# Project\nThe owner's summary.\n\n- TODO ship it\n" },
    { sources: [{ name: "project", kind: "repo", path: tempDir(), node: "Project repo" }] })
  const commit = (message, date) => {
    for (const args of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", message]])
      assert.equal(spawnSync("git", ["-C", ws.root, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).status, 0)
  }
  spawnSync("git", ["-C", ws.root, "init", "-q"])
  assert.equal(build(ws).blocked.length, 0)
  commit("Start", "2026-09-01T12:00:00Z")
  mkdirSync(join(ws.graphDir, "projects", "Project"))
  writeFileSync(join(ws.graphDir, "projects", "Project", "Project repo.md"), "# Project repo\nWhat the repository holds.\n")
  assert.equal(build(ws).blocked.length, 0)
  commit("Knowledge", "2026-09-10T12:00:00Z")
  const kinds = async () => (await review(ws, { now: new Date("2026-09-11T12:00:00Z") })).candidates.flatMap((candidate) => candidate.reasons.map((reason) => `${candidate.node.split("/").at(-1)}:${reason.kind}`))
  assert.ok(!(await kinds()).includes("Project:summary-behind"))
  writeFileSync(join(ws.graphDir, "projects", "Project", "Plan.md"), "# Plan\nThe owner's plan.\n")
  assert.equal(build(ws).blocked.length, 0)
  commit("Owner's child", "2026-09-10T13:00:00Z")
  assert.ok((await kinds()).includes("Project:summary-behind"), "an owner's child still counts")
})

test("a kept summary stays kept when a knowledge node below it changes, including a keep recorded with knowledge in its fingerprint", async () => {
  const ws = await workspace({
    "projects/Project.md": "# Project\nThe owner's summary.\n\n- TODO ship it\n",
    "projects/Project/Plan.md": "# Plan\nThe owner's plan.\n",
    "projects/Project/Project repo.md": "# Project repo\nWhat the repository holds.\n",
  }, { sources: [{ name: "project", kind: "repo", path: tempDir(), node: "Project repo" }] })
  const commit = (message, date) => {
    for (const args of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", message]])
      assert.equal(spawnSync("git", ["-C", ws.root, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).status, 0)
  }
  const edit = (rel, [from, to], message, date) => {
    const path = join(ws.graphDir, "projects", rel)
    writeFileSync(path, readFileSync(path, "utf8").replace(from, to))
    assert.equal(build(ws).blocked.length, 0)
    commit(message, date)
  }
  const now = new Date("2026-09-20T12:00:00Z")
  const project = async () => (await review(ws, { now })).candidates.filter((candidate) => candidate.node === "projects/Project")
  spawnSync("git", ["-C", ws.root, "init", "-q"])
  assert.equal(build(ws).blocked.length, 0)
  commit("Start", "2026-09-01T12:00:00Z")
  edit("Project/Plan.md", ["The owner's plan.", "The owner's plan, now in two steps."], "Plan", "2026-09-10T12:00:00Z")
  const [question] = await project()
  assert.deepEqual(question.reasons.map((reason) => reason.kind), ["summary-behind"])
  assert.equal(await keepCandidates(ws, [question.id], { now }), 1)

  edit("Project/Project repo.md", ["What the repository holds.", "What the repository holds, updated from its source."], "Knowledge", "2026-09-11T12:00:00Z")
  assert.deepEqual(await project(), [], "an agent's knowledge update does not reopen the owner's answer")
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)

  // A keep recorded before knowledge nodes left the fingerprint names the whole subtree.
  const { model } = prepare(ws)
  const doc = model.docs.get(model.find("Project"))
  const node = doc.id.normalize("NFC")
  const before = questionId(node, "node", `${node}|node|${nodeSubject(ws, doc)}`, subtreeFingerprint(ws, model, doc))
  writeFileSync(join(ws.root, "review.json"), `${JSON.stringify({ kept: { [before]: { at: now.toISOString() } } })}\n`)
  assert.deepEqual(await project(), [])
  assert.equal((await check(ws, { now })).top.summaryBehind, 0)

  edit("Project/Plan.md", ["now in two steps", "in three steps"], "Plan again", "2026-09-12T12:00:00Z")
  assert.equal((await project()).length, 1, "an owner's child still reopens it")
})
