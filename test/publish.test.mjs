import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { test as nodeTest } from "node:test"
// These fixtures launch POSIX executables directly; Windows cannot execute their shebangs.
const test = process.platform === "win32" ? nodeTest.skip : nodeTest
import { fileURLToPath, pathToFileURL } from "node:url"
import { publishOf, publishSite, publishState, publishStatus, setupSite } from "../src/index.mjs"
import { ghRun, hostRun, hostTimeout, isNetworkFailure } from "../src/github.mjs"
import { fakeGh, put, tempDir, withEnv, workspace } from "./helpers.mjs"

const cli = fileURLToPath(new URL("../bin/excudo.mjs", import.meta.url))

/*
 * A stand-in for the Vercel CLI: it keeps its account in a state file beside it and writes every call,
 * with the environment that matters, to a log. Logging in prints the device page the real CLI prints
 * and succeeds a moment later, as if the owner had allowed the device.
 */
const FAKE_VERCEL = `#!/usr/bin/env node
const fs = require("fs"), path = require("path")
const dir = __dirname, stateFile = path.join(dir, "state.json")
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {}
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({ args, cwd: process.cwd(), ceiling: process.env.GIT_CEILING_DIRECTORIES, ci: process.env.CI }) + "\\n")
const [a, b] = args
const step = [a, b].filter(Boolean).join(" ")
if (state.failure && [a, step].includes(state.failure.step)) { console.error(state.failure.message); process.exit(1) }
if ([a, step].includes(state.hang)) {
  const child = require("child_process").spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: "inherit" })
  fs.writeFileSync(path.join(dir, "pids.json"), JSON.stringify([process.pid, child.pid]))
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1000)
  return
}
const input = () => { try { return fs.readFileSync(0, "utf8") } catch { return "" } }
if (a === "whoami") { if (state.user) { console.log(state.user); process.exit(0) } console.error("Error: not logged in"); process.exit(1) }
if (a === "login") {
  console.log("  Visit \\x1b]8;;https://vercel.com/oauth/device?user_code=ABCD-EFGH\\x07vercel.com/device\\x1b]8;;\\x07 and enter ABCD-EFGH")
  setTimeout(() => { state.user = "owner"; save(); process.exit(0) }, 200)
} else if (a === "project" && b === "create") { state.created = args[2]; save() }
else if (a === "link") {
  fs.mkdirSync(path.join(process.cwd(), ".vercel"), { recursive: true })
  fs.writeFileSync(path.join(process.cwd(), ".vercel/project.json"), JSON.stringify({ projectId: state.projectId ?? "prj_1", orgId: "team_1", projectName: args[args.indexOf("--project") + 1] }))
} else if (a === "project" && b === "protection") console.log(JSON.stringify({ projectId: "prj_1", ssoProtection: state.protection ? { deploymentType: state.protection } : null }))
else if (a === "api" && args.includes("PATCH")) { const body = JSON.parse(input()); if (!state.refuseProtection) state.protection = body.ssoProtection.deploymentType; state.patched = b; save() }
else if (a === "api" && b.includes("/env")) {
  // The owner adds the token on the dashboard after a while: tokenAfter counts the looks until then.
  if (typeof state.tokenAfter === "number" && --state.tokenAfter <= 0) { state.envs = [{ key: "EXCUDO_INBOX_TOKEN", target: ["production"], type: "sensitive", updatedAt: 1000 }]; delete state.tokenAfter }
  save(); console.log(JSON.stringify({ envs: state.envs ?? [] }))
}
else if (a === "api" && b.startsWith("/v2/teams/")) console.log(JSON.stringify({ slug: "team" }))
else if (a === "api" && b === "/v2/user") console.log(JSON.stringify({ user: { username: "owner" } }))
else if (a === "api" && b.includes("/domains")) console.log(JSON.stringify({ domains: [{ name: "memo-abc-team.vercel.app" }, { name: "old.vercel.app", redirect: "memo.vercel.app" }, { name: "memo.vercel.app" }] }))
else if (a === "deploy") { state.deploys = (state.deploys ?? 0) + 1; save(); console.log("https://memo-d" + state.deploys + "-team.vercel.app") }
else { console.error("unknown " + args.join(" ")); process.exit(9) }
`
/** A link opener the owner could set: it writes what it opened and prints a handle to close it by. */
const FAKE_OPEN = `#!/usr/bin/env node
const fs = require("fs"), path = require("path")
const url = process.argv.at(-1), action = process.argv[2]
fs.appendFileSync(path.join(__dirname, "links.jsonl"), JSON.stringify({ action, url, purpose: process.env.EXCUDO_LINK }) + "\\n")
if (action === "open") console.log("tab-" + (process.env.EXCUDO_LINK ?? ""))
`

function fake() {
  const dir = tempDir("excudo-vercel-")
  const write = (name, text) => { writeFileSync(join(dir, name), text); chmodSync(join(dir, name), 0o755) }
  write("vercel", FAKE_VERCEL)
  write("open.js", FAKE_OPEN)
  const lines = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []
  return {
    dir, cli: join(dir, "vercel"),
    publish: { open: [process.execPath, join(dir, "open.js"), "open"], close: [process.execPath, join(dir, "open.js"), "close"], copy: false },
    calls: () => lines("calls.jsonl"), links: () => lines("links.jsonl"),
    account: (change) => {
      const file = join(dir, "state.json")
      const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
      if (change) writeFileSync(file, JSON.stringify({ ...state, ...change }))
      return state
    },
  }
}

