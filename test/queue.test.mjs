import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { backupRecords, build, changes, loadWorkspace, markChanges, queueItems, queueReport, recordRun, runRecords } from "../src/index.mjs"
import { put, read, tempDir, workspace } from "./helpers.mjs"

const site = "# Site\nThe website.\n\n## Workspace\n`/work/site` · `main`\n\n- Decision: write every page in plain words\n- TODO Check the links on the new pages #agent\n\t- only the guides\n- TODO Ship the redesign\n"
const nodes = {
  "projects.md": "# projects\nWork.\n\n- Decision: never push without a review\n",
  "projects/Site.md": site,
  "journals/2026_10_16.md": "- TODO Draft the release note [[agent]]\n",
}

test("tasks tagged for agents are queued with their node, work folder, decisions and notes", async () => {
  const ws = await workspace(nodes, { locale: "en" })
  const items = queueItems(ws)
  assert.equal(items.length, 2)
  const [journal, task] = items.sort((a, b) => a.file.localeCompare(b.file))
  assert.deepEqual({ ...task, key: undefined, stamp: undefined }, { key: undefined, stamp: undefined, status: "ready", file: "projects/Site.md", line: 8, task: "TODO Check the links on the new pages #agent",
    title: "Check the links on the new pages", node: "Site", summary: "The website.", folder: "/work/site",
    decisions: ["Decision: write every page in plain words", "Decision: never push without a review"], notes: ["only the guides"], report: null })
  assert.match(task.key, /^q-[0-9a-f]{10}$/)
  // A task in a journal is queued too, without a node; untagged tasks and other tags are not.
  assert.equal(journal.title, "Draft the release note")
  assert.equal(journal.node, null)
  // The key follows the task, not its line.
  put(ws.root, "projects/Site.md", site.replace("- Decision", "- Note: moved down\n- Decision"))
  assert.equal(queueItems(ws).find((item) => item.file === "projects/Site.md").key, task.key)
})

