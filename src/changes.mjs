// Watched sources feed knowledge nodes. A `repo` source is a local repository or folder that the
// engine reads itself; a `page` source is a web page the agent reads in the owner's browser and
// hands over as JSON. A `note` source is a note the owner keeps in another app; the agent hands over
// the part between its markers, and the engine compares it block by block with what it kept when the
// note was last marked (outside git, in the cache). `changes` says which ones changed since an agent
// last brought the memo up to date, and `markChanges` records that it did. Nothing here goes online
// or edits the memo.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { withLock, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { noteDiff, noteRegion } from "./notes.mjs"
import { SOURCE_STATE, readSourceState, sourceNamed, sourcesOf } from "./sources.mjs"

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build"])
const NEWER_SHOWN = 20
const sha = (text) => createHash("sha256").update(text).digest("hex")

function git(path, ...args) {
  return spawnSync("git", ["-C", path, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
}

/**
 * A repository's state: its commit and its uncommitted changes. The fingerprint is the first twelve
 * characters of the commit and of the SHA-256 of `git status --porcelain`, joined by `+`, as other
 * tools write it. The digest adds the size and time of every uncommitted file, so editing a file
 * that is already modified counts as a change too. With `commits` (a source set to `watch: "commits"`)
 * only the commit counts: work in progress there changes nothing until it is committed.
 */
function repoState(path, { commits = false } = {}) {
  const head = git(path, "rev-parse", "HEAD")
  if (head.status !== 0) return undefined
  const porcelain = git(path, "status", "--porcelain").stdout.replace(/\n+$/, "")
  const commit = head.stdout.trim()
  if (commits) return { mode: "git", head: commit, branch: git(path, "branch", "--show-current").stdout.trim(),
    dirty: porcelain ? porcelain.split("\n").length : 0, fingerprint: commit.slice(0, 12), commits: true }
  const files = []
  let latest = 0
  const parts = git(path, "status", "--porcelain", "-uall", "-z").stdout.split("\0")
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length < 4) continue
    files.push(parts[i].slice(3))
    // A rename or copy is followed by the path it came from.
    if (/[RC]/.test(parts[i].slice(0, 2))) i++
  }
  const digest = sha(files.map((file) => {
    try {
      const stat = statSync(join(path, file))
      // A submodule or a repository inside is listed as its folder, whose time misses edits to files in it.
      if (stat.isDirectory()) { const inner = repoState(join(path, file)); return `${file} ${inner ? `${inner.fingerprint} ${inner.digest}` : folderState(join(path, file)).fingerprint}` }
      if (stat.mtimeMs > latest) latest = stat.mtimeMs
      return `${file} ${stat.size} ${stat.mtimeMs}`
    } catch { return `${file} -` }
  }).join("\n")).slice(0, 12)
  return { mode: "git", head: commit, branch: git(path, "branch", "--show-current").stdout.trim(),
    dirty: porcelain ? porcelain.split("\n").length : 0, fingerprint: `${commit.slice(0, 12)}+${sha(porcelain).slice(0, 12)}`, digest, latest }
}
// Uncommitted files edited this recently mean someone is working in the repository: what is there now
// is a draft, and marking it would be outdated again in a moment.
const BUSY = 15 * 60000

/** A folder's state: every file's path, size and modification time, without dependencies and builds. */
function folderState(path) {
  const files = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(full) }
      else if (entry.isFile()) {
        try {
          const stat = statSync(full)
          files.push({ rel: relative(path, full).split(sep).join("/").normalize("NFC"), size: stat.size, time: Math.floor(stat.mtimeMs / 1000), ms: stat.mtimeMs })
        } catch {}
      }
    }
  }
  walk(path)
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return { mode: "folder", files: files.length, newest: files.reduce((max, file) => Math.max(max, file.time), 0),
    fingerprint: sha(files.map((file) => `${file.rel} ${file.size} ${file.ms}`).join("\n")).slice(0, 12), list: files }
}

/** What a page script returned: a list of items with ids is compared item by item, anything else as a whole. */
function pageState(ws, name, input) {
  let data = input
  for (let i = 0; i < 2 && typeof data === "string"; i++)
    try { data = JSON.parse(data) } catch (error) { throw new Error(format(ws.labels.messages["change-input"], { name, error: error.message })) }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : undefined
  if (list && list.every((item) => item && typeof item === "object" && item.id !== undefined && item.id !== null && String(item.id).trim())) {
    const items = [...new Map(list.map((item) => [String(item.id).trim(), {
      id: String(item.id).trim(), title: String(item.title ?? "").replace(/\s+/g, " ").trim(), ...(typeof item.url === "string" ? { url: item.url } : {}) }])).values()]
    // Only the ids count, so a retitled entry or a view count is no change.
    return { mode: "page", items, fingerprint: sha(items.map((item) => item.id).sort().join("\n")).slice(0, 12) }
  }
  return { mode: "page", fingerprint: sha(JSON.stringify(data)).slice(0, 12) }
}

