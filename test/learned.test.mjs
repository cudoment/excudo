import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative, resolve } from "node:path"
import { test } from "node:test"
import { adoptSkill, commitGraph, dismissCandidate, lintSkill, lintSkills, loadWorkspace, readLearned, recordMistake, retireSkill, skillCandidates, skillNames, skillsStatus, upkeepSkills, withLock } from "../src/index.mjs"
import { copiedPassages } from "../src/requests.mjs"
import { learnedSettings, typedWhere } from "../src/learned.mjs"
import { reclaimLock } from "../src/files.mjs"
import { SKILLS_DIR } from "../src/skills.mjs"
import { homeEnv, tempDir, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const now = new Date("2026-10-14T12:00:00Z")
const line = (record) => `${JSON.stringify(record)}\n`
const said = (ts, session, content, cwd = "/work/site") => line({ type: "user", timestamp: ts, cwd, sessionId: session, message: { role: "user", content } })
const run = (args, cwd, timeout = 60000) => spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout })

/** A skill that meets the rule: SKILL.md, a check that reads RELEASE.md, and known cases with both outcomes. */
function writeSkill(dir, name, { description = `Write the release notes of the site from its merged changes. Use for "write the release notes".`, body = "", cases, verdict } = {}) {
  mkdirSync(join(dir, "scripts"), { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\nWrites the site's release notes from the changes merged since the last release.\n\n## Steps\n\n1. List the changes since the last tag with \`git log --oneline <tag>..HEAD\`.\n2. Group them by kind and write RELEASE.md.\n${body}\n## Check\n\n\`\`\`sh\nnode .agents/skills/${name}/scripts/check.mjs\n\`\`\`\n`)
  writeFileSync(join(dir, "scripts", "check.mjs"), `#!/usr/bin/env node
// Usage: node scripts/check.mjs [--json] | --facts <file>
// Checks that RELEASE.md exists and starts with a heading.
import { existsSync, readFileSync } from "node:fs"
const at = process.argv.indexOf("--facts")
const facts = at > 0 ? JSON.parse(readFileSync(process.argv[at + 1], "utf8")) : { text: existsSync("RELEASE.md") ? readFileSync("RELEASE.md", "utf8") : null }
const ok = ${verdict ?? 'Boolean(facts.text?.startsWith("# "))'}
console.log((ok ? "ok" : "not ok") + " release-notes")
process.exitCode = ok ? 0 : 1
`)
  writeFileSync(join(dir, "scripts", "check.cases.json"), JSON.stringify(cases ?? [{ name: "written", expect: "pass", facts: { text: "# 1.2\n" } }, { name: "missing", expect: "fail", facts: { text: null } }], null, 2))
}

/** A workspace that reads fake agent logs: three requests for release notes in three sessions, and noise. */
async function learning(config = {}) {
  const logs = tempDir("excudo-logs-")
  const dir = join(logs, "claude", "-work-site")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "s1.jsonl"), said("2026-10-01T01:00:00Z", "s1", "Write the release notes for the site from the merged changes")
    + said("2026-10-01T01:05:00Z", "s1", "continue"))
  writeFileSync(join(dir, "s2.jsonl"), said("2026-10-05T01:00:00Z", "s2", "Please write the release notes for the site from merged changes again")
    + said("2026-10-05T02:00:00Z", "s2", "Rename the search box component and update its tests"))
  writeFileSync(join(dir, "s3.jsonl"), said("2026-10-09T01:00:00Z", "s3", "write release notes for the site from the merged changes of this week"))
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n## Workspace\n`/work/site` · `main`\n" },
    { conversations: { claude: join(logs, "claude"), codex: false }, ...config })
  return { ws, logs: dir }
}

test("every engine skill meets the skill rule with full marks", () => {
  assert.ok(skillNames().includes("excudo-skills"))
  for (const name of skillNames()) {
    const result = lintSkill(join(SKILLS_DIR, name))
    const failing = result.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.message}`)
    assert.ok(result.ok, `${name}: ${failing.join("; ")}`)
    assert.equal(result.score, 100, `${name}: ${failing.join("; ")}`)
  }
})

test("a prompt alone is no skill, and neither is a check that cannot fail", () => {
  const dir = join(tempDir(), "notes-helper")
  mkdirSync(dir)
  writeFileSync(join(dir, "SKILL.md"), `---\nname: notes-helper\ndescription: "Tidy the notes. Use for \\"tidy my notes\\"."\n---\n\n# Notes helper\n\nRead the notes.\nAsk what to move.\nMove it.\nSave.\nReport.\n`)
  let result = lintSkill(dir)
  assert.equal(result.ok, false)
  assert.deepEqual(result.checks.filter((check) => !check.ok && check.required).map((check) => check.id), ["scripts", "check-script", "cases"])

  writeSkill(dir, "notes-helper", { cases: [{ name: "fine", expect: "pass", facts: { text: "# x" } }] })
  assert.match(lintSkill(dir).checks.find((check) => check.id === "cases").message, /must pass and one that must fail/)
  // A check that always passes, whatever its cases claim, is caught by feeding it the failing case.
  writeSkill(dir, "notes-helper", { verdict: "true" })
  result = lintSkill(dir)
  assert.equal(result.ok, false)
  assert.match(result.checks.find((check) => check.id === "cases").message, /missing \(fail → pass\)/)

  writeSkill(dir, "notes-helper")
  result = lintSkill(dir)
  assert.ok(result.ok)
  assert.equal(result.score, 100)
  writeFileSync(join(dir, "notes.md"), "FILL IN: the owner's folders\n")
  assert.equal(lintSkill(dir).checks.find((check) => check.id === "filled").ok, false)
  rmSync(join(dir, "notes.md"))
  writeSkill(dir, "notes-helper", { body: `\nUse the Bash tool to run it from ${homedir()}/work.\n` })
  result = lintSkill(dir)
  assert.deepEqual(result.checks.filter((check) => !check.ok).map((check) => check.id).sort(), ["neutral", "portable"])
  assert.equal(result.ok, false, "one agent's tool calls keep a skill out of use whatever its score")
  writeSkill(dir, "notes-helper", { body: '\nexport TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz0123"\n' })
  assert.equal(lintSkill(dir).checks.find((check) => check.id === "secrets").ok, false)
  writeSkill(dir, "notes-helper", { body: "\nThen run scripts/publish.mjs.\n" })
  assert.equal(lintSkill(dir).checks.find((check) => check.id === "scripts-referenced").ok, false, "a script SKILL.md names must exist")
  writeSkill(dir, "notes-helper", { body: "\nFirst run ~/.agents/skills/other-helper/scripts/prepare.mjs, then scripts/check.mjs.\n" })
  assert.equal(lintSkill(dir).checks.find((check) => check.id === "scripts-referenced").ok, true, "another skill's script is that skill's to keep")
  writeSkill(dir, "notes-helper", { body: "\nRun ~/.agents/skills/notes-helper/scripts/publish.mjs.\n" })
  assert.equal(lintSkill(dir).checks.find((check) => check.id === "scripts-referenced").ok, false, "its own script named by full path must exist")
})

test("words copied from a request are found, a command the owner typed is not", async () => {
  const { ws } = await learning()
  skillCandidates(ws, { now })
  const found = copiedPassages(ws, [
    { file: "a.md", text: "Notes: please write the release notes for the site from merged changes again, then publish." },
    { file: "b.md", text: "Run git log --oneline v1.2..HEAD to list them." },
    { file: "c.md", text: "Summary: release notes are written from what was merged." },
  ])
  assert.deepEqual(found.map((item) => item.file), ["a.md"])
  assert.match(found[0].passage, /write the release notes for the site from merged changes/i)
  assert.equal(copiedPassages(await workspace({}), [{ file: "a.md", text: "anything" }]), null, "a workspace that reads no requests has nothing to compare")
})

