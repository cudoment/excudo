// What the owner did, day by day: the coding-agent sessions they worked in and the commits they made,
// kept so a view can show it (an ```activity fence). Sessions are read from the agents' logs the way
// requests are (the `conversations` setting), but only what a session was about and how it went is
// kept: its title, folders and times, the skills it ran and whether their checks passed, the pull
// requests it opened and its cost. Nothing the owner or an agent wrote is kept, and a scheduled run
// (`claude -p`, `codex exec`) is marked as one. Commits come from git: in each repository the owner
// worked in or watches, those by the author identity that repository is set to. The records stay
// outside the graph and outside git (records.mjs); the view shows only lines the engine words itself.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { format } from "./labels.mjs"
import { privateLine } from "./notes.mjs"
import { putSession, sessionRecords, setSetting, setting, withRecords } from "./records.mjs"
import { conversationsOf, placer, skippedFolder } from "./requests.mjs"
import { sourcesOf } from "./sources.mjs"
import { pathLines } from "./workspaces.mjs"

const SHOWN = 5
// Raised when what is read from a session changes, so every log still there is read again; a session
// whose log the agent has since deleted keeps what was read from it.
const EXTRACTION = 2
const LONGEST = 90
const real = (path) => { try { return realpathSync(path) } catch { return path } }