/**
 * What a note source's page returned: the part between its markers as blocks, filtered again for
 * private lines. Without a pair of markers there is no part to follow, which is not a change: a note
 * whose markers were lost must not read as a note whose thoughts were all removed.
 */
function noteState(ws, source, input) {
  let data = input
  for (let i = 0; i < 2 && typeof data === "string"; i++)
    try { data = JSON.parse(data) } catch { break }
  const region = noteRegion(data, source.between)
  if (region.markers < 2) return { mode: "note", unmarked: true, markers: region.markers }
  return { mode: "note", markers: region.markers, skipped: region.skipped, blocks: region.blocks.length,
    fingerprint: sha(JSON.stringify(region.blocks)).slice(0, 12), list: region.blocks }
}

function current(ws, source, input) {
  if (source.kind === "page") return input === undefined ? undefined : pageState(ws, source.name, input)
  if (source.kind === "note") return input === undefined ? undefined : noteState(ws, source, input)
  if (!existsSync(source.path)) return { mode: "missing" }
  return existsSync(join(source.path, ".git")) ? repoState(source.path, { commits: source.watch === "commits" }) ?? folderState(source.path) : folderState(source.path)
}

/** How a source moved on from its last mark. */
/** What `changes mark --expect` takes: the state an agent read, so a later change is not marked unread. */
const tokenOf = (state) => state && state.fingerprint ? `${state.fingerprint}${state.digest ? `~${state.digest}` : ""}` : null

function compare(ws, source, before, now) {
  if (!now) return { status: "browser" }
  if (now.mode === "missing") return { status: "missing" }
  if (now.unmarked) return { status: "unmarked", detail: { markers: now.markers } }
  if (now.mode === "note") {
    if (before?.fingerprint === now.fingerprint) return { status: "same", current: now.fingerprint, detail: { skipped: now.skipped } }
    // The blocks kept at the last mark tell what changed; without them (never marked, or the cache was
    // cleared) every block is new to the memo.
    const kept = before ? readSnapshot(ws, source.name) : undefined
    const baseline = Boolean(kept && kept.fingerprint === before.fingerprint && Array.isArray(kept.blocks))
    return { status: before ? "changed" : "new", previous: before?.fingerprint, current: now.fingerprint,
      detail: { ...noteDiff(baseline ? kept.blocks : [], now.list), baseline, skipped: now.skipped } }
  }
  if (!before) return { status: "new", current: now.fingerprint }
  if (now.mode === "git") {
    if (before.mode === "git" && before.fingerprint === now.fingerprint && (!before.digest || before.digest === now.digest)) return { status: "same", current: now.fingerprint }
    // Watching commits only, a mark taken while watching everything still compares by its commit.
    if (now.commits && before.mode === "git" && before.head === now.head) return { status: "same", current: now.fingerprint }
    const range = before.head && before.head !== now.head ? `${before.head.slice(0, 12)}..${now.head.slice(0, 12)}` : undefined
    const count = range ? git(source.path, "rev-list", "--count", `${before.head}..${now.head}`) : undefined
    return { status: "changed", previous: before.fingerprint, current: now.fingerprint,
      detail: { branch: now.branch, range, commits: range ? (count.status === 0 ? Number(count.stdout.trim()) : null) : 0, dirty: now.dirty,
        edited: before.fingerprint === now.fingerprint, busy: Boolean(now.dirty && now.latest && Date.now() - now.latest < BUSY) } }
  }
  if (now.mode === "folder") {
    const since = before.markedAt ? Math.floor(new Date(before.markedAt).getTime() / 1000) : 0
    const newer = now.list.filter((file) => file.time > since).sort((a, b) => b.time - a.time)
    // A mark taken by another tool has no comparable fingerprint; newer files and the count tell instead.
    const changed = before.mode === "folder" && before.fingerprint ? before.fingerprint !== now.fingerprint : newer.length > 0 || before.files !== now.files
    if (!changed) return { status: "same", current: now.fingerprint }
    const detail = { files: now.files, before: before.files, newer: newer.length, recent: newer.slice(0, NEWER_SHOWN).map((file) => file.rel) }
    // The file list kept at the last mark names what was added, changed and removed.
    const kept = readSnapshot(ws, source.name)
    if (kept && kept.fingerprint === before.fingerprint) {
      const old = new Map(kept.files.map(([rel, size, ms]) => [rel, `${size} ${ms}`]))
      const seen = new Set(now.list.map((file) => file.rel))
      const pick = (list) => ({ count: list.length, shown: list.slice(0, NEWER_SHOWN) })
      Object.assign(detail, {
        added: pick(now.list.filter((file) => !old.has(file.rel)).map((file) => file.rel)),
        modified: pick(now.list.filter((file) => old.has(file.rel) && old.get(file.rel) !== `${file.size} ${file.ms}`).map((file) => file.rel)),
        removed: pick([...old.keys()].filter((rel) => !seen.has(rel))) })
    }
    return { status: "changed", previous: before.fingerprint, current: now.fingerprint, detail }
  }
  if (before.fingerprint === now.fingerprint) return { status: "same", current: now.fingerprint }
  const known = new Map((before.items ?? []).map((item) => [item.id, item]))
  const ids = new Set((now.items ?? []).map((item) => item.id))
  return { status: "changed", previous: before.fingerprint, current: now.fingerprint, detail: now.items && before.items ? {
    added: now.items.filter((item) => !known.has(item.id)), removed: [...known.values()].filter((item) => !ids.has(item.id)) } : {} }
}

