// Whether a scheduled run may change the memo now. Commands that change and commit the graph (save,
// snapshot, ingest, archive) hold one lock, so a scheduled run and the owner's session never commit
// at once. A run also waits while the owner is at work: a graph file left uncommitted that changed in
// the last minutes (on this machine, or synced from a phone) is someone else's edit in progress. And
// the owner can stop every scheduled run from the memo itself, on any device, with one line.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { check, errorsOf, walkGraph } from "./check.mjs"
import { lockHeld, withLock, withLockAsync } from "./files.mjs"
import { commitContents, heldFiles } from "./git.mjs"
import { LOCALES } from "./labels.mjs"

/** The path of the graph lock (`<cache>/graph.lock`). */
export const graphLock = (ws) => join(ws.cacheDir, "graph")
// A save checks and builds the whole graph before it commits, so another waits for it longer than
// for a state file, and a lock is taken over only once it is clearly left behind.
const OPTIONS = { wait: 60000, stale: 600000 }

/** Runs `fn` while holding the graph lock. */
export const withGraph = (ws, fn) => withLock(graphLock(ws), fn, ws.labels.messages["graph-locked"], OPTIONS)
export const withGraphAsync = (ws, fn) => withLockAsync(graphLock(ws), fn, ws.labels.messages["graph-locked"], OPTIONS)

// `automation:: paused` in English, `자동 실행:: 멈춤` in Korean: every locale's words count.
const PAUSE = new RegExp(`^\\s*(?:-\\s+)?(?:${Object.values(LOCALES).map((labels) => labels.pause.key).join("|")})::\\s*(?:${Object.values(LOCALES).map((labels) => labels.pause.value).join("|")})\\s*$`, "imu")

/** The pages that hold the pause line, as paths from the graph folder. */
export function pausedBy(ws, graph = walkGraph(ws)) {
  return graph.pages.filter((page) => {
    try { return PAUSE.test(readFileSync(page.path, "utf8")) } catch { return false }
  }).map((page) => page.rel)
}

// A generated page starts with `generated:: views/…` in any locale's words. The build rewrites it, so one
// left uncommitted (a save that stopped halfway) is nobody's edit in progress.
const GENERATED = new RegExp(`^(?:${Object.values(LOCALES).map((labels) => labels.generated).join("|")})::`, "u")
const generatedFile = (path) => {
  try { return GENERATED.test(readFileSync(path, "utf8").slice(0, 200).normalize("NFC")) } catch { return false }
}

/** The time the nearest existing folder at or above `dir` last changed. */
function folderTime(dir) {
  for (let at = dir; ; at = dirname(at)) {
    try { return statSync(at).mtimeMs } catch {}
    if (dirname(at) === at) return undefined
  }
}

/**
 * Graph files git sees as changed or new, with the time each last changed: someone's edits. Generated
 * pages are left out, and so are the files the run holds (`EXCUDO_HOLD`), which it has already set aside.
 */
