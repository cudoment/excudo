import assert from "node:assert/strict"
import cp from "node:child_process"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { availableParallelism } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { judgeCase, lintSkill } from "../src/skilllint.mjs"
import { caseJobs } from "../src/skilllint-runner.mjs"
import { tempDir } from "./helpers.mjs"

function withEnv(values, fn) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return fn()
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function fixture(cases, body = "process.exit(facts.code)") {
  const root = tempDir(), dir = join(root, "case-check"), cwd = join(root, "work")
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(cwd)
  writeFileSync(join(dir, "SKILL.md"), `---\nname: case-check\ndescription: Use when checking a case.\n---\n# Case check\n\nCheck the facts.\nRead the result.\nReport the result.\n\n\`\`\`sh\nnode scripts/check.mjs\n\`\`\`\n`)
  writeFileSync(join(dir, "scripts", "check.cases.json"), JSON.stringify(cases))
  writeFileSync(join(dir, "scripts", "check.mjs"), `// Usage: node scripts/check.mjs --facts <file>
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
const facts = JSON.parse(readFileSync(process.argv[process.argv.indexOf("--facts") + 1], "utf8"))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
${body}
`)
  return { dir, cwd, lint: () => lintSkill(dir, { cwd }) }
}

const both = [
  { name: "yes", expect: "pass", facts: { code: 0 } },
  { name: "no", expect: "fail", facts: { code: 1 } },
]
const events = (cwd) => readFileSync(join(cwd, "events"), "utf8").trim().split("\n").map(JSON.parse)
const casesCheck = (lint) => lint.checks.find((check) => check.id === "cases")

test("concurrent cases preserve complete lint results, argument conversion, cwd and case order", () => {
  const cases = [
    ...both,
    { name: "wrong-first", expect: "pass", facts: { code: 1 }, args: [17, false] },
    { name: "wrong-second", expect: "fail", facts: { code: 0 } },
    { name: "other-exit", expect: "pass", facts: { code: 3 } },
  ]
  const { cwd, lint } = fixture(cases, `if (!process.cwd().endsWith("work")) process.exit(2)
if (facts.code === 1 && process.argv.length > 4 && process.argv.slice(4).join(",") !== "17,false") process.exit(2)
await sleep(facts.code === 1 ? 20 : 0)
process.exit(facts.code)`)
  const serial = withEnv({ EXCUDO_CASE_JOBS: "1" }, lint)
  const parallel = withEnv({ EXCUDO_CASE_JOBS: "3" }, lint)
  assert.deepEqual(parallel, serial)
  assert.match(casesCheck(parallel).message, /wrong-first.*wrong-second.*other-exit/)
  assert.ok(existsSync(cwd))
})

test("cases overlap and only unexpected judgments are retried after the batch ends", () => {
  const { cwd, lint } = fixture([
    { name: "one", expect: "pass", facts: { id: "one", peer: "two", code: 0 } },
    { name: "two", expect: "fail", facts: { id: "two", peer: "one", code: 1 } },
  ], `appendFileSync("events", JSON.stringify({ id: facts.id, event: "start" }) + "\\n")
writeFileSync(facts.id, "started")
const limit = Date.now() + 10000
while (!existsSync(facts.peer) && Date.now() < limit) await sleep(10)
appendFileSync("events", JSON.stringify({ id: facts.id, event: "end" }) + "\\n")
process.exit(existsSync(facts.peer) ? facts.code : 2)`)
  const linted = withEnv({ EXCUDO_CASE_JOBS: "2" }, lint)
  assert.equal(linted.ok, true, casesCheck(linted).message)
  const trace = events(cwd)
  assert.equal(trace.length, 4, "expected results must not be retried")
  assert.deepEqual(trace.slice(0, 2).map((event) => event.event), ["start", "start"], "both start before either ends")
})

test("a case that loses a shared lock passes when retried alone", () => {
  const { cwd, lint } = fixture([
    { name: "one", expect: "pass", facts: { id: "one", code: 0 } },
    { name: "two", expect: "pass", facts: { id: "two", code: 0 } },
    both[1],
  ], `if (facts.code === 1) process.exit(1)
appendFileSync("events", JSON.stringify({ id: facts.id, event: "start" }) + "\\n")
let lock
try { lock = openSync("shared.lock", "wx") }
catch (error) {
  if (error.code !== "EEXIST") throw error
  writeFileSync("collision", "seen")
  appendFileSync("events", JSON.stringify({ id: facts.id, event: "collision" }) + "\\n")
  process.exit(1)
}
const limit = Date.now() + 10000
while (!existsSync("collision") && Date.now() < limit) await sleep(10)
closeSync(lock)
unlinkSync("shared.lock")
appendFileSync("events", JSON.stringify({ id: facts.id, event: "end" }) + "\\n")`)
  const linted = withEnv({ EXCUDO_CASE_JOBS: "2" }, lint)
  assert.equal(linted.ok, true, casesCheck(linted).message)
  assert.equal(linted.score, 100)
  const trace = events(cwd), collision = trace.find((event) => event.event === "collision")
  assert.ok(collision, "the concurrent batch must exercise a real lock collision")
  assert.equal(trace.filter((event) => event.id === collision.id && event.event === "start").length, 2)
  assert.equal(trace.filter((event) => event.id !== collision.id && event.event === "start").length, 1)
  assert.equal(trace.at(-2).event, "start", "retry starts only after the original lock holder ends")
})

