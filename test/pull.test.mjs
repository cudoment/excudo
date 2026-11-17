import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test as nodeTest } from "node:test"
// These fixtures launch POSIX executables directly; Windows cannot execute their shebangs.
const test = process.platform === "win32" ? nodeTest.skip : nodeTest
import { checkChanges, issueBody, syncBody, taskHash } from "../src/index.mjs"
import { pullInbox, pullState } from "../src/pull.mjs"
import { fakeGh, withEnv, workspace } from "./helpers.mjs"

/*
 * `site pull` against a stand-in gh: the inbox repository's issues are kept in its state file, and the
 * memo is a git repository of the test's own. The Vercel CLI is absent, so publishing waits quietly.
 */
const cli = resolve("bin/excudo.mjs")
const REPO = "me/inbox"
const WORK = "# Work\nCurrent work.\n\n- TODO Write the plan\n- DOING Ship the site\n- TODO Keep this one\n"
const git = (root, ...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" })
let n = 0
const issue = (number, line, text, to, site = "s") => ({ number, title: "excudo-changes: 1 change", createdAt: "2026-10-28T01:00:00Z",
  body: issueBody(checkChanges({ format: "excudo-changes", version: 1, site, entries: [{ id: `change-${String(++n).padStart(4, "0")}`, kind: "task", page: "projects/Work.md", line, hash: taskHash(text), from: text.split(" ")[0], to }] })) })
const request = (number, site = "s") => ({ number, title: "excudo-sync: bring the changes in now", createdAt: "2026-10-28T02:00:00Z", body: syncBody(site, "2026-10-28T02:00:00Z") })

async function memo(inbox = { github: { repo: REPO }, schedule: false }, { repository = true } = {}) {
  const ws = await workspace({ "projects/Work.md": WORK }, { locale: "en", site: { onSave: false, id: "s", inbox } })
  if (!repository) return ws
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nnode_modules\n")
  git(ws.root, "init", "-q"); git(ws.root, "config", "user.email", "t@example.com"); git(ws.root, "config", "user.name", "t")
  git(ws.root, "add", "-A"); git(ws.root, "commit", "-q", "-m", "start")
  return ws
}
const page = (ws) => readFileSync(join(ws.graphDir, "projects/Work.md"), "utf8").split("\n")
const subjects = (ws, count) => git(ws.root, "log", `-${count}`, "--format=%s").stdout.trim().split("\n")
/** An edit made long enough ago that a scheduled run does not wait for it. */
const old = (file) => { const then = new Date(Date.now() - 30 * 60_000); utimesSync(file, then, then) }
const run = (ws, gh, options = {}) => withEnv({ EXCUDO_GH: gh.path, EXCUDO_PULL_EVERY: "0" }, () => pullInbox(ws, options))

test("a dry run says what it would take and changes nothing", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(3, 4, "TODO Write the plan", "DONE")] } } })
  const said = []
  const result = await run(ws, gh, { dryRun: true, say: (line) => said.push(line) })
  assert.deepEqual([result.code, result.applied], [0, 1])
  assert.match(said.join("\n"), /1 issues: 1 to apply/)
  assert.equal(git(ws.root, "status", "--porcelain").stdout, "")
  assert.equal(gh.state().repos[REPO].issues[0].closed, undefined)
})

test("the owner's own edits of the page get a commit first, the state a commit of its own, and the issue is closed after", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(3, 4, "TODO Write the plan", "DONE"), { number: 4, title: "A question", body: "Written by hand." }] } } })
  const file = join(ws.graphDir, "projects/Work.md")
  writeFileSync(file, WORK.replace("Current work.", "Current work, edited."))
  old(file)
  const result = await run(ws, gh)
  assert.deepEqual([result.code, result.applied, result.closed], [0, 1, 1])
  assert.equal(page(ws)[3], "- DONE Write the plan")
  assert.deepEqual(subjects(ws, 2), ["Bring in the task states and board saves from the website (issues #3)", "Save the owner's edits before the website's changes"])
  assert.match(git(ws.root, "show", "HEAD~1", "--format=").stdout, /\+Current work, edited\./)
  assert.deepEqual(git(ws.root, "show", "HEAD", "--format=").stdout.split("\n").filter((line) => /^[-+]- /.test(line)), ["-- TODO Write the plan", "+- DONE Write the plan"])
  assert.equal(git(ws.root, "status", "--porcelain").stdout, "")
  const issues = gh.state().repos[REPO].issues
  assert.deepEqual(issues.map((item) => [item.number, item.closed]), [[3, "completed"], [4, undefined]], "a hand-written issue is left alone")
})