/** Runs `body` with EXCUDO_VERCEL pointing at the stand-in (or at nothing). */
async function withCli(path, body) {
  const before = process.env.EXCUDO_VERCEL
  process.env.EXCUDO_VERCEL = path
  try { return await body() } finally { if (before === undefined) delete process.env.EXCUDO_VERCEL; else process.env.EXCUDO_VERCEL = before }
}

const memo = (publish, site = {}) => workspace({ "Work.md": "# Work\nCurrent work.\n\n- TODO Ship the site\n" }, { locale: "en", site: { ...site, publish } })

test("host deadlines use separate query and deployment overrides and kill the whole child group", async () => {
  await withEnv({ EXCUDO_HOST_TIMEOUT: undefined, EXCUDO_DEPLOY_TIMEOUT: undefined }, () => {
    assert.equal(hostTimeout(), 60_000)
    assert.equal(hostTimeout(true), 600_000)
  })
  await withEnv({ EXCUDO_HOST_TIMEOUT: "1", EXCUDO_DEPLOY_TIMEOUT: "2" }, () => {
    assert.equal(hostTimeout(), 1000)
    assert.equal(hostTimeout(true), 2000)
  })
  for (const value of ["", "0", "-1", "no", "Infinity", "2147481"]) await withEnv({ EXCUDO_HOST_TIMEOUT: value }, () => assert.equal(hostTimeout(), 60_000))
  const host = fake()
  // A native child starts promptly even when many test processes are starting their JS runtimes.
  writeFileSync(host.cli, '#!/bin/sh\ntrap "" TERM\nsleep 30 &\nprintf "%s\\n" "$$ $!" > "$0.pids"\nwait\n')
  const start = Date.now()
  const result = hostRun(host.cli, ["whoami"], { timeout: 1000 })
  assert.equal(result.error.code, "ETIMEDOUT")
  assert.equal(result.status, null)
  assert.ok(Date.now() - start < 4000, "a descendant holding stdout cannot keep the call alive")
  await new Promise((done) => setTimeout(done, 100))
  assert.ok(Number.isInteger(result.pid) && result.pid > 0)
  assert.throws(() => process.kill(-result.pid, 0), { code: "ESRCH" }, "the command's entire process group is gone, even if it had not written its pids yet")
  if (existsSync(`${host.cli}.pids`)) for (const pid of readFileSync(`${host.cli}.pids`, "utf8").trim().split(/\s+/).map(Number)) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  const missing = hostRun(join(host.dir, "missing"), [])
  assert.equal(missing.error.code, "ENOENT")
  const gh = fakeGh({ hang: "list", repos: {} })
  await withEnv({ EXCUDO_HOST_TIMEOUT: "0.1" }, () => assert.equal(ghRun(gh.path, ["issue", "list"]).error.code, "ETIMEDOUT"))
})

test("the publishing settings default to a project named after the folder and a folder of their own, and refuse what would leak", async () => {
  const ws = await memo(undefined)
  const settings = publishOf(ws)
  assert.equal(settings.host, "vercel")
  assert.equal(settings.project, `${basename(ws.root).toLowerCase()}-memo`)
  assert.equal(settings.path, join(ws.root, ".excudo/publish"))
  assert.equal(settings.copy, true)
  for (const [publish, field] of [
    [{ host: "netlify" }, "publish.host"], [{ project: "My Memo" }, "publish.project"], [{ project: "a---b" }, "publish.project"],
    [{ dir: "notes/out" }, "publish.dir"], [{ dir: "." }, "publish.dir"], [{ open: "open" }, "publish.open"], [{ close: [] }, "publish.close"],
    [{ copy: "yes" }, "publish.copy"], [{ token: "x" }, "publish.token"], [{ dir: ".excudo" }, "publish.dir"],
  ]) {
    const bad = await memo(publish)
    assert.throws(() => publishOf(bad), new RegExp(field.replace(".", "\\.")), JSON.stringify(publish))
  }
  // The website written into the publishing folder is fine only as its site/ folder.
  const shared = await memo({ dir: ".excudo/deploy" }, { out: ".excudo/deploy/site" })
  assert.equal(publishOf(shared).path, join(shared.root, ".excudo/deploy"))
  const clash = await memo({ dir: ".excudo/deploy" }, { out: ".excudo/deploy/pages" })
  assert.throws(() => publishOf(clash), /publish\.dir/)
  const nested = await memo({ dir: ".excudo/site/up" })
  assert.throws(() => publishOf(nested), /publish\.dir/)
})