test("timeouts kill even SIGTERM-ignoring cases and environment errors still hold lint", () => {
  const { cwd, lint } = fixture([
    ...both,
    { name: "slow", expect: "pass", facts: { slow: true } },
    { name: "offline", expect: "pass", facts: { offline: true } },
  ], `if (facts.slow) {
  process.on("SIGTERM", () => {})
  appendFileSync("events", JSON.stringify({ pid: process.pid }) + "\\n")
  setInterval(() => {}, 1000)
} else if (facts.offline) { console.error("ECONNREFUSED"); process.exit(1) }
else process.exit(facts.code)`)
  // The offline stub must get time to start before it can report its infrastructure error.
  const linted = withEnv({ EXCUDO_CASE_JOBS: "2", EXCUDO_CASE_TIMEOUT_MS: "10000" }, lint)
  assert.equal(linted.ok, false)
  assert.equal(linted.held, true)
  assert.deepEqual(casesCheck(linted).timedOut, ["slow"])
  assert.deepEqual(casesCheck(linted).infrastructure, ["offline (ECONNREFUSED)"])
  assert.equal(events(cwd).length, 2, "the timeout is retried in isolation")
  for (const { pid } of events(cwd)) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
})

test("helper failure or invalid results fall back to serial checks", (t) => {
  const { lint } = fixture(both)
  const expected = withEnv({ EXCUDO_CASE_JOBS: "1" }, lint)
  const original = cp.spawnSync
  for (const result of [
    { status: 1, stdout: "" },
    { status: null, error: { code: "ENOENT" }, stdout: "" },
    { status: 0, stdout: "not json" },
    { status: 0, stdout: '["pass"]' },
    { status: 0, stdout: '["pass",null]' },
    { status: 0, stdout: '["pass","unknown"]' },
  ]) {
    let helpers = 0, checks = 0
    t.mock.method(cp, "spawnSync", (command, args, options) => {
      if (args[0].endsWith("skilllint-runner.mjs")) { helpers++; return result }
      if (args.includes("--facts")) checks++
      return original(command, args, options)
    })
    syncBuiltinESMExports()
    try {
      assert.deepEqual(withEnv({ EXCUDO_CASE_JOBS: "2" }, lint), expected)
      assert.equal(helpers, 1)
      assert.equal(checks, 2)
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
  }
})

test("one case and jobs=1 bypass the helper", (t) => {
  const { dir, lint } = fixture(both)
  const original = cp.spawnSync
  t.mock.method(cp, "spawnSync", (command, args, options) => {
    assert.ok(!args[0].endsWith("skilllint-runner.mjs"))
    return original(command, args, options)
  })
  syncBuiltinESMExports()
  try {
    assert.deepEqual(withEnv({ EXCUDO_CASE_JOBS: "8" }, () => judgeCase(dir, "yes")), { expect: "pass", got: "pass" })
    assert.equal(withEnv({ EXCUDO_CASE_JOBS: "1" }, lint).ok, true)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test("jobs defaults to available parallelism with a cap and rejects invalid overrides", () => {
  const expected = Math.min(8, availableParallelism())
  for (const value of [undefined, "", "0", "-1", "invalid", "1.5", "Infinity", "9007199254740992"]) {
    assert.equal(withEnv({ EXCUDO_CASE_JOBS: value }, caseJobs), expected, String(value))
  }
  for (const value of ["1", "2", "12"]) assert.equal(withEnv({ EXCUDO_CASE_JOBS: value }, caseJobs), Number(value))
})

test("the concurrent output limit retains the serial exit judgment", () => {
  const { lint } = fixture([...both, { name: "too-much", expect: "pass", facts: { noisy: true } }], `if (facts.noisy) {
  process.stdout.write("x".repeat(9 * 1024 * 1024))
  setInterval(() => {}, 1000)
} else process.exit(facts.code)`)
  const serial = withEnv({ EXCUDO_CASE_JOBS: "1" }, lint)
  assert.match(casesCheck(serial).message, /too-much \(pass → exit ENOBUFS\)/)
  assert.deepEqual(withEnv({ EXCUDO_CASE_JOBS: "2" }, lint), serial)
})

test("the helper judges cases when launched through a symbolic link", () => {
  const cwd = tempDir(), helper = join(cwd, "runner.mjs")
  symlinkSync(fileURLToPath(new URL("../src/skilllint-runner.mjs", import.meta.url)), helper)
  const tasks = [0, 1, 3].map((code) => ({ command: process.execPath, args: ["-e", `process.exit(${code})`],
    options: { cwd, timeout: 10000, maxBuffer: 8 * 1024 * 1024 } }))
  const result = cp.spawnSync(process.execPath, [helper], {
    input: JSON.stringify({ tasks, jobs: 2 }), encoding: "utf8", timeout: 15000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), ["pass", "fail", "exit 3"])
})
