import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { build, changes, check, init, installSkills, LOCALES, markChanges, requests, review, skillNames, sourcesOf, trackFolders, workspaces } from "../src/index.mjs"
import { movedPath } from "../src/workspaces.mjs"
import { writeAtomic } from "../src/files.mjs"
import { insertRequests, requestRecords, setSetting, withRecords } from "../src/records.mjs"
const recordsText = (ws) => withRecords(ws, (db) => JSON.stringify(["settings", "requests", "sessions", "spans", "checks", "commits", "runs"].map((table) => db.prepare(`SELECT * FROM ${table}`).all())))
import { put, read, tempDir, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const line = (record) => `${JSON.stringify(record)}\n`
const claudeUser = (ts, content, extra = {}) => line({ type: "user", timestamp: ts, cwd: "/work/site", sessionId: "s1", message: { role: "user", content }, ...extra })
const pasted = (id, text) => `<pasted_content id="${id}">\n${text}\n</pasted_content id="${id}">`
const git = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repository() {
  const dir = tempDir("excudo-work-")
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(join(dir, "a.md"), "a\n")
  git(dir, "add", ".")
  git(dir, "commit", "-qm", "Start")
  return dir
}
async function logged(records, config = {}) {
  const logs = tempDir("excudo-logs-")
  const dir = join(logs, "claude", "-work-site")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "s1.jsonl"), records.join(""))
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n`/work/site` · `main`\n" },
    { conversations: { claude: join(logs, "claude"), codex: false }, ...config })
  return { ws, log: join(dir, "s1.jsonl") }
}

test("a pasted text is kept apart as the request's context, and shell commands run through the agent are no requests", async () => {
  const long = "x".repeat(400)
  const { ws } = await logged([
    claudeUser("2026-10-13T01:00:00Z", `Apply the findings below\n${pasted("ab12", "Reviewer: from now on, never use tables.")}`),
    claudeUser("2026-10-13T01:01:00Z", "<bash-input>export TOKEN=secret-value</bash-input>"),
    claudeUser("2026-10-13T01:02:00Z", "<bash-stdout>secret-value</bash-stdout><bash-stderr></bash-stderr>"),
    claudeUser("2026-10-13T01:03:00Z", pasted("cd34", long)),
    claudeUser("2026-10-13T01:04:00Z", `From now on, keep summaries short\n${pasted("ef56", "notes")}`),
  ])
  const { rows } = requests(ws, { since: "2026-10-01T00:00:00Z" })
  assert.deepEqual(rows.map((row) => [row.where, row.text, row.pasted?.map((paste) => [paste.chars, paste.start.length])]), [
    ["Site", "Apply the findings below\n[pasted 1]", [[40, 40]]],
    ["Site", "[pasted 1]", [[400, 301]]],
    ["Site", "From now on, keep summaries short\n[pasted 1]", [[5, 5]]],
  ])
  // Lasting words count only when the owner wrote them, not when they came with a paste.
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z", candidates: true }).rows.map((row) => row.text), ["From now on, keep summaries short\n[pasted 1]"])
  const cache = recordsText(ws)
  assert.ok(!cache.includes("secret-value"))
  assert.ok(cache.includes(JSON.stringify(long).slice(1, -1)), "the records keep the whole paste")
})

test("when extraction changes, requests whose log is gone are cleaned again from the cache instead of lost", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")])
  requests(ws, { since: "2026-10-01T00:00:00Z" })
  // Rows an older extraction took from a log the agent has since deleted.
  const old = (ts, text) => ({ ts, tool: "claude", cwd: "/work/site", session: "gone", text })
  withRecords(ws, (db) => {
    insertRequests(db, [old("2026-10-02T00:00:00Z", `Review this\n${pasted("aa11", "A long review")}`), old("2026-10-02T00:01:00Z", "<bash-input>ls</bash-input>"),
      old("2026-10-02T00:02:00Z", "<realtime_delegation>\n  <input>Plan the trip</input>\n  <transcript_delta>assistant: Hello\nuser: Plan the trip</transcript_delta>\n</realtime_delegation>"),
      old("2026-10-02T00:03:00Z", "<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  <input>The user just ended their realtime session.</input>\n  <transcript_delta>user: Bye</transcript_delta>\n</realtime_delegation>")])
    setSetting(db, "requests.extraction", 3)
  }, { write: true })
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => [row.session, row.text, row.pasted?.[0].start]), [
    ["gone", "Review this\n[pasted 1]", "A long review"],
    ["gone", "Plan the trip", undefined],
    ["s1", "Fix the header spacing", undefined],
  ])
  assert.equal(withRecords(ws, (db) => requestRecords(db).length), 3, "the request still in its log is read once")
})