test("recurring requests become a candidate; an adopted skill is installed and its record keeps no request words", async () => {
  const { ws, logs } = await learning()
  const { candidates } = skillCandidates(ws, { now })
  assert.equal(candidates.length, 1, JSON.stringify(candidates))
  const [candidate] = candidates
  assert.equal(candidate.count, 3)
  assert.equal(candidate.sessions, 3)
  assert.deepEqual(candidate.places, ["Site"])
  assert.match(candidate.requests[0].text, /release notes/)

  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  const adopted = adoptSkill(ws, "release-notes", { from: candidate.id, now })
  assert.equal(adopted.status, "active")
  assert.equal(adopted.state, "installed")
  const agents = join(ws.root, ".agents", "skills", "release-notes")
  assert.equal(readlinkSync(agents), join("..", "..", "skills", "release-notes"))
  assert.equal(readlinkSync(join(ws.root, ".claude", "skills", "release-notes")), join("..", "..", ".agents", "skills", "release-notes"))
  const record = readFileSync(join(ws.root, "skills.json"), "utf8")
  assert.doesNotMatch(record, /merged changes|release notes for/, "the record names requests by key, never by their words")
  assert.equal(readLearned(ws).skills["release-notes"].evidence.requests.length, 3)
  assert.equal(skillCandidates(ws, { now }).candidates.length, 0, "an adopted candidate is not offered again")

  appendFileSync(join(logs, "s3.jsonl"), said("2026-10-12T01:00:00Z", "s3", "write the release notes for the site from the merged changes"))
  const kept = upkeepSkills(ws, { now })
  assert.deepEqual(kept.skills.map((skill) => [skill.name, skill.status, skill.state, skill.matched]), [["release-notes", "active", "current", 1]])
  assert.equal(readLearned(ws).skills["release-notes"].matched.count, 1)
  assert.equal(upkeepSkills(ws, { now }).skills[0].matched, 0, "a request is counted once")
})

test("a skill that stops fitting is taken out of use, and one that never fitted stays a draft", async () => {
  const { ws } = await learning()
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now })
  rmSync(join(dir, "scripts"), { recursive: true })
  const result = upkeepSkills(ws, { now })
  assert.deepEqual(result.skills.map((skill) => [skill.status, skill.state]), [["draft", "demoted"]])
  assert.ok(!existsSync(join(ws.root, ".agents", "skills", "release-notes")))
  writeSkill(dir, "release-notes")
  assert.equal(adoptSkill(ws, "release-notes", { now }).status, "active", "fixed, it comes back on its earlier evidence")

  const draft = join(ws.root, "skills", "half-done")
  mkdirSync(draft)
  writeFileSync(join(draft, "SKILL.md"), `---\nname: half-done\ndescription: "Use for \\"half\\"."\n---\n\nNothing yet.\n`)
  assert.deepEqual(upkeepSkills(ws, { now }).unregistered, ["half-done"])
  const drafted = adoptSkill(ws, "half-done", { requested: true, now })
  assert.equal(drafted.status, "draft")
  assert.ok(!existsSync(join(ws.root, ".agents", "skills", "half-done")))
  assert.throws(() => adoptSkill(ws, "excudo-capture", { requested: true, now }), /engine/)
  assert.throws(() => adoptSkill(ws, "nowhere", { requested: true, now }), /SKILL\.md/)
})

test("infrastructure errors in known cases hold an installed skill", async () => {
  const { ws } = await learning()
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now })
  for (const cause of ["ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "proxyconnect", "i/o timeout", "could not connect", "Could not resolve host", "API Error: 401", "Failed to authenticate", "access token has expired"]) {
    writeSkill(dir, "release-notes", { verdict: `(console.error(${JSON.stringify(cause)}), process.exit(1))` })
    const lint = lintSkill(dir)
    assert.equal(lint.held, true, cause)
    assert.ok(lint.checks.find((check) => check.id === "cases").message.includes(cause))
  }
  assert.deepEqual(upkeepSkills(ws, { now }).skills.map((skill) => [skill.status, skill.state, skill.held]), [["active", "held", true]])
  assert.equal(readLearned(ws).skills["release-notes"].status, "active")
  assert.ok(existsSync(join(ws.root, ".agents", "skills", "release-notes")))
  writeSkill(dir, "release-notes", { verdict: 'facts.text === null ? (console.error("ECONNREFUSED"), process.exit(1)) : false' })
  assert.equal(lintSkill(dir).held, false, "an ordinary wrong verdict still counts beside an infrastructure error")
  assert.equal(upkeepSkills(ws, { now }).skills[0].state, "demoted")
})

test("skills.keep holds failing skills and upkeep exits nonzero for notification", async () => {
  const { ws } = await learning({ skills: { keep: ["release-notes"] } })
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now })
  writeSkill(dir, "release-notes", { verdict: "false" })
  let result = upkeepSkills(ws, { now })
  assert.deepEqual(result.skills.map((skill) => [skill.status, skill.state, skill.held, skill.kept]), [["active", "held", true, true]])
  assert.ok(result.skills[0].problems.some((problem) => problem.startsWith("cases:")))
  assert.equal(readLearned(ws).skills["release-notes"].status, "active")
  assert.ok(existsSync(join(ws.root, ".agents", "skills", "release-notes")))
  for (const output of [[], ["--json"]]) {
    const cliResult = run([cli, "skills", "upkeep", "--root", ws.root, ...output], ws.root)
    assert.equal(cliResult.status, 1, cliResult.stderr + cliResult.stdout)
    if (output.length) assert.equal(JSON.parse(cliResult.stdout).skills[0].state, "held")
    else assert.match(cliResult.stdout, /skills.keep.*\n.*cases:/)
  }
  const md = join(dir, "SKILL.md")
  writeFileSync(md, readFileSync(md, "utf8").replace(/```sh\n(node [^\n]+)\n```/, "Run `$1`."))
  result = upkeepSkills(ws, { now })
  assert.equal(result.skills[0].state, "held", "a kept skill stays installed below minScore too")
  assert.equal(result.skills[0].score, 75)
  writeSkill(dir, "release-notes")
  result = upkeepSkills(ws, { now: new Date(now.getTime() + 200 * 86400000) })
  assert.equal(result.skills[0].status, "active", "a kept skill is not retired when dormant")
  assert.equal(result.skills[0].fit, true)
  assert.equal(run([cli, "skills", "upkeep", "--root", ws.root, "--json"], ws.root).status, 0)
  writeSkill(dir, "release-notes", { verdict: "false" })
  ws.skills.keep = []
  assert.equal(upkeepSkills(ws, { now }).skills[0].state, "demoted", "without keep the ordinary failing verdict applies")
})

test("skills.keep accepts only an array of skill names", async () => {
  const ws = await workspace({ "Home.md": "# Home\nA memo.\n" })
  for (const keep of ["release-notes", null, ["../elsewhere"], [1], [""], ["a".repeat(65)]]) {
    ws.skills = { keep }
    assert.throws(() => learnedSettings(ws), /keep/)
  }
  ws.skills = { keep: ["release-notes"] }
  assert.deepEqual(learnedSettings(ws).keep, ["release-notes"])
})