test("a change it cannot place is noted on today's journal, committed, and its issue closed as not planned", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(5, 5, "DOING Ship the site, reworded", "DONE")] } } })
  const said = []
  const result = await run(ws, gh, { say: (line) => said.push(line) })
  assert.deepEqual([result.code, result.uncertain], [0, 1])
  const journals = readdirSync(join(ws.graphDir, "journals"))
  assert.match(readFileSync(join(ws.graphDir, "journals", journals[0]), "utf8"), /^- WAITING A state chosen on the website was not applied: \[\[Work\]\] line 5 to DONE/m)
  assert.equal(git(ws.root, "status", "--porcelain").stdout, "", "the journal is committed too")
  assert.equal(gh.state().repos[REPO].issues[0].closed, "not planned")
  assert.match(said.join("\n"), /today's journal holds them/)
  assert.equal(page(ws)[4], "- DOING Ship the site", "nothing is guessed")
})

test("changes are taken every five minutes, at once when a page asks or with now, and a recent edit holds only the scheduled run", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(11, 4, "TODO Write the plan", "DOING")] } } })
  const every = (options) => withEnv({ EXCUDO_GH: gh.path, EXCUDO_PULL_EVERY: "300" }, () => pullInbox(ws, options))
  mkdirSync(ws.cacheDir, { recursive: true })
  const appliedAt = Date.now()
  writeFileSync(join(ws.cacheDir, "pull.json"), JSON.stringify({ appliedAt }))
  const waiting = await every({ clock: () => appliedAt + 1000 })
  assert.equal(waiting.code, 0)
  assert.equal(waiting.waiting, 299, "one second has elapsed in the five-minute interval")
  assert.equal(page(ws)[3], "- TODO Write the plan")
  // A page asked: taken now, and the request closed.
  gh.state((state) => { state.repos[REPO].issues.push(request(12)) })
  const asked = await every()
  assert.deepEqual([asked.code, asked.applied], [0, 1])
  assert.equal(page(ws)[3], "- DOING Write the plan")
  assert.deepEqual(gh.state().repos[REPO].issues.map((item) => [item.number, item.closed]), [[11, "completed"], [12, "completed"]])
  // A recent edit holds a scheduled run, not one the owner asked for.
  gh.state((state) => { state.repos[REPO].issues.push(issue(13, 4, "DOING Write the plan", "DONE")) })
  writeFileSync(join(ws.cacheDir, "pull.json"), JSON.stringify({ appliedAt: 0 }))
  const file = join(ws.graphDir, "projects/Work.md")
  writeFileSync(file, readFileSync(file, "utf8").replace("Current work.", "Current work, just now."))
  const held = await every()
  assert.deepEqual([held.code, held.reason], [75, "busy"])
  const now = await every({ now: true })
  assert.deepEqual([now.code, now.applied], [0, 1])
  assert.equal(page(ws)[3], "- DONE Write the plan")
  assert.equal(subjects(ws, 2)[1], "Save the owner's edits before the website's changes")
  // Only a request waits: it is closed, nothing else happens.
  gh.state((state) => { state.repos[REPO].issues.push(request(14)) })
  assert.equal((await every()).code, 0)
  assert.equal(gh.state().repos[REPO].issues.find((item) => item.number === 14).closed, "completed")
})

test("without an inbox, before setup, without gh or with GitHub down, it says so and changes nothing", async () => {
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [] } } })
  const none = await memo(null)
  assert.deepEqual(await run(none, gh), { code: 0, reason: "no-inbox" })
  const unset = await memo(true)
  assert.equal((await run(unset, gh)).reason, "not-set-up")
  const ws = await memo()
  assert.equal((await pullInbox(ws)).reason, "no-gh", "the test's gh is absent by default")
  gh.state({ down: true })
  assert.deepEqual(await run(ws, gh), { code: 1, reason: "github" })
  assert.equal(pullState(ws).last.reason, "github")
})

test("pull defers network failures in JSON and keeps authentication errors as GitHub failures", async () => {
  const ws = await memo()
  const gh = fakeGh({ repos: {}, errors: { list: "proxyconnect tcp: dial tcp 192.0.2.1:443: i/o timeout" } })
  const call = () => spawnSync(process.execPath, [cli, "site", "pull", "--json"], { cwd: ws.root, encoding: "utf8", timeout: 120000, env: { ...process.env, EXCUDO_GH: gh.path, EXCUDO_HOST_TIMEOUT: "10" } })
  const network = call()
  assert.equal(network.status, 75, network.stderr)
  assert.equal(JSON.parse(network.stdout).reason, "network")
  assert.equal(pullState(ws).last.reason, "network")
  gh.state({ errors: { list: "HTTP 401: authentication required" } })
  const auth = call()
  assert.equal(auth.status, 1, auth.stderr)
  assert.equal(JSON.parse(auth.stdout).reason, "github")
  gh.state({ errors: {}, hang: "list" })
  // The child timeout bounds the whole CLI; module loading is not the fake host's query time.
  assert.equal(call().status, 75)
  assert.equal(git(ws.root, "status", "--porcelain").stdout, "")
})