test("the request and activity files of an earlier version are read into the records once", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")])
  const rowsFile = join(ws.cacheDir, "requests.jsonl")
  const stateFile = join(ws.cacheDir, "requests.json")
  mkdirSync(ws.cacheDir, { recursive: true })
  writeFileSync(rowsFile, line({ ts: "2026-10-02T00:00:00Z", tool: "claude", cwd: "/work/site", session: "gone", text: "An old request" }))
  writeFileSync(stateFile, JSON.stringify({ cursor: {}, marks: { cleanup: "2026-10-01T00:00:00Z" }, extraction: 3 }))
  writeFileSync(join(ws.cacheDir, "activity.json"), JSON.stringify({ version: 1, cursor: {}, commits: { abc: { hash: "abc", at: "2026-10-02T00:00:00Z", subject: "Old commit", repo: "/work/site" } },
    sessions: { "claude:x": { tool: "claude", id: "x", title: "Old session", batch: false, skills: [], checks: [{ skill: "site-release", ok: true, at: "2026-10-02T00:00:00Z" }], prs: [], cost: null,
      spans: [{ day: "2026-10-02", cwd: "/work/site", start: "2026-10-02T00:00:00Z", end: "2026-10-02T00:10:00Z", turns: 1 }] } } }))
  assert.deepEqual(requests(ws).rows.map((row) => row.text), ["An old request", "Fix the header spacing"])
  for (const file of [rowsFile, stateFile, join(ws.cacheDir, "activity.json")]) {
    assert.ok(!existsSync(file), file)
    assert.ok(existsSync(`${file}.imported`), file)
  }
  const text = recordsText(ws)
  assert.ok(text.includes("Old session") && text.includes("Old commit") && text.includes("site-release"))
  // A run stopped after the import but before every file was renamed reads nothing again and keeps the rows.
  renameSync(`${stateFile}.imported`, stateFile)
  renameSync(`${join(ws.cacheDir, "activity.json")}.imported`, join(ws.cacheDir, "activity.json"))
  assert.deepEqual(requests(ws).rows.map((row) => row.text), ["An old request", "Fix the header spacing"])
  assert.ok(!existsSync(stateFile) && existsSync(`${stateFile}.imported`))
  assert.ok(recordsText(ws).includes("Old session"))
  // Another command renames the file first: this one carries on.
  renameSync(`${stateFile}.imported`, stateFile)
  assert.equal(withRecords(ws, (db) => { renameSync(stateFile, `${stateFile}.imported`); return requestRecords(db).length }), 2)
})

test("requests from a renamed folder reach the node of its new path, and folders the owner does not track are marked", async () => {
  const { ws } = await logged([
    claudeUser("2026-10-13T01:00:00Z", "Fix the old header", { cwd: "/old/website/src" }),
    claudeUser("2026-10-13T01:01:00Z", "Try the scratch tool", { cwd: "/scratch/tool" }),
  ], { moved: { "/old/website": "/work/site" } })
  trackFolders(ws, ["/scratch"])
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => [row.where, row.node ?? null, row.untracked ?? false]),
    [["Site", "Site", false], ["/scratch/tool", null, true]])
  assert.throws(() => requests({ ...ws, moved: ["/old"] }), /`moved`/)
})

test("a moved folder's path line follows it, and workspaces in folders the owner does not track are not asked about", async () => {
  const site = repository()
  const old = "/no/such/old-site-excudo"
  const ws = await workspace({ "projects/Site.md": `# Site\nThe website.\n\n- \`${old}\` · \`main\`\n- TODO ship it\n` }, { moved: { [old]: site } })
  assert.equal(build(ws).blocked.length, 0)
  assert.ok(!(await review(ws)).candidates.some((item) => item.reasons.some((reason) => reason.kind === "workspace-gone")), "a moved folder is not gone")
  const input = JSON.stringify([{ path: "/work/side" }, { path: "/work/side/feature" }, { path: "/work/new" }])
  const plan = workspaces(ws, { input, dryRun: true })
  assert.deepEqual([plan.gone.length, plan.updated.map((item) => item.text), plan.unplaced.map((item) => item.path)],
    [0, [`- \`${site}\` · \`main\``], ["/work/side", "/work/side/feature", "/work/new"]])
  trackFolders(ws, ["/work/side/"])
  const later = workspaces(ws, { input })
  assert.deepEqual([later.unplaced.map((item) => item.path), later.untracked.length], [["/work/new"], 2])
  assert.match(read(ws, "projects/Site.md"), new RegExp(`\`${site}\` · \`main\``))
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(ws.root, "review.json"), "utf8")).untracked), ["/work/side"])
  trackFolders(ws, ["/work/side"], { track: true })
  assert.equal(JSON.parse(readFileSync(join(ws.root, "review.json"), "utf8")).untracked, undefined)
})