test("a check that runs out of time on a known case holds the skill instead of taking it out of use", async () => {
  const { ws } = await learning()
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now })
  const before = process.env.EXCUDO_CASE_TIMEOUT_MS
  // Give the ordinary case time to start; the deliberately sleeping case still exceeds this budget.
  process.env.EXCUDO_CASE_TIMEOUT_MS = "1500"
  // The failing case sleeps past the time a case may run: the check judges nothing wrong, it only does not finish (a busy machine).
  const sleep = "(Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000), false)"
  try {
    writeSkill(dir, "release-notes", { verdict: `facts.text === null ? ${sleep} : Boolean(facts.text?.startsWith("# "))` })
    const lint = lintSkill(dir)
    assert.equal(lint.ok, false)
    assert.equal(lint.held, true)
    assert.match(lint.checks.find((check) => check.id === "cases").message, /missing/)
    const held = upkeepSkills(ws, { now })
    assert.deepEqual(held.skills.map((skill) => [skill.status, skill.state, skill.held]), [["active", "held", true]])
    assert.equal(readLearned(ws).skills["release-notes"].status, "active")
    assert.ok(existsSync(join(ws.root, ".agents", "skills", "release-notes")), "a held skill stays installed")

    // A case with an empty name that runs out of time is held the same way, by its number.
    writeSkill(dir, "release-notes", { verdict: `facts.text === null ? ${sleep} : Boolean(facts.text?.startsWith("# "))`,
      cases: [{ name: "written", expect: "pass", facts: { text: "# 1.2\n" } }, { name: "", expect: "fail", facts: { text: null } }] })
    assert.equal(lintSkill(dir).held, true)
    assert.match(lintSkill(dir).checks.find((check) => check.id === "cases").message, /: 2\./)

    // A time-out does not hide a score below minScore: without the check in a code block the skill scores 75 and is taken out of use.
    writeSkill(dir, "release-notes", { verdict: `facts.text === null ? ${sleep} : Boolean(facts.text?.startsWith("# "))` })
    const md = join(dir, "SKILL.md")
    writeFileSync(md, readFileSync(md, "utf8").replace(/```sh\n(node [^\n]+)\n```/, "Run `$1`."))
    assert.equal(lintSkill(dir).score, 75)
    assert.deepEqual(upkeepSkills(ws, { now }).skills.map((skill) => [skill.status, skill.state, skill.held]), [["draft", "demoted", false]])
    writeSkill(dir, "release-notes")
    assert.equal(adoptSkill(ws, "release-notes", { now }).status, "active")

    // A case judged wrongly is a verdict, even beside one that ran out of time: the skill is taken out of use.
    writeSkill(dir, "release-notes", { verdict: `facts.text === null ? ${sleep} : false` })
    assert.equal(lintSkill(dir).held, false)
    assert.deepEqual(upkeepSkills(ws, { now }).skills.map((skill) => [skill.status, skill.state]), [["draft", "demoted"]])
  } finally {
    if (before === undefined) delete process.env.EXCUDO_CASE_TIMEOUT_MS
    else process.env.EXCUDO_CASE_TIMEOUT_MS = before
  }
})

test("a skill made of the owner's words is refused; so is a dismissal reason that copies them", async () => {
  const { ws } = await learning()
  const { candidates } = skillCandidates(ws, { now })
  assert.throws(() => dismissCandidate(ws, candidates[0].id, { reason: "write the release notes for the site from the merged changes", now }), /own words|자기 말/)
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes", { body: "\nThe owner said: please write the release notes for the site from merged changes again.\n" })
  const result = adoptSkill(ws, "release-notes", { from: candidates[0].id, now })
  assert.equal(result.status, "draft")
  assert.equal(result.lint.checks.find((check) => check.id === "own-words").ok, false)
  assert.ok(!existsSync(join(ws.root, ".agents", "skills", "release-notes")))
  assert.equal(skillCandidates(ws, { now }).candidates.length, 0, "the draft holds its candidate while it is fixed")

  const other = (await learning()).ws
  const [candidate] = skillCandidates(other, { now }).candidates
  assert.deepEqual(dismissCandidate(other, candidate.id, { reason: "the release routine differs every time", now }), { id: candidate.id, count: 3 })
  assert.equal(skillCandidates(other, { now }).candidates.length, 0, "a dismissed candidate is not offered again")
})

test("a global skill is copied for both agents, follows its source, and a copy someone edited is never overwritten or removed", async () => {
  const { ws } = await learning({ skills: { install: "global" } })
  const home = tempDir("excudo-home-")
  mkdirSync(join(home, ".claude"))
  mkdirSync(join(home, ".codex"))
  const source = join(ws.root, "skills", "release-notes")
  writeSkill(source, "release-notes")
  assert.equal(adoptSkill(ws, "release-notes", { requested: true, now, home }).state, "installed")
  const copy = join(home, ".agents", "skills", "release-notes")
  assert.ok(!lstatSync(copy).isSymbolicLink(), "the copy is the global skill's folder")
  assert.ok(readFileSync(join(copy, "SOURCE.md"), "utf8").startsWith(`<!-- excudo-learned: ${ws.root} -->`))
  for (const tool of [".claude", ".codex"]) assert.equal(readlinkSync(join(home, tool, "skills", "release-notes")), join("..", "..", ".agents", "skills", "release-notes"))

  writeSkill(source, "release-notes", { body: "\n3. Link each change to its pull request.\n" })
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "updated")
  assert.match(readFileSync(join(copy, "SKILL.md"), "utf8"), /pull request/)
  writeFileSync(join(copy, "notes.md"), "The owner's own note in the copy.\n")
  writeSkill(source, "release-notes", { body: "\n3. Link each change to its issue.\n" })
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "edited")
  assert.doesNotMatch(readFileSync(join(copy, "SKILL.md"), "utf8"), /its issue/, "an edited copy is not overwritten")
  assert.equal(retireSkill(ws, "release-notes", { now, home }).state, "edited")
  assert.ok(existsSync(join(copy, "notes.md")), "nor removed when the skill is retired")

  assert.equal(adoptSkill(ws, "release-notes", { now, home, force: true }).state, "updated", "the owner may replace it on purpose")
  assert.ok(!existsSync(join(copy, "notes.md")))
  rmSync(join(ws.cacheDir, "skills-installed.json"))
  writeSkill(source, "release-notes", { body: "\n3. Name the authors.\n" })
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "edited", "without the record of what was installed, the copy is left alone")
  writeFileSync(join(copy, "SKILL.md"), readFileSync(join(source, "SKILL.md")))
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "current", "once the copy matches its source it is ours again")

  assert.equal(retireSkill(ws, "release-notes", { now, home }).state, "removed")
  assert.ok(!existsSync(copy))
  for (const tool of [".claude", ".codex"]) assert.throws(() => lstatSync(join(home, tool, "skills", "release-notes")))
  assert.equal(readLearned(ws).skills["release-notes"].status, "retired")

  writeSkill(join(home, ".agents", "skills", "notes-helper"), "notes-helper")
  writeSkill(join(ws.root, "skills", "notes-helper"), "notes-helper")
  assert.throws(() => adoptSkill(ws, "notes-helper", { requested: true, now, home }), /another skill|다른 스킬/)
})

