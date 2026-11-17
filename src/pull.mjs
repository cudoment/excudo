// Brings the task states chosen on the memo website into the memo on this computer (`excudo site
// pull`). The website's function keeps each batch of changes as an issue in the inbox's private
// repository; this reads the open ones with the GitHub CLI and takes them in through `receive`.
//
// A schedule calls it every minute (see schedule.mjs); the changes are taken every five minutes, or at
// once when a page asked for it (a request issue, `api/sync`) or the owner did (`--now`). Before the
// memo is written the owner's own uncommitted edits of those pages get a commit of their own; the
// pages written are committed next, and only then are the issues closed: as completed when the memo
// took every change, as not planned when one was noted on today's journal to settle, so the pages
// show as taken only what the memo took. Last the website is published again; a publish that has to
// wait is kept and tried again by a later pull. The graph lock is held from the plan to the last
// commit, and only issues of this website are taken. Only this computer writes the memo and nothing
// writes the repository's files, so two changes never meet in a merge.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { isSyncIssue, MARK } from "./edits.mjs"
import { writeAtomic } from "./files.mjs"
import { changedGraphFiles, heldFiles, heldPath, inRepository } from "./git.mjs"
import { ghOf, ghRun, isNetworkFailure } from "./github.mjs"
import { idle, withGraphAsync } from "./idle.mjs"
import { format } from "./labels.mjs"
import { DEFERRED, publishSite, publishState } from "./publish.mjs"
import { batchesOf, receive } from "./receive.mjs"
import { saveGraph } from "./save.mjs"
import { siteIdOf } from "./site-runtime.mjs"
import { siteOf } from "./site.mjs"

const STATE_FILE = "pull.json"
/** How long changes wait to be taken together, unless a page or the owner asks for them now. */
const EVERY_MS = () => (process.env.EXCUDO_PULL_EVERY ? Number(process.env.EXCUDO_PULL_EVERY) * 1000 : 5 * 60_000)

const statePath = (ws) => join(ws.cacheDir, STATE_FILE)
/** What the last pulls left: `{ appliedAt, last: { at, code, reason }, publish }`, where `publish` is a publish still to try again. */
export function pullState(ws) {
  try { return JSON.parse(readFileSync(statePath(ws), "utf8")) } catch { return {} }
}
const keep = (ws, change) => {
  mkdirSync(ws.cacheDir, { recursive: true })
  writeAtomic(statePath(ws), `${JSON.stringify({ ...pullState(ws), ...change }, null, 2)}\n`)
}

/** The inbox repository: the setting's, or the one `site setup` made. */
export function inboxRepo(ws, site = siteOf(ws, { defaults: true })) {
  return site.inbox ? site.inbox.repo ?? publishState(ws).inbox?.repo ?? null : null
}

/** The graph files among `pages` (from the graph folder) that hold uncommitted changes, as given. */
function uncommitted(ws, pages) {
  const changed = new Set(changedGraphFiles(ws).map((file) => file.normalize("NFC")))
  // A page held by a scheduled run is someone else's edit in progress; the pull neither wrote it nor commits it.
  const held = heldFiles(ws)
  return [...new Set(pages)].filter((page) => changed.has(resolve(ws.graphDir, page).normalize("NFC")) && !heldPath(ws, resolve(ws.graphDir, page), held))
}

/**
 * Takes the changes in. Returns `{ code, ... }`: 0 when done, nothing waited or the changes wait for
 * their interval (`waiting`, in seconds), 75 when the memo is busy or paused or the inbox is not set
 * up, 1 when GitHub or a commit failed. With `dryRun` it says what it would take and changes nothing.
 */