test("network failures cover host deadlines and connection errors, but leave auth and permissions alone", () => {
  assert.equal(isNetworkFailure({ error: { code: "ETIMEDOUT" }, status: null }), true)
  assert.equal(isNetworkFailure({ status: null, signal: "SIGKILL" }), true)
  for (const message of ["ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "getaddrinfo", "proxyconnect tcp", "i/o timeout", "dial tcp", "error connecting to", "could not resolve host", "socket hang up", "AggregateError"]) {
    for (const stream of ["stdout", "stderr"]) assert.equal(isNetworkFailure({ status: 1, [stream]: message }), true, `${stream}: ${message}`)
  }
  for (const message of ["not logged in", "HTTP 401", "HTTP 403", "permission denied", "invalid token"]) assert.equal(isNetworkFailure({ status: 1, stderr: message }), false)
  assert.equal(isNetworkFailure({ status: 0, stdout: "ETIMEDOUT.md" }), false)
  assert.equal(isNetworkFailure({ status: null, error: { code: "ENOENT" } }), false)
})

test("publishing defers at every failed network step and never mistakes it for a missing login", async () => {
  const host = fake()
  const ws = await memo(host.publish, { inbox: { github: { repo: "owner/inbox" } } })
  const said = []
  const call = () => publishSite(ws, { say: (line) => said.push(line) })
  host.account({ user: "owner", protection: "all" })
  await withCli(host.cli, async () => {
    assert.equal(call().reason, "not-linked")
    spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(ws.root, ".excudo/publish") })
    for (const step of ["whoami", "project protection", "api /v9/projects/prj_1/env?teamId=team_1", "api /v9/projects/prj_1/domains?teamId=team_1", "deploy"]) {
      for (const message of ["connect ETIMEDOUT", "AggregateError: connection failed"]) {
        host.account({ failure: { step, message } })
        assert.deepEqual(call(), { code: 75, published: false, reason: "network" }, `${step}: ${message}`)
        assert.match(said.at(-1), /Could not reach Vercel \(.+\); nothing was published\. The next run tries again\./)
        assert.doesNotMatch(said.at(-1), /Not logged in|site setup/)
      }
    }
    host.account({ failure: null, hang: "whoami" })
    // Let the fake CLI start under parallel load before checking that its hung process tree dies.
    await withEnv({ EXCUDO_HOST_TIMEOUT: "10" }, () => assert.equal(call().reason, "network"))
    await new Promise((done) => setTimeout(done, 100))
    for (const pid of JSON.parse(readFileSync(join(host.dir, "pids.json"), "utf8"))) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
    host.account({ hang: null, user: null })
    assert.equal(call().reason, "not-logged-in")
  })
  assert.match(readFileSync(join(ws.cacheDir, "publish.log"), "utf8"), /ETIMEDOUT[\s\S]*AggregateError/)
  assert.equal(host.account().deploys, undefined)
})

test("setup takes a new owner from nothing to a guarded, published and opened website, and publishing again changes nothing", async () => {
  const host = fake()
  const ws = await memo(host.publish)
  const said = []
  const result = await withCli(host.cli, () => setupSite(ws, { say: (line) => said.push(line) }))
  assert.equal(result.code, 0, said.join("\n"))
  const publishDir = join(ws.root, ".excudo/publish")
  // The calls, in order, each made from the publishing folder with git kept from looking above it.
  const calls = host.calls()
  assert.deepEqual(calls.map((call) => call.args.slice(0, 2).join(" ")), [
    "whoami", "login", "whoami", "project create", "link --yes", "project protection", `api /v9/projects/prj_1?teamId=team_1`, "project protection",
    "whoami", "project protection", `api /v9/projects/prj_1/domains?teamId=team_1`, "deploy --prod",
  ])
  assert.ok(calls.every((call) => call.cwd.endsWith(join(".excudo", "publish")) && call.ceiling === dirname(publishDir)), JSON.stringify(calls[0]))
  assert.equal(calls.find((call) => call.args[0] === "login").ci, "1", "the CLI does not open a browser itself")
  assert.equal(host.account().created, `${basename(ws.root).toLowerCase()}-memo`)
  assert.equal(host.account().protection, "all")
  // The approval page opened as a login link and closed again; the website opened as a site link.
  assert.deepEqual(host.links(), [
    { action: "open", url: "https://vercel.com/oauth/device?user_code=ABCD-EFGH", purpose: "login" },
    { action: "close", url: "tab-login", purpose: "login" },
    { action: "open", url: "https://memo.vercel.app", purpose: "site" },
  ])
  // The folder holds the website and the host's settings; the address is the project's own.
  assert.ok(existsSync(join(publishDir, "site/index.html")))
  assert.equal(JSON.parse(readFileSync(join(publishDir, "vercel.json"), "utf8")).outputDirectory, "site")
  // Only the website and its settings may leave: the ignore file lets nothing else through.
  assert.deepEqual(readFileSync(join(publishDir, ".vercelignore"), "utf8").split("\n").filter((line) => line && !line.startsWith("#")), ["/*", "!/site", "!/api", "!/vercel.json"])
  const state = publishState(ws)
  assert.equal(state.url, "https://memo.vercel.app")
  assert.equal(state.deployment, "https://memo-d1-team.vercel.app")
  assert.match(said.join("\n"), /\[1\/5\] The website[\s\S]*\[5\/5\] Publish and open[\s\S]*Published: https:\/\/memo\.vercel\.app[\s\S]*Address: https:\/\/memo\.vercel\.app/)
  // Again: nothing changed, so no deployment; forced, or with a changed memo, a new one.
  await withCli(host.cli, () => {
    assert.deepEqual(publishSite(ws), { code: 0, published: false, url: "https://memo.vercel.app" })
    assert.equal(publishSite(ws, { force: true }).published, true)
    put(ws.root, "Work.md", "# Work\nCurrent work, changed.\n\n- TODO Ship the site\n")
    assert.equal(publishSite(ws).published, true)
  })
  assert.equal(host.account().deploys, 3)
  // A second setup finds everything done and only publishes what changed (nothing) and opens it.
  const again = await withCli(host.cli, () => setupSite(ws))
  assert.equal(again.code, 0)
  assert.equal(host.calls().filter((call) => call.args[0] === "login").length, 1)
})