test("a Subpages heading an outliner saved as a list item is put back, unless the section holds other text", async () => {
  const ws = await workspace({ "Work.md": "# Work\nThe work.\n\n- TODO first\n", "Work/Child.md": "# Child\nA child.\n" })
  assert.equal(build(ws).blocked.length, 0)
  const built = read(ws, "Work.md")
  // What Tine on a phone saved: a new task, two empty items, and the heading as an item with its location as continuation.
  const mangle = (text, extra = "") => text.replace("- TODO first\n\n## Subpages\nLocation: Work\n\n", "- TODO first\n- TODO second\n\n-\n-\n- ## Subpages\n  Location: Work\n") + extra
  put(ws.root, "Work.md", mangle(built))
  assert.ok(!(await check(ws)).issues.some((issue) => issue.severity === "error"))
  const result = build(ws)
  assert.deepEqual([result.blocked.length, result.repaired.map((item) => item.file)], [0, ["Work.md"]])
  assert.equal(read(ws, "Work.md"), built.replace("- TODO first\n", "- TODO first\n- TODO second\n"))
  assert.equal(result.open, 2)
  // A task added inside the section is the owner's text: the build stops and says how to keep it.
  const edited = mangle(read(ws, "Work.md").replace("- TODO second\n", ""), "- TODO third\n")
  put(ws.root, "Work.md", edited)
  const stopped = build(ws)
  assert.match(stopped.blocked[0]?.message ?? "", /saved the "Subpages" heading as a list item/)
  assert.equal(read(ws, "Work.md"), edited)
})

test("outside a workspace the commands say so in the system's language instead of failing on a missing graph", () => {
  const dir = tempDir()
  const run = (lang, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8",
    env: { ...process.env, EXCUDO_ROOT: "", LC_ALL: "", LC_MESSAGES: "", LANG: lang } })
  for (const command of ["check", "home", "tree", "review", "save"]) {
    const result = run("en_US.UTF-8", command, "message")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^No Excudo workspace at .*`excudo init <dir>`/)
  }
  assert.match(run("ko_KR.UTF-8", "check").stderr, /작업 공간을 찾지 못했습니다/)
  assert.match(run("en_US.UTF-8", "nonsense").stderr, /^Unknown command: nonsense/)
  assert.deepEqual(readdirSync(dir), [], "nothing was written")
})

test("linked skills change with the engine, a modified copy stays, and copying them again replaces only the links", async () => {
  const root = tempDir(); await init(root)
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(resolve("."), join(root, "node_modules", "excudo"), "dir")
  const [first] = skillNames()
  writeFileSync(join(root, ".agents/skills", first, "SKILL.md"), "Owner customization\n")
  const linked = installSkills({ dir: root, link: true })
  assert.equal(linked.find((skill) => skill.name === first).state, "exists")
  assert.ok(linked.filter((skill) => skill.name !== first).every((skill) => skill.state === "linked"))
  const preserved = installSkills({ dir: root, link: true, force: true }).find((skill) => skill.name === first)
  assert.equal(preserved.state, "preserved")
  assert.equal(readFileSync(join(preserved.backups[0].backup, "SKILL.md"), "utf8"), "Owner customization\n")
  // The owner removes their preserved copy only after reviewing the backup.
  rmSync(join(root, ".agents/skills", first), { recursive: true })
  installSkills({ dir: root, link: true })
  for (const name of skillNames()) {
    const dest = join(root, ".agents/skills", name)
    assert.equal(readlinkSync(dest), join("..", "..", "node_modules", "excudo", "skills", name))
    assert.equal(readFileSync(join(root, ".claude/skills", name, "SKILL.md"), "utf8"), readFileSync(join("skills", name, "SKILL.md"), "utf8"))
    assert.ok(!existsSync(join("skills", name, "version.json")), "nothing is written into the package")
  }
  assert.ok(installSkills({ dir: root, force: true }).every((skill) => skill.state === "linked"), "an update keeps the links")
  assert.ok(installSkills({ dir: root, link: false }).every((skill) => skill.state === "installed"))
  assert.ok(!lstatSync(join(root, ".agents/skills", first)).isSymbolicLink())
  assert.ok(existsSync(join("skills", first, "SKILL.md")), "removing a link leaves the package alone")
})