export async function pullInbox(ws, { now = false, dryRun = false, say = () => {}, clock = Date.now } = {}) {
  const m = ws.labels.messages
  const site = siteOf(ws, { defaults: true })
  if (!site.inbox) { say(m["pull-no-inbox"]); return { code: 0, reason: "no-inbox" } }
  const repo = inboxRepo(ws, site)
  if (!repo) { say(m["pull-not-set-up"]); return { code: DEFERRED, reason: "not-set-up" } }
  const gh = ghOf()
  if (!gh) { say(m["pull-no-gh"]); return { code: DEFERRED, reason: "no-gh" } }
  const log = join(ws.cacheDir, "logs", "site-pull.log")
  const note = (text) => { mkdirSync(join(ws.cacheDir, "logs"), { recursive: true }); appendFileSync(log, `${new Date().toISOString()}  ${text.trim()}\n`) }
  const finish = (result) => { if (!dryRun) keep(ws, { last: { at: new Date(clock()).toISOString(), code: result.code, reason: result.reason ?? null } }); return result }
  const failed = (answer, extra = {}) => {
    const network = isNetworkFailure(answer)
    say(format(m[network ? "pull-network" : "pull-list-failed"], { repo, log: relative(process.cwd(), log) || log }))
    return finish({ code: network ? DEFERRED : 1, reason: network ? "network" : "github", ...extra })
  }

  const listed = ghRun(gh, ["issue", "list", "--repo", repo, "--state", "open", "--limit", "1000", "--json", "number,title,body,createdAt"], { note })
  let issues
  try { issues = JSON.parse(listed.stdout) } catch {}
  if (listed.status !== 0 || !Array.isArray(issues)) return failed(listed)
  // Only this website's batches and requests: another memo may keep its inbox in the same repository.
  const siteId = siteIdOf(ws, site)
  const batches = batchesOf(issues.filter((issue) => String(issue.body ?? "").includes(MARK))).filter((batch) => batch.error || batch.doc.site === siteId)
  const changes = batches.length
  const requests = issues.filter((issue) => isSyncIssue(issue.body, siteId)).map((issue) => issue.number)
  const closeRequests = () => {
    for (const number of requests) {
      const answer = ghRun(gh, ["issue", "close", String(number), "--repo", repo, "--reason", "completed"], { note })
      if (answer.status !== 0) return answer
    }
  }
  // A publish that waited or failed after the memo took changes is tried again, every five minutes or when asked.
  const publish = () => {
    const published = publishSite(ws, { say })
    keep(ws, { publish: published.code === 0 ? null : { code: published.code, reason: published.reason ?? "failed", at: clock() } })
    return published.code === 0 ? (published.published ? "published" : "unchanged") : published.reason ?? "failed"
  }
  const asked = now || requests.length > 0
  const retry = () => {
    const pending = pullState(ws).publish
    return !dryRun && pending && (asked || clock() - pending.at >= EVERY_MS()) ? { publish: publish() } : {}
  }
  if (!changes) {
    if (requests.length && !dryRun) {
      const answer = closeRequests()
      if (answer) return failed(answer, { issues: 0 })
    }
    say(m["pull-none"])
    return finish({ code: 0, issues: 0, ...retry() })
  }

  // Taken every five minutes, unless asked for now.
  const left = (pullState(ws).appliedAt ?? 0) + EVERY_MS() - clock()
  if (!asked && left > 0) {
    const waiting = Math.ceil(left / 1000)
    say(format(m["pull-waiting"], { n: changes, seconds: waiting }))
    return { code: 0, issues: changes, waiting }
  }
  const count = (result, status) => result.results.filter((item) => item.status === status).length
  const summary = (result) => ({ issues: changes, applied: count(result, "applied"), already: count(result, "already"), uncertain: count(result, "uncertain"),
    broken: result.batches.filter((batch) => batch.error).map((batch) => batch.source) })
  if (dryRun) {
    const plan = receive(ws, batches, { dryRun: true })
    say(format(m["pull-plan"], summary(plan)))
    for (const item of plan.results) say(item.to === undefined ? `  ${item.source} ${item.page} board ${item.status} (${item.reason})` : `  ${item.source} ${item.page}:${item.line} -> ${item.to} ${item.status} (${item.reason})`)
    return { code: 0, ...summary(plan), results: plan.results }
  }
  // Only a commit lets the issues be closed: without git nothing is written.
  if (!inRepository(ws.graphDir)) { say(m["pull-no-git"]); return finish({ code: DEFERRED, reason: "no-git" }) }
  // What the owner asked for now does not wait for recent edits; another command writing the memo, or the pause line, still stops it.
  const state = idle(ws, { minutes: asked ? 0 : 10 })
  if (state.state === "paused") { say(m["pull-paused"]); return finish({ code: DEFERRED, reason: "paused" }) }
  if (state.state === "busy") { say(m["pull-busy"]); return finish({ code: DEFERRED, reason: "busy" }) }

  // From the plan to the last commit the graph lock is held, so no other command writes or commits the memo between.
  let taken
  try {
    taken = await withGraphAsync(ws, async () => {
      const plan = receive(ws, batches, { dryRun: true })
      // The owner's own edits of the pages about to be written get a commit of their own first.
      const own = uncommitted(ws, plan.writes)
      if (own.length && (await saveGraph(ws, m["pull-own-edits"], { only: own })).code !== 0) return { failed: "save" }
      keep(ws, { appliedAt: clock() })
      const result = receive(ws, batches)
      // The pages written now, and those an earlier pull wrote but could not commit (each change names its file).
      const files = [...result.touched, ...result.results.flatMap((item) => [item.page, item.file]).filter(Boolean)]
      const done = result.batches.filter((batch) => batch.issue != null && batch.done)
      const pending = uncommitted(ws, files)
      if (pending.length && (await saveGraph(ws, format(m["pull-commit"], { issues: done.map((batch) => `#${batch.issue}`).join(", ") }), { only: pending })).code !== 0) return { failed: "save" }
      if (uncommitted(ws, files).length) return { failed: "uncommitted" }
      return { result, done }
    })
  } catch (error) {
    if (error.message !== m["graph-locked"]) throw error
    say(m["pull-busy"])
    return finish({ code: DEFERRED, reason: "busy" })
  }
  if (taken.failed) { say(m[taken.failed === "save" ? "pull-save-failed" : "pull-uncommitted"]); return finish({ code: 1, reason: taken.failed }) }
  const { result, done } = taken

  // Closed only now that the memo holds them, by what became of their changes.
  let closed = 0, closeFailure = null
  for (const batch of done) {
    const settle = result.results.some((item) => item.source === batch.source && (item.status === "uncertain" || item.was === "uncertain"))
    const answer = ghRun(gh, ["issue", "close", String(batch.issue), "--repo", repo, "--reason", settle ? "not planned" : "completed"], { note })
    if (answer.status === 0) closed++
    else { closeFailure = answer; break }
  }
  closeFailure ??= closeRequests()
  const told = summary(result)
  say(format(m["pull-done"], { ...told, closed }))
  if (told.uncertain) say(format(m["pull-noted"], { n: told.uncertain }))
  // The website shows what the memo took; a publish that has to wait is kept and tried again.
  const published = publish()
  return closeFailure ? failed(closeFailure, { ...told, closed, publish: published }) : finish({ code: 0, ...told, closed, publish: published })
}
