import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { activityOutline, build, collectActivity } from "../src/index.mjs"
import { sessionRecords, withRecords } from "../src/records.mjs"
import { put, read, tempDir, workspace } from "./helpers.mjs"
const recordsText = (ws) => withRecords(ws, (db) => JSON.stringify(["settings", "requests", "sessions", "spans", "checks", "commits", "runs"].map((table) => db.prepare(`SELECT * FROM ${table}`).all())))

const line = (record) => `${JSON.stringify(record)}\n`
const at = (day, hour, minute = 0) => `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`
// A Claude Code session: what the owner typed, the skills and checks it ran, its title and pull request.
function claudeLog(id, { cwd = "/work/site", day = "2026-10-13", batch = false, title, name, turns = 1, skills = [], checks = [], pr } = {}) {
  const base = { sessionId: id, cwd, ...(batch ? { entrypoint: "sdk-cli" } : {}) }
  const records = []
  for (let i = 0; i < turns; i++) records.push({ ...base, type: "user", timestamp: at(day, 11, i), message: { role: "user", content: `A request ${i}` } })
  skills.forEach((skill, i) => records.push({ ...base, type: "assistant", timestamp: at(day, 11, 20 + i), message: { content: [{ type: "tool_use", id: `k${i}`, name: "Skill", input: { skill, args: "the owner's words" } }] } }))
  checks.forEach(([command, ok], i) => {
    records.push({ ...base, type: "assistant", timestamp: at(day, 11, 30 + i), message: { content: [{ type: "tool_use", id: `c${i}`, name: "Bash", input: { command } }] } })
    records.push({ ...base, type: "user", timestamp: at(day, 11, 30 + i), message: { role: "user", content: [{ type: "tool_result", tool_use_id: `c${i}`, is_error: !ok, content: ok ? "passed" : "Exit code 1" }] } })
  })
  if (title) records.push({ type: "ai-title", sessionId: id, aiTitle: title })
  if (name) records.push({ type: "agent-name", sessionId: id, agentName: name })
  // A session repeats its pull request's link with every turn.
  if (pr) for (let i = 0; i < 3; i++) records.push({ type: "pr-link", sessionId: id, prNumber: 7, prUrl: pr, prRepository: "team/site", timestamp: at(day, 12) })
  records.push({ ...base, type: "user", timestamp: at(day, 12, 30), message: { role: "user", content: "Thanks" } })
  return records.map(line).join("")
}

function git(dir, args, date) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