test("a repo source watching commits changes with a new commit, not with work in progress", async () => {
  const repo = repository()
  const source = { name: "repo", kind: "repo", path: repo, node: "Repo" }
  const ws = await workspace({ "Repo.md": "# Repo\nWhat the repository holds.\n" }, { sources: [{ ...source, watch: "commits" }] })
  const all = { ...ws, sources: [source] }
  writeFileSync(join(repo, "a.md"), "in progress\n")
  markChanges(all, ["repo"])
  assert.equal(changes(ws)[0].status, "same", "a mark taken while watching everything compares by its commit")
  writeFileSync(join(repo, "a.md"), "still in progress\n")
  assert.equal(changes(ws)[0].status, "same")
  assert.equal(changes(all)[0].status, "changed")
  git(repo, "commit", "-qam", "Finish")
  const changed = changes(ws)[0]
  assert.deepEqual([changed.status, changed.watch, changed.detail.commits], ["changed", "commits", 1])
  assert.throws(() => sourcesOf({ ...ws, sources: [{ ...source, watch: "sometimes" }] }), /watch/)
})

test("no command leaves cudoc's collected documents in the workspace", async () => {
  const ws = await workspace({ "A.md": "# A\nA.\n" })
  build(ws)
  await check(ws)
  assert.ok(!existsSync(join(ws.cacheDir, "documents")))
})