function uncommitted(ws) {
  const status = spawnSync("git", ["-C", ws.graphDir, "status", "--porcelain", "-z", "--untracked-files=all", "--", "."], { encoding: "utf8" })
  if (status.status !== 0) return []
  const top = spawnSync("git", ["-C", ws.graphDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim()
  // git names files from the repository's real folder; the graph folder may be reached through a link.
  const graph = realpathSync(ws.graphDir)
  const held = heldFiles(ws)
  const files = []
  const entries = status.stdout.split("\0")
  const root = realpathSync(ws.root)
  const add = (path, mtime, partner) => {
    const fromRoot = relative(root, path).split("\\").join("/").normalize("NFC")
    if (held.some((one) => fromRoot === one || fromRoot.startsWith(`${one}/`))) return
    const file = relative(graph, path).split("\\").join("/").normalize("NFC")
    files.push({ file, mtime, ...(partner ? { partner: relative(graph, partner).split("\\").join("/").normalize("NFC") } : {}) })
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    // A rename is followed by its old name, which no longer exists; it goes with the new one, so a run
    // that sets the new name aside sets the removal of the old one aside too.
    const from = entry[0] === "R" || entry[0] === "C" ? entries[++i] : null
    const path = join(top, entry.slice(3))
    let mtime
    // A page added, renamed or deleted tells when by its folder's time too: a rename keeps the page's own time.
    const moved = Boolean(from) || entry.startsWith("??") || entry[0] === "A"
    if (existsSync(path)) {
      if (generatedFile(path)) continue
      mtime = statSync(path).mtimeMs
      if (moved) mtime = Math.max(mtime, folderTime(dirname(path)) ?? 0)
    } else {
      mtime = folderTime(dirname(path))
      if (mtime === undefined) continue
    }
    if (from) mtime = Math.max(mtime, folderTime(dirname(join(top, from))) ?? 0)
    add(path, mtime, from ? join(top, from) : undefined)
    if (from) add(join(top, from), mtime, path)
  }
  return files
}

/**
 * Whether a scheduled run may start: `{ state, paused, locked, recent }`. `state` is "paused" when a
 * page holds the pause line, "busy" while a command holds the graph lock or a graph file left
 * uncommitted changed in the last `minutes`, and "idle" otherwise.
 */
export function idle(ws, { minutes = 10, now = Date.now() } = {}) {
  return stateOf(ws, uncommitted(ws), { minutes, now })
}

function stateOf(ws, files, { minutes, now, settled }) {
  const paused = pausedBy(ws)
  const locked = lockHeld(graphLock(ws))
  const done = new Set((settled ?? []).map((item) => item.file))
  const listed = (list) => list.sort((a, b) => b.mtime - a.mtime).map((item) => ({ file: item.file, at: new Date(item.mtime).toISOString() }))
  const recent = listed(files.filter((item) => !done.has(item.file) && now - item.mtime < minutes * 60000))
  const state = paused.length ? "paused" : locked || recent.length ? "busy" : "idle"
  return { state, paused, locked, recent, minutes, ...(settled ? { settled: listed([...settled]) } : {}) }
}

/**
 * The graph files the check finds errors in, from the graph folder; null when the check could not
 * tell which (an error that names no file), so no edit counts as finished.
 */
export async function failingFiles(ws) {
  const errors = errorsOf((await check(ws)).issues)
  if (errors.some((issue) => !issue.file)) return null
  return new Set(errors.map((issue) => issue.file.split("\\").join("/").normalize("NFC")))
}

/**
 * `idle` that also sorts the uncommitted edits into those still being written and those left finished:
 * an edit nobody has touched for `settle` minutes whose files pass the check is `settled`, and leaves
 * `recent`, whatever its age. A run commits settled edits on their own and then works on those pages
 * as usual, and holds the rest. The two names of a rename settle together. An edit the check finds
 * errors in stays `recent` while it is within `minutes`; past that it is `unsettled`, which a run holds
 * too but does not wait for. A file changed while the check ran is not settled.
 */
export async function idleSettled(ws, options = {}) {
  return (await sortEdits(ws, options)).result
}

// The content of a graph file now, or null when it is gone.
const contentOf = (graph, file) => { try { return readFileSync(join(graph, file)) } catch { return null } }

async function sortEdits(ws, { minutes = 10, settle = 5, now = Date.now(), failing } = {}) {
  const files = uncommitted(ws)
  const quiet = files.filter((item) => now - item.mtime >= settle * 60000)
  // What the check reads is what may be committed: the contents are kept from before it ran.
  const graph = realpathSync(ws.graphDir)
  const contents = new Map(quiet.map((item) => [item.file, contentOf(graph, item.file)]))
  failing = quiet.length ? await (typeof failing === "function" ? failing() : failing ?? failingFiles(ws)) : new Set()
  // An error on a folder (a child folder left without its page) belongs to that folder's page and everything in it.
  const ok = (file) => failing !== null && ![...failing].some((one) => file === one || file === `${one}.md` || file.startsWith(`${one}/`))
  // The check takes a moment: an edit made meanwhile, to a file it saw or a new one, is not what it passed,
  // so the edits are read again and those count as being written.
  const after = quiet.length ? uncommitted(ws) : files
  const before = new Map(files.map((item) => [item.file, item.mtime]))
  const same = (file) => after.some((item) => item.file === file && item.mtime === before.get(file))
    && sameContent(contents.get(file), contentOf(graph, file))
  const settled = quiet.filter((item) => ok(item.file) && same(item.file)
    && (!item.partner || (ok(item.partner) && same(item.partner) && quiet.some((one) => one.file === item.partner))))
  const result = stateOf(ws, after, { minutes, now: Math.max(now, Date.now()), settled })
  const named = new Set([...result.recent, ...result.settled].map((item) => item.file))
  const unsettled = after.filter((item) => !named.has(item.file)).sort((a, b) => b.mtime - a.mtime)
    .map((item) => ({ file: item.file, at: new Date(item.mtime).toISOString() }))
  return { result: { ...result, unsettled, settle }, contents }
}
const sameContent = (a, b) => (a === null || b === null ? a === b : a.equals(b))

/**
 * Commits the settled edits on their own, sorting and committing under the graph lock. It commits the
 * contents the check passed, so an editor that writes in between (it takes no lock) leaves its edit in
 * the work tree. Nothing is committed while the memo is paused. Returns the `idleSettled` result with
 * `committed`, the files committed.
 */
export function commitSettled(ws, { minutes = 10, settle = 5, message = ws.labels.snapshot, failing } = {}) {
  return withGraphAsync(ws, async () => {
    const { result, contents } = await sortEdits(ws, { minutes, settle, failing })
    // A paused memo takes no commit from a run, not even this one.
    const files = result.state === "paused" ? [] : result.settled.map((item) => item.file)
    const state = files.length ? commitContents(ws, message, files.map((file) => ({ file, content: contents.get(file) }))) : "clean"
    return { ...result, committed: state === "committed" ? files : [] }
  })
}
