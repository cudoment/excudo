import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { mirror } from "../src/index.mjs"
import { tempDir } from "./helpers.mjs"
import { staleRanges } from "../scripts/ranges.mjs"
import { cliWorkspace, releaseFixture, runCli, seedRequests, write } from "./cli-helpers.mjs"

const json = (result) => JSON.parse(result.stdout)
const success = (result, code = 0) => {
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, result.stderr)
  assert.equal(result.status, code, result.stderr || result.stdout)
}
const mirrorReady = (ws) => mirror(ws, "plans", { settle: 0, notes: { note: { markers: 2, blocks: [] } } })
const candidate = (ws) => { seedRequests(ws); return json(runCli(ws, ["skills", "candidates", "--json"])).candidates[0].id }
const cases = [
  { name: "build", args: ["build"], output: /nodes, .*open tasks, .*files changed/i },
  { name: "home", args: ["home", "--json"], data: (data) => assert.equal(data.owned, false) },
  { name: "check", args: ["check", "--json"], data: (data) => assert.ok(Array.isArray(data.issues)) },
  { name: "tree", args: ["tree", "Projects"], output: /Task/ },
  { name: "rename", args: ["rename", "Scratch", "Renamed"], output: /Scratch.*Renamed/,
    verify: (ws) => assert.ok(existsSync(join(ws.graphDir, "Renamed.md"))), missing: ["rename"], error: /rename needs <node> <name>/ },
  { name: "remove", args: ["remove", "Scratch"], verify: (ws) => assert.ok(!existsSync(join(ws.graphDir, "Scratch.md"))),
    missing: ["remove"], error: /remove needs <node>/ },
  { name: "find", args: ["find", "small task", "--json"], data: (data) => assert.equal(data.matches.length, 1),
    missing: ["find"], error: /find needs <words>/ },
  { name: "inbox", args: ["inbox", "--json"], data: (data) => assert.ok(Array.isArray(data)) },
  { name: "archive", args: ["archive"], output: /archiv/i },
  { name: "workspaces", args: ["workspaces", "--dry-run", "--json"], data: (data) => assert.ok(Array.isArray(data.updated)) },
  ...["track", "untrack"].map((action) => ({ name: `workspaces ${action}`, args: (ws) => ["workspaces", action, ws.root],
    output: /track/i, missing: ["workspaces", action], error: new RegExp(`workspaces ${action} needs <folder>`) })),
  { name: "fix", args: ["fix", "--dry-run", "--json"], data: (data) => assert.ok(Array.isArray(data.fixed)) },
  { name: "mirror", prepare: (ws) => {
    mirrorReady(ws)
    const old = new Date(Date.now() - 300000)
    utimesSync(join(ws.graphDir, "Plans.md"), old, old)
  }, args: ["mirror", "plans", "--dry-run", "--json"], data: (data) => assert.equal(data.deferred, null) },
  { name: "mirror deferred", args: ["mirror", "plans", "--dry-run", "--json"], code: 75,
    data: (data) => assert.ok(data.deferred),
    prepare: (ws) => writeFileSync(join(ws.graphDir, "Plans.md"), readFileSync(join(ws.graphDir, "Plans.md"), "utf8") + "\n") },
  { name: "mirror mark", prepare: (ws) => { mirrorReady(ws); write(ws.root, "wrote.txt", "Books\n- read a book\n") },
    args: (ws) => ["mirror", "mark", "plans", "--wrote", `note=${join(ws.root, "wrote.txt")}`, "--json"],
    data: (data) => assert.equal(data.marked[0].note, "note"), missing: ["mirror", "mark"], error: /--wrote <source>=<file>/ },
  { name: "mirror text", prepare: mirrorReady, args: ["mirror", "text", "plans", "note", "--json"],
    data: (data) => assert.deepEqual(data.lines, ["Books", "- read a book"]) },
  { name: "idle", args: ["idle", "--json"], data: (data) => assert.equal(data.state, "idle") },
  { name: "activity", args: ["activity", "--json"], data: (data) => assert.equal(typeof data, "object") },
  { name: "activity show", args: ["activity", "show", "--days", "1"], output: /activity|No work/i },
  { name: "queue", args: ["queue", "--json"], data: (data) => assert.equal(data.items.length, 1) },
  { name: "queue report", args: (ws) => {
    const [item] = json(runCli(ws, ["queue", "--json"])).items
    return ["queue", "report", item.key, "--summary", "Links checked", "--stamp", item.stamp]
  }, output: /report/i, verify: (ws) => assert.match(readFileSync(join(ws.graphDir, "Projects/Task.md"), "utf8"), /Links checked/),
    missing: ["queue", "report"], error: /queue report needs <key> --summary <words>/ },
  { name: "runs", args: ["runs", "--json"], data: (data) => assert.deepEqual(data, []) },
  { name: "runs add", args: ["runs", "add", "smoke", "--status", "ok"], output: /Recorded run .*smoke ok/,
    verify: (ws) => assert.equal(json(runCli(ws, ["runs", "--json"]))[0].step, "smoke"),
    missing: ["runs", "add"], error: /A run needs a step and a status/ },
  { name: "backup", args: () => ["backup", join(tempDir(), "backup")], output: /backup|copied|wrote/i,
    missing: ["backup"], error: /backup needs <folder>/ },
  { name: "review", args: ["review", "--json"], data: (data) => assert.ok(Array.isArray(data.candidates)) },
  { name: "review keep", prepare: (ws) => writeFileSync(join(ws.graphDir, "Projects/Task.md"), "# Task\nA small task.\n\n- TODO Check the links DEADLINE: <2000-01-01>\n"),
    args: (ws) => { const [item] = json(runCli(ws, ["review", "--json"])).candidates; assert.ok(item); return ["review", "keep", item.id] },
    output: /kept|keep/i, missing: ["review", "keep"], error: /review keep needs <id>/ },
  { name: "skills candidates", prepare: seedRequests, args: ["skills", "candidates", "--json"], data: (data) => assert.equal(data.candidates.length, 1) },
  { name: "skills dismiss", args: (ws) => ["skills", "dismiss", candidate(ws), "--reason", "This routine varies each time"], output: /will not be offered again/i,
    missing: ["skills", "dismiss"], error: /skills dismiss needs <candidate> --reason <words>/ },
  { name: "skills retire", prepare: (ws) => write(ws.root, "skills.json", JSON.stringify({ skills: { "test-helper": { status: "draft", install: "workspace" } }, dismissed: {} })),
    args: ["skills", "retire", "test-helper"], output: /out of use/i,
    missing: ["skills", "retire"], error: /skills retire needs <name>/ },
  { name: "skills upkeep", args: ["skills", "upkeep", "--json"], data: (data) => assert.deepEqual(data.skills, []) },
]