async function setup() {
  const logs = tempDir("excudo-logs-")
  const claude = join(logs, "claude", "-work-site")
  const codex = join(logs, "codex", "2026", "10", "13")
  mkdirSync(claude, { recursive: true })
  mkdirSync(codex, { recursive: true })
  writeFileSync(join(claude, "s1.jsonl"), claudeLog("s1", { title: "Header spacing", name: "landing-page", turns: 2, skills: ["site-release"],
    checks: [["node .agents/skills/site-release/scripts/check.mjs --since abc", true], ["node ~/.agents/skills/link-guard/scripts/check.mjs", false],
      ["node .agents/skills/site-release/scripts/check.mjs --self-test", true]], pr: "https://git.example.com/team/site/pull/7" }))
  writeFileSync(join(claude, "s2.jsonl"), claudeLog("s2", { title: "Fix [[Home]] links for #12 and owner:: me", day: "2026-10-12" }))
  writeFileSync(join(claude, "s3.jsonl"), claudeLog("s3", { title: "Rotate key " + "sk_" + "live_0123456789abcdefghijklmnopqrstuv" }))
  writeFileSync(join(claude, "s4.jsonl"), [line({ type: "assistant", sessionId: "s4", cwd: "/work/site", timestamp: at("2026-10-13", 11), message: { content: "Resumed" } }),
    line({ type: "ai-title", sessionId: "s4", aiTitle: "Opened and left" })].join(""))
  writeFileSync(join(claude, "s5.jsonl"), claudeLog("s5", { batch: true, checks: [["node .agents/skills/excudo-reflect/scripts/check.mjs", true]] }))
  writeFileSync(join(claude, "s6.jsonl"), claudeLog("s6", { title: "Scratch", cwd: join(tmpdir(), "scratch") }))
  writeFileSync(join(codex, "rollout-a.jsonl"), [
    line({ type: "session_meta", timestamp: at("2026-10-13", 13), payload: { id: "c1", cwd: "/work/site", source: "cli", originator: "codex-tui" } }),
    line({ type: "event_msg", timestamp: at("2026-10-13", 13, 1), payload: { type: "user_message", message: "Add a search box" } }),
  ].join(""))
  writeFileSync(join(codex, "rollout-b.jsonl"), [
    line({ type: "session_meta", timestamp: at("2026-10-13", 13), payload: { id: "c2", cwd: "/work/site", source: "exec", originator: "codex_exec" } }),
    line({ type: "event_msg", timestamp: at("2026-10-13", 13, 1), payload: { type: "user_message", message: "Scheduled prompt" } }),
  ].join(""))
  writeFileSync(join(codex, "rollout-c.jsonl"), [
    line({ type: "session_meta", timestamp: at("2026-10-13", 13), payload: { id: "c3", cwd: "/work/site", parent_thread_id: "c1", source: { subagent: "review" } } }),
    line({ type: "event_msg", timestamp: at("2026-10-13", 13, 1), payload: { type: "user_message", message: "Review the diff" } }),
  ].join(""))
  const ws = await workspace({ "projects/Site.md": "# Site\nThe website.\n\n## Workspace\n`/work/site` · `main`\n" },
    { locale: "en", conversations: { claude: join(logs, "claude"), codex: join(logs, "codex") } })
  return { ws, logs }
}

test("activity keeps what each session did, never what anyone wrote, and marks the scheduled runs", async () => {
  const { ws } = await setup()
  const result = collectActivity(ws, { now: new Date("2026-10-14T00:00:00Z") })
  assert.equal(result.total, 7)
  const sessions = Object.fromEntries(withRecords(ws, (db) => sessionRecords(db)).map((session) => [session.key, session]))
  const s1 = sessions["claude:s1"]
  // The name the owner gave wins over the made-up title; a check run to lint it is no use of the skill.
  assert.equal(s1.title, "landing-page")
  assert.deepEqual(s1.skills, ["site-release"])
  assert.deepEqual(s1.checks.map((check) => [check.skill, check.ok]), [["site-release", true], ["link-guard", false]])
  assert.equal(s1.prs.length, 1)
  assert.equal(s1.spans[0].turns, 3)
  assert.equal(sessions["claude:s5"].batch, true)
  assert.equal(sessions["codex:c2"].batch, true)
  // A thread an agent started for itself, and a session in a temporary folder, are not kept.
  assert.ok(!sessions["codex:c3"] && !sessions["claude:s6"])
  // Nothing typed is kept: not the requests, not a skill's arguments.
  const text = recordsText(ws)
  for (const words of ["A request", "Thanks", "Add a search box", "the owner's words", "passed"]) assert.ok(!text.includes(words), words)
  // A log that did not change is not read again.
  assert.equal(collectActivity(ws, { now: new Date("2026-10-14T00:00:00Z") }).sessions, 0)
})