test("publishing waits for the owner when the host is not ready, and never publishes an unguarded website", async () => {
  const host = fake()
  const ws = await memo(host.publish)
  const said = []
  const say = (line) => said.push(line)
  await withCli(join(host.dir, "missing"), () => assert.deepEqual(publishSite(ws, { say }), { code: 75, published: false, reason: "no-cli" }))
  await withCli(host.cli, () => {
    assert.equal(publishSite(ws, { say }).reason, "not-logged-in")
    host.account({ user: "owner" })
    assert.equal(publishSite(ws, { say }).reason, "not-linked")
    spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(ws.root, ".excudo/publish") })
    assert.equal(publishSite(ws, { say }).reason, "unprotected")
    host.account({ protection: "prod_deployment_urls_and_all_previews" })
    assert.equal(publishSite(ws, { say }).reason, "unprotected")
  })
  assert.equal(host.account().deploys, undefined, "nothing was deployed")
  assert.match(said.join("\n"), /run excudo site setup[\s\S]*now: prod_deployment_urls_and_all_previews/)
  // A setup whose protection Vercel refuses opens the dashboard and waits.
  host.account({ refuseProtection: true })
  const setup = await withCli(host.cli, () => setupSite(ws, { say }))
  assert.equal(setup.code, 75)
  assert.equal(host.links().at(-1).purpose, "dashboard")
})

test("another project is published anew, and status says where publishing stands", async () => {
  const host = fake()
  const ws = await memo(host.publish)
  const say = () => {}
  const link = () => spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(ws.root, ".excudo/publish") })
  host.account({ user: "owner", protection: "all" })
  await withCli(host.cli, () => {
    assert.equal(publishSite(ws, { say }).reason, "not-linked")
    link()
    assert.equal(publishSite(ws, { say }).published, true)
    assert.equal(publishSite(ws, { say }).published, false)
    host.account({ projectId: "prj_2" })
    link()
    assert.equal(publishSite(ws, { say }).published, true, "another project starts with no deployment")
  })
  const status = await withCli(host.cli, () => publishStatus(ws))
  assert.deepEqual({ ...status, at: Boolean(status.at) }, {
    host: "vercel", cli: true, user: "owner", project: { name: "memo", id: "prj_2" }, protection: "all", url: "https://memo.vercel.app",
    deployment: "https://memo-d2-team.vercel.app", at: true, dir: status.dir, log: status.log, inbox: null, protectionAt: status.protectionAt, reachable: true,
  })
})

test("an unchanged website uses fresh protection without any host calls, then rechecks after a day", async () => {
  const host = fake()
  const ws = await memo(host.publish, { inbox: { github: { repo: "owner/inbox" } } })
  host.account({ user: "owner", protection: "all" })
  await withCli(host.cli, () => {
    assert.equal(publishSite(ws).reason, "not-linked")
    spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(ws.root, ".excudo/publish") })
    assert.equal(publishSite(ws).published, true)
    const calls = host.calls().length
    host.account({ failure: { step: "whoami", message: "ENOTFOUND" } })
    assert.equal(publishSite(ws).code, 0)
    assert.equal(host.calls().length, calls, "even login, protection and the token need no call")
    const change = (protectionAt, more = {}) => writeFileSync(join(ws.cacheDir, "publish.json"), JSON.stringify({ ...publishState(ws), protectionAt, ...more }))
    for (const at of [undefined, "invalid", new Date(Date.now() + 60_000).toISOString(), new Date(Date.now() - 25 * 60 * 60_000).toISOString()]) {
      change(at)
      assert.equal(publishSite(ws).reason, "network", String(at))
    }
    change(new Date().toISOString())
    assert.equal(publishSite(ws, { force: true }).reason, "network", "force never trusts the cached protection")
    put(ws.root, "Work.md", "# Work\nChanged.\n\n- TODO Ship the site\n")
    assert.equal(publishSite(ws).reason, "network", "a changed site always checks the host")
    host.account({ failure: null, protection: "none" })
    assert.equal(publishSite(ws).reason, "unprotected")
    assert.equal(host.account().deploys, 1, "protection still guards every deployment")
  })
})