// Every command goes through the executable, in its own committed throwaway workspace.
for (const item of cases) test(`CLI ${item.name}`, { timeout: 480000 }, async () => {
  const ws = await cliWorkspace()
  await item.prepare?.(ws)
  const args = typeof item.args === "function" ? item.args(ws) : item.args
  const result = runCli(ws, args)
  success(result, item.code ?? 0)
  if (item.data) item.data(json(result))
  if (item.output) assert.match(result.stdout, item.output)
  await item.verify?.(ws, result)
  if (item.missing) {
    const missing = runCli(ws, item.missing)
    success(missing, 1)
    assert.match(missing.stderr, item.error)
    assert.equal(missing.stdout, "")
  }
})

const cheap = ["committed", "branch", "version", "dependencies", "setup-range", "denylist", "readmes", "package"]
const checkNames = (stdout) => [...stdout.matchAll(/^[✓✗] ([\w-]+):/gm)].map((match) => match[1])
const release = (fixture, args = []) => spawnSync(process.execPath, [fixture.script, ...args], { cwd: fixture.root, env: fixture.env, encoding: "utf8", timeout: 15000 })

test("release checks print cheap results before tests, example and skills", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const fixture = releaseFixture()
  const result = release(fixture)
  success(result)
  assert.deepEqual(checkNames(result.stdout), [...cheap, "changelog", "tests", "example", "skills"])
  assert.match(result.stdout, /Ready to publish 1\.2\.3/)
  assert.deepEqual(fixture.calls().map((args) => args[0]), ["pack", "test", "build", "skills"])
})
test("release --quick skips expensive commands and never approves publishing", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const fixture = releaseFixture()
  const result = release(fixture, ["--quick"])
  success(result)
  assert.deepEqual(checkNames(result.stdout), cheap)
  for (const name of ["tests", "example", "skills"]) assert.match(result.stdout, new RegExp(`${name}: skipped \\(.*quick`))
  assert.doesNotMatch(result.stdout, /Ready to publish/)
  assert.deepEqual(fixture.calls().map((args) => args[0]), ["pack"])
})
test("quick checks accept contribution branches while full releases still require main", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const fixture = releaseFixture({ branch: "feature/contribution" })
  success(release(fixture, ["--quick"]))
  const full = release(fixture)
  success(full, 1)
  assert.match(full.stdout, /✗ branch: on feature\/contribution/)
  assert.doesNotMatch(full.stdout, /Ready to publish/)
})
test("release refuses a README whose excudo@^ range is not this version", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const stale = release(releaseFixture({ staleReadme: true }), ["--quick"])
  success(stale, 1)
  assert.match(stale.stdout, /✗ setup-range: README\.md must install excudo@\^1\.2\.3/)
  assert.doesNotMatch(stale.stdout, /README\.ko\.md must/)
  for (const [option, file] of [["koRange", "README.ko.md"], ["jaRange", "README.ja.md"], ["zhRange", "README.zh-CN.md"]]) {
    const one = release(releaseFixture({ [option]: "1.2.0" }), ["--quick"])
    success(one, 1)
    assert.match(one.stdout, new RegExp(`✗ setup-range: ${file.replaceAll(".", "\\.")} must install excudo@\\^1\\.2\\.3`))
  }
  const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
  const version = JSON.parse(read("package.json")).version
  assert.deepEqual(staleRanges([["setup", read("skills/excudo-setup/SKILL.md"), "setup"], ["README.md", read("README.md"), "readme"], ["README.ko.md", read("README.ko.md"), "readme"], ["README.ja.md", read("README.ja.md"), "readme"], ["README.zh-CN.md", read("README.zh-CN.md"), "readme"]], version), [],
    "the setup skill and all four READMEs keep to the range rule for this version")
})
test("a prerelease version moves only the setup skill; the READMEs keep the last stable release", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const names = (options) => release(releaseFixture({ version: "1.3.0-beta.1", ...options }), ["--quick"]).stdout.match(/^[✓✗] setup-range: .*/m)[0]
  assert.match(names({ readmeRange: "1.2.3" }), /^✓ setup-range/)
  assert.match(names({ readmeRange: "1.3.0-beta.1" }), /✗ setup-range: README\.md, README\.ko\.md, README\.ja\.md, README\.zh-CN\.md must install an earlier stable/)
  assert.match(names({ readmeRange: "1.3.0" }), /✗ setup-range: README\.md, README\.ko\.md, README\.ja\.md, README\.zh-CN\.md/)
  assert.match(names({ readmeRange: "1.2.3", setupRange: "1.2.3" }), /✗ setup-range: skills\/excudo-setup\/SKILL\.md must install excudo@\^1\.3\.0-beta\.1/)
  assert.deepEqual(staleRanges([["a", "excudo@^0.7.0", "readme"], ["b", "excudo@^0.8.0-beta.1", "setup"]], "0.8.0-beta.1"), [])
  assert.deepEqual(staleRanges([["a", "excudo@^0.8.0-beta.1", "readme"]], "0.8.0-beta.1"), ["a"])
})
test("release refuses package metadata that lacks the owner actions of the changelog", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const fixture = releaseFixture()
  const notes = "# Changelog\n\n## 1.2.3\n\n### Owner action\n\n- Settings: Rename a setting\n"
  writeFileSync(join(fixture.root, "CHANGELOG.md"), notes)
  const manifest = JSON.parse(readFileSync(join(fixture.root, "package.json"), "utf8"))
  manifest.excudoReleaseNotes.markdown = notes
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify(manifest))
  const stale = release(fixture)
  assert.match(stale.stdout, /✗ changelog: package\.json excudoReleaseNotes is not current/)
  manifest.excudoReleaseNotes.ownerActions = [{ version: "1.2.3", items: ["Settings: Rename a setting"] }]
  writeFileSync(join(fixture.root, "package.json"), JSON.stringify(manifest))
  assert.match(release(fixture).stdout, /✓ changelog:/)
})
test("release fails when a child fails even if its output looks successful", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  for (const options of [{ packCode: 1 }, { testCode: 1 }, { buildCode: 1 }, { lintCode: 1 }]) {
    const result = release(releaseFixture(options))
    success(result, 1)
    assert.equal((result.stdout.match(/^✗/gm) ?? []).length, 1, result.stdout)
    assert.doesNotMatch(result.stdout, /Ready to publish/)
  }
})

