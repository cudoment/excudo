import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync, copyFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { loadWorkspace } from "../src/index.mjs"
import { rulesAgainstTemplate } from "../src/skillkit.mjs"
import { addSyncRule, machineFrom, setupSync, syncOf, syncRun, syncStatus } from "../src/sync.mjs"
import { tempDir } from "./helpers.mjs"

/*
 * Sync runs real git in temporary folders and never reaches a network: the GitHub method uses a local
 * bare repository as its remote, the Drive method a plain folder as the folder Google Drive would sync.
 */
const cli = resolve("bin/excudo.mjs")
const ID = "a1b2c3d4"
// Pages as the build leaves them (a Subpages section), so a merge needs no rebuild of its own.
const PAGE = (text) => `# Page\n${text}\n\n## Subpages\nLocation: Page\n`
const OTHER = (text) => `# Other\n${text}\n\n## Subpages\nLocation: Other\n`
const git = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}
const sh = (dir, ...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })
const identify = (dir) => { git(dir, "config", "user.name", "Owner"); git(dir, "config", "user.email", "owner@example.invalid") }
const page = (root) => readFileSync(join(root, "notes", "Page.md"), "utf8")
const edit = (root, text, message = "Edit") => {
  writeFileSync(join(root, "notes", "Page.md"), PAGE(text))
  git(root, "add", "-A")
  git(root, "commit", "-qm", message)
}

/** A committed workspace with the given settings; `.excudo/` is ignored as the template does. */
function seed(sync, extra = {}) {
  const root = tempDir("excudo-sync-")
  mkdirSync(join(root, "notes"), { recursive: true })
  writeFileSync(join(root, "excudo.config.mjs"), `export default ${JSON.stringify({ graph: "notes", locale: "en", ...(sync ? { sync } : {}), ...extra })}\n`)
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.excudo/\n")
  writeFileSync(join(root, "notes", "Page.md"), PAGE("A page."))
  writeFileSync(join(root, "notes", "Other.md"), OTHER("Another page."))
  git(root, "init", "-q", "-b", "main")
  identify(root)
  git(root, "add", "-A")
  git(root, "commit", "-qm", "Start")
  return root
}

function clone(from, to = tempDir("excudo-sync-")) {
  git(".", "clone", "-q", from, to)
  identify(to)
  return to
}

const load = (root) => loadWorkspace({ root })
/** The sync setting a fresh process reads from the settings file (a file imported once stays cached in this process). */
const settingOf = (root) => JSON.parse(spawnSync(process.execPath, ["--input-type=module", "-e", `console.log(JSON.stringify((await import(${JSON.stringify(pathToFileURL(join(root, "excudo.config.mjs")).href)})).default.sync))`], { encoding: "utf8" }).stdout)
const bare = () => { const dir = tempDir("excudo-remote-"); git(dir, "init", "-q", "--bare", "-b", "main"); return dir }
const named = (root, machine) => {
  mkdirSync(join(root, ".excudo"), { recursive: true })
  writeFileSync(join(root, ".excudo", "sync.json"), JSON.stringify({ machine, named: true }))
}
const github = (auto = false) => ({ id: ID, github: { remote: "origin", branch: "main" }, auto })

/** Two clones of one bare repository, A having pushed the first commit. */
async function pair(auto = false) {
  const remote = bare()
  const a = seed(github(auto))
  git(a, "remote", "add", "origin", remote)
  const first = await syncRun(await load(a), { pull: false })
  assert.equal(first.code, 0, JSON.stringify(first))
  const b = clone(remote)
  return { remote, a, b }
}

test("settings: sync off by default, one method only, and a bad setting is named", async () => {
  const off = seed(undefined)
  assert.equal(syncOf(await load(off)), undefined)
  assert.deepEqual(syncOf(await load(seed({ github: {}, id: ID }))), { id: ID, auto: false, method: "github", remote: "origin", branch: undefined })
  for (const bad of [{ github: {}, drive: { folder: "/x" } }, {}, { github: { remote: 3 } }, { drive: {} }, { drive: { folder: "/x" } }, { github: {}, auto: "yes" }, { github: {}, color: 1 }]) {
    const ws = await load(seed(bad))
    assert.throws(() => syncOf(ws), /sync setting is not usable/, JSON.stringify(bad))
  }
  assert.equal(machineFrom("Owner-MacBook Pro.local"), "owner-macbook-pro")
})