test("status shows stored facts first, bounds live queries to ten seconds and never calls an outage a missing login", async () => {
  const host = fake()
  const ws = await memo(host.publish, { inbox: { github: { repo: "owner/inbox" }, schedule: false } })
  host.account({ user: "owner", protection: "all", envs: [{ key: "EXCUDO_INBOX_TOKEN", target: ["production"], updatedAt: 1000 }] })
  await withCli(host.cli, () => {
    assert.equal(publishSite(ws).reason, "not-linked")
    spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(ws.root, ".excudo/publish") })
    assert.equal(publishSite(ws).published, true)
  })
  host.account({ hang: "whoami" })
  const calls = host.calls().length
  const events = []
  const status = await withEnv({ EXCUDO_HOST_TIMEOUT: "1" }, () => withCli(host.cli, () => publishStatus(ws, {
    onCached: (known) => { assert.equal(host.calls().length, calls); assert.equal(known.url, "https://memo.vercel.app"); assert.equal(known.inbox.tokenAt, 1000); events.push("cached") },
    onLive: (field, value, { reachable }) => { events.push(field); assert.equal(reachable, false); assert.equal(value, null) },
  })))
  assert.deepEqual(events, ["cached", "login"])
  assert.equal(status.reachable, false)
  assert.equal(status.inbox.tokenAt, 1000)
  const json = spawnSync(process.execPath, [cli, "site", "status", "--json"], { cwd: ws.root, encoding: "utf8", env: { ...process.env, EXCUDO_VERCEL: host.cli, EXCUDO_HOST_TIMEOUT: "1" }, timeout: 60000 })
  assert.equal(json.status, 0, json.stderr)
  assert.equal(JSON.parse(json.stdout).reachable, false)
  // The CLI's default status limit is ten seconds, even though host queries normally get sixty.
  const started = Date.now()
  let output = "", errors = "", cachedAt = null
  const child = spawn(process.execPath, [cli, "site", "status"], { cwd: ws.root, env: { ...process.env, EXCUDO_VERCEL: host.cli, EXCUDO_HOST_TIMEOUT: "60" } })
  child.stdout.on("data", (chunk) => { output += chunk; if (cachedAt === null && output.includes("Address: https://memo.vercel.app")) cachedAt = Date.now() })
  child.stderr.on("data", (chunk) => { errors += chunk })
  const code = await new Promise((done) => child.on("close", done))
  assert.equal(code, 0, errors)
  assert.ok(Date.now() - started < 14_000, "status uses ten seconds instead of the normal host query limit")
  assert.ok(cachedAt && Date.now() - cachedAt > 8000, "cached facts appear before the live deadline")
  assert.match(output, /Address: https:\/\/memo.vercel.app[\s\S]*Inbox: owner\/inbox[\s\S]*Token last updated: 1970-01-01T00:00:01.000Z[\s\S]*Login: host unreachable/)
  assert.doesNotMatch(output, /Login: none|Login:.*setup/)
  await new Promise((done) => setTimeout(done, 100))
  for (const pid of JSON.parse(readFileSync(join(host.dir, "pids.json"), "utf8"))) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
  host.account({ hang: null, failure: { step: "project protection", message: "ECONNREFUSED" } })
  const lines = []
  const partial = await withCli(host.cli, () => publishStatus(ws, { onLive: (field, value, { reachable }) => lines.push([field, reachable]) }))
  assert.equal(partial.user, "owner")
  assert.equal(partial.reachable, false)
  assert.deepEqual(lines, [["login", true], ["protection", false], ["token", true]])
})

test("open before publishing opens this computer's website, and the commands speak through the CLI", async () => {
  const host = fake()
  const ws = await memo(host.publish)
  const run = (...args) => spawnSync(process.execPath, [cli, "site", ...args], { cwd: ws.root, encoding: "utf8", env: { ...process.env, EXCUDO_VERCEL: host.cli } })
  const publish = run("publish")
  assert.equal(publish.status, 75, publish.stderr)
  assert.match(publish.stdout, /Not logged in to Vercel: run excudo site setup\./)
  const opened = run("open")
  assert.equal(opened.status, 0, opened.stderr)
  assert.match(opened.stdout, /opening the website on this computer: file:\/\//)
  assert.equal(host.links().at(-1).purpose, "site")
  assert.match(host.links().at(-1).url, /^file:\/\/.*index\.html$/)
  const status = run("status", "--json")
  assert.equal(status.status, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).user, null)
  const words = run("status")
  assert.match(words.stdout, /Login: none \(run excudo site setup\)/)
})

test("an option a site action does not take stops it before anything runs, and a missing exporter is a wait, not a failure", async () => {
  const host = fake()
  const ws = await memo(host.publish)
  const env = { ...process.env, EXCUDO_VERCEL: host.cli }
  for (const args of [["setup", "--dry-run"], ["publish", "--dry-run"], ["open", "--force"], ["status", "--project", "x"]]) {
    const run = spawnSync(process.execPath, [cli, "site", ...args], { cwd: ws.root, encoding: "utf8", env })
    assert.equal(run.status, 2, `${args.join(" ")}: ${run.stdout}${run.stderr}`)
    assert.match(run.stderr, new RegExp(`${args[1]} does not go with site ${args[0]}`))
  }
  assert.deepEqual(host.calls(), [], "no action reached the host")
  // Without cudoc-export the schedule waits for setup (75) and nothing reaches the host.
  const hook = join(tempDir(), "no-exporter.mjs")
  writeFileSync(hook, 'import { registerHooks } from "node:module"\nregisterHooks({ resolve(specifier, context, next) { if (specifier === "cudoc-export") throw Object.assign(new Error("Cannot find module cudoc-export"), { code: "MODULE_NOT_FOUND" }); return next(specifier, context) } })\n')
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(hook).href, cli, "site", "publish"], { cwd: ws.root, encoding: "utf8", env })
  assert.equal(run.status, 75, run.stdout + run.stderr)
  assert.match(run.stdout, /needs cudoc-export, so nothing was published: run excudo site setup/)
  assert.deepEqual(host.calls(), [])
})

