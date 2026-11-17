// The dashboard at the top of the website's Home: the sections the owner lists in `site.dashboard`,
// in that order. Links open the owner's usual addresses in a new tab; the notepad is a board, a node
// whose body the owner edits in place and saves through the website's inbox (board.mjs); the four statistics show how the work stands (open tasks,
// tasks finished week by week, the agents' sessions, the scheduled runs). The engine works out each
// section's numbers when it writes the website and hands them to the page runtime in the memo index
// (site-runtime.mjs), which draws them; nothing here is markup. The numbers are as of that moment.
// A group puts several sections in one fold, each under its own title, such as every link or every statistic.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeAtomic } from "./files.mjs"
import { gitOutput } from "./history.mjs"
import { queryBlocks } from "./queries.mjs"
import { queueItems } from "./queue.mjs"
import { boardHash, boardParts } from "./board.mjs"
import { runRecords, sessionRecords, withRecords } from "./records.mjs"
import { pageOf, ROOT } from "./tree.mjs"

export const DASHBOARD_TYPES = ["links", "notes", "tasks", "done", "agents", "runs", "group"]
/** What each kind of section takes beyond `type`, `title` and `open`, with its default and bounds. */
const NUMBERS = {
  tasks: { nodes: [8, 1, 30] },
  done: { weeks: [8, 1, 26] },
  agents: { days: [14, 1, 90] },
  runs: { days: [7, 1, 30] },
}
const OPEN_STATES = ["TODO", "DOING", "NOW", "LATER", "WAITING"]
const DONE_CACHE = "dashboard-done.json"
const DONE_VERSION = 2
const DAY = 86400000

/**
 * The dashboard setting, checked: null without one, else `{ sections: [{ type, title, open, … }] }`.
 * `bad(field)` throws the website's settings error for the field at fault. A notepad needs the inbox.
 */
export function dashboardOf(given, { bad, inbox }) {
  if (given === undefined || given === null || given === false) return null
  if (!given || typeof given !== "object" || Array.isArray(given)) bad("dashboard")
  for (const key of Object.keys(given)) if (key !== "sections") bad(`dashboard.${key}`)
  const list = given.sections
  if (!Array.isArray(list) || !list.length || list.length > 20) bad("dashboard.sections")
  const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max
  let notepad = false
  // A group is one fold holding several sections, each shown inside it under its title; the parts
  // fold with the group, so they take no `open`, and the notepad and other groups stay outside.
  const one = (section, at, inGroup) => {
    if (!section || typeof section !== "object" || Array.isArray(section) || !DASHBOARD_TYPES.includes(section.type)) bad(`${at}.type`)
    if (inGroup && (section.type === "group" || section.type === "notes")) bad(`${at}.type`)
    const numbers = NUMBERS[section.type] ?? {}
    const own = { links: ["items"], tasks: ["except"], notes: ["page"], group: ["sections"] }[section.type] ?? []
    const keys = ["type", "title", ...(inGroup ? [] : ["open"]), ...Object.keys(numbers), ...own]
    for (const key of Object.keys(section)) if (!keys.includes(key)) bad(`${at}.${key}`)
    if (section.title !== undefined && !text(section.title, 60)) bad(`${at}.title`)
    if (section.type === "group" && section.title === undefined) bad(`${at}.title`)
    if (section.open !== undefined && typeof section.open !== "boolean") bad(`${at}.open`)
    const out = { type: section.type, ...(section.title ? { title: section.title.trim() } : {}), ...(inGroup ? {} : { open: section.open ?? true }) }
    if (section.type === "group") {
      if (!Array.isArray(section.sections) || !section.sections.length || section.sections.length > 10) bad(`${at}.sections`)
      out.sections = section.sections.map((part, j) => one(part, `${at}.sections[${j}]`, true))
      return out
    }
    for (const [key, [fallback, min, max]] of Object.entries(numbers)) {
      const value = section[key] ?? fallback
      if (!Number.isInteger(value) || value < min || value > max) bad(`${at}.${key}`)
      out[key] = value
    }
    if (section.type === "links") {
      if (!Array.isArray(section.items) || !section.items.length || section.items.length > 40) bad(`${at}.items`)
      out.items = section.items.map((item, j) => {
        const where = `${at}.items[${j}]`
        if (!item || typeof item !== "object" || Array.isArray(item)) bad(where)
        for (const key of Object.keys(item)) if (!["title", "url", "icon"].includes(key)) bad(`${where}.${key}`)
        if (!text(item.title, 40)) bad(`${where}.title`)
        let url
        try { url = new URL(item.url) } catch { bad(`${where}.url`) }
        if (!["https:", "http:"].includes(url.protocol)) bad(`${where}.url`)
        if (item.icon !== undefined && (!text(item.icon, 8) || [...item.icon.trim()].length > 2)) bad(`${where}.icon`)
        return { title: item.title.trim(), url: url.href, ...(item.icon ? { icon: item.icon.trim() } : {}) }
      })
    }
    // Nodes whose tasks the numbers leave out, with the nodes below them, such as a node of paused work.
    if (section.type === "tasks") {
      const except = section.except ?? []
      if (!Array.isArray(except) || except.length > 20 || except.some((name) => !text(name, 100))) bad(`${at}.except`)
      out.except = except.map((name) => name.trim())
    }
    // One notepad, a node of the memo named by `page`, saved through the inbox.
    if (section.type === "notes") {
      if (!inbox || notepad) bad(`${at}.type`)
      notepad = true
      if (!text(section.page, 100)) bad(`${at}.page`)
      out.page = section.page.trim()
    }
    return out
  }
  const sections = list.map((section, i) => one(section, `dashboard.sections[${i}]`, false))
  return { sections }
}