test("linked worktrees inspect global skills with the owner's record but never change their installation", async () => {
  const ws = await workspace({}, { cache: "cache/engine", skills: { install: "global" } })
  const home = tempDir("excudo-home-")
  const git = (...args) => {
    const result = spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  git("config", "user.name", "Test")
  git("config", "user.email", "test@example.org")
  writeFileSync(join(ws.root, ".gitignore"), "cache/\n")
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now, home })
  git("add", ".")
  git("commit", "-qm", "Test: Save skill")
  const root = join(tempDir("excudo-worktrees-"), "linked")
  git("worktree", "add", "--detach", root)
  try {
    const linked = await loadWorkspace({ root })
    const copy = join(home, ".agents", "skills", "release-notes")
    const record = join(ws.cacheDir, "skills-installed.json")
    const beforeRecord = readFileSync(record, "utf8")
    const beforeNote = readFileSync(join(copy, "SOURCE.md"), "utf8")
    const beforeSkill = readFileSync(join(copy, "SKILL.md"), "utf8")
    const installedTimes = () => [record, join(copy, "SOURCE.md"), join(copy, "SKILL.md")].map((file) => lstatSync(file).mtimeMs)
    const beforeTimes = installedTimes()
    const state = () => skillsStatus(linked, { now, home }).skills[0].state
    assert.equal(existsSync(join(linked.cacheDir, "skills-installed.json")), false)
    assert.equal(state(), "current")
    const checked = spawnSync(process.execPath, [join(SKILLS_DIR, "excudo-skills", "scripts", "check.mjs")], {
      cwd: root, encoding: "utf8", env: homeEnv(home), timeout: 60000,
    })
    assert.match(checked.stdout, /✓ installed:/, checked.stderr + checked.stdout)

    // Even matching content must not let upkeep claim or rewrite the owner's copy.
    assert.throws(() => adoptSkill(linked, "release-notes", { now, home, force: true }), /linked worktree/)
    assert.match(upkeepSkills(linked, { now, home }).skills[0].reason, /linked worktree/)
    assert.equal(existsSync(join(linked.cacheDir, "skills-installed.json")), false)
    assert.deepEqual(installedTimes(), beforeTimes, "even a matching installation remains untouched")
    writeSkill(join(root, "skills", "changelog"), "changelog")
    assert.throws(() => adoptSkill(linked, "changelog", { requested: true, now, home }), /linked worktree/)
    assert.equal(existsSync(join(home, ".agents", "skills", "changelog")), false, "a linked worktree cannot claim a new global name")
    writeSkill(join(root, "skills", "release-notes"), "release-notes", { body: "\n3. Link each change to its issue.\n" })
    assert.equal(state(), "outdated")
    assert.throws(() => adoptSkill(linked, "release-notes", { now, home, force: true }), /linked worktree/)

    // The owner's record still detects copy edits; a local record takes precedence when present.
    appendFileSync(join(copy, "SOURCE.md"), "Owner annotation\n")
    assert.equal(state(), "edited")
    writeFileSync(join(copy, "SOURCE.md"), beforeNote)
    mkdirSync(linked.cacheDir, { recursive: true })
    writeFileSync(join(linked.cacheDir, "skills-installed.json"), JSON.stringify({ "release-notes": { files: "different", note: "different" } }))
    assert.equal(state(), "edited")
    rmSync(join(linked.cacheDir, "skills-installed.json"))
    const retired = retireSkill(linked, "release-notes", { now, home })
    assert.equal(retired.state, "exists")
    assert.match(retired.reason, /linked worktree/)
    assert.equal(readFileSync(record, "utf8"), beforeRecord)
    assert.equal(readFileSync(join(copy, "SOURCE.md"), "utf8"), beforeNote)
    assert.equal(readFileSync(join(copy, "SKILL.md"), "utf8"), beforeSkill)
    assert.equal(existsSync(join(linked.cacheDir, "skills-installed.json")), false)

    const other = await workspace({}, { skills: { install: "global" } })
    const init = spawnSync("git", ["init", "-q", other.root], { encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    writeSkill(join(other.root, "skills", "release-notes"), "release-notes")
    writeFileSync(join(other.root, "skills.json"), readFileSync(join(ws.root, "skills.json")))
    assert.equal(skillsStatus(other, { now, home }).skills[0].state, "exists")

    // Alternate spellings of the same Git directory still identify the repository.
    const alias = join(tempDir("excudo-alias-"), "workspace")
    symlinkSync(ws.root, alias, "dir")
    writeFileSync(join(copy, "SOURCE.md"), beforeNote.replace(ws.root, alias))
    assert.equal(skillsStatus(await loadWorkspace({ root }), { now, home }).skills[0].state, "off", "retirement remains local to the worktree")
    writeFileSync(join(root, "skills.json"), readFileSync(join(ws.root, "skills.json")))
    assert.equal(state(), "edited", "the owner record still rejects a changed SOURCE.md")
    const aliased = JSON.parse(beforeRecord)
    aliased["release-notes"].note = createHash("sha256").update(readFileSync(join(copy, "SOURCE.md"))).digest("hex")
    writeFileSync(record, JSON.stringify(aliased))
    assert.equal(state(), "outdated", "real Git common directories match across symlinked checkout names")
  } finally { git("worktree", "remove", "--force", root) }
})

test("a request is counted once however many there were, and status keeps the recorded state of a skill that broke", async () => {
  const { ws, logs } = await learning()
  const many = Array.from({ length: 40 }, (_, i) => said(`2026-10-${String(1 + (i % 12)).padStart(2, "0")}T0${i % 10}:${String(i).padStart(2, "0")}:00Z`, `m${i % 4}`,
    `write the release notes for the site from the merged changes, batch ${i}`)).join("")
  appendFileSync(join(logs, "s3.jsonl"), many)
  const [candidate] = skillCandidates(ws, { now }).candidates
  assert.equal(candidate.count, 43)
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  adoptSkill(ws, "release-notes", { from: candidate.id, now })
  assert.equal(readLearned(ws).skills["release-notes"].evidence.requests.length, 43, "every key inside the window is kept")
  for (let i = 0; i < 3; i++) assert.equal(upkeepSkills(ws, { now }).skills[0].matched, 0)
  assert.equal(readLearned(ws).skills["release-notes"].evidence.count, 43)

  rmSync(join(dir, "scripts", "check.cases.json"))
  const status = upkeepSkills(ws, { now, dryRun: true }).skills[0]
  assert.deepEqual([status.status, status.fit, status.state], ["active", false, "unfit"], "a dry run reports what is recorded and what upkeep would do")
  assert.equal(readLearned(ws).skills["release-notes"].status, "active")
})

test("words of a request typed a moment ago count, and save refuses a skill or record that copies them", async () => {
  const { ws, logs } = await learning()
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  const [candidate] = skillCandidates(ws, { now }).candidates
  appendFileSync(join(logs, "s2.jsonl"), said("2026-10-13T09:00:00Z", "s2", "please keep the changelog entries sorted by the date they were merged"))
  assert.throws(() => dismissCandidate(ws, candidate.id, { reason: "keep the changelog entries sorted by the date they were merged", now }), /own words|자기 말/)

  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes", { body: "\nAlso keep the changelog entries sorted by the date they were merged.\n" })
  assert.throws(() => commitGraph(ws, "Skills", { includeReview: true }), /copied|요청 문구/)
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes", { body: "\nOrder the entries by merge date.\n" })
  assert.equal(commitGraph(ws, "Skills", { includeReview: true }), "committed")
})

test("save commits the learned skills and their record with the graph", async () => {
  const ws = await workspace({ "Me.md": "# Me\nAbout me.\n" })
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  writeFileSync(join(ws.root, "skills.json"), '{ "skills": {}, "dismissed": {} }\n')
  writeFileSync(join(ws.root, "outside.txt"), "not the memo's\n")
  assert.equal(commitGraph(ws, "Save", { includeReview: true }), "committed")
  const files = spawnSync("git", ["ls-files"], { cwd: ws.root, encoding: "utf8" }).stdout.split("\n")
  assert.ok(files.includes("skills.json") && files.includes("skills/release-notes/scripts/check.mjs"))
  assert.ok(!files.includes("outside.txt"))
})

test("the scaffold starts a skill that lint refuses until every mark is filled in", async () => {
  const ws = await workspace({ "Me.md": "# Me\nAbout me.\n" }, { locale: "ko" })
  const scaffold = join(SKILLS_DIR, "excudo-skills", "scripts", "scaffold.mjs")
  const made = run([scaffold, "docs-dataset-check", "--description", "Check the dataset files. Use for “데이터셋 검사해 줘”."], ws.root)
  assert.equal(made.status, 0, made.stderr)
  assert.equal(run([scaffold, "docs-dataset-check", "--description", "again"], ws.root).status, 1, "an existing skill is never overwritten")
  const result = lintSkill(join(ws.root, "skills", "docs-dataset-check"))
  assert.equal(result.ok, false)
  assert.deepEqual(result.checks.filter((check) => !check.ok).map((check) => check.id).sort(), ["cases", "filled"])
  assert.match(readFileSync(join(ws.root, "skills", "docs-dataset-check", "SKILL.md"), "utf8"), /## 검사\n[\s\S]*node \.agents\/skills\/docs-dataset-check\/scripts\/check\.mjs/)
})

test("skills lint needs no workspace and reports the engine's skills", () => {
  // Linting every engine skill runs all known cases; under load it can take minutes, which is not a failure.
  const result = run([cli, "skills", "lint"], tempDir(), 300000)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout.trim().split("\n").filter((row) => row.includes("100/100")).length, skillNames().length)
})

test("the skills' checks judge a real workspace", async () => {
  const ws = await workspace({ "Me.md": "# Me\nAbout me.\n\n- TODO Call the dentist\n- TODO Renew the passport\n" })
  const git = (...args) => spawnSync("git", args, { cwd: ws.root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nnode_modules/\n")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "start")
  const since = git("rev-parse", "HEAD").stdout.trim()
  const check = (name, ...args) => run([join(SKILLS_DIR, name, "scripts", "check.mjs"), ...args], ws.root)

  // A task only tagged since (here deferred) is still the same task for the cleanup check.
  writeFileSync(join(ws.graphDir, "Me.md"), "# Me\nAbout me.\n\n- TODO Call the dentist #later\n- TODO Water the plants\n")
  let result = check("excudo-capture", "--text", "Water the plants", "--node", "Me")
  assert.equal(result.status, 1)
  assert.match(result.stdout, /✗ saved/)
  assert.match(result.stdout, /✓ once/)
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "capture")
  assert.equal(check("excudo-capture", "--text", "Water the plants", "--node", "Me").status, 0)
  // Someone writing elsewhere meanwhile: work saved on its own pages passes when the check is told them.
  writeFileSync(join(ws.graphDir, "Other.md"), "# Other\nSomeone is writing here.\n")
  assert.equal(check("excudo-capture", "--node", "Me").status, 1)
  assert.equal(check("excudo-capture", "--node", "Me", "--only", "Me.md").status, 0)
  rmSync(join(ws.graphDir, "Other.md"))

  result = check("excudo-distill", "--since", since)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /✗ open-tasks: .*Renew the passport/)
  assert.doesNotMatch(result.stdout, /open-tasks: .*dentist/)
  assert.equal(check("excudo-distill", "--since", since, "--allow-removed").status, 0)
  assert.equal(check("excudo-distill").status, 2, "the commit to compare with is required")

  // Only the owner decides what is done: a task closed since needs their word, a task tagged and closed too.
  writeFileSync(join(ws.graphDir, "Me.md"), "# Me\nAbout me.\n\n- DONE Call the dentist #later\n- TODO Water the plants\n")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "done")
  result = check("excudo-distill", "--since", since, "--allow-removed")
  assert.equal(result.status, 1)
  assert.match(result.stdout, /✗ done-by-owner: .*Call the dentist/)
  assert.equal(check("excudo-distill", "--since", since, "--allow-removed", "--allow-done", "call the dentist").status, 0)
  assert.equal(check("excudo-distill", "--since", since, "--allow-removed", "--allow-done", "Renew the passport").status, 1, "the owner's word covers only the task they named")

  result = check("excudo-setup")
  assert.equal(result.status, 1, "this workspace has no AGENTS.md, skills or engine")
  assert.match(result.stdout, /✗ engine/)
  assert.match(result.stdout, /✗ agents-rules/)
  assert.match(result.stdout, /✓ ignored/)
})