test("a report waits under its task until the owner writes below it, and nothing is marked done", async () => {
  const ws = await workspace(nodes, { locale: "en" })
  const [task] = queueItems(ws).filter((item) => item.node === "Site")
  const report = join(tempDir(), "report.md")
  writeFileSync(report, "# Links\nTwo links are broken.\n")
  const at = queueReport(ws, task.key, { summary: "Two links on the guides are broken", file: report })
  assert.equal(at.file, "projects/Site.md")
  const text = read(ws, "projects/Site.md")
  assert.match(text, /- TODO Check the links on the new pages #agent\n\t- only the guides\n\t- WAITING Review: Two links on the guides are broken \[report\]\(file:\/\/.+report\.md\)\n- TODO Ship the redesign/)
  assert.equal(queueItems(ws).find((item) => item.key === task.key).status, "waiting")
  // The owner answers below the report: the task is ready again, for the next run to follow up.
  put(ws.root, "projects/Site.md", text.replace("report.md)\n", "report.md)\n\t- fix them in the guides only\n"))
  assert.equal(queueItems(ws).find((item) => item.key === task.key).status, "ready")
  assert.throws(() => queueReport(ws, task.key, { summary: "The password is hunter2!" }), /looks private/)
  assert.throws(() => queueReport(ws, "q-0000000000", { summary: "Done" }), /No queued task/)
})

test("the scheduled steps are recorded, backed up with the cache, and shown in a status view", async () => {
  const ws = await workspace({ ...nodes, "views/Status.mdx": "# Status\nHow the work stands.\n\n```status\ndays: 7\n```\n" }, { locale: "en" })
  recordRun(ws, { step: "reflect", status: "ok", started: new Date(Date.now() - 60000).toISOString() })
  recordRun(ws, { step: "sources", status: "deferred", detail: "the memo is in use" })
  assert.throws(() => recordRun(ws, { step: "sources", status: "maybe" }), /step and a status/)
  assert.deepEqual(runRecords(ws).map((run) => [run.step, run.status]), [["sources", "deferred"], ["reflect", "ok"]])
  build(ws)
  const page = read(ws, "Status.md")
  assert.match(page, /- Scheduled runs · last 7 days\n\t- sources · last .+ deferred · deferred 1\n\t- reflect · last .+ done · done 1/)
  assert.match(page, /- Tasks for agents · 2 to take · 0 waiting for review\n/)
  assert.match(page, /\t- to take · \[\[Site\]\] · Check the links on the new pages/)
  const dir = join(tempDir(), "backup")
  backupRecords(ws, dir)
  const copy = new DatabaseSync(join(dir, "records.db"), { readOnly: true })
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM runs").get().n, 2)
  copy.close()
  assert.ok(existsSync(join(dir, "build.json")))
  // A backup holds the request text: never the cache itself, the graph, or where git would commit it.
  const repo = tempDir()
  spawnSync("git", ["init", "-q", repo])
  writeFileSync(join(repo, ".gitignore"), "kept/\npartial/records.db\nsome/**\n!some/**/\n!some/reports/*.md\n")
  mkdirSync(join(ws.cacheDir, "reports"), { recursive: true })
  writeFileSync(join(ws.cacheDir, "reports", "q-0123456789-2026-10-16-103000.md"), "# A report\n")
  // A folder where git ignores the records but not their temporary copy, or not a report in it, is refused too.
  for (const unsafe of [ws.cacheDir, join(ws.cacheDir, "copy"), ws.root, join(ws.graphDir, "backup"), join(repo, "backup"), join(repo, "partial"), join(repo, "some")])
    assert.throws(() => backupRecords(ws, unsafe), /goes neither into the cache/, unsafe)
  assert.equal(runRecords(ws).length, 2, "the records are still there")
  backupRecords(ws, join(repo, "kept", "today"))
  // A link left in the folder is replaced, never followed into the graph.
  const linked = join(tempDir(), "linked")
  mkdirSync(linked)
  symlinkSync(join(ws.graphDir, "projects", "Site.md"), join(linked, "build.json"))
  const before = read(ws, "projects/Site.md")
  backupRecords(ws, linked)
  assert.equal(read(ws, "projects/Site.md"), before)
  assert.ok(!lstatSync(join(linked, "build.json")).isSymbolicLink())
  // A second backup to the same folder replaces the first only once it is written.
  backupRecords(ws, dir)
  assert.deepEqual(readdirSync(dir).filter((name) => name.includes("records")), ["records.db"])
})

test("tasks with the same title in one file are queued apart, and the latest lines below a task are kept", async () => {
  const lines = Array.from({ length: 25 }, (_, i) => `\t- step ${i + 1}`).join("\n")
  const ws = await workspace({ "projects/Site.md": `# Site\nThe website.\n\n- TODO Check the links #agent\n${lines}\n- TODO Check the links #agent\n` }, { locale: "en" })
  const [first, second] = queueItems(ws)
  assert.notEqual(first.key, second.key)
  assert.equal(first.notes.length, 20)
  assert.equal(first.notes.at(-1), "step 25")
  const report = join(tempDir(), "report.md")
  writeFileSync(report, "# Links\n")
  queueReport(ws, second.key, { summary: "The second check found nothing", file: report })
  assert.match(read(ws, "projects/Site.md"), /step 25\n- TODO Check the links #agent\n\t- WAITING Review: The second check found nothing/)
  const items = queueItems(ws)
  assert.deepEqual(items.map((item) => item.status), ["ready", "waiting"])
  assert.equal(items[1].report, report)
  // Below the 20 latest lines, the latest report is still there to follow.
  queueReport(ws, first.key, { summary: "The first check found two", file: report })
  const item = queueItems(ws).find((entry) => entry.key === first.key)
  assert.equal(item.status, "waiting")
  assert.match(item.notes.at(-1), /^WAITING Review: The first check found two/)
  assert.equal(item.report, report)
})

test("a save given files commits those and what the build wrote, and leaves an edit made meanwhile elsewhere", async () => {
  // The workspace is a folder of a larger repository.
  const repo = tempDir()
  const root = join(repo, "memo")
  mkdirSync(root)
  writeFileSync(join(root, "excudo.config.mjs"), `export default ${JSON.stringify({ graph: "notes", locale: "en" })}\n`)
  for (const [rel, text] of Object.entries(nodes)) put(root, rel, text)
  const ws = await loadWorkspace({ root })
  const git = (...args) => spawnSync("git", ["-C", ws.root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.quotePath=false", ...args], { encoding: "utf8" })
  spawnSync("git", ["init", "-q", repo])
  writeFileSync(join(repo, "README.md"), "# Repository\n")
  git("add", "-A", "..")
  git("commit", "-qm", "Repository")
  const cli = join(import.meta.dirname, "..", "bin", "excudo.mjs")
  const save = (...args) => spawnSync(process.execPath, [cli, "--root", ws.root, "save", ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })
  assert.equal(save("Start").status, 0)
  const [task] = queueItems(ws).filter((item) => item.node === "Site")
  queueReport(ws, task.key, { summary: "Two links are broken" })
  // Someone writes a new page and edits another while the run saves its report.
  put(ws.root, "projects/Notes.md", "# Notes\nWritten meanwhile.\n")
  put(ws.root, "projects.md", `${read(ws, "projects.md")}`.replace("- Decision", "- Note: added meanwhile\n- Decision"))
  const out = save("Queue: reported", "--only", task.file)
  assert.equal(out.status, 0, out.stderr)
  const name = basename(ws.root)
  const committed = git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n")
  assert.ok(committed.includes(`${name}/notes/projects/Site.md`), committed.join(", "))
  assert.ok(!committed.some((file) => /Notes\.md|projects\.md/.test(file)), committed.join(", "))
  assert.match(git("status", "--porcelain").stdout, /notes\/projects\/Notes\.md/)
  assert.match(git("status", "--porcelain").stdout, /notes\/projects\.md/)
  // A run with no page of its own commits only what the build wrote.
  put(ws.root, "views/Status.mdx", "# Status\nHow the work stands.\n\n```status\ndays: 7\n```\n")
  git("add", "notes/views/Status.mdx")
  git("commit", "-qm", "A view")
  assert.equal(save("Activity", "--generated").status, 0)
  assert.deepEqual(git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n"), [`${name}/notes/Status.md`])
})

test("a report is refused when a task with the same words may have taken the key, and a nested task keeps its own reports", async () => {
  const twins = "# Site\nThe website.\n\n- TODO Check the links #agent\n\t- guide A\n- TODO Check the links #agent\n\t- guide B\n"
  const ws = await workspace({ "projects/Site.md": twins, "projects/Docs.md": "# Docs\nThe docs.\n\n- TODO Check the docs #agent\n" }, { locale: "en" })
  const [a, b] = queueItems(ws).filter((item) => item.file === "projects/Site.md")
  // The owner closes A while it is taken: B now has A's key, but not A's stamp.
  put(ws.root, "projects/Site.md", twins.replace("- TODO Check the links #agent\n\t- guide A", "- DONE Check the links #agent\n\t- guide A"))
  assert.equal(queueItems(ws).find((item) => item.file === "projects/Site.md").key, a.key)
  assert.throws(() => queueReport(ws, a.key, { summary: "A is fine", stamp: a.stamp }), /same words/)
  assert.doesNotMatch(read(ws, "projects/Site.md"), /WAITING/)
  assert.throws(() => queueReport(ws, b.key, { summary: "B is fine", stamp: b.stamp }), /No queued task/)
  // Taken again, B reports under itself.
  const [again] = queueItems(ws).filter((item) => item.file === "projects/Site.md")
  queueReport(ws, again.key, { summary: "B is fine", stamp: again.stamp })
  assert.match(read(ws, "projects/Site.md"), /guide B\n\t- WAITING Review: B is fine/)
  // A task alone with its words may change while it is taken: the owner wrote below it.
  const [docs] = queueItems(ws).filter((item) => item.file === "projects/Docs.md")
  put(ws.root, "projects/Docs.md", "# Docs\nThe docs.\n\n- TODO Check the docs #agent\n\t- only the guides\n")
  queueReport(ws, docs.key, { summary: "The docs are fine", stamp: docs.stamp })
  assert.match(read(ws, "projects/Docs.md"), /only the guides\n\t- WAITING Review: The docs are fine/)
  // A task nested in another keeps its report: the parent still waits to be taken.
  put(ws.root, "projects/Docs.md", "# Docs\nThe docs.\n\n- TODO Check the docs #agent\n\t- TODO Check the images #agent\n")
  const [parent, child] = queueItems(ws).filter((item) => item.file === "projects/Docs.md")
  const file = join(tempDir(), "images.md")
  writeFileSync(file, "# Images\n")
  queueReport(ws, child.key, { summary: "Two images are missing", file })
  const after = queueItems(ws).filter((item) => item.file === "projects/Docs.md")
  assert.deepEqual(after.map((item) => [item.title, item.status, item.report]), [["Check the docs", "ready", null], ["Check the images", "waiting", file]])
  assert.deepEqual(after[0].notes, ["TODO Check the images #agent"])
  assert.equal(parent.key, after[0].key)
  // Still when the owner closes the nested task.
  put(ws.root, "projects/Docs.md", read(ws, "projects/Docs.md").replace("\t- TODO Check the images", "\t- DONE Check the images"))
  assert.deepEqual(queueItems(ws).map((item) => [item.title, item.status, item.report]).filter(([title]) => title === "Check the docs"), [["Check the docs", "ready", null]])
})

test("a repository someone is editing right now is changed but busy, so its drafts wait", async () => {
  const repo = tempDir("excudo-busy-")
  const git = (...args) => spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(repo, "a.md"), "a")
  git("add", ".")
  git("commit", "-qm", "First")
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n" }, { locale: "en", sources: [{ name: "site", kind: "repo", path: repo, node: "Site" }] })
  markChanges(ws, ["site"])
  writeFileSync(join(repo, "b.md"), "draft")
  const [busy] = changes(ws, { name: "site" })
  assert.equal(busy.status, "changed")
  assert.equal(busy.detail.busy, true)
  // An edit left for a while is no longer someone at work.
  const old = new Date(Date.now() - 60 * 60000)
  utimesSync(join(repo, "b.md"), old, old)
  writeFileSync(join(repo, "c.md"), "")
  utimesSync(join(repo, "c.md"), old, old)
  assert.equal(changes(ws, { name: "site" })[0].detail.busy, false)
})