const pad = (n) => String(n).padStart(2, "0")
const dayOf = (time) => { const d = new Date(time); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** The Monday that starts the week of `time`, at local midnight. */
const weekOf = (time) => { const d = new Date(time); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }
const safely = (fn, fallback) => { try { return fn() } catch { return fallback } }

/** Open tasks by state, how many are past their deadline, and the top nodes holding the most. */
function taskStats(ws, { model, home, routes }, section, now) {
  const left = new Set()
  const leave = (id) => { left.add(id); for (const child of model.children.get(id) ?? []) leave(child) }
  for (const name of section.except) { const id = model.find(name); if (id) leave(id) }
  const blocks = queryBlocks(ws, model, { home }).filter((block) => !(block.page.kind === "node" && left.has(block.page.id)))
  // Each top node's open tasks, from the same blocks, so a node left out below it does not count there either.
  const topOf = (id) => { let at = id; while (model.parentOf(at) !== ROOT) at = model.parentOf(at); return at }
  const byTop = new Map()
  const counts = { doing: 0, todo: 0, waiting: 0 }
  const today = dayOf(now)
  let overdue = 0
  for (const block of blocks) {
    if (!OPEN_STATES.includes(block.state)) continue
    if (block.page.kind === "node") { const top = topOf(block.page.id); byTop.set(top, (byTop.get(top) ?? 0) + 1) }
    if (block.state === "DOING" || block.state === "NOW") counts.doing++
    else if (block.state === "WAITING") counts.waiting++
    else counts.todo++
    // The deadline is a line of the task block itself, below its first line.
    const own = block.block.ownLines.map((i) => block.lines[i]).join("\n")
    const deadline = own.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})/)?.[1]
    if (deadline && deadline < today) overdue++
  }
  const nodes = (model.children.get(ROOT) ?? []).filter((id) => !left.has(id)).map((id) => ({ name: pageOf(id), route: routes.get(id) ?? null, open: byTop.get(id) ?? 0 }))
    .filter((node) => node.open).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)).slice(0, section.nodes)
  return { counts, overdue, nodes }
}

/**
 * Tasks finished in each of the last `weeks` weeks, newest last: a line of a commit that turns an open
 * task into DONE, its words unchanged. A finished task moved elsewhere leaves a DONE line and adds one,
 * so it does not count again. Each commit's count is kept in the cache, so a build reads only new ones.
 */
export function doneByWeek(ws, { weeks = 8, now = new Date() } = {}) {
  const first = weekOf(now)
  first.setDate(first.getDate() - 7 * (weeks - 1))
  const listed = gitOutput(ws.graphDir, ["log", "--no-merges", `--since=${first.toISOString()}`, "--format=%H %cI", "--", "*.md"])
  if (listed == null) return null
  const commits = listed.split("\n").filter(Boolean).map((line) => { const [hash, at] = line.split(" "); return { hash, at } })
  const cacheFile = join(ws.cacheDir, DONE_CACHE)
  let cache = {}
  // A cache written by another way of counting is read as empty.
  try { const kept = JSON.parse(readFileSync(cacheFile, "utf8")); cache = kept.version === DONE_VERSION ? kept.commits ?? {} : {} } catch {}
  const missing = commits.filter((commit) => cache[commit.hash] === undefined)
  if (missing.length) {
    const shown = gitOutput(ws.graphDir, ["-c", "core.quotepath=off", "show", "-U0", "--no-color", "--no-renames", "--format=%x01%H", ...missing.map((commit) => commit.hash), "--", "*.md"], undefined, 256 * 1024 * 1024)
    if (shown == null) return null
    for (const part of shown.split("\x01").slice(1)) {
      const [hash, ...lines] = part.split("\n")
      const digest = (text) => createHash("sha256").update(text.trim().normalize("NFC")).digest("hex").slice(0, 16)
      const tally = (pattern) => {
        const found = new Map()
        for (const line of lines) { const match = line.match(pattern); if (match) found.set(digest(match[1]), (found.get(digest(match[1])) ?? 0) + 1) }
        return found
      }
      const opened = tally(/^-\s*- (?:TODO|DOING|NOW|LATER|WAITING)\s+(.*)$/)
      const moved = tally(/^-\s*- DONE\s+(.*)$/)
      let n = 0
      for (const [key, added] of tally(/^\+\s*- DONE\s+(.*)$/)) {
        // A DONE line taken away in the same commit is the same finished task moved, not a new one.
        const fresh = Math.max(added - (moved.get(key) ?? 0), 0)
        n += Math.min(fresh, opened.get(key) ?? 0)
      }
      cache[hash.trim()] = n
    }
    for (const commit of missing) cache[commit.hash] ??= 0
    const keep = Object.fromEntries(commits.map((commit) => [commit.hash, cache[commit.hash]]))
    try { mkdirSync(ws.cacheDir, { recursive: true }); writeAtomic(cacheFile, `${JSON.stringify({ version: DONE_VERSION, commits: keep })}\n`) } catch {}
  }
  const counts = Array.from({ length: weeks }, (_, i) => { const from = new Date(first); from.setDate(from.getDate() + 7 * i); return { from: dayOf(from), n: 0 } })
  for (const commit of commits) {
    const week = counts.findLast((item) => item.from <= dayOf(commit.at))
    if (week) week.n += cache[commit.hash] ?? 0
  }
  return counts
}