test("a lock is never taken from a running command, is taken at once from one that is gone, and only its holder releases it", () => {
  const file = join(tempDir(), "state")
  const lock = `${file}.lock`
  writeFileSync(lock, `${process.pid} 1 held`)
  utimesSync(lock, new Date(Date.now() - 300000), new Date(Date.now() - 300000))
  assert.throws(() => withLock(file, () => "stolen", "busy", { wait: 100, stale: 3600000 }), /busy/)
  writeFileSync(lock, "999999 1 gone")
  assert.equal(withLock(file, () => "taken", "busy", { wait: 100 }), "taken")
  withLock(file, () => writeFileSync(lock, `${process.pid} 2 someone else`), "busy")
  assert.equal(readFileSync(lock, "utf8"), `${process.pid} 2 someone else`, "a lock another holder took is not released")
})

test("save reads the logs before comparing, and finds a request copied into JSON", async () => {
  const { ws, logs } = await learning()
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  assert.equal(commitGraph(ws, "Skills", { includeReview: true }), "committed")
  // Typed after the cache was last read, then copied into a file git already tracks, where JSON escapes its line breaks.
  appendFileSync(join(logs, "s1.jsonl"), said("2026-10-13T09:00:00Z", "s1", "keep the plan private\nshare it with the team\nonly after the review\nand never publish it"))
  writeSkill(dir, "release-notes", { cases: [
    { name: "keep the plan private\nshare it with the team\nonly after the review\nand never publish it", expect: "pass", facts: { text: "# 1.2\n" } },
    { name: "missing", expect: "fail", facts: { text: null } },
  ] })
  assert.throws(() => commitGraph(ws, "Skills", { includeReview: true }), /copied|요청 문구/)
  assert.equal(lintSkill(dir, { copied: (items) => copiedPassages(ws, items) }).checks.find((check) => check.id === "own-words").ok, false)
})