test("a failed issue close preserves applied counts, leaves the issue open and retries safely", async () => {
  const ws = await memo()
  const gh = fakeGh({ repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(71, 4, "TODO Write the plan", "DONE")] } }, errors: { close: "ECONNRESET" } })
  const held = await run(ws, gh)
  assert.deepEqual([held.code, held.reason, held.applied, held.closed], [75, "network", 1, 0])
  assert.equal(page(ws)[3], "- DONE Write the plan")
  assert.equal(gh.state().repos[REPO].issues[0].closed, undefined)
  gh.state({ errors: {} })
  const retried = await run(ws, gh)
  assert.deepEqual([retried.code, retried.already, retried.closed], [0, 1, 1])
  gh.state({ repos: { [REPO]: { issues: [request(72)] } }, errors: { close: "proxyconnect tcp: i/o timeout" } })
  assert.deepEqual(await run(ws, gh), { code: 75, reason: "network", issues: 0 })
  gh.state({ errors: { close: "HTTP 403: permission denied" } })
  assert.deepEqual(await run(ws, gh), { code: 1, reason: "github", issues: 0 })
})

test("only this website's changes and requests are taken; another memo's issues in the repository are left alone", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(31, 4, "TODO Write the plan", "DONE", "other"), request(32, "other")] } } })
  const left = await run(ws, gh)
  assert.deepEqual([left.code, left.issues], [0, 0])
  assert.equal(page(ws)[3], "- TODO Write the plan")
  assert.deepEqual(gh.state().repos[REPO].issues.map((item) => [item.number, item.closed]), [[31, undefined], [32, undefined]])
  gh.state((state) => { state.repos[REPO].issues.push(issue(33, 5, "DOING Ship the site", "DONE")) })
  const taken = await run(ws, gh)
  assert.deepEqual([taken.code, taken.applied], [0, 1])
  assert.equal(page(ws)[4], "- DONE Ship the site")
  assert.deepEqual(gh.state().repos[REPO].issues.map((item) => [item.number, item.closed]), [[31, undefined], [32, undefined], [33, "completed"]])
})

test("without git nothing is written and no issue is closed, since only a commit lets the issues go", async () => {
  const ws = await memo(undefined, { repository: false })
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(41, 4, "TODO Write the plan", "DONE")] } } })
  assert.deepEqual(await run(ws, gh), { code: 75, reason: "no-git" })
  assert.equal(page(ws)[3], "- TODO Write the plan")
  assert.equal(gh.state().repos[REPO].issues[0].closed, undefined)
})

test("a publish that has to wait after the memo took changes is kept and tried again later", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(51, 4, "TODO Write the plan", "DONE")] } } })
  const taken = await run(ws, gh)
  assert.equal(taken.applied, 1)
  assert.notEqual(taken.publish, "published", "the test's Vercel CLI is absent")
  assert.equal(pullState(ws).publish.reason, taken.publish)
  const every = (options) => withEnv({ EXCUDO_GH: gh.path, EXCUDO_PULL_EVERY: "300" }, () => pullInbox(ws, options))
  assert.equal((await every()).publish, undefined, "tried again only after five minutes")
  assert.equal((await every({ now: true })).publish, taken.publish, "or when asked")
  assert.equal((await run(ws, gh)).publish, taken.publish, "and every five minutes while it waits")
})

test("excudo site pull runs from the command line and answers in JSON", async () => {
  const ws = await memo()
  const gh = fakeGh({ user: "me", repos: { [REPO]: { visibility: "PRIVATE", issues: [issue(21, 4, "TODO Write the plan", "DONE")] } } })
  const call = (...args) => spawnSync(process.execPath, [cli, "site", "pull", ...args], { cwd: ws.root, encoding: "utf8", env: { ...process.env, EXCUDO_GH: gh.path, EXCUDO_PULL_EVERY: "0" } })
  const dry = call("--dry-run", "--json")
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(JSON.parse(dry.stdout).applied, 1)
  const done = call("--now")
  assert.equal(done.status, 0, done.stderr)
  assert.match(done.stdout, /From the website: 1 applied/)
  assert.equal(page(ws)[3], "- DONE Write the plan")
  assert.notEqual(call("--force").status, 0, "an option pull does not take stops it")
})