test("GitHub: a change on A reaches B through the remote", async () => {
  const { a, b } = await pair()
  edit(a, "Changed on A.")
  assert.equal((await syncRun(await load(a))).code, 0)
  const result = await syncRun(await load(b))
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.equal(result.pulled[0].state, "merged")
  assert.match(page(b), /Changed on A/)
  assert.equal(git(b, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"), "pages already built: the merge adds no build commit")
  // Nothing new: both steps say so, and nothing is rewritten.
  const again = await syncRun(await load(b))
  assert.equal(again.pulled[0].state, "up-to-date")
  const status = syncStatus(await load(b))
  assert.equal(status.method, "github")
  assert.deepEqual([status.ahead, status.behind], [0, 0])
  assert.ok(status.lastSync)
})

test("GitHub: --pull only brings changes in, --push only sends, and a push behind the remote is refused", async () => {
  const { remote, a, b } = await pair()
  edit(a, "From A.")
  const sent = await syncRun(await load(a), { pull: false })
  assert.equal(sent.code, 0)
  assert.equal(sent.pulled.length, 0, "--push pulls nothing")
  edit(b, "From B.", "B edit")
  const behind = await syncRun(await load(b), { pull: false })
  assert.equal(behind.code, 1, "B is behind: the push is refused, never forced")
  assert.equal(behind.error.kind, "rejected")
  assert.equal(git(remote, "rev-parse", "main"), git(a, "rev-parse", "HEAD"))
  const pulled = await syncRun(await load(b), { push: false })
  assert.equal(pulled.pushed, null, "--pull sends nothing")
})

test("GitHub: conflicting edits abort the merge and leave both trees as they were", async () => {
  const { a, b } = await pair()
  edit(a, "A's version.")
  await syncRun(await load(a))
  edit(b, "B's version.")
  const before = git(b, "rev-parse", "HEAD")
  const result = await syncRun(await load(b))
  assert.equal(result.code, 1)
  assert.equal(result.error.kind, "conflict")
  assert.deepEqual(result.error.files, ["notes/Page.md"])
  assert.match(result.error.message, /Page\.md/)
  assert.equal(git(b, "rev-parse", "HEAD"), before)
  assert.equal(page(b), PAGE("B's version."))
  assert.equal(git(b, "status", "--porcelain"), "")
  assert.ok(!existsSync(join(b, ".git", "MERGE_HEAD")))
  assert.equal(page(a), PAGE("A's version."), "the other computer is untouched")
  assert.equal(syncStatus(await load(b)).lastError.kind, "conflict")
  // Nothing was pushed after the failed pull.
  assert.notEqual(git(b, "rev-parse", "origin/main"), before)
})

test("GitHub: an uncommitted change is refused without auto, and committed with auto", async () => {
  const { a, b } = await pair()
  edit(a, "From A.")
  await syncRun(await load(a))
  writeFileSync(join(b, "notes", "Other.md"), OTHER("Edited here."))
  const refused = await syncRun(await load(b))
  assert.equal(refused.code, 1)
  assert.equal(refused.error.kind, "uncommitted")
  assert.match(refused.error.message, /excudo save/)
  assert.equal(readFileSync(join(b, "notes", "Other.md"), "utf8"), OTHER("Edited here."))

  const auto = await pair(true)
  edit(auto.a, "From A.")
  await syncRun(await load(auto.a))
  writeFileSync(join(auto.b, "notes", "Other.md"), OTHER("Edited here."))
  const done = await syncRun(await load(auto.b))
  assert.equal(done.code, 0, JSON.stringify(done))
  assert.match(page(auto.b), /From A/)
  assert.equal(git(auto.b, "status", "--porcelain", "--untracked-files=no"), "")
  assert.match(git(auto.b, "log", "--format=%s", "-5"), /Save before sync/)
  assert.equal(git(auto.b, "rev-parse", "HEAD"), git(auto.remote, "rev-parse", "main"), "the saved commit was pushed")
})

test("GitHub: a remote without the branch yet is made by the first push, and an unreachable remote changes nothing", async () => {
  const remote = bare()
  const a = seed(github())
  git(a, "remote", "add", "origin", remote)
  const first = await syncRun(await load(a))
  assert.equal(first.code, 0, JSON.stringify(first))
  assert.equal(first.pulled[0].state, "remote-empty")
  assert.equal(git(remote, "rev-parse", "main"), git(a, "rev-parse", "HEAD"))
  git(a, "remote", "set-url", "origin", join(tempDir(), "gone.git"))
  const head = git(a, "rev-parse", "HEAD")
  const lost = await syncRun(await load(a))
  assert.equal(lost.code, 1)
  assert.equal(git(a, "rev-parse", "HEAD"), head)
  assert.equal(git(a, "status", "--porcelain"), "")
})

/** A and B hold one history, as when B was cloned once; they sync through a plain folder. */
async function drivePair() {
  const folder = tempDir("excudo-drive-")
  const setting = { id: ID, drive: { folder }, auto: false }
  const a = seed(setting)
  const b = clone(a)
  named(a, "alpha")
  named(b, "beta")
  return { folder, dir: join(folder, ID), a, b }
}

test("Drive: each computer writes only its own bundle, and the other merges it", async () => {
  const { dir, a, b } = await drivePair()
  edit(a, "Written on alpha.")
  const sent = await syncRun(await load(a))
  assert.equal(sent.code, 0, JSON.stringify(sent))
  assert.deepEqual(readdirSync(dir), ["alpha.bundle"], "no temporary file is left in the synced folder")
  const alpha = readFileSync(join(dir, "alpha.bundle"))
  const got = await syncRun(await load(b))
  assert.equal(got.code, 0, JSON.stringify(got))
  assert.match(page(b), /Written on alpha/)
  assert.deepEqual(readdirSync(dir).sort(), ["alpha.bundle", "beta.bundle"])
  assert.ok(readFileSync(join(dir, "alpha.bundle")).equals(alpha), "B never rewrites A's bundle")
  edit(b, "Back from beta.", "Beta edit")
  edit(b, "Back from beta, again.", "Beta again")
  await syncRun(await load(b))
  const back = await syncRun(await load(a))
  assert.equal(back.code, 0, JSON.stringify(back))
  assert.match(page(a), /again/)
  const status = syncStatus(await load(a))
  assert.equal(status.method, "drive")
  assert.deepEqual(status.machines.map((item) => item.name), ["beta"])
  assert.equal(status.folder, join(dir, ".."))
  // Unchanged history is not written again (Drive would sync a new file for nothing).
  const stamp = statSync(join(dir, "alpha.bundle")).mtimeMs
  const same = await syncRun(await load(a))
  assert.equal(same.pushed.state, "up-to-date")
  assert.equal(statSync(join(dir, "alpha.bundle")).mtimeMs, stamp)
})

test("Drive: a partial bundle and a conflict copy are skipped and reported", async () => {
  const { dir, a, b } = await drivePair()
  edit(a, "Good change.")
  await syncRun(await load(a))
  copyFileSync(join(dir, "alpha.bundle"), join(dir, "alpha (1).bundle"))
  writeFileSync(join(dir, "gamma.bundle"), "not a bundle")
  copyFileSync(join(dir, "alpha.bundle"), join(dir, "aaa.bundle"))
  truncateSync(join(dir, "aaa.bundle"), Math.floor(statSync(join(dir, "aaa.bundle")).size / 2))
  writeFileSync(join(dir, ".beta.123.tmp"), "half written")
  const result = await syncRun(await load(b))
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.deepEqual(result.skipped.map((item) => `${item.file}:${item.why}`).sort(), ["aaa.bundle:unreadable", "alpha (1).bundle:name", "gamma.bundle:unreadable"])
  assert.equal(result.warnings.length, 3)
  assert.match(page(b), /Good change/, "the good bundle was still merged")
})

test("Drive: conflicting edits abort the merge and leave the tree as it was", async () => {
  const { a, b } = await drivePair()
  edit(a, "Alpha's line.")
  await syncRun(await load(a))
  edit(b, "Beta's line.")
  const before = git(b, "rev-parse", "HEAD")
  const result = await syncRun(await load(b))
  assert.equal(result.code, 1)
  assert.equal(result.error.kind, "conflict")
  assert.deepEqual(result.error.files, ["notes/Page.md"])
  assert.equal(git(b, "rev-parse", "HEAD"), before)
  assert.equal(page(b), PAGE("Beta's line."))
  assert.equal(git(b, "status", "--porcelain"), "")
})

test("Drive: a folder that is not there is reported, and a name another computer holds is not taken", async () => {
  const { dir, a, b } = await drivePair()
  const lost = seed({ id: ID, drive: { folder: join(tempDir(), "missing") } })
  const missing = await syncRun(await load(lost))
  assert.equal(missing.code, 1)
  assert.equal(missing.error.kind, "folder")
  edit(a, "Alpha.")
  await syncRun(await load(a))
  // B has made its own name from the hostname (not chosen) and finds that bundle already there.
  mkdirSync(join(b, ".excudo"), { recursive: true })
  writeFileSync(join(b, ".excudo", "sync.json"), JSON.stringify({ machine: "alpha" }))
  const taken = await syncRun(await load(b), { pull: false })
  assert.equal(taken.error.kind, "machine-taken")
  assert.ok(readFileSync(join(dir, "alpha.bundle")).length > 0)
})

test("Drive: a new computer takes over the history of a fresh folder and keeps what init wrote aside", async () => {
  const { folder, a } = await drivePair()
  edit(a, "The memo.")
  await syncRun(await load(a))
  const fresh = tempDir("excudo-fresh-")
  mkdirSync(join(fresh, "notes"), { recursive: true })
  writeFileSync(join(fresh, "excudo.config.mjs"), 'export default {\n  graph: "notes",\n  locale: "en",\n}\n')
  writeFileSync(join(fresh, "notes", "Page.md"), PAGE("Starter text."))
  git(fresh, "init", "-q", "-b", "main")
  identify(fresh)
  const joined = setupSync(await load(fresh), { method: "drive", folder, id: ID, machine: "gamma" })
  assert.equal(joined.code, 0, JSON.stringify(joined))
  assert.equal(settingOf(fresh).id, ID)
  const ws = { ...(await load(fresh)), sync: settingOf(fresh) }
  const result = await syncRun(ws, { push: false })
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.equal(result.pulled[0].state, "adopted")
  assert.equal(git(fresh, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"))
  assert.match(page(fresh), /The memo/)
  assert.ok(readFileSync(join(fresh, ".excudo", "sync-before", "notes", "Page.md"), "utf8").includes("Starter text"))
  assert.equal(JSON.parse(readFileSync(join(fresh, ".excudo", "sync.json"), "utf8")).machine, "gamma")
  // A computer with a history of its own, unrelated: that bundle is skipped with a warning, the rest and its own push go on.
  const other = seed({ id: ID, drive: { folder } })
  named(other, "delta")
  // When every bundle found is unrelated it fails before pushing, so it never spreads one more unrelated bundle.
  const unrelated = await syncRun(await load(other))
  assert.equal(unrelated.code, 1, JSON.stringify(unrelated))
  assert.equal(unrelated.error.kind, "unrelated")
  assert.equal(unrelated.pushed, null)
  assert.ok(!existsSync(join(folder, ID, "delta.bundle")), "nothing was written to the shared folder")
  // With a related bundle beside the unrelated one it warns and goes on.
  const sibling = clone(a)
  named(sibling, "epsilon")
  const warned = await syncRun(await load(other), { pull: false })
  assert.equal(warned.code, 0, JSON.stringify(warned))
  const mixed = await syncRun(await load(sibling))
  assert.equal(mixed.code, 0, JSON.stringify(mixed))
  assert.ok(mixed.skipped.some((item) => item.why === "unrelated"))
  assert.equal(mixed.pushed.state, "pushed", "the push was not stopped by the other memo's bundle")
  assert.equal(git(sibling, "status", "--porcelain"), "")
})

test("setup writes the setting once between its own markers, keeps the id, and adds the auto rule", async () => {
  const folder = tempDir("excudo-drive-")
  const root = seed(undefined)
  writeFileSync(join(root, "AGENTS.md"), "# Project\n\n## Rules\n\n- **A rule.** Text.\n\n## The engine\n\nMore.\n")
  const done = setupSync(await load(root), { method: "drive", folder, auto: true })
  assert.equal(done.code, 0, JSON.stringify(done))
  const text = readFileSync(join(root, "excudo.config.mjs"), "utf8")
  assert.match(text, /excudo:sync/)
  assert.deepEqual(settingOf(root), { id: done.setting.id, drive: { folder }, auto: true })
  assert.equal(done.ruleAdded, true)
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8")
  assert.match(agents, /excudo sync --pull/)
  assert.ok(agents.indexOf("excudo sync --pull") < agents.indexOf("## The engine"), "the rule joins the Rules section")
  assert.equal(addSyncRule({ ...(await load(root)), sync: settingOf(root) }), false, "the rule is added once")
  // Run again by a fresh process (the setting was imported above): the id stays.
  const again = spawnSync(process.execPath, [cli, "sync", "setup", "drive", "--folder", folder, "--root", root], { encoding: "utf8" })
  assert.equal(again.status, 0, again.stderr + again.stdout)
  assert.equal(settingOf(root).id, done.setting.id)
  assert.equal((readFileSync(join(root, "excudo.config.mjs"), "utf8").match(/excudo:sync \(/g) ?? []).length, 1)
  // A folder that already holds a memo is not joined by accident.
  const second = seed(undefined)
  const refused = setupSync(await load(second), { method: "drive", folder })
  assert.equal(refused.code, 0, "no bundle is there yet, so the folder holds no memo")
  mkdirSync(join(folder, "ffeeddcc"), { recursive: true })
  writeFileSync(join(folder, "ffeeddcc", "alpha.bundle"), "x")
  const third = seed(undefined)
  const guarded = setupSync(await load(third), { method: "drive", folder })
  assert.equal(guarded.code, 1)
  assert.equal(guarded.error, "drive-has-workspaces")
  assert.equal(setupSync(await load(third), { method: "drive", folder, fresh: true }).code, 0)
  assert.equal(setupSync(await load(seed(undefined)), { method: "drive", folder: "relative/path" }).code, 1)
})

test("setup github needs the remote, or makes a private repository through gh and says what to run when gh is absent", async () => {
  const root = seed(undefined)
  const said = []
  const missing = setupSync(await load(root), { method: "github", say: (line) => said.push(line) })
  assert.equal(missing.code, 1)
  assert.match(said.join("\n"), /gh repo create/)
  const withoutGh = setupSync(await load(root), { method: "github", create: "owner/memo", say: (line) => said.push(line) })
  assert.equal(withoutGh.code, 1)
  assert.match(said.join("\n"), /gh is not installed|GitHub CLI/)
  git(root, "remote", "add", "origin", bare())
  const done = setupSync(await load(root), { method: "github" })
  assert.equal(done.code, 0)
  assert.deepEqual(done.setting.github, { remote: "origin", branch: "main" })
  assert.deepEqual(settingOf(root).github, done.setting.github)
})

test("the automatic-sync rule is asked for only by a workspace that turned auto on", async () => {
  const plain = await load(seed(undefined))
  assert.equal(rulesAgainstTemplate(plain, "x").missing.some((lead) => /Pull before/.test(lead)), false, "no sync: no extra rule")
  const manual = await load(seed({ id: ID, github: {}, auto: false }))
  assert.equal(rulesAgainstTemplate(manual, "x").missing.some((lead) => /Pull before/.test(lead)), false, "sync without auto: no extra rule")
  const auto = await load(seed({ id: ID, github: {}, auto: true }))
  assert.ok(rulesAgainstTemplate(auto, "x").missing.some((lead) => /Pull before/.test(lead)))
})

test("a workspace without sync runs no extra git command, and says sync is not set up", async () => {
  const root = seed(undefined)
  const shim = tempDir("excudo-shim-")
  const log = join(shim, "git.log")
  const real = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim()
  writeFileSync(join(shim, "git"), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${real}" "$@"\n`)
  chmodSync(join(shim, "git"), 0o755)
  const env = { ...process.env, PATH: `${shim}${delimiter}${process.env.PATH}` }
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--root", root], { cwd: root, encoding: "utf8", env })
  writeFileSync(join(root, "notes", "Other.md"), OTHER("Changed."))
  const saved = run("save", "Change")
  assert.equal(saved.status, 0, saved.stderr + saved.stdout)
  const calls = readFileSync(log, "utf8")
  assert.doesNotMatch(calls, /\b(push|fetch|pull|bundle|merge|remote|ls-remote)\b/, calls)
  const none = run("sync")
  assert.equal(none.status, 1)
  assert.match(none.stderr, /not set up/)
  const status = run("sync", "--status", "--json")
  assert.equal(status.status, 0)
  assert.deepEqual(JSON.parse(status.stdout), { configured: false })
  assert.match(run("sync", "--status").stdout, /not set up/)
})

test("save with auto pushes after its commit; without auto it does not", async () => {
  for (const auto of [false, true]) {
    const remote = bare()
    const root = seed(github(auto))
    git(root, "remote", "add", "origin", remote)
    git(root, "push", "-q", "origin", "main")
    writeFileSync(join(root, "notes", "Other.md"), OTHER("Changed."))
    const saved = spawnSync(process.execPath, [cli, "save", "Change", "--root", root], { cwd: root, encoding: "utf8" })
    assert.equal(saved.status, 0, saved.stderr + saved.stdout)
    assert.equal(git(remote, "rev-parse", "main") === git(root, "rev-parse", "HEAD"), auto, `auto ${auto}`)
    if (auto) assert.match(saved.stdout, /Pushed to origin\/main/)
  }
  // A push that fails is a warning: the commit stays and save succeeds.
  const root = seed(github(true))
  git(root, "remote", "add", "origin", join(tempDir(), "gone.git"))
  writeFileSync(join(root, "notes", "Other.md"), OTHER("Changed again."))
  const saved = spawnSync(process.execPath, [cli, "save", "Change", "--root", root], { cwd: root, encoding: "utf8" })
  assert.equal(saved.status, 0, saved.stderr + saved.stdout)
  assert.match(saved.stdout, /^! /m)
  assert.match(sh(root, "log", "-1", "--format=%s").stdout, /Change/)
})

test("the CLI syncs two computers, reports the status as JSON, and refuses an uncommitted pull", async () => {
  const { a, b } = await pair()
  const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args, "--root", root], { cwd: root, encoding: "utf8" })
  edit(a, "Through the CLI.")
  assert.equal(run(a, "sync").status, 0)
  const pulled = run(b, "sync", "--pull")
  assert.equal(pulled.status, 0, pulled.stderr + pulled.stdout)
  assert.match(page(b), /Through the CLI/)
  const status = JSON.parse(run(b, "sync", "--status", "--json").stdout)
  assert.equal(status.method, "github")
  assert.equal(status.remote, "origin")
  writeFileSync(join(b, "notes", "Other.md"), OTHER("Unsaved."))
  const refused = run(b, "sync", "--pull")
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /excudo save/)
  assert.equal(statSync(join(b, ".excudo", "sync.json")).isFile(), true)
  assert.match(git(b, "check-ignore", ".excudo/sync.json"), /sync\.json/, "the machine-local state is not committed")
})

test("Drive: a computer whose git init named another branch joins the memo's branch, and mismatched histories fail loudly", async () => {
  const { folder, a } = await drivePair()
  edit(a, "The memo.")
  await syncRun(await load(a))
  const fresh = tempDir("excudo-fresh-")
  mkdirSync(join(fresh, "notes"), { recursive: true })
  writeFileSync(join(fresh, "excudo.config.mjs"), 'export default {\n  graph: "notes",\n  locale: "en",\n}\n')
  git(fresh, "init", "-q", "-b", "master")
  identify(fresh)
  const joined = setupSync(await load(fresh), { method: "drive", folder, id: ID, machine: "gamma" })
  assert.equal(joined.code, 0, JSON.stringify(joined))
  assert.equal(JSON.parse(readFileSync(join(fresh, ".excudo", "sync.json"), "utf8")).branch, "main", "the memo's branch is recorded at the join")
  const ws = { ...(await load(fresh)), sync: settingOf(fresh) }
  const result = await syncRun(ws, { push: false })
  assert.equal(result.code, 0, JSON.stringify(result))
  assert.equal(git(fresh, "rev-parse", "--abbrev-ref", "HEAD"), "main")
  assert.equal(git(fresh, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"))
  // Both have history, on different branches: every bundle is skipped, which is a failure naming both.
  const { a: x, b: y } = await drivePair()
  edit(x, "X.")
  await syncRun(await load(x))
  git(y, "branch", "-m", "master")
  const bad = await syncRun(await load(y))
  assert.equal(bad.code, 1)
  assert.equal(bad.error.kind, "branch-mismatch")
  assert.match(bad.error.message, /master/)
  assert.match(bad.error.message, /main/)
})

test("Drive: a name this computer never wrote is refused at setup, pull and push, even when chosen; a replaced bundle is written again", async () => {
  const { folder, dir, a, b } = await drivePair()
  edit(a, "Alpha.")
  await syncRun(await load(a))
  const run = async (options) => { writeFileSync(join(b, ".excudo", "sync.json"), JSON.stringify({ machine: "alpha", named: true })); return syncRun(await load(b), options) }
  mkdirSync(join(b, ".excudo"), { recursive: true })
  assert.equal((await run({ push: false })).error.kind, "machine-taken", "pull")
  assert.equal((await run({ pull: false })).error.kind, "machine-taken", "push")
  const setup = setupSync(await load(b), { method: "drive", folder, id: ID, machine: "alpha" })
  assert.equal(setup.code, 1)
  assert.equal(setup.error, "machine-taken")
  assert.ok(readFileSync(join(dir, "alpha.bundle")).length > 100, "the other computer's bundle is untouched")
  // A's own bundle replaced by something else: not up to date, so it is written again.
  writeFileSync(join(dir, "alpha.bundle"), "replaced")
  const again = await syncRun(await load(a), { pull: false })
  assert.equal(again.pushed.state, "pushed")
  assert.equal(spawnSync("git", ["-C", a, "bundle", "verify", join(dir, "alpha.bundle")], { encoding: "utf8" }).status, 0)
})

test("Drive: pull alone fails when the folder is not there", async () => {
  const lost = seed({ id: ID, drive: { folder: join(tempDir(), "missing") } })
  const result = await syncRun(await load(lost), { push: false })
  assert.equal(result.code, 1)
  assert.equal(result.error.kind, "folder")
})

test("auto: the save before a pull leaves held files out and stops when only they remain", async () => {
  const auto = await pair(true)
  writeFileSync(join(auto.b, "extra.txt"), "one\n")
  git(auto.b, "add", "extra.txt")
  git(auto.b, "commit", "-qm", "Extra")
  writeFileSync(join(auto.b, "extra.txt"), "two\n")
  writeFileSync(join(auto.b, "notes", "Other.md"), OTHER("Held edit."))
  process.env.EXCUDO_HOLD = "notes/Other.md"
  try {
    const result = await syncRun(await load(auto.b))
    assert.equal(result.code, 1)
    assert.equal(result.error.kind, "uncommitted")
    assert.deepEqual(result.error.files, ["notes/Other.md"])
  } finally { delete process.env.EXCUDO_HOLD }
  assert.equal(git(auto.b, "show", "--format=", "--name-only", "HEAD"), "extra.txt", "the held page is not in the saved commit")
  assert.equal(readFileSync(join(auto.b, "notes", "Other.md"), "utf8"), OTHER("Held edit."))
})

test("the start step for sync is unknown (never next) until sync is set", async () => {
  const { startStatus } = await import("../src/start.mjs")
  const off = startStatus(await load(seed(undefined)))
  assert.equal(off.steps.find((step) => step.id === "sync").done, null)
  assert.notEqual(off.next, "sync")
  const on = startStatus(await load(seed({ id: ID, github: {} })))
  const step = on.steps.find((item) => item.id === "sync")
  assert.equal(step.done, true)
  assert.equal(step.setting, null)
})

test("setup github checks that an existing remote is private through gh, and says when it cannot", async () => {
  const gh = join(tempDir("excudo-gh-"), "gh")
  writeFileSync(gh, `#!/bin/sh\ncase "$*" in\n  "api user"*) echo me ;;\n  "repo view"*) echo "{\\"visibility\\":\\"$FAKE_VISIBILITY\\"}" ;;\nesac\n`)
  chmodSync(gh, 0o755)
  const was = process.env.EXCUDO_GH
  try {
    process.env.EXCUDO_GH = gh
    process.env.FAKE_VISIBILITY = "PUBLIC"
    const root = seed(undefined)
    git(root, "remote", "add", "origin", "https://github.com/owner/memo.git")
    const refused = setupSync(await load(root), { method: "github" })
    assert.equal(refused.code, 1)
    assert.equal(refused.error, "repo-not-private")
    process.env.FAKE_VISIBILITY = "PRIVATE"
    assert.equal(setupSync(await load(root), { method: "github" }).code, 0)
    // gh absent: the setup goes on and says the check was not possible.
    process.env.EXCUDO_GH = join(tempDir(), "no-gh")
    const said = []
    const other = seed(undefined)
    git(other, "remote", "add", "origin", "git@github.com:owner/memo.git")
    assert.equal(setupSync(await load(other), { method: "github", say: (line) => said.push(line) }).code, 0)
    assert.match(said.join("\n"), /private/)
  } finally { process.env.EXCUDO_GH = was; delete process.env.FAKE_VISIBILITY }
})

test("a push refused by a hook is its own failure, not 'pull first'; the auto rule tells what to do offline", async () => {
  const remote = bare()
  const hook = join(remote, "hooks", "pre-receive")
  writeFileSync(hook, "#!/bin/sh\necho 'no big files' >&2\nexit 1\n")
  chmodSync(hook, 0o755)
  const a = seed(github())
  git(a, "remote", "add", "origin", remote)
  const result = await syncRun(await load(a), { pull: false })
  assert.equal(result.code, 1)
  assert.equal(result.error.kind, "push")
  assert.match(result.error.message, /no big files/)
  const { syncRuleText } = await import("../src/sync.mjs")
  assert.match(syncRuleText(await load(a)), /continue with the local memo/)
  const { LOCALES } = await import("../src/labels.mjs")
  for (const locale of ["en", "ko"]) assert.ok(LOCALES[locale].sync["network-push"], locale)
  assert.match(LOCALES.ko.sync["remote-missing"], /이름이 \{remote\}인 git 리모트/)
})

/** A workspace made by `excudo init` (real files, no hand-written ones), in a git repository with an identity. */
function initWorkspace(locale = "en") {
  const root = tempDir("excudo-init-")
  const made = spawnSync(process.execPath, [cli, "init", root, "--locale", locale], { encoding: "utf8" })
  assert.equal(made.status, 0, made.stderr + made.stdout)
  git(root, "init", "-q", "-b", "main")
  identify(root)
  return root
}
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args, "--root", root], { cwd: root, encoding: "utf8" })
const ok = (result) => { assert.equal(result.status, 0, result.stderr + result.stdout); return result }
/** What `npm install` would give: the engine in node_modules, so a clone can run its commands. */
function installEngine(root) {
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(resolve("."), join(root, "node_modules", "excudo"))
}

test("GitHub: a clone of a workspace made by init and save alone can start (package.json, ignore rules, instructions, skills travel)", async () => {
  const remote = bare()
  const a = initWorkspace("en")
  ok(run(a, "save", "Start"))
  git(a, "remote", "add", "origin", remote)
  const setup = ok(run(a, "sync", "setup", "github", "--auto"))
  assert.match(setup.stdout, /Added to git so another computer can start from a clone: .*package\.json/)
  ok(run(a, "save", "Set up sync"))
  const tracked = git(remote, "ls-tree", "-r", "--name-only", "main").split("\n")
  for (const file of ["package.json", ".gitignore", "AGENTS.md", "CLAUDE.md", ".agents/skills/excudo-setup/SKILL.md", "excudo.config.mjs"]) assert.ok(tracked.includes(file), file)
  assert.ok(!tracked.some((file) => file.startsWith("node_modules/") || file.startsWith(".excudo/")), "caches and installs stay out")
  const b = clone(remote)
  installEngine(b)
  const status = JSON.parse(ok(run(b, "sync", "--status", "--json")).stdout)
  assert.equal(status.method, "github")
  assert.equal(status.auto, true)
  assert.match(readFileSync(join(b, "AGENTS.md"), "utf8"), /excudo sync --pull/, "the auto rule came with the clone")
  assert.match(git(b, "check-ignore", ".excudo/sync.json"), /sync\.json/)
  assert.ok(existsSync(join(b, "package.json")))
  ok(run(b, "sync", "--pull"))
})

test("a user's ignored or other untracked files are never added by the sync setup or the first push", async () => {
  const a = initWorkspace("en")
  ok(run(a, "save", "Start"))
  writeFileSync(join(a, "private-notes.txt"), "mine\n")
  mkdirSync(join(a, "node_modules"), { recursive: true })
  writeFileSync(join(a, "node_modules", "x.js"), "x\n")
  git(a, "remote", "add", "origin", bare())
  ok(run(a, "sync", "setup", "github"))
  ok(run(a, "save", "Set up sync"))
  ok(run(a, "sync", "--push"))
  const tracked = git(a, "ls-files").split("\n")
  assert.ok(!tracked.includes("private-notes.txt"))
  assert.ok(!tracked.some((file) => file.startsWith("node_modules/")))
})

test("Drive: a folder made with another language than the memo cannot join it, and one made the same way joins without a rebuild", async () => {
  const folder = tempDir("excudo-drive-")
  const a = initWorkspace("ko")
  ok(run(a, "save", "시작"))
  ok(run(a, "sync", "setup", "drive", "--folder", folder, "--machine", "alpha"))
  ok(run(a, "save", "동기화 설정"))
  ok(run(a, "sync"))
  const id = readdirSync(folder)[0]
  const wrong = initWorkspace("en")
  const refused = run(wrong, "sync", "setup", "drive", "--folder", folder, "--id", id, "--machine", "beta")
  assert.equal(refused.status, 1)
  assert.match(refused.stdout, /--locale ko/)
  const right = initWorkspace("ko")
  ok(run(right, "sync", "setup", "drive", "--folder", folder, "--id", id, "--machine", "beta"))
  const pulled = ok(run(right, "sync", "--pull"))
  assert.doesNotMatch(pulled.stdout, /Build after sync|빌드/)
  assert.equal(git(right, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"), "no commit of its own on top of the memo's history")
  assert.equal(git(right, "status", "--porcelain", "--untracked-files=no"), "")
  assert.equal(git(right, "ls-files", "--others", "--exclude-standard", "notes"), "", "init's pages that the history lacks are moved aside, not left in the graph")
})

test("Drive: a memo whose first computer handed Home over joins without leftovers and keeps saving", async () => {
  const folder = tempDir("excudo-drive-")
  const a = initWorkspace("en")
  ok(run(a, "save", "Start"))
  ok(run(a, "home", "--own"))
  ok(run(a, "sync", "setup", "drive", "--folder", folder, "--machine", "alpha"))
  ok(run(a, "save", "Own Home and sync"))
  ok(run(a, "sync"))
  const id = readdirSync(folder)[0]
  const b = initWorkspace("en")
  ok(run(b, "sync", "setup", "drive", "--folder", folder, "--id", id, "--machine", "beta"))
  ok(run(b, "sync", "--pull"))
  assert.equal(git(b, "rev-parse", "HEAD"), git(a, "rev-parse", "HEAD"))
  assert.ok(!existsSync(join(b, "notes", "views", "Home.mdx")), "init's Home view is not left beside the owner's Home")
  assert.ok(existsSync(join(b, ".excudo", "sync-before", "notes", "views", "Home.mdx")))
  ok(run(b, "save", "Nothing blocked"))
})

test("sync: false or null is off everywhere: the setup check and the start step see no sync", async () => {
  for (const off of [false, null]) {
    const root = seed(undefined, { sync: off })
    installEngine(root)
    const ws = await load(root)
    assert.equal(syncOf(ws), undefined)
    const { startStatus } = await import("../src/start.mjs")
    assert.equal(startStatus(ws).steps.find((step) => step.id === "sync").done, null)
    const checked = spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--json"], { cwd: root, encoding: "utf8" })
    const report = JSON.parse(checked.stdout)
    assert.ok(!report.checks.some((check) => check.id === "sync"), `sync: ${off} adds no sync check`)
  }
})

test("a conflict message names the ref to merge, and the sources already merged before it", async () => {
  const { dir, a, b } = await drivePair()
  // A third computer's bundle merges cleanly first; alpha's conflicts.
  const c = clone(a)
  named(c, "aaa")
  writeFileSync(join(c, "notes", "Other.md"), OTHER("From aaa."))
  git(c, "add", "-A")
  git(c, "commit", "-qm", "aaa edit")
  await syncRun(await load(c), { pull: false })
  edit(a, "Alpha's line.")
  await syncRun(await load(a), { pull: false })
  edit(b, "Beta's line.")
  const result = await syncRun(await load(b))
  assert.equal(result.error.kind, "conflict")
  assert.equal(result.error.ref, "refs/excudo-sync/alpha")
  assert.match(result.error.message, /git merge refs\/excudo-sync\/alpha/)
  assert.match(result.error.message, /Already merged and kept before it: aaa/)
  assert.ok(dir)
})

test("a view that shows this computer's own records does not block the sync or the save after a pull", async () => {
  const remote = bare()
  const a = initWorkspace("en")
  writeFileSync(join(a, "notes", "views", "Work.mdx"), "# Work\n\n```status\n```\n")
  ok(run(a, "save", "Start"))
  git(a, "remote", "add", "origin", remote)
  ok(run(a, "sync", "setup", "github", "--auto"))
  ok(run(a, "save", "Set up sync"))
  const b = clone(remote)
  installEngine(b)
  // The first sync on a clone marks it: its first build takes the history's pages as they are, though its records differ from A's.
  ok(run(b, "sync", "--pull"))
  ok(run(b, "runs", "add", "nightly", "--status", "failed"))
  ok(run(b, "save", "First save on B"))
  // A records a run of its own and saves: the page A commits differs from what B would draw.
  ok(run(a, "runs", "add", "deploy", "--status", "ok"))
  writeFileSync(join(a, "notes", "Plans.md"), "# Plans\nA plan.\n")
  ok(run(a, "save", "A's change"))
  assert.match(readFileSync(join(a, "notes", "Work.md"), "utf8"), /deploy/)
  const pulled = run(b, "sync", "--pull")
  assert.equal(pulled.status, 0, pulled.stderr + pulled.stdout)
  assert.match(readFileSync(join(b, "notes", "Work.md"), "utf8"), /deploy|nightly/)
  const saved = run(b, "save", "After the pull")
  assert.equal(saved.status, 0, saved.stderr + saved.stdout)
  // A hand edit of a generated page is still protected.
  writeFileSync(join(b, "notes", "Work.md"), `${readFileSync(join(b, "notes", "Work.md"), "utf8")}\nMy own line\n`)
  assert.notEqual(run(b, "save", "Edited").status, 0)
})

test("Drive: joining needs a readable bundle, and a folder that adopts nothing fails instead of pulling nothing", async () => {
  const folder = tempDir("excudo-drive-")
  const lone = initWorkspace("en")
  const none = run(lone, "sync", "setup", "drive", "--folder", folder, "--id", "ffeeddcc", "--machine", "beta")
  assert.equal(none.status, 1)
  assert.match(none.stdout, /No readable bundle/)
  mkdirSync(join(folder, "ffeeddcc"), { recursive: true })
  writeFileSync(join(folder, "ffeeddcc", "alpha.bundle"), "still syncing")
  assert.equal(run(lone, "sync", "setup", "drive", "--folder", folder, "--id", "ffeeddcc", "--machine", "beta").status, 1, "a partial bundle is not readable")
  // A folder with no history whose pull adopts nothing says so and tells not to save first.
  const fresh = tempDir("excudo-fresh-")
  mkdirSync(join(fresh, "notes"), { recursive: true })
  writeFileSync(join(fresh, "excudo.config.mjs"), 'export default {\n  graph: "notes",\n  locale: "en",\n}\n')
  git(fresh, "init", "-q", "-b", "main")
  const settings = { id: "ffeeddcc", drive: { folder }, auto: false }
  // A first computer that never joined (no commit, no --id) is told to save first, as before.
  const first = await syncRun({ ...(await load(fresh)), sync: settings })
  assert.equal(first.code, 1)
  assert.equal(first.error.kind, "empty")
  assert.match(first.error.message, /excudo save/)
  // A joining computer (setup with --id marks it) that adopts nothing says so and tells not to save first.
  mkdirSync(join(fresh, ".excudo"), { recursive: true })
  writeFileSync(join(fresh, ".excudo", "sync.json"), JSON.stringify({ joining: true }))
  const result = await syncRun({ ...(await load(fresh)), sync: settings })
  assert.equal(result.code, 1)
  assert.equal(result.error.kind, "nothing-adopted")
  assert.match(result.error.message, /Do not run excudo save/)
})

test("Drive: on a computer with history a bundle on another branch is a warning, while the push goes on", async () => {
  const { a, b } = await drivePair()
  edit(a, "A.")
  await syncRun(await load(a))
  git(b, "branch", "-m", "master")
  edit(b, "B.", "B edit")
  const result = await syncRun(await load(b))
  assert.equal(result.pushed.state, "pushed", "B's own push was not stopped")
  assert.equal(result.code, 1, "every other bundle is on another branch: still reported as a failure")
  assert.equal(result.error.kind, "branch-mismatch")
})

test("setup drive refuses a folder and a workspace that contain one another", async () => {
  const root = seed(undefined)
  const outside = tempDir("excudo-drive-")
  assert.equal(setupSync(await load(root), { method: "drive", folder: root }).error, "drive-nested")
  assert.equal(setupSync(await load(root), { method: "drive", folder: join(root, "notes") }).error, "drive-nested")
  mkdirSync(join(outside, "work"), { recursive: true })
  const inside = seed(undefined)
  assert.equal(setupSync(await load(inside), { method: "drive", folder: dirname(inside) }).error, "drive-nested", "the workspace lies inside the Drive folder")
  assert.equal(setupSync(await load(seed(undefined)), { method: "drive", folder: outside }).code, 0)
})

test("auto: a save that commits nothing still sends commits an offline run left behind", async () => {
  const { remote, a } = await pair(true)
  edit(a, "Offline commit.")
  assert.notEqual(git(a, "rev-parse", "HEAD"), git(remote, "rev-parse", "main"))
  const saved = run(a, "save", "Nothing to commit")
  assert.equal(saved.status, 0, saved.stderr + saved.stdout)
  assert.equal(git(a, "rev-parse", "HEAD"), git(remote, "rev-parse", "main"), "the leftover commit was sent")
  // Drive: compared with the bundle's last push.
  const { dir, a: x } = await drivePair()
  const auto = { id: ID, drive: { folder: join(dir, ".."), }, auto: true }
  writeFileSync(join(x, "excudo.config.mjs"), `export default ${JSON.stringify({ graph: "notes", locale: "en", sync: auto })}\n`)
  git(x, "commit", "-qam", "Auto")
  ok(run(x, "sync", "--push"))
  edit(x, "Offline on Drive.")
  const head = git(x, "rev-parse", "HEAD")
  ok(run(x, "save", "Nothing to commit"))
  assert.equal(spawnSync("git", ["-C", x, "bundle", "list-heads", join(dir, "alpha.bundle")], { encoding: "utf8" }).stdout.includes(head), true)
})

test("other commands still reject the sync options as unknown", () => {
  const root = seed(undefined)
  for (const args of [["save", "x", "--push"], ["build", "--id", "ab12cd34"], ["check", "--auto"], ["tree", "--folder", "x"]]) {
    const result = run(root, ...args)
    assert.notEqual(result.status, 0, args.join(" "))
    assert.match(result.stderr, /Unknown option/, args.join(" "))
  }
  assert.doesNotMatch(run(root, "sync", "--pull").stderr, /Unknown option/)
})

test("the command is the first positional argument: a value that spells another command does not hide the sync options", async () => {
  const root = seed(undefined)
  const folder = tempDir("excudo-drive-")
  const setup = run(root, "sync", "setup", "drive", "--folder", folder, "--machine", "runs")
  assert.doesNotMatch(setup.stderr, /Unknown option/, setup.stderr)
  assert.equal(setup.status, 0, setup.stderr + setup.stdout)
  assert.equal(JSON.parse(readFileSync(join(root, ".excudo", "sync.json"), "utf8")).machine, "runs")
  assert.doesNotMatch(run(root, "sync", "setup", "github", "--remote", "runs").stderr, /Unknown option/)
})

/** Two clones of a workspace init made, each with a node page that has a generated region; A pushed first. */
function regionPair() {
  const remote = bare()
  const a = initWorkspace("en")
  writeFileSync(join(a, "notes", "Plans.md"), "# Plans\nAuthored text.\n\n- A plan.\n")
  writeFileSync(join(a, "notes", "Notes.md"), "# Notes\nAuthored notes.\n\n- A note.\n")
  ok(run(a, "save", "Start"))
  git(a, "remote", "add", "origin", remote)
  ok(run(a, "sync", "setup", "github"))
  ok(run(a, "save", "Set up sync"))
  ok(run(a, "sync"))
  const b = clone(remote)
  installEngine(b)
  ok(run(b, "sync", "--pull"))
  ok(run(b, "build"))
  return { remote, a, b }
}
const regionOf = (root, name) => readFileSync(join(root, "notes", `${name}.md`), "utf8")
const appendLine = (root, name, line) => writeFileSync(join(root, "notes", `${name}.md`), `${regionOf(root, name)}${line}\n`)

test("sync: a hand edit of a generated region that A committed with snapshot still blocks on B, and B never rewrites it", async () => {
  const { a, b } = regionPair()
  appendLine(a, "Plans", "- hand line in the region")
  ok(run(a, "snapshot"))
  ok(run(a, "sync", "--push"))
  const pulled = run(b, "sync", "--pull")
  assert.notEqual(pulled.status, 0, "the incoming region text is a hand edit, not engine output")
  assert.match(regionOf(b, "Plans"), /hand line in the region/, "the edit is left as it is")
  assert.notEqual(run(b, "build").status, 0)
})

test("sync: B's own committed region edit survives a merge that only touched another hunk", async () => {
  const { a, b } = regionPair()
  appendLine(b, "Plans", "- B's region edit")
  ok(run(b, "snapshot"))
  writeFileSync(join(a, "notes", "Plans.md"), regionOf(a, "Plans").replace("Authored text.", "Authored text, changed on A."))
  ok(run(a, "snapshot"))
  ok(run(a, "sync", "--push"))
  run(b, "sync", "--pull")
  assert.match(regionOf(b, "Plans"), /changed on A/, "the merge brought A's change")
  assert.match(regionOf(b, "Plans"), /B's region edit/, "B's own edit was not overwritten")
})

test("sync: deleting the build record outside a clone does not accept a committed region edit", async () => {
  const { a } = regionPair()
  appendLine(a, "Plans", "- committed hand line")
  ok(run(a, "snapshot"))
  rmSync(join(a, ".excudo", "build.json"))
  const built = run(a, "build")
  assert.notEqual(built.status, 0, built.stdout)
  assert.match(built.stdout + built.stderr, /no protection baseline/)
  assert.match(regionOf(a, "Plans"), /committed hand line/)
})