for (const signal of ["SIGTERM", "SIGINT"]) test(`release ${signal} prints partial results and stops its test descendants`, { timeout: 90000, skip: process.platform === "win32" && "POSIX process-group signals" }, async (t) => {
  const fixture = releaseFixture({ slow: true })
  const child = spawn(process.execPath, [fixture.script], { cwd: fixture.root, env: fixture.env, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })))
  const pids = () => ["child.pid", "grandchild.pid"].flatMap((name) => existsSync(join(fixture.root, name)) ? [Number(readFileSync(join(fixture.root, name), "utf8"))] : [])
  t.after(() => { child.kill("SIGKILL"); for (const pid of pids()) { try { process.kill(pid, "SIGKILL") } catch {} } })
  const until = Date.now() + 60000
  while (pids().length < 2 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(pids().length, 2, stdout + stderr)
  assert.deepEqual(checkNames(stdout), [...cheap, "changelog"], "results must be visible while tests are still running")
  child.kill(signal)
  const result = await done
  assert.equal(result.code, signal === "SIGINT" ? 130 : 143, stdout + stderr)
  assert.equal(result.signal, null)
  assert.match(stdout, new RegExp(`Interrupted by ${signal}; 9 completed check`))
  assert.doesNotMatch(stdout, /Ready to publish|^[✓✗] tests:/m)
  for (const pid of pids()) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `leftover child ${pid}`)
})