test("with an inbox the publishing folder holds the inbox functions: they keep a checked batch as an issue, say what the memo has not taken, and ask it to take them now", async () => {
  const host = fake()
  const ws = await memo(host.publish, { inbox: { github: { repo: "owner/memo-inbox" } } })
  const gh = fakeGh({ user: "owner", repos: { "owner/memo-inbox": { visibility: "PRIVATE", issuesOn: true, issues: [] } } })
  host.account({ envs: [{ key: "EXCUDO_INBOX_TOKEN", target: ["production"], updatedAt: 1000 }] })
  const result = await withEnv({ EXCUDO_GH: gh.path }, () => withCli(host.cli, () => setupSite(ws)))
  assert.equal(result.code, 0)
  const api = join(ws.root, ".excudo/publish/api")
  assert.deepEqual(["edit.mjs", "sync.mjs", "_github.mjs", "_edits.mjs", "_inbox.mjs"].map((name) => existsSync(join(api, name))), [true, true, true, true, true])
  const page = readFileSync(join(ws.root, ".excudo/publish/site/index.html"), "utf8")
  assert.match(page, /connect-src &#x27;self&#x27;"/, "the pages may ask their own website, and nothing else")
  const index = readFileSync(join(ws.root, ".excudo/publish/site/excudo-memo.js"), "utf8")
  assert.match(index, /"inbox":\{"endpoint":"api\/edit","sync":"api\/sync"\}/)
  const site = JSON.parse(index.match(/"site":("[^"]+")/)[1])
  assert.deepEqual((await import(pathToFileURL(join(api, "_inbox.mjs")).href)).default, { repo: "owner/memo-inbox", site })

  // The function as Vercel runs it: its own address, the owner's token in the environment, GitHub answered here.
  const { GET, POST } = await import(pathToFileURL(join(api, "edit.mjs")).href)
  const sent = []
  const realFetch = globalThis.fetch
  const before = process.env.EXCUDO_INBOX_TOKEN
  // GitHub as the function sees it: lists of open and closed issues, and a new issue's number.
  const lists = { open: [], closed: [] }
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url, init })
    if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify(url.includes("state=open") ? lists.open : lists.closed), { status: 200 })
    return new Response(JSON.stringify({ number: 12 }), { status: 201 })
  }
  const entry = { id: "change-0001", kind: "task", page: "Work.md", line: 4, hash: "0123456789", from: "TODO", to: "DONE", at: "2026-10-28T01:00:00.000Z" }
  const ask = (body, headers = {}) => POST(new Request("https://memo.vercel.app/api/edit", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin: "https://memo.vercel.app", "x-excudo-edit": "1", "content-type": "application/json", ...headers } }))
  const batch = (more = {}) => ({ format: "excudo-changes", version: 1, site, entries: [entry], ...more })
  try {
    delete process.env.EXCUDO_INBOX_TOKEN
    const look = (headers = { "x-excudo-edit": "1" }) => GET(new Request("https://memo.vercel.app/api/edit?view=state", { headers }))
    assert.deepEqual(await (await GET(new Request("https://memo.vercel.app/api/edit"))).json(), { inbox: true, ready: false }, "without the owner's token the pages offer nothing")
    assert.deepEqual(await (await look()).json(), { inbox: true, ready: false })
    assert.equal((await ask(batch())).status, 503)
    process.env.EXCUDO_INBOX_TOKEN = "token-from-the-environment"
    assert.deepEqual(await (await GET(new Request("https://memo.vercel.app/api/edit"))).json(), { inbox: true, ready: true })
    assert.equal((await ask(batch(), { origin: "https://elsewhere.test" })).status, 403, "another website's page is refused")
    assert.equal((await ask(batch(), { "x-excudo-edit": "" })).status, 403, "a plain form post is refused")
    assert.equal((await ask(batch(), { origin: "https://memo-d1-team.vercel.app", "x-forwarded-host": "memo-d1-team.vercel.app" })).status, 201, "a deployment's own address is its own")
    sent.length = 0
    assert.equal((await ask(batch({ site: "another-site" }))).status, 400, "a batch for another website is refused")
    assert.deepEqual(await (await ask(batch({ entries: [{ ...entry, page: "../out.md" }] }))).json(), { error: "entries[0].page" })
    assert.equal((await ask("x".repeat(70000))).status, 413)
    assert.equal(sent.length, 0, "nothing refused reaches GitHub")
    const answer = await ask(batch({ entries: [{ ...entry, text: "words stay on the page" }] }))
    assert.equal(answer.status, 201)
    assert.deepEqual(await answer.json(), { ok: true, issue: 12, ids: ["change-0001"] })
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, "https://api.github.com/repos/owner/memo-inbox/issues")
    assert.equal(sent[0].init.headers.authorization, "Bearer token-from-the-environment")
    const issue = JSON.parse(sent[0].init.body)
    assert.equal(issue.title, "excudo-changes: 1 change")
    assert.ok(issue.body.startsWith("<!-- excudo-changes -->"))
    assert.doesNotMatch(issue.body, /words stay on the page/, "the issue holds addresses only")
    // What the memo has not taken: open issues of this website, then what it took since, by issue.
    const { issueBody: body, syncBody } = await import(pathToFileURL(join(api, "_edits.mjs")).href)
    const of = (id, to) => ({ ...entry, id, to })
    lists.open = [
      { number: 32, state: "open", body: syncBody("elsewhere", "2026-10-28T03:00:00Z"), created_at: "2026-10-28T03:00:00Z" },
      { number: 31, state: "open", body: syncBody(site, "2026-10-28T02:00:00Z"), created_at: "2026-10-28T02:00:00Z" },
      { number: 30, state: "open", body: body(batch({ entries: [of("change-0030", "DOING")] })) },
      { number: 29, state: "open", body: body(batch({ site: "elsewhere", entries: [of("change-0029", "DONE")] })) },
      { number: 28, state: "open", body: "Someone wrote this." },
      { number: 27, state: "open", pull_request: {}, body: body(batch({ entries: [of("change-0027", "DONE")] })) },
    ]
    lists.closed = [
      { number: 26, state: "closed", state_reason: "completed", closed_at: "2026-10-28T01:30:00Z", body: body(batch({ entries: [of("change-0026", "WAITING")] })) },
      { number: 25, state: "closed", state_reason: "not_planned", closed_at: "2026-10-28T01:20:00Z", body: body(batch({ entries: [of("change-0025", "DONE")] })) },
    ]
    assert.equal((await look({})).status, 403, "only the website's own script asks")
    const state = await (await look()).json()
    assert.deepEqual(state.changes.map(({ id, issue, state: held }) => [id, issue, held]), [["change-0025", 25, "closed"], ["change-0026", 26, "applied"], ["change-0030", 30, "open"]])
    assert.deepEqual([state.appliedAt, state.sync], ["2026-10-28T01:30:00Z", { issue: 31, at: "2026-10-28T02:00:00Z" }])
    assert.equal(JSON.stringify(state).includes("Someone wrote this"), false)

    // Bring in now: one request issue, named again while it is open.
    const { POST: SYNC } = await import(pathToFileURL(join(api, "sync.mjs")).href)
    const bring = (headers = {}) => SYNC(new Request("https://memo.vercel.app/api/sync", { method: "POST", headers: { origin: "https://memo.vercel.app", "x-excudo-edit": "1", ...headers } }))
    assert.equal((await bring({ origin: "https://elsewhere.test" })).status, 403)
    sent.length = 0
    assert.deepEqual(await (await bring()).json(), { ok: true, issue: 31, at: "2026-10-28T02:00:00Z" })
    assert.equal(sent.filter((call) => call.init.method === "POST").length, 0, "no second request")
    lists.open = lists.open.filter((issue) => issue.number !== 31)
    const made = await bring()
    assert.equal(made.status, 201, "another website's request is not this one's")
    const request = JSON.parse(sent.find((call) => call.init.method === "POST").init.body)
    assert.equal(request.title, "excudo-sync: bring the changes in now")
    assert.match(request.body, /^<!-- excudo-sync -->/)

    globalThis.fetch = async () => new Response("{}", { status: 401 })
    assert.deepEqual(await (await ask(batch())).json(), { error: "github", status: 401 })
    assert.deepEqual(await (await look()).json(), { inbox: true, ready: true, error: "github" }, "the pages go on with what they hold")
    assert.equal((await bring()).status, 502)
    const { github } = await import(pathToFileURL(join(api, "_github.mjs")).href)
    const timeout = AbortSignal.timeout
    const deadlines = []
    try {
      for (const name of ["TimeoutError", "AbortError"]) {
        AbortSignal.timeout = (ms) => { deadlines.push(ms); return AbortSignal.abort(new DOMException("GitHub did not answer", name)) }
        globalThis.fetch = async (url, init) => { init.signal.throwIfAborted() }
        assert.deepEqual(await github("/issues"), { error: "github-timeout" })
        const timedPost = await ask(batch())
        assert.equal(timedPost.status, 502)
        assert.deepEqual(await timedPost.json(), { error: "github-timeout" })
        assert.deepEqual(await (await look()).json(), { inbox: true, ready: true, error: "github-timeout" })
        const timedSync = await bring()
        assert.equal(timedSync.status, 502)
        assert.deepEqual(await timedSync.json(), { error: "github-timeout" })
        // A sync that read successfully can also time out while creating its request.
        let calls = 0
        globalThis.fetch = async (url, init) => { if (++calls > 1) init.signal.throwIfAborted(); return new Response("[]") }
        assert.deepEqual(await (await bring()).json(), { error: "github-timeout" })
      }
      assert.ok(deadlines.length >= 10)
      assert.ok(deadlines.every((ms) => ms === 8000), "every GitHub request has an eight-second deadline")
    } finally { AbortSignal.timeout = timeout }
  } finally {
    globalThis.fetch = realFetch
    if (before === undefined) delete process.env.EXCUDO_INBOX_TOKEN; else process.env.EXCUDO_INBOX_TOKEN = before
  }
})