const watched = (ws) => sourcesOf(ws).filter((source) => source.kind !== "items")

/**
 * Which watched sources changed since they were last marked. A page source needs what its script
 * returned (`input`, for the source named `name`); without it the page is listed as one to read.
 * Turned-off sources are left out unless `all` is set or the source is named.
 */
export function changes(ws, { name, input, all = false } = {}) {
  const m = ws.labels.messages
  if (input !== undefined && !name) throw new Error(format(m["needs-args"], { command: "changes --input", args: "<name>" }))
  const state = readSourceState(ws)
  const chosen = name ? [sourceNamed(ws, name)] : watched(ws).filter((source) => all || source.enabled)
  for (const source of chosen) if (source.kind === "items") throw new Error(format(m["change-kind"], { name: source.name }))
  return chosen.map((source) => {
    const before = state[source.name]?.watch
    const now = current(ws, source, source.name === name ? input : undefined)
    const result = compare(ws, source, before, now)
    return { name: source.name, kind: source.kind, label: source.label, node: source.node ?? null, enabled: source.enabled,
      ...(source.kind === "repo" ? { path: source.path, watch: source.watch } : { url: source.url }),
      ...(source.kind === "note" ? { between: source.between, removed: source.removed } : {}), markedAt: before?.markedAt ?? null, ...result,
      token: now && now.mode !== "missing" ? tokenOf(now) : null }
  })
}

const snapshotPath = (ws, name) => join(ws.cacheDir, "watch", `${name}.json`)
function readSnapshot(ws, name) {
  try { return JSON.parse(readFileSync(snapshotPath(ws, name), "utf8")) } catch { return undefined }
}

/**
 * Records the current state of watched sources after their nodes were brought up to date. With
 * `expect` (the `token` that `changes` printed for the one source named), a source that changed
 * again since it was read is not marked.
 */
export function markChanges(ws, names, { input, expect, now = new Date() } = {}) {
  const m = ws.labels.messages
  if (!names.length) throw new Error(format(m["needs-args"], { command: "changes mark", args: "<name>..." }))
  if ((input !== undefined || expect !== undefined) && names.length > 1) throw new Error(format(m["change-input-one"], {}))
  return withLock(join(ws.cacheDir, SOURCE_STATE), () => {
    const state = readSourceState(ws)
    const stamp = now.toISOString()
    const snapshots = []
    for (const name of names) {
      const source = sourceNamed(ws, name)
      if (source.kind === "items") throw new Error(format(m["change-kind"], { name }))
      if (["page", "note"].includes(source.kind) && input === undefined) throw new Error(format(m["change-input-needed"], { name }))
      const found = current(ws, source, input)
      if (found.mode === "missing") throw new Error(format(m["change-missing"], { name, path: source.path }))
      if (found.unmarked) throw new Error(format(m["change-unmarked"], { name, between: source.between }))
      if (expect !== undefined && expect !== tokenOf(found)) throw new Error(format(m["change-moved"], { name, expect, token: tokenOf(found) }))
      const { list, ...kept } = found
      state[name] = { ...state[name], watch: { ...kept, markedAt: stamp } }
      if (list) snapshots.push([name, found.mode === "note" ? { fingerprint: found.fingerprint, blocks: list }
        : { fingerprint: found.fingerprint, files: list.map((file) => [file.rel, file.size, file.ms]) }])
    }
    writeAtomic(join(ws.root, SOURCE_STATE), `${JSON.stringify(state, null, 2)}\n`)
    for (const [name, snapshot] of snapshots) {
      mkdirSync(join(ws.cacheDir, "watch"), { recursive: true })
      writeAtomic(snapshotPath(ws, name), JSON.stringify(snapshot))
    }
    return names
  }, m.locked)
}