test("every message and generated word exists in both languages", () => {
  const keys = (value, path = "") => value && typeof value === "object"
    ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${path}.${key}`)) : [path]
  assert.deepEqual(keys(LOCALES.ko).sort(), keys(LOCALES.en).sort())
  const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
  for (const group of ["messages", "review", "recommendations"])
    for (const [key, text] of Object.entries(LOCALES.en[group])) assert.deepEqual(placeholders(LOCALES.ko[group][key]), placeholders(text), `${group}.${key}`)
})

test("a failed migration of the request cache leaves it as it was", { skip: process.platform === "win32" ? "POSIX file permissions" : process.getuid?.() === 0 && "root reads any file" }, async () => {
  const { ws, log } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")])
  requests(ws, { since: "2026-10-01T00:00:00Z" })
  withRecords(ws, (db) => {
    insertRequests(db, [{ ts: "2026-10-02T00:00:00Z", tool: "claude", cwd: "/work/site", session: "gone", text: "An old request" }])
    setSetting(db, "requests.extraction", 3)
  }, { write: true })
  const before = recordsText(ws)
  appendFileSync(log, claudeUser("2026-10-13T02:00:00Z", "Another request"))
  chmodSync(log, 0o000)
  try { assert.throws(() => requests(ws, { since: "2026-10-01T00:00:00Z" })) } finally { chmodSync(log, 0o644) }
  assert.equal(recordsText(ws), before)
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => row.text), ["An old request", "Fix the header spacing", "Another request"])
})

test("a path line or repository that still names a folder's old path takes the requests typed in its new one", async () => {
  const logs = tempDir("excudo-logs-")
  mkdirSync(join(logs, "claude", "-x"), { recursive: true })
  writeFileSync(join(logs, "claude", "-x", "s1.jsonl"), [
    claudeUser("2026-10-13T01:00:00Z", "Fix the old header", { cwd: "/new/website" }),
    claudeUser("2026-10-13T01:01:00Z", "Tidy the old tool", { cwd: "/new/tool/src" }),
  ].join(""))
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n`/old/site-v1` · `main`\n", "projects/Tool.md": "# Tool\nThe tool.\n" }, {
    conversations: { claude: join(logs, "claude"), codex: false }, moved: { "/old/site-v1": "/new/website", "/old/tool-v1": "/new/tool" },
    sources: [{ name: "tool", kind: "repo", path: "/old/tool-v1", node: "Tool" }] })
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => row.node), ["Site", "Tool"])
})

test("the plain request listing shows each paste's length and start", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", `Apply this\n${pasted("ab12", "Reviewer notes\nsecond line")}`)])
  const out = spawnSync(process.execPath, [cli, "--root", ws.root, "requests", "--since", "2026-10-01T00:00:00Z"], { encoding: "utf8" }).stdout
  assert.match(out, /\[Site\] Apply this \[pasted 1\]\n {6}\[pasted 1\] 26 characters pasted, someone else's words: Reviewer notes second line\n/)
})

test("a heading item with a property of its own is the owner's: the section is kept and the build stops", async () => {
  const ws = await workspace({ "Work.md": "# Work\nThe work.\n\n- TODO first\n", "Work/Child.md": "# Child\nA child.\n" })
  build(ws)
  const mangled = read(ws, "Work.md").replace("\n## Subpages\nLocation: Work\n\n", "\n- ## Subpages\n  id:: 6710aa00-0000-4000-8000-000000000001\n  collapsed:: true\n  Location: Work\n")
  put(ws.root, "Work.md", mangled)
  assert.match(build(ws).blocked[0]?.message ?? "", /saved the "Subpages" heading as a list item/)
  assert.equal(read(ws, "Work.md"), mangled)
  put(ws.root, "Work.md", mangled.replace("  id:: 6710aa00-0000-4000-8000-000000000001\n", ""))
  assert.equal(build(ws).repaired.length, 1, "collapsed:: alone is a view setting")
})

test("linking skills keeps a copy that holds files the package does not ship", async () => {
  const root = tempDir(); await init(root)
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(resolve("."), join(root, "node_modules", "excudo"), "dir")
  const [first] = skillNames()
  writeFileSync(join(root, ".agents/skills", first, "helper.sh"), "echo mine\n")
  assert.equal(installSkills({ dir: root, link: true }).find((skill) => skill.name === first).state, "exists")
  assert.ok(existsSync(join(root, ".agents/skills", first, "helper.sh")))
})

test("a move applies once, and not to a folder already at its destination", () => {
  const moves = [["/work/site", "/work/site/archive"], ["/a", "/b"], ["/b", "/c"], ["/x", "/y"], ["/y", "/x"]]
  assert.equal(movedPath(moves, "/work/site/src"), "/work/site/archive/src")
  assert.equal(movedPath(moves, "/work/site/archive/src"), "/work/site/archive/src")
  assert.equal(movedPath(moves, "/a/one"), "/c/one")
  assert.equal(movedPath(moves, "/x/one"), "/x/one", "a cycle ends")
  assert.equal(movedPath([["/w/site/archive", "/w/site"]], "/w/site/archive/src"), "/w/site/src", "a move up to a parent applies")
  assert.equal(movedPath([["/old/site", "/"], ["/src", "/work/src"]], "/old/site/src"), "/work/src", "a move to the root joins cleanly")
})

test("a file replaced atomically leaves no temporary file when the write fails", () => {
  const dir = tempDir()
  const path = join(dir, "state.json")
  mkdirSync(join(path, "inside"), { recursive: true })
  assert.throws(() => writeAtomic(path, "secret"))
  assert.deepEqual(readdirSync(dir), ["state.json"])
})

test("the request cache is refused when its temporary file would not be ignored by git", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")], { cache: "state" })
  git(ws.root, "init", "-q")
  writeFileSync(join(ws.root, ".gitignore"), "state/records.db\n")
  assert.throws(() => requests(ws, { since: "2026-10-01T00:00:00Z" }), /not ignored by git/)
  writeFileSync(join(ws.root, ".gitignore"), "state/\n")
  assert.equal(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.length, 1)
})

test("a request file of an earlier version is not read while git would not ignore its renamed copy", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")], { cache: "state" })
  git(ws.root, "init", "-q")
  mkdirSync(ws.cacheDir, { recursive: true })
  const rows = join(ws.cacheDir, "requests.jsonl")
  writeFileSync(rows, line({ ts: "2026-10-02T00:00:00Z", tool: "claude", cwd: "/work/site", session: "gone", text: "An old request" }))
  writeFileSync(join(ws.root, ".gitignore"), "state/*\n!state/*.imported\n")
  assert.throws(() => requests(ws, { since: "2026-10-01T00:00:00Z" }), /not ignored by git/)
  assert.ok(existsSync(rows) && !existsSync(`${rows}.imported`))
  writeFileSync(join(ws.root, ".gitignore"), "state/\n")
  assert.deepEqual(requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => row.text), ["An old request", "Fix the header spacing"])
  assert.ok(existsSync(`${rows}.imported`))
})

test("a plain listing shows the first 300 characters of a paste", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", `Look\n${pasted("ab12", "y".repeat(400))}`)])
  const out = spawnSync(process.execPath, [cli, "--root", ws.root, "requests", "--since", "2026-10-01T00:00:00Z"], { encoding: "utf8" }).stdout
  assert.match(out, new RegExp(`400 characters pasted, someone else's words: ${"y".repeat(300)}…\n`))
})