test("with inbox: true, setup logs in to GitHub, makes the private repository, waits for the token on Vercel, publishes and schedules site pull", async () => {
  const host = fake()
  const ws = await memo(host.publish, { inbox: true })
  const gh = fakeGh({ repos: {} })
  host.account({ tokenAfter: 3 })
  const said = []
  const result = await withEnv({ EXCUDO_GH: gh.path }, () => withCli(host.cli, () => setupSite(ws, { say: (line) => said.push(line) })))
  assert.equal(result.code, 0, said.join("\n"))
  const project = `${basename(ws.root).toLowerCase()}-memo`
  const repo = `owner/${project}-inbox`
  // GitHub: the device login, then the repository, private.
  assert.deepEqual(gh.calls().map((call) => call.slice(0, 2).join(" ")).filter((call) => !call.startsWith("api user")), ["auth login", "repo view", "repo create"])
  assert.deepEqual(gh.state().repos[repo], { visibility: "PRIVATE", issuesOn: true, issues: [] })
  assert.match(said.join("\n"), /ABCD-1234/)
  // The two pages for the token: GitHub's filled in, Vercel's own; the engine waited until the variable showed.
  const links = host.links()
  const token = links.find((link) => link.purpose === "token")
  const page = new URL(token.url)
  assert.equal(`${page.origin}${page.pathname}`, "https://github.com/settings/personal-access-tokens/new")
  assert.deepEqual(["target_name", "issues", "expires_in"].map((key) => page.searchParams.get(key)), ["owner", "write", "366"])
  assert.ok(links.some((link) => link.purpose === "dashboard" && link.url === `https://vercel.com/team/${project}/settings/environment-variables`))
  assert.deepEqual(links.filter((link) => link.purpose === "login" && link.action === "open").map((link) => link.url), ["https://vercel.com/oauth/device?user_code=ABCD-EFGH", "https://github.com/login/device"])
  assert.match(said.join("\n"), /\[5\/8\] The inbox[\s\S]*\[6\/8\] The inbox's token[\s\S]*\[7\/8\] Publish[\s\S]*\[8\/8\] Bringing the changes in/)
  // Published with the inbox function, which knows its repository; the deployment knows the token.
  assert.deepEqual(publishState(ws).inbox, { repo, tokenAt: 1000 })
  assert.match(readFileSync(join(ws.root, ".excudo/publish/api/_inbox.mjs"), "utf8"), new RegExp(`"repo":"${repo}"`))
  // site pull runs every minute on this computer, with this engine.
  // (Other tests of this file schedule their own websites in the same folder.)
  const plist = readdirSync(process.env.EXCUDO_LAUNCH_AGENTS).map((name) => readFileSync(join(process.env.EXCUDO_LAUNCH_AGENTS, name), "utf8"))
    .find((text) => text.includes(`<string>${ws.root}</string>`))
  assert.match(plist, /<string>site<\/string><string>pull<\/string><string>--root<\/string>/)
  assert.match(plist, /<key>StartInterval<\/key><integer>60<\/integer>/)
  const status = await withEnv({ EXCUDO_GH: gh.path }, () => withCli(host.cli, () => publishStatus(ws)))
  assert.deepEqual(status.inbox, { repo, token: true, tokenAt: 1000, schedule: "installed" })
  // A token changed later on the dashboard is noticed by the next publishing, which deploys again.
  await withCli(host.cli, () => {
    assert.equal(publishSite(ws).published, false)
    host.account({ envs: [{ key: "EXCUDO_INBOX_TOKEN", target: ["production"], updatedAt: 2000 }] })
    const state = publishState(ws)
    writeFileSync(join(ws.cacheDir, "publish.json"), JSON.stringify({ ...state, protectionAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString() }))
    assert.equal(publishSite(ws).published, true)
    assert.equal(publishState(ws).inbox.tokenAt, 2000)
    assert.equal(publishSite(ws).published, false)
  })
})

test("setup refuses a public repository as the inbox, says how to get gh, and does not publish an inbox it has no repository for", async () => {
  const host = fake()
  host.account({ user: "owner", protection: "all", envs: [] })
  const ws = await memo(host.publish, { inbox: { github: { repo: "owner/open" } } })
  const gh = fakeGh({ user: "owner", repos: { "owner/open": { visibility: "PUBLIC", issuesOn: true, issues: [] } } })
  const said = []
  const refused = await withEnv({ EXCUDO_GH: gh.path }, () => withCli(host.cli, () => setupSite(ws, { say: (line) => said.push(line) })))
  assert.equal(refused.code, 1)
  assert.match(said.join("\n"), /owner\/open is not private/)
  const missing = await withCli(host.cli, () => setupSite(ws, { say: (line) => said.push(line) }))
  assert.equal(missing.code, 75)
  assert.match(said.join("\n"), /GitHub CLI \(gh\)/)
  const unset = await memo(host.publish, { inbox: true })
  await withCli(host.cli, () => {
    assert.equal(publishSite(unset).reason, "not-linked")
    spawnSync(host.cli, ["link", "--yes", "--project", "memo"], { cwd: join(unset.root, ".excudo/publish") })
    assert.equal(publishSite(unset).reason, "inbox-not-set-up", "an inbox setup has not made a repository for")
  })
})