test("an edit to SOURCE.md alone is kept, a skill whose source is gone does not stop upkeep, and a move never loses the installation", async () => {
  const { ws } = await learning({ skills: { install: "global" } })
  const home = tempDir("excudo-home-")
  mkdirSync(join(home, ".claude"))
  const source = join(ws.root, "skills", "release-notes")
  writeSkill(source, "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now, home })
  const copy = join(home, ".agents", "skills", "release-notes")
  appendFileSync(join(copy, "SOURCE.md"), "\nThe owner's note on where this is used.\n")
  assert.equal(upkeepSkills(ws, { now, home, dryRun: true }).skills[0].state, "edited")
  assert.equal(retireSkill(ws, "release-notes", { now, home }).state, "edited")
  assert.match(readFileSync(join(copy, "SOURCE.md"), "utf8"), /owner's note/)

  adoptSkill(ws, "release-notes", { now, home, force: true })
  rmSync(source, { recursive: true })
  const status = upkeepSkills(ws, { now, home, dryRun: true })
  assert.deepEqual(status.skills.map((skill) => [skill.status, skill.missing, skill.state]), [["active", true, "unfit"]])
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "demoted")
  assert.ok(!existsSync(copy), "an unchanged copy of a skill whose source is gone is taken away")

  const moving = (await learning()).ws
  writeSkill(join(moving.root, "skills", "release-notes"), "release-notes")
  adoptSkill(moving, "release-notes", { requested: true, now, home })
  writeSkill(join(home, ".agents", "skills", "release-notes"), "release-notes")
  assert.throws(() => adoptSkill(moving, "release-notes", { install: "global", now, home }), /another skill|다른 스킬/)
  assert.ok(existsSync(join(moving.root, ".agents", "skills", "release-notes", "SKILL.md")), "the workspace installation stays")
  assert.equal(readLearned(moving).skills["release-notes"].install, "workspace")
  assert.equal(upkeepSkills(moving, { now, home }).skills[0].state, "current")
  assert.equal(readLearned(moving).skills["release-notes"].install, "workspace")
})

test("a global copy installed under the engine's former mark or from a folder the workspace moved from stays ours, and is installed again naming the current folder", async () => {
  const { ws } = await learning({ skills: { install: "global" } })
  const home = tempDir("excudo-home-")
  mkdirSync(join(home, ".claude"))
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  adoptSkill(ws, "release-notes", { requested: true, now, home })
  const note = join(home, ".agents", "skills", "release-notes", "SOURCE.md")
  const current = `<!-- excudo-learned: ${ws.root} -->`
  // Rewrites the copy's first line as an earlier installation wrote it, with the record of that installation.
  const installedAs = (first) => {
    writeFileSync(note, readFileSync(note, "utf8").replace(/^.*\n/, `${first}\n`))
    const record = join(ws.cacheDir, "skills-installed.json")
    const installed = JSON.parse(readFileSync(record, "utf8"))
    installed["release-notes"].note = createHash("sha256").update(readFileSync(note)).digest("hex")
    writeFileSync(record, JSON.stringify(installed))
  }

  for (const former of ["electricity-is-not-free-learned", "mindplanter-learned"]) {
    installedAs(`<!-- ${former}: ${ws.root} -->`)
    assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "updated", former)
    assert.ok(readFileSync(note, "utf8").startsWith(current), `the copy marked ${former} names the current mark`)
    assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "current", former)
  }

  const before = "/no/such/folder-before-the-move"
  installedAs(`<!-- mindplanter-learned: ${before} -->`)
  assert.equal(upkeepSkills(ws, { now, home, dryRun: true }).skills[0].state, "exists", "a copy from a folder not on record is someone else's")
  ws.moved = { [before]: ws.root }
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "updated")
  assert.ok(readFileSync(note, "utf8").startsWith(current), "the copy names the folder the workspace is in now")
  assert.match(readFileSync(note, "utf8"), new RegExp(`${ws.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/skills/release-notes`))
})

test("each skill stays where it was adopted; one goes to every folder with its reason or the owner's ask", async () => {
  const { ws } = await learning()
  const home = tempDir("excudo-home-")
  mkdirSync(join(home, ".claude"))
  const [candidate] = skillCandidates(ws, { now, home }).candidates
  const source = join(ws.root, "skills", "release-notes")
  writeSkill(source, "release-notes")
  const local = join(ws.root, ".agents", "skills", "release-notes")
  const copy = join(home, ".agents", "skills", "release-notes")
  let adopted = adoptSkill(ws, "release-notes", { from: candidate.id, now, home })
  assert.equal(adopted.install, "workspace")
  assert.equal(readlinkSync(local), join("..", "..", "skills", "release-notes"))
  assert.equal(readlinkSync(join(ws.root, ".claude", "skills", "release-notes")), join("..", "..", ".agents", "skills", "release-notes"))

  // Every folder takes a skill on a reason in the agent's own words, never on none.
  assert.throws(() => adoptSkill(ws, "release-notes", { install: "global", now, home }), /why|이유/)
  assert.throws(() => adoptSkill(ws, "release-notes", { install: "global", why: "please write the release notes for the site from merged changes again", now, home }), /own words|자기 말/)
  assert.ok(!existsSync(copy))
  adopted = adoptSkill(ws, "release-notes", { install: "global", why: "Its work happens in the site repository.", now, home })
  assert.deepEqual([adopted.install, adopted.state], ["global", "installed"])
  assert.ok(existsSync(join(copy, "SOURCE.md")))
  assert.throws(() => lstatSync(local), "the workspace links go once the copy is in place")
  assert.equal(readLearned(ws).skills["release-notes"].why, "Its work happens in the site repository.")
  assert.equal(readLearned(ws).skills["release-notes"].evidence.requested, undefined)
  assert.equal(readLearned(ws).skills["release-notes"].evidence.count, 3, "the candidate's evidence stays")

  // The setting places new skills only; upkeep keeps this one where it went.
  let kept = upkeepSkills(ws, { now, home })
  assert.deepEqual([kept.skills[0].install, kept.skills[0].state], ["global", "current"])
  assert.ok(existsSync(copy))
  adoptSkill(ws, "release-notes", { now, home })
  assert.equal(readLearned(ws).skills["release-notes"].install, "global", "adopting again without a place keeps it")
  assert.equal(readLearned(ws).skills["release-notes"].why, "Its work happens in the site repository.", "and its reason")

  // Back to the workspace; a copy someone edited stays and is reported.
  writeFileSync(join(copy, "notes.md"), "The owner's own note.\n")
  adopted = adoptSkill(ws, "release-notes", { install: "workspace", now, home })
  assert.deepEqual([adopted.install, adopted.state, adopted.left], ["workspace", "installed", copy])
  assert.equal(readLearned(ws).skills["release-notes"].why, undefined, "a skill back in the workspace needs no reason")
  assert.ok(existsSync(join(copy, "notes.md")))
  rmSync(copy, { recursive: true })
  for (const tool of [".claude"]) rmSync(join(home, tool, "skills", "release-notes"))
  kept = upkeepSkills(ws, { now, home })
  assert.deepEqual([kept.skills[0].install, kept.skills[0].state], ["workspace", "current"])

  // A record written before skills kept their place takes the setting's, and keeps it.
  const record = JSON.parse(readFileSync(join(ws.root, "skills.json"), "utf8"))
  delete record.skills["release-notes"].install
  writeFileSync(join(ws.root, "skills.json"), JSON.stringify(record))
  upkeepSkills(ws, { now, home })
  assert.equal(readLearned(ws).skills["release-notes"].install, "workspace")
  ws.skills = { install: "global" }
  assert.equal(upkeepSkills(ws, { now, home }).skills[0].state, "current")
  assert.ok(!existsSync(copy), "a changed setting moves no skill")
  writeSkill(join(ws.root, "skills", "changelog"), "changelog")
  assert.equal(adoptSkill(ws, "changelog", { requested: true, now, home }).install, "global", "a new skill goes where the setting says")
  assert.throws(() => adoptSkill(ws, "changelog", { install: "everywhere", now, home }), /workspace|global/)

  // A candidate's skill the owner wants shared at once keeps both its requests and the owner's ask.
  const fresh = (await learning()).ws
  writeSkill(join(fresh.root, "skills", "release-notes"), "release-notes")
  const id = skillCandidates(fresh, { now, home }).candidates[0].id
  assert.throws(() => adoptSkill(fresh, "release-notes", { from: id, install: "global", now, home }), /why|이유/)
  adopted = adoptSkill(fresh, "release-notes", { from: id, requested: true, install: "global", now, home })
  assert.equal(adopted.install, "global")
  assert.deepEqual([readLearned(fresh).skills["release-notes"].evidence.count, readLearned(fresh).skills["release-notes"].evidence.requested], [3, "2026-10-14"])
})

