import { createHash } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { availableParallelism } from "node:os"
import { join, relative, resolve } from "node:path"
import { meaningfulText } from "./dialects/logseq.mjs"
import { writeAtomic } from "./files.mjs"
import { packageVersion } from "./skills.mjs"
import { summaryRange, viewNames } from "./tree.mjs"

const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24)
const NONE = /^0+$/
const CHUNK_BYTES = 16 * 1024 * 1024
// Blame is the slowest git call and each file needs its own process, so several run at once.
const BLAME_JOBS = Math.max(1, Math.min(8, availableParallelism()))
// Digests depend on how the dialect and cudoc read Markdown. A clone used through `file:` changes
// without a version bump, so the cache key includes the dialect source and the cudoc version.
const ENGINE = (() => {
  let cudoc = ""
  try { cudoc = createRequire(import.meta.url)("@cudoment/cudoc/package.json").version } catch {}
  const dialect = readFileSync(new URL("./dialects/logseq.mjs", import.meta.url), "utf8")
  return digest([packageVersion(), cudoc, dialect].join("\n"))
})()

/** The output of a git command, or undefined when it failed or overflowed `maxBuffer`. */
export function gitOutput(dir, args, input, maxBuffer = 32 * 1024 * 1024) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", input, maxBuffer })
  // An overflow sets `error` and truncates stdout while `status` can still be 0.
  return result.error || result.status !== 0 ? undefined : result.stdout
}
/** Resolves to a git command's output (a Buffer when `encoding` is null), or undefined when it failed or overflowed. */
export function git(dir, args, { input, maxBuffer = 32 * 1024 * 1024, encoding = "utf8" } = {}) {
  return new Promise((done) => {
    const child = spawn("git", ["-C", dir, ...args], { stdio: ["pipe", "pipe", "ignore"] })
    const chunks = []
    let size = 0
    let overflow = false
    child.stdout.on("data", (chunk) => {
      size += chunk.length
      if (size <= maxBuffer) chunks.push(chunk)
      else if (!overflow) { overflow = true; child.kill() }
    })
    child.on("error", () => done(undefined))
    child.on("close", (code) => {
      if (overflow || code !== 0) return done(undefined)
      const out = Buffer.concat(chunks)
      done(encoding ? out.toString(encoding) : out)
    })
    // A command that exits before reading its input must not fail the caller with EPIPE.
    child.stdin.on("error", () => {})
    child.stdin.end(input ?? "")
  })
}
/** Runs `task` over `items` with at most `limit` running at once. */
async function eachLimited(items, limit, task) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++])
  }))
}
/** Passes every blob to `use` in bounded batches. False when git fails or answers fewer blobs than asked. */
async function readBlobs(repo, ids, use, chunkBytes) {
  const listed = await git(repo, ["cat-file", "--batch-check"], { input: ids.join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 })
  if (!listed) return false
  const entries = listed.toString().trimEnd().split("\n").map((line) => line.split(" "))
  if (entries.length !== ids.length || entries.some(([, type]) => type !== "blob")) return false
  let batch = [], bytes = 0
  const flush = async () => {
    if (!batch.length) return true
    const out = await git(repo, ["cat-file", "--batch"], { input: batch.join("\n") + "\n", maxBuffer: bytes + batch.length * 128 + 4096, encoding: null })
    if (!out) return false
    let at = 0, n = 0
    while (at < out.length) {
      const end = out.indexOf(10, at)
      if (end < 0) return false
      const [id, type, size] = out.subarray(at, end).toString().split(" ")
      const next = end + 1 + Number(size)
      if (type !== "blob" || next > out.length) return false
      use(id, out.subarray(end + 1, next).toString("utf8"))
      at = next + 1
      n++
    }
    const complete = n === batch.length
    batch = []
    bytes = 0
    return complete
  }
  for (const [id, , size] of entries) {
    if (batch.length && bytes + Number(size) > chunkBytes && !await flush()) return false
    batch.push(id)
    bytes += Number(size)
  }
  return flush()
}
/**
 * Reads the graph's git history once. `file(path, text)` answers whether a file changed and when;
 * its line `times` come from blame and must be loaded first with `loadTimes`, which runs in parallel.
 */