/** The agents' sessions of the last `days` days, by day, with their cost, and the tasks handed to agents. */
function agentStats(ws, { prepared }, section, now) {
  const from = dayOf(now - (section.days - 1) * DAY)
  const to = dayOf(now)
  const sessions = withRecords(ws, (db) => sessionRecords(db))
  const days = new Map()
  for (let i = section.days - 1; i >= 0; i--) days.set(dayOf(now - i * DAY), { day: dayOf(now - i * DAY), sessions: 0, scheduled: 0 })
  let cost = 0, count = 0, scheduled = 0
  for (const session of sessions) {
    const worked = session.spans.filter((span) => span.day >= from && span.day <= to && (session.batch || span.turns))
    if (!worked.length) continue
    const seen = new Set(worked.map((span) => span.day))
    for (const day of seen) { const item = days.get(day); if (item) session.batch ? item.scheduled++ : item.sessions++ }
    session.batch ? scheduled++ : count++
    if (typeof session.cost === "number") cost += session.cost
  }
  const items = safely(() => queueItems(ws, { prepared }), [])
  return {
    sessions: count, scheduled, cost: Math.round(cost * 100) / 100, activeDays: [...days.values()].filter((day) => day.sessions).length,
    days: [...days.values()], queue: { ready: items.filter((item) => item.status === "ready").length, waiting: items.filter((item) => item.status === "waiting").length },
  }
}

/** Each scheduled step's last result in the last `days` days, the failed ones first. */
function runStats(ws, section, now) {
  const runs = runRecords(ws, { days: section.days, now })
  const steps = new Map()
  for (const run of runs) if (!steps.has(run.step)) steps.set(run.step, { step: run.step, status: run.status, at: run.finished ?? run.started })
  const rank = { failed: 0, deferred: 1, paused: 2, ok: 3 }
  return { steps: [...steps.values()].sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.at.localeCompare(a.at)) }
}

/** The board's node: its file in the memo, its page on the website, its body and the body's digest. */
function boardData(ws, { model, routes }, section) {
  const id = model.find(section.page)
  if (!id) return { missing: section.page }
  const doc = model.docs.get(id)
  const path = join(ws.graphDir, ...doc.sourcePath.split("/"))
  const { body } = boardParts(existsSync(path) ? readFileSync(path, "utf8") : doc.source.text, ws.labels.region)
  return { page: doc.sourcePath.normalize("NFC"), name: pageOf(id), route: routes.get(id) ?? null, text: body, hash: boardHash(body) }
}

/**
 * The dashboard the page draws: each section with its numbers, and when they were worked out. A
 * section whose records cannot be read shows none (`data: null`) rather than stopping the website.
 */
export function dashboardData(ws, { prepared, plan, routes, settings, now = new Date() }) {
  if (!settings.dashboard) return null
  const draw = (section) => {
    const base = { type: section.type, ...(section.open !== undefined ? { open: section.open } : {}), ...(section.title ? { title: section.title } : {}) }
    if (section.type === "group") return { ...base, sections: section.sections.map(draw) }
    if (section.type === "links") return { ...base, items: section.items }
    const data = safely(() => {
      if (section.type === "notes") return boardData(ws, { model: prepared.model, routes }, section)
      if (section.type === "tasks") return taskStats(ws, { model: prepared.model, home: plan.home, routes }, section, now)
      if (section.type === "done") { const weeks = doneByWeek(ws, { weeks: section.weeks, now }); return weeks && { weeks } }
      if (section.type === "agents") return agentStats(ws, { prepared }, section, now)
      return runStats(ws, section, now)
    }, null)
    return { ...base, data }
  }
  return { at: now.toISOString(), sections: settings.dashboard.sections.map(draw) }
}