test("the activity outline shows days newest first, nodes with their sessions, and only today open", async () => {
  const { ws } = await setup()
  collectActivity(ws, { now: new Date("2026-10-14T00:00:00Z") })
  const text = activityOutline(ws, undefined, "days: 3", { now: new Date("2026-10-13T12:40:00Z") })
  const lines = text.split("\n")
  assert.match(lines[0], /^- 2026-10-13 · sessions 3 · pull requests 1 · scheduled runs 2$/)
  assert.notEqual(lines[1], "  collapsed:: true")
  assert.ok(lines.includes("\t- [[Site]] · sessions 3 · pull requests 1"))
  assert.ok(lines.some((each) => /^\t\t- Claude \d\d:\d\d–\d\d:\d\d · landing-page · skills site-release · checks 1\/2 passed$/.test(each)))
  assert.ok(lines.includes("\t\t- pull request [team/site#7](https://git.example.com/team/site/pull/7)"))
  assert.ok(lines.includes("\t- scheduled runs 2 · checks 1/1 passed"))
  // A title that looks private shows without its words; one with outliner syntax makes no link, tag or property.
  assert.ok(lines.some((each) => each.endsWith("· (hidden: looked private)")))
  assert.ok(!text.includes("sk_live"))
  assert.ok(lines.some((each) => each.endsWith("· Fix [Home] links for ＃12 and owner: me")), text)
  // A session the owner typed nothing into shows nothing.
  assert.ok(!text.includes("Opened and left"))
  // An earlier day is folded.
  const earlier = lines.indexOf(lines.find((each) => each.startsWith("- 2026-10-12")))
  assert.equal(lines[earlier + 1], "  collapsed:: true")
  assert.equal(activityOutline(ws, undefined, "days: 3", { now: new Date("2026-11-30T12:00:00Z") }), "- No activity recorded yet. Run activity to collect it.")
})

test("the owner's commits go under the node of their repository; a scheduled run's commits are the run's", async () => {
  const { ws, logs } = await setup()
  const repo = tempDir("excudo-repo-")
  git(repo, ["init", "-q"])
  git(repo, ["config", "user.name", "Owner"])
  git(repo, ["config", "user.email", "owner@example.invalid"])
  put(ws.root, "projects/Tools.md", `# Tools\nThe tools.\n\n## Workspace\n\`${repo}\` · \`main\`\n`)
  writeFileSync(join(repo, "a.txt"), "a")
  git(repo, ["add", "."])
  git(repo, ["commit", "-qm", "Add the link checker"], at("2026-10-13", 10))
  writeFileSync(join(repo, "b.txt"), "b")
  git(repo, ["add", "."])
  git(repo, ["-c", "user.email=someone@example.invalid", "commit", "-qm", "Someone else's change"], at("2026-10-13", 10, 30))
  writeFileSync(join(repo, "c.txt"), "c")
  git(repo, ["add", "."])
  git(repo, ["commit", "-qm", "Save what the reflection found"], at("2026-10-13", 14, 2))
  // A scheduled run worked in the repository when the last commit was made.
  writeFileSync(join(logs, "claude", "-work-site", "s7.jsonl"), claudeLog("s7", { batch: true, cwd: repo }).replaceAll("T11:", "T14:").replaceAll("T12:", "T14:"))
  collectActivity(ws, { now: new Date("2026-10-14T00:00:00Z") })
  const text = activityOutline(ws, undefined, "days: 2", { now: new Date("2026-10-13T12:40:00Z") })
  assert.match(text, /\t- \[\[Tools\]\] · commits 1\n\t\t- commit [0-9a-f]{7} Add the link checker/)
  assert.ok(!text.includes("Someone else's change"))
  assert.ok(!text.includes("Save what the reflection found"))
  assert.match(text, /\t- scheduled runs 3 · commits 1 · checks 1\/1 passed/)
})

test("an activity fence in a view is drawn by the build, outside any node", async () => {
  const { ws } = await setup()
  collectActivity(ws, { now: new Date("2026-10-14T00:00:00Z") })
  put(ws.root, "views/Activity.mdx", "# Activity\nWhat the owner did lately.\n\n```activity\ndays: 30000\n```\n")
  const result = build(ws)
  assert.deepEqual(result.blocked, [])
  const page = read(ws, "Activity.md")
  assert.match(page, /^generated:: views\/Activity\.mdx/)
  assert.match(page, /- 2026-10-13 · sessions 3/)
  assert.match(page, /\[\[Site\]\] · sessions 3/)
  // A second build with the same activity leaves the page as it is.
  assert.deepEqual(build(ws).blocked, [])
})