export async function history(ws, now = new Date(), { chunkBytes = CHUNK_BYTES } = {}) {
  const repo = (await git(ws.root, ["rev-parse", "--show-toplevel"]))?.trim()
  const graph = realpathSync(ws.graphDir)
  const pathOf = (path) => relative(repo || ws.root, resolve(graph, path)).split("\\").join("/")
  // Blob ids never change meaning, so their authored-content digests are cached across runs.
  // Blame results are reused while a file's last commit and current text stay the same.
  const cacheFile = join(ws.cacheDir, "history.json")
  const key = { engine: ENGINE, region: ws.labels.region }
  let stored = {}
  try { stored = JSON.parse(readFileSync(cacheFile, "utf8")) } catch {}
  // Deepening a shallow clone changes blame attribution without changing any file or commit.
  // A repository without commits has no history yet; that is not a failure.
  const [shallowPath, head] = repo ? await Promise.all([git(repo, ["rev-parse", "--git-path", "shallow"]),
    git(repo, ["rev-parse", "--verify", "-q", "HEAD"])]) : []
  const shallowFile = shallowPath && resolve(repo, shallowPath.trim())
  let shallow = ""
  try { if (shallowFile) shallow = digest(readFileSync(shallowFile, "utf8")) } catch {}
  const usable = stored.engine === key.engine && stored.region === key.region
  const known = new Map(usable ? Object.entries(stored.blobs ?? {}) : [])
  const blames = new Map(usable && stored.shallow === shallow ? Object.entries(stored.blame ?? {}) : [])
  let cacheChanged = !usable || stored.shallow !== shallow
  // Generated views change with every build and are never dated; leave their blobs out.
  const views = viewNames(ws).flatMap((name) => [...new Set([`${name}.md`.normalize("NFC"), `${name}.md`.normalize("NFD")])])
  const committed = head !== undefined
  const log = committed ? await git(repo, ["log", "--first-parent", "--diff-merges=first-parent", "--format=%x00COMMIT %H %ct", "--raw", "-z",
    "--no-abbrev", "-M", "--", pathOf(".") || ".", ...views.map((file) => `:(exclude,literal)${pathOf(file)}`)], { maxBuffer: 256 * 1024 * 1024 }) : undefined
  let failed = committed && log === undefined
  const dates = []
  const changes = new Map()
  const objects = new Set()
  // The log runs newest first. Once a rename is seen, older entries of the old path belong to the new one,
  // so moving a node keeps its history and only a change to its authored content dates it.
  const renamed = new Map()
  const current = (path) => renamed.get(path) ?? path
  let commit, date
  const parts = (log ?? "").split("\0")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (part.startsWith("COMMIT ")) {
      [commit, date] = part.slice(7).split(" ")
      date = Number(date)
      dates.push(date)
      continue
    }
    const change = part.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) ([AMDTR])\d*$/)
    if (!change) continue
    const from = parts[++i]
    const to = change[3] === "R" ? parts[++i] : from
    if (!to.endsWith(".md")) continue
    const target = current(to.normalize("NFC"))
    if (!changes.has(target)) changes.set(target, [])
    changes.get(target).push({ path: to, before: change[1], after: change[2], date: date * 1000, commit })
    if (change[3] === "R") renamed.set(from.normalize("NFC"), target)
    for (const id of change.slice(1, 3)) if (!NONE.test(id)) objects.add(id)
  }
  const missing = [...objects].filter((id) => !known.has(id))
  if (repo && !failed && missing.length) {
    failed = !await readBlobs(repo, missing, (id, text) => known.set(id, digest(meaningfulText(text, ws.labels.region))), chunkBytes)
    cacheChanged = true
  }
  const empty = digest("")
  const valueOf = (id) => NONE.test(id) ? empty : known.get(id)
  const oldest = dates.reduce((min, value) => Math.min(min, value), Infinity)
  const available = !failed && dates.length > 0 && now.getTime() / 1000 - oldest >= ws.staleDays * 86400
  const cache = new Map()
  const lineTimes = new Map()
  // A committed file whose blame cannot be read leaves its line ages unknown; that is a failure too.
  let blameFailed = false
  const versionsOf = (gitPath) => failed ? [] : changes.get(gitPath) ?? []
  async function blameTimes(path, text) {
    const gitPath = pathOf(path).normalize("NFC")
    const versions = versionsOf(gitPath)
    const textHash = digest(text)
    const saved = blames.get(gitPath)
    // A file deleted in its last commit and written again is new: none of its lines has a commit.
    const tracked = versions.length > 0 && !NONE.test(versions[0].after)
    let stamps
    if (tracked && saved?.commit === versions[0].commit && saved.text === textHash) stamps = saved.times
    else if (!tracked) stamps = versions.length ? text.split("\n").map(() => null) : []
    else {
      stamps = []
      const blame = await git(repo, ["blame", "--line-porcelain", "--contents", "-", "--", versions[0].path], { input: text })
      if (blame === undefined) blameFailed = true
      let time, uncommitted = false
      for (const line of (blame || "").split("\n")) {
        if (/^[0-9a-f]{40} \d+ \d+/.test(line)) uncommitted = /^0{40} /.test(line)
        if (line.startsWith("committer-time ")) time = Number(line.slice(15)) * 1000
        if (line.startsWith("\t")) stamps.push(uncommitted ? null : time)
      }
      if (blame) {
        blames.set(gitPath, { commit: versions[0].commit, text: textHash, times: stamps })
        cacheChanged = true
      }
    }
    return stamps.map((stamp) => stamp ?? now.getTime())
  }
  /** Loads the line times of `{ path, text }` entries, blaming several files at once. */
  async function loadTimes(entries) {
    const pending = [...new Map(entries.filter(({ path }) => !lineTimes.has(path)).map((entry) => [entry.path, entry])).values()]
    await eachLimited(pending, BLAME_JOBS, async ({ path, text }) => { lineTimes.set(path, await blameTimes(path, text)) })
  }
  function file(path, text) {
    if (cache.has(path)) return cache.get(path)
    // Without complete history nothing can be dated; report no change rather than a guess.
    const versions = versionsOf(pathOf(path).normalize("NFC"))
    const head = versions[0] && valueOf(versions[0].after)
    const dirty = !failed && (head === undefined || head !== digest(meaningfulText(text, ws.labels.region)))
    const last = versions.find((entry) => valueOf(entry.before) !== undefined && valueOf(entry.after) !== undefined && valueOf(entry.before) !== valueOf(entry.after))?.date
    const result = { dirty, last: dirty ? now.getTime() : last,
      get times() {
        if (!lineTimes.has(path)) throw new Error(`Line times of ${path} were not loaded; await loadTimes first.`)
        return lineTimes.get(path)
      },
    }
    cache.set(path, result)
    return result
  }
  /** The line times of one file. */
  async function times(path, text) {
    await loadTimes([{ path, text }])
    return lineTimes.get(path)
  }
  /** Stores the caches, keeping only entries the current history still refers to. */
  function save() {
    if (!repo || failed) return
    const blobs = Object.fromEntries([...known].filter(([id]) => objects.has(id)))
    const blame = Object.fromEntries([...blames].filter(([path]) => changes.has(path)))
    if (!cacheChanged && Object.keys(blobs).length === known.size && Object.keys(blame).length === blames.size) return
    mkdirSync(ws.cacheDir, { recursive: true })
    writeAtomic(cacheFile, `${JSON.stringify({ ...key, shallow, blobs, blame })}\n`)
    cacheChanged = false
  }
  return { repo, available, get failed() { return failed || blameFailed }, file, loadTimes, times, pathOf, now, save }
}
/** Parent nodes whose summary the owner writes; their summary lines are compared with the subtree. */
export const summarizedParents = (model) => model.nodes.filter((doc) =>
  summaryRange(doc) && model.children.get(doc.id)?.length && !model.managed(doc.id))