test("upkeep says where a skill's requests were typed, and the check finds a workspace skill asked for elsewhere", async () => {
  const { ws } = await learning()
  const home = tempDir("excudo-home-")
  const [candidate] = skillCandidates(ws, { now, home }).candidates
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  adoptSkill(ws, "release-notes", { from: candidate.id, now, home })
  assert.deepEqual(upkeepSkills(ws, { now, home, dryRun: true }).skills[0].typed, { here: 0, elsewhere: 3 })

  // A folder below the workspace is here, also by another spelling of its path; a sibling whose name
  // starts the same is not, and a request no longer in the cache is not counted.
  const rows = new Map([["a", { cwd: ws.graphDir }], ["b", { cwd: realpathSync(ws.root) }], ["c", { cwd: `${ws.root}-other` }], ["d", {}]])
  assert.deepEqual(typedWhere(ws, ["a", "b", "c", "d", "e"], rows), { here: 2, elsewhere: 1 })
  assert.equal(typedWhere(ws, ["a"], undefined), null, "a workspace that reads no requests says nothing")

  const env = homeEnv(home)
  const check = () => spawnSync(process.execPath, [join(SKILLS_DIR, "excudo-skills", "scripts", "check.mjs")], { cwd: ws.root, encoding: "utf8", env, timeout: 60000 }).stdout
  const status = () => spawnSync(process.execPath, [cli, "skills", "status", "--root", ws.root], { encoding: "utf8", env, timeout: 60000 }).stdout
  assert.match(check(), /✗ placed: .*release-notes \(3\/3\)/)
  assert.match(status(), /release-notes: .*asked for mostly in other folders, where it is not read \(3 of 3 requests\)/)
  adoptSkill(ws, "release-notes", { install: "global", why: "Its work happens in the site repository.", now, home })
  assert.match(check(), /✓ placed/)
  assert.doesNotMatch(status(), /other folders/, "a skill in every folder is read where it is asked for")
})

test("skills adopt says where a skill went, and refuses an unasked or doubled place", async () => {
  const { ws } = await learning()
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  const env = homeEnv(tempDir("excudo-home-"))
  const adopt = (...args) => spawnSync(process.execPath, [cli, "skills", "adopt", "release-notes", "--root", ws.root, ...args], { encoding: "utf8", env, timeout: 60000 })
  let result = adopt("--requested")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /release-notes is in use for this workspace: 100\/100 \(installed\)/)
  assert.doesNotMatch(result.stdout, /draft/, "a skill in use is not also reported as a draft")
  result = adopt("--global", "--workspace")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Choose one place/)
  result = adopt("--global", "--why", "It is used in the site repository.")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /is in use for every folder/)
  assert.equal(readLearned(ws).skills["release-notes"].why, "It is used in the site repository.")
  result = adopt("--workspace")
  assert.equal(result.status, 0, result.stderr)
  writeFileSync(join(ws.root, "skills", "release-notes", "scripts", "check.cases.json"), "[]")
  result = adopt()
  assert.equal(result.status, 1)
  assert.match(result.stdout, /stays a draft/)
  assert.doesNotMatch(result.stdout, /is in use/)
})

test("save commits the links of a skill installed for the workspace, and their removal", async () => {
  const { ws } = await learning()
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  const home = tempDir("excudo-home-")
  writeSkill(join(ws.root, "skills", "release-notes"), "release-notes")
  mkdirSync(join(ws.root, ".agents", "skills", "other"), { recursive: true })
  writeFileSync(join(ws.root, ".agents", "skills", "other", "SKILL.md"), "not learned\n")
  adoptSkill(ws, "release-notes", { requested: true, now, home })
  assert.equal(commitGraph(ws, "Save", { includeReview: true }), "committed")
  const files = () => spawnSync("git", ["ls-files", "-s"], { cwd: ws.root, encoding: "utf8" }).stdout
  assert.match(files(), /^120000 .*\t\.agents\/skills\/release-notes$/m)
  assert.match(files(), /^120000 .*\t\.claude\/skills\/release-notes$/m)
  assert.doesNotMatch(files(), /skills\/other/, "only the learned skills' links")
  retireSkill(ws, "release-notes", { now, home })
  assert.equal(commitGraph(ws, "Retire", { includeReview: true }), "committed")
  assert.doesNotMatch(files(), /\.agents\/skills\/release-notes/)
  assert.equal(spawnSync("git", ["status", "--porcelain", "--", ".agents/skills/release-notes", ".claude/skills/release-notes"], { cwd: ws.root, encoding: "utf8" }).stdout, "")
})

test("a lock is removed only while it still holds what was seen, and an unreadable log folder stops the reading", { skip: process.platform === "win32" && "POSIX directory permissions" }, async () => {
  const lock = join(tempDir(), "state.lock")
  writeFileSync(lock, "A")
  assert.equal(reclaimLock(lock, "B"), false)
  assert.equal(readFileSync(lock, "utf8"), "A", "a lock that changed since it was judged is put back")
  assert.equal(reclaimLock(lock, "A"), true)
  assert.ok(!existsSync(lock))

  const { ws, logs } = await learning()
  const closed = join(logs, "closed")
  mkdirSync(closed)
  chmodSync(closed, 0)
  try {
    assert.throws(() => skillCandidates(ws, { now }), /EACCES|permission/i)
  } finally {
    chmodSync(closed, 0o755)
  }
})

test("a JSON value made of lines the file already had still counts as new", async () => {
  const { ws, logs } = await learning()
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  const parts = ["keep the plan private", "share it with the team", "only after the review", "and never publish it"]
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes", { cases: [...parts.map((name) => ({ name, expect: "pass", facts: { text: "# 1.2\n" } })), { name: "missing", expect: "fail", facts: { text: null } }] })
  assert.equal(commitGraph(ws, "Skills", { includeReview: true }), "committed")
  appendFileSync(join(logs, "s1.jsonl"), said("2026-10-13T09:00:00Z", "s1", parts.join("\n")))
  writeSkill(dir, "release-notes", { cases: [{ name: parts.join("\n"), expect: "pass", facts: { text: "# 1.2\n" } }, { name: "missing", expect: "fail", facts: { text: null } }] })
  assert.throws(() => commitGraph(ws, "Skills", { includeReview: true }), /copied|요청 문구/)
})