/** The local calendar day of a time, as YYYY-MM-DD. */
export function dayOf(time) {
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const clock = (time) => { const date = new Date(time); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` }

// The skill a check belongs to: the folder above its scripts/ (`…/skills/<name>/scripts/check.mjs`),
// named the way skills are (lowercase letters, digits and hyphens); `$PWD/scripts/check.mjs` names none.
const CHECK = /(?:^|[\s/"'])([a-z0-9][a-z0-9-]*)\/scripts\/check\.mjs\b/
// Running a check on known facts is linting it, not using the skill.
const LINTING = /--(?:facts|self-test|help)\b/

/** A span of work: one day in one folder, with its first and last time. */
function spanOf(spans, time, cwd) {
  if (!time || !cwd) return
  const key = `${dayOf(time)}\u0000${cwd}`
  const span = spans.get(key) ?? spans.set(key, { day: dayOf(time), cwd, start: time, end: time, turns: 0 }).get(key)
  if (time < span.start) span.start = time
  if (time > span.end) span.end = time
  return span
}
const finish = (session, spans) => ({ ...session, skills: [...session.skills].sort(), spans: [...spans.values()] })

/** A Claude Code log: one session, read for what it did and never for what anyone wrote. */
export function claudeSession(path) {
  const session = { tool: "claude", id: null, title: null, batch: false, skills: new Set(), checks: [], prs: [], cost: null }
  const spans = new Map()
  const pending = new Map()
  const prs = new Map()
  let named = null
  for (const line of readFileSync(path, "utf8").split("\n")) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    session.id ??= record.sessionId ?? null
    if (record.entrypoint === "sdk-cli") session.batch = true
    // The name the owner gave the session wins over the title the tool made up.
    if (record.type === "agent-name" && typeof record.agentName === "string" && record.agentName.trim()) named = record.agentName
    if (record.type === "ai-title" && typeof record.aiTitle === "string") session.title = record.aiTitle
    // A session repeats its pull request's link with every turn.
    if (record.type === "pr-link" && typeof record.prUrl === "string") prs.set(record.prUrl, { url: record.prUrl, repo: record.prRepository ?? null, number: record.prNumber ?? null, at: record.timestamp ?? null })
    if (record.type === "cost-state" && Number.isFinite(record.totalCostUSD)) session.cost = record.totalCostUSD
    if (record.isSidechain) continue
    const span = spanOf(spans, record.timestamp, record.cwd)
    const content = record.message?.content
    if (record.type === "user" && !record.isMeta && span && (typeof content === "string" || Array.isArray(content) && content.every((block) => block?.type === "text" || block?.type === "image"))) span.turns++
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === "tool_use" && block.name === "Skill" && typeof block.input?.skill === "string") session.skills.add(block.input.skill)
      if (block?.type === "tool_use" && block.name === "Bash") {
        const command = String(block.input?.command ?? "")
        const skill = command.match(CHECK)?.[1]
        if (skill && !LINTING.test(command)) pending.set(block.id, skill)
      }
      if (block?.type === "tool_result" && pending.has(block.tool_use_id)) {
        session.checks.push({ skill: pending.get(block.tool_use_id), ok: !block.is_error, at: record.timestamp ?? null, cwd: record.cwd ?? null })
        pending.delete(block.tool_use_id)
      }
    }
  }
  session.title = named ?? session.title
  session.prs = [...prs.values()]
  return session.id ? finish(session, spans) : null
}

/** A Codex log: its folders and times, and whether it was started by `codex exec`. */
export function codexSession(path) {
  const session = { tool: "codex", id: null, title: null, batch: false, skills: new Set(), checks: [], prs: [], cost: null }
  const spans = new Map()
  let cwd
  for (const line of readFileSync(path, "utf8").split("\n")) {
    let record
    try { record = JSON.parse(line) } catch { continue }
    const payload = record.payload ?? {}
    if (record.type === "session_meta") {
      // A thread an agent started for itself (a reviewer, a helper) is part of its parent's session.
      if (payload.parent_thread_id || payload.source?.subagent) return null
      session.id = payload.id ?? payload.session_id ?? session.id
      if (payload.source === "exec" || payload.originator === "codex_exec") session.batch = true
    }
    if (record.type === "session_meta" || record.type === "turn_context") cwd = payload.cwd ?? cwd
    const span = spanOf(spans, record.timestamp, cwd)
    if (span && record.type === "event_msg" && (payload.type === "user_message" || payload.type === "item_completed" && payload.item?.type === "UserMessage")) span.turns++
  }
  return session.id ? finish(session, spans) : null
}

function logFiles(dir) {
  const files = []
  const walk = (at) => {
    let entries
    try { entries = readdirSync(at, { withFileTypes: true }) } catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return; throw error }
    for (const entry of entries) {
      const full = join(at, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full)
    }
  }
  if (dir && existsSync(dir)) walk(dir)
  return files.sort()
}

const git = (dir, ...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })

/**
 * The repositories to read commits from, once each: the workspace's, the watched ones, those the
 * nodes' path lines name and those the sessions worked in.
 */
function repositories(ws, sessions) {
  const folders = new Set([ws.root])
  for (const source of sourcesOf(ws)) if (source.kind === "repo") folders.add(source.path)
  try { for (const line of pathLines(ws)) folders.add(line.path) } catch {}
  for (const session of sessions) for (const span of session.spans) folders.add(span.cwd)
  const byCommon = new Map()
  for (const folder of folders) {
    if (!existsSync(folder)) continue
    const top = git(folder, "rev-parse", "--show-toplevel")
    const common = git(folder, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if (top.status !== 0 || common.status !== 0) continue
    if (!byCommon.has(common.stdout.trim())) byCommon.set(common.stdout.trim(), top.stdout.trim())
  }
  return [...byCommon.values()]
}

/** The owner's commits in `top` since `since`: those by the author the repository is set to use. */
function commitsIn(top, since) {
  const email = git(top, "config", "user.email").stdout.trim()
  if (!email) return []
  const log = git(top, "log", "--all", "--no-merges", `--since=${since}`, `--author=${email}`, "--format=%H%x09%cI%x09%s")
  if (log.status !== 0) return []
  return log.stdout.split("\n").filter(Boolean).map((line) => {
    const [hash, at, ...subject] = line.split("\t")
    return { hash, at, subject: subject.join("\t"), repo: top }
  })
}

/**
 * Reads new sessions from the agents' logs and the owner's commits into the cache. A log whose size
 * and time are unchanged is not opened again; commits are read for `days` back. Returns the counts.
 */
export function collectActivity(ws, { days = 30, now = new Date() } = {}) {
  const where = conversationsOf(ws)
  if (!where) throw new Error(ws.labels.messages["requests-off"])
  return withRecords(ws, (db) => {
    if (setting(db, "activity.extraction") !== EXTRACTION) {
      db.exec("DELETE FROM cursors WHERE kind = 'activity'")
      setSetting(db, "activity.extraction", EXTRACTION)
    }
    const cursorOf = db.prepare("SELECT size, mtime FROM cursors WHERE kind = 'activity' AND path = ?")
    const setCursor = db.prepare(`INSERT INTO cursors (kind, path, size, mtime) VALUES ('activity', ?, ?, ?)
      ON CONFLICT (kind, path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime`)
    let read = 0
    for (const [tool, parse] of [["claude", claudeSession], ["codex", codexSession]]) {
      for (const path of logFiles(where[tool])) {
        let stat
        try { stat = statSync(path) } catch { continue }
        const mark = cursorOf.get(path)
        if (mark && mark.size === stat.size && mark.mtime === Math.floor(stat.mtimeMs)) continue
        const session = parse(path)
        if (session) {
          // A scheduled run counts wherever it ran; the owner's work only where a person works.
          const spans = session.spans.filter((span) => span.cwd && (session.batch || !skippedFolder(span.cwd, where.exclude)))
          if (spans.length) putSession(db, `${tool}:${session.id}`, { ...session, spans })
          read++
        }
        setCursor.run(path, stat.size, Math.floor(stat.mtimeMs))
      }
    }
    const since = new Date(now.getTime() - days * 86400000).toISOString()
    let commits = 0
    const insert = db.prepare("INSERT OR IGNORE INTO commits (hash, at, subject, repo) VALUES (?, ?, ?, ?)")
    for (const top of repositories(ws, sessionRecords(db)))
      for (const commit of commitsIn(top, since)) commits += Number(insert.run(commit.hash, commit.at, commit.subject, commit.repo).changes)
    return { sessions: read, commits, total: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n }
  }, { write: true })
}

/** What the cache holds for the days from `from` to `to` (YYYY-MM-DD), by day and node. */
export function activityDays(ws, { model, from, to } = {}) {
  const { sessions, commits } = withRecords(ws, (db) => ({ sessions: sessionRecords(db), commits: db ? db.prepare("SELECT hash, at, subject, repo FROM commits").all() : [] }))
  const place = placer(ws, { model })
  const days = new Map()
  const dayOfNode = (day, node) => {
    const nodes = days.get(day) ?? days.set(day, new Map()).get(day)
    return nodes.get(node) ?? nodes.set(node, { sessions: [], commits: [], prs: [], batch: [] }).get(node)
  }
  // A folder the owner does not track in the memo shows nothing (null), as its requests do not.
  const nodeOf = (cwd) => { const found = place(cwd); return found.untracked ? null : found.node ?? `~${found.where ?? cwd}` }
  const within = (day) => (!from || day >= from) && (!to || day <= to)
  const runs = []
  for (const session of sessions) {
    if (session.batch) for (const span of session.spans) runs.push({ cwd: span.cwd, start: Date.parse(span.start) - 60000, end: Date.parse(span.end) + 300000 })
    // A session that moved between folders of one node on one day shows once, from its first time to its last.
    const parts = new Map()
    for (const span of session.spans) {
      if (!within(span.day)) continue
      const node = session.batch ? "" : nodeOf(span.cwd)
      if (node === null) continue
      const key = `${span.day}\u0000${node}`
      const part = parts.get(key)
      if (!part) parts.set(key, { day: span.day, node, start: span.start, end: span.end, turns: span.turns, cwds: new Set([span.cwd]) })
      else { if (span.start < part.start) part.start = span.start; if (span.end > part.end) part.end = span.end; part.turns += span.turns; part.cwds.add(span.cwd) }
    }
    for (const part of parts.values()) {
      const checks = session.checks.filter((check) => check.at && dayOf(check.at) === part.day && (!check.cwd || part.cwds.has(check.cwd)))
      // A session the owner typed nothing into that day (opened and left, or only resumed) did no work then.
      if (!session.batch && !part.turns && !checks.length) continue
      const entry = dayOfNode(part.day, part.node)
      ;(session.batch ? entry.batch : entry.sessions).push({ title: session.title, start: part.start, end: part.end, skills: session.skills, checks, tool: session.tool })
    }
    for (const pr of session.prs) {
      // A pull request belongs to the day it was opened, in the folder the session worked in then.
      const day = pr.at ? dayOf(pr.at) : session.spans.at(-1)?.day
      const span = session.spans.find((each) => each.day === day) ?? session.spans.at(-1)
      const node = span && nodeOf(span.cwd)
      if (node != null && within(day)) dayOfNode(day, node).prs.push(pr)
    }
  }
  // A commit made while a scheduled run worked in its repository is the run's, under the same name.
  const inside = (folder, top) => { const at = real(folder); return at === top || at.startsWith(`${top}/`) }
  for (const commit of commits) {
    const day = dayOf(commit.at)
    if (!within(day)) continue
    const at = Date.parse(commit.at)
    const node = runs.some((run) => inside(run.cwd, commit.repo) && run.start <= at && at <= run.end) ? "" : nodeOf(commit.repo)
    if (node !== null) dayOfNode(day, node).commits.push(commit)
  }
  return days
}

/**
 * The ```activity fence of a view as outline text: the last `days` days (`days: <n>` in the fence),
 * newest first, each day's nodes with their sessions, commits and pull requests. Only today stays
 * open. A line that looks private (see notes.mjs) shows without its words.
 */
export function activityOutline(ws, model, spec = "", { now = new Date() } = {}) {
  const words = ws.labels.activity
  const count = Number(String(spec).match(/\bdays:\s*(\d+)/)?.[1] ?? 14)
  const today = dayOf(now)
  const from = dayOf(now.getTime() - (count - 1) * 86400000)
  let days
  try { days = activityDays(ws, { model, from, to: today }) } catch { days = new Map() }
  // Words from a log or a commit are shown as words: no link, embed, tag or property comes of them.
  // A long commit message shows its start, up to the colon that ends its gist when it has one
  // (not the type of a conventional commit); the rest is in git.
  const short = (text) => {
    if ([...text].length <= LONGEST) return text
    const gist = text.indexOf(": ")
    if (gist >= 20 && [...text.slice(0, gist)].length < LONGEST) return text.slice(0, gist)
    return `${[...text].slice(0, LONGEST - 1).join("").trimEnd()}…`
  }
  const safe = (text) => (text && !privateLine(text) ? short(text.replace(/\s+/g, " ").trim()
    .replace(/\[\[|\]\]|\(\(|\)\)/g, (pair) => pair[0]).replace(/#(?=\S)/g, "＃").replace(/::/g, ":")) : words.hidden)
  // A check is run again after what it reported is fixed; each skill counts once, by its last result.
  const settled = (checks) => [...new Map(checks.map((check) => [check.skill, check.ok])).values()]
  // Only what there was: a day of scheduled runs alone does not read as an empty day.
  const counts = (values) => Object.entries(values).filter(([, n]) => n).map(([key, n]) => format(words[key], { n })).join(" · ")
  const lines = []
  for (const day of [...days.keys()].sort().reverse()) {
    const nodes = days.get(day)
    const total = (key) => [...nodes].reduce((sum, [node, entry]) => sum + (node === "" ? 0 : entry[key].length), 0)
    lines.push(`- ${[day, counts({ sessions: total("sessions"), commits: total("commits"), prs: total("prs"), scheduled: nodes.get("")?.batch.length ?? 0 })].filter(Boolean).join(" · ")}`)
    if (day !== today) lines.push("  collapsed:: true")
    for (const [node, entry] of [...nodes].sort(([a], [b]) => (a === "") - (b === "") || a.localeCompare(b))) {
      if (node === "") {
        const checks = entry.batch.flatMap((session) => settled(session.checks))
        lines.push(`\t- ${[counts({ scheduled: entry.batch.length, commits: entry.commits.length }),
          ...(checks.length ? [format(words.checks, { ok: checks.filter(Boolean).length, n: checks.length })] : [])].join(" · ")}`)
        continue
      }
      const label = node.startsWith("~") ? node.slice(1) : `[[${node}]]`
      lines.push(`\t- ${label} · ${counts({ sessions: entry.sessions.length, commits: entry.commits.length, prs: entry.prs.length })}`)
      const sessions = entry.sessions.sort((a, b) => a.start.localeCompare(b.start))
      for (const session of sessions.slice(0, SHOWN)) {
        const parts = [`${clock(session.start)}–${clock(session.end)}`, session.title ? safe(session.title) : words.untitled]
        if (session.skills.length) parts.push(format(words.skills, { names: session.skills.join(", ") }))
        const checks = settled(session.checks)
        if (checks.length) parts.push(format(words.checks, { ok: checks.filter(Boolean).length, n: checks.length }))
        lines.push(`\t\t- ${format(words.session, { tool: session.tool === "codex" ? "Codex" : "Claude" })} ${parts.join(" · ")}`)
      }
      if (sessions.length > SHOWN) lines.push(`\t\t- ${format(words.more, { n: sessions.length - SHOWN })}`)
      const commits = entry.commits.sort((a, b) => b.at.localeCompare(a.at))
      for (const commit of commits.slice(0, SHOWN)) lines.push(`\t\t- ${format(words.commit, { hash: commit.hash.slice(0, 7), subject: safe(commit.subject) })}`)
      if (commits.length > SHOWN) lines.push(`\t\t- ${format(words.more, { n: commits.length - SHOWN })}`)
      for (const pr of entry.prs) lines.push(`\t\t- ${format(words.pr, { label: pr.repo && pr.number ? `${pr.repo}#${pr.number}` : pr.url, url: pr.url })}`)
    }
  }
  return lines.length ? lines.join("\n") : `- ${words.none}`
}