/**
 * Parents whose summary is older than a change below them. Knowledge nodes (`isKnowledge`) are kept
 * by agents from their sources: their updates do not make an owner's summary outdated, and their own
 * summaries are the agent's to keep.
 */
export async function behindSummaries(ws, model, h, isKnowledge = () => false) {
  h ??= await history(ws)
  const behind = new Set()
  if (!h.repo || h.failed) return behind
  const parents = summarizedParents(model)
  await h.loadTimes(parents.map((doc) => ({ path: doc.sourcePath, text: doc.source.text })))
  const newestBelow = new Map()
  const changedBelow = (id) => {
    if (!newestBelow.has(id)) {
      const child = model.docs.get(id)
      newestBelow.set(id, Math.max(h.file(child.sourcePath, child.source.text).last ?? 0,
        ...(model.children.get(id) ?? []).filter((kid) => !isKnowledge(kid)).map(changedBelow)))
    }
    return newestBelow.get(id)
  }
  // Done and Record summaries are fixed or written by the engine, not by the owner.
  for (const doc of parents) {
    const kids = model.children.get(doc.id).filter((kid) => !isKnowledge(kid))
    if (isKnowledge(doc.id) || !kids.length) continue
    const range = summaryRange(doc)
    const own = h.file(doc.sourcePath, doc.source.text)
    const summaryTime = Math.max(...own.times.slice(range.start - 1, range.end))
    if (!Number.isFinite(summaryTime)) continue
    const newest = Math.max(...kids.map(changedBelow))
    if (newest > summaryTime) behind.add(doc.id)
  }
  return behind
}