test("a full release refuses missing version notes", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const result = release(releaseFixture({ missingChangelog: true }))
  success(result, 1)
  assert.match(result.stdout, /✗ changelog:/)
  assert.doesNotMatch(result.stdout, /Ready to publish/)
})

test("a full release refuses notes that lack the newest commit", { skip: process.platform === "win32" && "POSIX executable fixtures" }, () => {
  const stale = release(releaseFixture({ newestSubject: "Setup: Validate reports" }))
  success(stale, 1)
  assert.match(stale.stdout, /✗ changelog: .*Setup: Validate reports/)
  const listed = releaseFixture({ newestSubject: "Setup: Validate reports" })
  const notes = "# Changelog\n\n## 1.2.3\n\n### Setup\n\n- Validate reports\n"
  writeFileSync(join(listed.root, "CHANGELOG.md"), notes)
  const manifest = JSON.parse(readFileSync(join(listed.root, "package.json"), "utf8"))
  manifest.excudoReleaseNotes.markdown = notes
  writeFileSync(join(listed.root, "package.json"), JSON.stringify(manifest))
  assert.match(release(listed).stdout, /✓ changelog:/)
})

test("--version and -v print the installed version inside and outside a workspace", async () => {
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version
  const ws = await cliWorkspace()
  const bin = new URL("../bin/excudo.mjs", import.meta.url).pathname
  for (const flag of ["--version", "-v"]) {
    const inside = spawnSync(process.execPath, [bin, flag], { cwd: ws.root, encoding: "utf8" })
    assert.equal(inside.status, 0, inside.stderr)
    assert.equal(inside.stdout.trim(), version)
    const outside = spawnSync(process.execPath, [bin, flag], { cwd: tempDir(), encoding: "utf8" })
    assert.equal(outside.status, 0, outside.stderr)
    assert.equal(outside.stdout.trim(), version)
  }
  assert.match(spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" }).stdout, /-v, --version/)
})