test("a request cache file that is a link is refused, so request text cannot reach the graph", async () => {
  const { ws } = await logged([claudeUser("2026-10-13T01:00:00Z", "Fix the header spacing")])
  requests(ws, { since: "2026-10-01T00:00:00Z" })
  const recordsFile = join(ws.cacheDir, "records.db")
  put(ws.root, "Private.md", "# Private\nMine.\n")
  rmSync(recordsFile)
  symlinkSync(join(ws.graphDir, "Private.md"), recordsFile)
  assert.throws(() => requests(ws, { since: "2026-10-01T00:00:00Z" }), /inside the graph or not ignored by git/)
  assert.equal(read(ws, "Private.md"), "# Private\nMine.\n")
})

test("a resumed Codex log keeps two requests that differ only in what was pasted", async () => {
  const logs = tempDir("excudo-codex-")
  const day = join(logs, "2026", "10", "13")
  mkdirSync(day, { recursive: true })
  const file = join(day, "rollout-resumed.jsonl")
  const item = (ts, text) => line({ type: "response_item", timestamp: ts, payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } })
  writeFileSync(file, [
    line({ type: "session_meta", timestamp: "2026-10-13T05:00:00Z", payload: { cwd: "/work/site" } }),
    item("2026-10-13T05:01:00Z", `Review this\n${pasted("aa", "First review")}`),
  ].join(""))
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n- `/work/site` · `main`\n" }, { conversations: { claude: false, codex: logs } })
  const pastes = () => requests(ws, { since: "2026-10-01T00:00:00Z" }).rows.map((row) => row.pasted?.[0].start)
  assert.deepEqual(pastes(), ["First review"])
  const second = `Review this\n${pasted("bb", "Second review")}`
  appendFileSync(file, [item("2026-10-13T06:01:00Z", second),
    line({ type: "event_msg", timestamp: "2026-10-13T06:01:00Z", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: second }] } } })].join(""))
  assert.deepEqual(pastes(), ["First review", "Second review"])
})

test("skills linked to somewhere else than the package are preserved and backed up with --force", async () => {
  const root = tempDir(); await init(root)
  const [first] = skillNames()
  const mine = tempDir("excudo-own-skill-")
  writeFileSync(join(mine, "SKILL.md"), "My own version\n")
  const dest = join(root, ".agents/skills", first)
  rmSync(dest, { recursive: true })
  symlinkSync(mine, dest, "dir")
  for (const options of [{}, { link: true }, { link: false }])
    assert.equal(installSkills({ dir: root, ...options }).find((skill) => skill.name === first).state, "exists", JSON.stringify(options))
  assert.equal(readlinkSync(dest), mine)
  const preserved = installSkills({ dir: root, link: false, force: true }).find((skill) => skill.name === first)
  assert.equal(preserved.state, "preserved")
  assert.equal(readlinkSync(preserved.backups[0].backup), mine)
  assert.equal(readlinkSync(dest), mine)
  assert.equal(readFileSync(join(mine, "SKILL.md"), "utf8"), "My own version\n", "the owner's folder is left alone")
})

test("a skill link whose text matches but leads to another copy of the skills is not taken as the package's", async () => {
  const root = tempDir(); await init(root)
  const elsewhere = tempDir("excudo-elsewhere-")
  const [first] = skillNames()
  const other = join(elsewhere, "node_modules", "excudo", "skills", first)
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, "SKILL.md"), "Another engine\n")
  mkdirSync(join(elsewhere, "x", "skills"), { recursive: true })
  // .agents/skills is itself a link, so "../../node_modules/…" resolves inside the other folder.
  rmSync(join(root, ".agents", "skills"), { recursive: true })
  symlinkSync(join(elsewhere, "x", "skills"), join(root, ".agents", "skills"), "dir")
  symlinkSync(join("..", "..", "node_modules", "excudo", "skills", first), join(elsewhere, "x", "skills", first), "dir")
  assert.equal(readFileSync(join(root, ".agents", "skills", first, "SKILL.md"), "utf8"), "Another engine\n")
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(resolve("."), join(root, "node_modules", "excudo"), "dir")
  assert.equal(installSkills({ dir: root, link: true }).find((skill) => skill.name === first).state, "exists")
})