test("a mistake the owner pointed out is recorded only as a case its check fails, and lint keeps that case", async () => {
  const { ws } = await learning()
  const dir = join(ws.root, "skills", "release-notes")
  const cases = [{ name: "written", expect: "pass", facts: { text: "# 1.2\n" } }, { name: "missing", expect: "fail", facts: { text: null } },
    { name: "notes start without a heading", expect: "fail", facts: { text: "1.2 notes\n" } }]
  writeSkill(dir, "release-notes", { cases })
  adoptSkill(ws, "release-notes", { requested: true, now })
  assert.equal(lintSkill(dir).checks.some((check) => check.id === "mistakes"), false, "a skill with no mistake on record is linted as before")
  const mistake = (name, why = "Notes began without a heading.") => recordMistake(ws, "release-notes", { case: name, why, now })

  assert.throws(() => mistake("no such case"), /no case named “no such case”/)
  assert.throws(() => mistake("written"), /expects pass/)
  assert.throws(() => mistake("notes start without a heading", " "), /--why/)
  assert.throws(() => mistake("notes start without a heading", "write the release notes for the site from the merged changes"), /own words|자기 말/)
  assert.throws(() => recordMistake(ws, "excudo-capture", { case: "missing", why: "A note went to the wrong node.", now }), /engine/)
  assert.throws(() => recordMistake(ws, "changelog", { case: "missing", why: "A note went to the wrong node.", now }), /No learned skill/)
  // A case the check passes, whatever the file claims, does not show that the mistake is caught.
  writeSkill(dir, "release-notes", { cases: [...cases, { name: "a heading with no notes", expect: "fail", facts: { text: "# " } }] })
  assert.throws(() => mistake("a heading with no notes"), /judged pass, not fail/)
  assert.equal(readLearned(ws).skills["release-notes"].mistakes, undefined, "nothing refused is recorded")

  writeSkill(dir, "release-notes", { cases })
  assert.deepEqual(mistake("notes start without a heading"), { name: "release-notes", case: "notes start without a heading", n: 1 })
  assert.equal(mistake("notes start without a heading", "The notes lacked their heading.").n, 1, "a case recorded again is one record")
  assert.deepEqual(readLearned(ws).skills["release-notes"].mistakes, [{ case: "notes start without a heading", why: "The notes lacked their heading.", date: "2026-10-14" }])
  assert.doesNotMatch(readFileSync(join(ws.root, "skills.json"), "utf8"), /merged changes/)
  assert.equal(lintSkills(ws)[0].checks.find((check) => check.id === "mistakes").ok, true)
  assert.deepEqual(upkeepSkills(ws, { now, dryRun: true }).skills.map((skill) => [skill.mistakes, skill.lost]), [[1, []]])

  // Removed, or turned into a passing case, the mistake is no longer kept: lint fails, and the skill leaves use.
  writeSkill(dir, "release-notes", { cases: cases.slice(0, 2) })
  const lint = lintSkills(ws, ["release-notes"])[0]
  assert.equal(lint.ok, false)
  assert.match(lint.checks.find((check) => check.id === "mistakes").message, /“notes start without a heading”/)
  writeSkill(dir, "release-notes", { cases: [...cases.slice(0, 2), { ...cases[2], expect: "pass", facts: { text: "# 1.2\n" } }] })
  assert.equal(lintSkills(ws)[0].checks.find((check) => check.id === "mistakes").ok, false)
  assert.deepEqual(upkeepSkills(ws, { now, dryRun: true }).skills.map((skill) => [skill.fit, skill.state, skill.lost]), [[false, "unfit", ["notes start without a heading"]]])
  assert.equal(upkeepSkills(ws, { now }).skills[0].state, "demoted")
  assert.equal(adoptSkill(ws, "release-notes", { now }).status, "draft", "adopting it again keeps the recorded mistake too")
  writeSkill(dir, "release-notes", { cases })
  assert.equal(adoptSkill(ws, "release-notes", { now }).status, "active")
})

test("skills mistake records from the command line, status counts it, and the checks of skills and reflection see it", async () => {
  const { ws } = await learning({ interests: "Interests" })
  writeFileSync(join(ws.graphDir, "Interests.md"), "# Interests\nWhat the owner cares about.\n")
  const git = (...args) => spawnSync("git", args, { cwd: ws.root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git("add", "-A")
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "start")
  const since = git("rev-parse", "HEAD").stdout.trim()
  const dir = join(ws.root, "skills", "release-notes")
  writeSkill(dir, "release-notes")
  const env = homeEnv(tempDir("excudo-home-"))
  const skills = (...args) => spawnSync(process.execPath, [cli, "skills", ...args, "--root", ws.root], { encoding: "utf8", env, timeout: 60000 })
  const check = (name, ...args) => spawnSync(process.execPath, [join(SKILLS_DIR, name, "scripts", "check.mjs"), ...args], { cwd: ws.root, encoding: "utf8", env, timeout: 60000 }).stdout
  assert.equal(skills("adopt", "release-notes", "--requested").status, 0)

  // Corrections of the skill's work, added by a reflection, wait until each one's case is recorded or asked.
  const reflected = (hits, questions) => writeFileSync(join(ws.root, "reflect.json"), JSON.stringify({ candidates: { "release-notes": { node: "Site",
    hits: hits.map(([skill, name, note]) => ({ date: "2026-10-14", grade: "confirmed", skill, ...(name === undefined ? {} : { case: name }), note })) } }, ...(questions ? { questions } : {}) }))
  const heading = ["release-notes", "notes start without a heading", "Release notes need a heading."]
  reflected([["release-notes", "missing", "Release notes were written with nothing in them."], heading])
  assert.match(check("excudo-reflect", "--since", since), /✗ skill-mistakes: .*release-notes “missing” \(2026-10-14\)/)

  let result = skills("mistake", "release-notes", "--why", "Notes were written with nothing in them.")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /needs/)
  result = skills("mistake", "release-notes", "--case", "written", "--why", "Notes were written with nothing in them.")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /expects pass/)
  result = skills("mistake", "release-notes", "--case", "missing", "--why", "Notes were written with nothing in them.")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /release-notes: the case “missing” is recorded \(1 in all\)/)
  assert.match(skills("status").stdout, /release-notes: .*mistakes the owner pointed out that its check keeps: 1/)
  assert.match(check("excudo-skills"), /✓ mistakes/)
  // The mistake recorded for one correction answers for no other correction of the same skill that day.
  let reflection = check("excudo-reflect", "--since", since)
  assert.match(reflection, /✗ skill-mistakes: .*“notes start without a heading”/)
  assert.doesNotMatch(reflection, /skill-mistakes: .*“missing”/)
  reflected([["release-notes", "missing", "Release notes were written with nothing in them."], heading],
    [{ date: "2026-10-14", skill: "release-notes", case: "a heading with no notes", note: "Should the check also fail on a heading with no notes?" }])
  assert.match(check("excudo-reflect", "--since", since), /✗ skill-mistakes: .*“notes start without a heading”/, "a question about another case does not answer it")
  reflected([["release-notes", "missing", "Release notes were written with nothing in them."], heading],
    [{ date: "2026-10-14", skill: "release-notes", case: "notes start without a heading", note: "Should the check fail on notes without a heading?" }])
  assert.match(check("excudo-reflect", "--since", since), /✓ skill-mistakes/)
  // A correction of a skill that names no case cannot be tied to one.
  reflected([["release-notes", undefined, "Release notes need a heading."]])
  reflection = check("excudo-reflect", "--since", since)
  assert.match(reflection, /✗ reflect-json: .*needs case/)
  assert.match(reflection, /✗ skill-mistakes: .*release-notes \(no case named\)/)

  // An engine skill's correction cannot be recorded here: a question naming the skill and case keeps it.
  const capture = ["excudo-capture", "a note placed in another node", "A note went to the wrong node."]
  reflected([capture])
  assert.match(check("excudo-reflect", "--since", since), /✗ skill-mistakes: .*excudo-capture “a note placed in another node” \(2026-10-14, not a learned skill\)/)
  reflected([capture], [{ date: "2026-10-14", skill: "excudo-capture", case: "a note placed in another node", note: "Should the engine's capture check catch a note placed in the wrong node?" }])
  assert.match(check("excudo-reflect", "--since", since), /✓ skill-mistakes/)

  // Once the recorded case is gone, lint fails however the skill is named: by name, or by a path to its source.
  writeSkill(dir, "release-notes", { cases: [{ name: "written", expect: "pass", facts: { text: "# 1.2\n" } }, { name: "empty", expect: "fail", facts: { text: "" } }] })
  assert.match(check("excudo-skills"), /✗ mistakes: .*release-notes \(“missing”\)/)
  assert.equal(skills("lint", "release-notes").status, 1)
  for (const target of ["release-notes", "skills/release-notes", "skills/release-notes/", "./skills/release-notes", `${dir}/`, join(".agents", "skills", "release-notes")]) {
    const linted = spawnSync(process.execPath, [cli, "skills", "lint", target, "--json"], { cwd: ws.root, encoding: "utf8", env, timeout: 60000 })
    assert.equal(linted.status, 1, target)
    const [lint] = JSON.parse(linted.stdout)
    assert.deepEqual([lint.ok, lint.checks.find((item) => item.id === "mistakes")?.ok], [false, false], target)
  }
  const [byPath] = lintSkills(ws, [relative(process.cwd(), dir)])
  assert.equal(byPath.checks.find((item) => item.id === "mistakes")?.ok, false, "a path relative to where lint runs")
})
