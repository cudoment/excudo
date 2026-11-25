// Keeps one workspace in step across several computers, through git alone. Two methods:
//   github: a private repository is the remote; pull fetches and merges, push sends the branch.
//   drive:  each computer writes its own git bundle into a folder the Google Drive desktop app syncs
//           (`<folder>/<workspace id>/<machine>.bundle`) and merges the bundles the others wrote.
//           `.git` never goes into Drive; a bundle carries history only.
// Nothing happens without the `sync` setting. Only `excudo sync` and `excudo save` (with `auto`) pull or
// push, and nothing here rebases, forces or resolves a conflict: a conflicting merge is aborted and left
// to the owner. The engine never enters a credential; GitHub access is whatever git and gh already have.
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync } from "node:fs"
import { hostname, homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "./build.mjs"
import { writeAtomic, withLock } from "./files.mjs"
import { commitGraph, heldFiles, holdSpecs, incomingGraphFiles, inRepository } from "./git.mjs"
import { ghOf, ghRun, ghUser, hostRun, hostTimeout, isNetworkFailure } from "./github.mjs"
import { format } from "./labels.mjs"
import { renderTemplate } from "./init.mjs"
import { saveGraph } from "./save.mjs"
import { CONFIG_FILE } from "./workspace.mjs"
import { readState, writeState } from "./syncstate.mjs"

export const SYNC_KEYS = ["id", "github", "drive", "auto"]
const STATE_FILE = "sync.json"
const MACHINE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const BUNDLE = /^([a-z0-9][a-z0-9._-]{0,63})\.bundle$/
const WORKSPACE_ID = /^[a-z0-9]{6,32}$/
const REGION_START = "// excudo:sync (written by excudo sync setup)"
const REGION_END = "// /excudo:sync"

/** A failure the owner can act on: `kind` says which, `message` is already in the workspace's words. */
class SyncFailure extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra) }
}

const words = (ws) => ws.labels.sync

// ---- settings -------------------------------------------------------------------------------------

/** `~` and `~/…` as the owner's home folder. */
const expand = (path) => (path === "~" ? homedir() : path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path)

/**
 * The `sync` setting as `{ method, id, auto, remote, branch, folder }`, or undefined when sync is off.
 * Throws a message in the workspace's words when the setting is not usable.
 */
export function syncOf(ws) {
  const raw = ws.sync
  if (raw === undefined || raw === null || raw === false) return undefined
  const m = words(ws)
  const bad = (why) => new Error(format(m.invalid, { why }))
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad(m["invalid-shape"])
  for (const key of Object.keys(raw)) if (!SYNC_KEYS.includes(key)) throw bad(format(m["invalid-key"], { key }))
  const both = raw.github !== undefined && raw.drive !== undefined
  if (both || (raw.github === undefined && raw.drive === undefined)) throw bad(m["invalid-method"])
  if (raw.auto !== undefined && typeof raw.auto !== "boolean") throw bad(m["invalid-auto"])
  if (raw.id !== undefined && !(typeof raw.id === "string" && WORKSPACE_ID.test(raw.id))) throw bad(m["invalid-id"])
  const settings = { id: raw.id, auto: raw.auto === true }
  if (raw.github !== undefined) {
    const github = raw.github === true ? {} : raw.github
    if (!github || typeof github !== "object" || Array.isArray(github)) throw bad(m["invalid-github"])
    for (const [key, value] of Object.entries(github)) {
      if (!["remote", "branch"].includes(key)) throw bad(format(m["invalid-key"], { key: `github.${key}` }))
      if (typeof value !== "string" || !value.trim()) throw bad(format(m["invalid-text"], { key: `github.${key}` }))
    }
    return { ...settings, method: "github", remote: github.remote ?? "origin", branch: github.branch }
  }
  const drive = raw.drive
  if (!drive || typeof drive !== "object" || Array.isArray(drive)) throw bad(m["invalid-drive"])
  for (const [key, value] of Object.entries(drive)) {
    if (key !== "folder") throw bad(format(m["invalid-key"], { key: `drive.${key}` }))
    if (typeof value !== "string" || !value.trim()) throw bad(format(m["invalid-text"], { key: "drive.folder" }))
  }
  if (typeof drive.folder !== "string") throw bad(format(m["invalid-text"], { key: "drive.folder" }))
  if (!settings.id) throw bad(m["invalid-drive-id"])
  return { ...settings, method: "drive", folder: drive.folder }
}

// ---- machine-local state ----------------------------------------------------------------------------

export { readState }

/** The computer's name as a bundle's file name: lowercase letters, digits, dot, dash and underscore. */
export function machineFrom(text) {
  const name = String(text ?? "").toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/[-._]+$/, "").slice(0, 64)
  return name || "computer"
}

/** This computer's name for Drive bundles: kept in the state file, made from the hostname the first time. */
function machineOf(ws) {
  const state = readState(ws)
  if (state.machine && MACHINE.test(state.machine)) return state.machine
  const machine = machineFrom(hostname())
  writeState(ws, { machine })
  return machine
}

/** The Drive folder this computer uses: its own (set up here), else the setting's. */
function folderOf(ws, settings) {
  const given = expand(readState(ws).folder ?? settings.folder)
  if (!isAbsolute(given)) throw new SyncFailure("folder", format(words(ws)["drive-relative"], { folder: given }))
  return resolve(given)
}

// ---- git ------------------------------------------------------------------------------------------

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no", LC_ALL: "C", LANG: "C" }
const base = (ws) => ["-C", ws.root, "-c", "core.quotePath=false"]
/** A local git call. */
const git = (ws, ...args) => spawnSync("git", [...base(ws), ...args], { encoding: "utf8", env: ENV, maxBuffer: 64 * 1024 * 1024 })
/** A git call that may reach a network or a synced folder: it has a deadline that also ends its children. */
const net = (ws, ...args) => hostRun("git", [...base(ws), ...args], { env: ENV })
const said = (result) => `${result.stderr ?? ""}${result.stdout ?? ""}${result.error?.message ?? ""}`.trim()

const headOf = (ws) => { const r = git(ws, "rev-parse", "--verify", "--quiet", "HEAD"); return r.status === 0 ? r.stdout.trim() : null }
const currentBranch = (ws) => { const r = git(ws, "symbolic-ref", "--short", "-q", "HEAD"); return r.status === 0 ? r.stdout.trim() : null }

/** The tracked files with changes not committed yet (new untracked files do not count). */
function trackedChanges(ws) {
  const out = git(ws, "status", "--porcelain", "-z", "--untracked-files=no").stdout
  return out.split("\0").filter((entry) => /^.. ./.test(entry)).map((entry) => entry.slice(3))
}

function branchOf(ws, settings) {
  // A Drive computer with no history yet is on whatever `git init` named its branch; the one recorded at setup is the memo's.
  const recorded = settings.method === "drive" && !headOf(ws) ? readState(ws).branch : undefined
  const branch = recorded ?? settings.branch ?? currentBranch(ws)
  if (!branch) throw new SyncFailure("branch", words(ws)["no-branch"])
  return branch
}

function counts(ws, ref) {
  const r = git(ws, "rev-list", "--left-right", "--count", `HEAD...${ref}`)
  if (r.status !== 0) return null
  const [ahead, behind] = r.stdout.trim().split(/\s+/).map(Number)
  return { ahead, behind }
}

/**
 * Brings `ref` into the current branch: nothing when it is already there, a fast-forward or a merge
 * commit otherwise. A conflicting merge is aborted and the tree is as it was; the conflicting files are named.
 */
function mergeIn(ws, ref, label) {
  const here = headOf(ws)
  if (git(ws, "merge-base", "--is-ancestor", ref, "HEAD").status === 0) return { state: "up-to-date" }
  if (git(ws, "merge-base", "HEAD", ref).status !== 0) return { state: "unrelated" }
  const merged = git(ws, "merge", "--no-edit", "-m", `Merge ${label}`, ref)
  if (merged.status === 0) return { state: "merged", from: here, to: headOf(ws) }
  const files = git(ws, "diff", "--name-only", "--diff-filter=U").stdout.split("\n").filter(Boolean)
  git(ws, "merge", "--abort")
  // A merge that stopped before it began (a file it would overwrite) has nothing to abort.
  return files.length ? { state: "conflict", files } : { state: "error", message: said(merged) }
}

/**
 * A folder with no commit yet (a fresh `excudo init`, then `git init`) takes the history it is given as
 * its own. What `init` wrote that the history also has is moved aside into the cache, so nothing is lost.
 */
function adopt(ws, ref, branch) {
  const inHistory = git(ws, "ls-tree", "-r", "--name-only", "-z", ref).stdout.split("\0").filter(Boolean)
  // With no commit, every file of the graph folder is what `init` made (the history was built elsewhere): all of it moves aside,
  // also what the history lacks (a Home view the other computer handed over), or it would stay and be committed by a later save.
  const graph = relative(ws.root, ws.graphDir).split("\\").join("/")
  const leftover = graph && !graph.startsWith("..")
    ? git(ws, "ls-files", "-z", "--others", "--exclude-standard", "--", graph).stdout.split("\0").filter(Boolean) : []
  const names = [...new Set([...inHistory, ...leftover])]
  const aside = join(ws.cacheDir, "sync-before")
  const moved = []
  for (const name of names) {
    const path = join(ws.root, name)
    // A link whose target was just moved still stands in the way, so it is looked at without following it.
    try { lstatSync(path) } catch { continue }
    const to = join(aside, name)
    mkdirSync(dirname(to), { recursive: true })
    rmSync(to, { recursive: true, force: true })
    renameSync(path, to)
    moved.push(name)
  }
  // What `init` recorded about its own pages means nothing for the history taken over: the first build there takes the history's generated pages as they are.
  const record = join(ws.cacheDir, "build.json")
  if (existsSync(record)) { mkdirSync(aside, { recursive: true }); renameSync(record, join(aside, "build.json")) }
  const done = git(ws, "checkout", "-q", "-B", branch, ref)
  if (done.status !== 0) {
    if (existsSync(join(aside, "build.json"))) { try { renameSync(join(aside, "build.json"), record) } catch {} }
    for (const name of moved) { try { renameSync(join(aside, name), join(ws.root, name)) } catch {} }
    throw new SyncFailure("adopt", format(words(ws)["adopt-failed"], { why: said(done) }))
  }
  // The history was built elsewhere: this computer's first build takes its generated text as it is, and it is no longer waiting to join.
  writeState(ws, { fresh: true, joining: false })
  return { state: "adopted", moved }
}

/**
 * A computer that has never synced and has not built (a fresh clone) is marked: its first build takes the history's
 * generated text as the engine's own output. One that built before, or synced before, is never marked.
 */
function markFresh(ws) {
  if (existsSync(join(ws.cacheDir, STATE_FILE)) || existsSync(join(ws.cacheDir, "build.json"))) return
  writeState(ws, { fresh: true })
}

/** What a merge brought in is built and committed the way `save` does it, so generated text matches. */
function rebuild(ws, merges, accepted) {
  if (!merges.length) return null
  try {
    const built = build(ws, { accepted })
    if (built.errors.length || built.blocked.length) return { state: "failed", message: [...built.errors, ...built.blocked].map((item) => item.message ?? String(item)).join("; ") }
    if (!built.written.length) return { state: "clean" }
    const state = commitGraph(ws, words(ws)["build-commit"], { only: built.written })
    return { state, written: built.written.map((file) => relative(ws.graphDir, file)) }
  } catch (error) { return { state: "failed", message: error.message } }
}

// ---- the files a clone needs -----------------------------------------------------------------------

/** What `init` writes beside the settings and the graph: without them a clone has no engine to install and no ignore rules. */
const WORKSPACE_FILES = ["package.json", "package-lock.json", ".gitignore", "AGENTS.md", "CLAUDE.md", ".agents/skills", ".claude/skills"]

/**
 * Commits the workspace files `init` made that git does not track yet (never an ignored file, and nothing outside
 * this list), so a clone of the history can `npm install` and keeps the ignore rules and the agent instructions.
 * With `modified`, a tracked one that changed (AGENTS.md after the auto rule was added) goes in too.
 * Returns the paths committed. A link into node_modules (skills linked to a local clone) is left out.
 */
function commitWorkspaceFiles(ws, { modified = false } = {}) {
  const exists = (path) => { try { lstatSync(join(ws.root, path)); return true } catch { return false } }
  const present = WORKSPACE_FILES.filter(exists)
  if (!present.length) return []
  const kept = present.filter((path) => git(ws, "check-ignore", "-q", "--", path).status !== 0)
  if (!kept.length) return []
  const linked = []
  for (const folder of [".agents/skills", ".claude/skills"]) {
    try {
      for (const entry of readdirSync(join(ws.root, folder))) {
        try { if (readlinkSync(join(ws.root, folder, entry)).includes("node_modules")) linked.push(`${folder}/${entry}`) } catch {}
      }
    } catch {}
  }
  const specs = [...kept, ...linked.map((path) => `:(exclude)${path}`)]
  const status = git(ws, "status", "--porcelain", "-z", "--untracked-files=all", "--", ...specs).stdout.split("\0").filter((entry) => /^.. ./.test(entry))
  const wanted = status.filter((entry) => modified || entry.startsWith("??")).map((entry) => entry.slice(3))
  if (!wanted.length) return []
  const added = git(ws, "add", "--", ...wanted)
  if (added.status !== 0) return []
  const done = git(ws, "commit", "-q", "-m", words(ws)["workspace-commit"], "--", ...wanted)
  return done.status === 0 ? wanted : []
}

// ---- pull and push, per method --------------------------------------------------------------------

function pullGithub(ws, s, branch, result) {
  const m = words(ws)
  const fetched = net(ws, "fetch", s.remote, branch)
  if (fetched.status !== 0) {
    // A repository without that branch yet (the first push makes it) is not a failure.
    const listed = net(ws, "ls-remote", "--exit-code", "--heads", s.remote, branch)
    if (listed.status === 2) { result.pulled.push({ source: s.remote, state: "remote-empty" }); return }
    throw isNetworkFailure(fetched) || isNetworkFailure(listed)
      ? new SyncFailure("network", format(m.network, { where: s.remote, why: said(fetched).split("\n")[0] }))
      : new SyncFailure("fetch", format(m["fetch-failed"], { where: s.remote, why: said(fetched) }))
  }
  takeIn(ws, "FETCH_HEAD", s.remote, branch, `${s.remote}/${branch}`, result, `${s.remote}/${branch}`)
}

/** Merges (or adopts) one fetched source and records what became of it. */
function takeIn(ws, ref, source, branch, label, result, refName = ref) {
  if (!headOf(ws)) {
    const adopted = adopt(ws, git(ws, "rev-parse", ref).stdout.trim(), branch)
    result.pulled.push({ source, ...adopted })
    result.merged = true
    return
  }
  const step = mergeIn(ws, ref, label)
  result.pulled.push({ source, ...step })
  if (step.state === "merged") result.merged = true
  if (step.state === "conflict") {
    // Sources merged before this one stay merged: say so, and name the ref the owner (or an agent) merges by hand.
    const earlier = result.pulled.filter((item) => item.state === "merged").map((item) => item.source)
    const m = words(ws)
    throw new SyncFailure("conflict", format(m.conflict, { source, ref: refName, files: step.files.join(", "), earlier: earlier.length ? format(m["conflict-earlier"], { merged: earlier.join(", ") }) : "" }), { files: step.files, ref: refName })
  }
  if (step.state === "unrelated") throw new SyncFailure("unrelated", format(words(ws).unrelated, { source }))
  if (step.state === "error") throw new SyncFailure("merge", format(words(ws)["merge-failed"], { source, why: step.message }))
}

function pushGithub(ws, s, branch, result) {
  const m = words(ws)
  if (!headOf(ws)) throw new SyncFailure("empty", m["nothing-to-push"])
  const pushed = net(ws, "push", s.remote, `HEAD:${branch}`)
  if (pushed.status === 0) { result.pushed = { state: "pushed", to: `${s.remote}/${branch}` }; return }
  // The pull and its merge may already be done: say that this step alone failed.
  if (isNetworkFailure(pushed)) throw new SyncFailure("network", format(m[result.merged ? "network-push" : "network"], { where: s.remote, why: said(pushed).split("\n")[0] }))
  // Only a push git refused for being behind means "pull first"; a hook or protected branch is its own reason.
  if (/\[rejected\]/.test(said(pushed)) && /non-fast-forward|fetch first/i.test(said(pushed))) throw new SyncFailure("rejected", format(m.rejected, { where: `${s.remote}/${branch}` }))
  throw new SyncFailure("push", format(m["push-failed"], { where: s.remote, why: said(pushed) }))
}

/** The bundles the others wrote: `{ machine, name, path, mtime }` by name, and the files left out. */
function bundlesOf(dir, own) {
  const found = [], skipped = []
  let names = []
  try { names = readdirSync(dir) } catch { return { found, skipped } }
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith(".bundle") || name.startsWith(".")) continue
    const match = name.match(BUNDLE)
    // A Drive conflict copy ("name (1).bundle"), or any name this engine does not write.
    if (!match) { skipped.push({ file: name, why: "name" }); continue }
    if (match[1] === own) continue
    let mtime = 0
    try { mtime = statSync(join(dir, name)).mtimeMs } catch {}
    found.push({ machine: match[1], name, path: join(dir, name), mtime })
  }
  return { found, skipped }
}

/** The branches a bundle holds, as `{ sha, branch }`. */
function bundleHeads(ws, path) {
  return net(ws, "bundle", "list-heads", path).stdout.split("\n").map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1]?.startsWith("refs/heads/")).map(([sha, ref]) => ({ sha, branch: ref.slice("refs/heads/".length) }))
}

/** A bundle under this computer's name that it never wrote belongs to another computer: nothing here touches it. */
function ensureMachine(ws, dir, machine) {
  const state = readState(ws)
  const wrote = Boolean(state.pushedAt) && state.pushedMachine === machine
  if (existsSync(join(dir, `${machine}.bundle`)) && !wrote) throw new SyncFailure("machine-taken", format(words(ws)["machine-taken"], { machine }))
}

function pullDrive(ws, s, branch, result) {
  const m = words(ws)
  const folder = folderOf(ws, s)
  // A folder that is not there is not "no other computers": the memo may be stale.
  if (!existsSync(folder)) throw new SyncFailure("folder", format(m["drive-missing"], { folder }))
  const dir = join(folder, s.id)
  const own = machineOf(ws)
  ensureMachine(ws, dir, own)
  const { found, skipped } = bundlesOf(dir, own)
  result.skipped.push(...skipped)
  // A computer with no history yet takes the newest bundle as its own and merges the rest.
  const sources = headOf(ws) ? found : [...found].sort((a, b) => b.mtime - a.mtime)
  const others = new Set()
  let wrongBranch = 0
  const unrelated = []
  let related = 0
  for (const source of sources) {
    const ok = net(ws, "bundle", "verify", source.path)
    if (ok.status !== 0) { result.skipped.push({ file: source.name, why: "unreadable" }); continue }
    const heads = bundleHeads(ws, source.path)
    const fresh = !headOf(ws)
    const onto = fresh ? branch : currentBranch(ws) ?? branch
    // With no history yet the branch is the bundle's, whatever `git init` named this one.
    const want = heads.find((head) => head.branch === onto) ?? (fresh ? heads[0] : undefined)
    if (!want) { result.skipped.push({ file: source.name, why: "branch" }); wrongBranch++; heads.forEach((head) => others.add(head.branch)); continue }
    const ref = `refs/excudo-sync/${source.machine}`
    const fetched = net(ws, "fetch", "-q", source.path, `+refs/heads/${want.branch}:${ref}`)
    if (fetched.status !== 0) { result.skipped.push({ file: source.name, why: "unreadable" }); continue }
    try { takeIn(ws, ref, source.machine, want.branch, `${source.machine} into ${want.branch}`, result, ref); related++ }
    catch (error) {
      // On a computer with history, a bundle of another memo is skipped and said; the other merges and the push go on.
      if (!(error instanceof SyncFailure) || error.kind !== "unrelated") throw error
      result.pulled.pop()
      result.skipped.push({ file: source.name, why: "unrelated" })
      unrelated.push(source.name)
    }
  }
  // Every bundle found is another memo's: pushing would add one more unrelated bundle for all the others to warn about.
  if (unrelated.length && !related) throw new SyncFailure("unrelated", format(m.unrelated, { source: unrelated.join(", ") }))
  // Every other bundle is on another branch: nothing can ever merge, and saying "pulled" would be false. The push still goes on first.
  if (found.length && wrongBranch === found.length) result.later = new SyncFailure("branch-mismatch", format(m["branch-mismatch"], { branch, others: [...others].join(", ") }))
  // A folder with no history that took nothing over must not go on: a save now would make a history that never joins the memo.
  if (!headOf(ws) && readState(ws).joining) throw new SyncFailure("nothing-adopted", m["nothing-adopted"])
  if (!found.length && !result.pulled.length) result.pulled.push({ source: dir, state: "no-others" })
}

function pushDrive(ws, s, branch, result) {
  const m = words(ws)
  const folder = folderOf(ws, s)
  if (!existsSync(folder)) throw new SyncFailure("folder", format(m["drive-missing"], { folder }))
  const head = headOf(ws)
  if (!head) throw new SyncFailure("empty", m["nothing-to-push"])
  const machine = machineOf(ws)
  const dir = join(folder, s.id)
  const target = join(dir, `${machine}.bundle`)
  // Even a name the owner chose may not take a bundle this computer never wrote.
  ensureMachine(ws, dir, machine)
  // Up to date means the bundle itself holds this head, not only that a push was once recorded.
  if (existsSync(target) && bundleHeads(ws, target).find((item) => item.branch === branch)?.sha === head) { result.pushed = { state: "up-to-date", to: target }; return }
  mkdirSync(dir, { recursive: true })
  const temporary = join(dir, `.${machine}.${process.pid}.tmp`)
  const made = net(ws, "bundle", "create", "-q", temporary, `refs/heads/${branch}`)
  if (made.status !== 0) {
    rmSync(temporary, { force: true })
    throw new SyncFailure("bundle", format(m["bundle-failed"], { why: said(made) }))
  }
  // One rename, in the folder itself: Drive never sees half a bundle under the final name.
  renameSync(temporary, target)
  writeState(ws, { pushed: head, pushedBranch: branch, pushedAt: new Date().toISOString(), pushedMachine: machine, branch })
  result.pushed = { state: "pushed", to: target }
}

// ---- the command ----------------------------------------------------------------------------------

/**
 * Pulls, then pushes (each unless turned off). The caller holds the graph lock. Returns the result as
 * data: `{ method, code, pulled, pushed, merged, skipped, warnings, built, error }`; code 1 on a failure,
 * with the workspace as it was before a failed pull. A failed step is also recorded in the state file.
 */
export async function syncRun(ws, { pull = true, push = true, say = () => {} } = {}) {
  const m = words(ws)
  const result = { method: null, code: 0, pulled: [], pushed: null, merged: false, skipped: [], warnings: [], built: null, added: [], error: null }
  let s
  try { s = syncOf(ws) } catch (error) { return { ...result, code: 1, error: { kind: "invalid", message: error.message } } }
  if (!s) return { ...result, code: 1, error: { kind: "not-set", message: m["not-set"] } }
  result.method = s.method
  try {
    if (!inRepository(ws.root)) throw new SyncFailure("not-git", m["needs-git"])
    const branch = branchOf(ws, s)
    markFresh(ws)
    if (pull) {
      let changed = trackedChanges(ws)
      if (changed.length && s.auto) {
        say(m["auto-saving"])
        const saved = await saveGraph(ws, m["auto-save"])
        if (saved.code) throw new SyncFailure("save", m["auto-save-failed"])
        // What `save` says is said here too: a line that looks private must not reach a remote unseen.
        for (const issue of saved.loud ?? []) {
          const line = `[${issue.code}] ${issue.message}`
          result.warnings.push(line)
          say(`! ${line}`)
        }
        changed = trackedChanges(ws)
        // `save` commits the graph and the engine's own files; a tracked file beside them (AGENTS.md, package.json)
        // is committed here too, so an owner who does not use git is never stopped by it. Nothing untracked is added.
        // Files a scheduled run holds (EXCUDO_HOLD) are another session's edit in progress and are left out; if only they remain, the pull stops.
        if (changed.length && git(ws, "commit", "-q", "-m", m["auto-save"], "--", ".", ...holdSpecs(heldFiles(ws))).status === 0) changed = trackedChanges(ws)
      }
      if (changed.length) throw new SyncFailure("uncommitted", format(m.uncommitted, { files: changed.slice(0, 5).join(", ") }), { files: changed })
      const before = headOf(ws)
      say(format(m.pulling, { where: s.method === "github" ? `${s.remote}/${branch}` : join(folderOf(ws, s), s.id) }))
      try { (s.method === "github" ? pullGithub : pullDrive)(ws, s, branch, result) }
      finally {
        // A merge that went through stays, so it is built and committed even when a later source failed.
        // After a takeover this process still holds the settings `init` made (a settings file is imported once), and
        // the history was built by the computer that wrote it: no rebuild until the next command reads the new settings.
        if (result.merged && !result.pulled.some((item) => item.state === "adopted")) {
          // The pages the merge brought in are the other computer's engine output: the build must not take them for hand edits.
          result.built = rebuild(ws, result.pulled.filter((item) => item.state === "merged"), { files: incomingGraphFiles(ws, before), before })
          if (result.built?.state === "failed") result.warnings.push(format(m["build-failed"], { why: result.built.message }))
        }
      }
    }
    if (push) {
      // A clone must be able to start: the workspace files `init` made travel with the first push.
      const added = headOf(ws) ? commitWorkspaceFiles(ws) : []
      if (added.length) { result.added = added; say(format(m["files-added"], { files: added.join(", ") })) }
      say(m.pushing)
      ;(s.method === "github" ? pushGithub : pushDrive)(ws, s, branch, result)
    }
    if (result.later) throw result.later
    for (const item of result.skipped) result.warnings.push(format(m[`skipped-${item.why}`], { file: item.file }))
    writeState(ws, { lastSync: new Date().toISOString(), ...(pull ? { lastPull: new Date().toISOString() } : {}), ...(push && result.pushed ? { lastPush: new Date().toISOString() } : {}), lastError: null })
    if (result.built?.state === "failed") result.code = 1
  } catch (error) {
    if (!(error instanceof SyncFailure)) throw error
    result.code = 1
    result.error = { kind: error.kind, message: error.message, ...(error.files ? { files: error.files } : {}), ...(error.ref ? { ref: error.ref } : {}) }
    try { writeState(ws, { lastError: { at: new Date().toISOString(), kind: error.kind, message: error.message.split("\n")[0] } }) } catch {}
  }
  return result
}

/** After a commit `save` made: pushes when `sync.auto` is on. A failure is a warning; the commit stays. */
export async function autoPush(ws, { committed = true } = {}) {
  if (!ws.sync?.auto) return null
  try {
    // A save that committed nothing still sends what an earlier offline commit left behind.
    if (!committed && !aheadOfSent(ws)) return null
    return await syncRun(ws, { pull: false, push: true })
  } catch (error) {
    return { code: 1, error: { kind: "error", message: error.message }, warnings: [] }
  }
}

/** Whether HEAD holds commits not sent yet: Drive compares with the last bundle this computer wrote, GitHub with the remote branch it last saw. */
function aheadOfSent(ws) {
  let s
  try { s = syncOf(ws) } catch { return false }
  if (!s || !inRepository(ws.root)) return false
  const head = headOf(ws)
  if (!head) return false
  if (s.method === "drive") return readState(ws).pushed !== head
  const branch = s.branch ?? currentBranch(ws)
  if (!branch) return false
  const known = counts(ws, `refs/remotes/${s.remote}/${branch}`)
  return known === null ? true : known.ahead > 0
}

// ---- status ---------------------------------------------------------------------------------------

/** Where sync stands, from what this computer already knows (no network): method, place, last sync, ahead/behind, other machines. */
export function syncStatus(ws) {
  let s
  try { s = syncOf(ws) } catch (error) { return { configured: true, valid: false, error: error.message } }
  if (!s) return { configured: false }
  const state = readState(ws)
  const status = { configured: true, valid: true, method: s.method, id: s.id ?? null, auto: s.auto, lastSync: state.lastSync ?? null, lastPush: state.lastPush ?? null,
    lastPull: state.lastPull ?? null, lastError: state.lastError ?? null, machines: [], ahead: null, behind: null }
  if (inRepository(ws.root)) {
    status.branch = s.branch ?? currentBranch(ws)
    status.uncommitted = trackedChanges(ws).length
  }
  if (s.method === "github") {
    status.remote = s.remote
    const known = status.branch && git(ws, "rev-parse", "--verify", "--quiet", `refs/remotes/${s.remote}/${status.branch}`).status === 0
    if (known) Object.assign(status, counts(ws, `refs/remotes/${s.remote}/${status.branch}`) ?? {})
    return status
  }
  try {
    status.folder = folderOf(ws, s)
    status.machine = readState(ws).machine ?? machineFrom(hostname())
    status.folderExists = existsSync(status.folder)
    const { found } = bundlesOf(join(status.folder, s.id), status.machine)
    status.machines = found.map((item) => ({ name: item.machine, at: new Date(item.mtime).toISOString(), ...(counts(ws, `refs/excudo-sync/${item.machine}`) ?? {}) }))
    status.ahead = status.machines.length ? Math.max(...status.machines.map((item) => item.ahead ?? 0)) : null
    status.behind = status.machines.length ? Math.max(...status.machines.map((item) => item.behind ?? 0)) : null
  } catch (error) { status.error = error.message }
  return status
}

// ---- setup ----------------------------------------------------------------------------------------

const VERIFY = `
import { isDeepStrictEqual } from "node:util"
const settings = (await import(process.argv[1])).default
if (!isDeepStrictEqual(settings?.sync, JSON.parse(process.argv[2]))) process.exitCode = 1
`

/**
 * Writes the `sync` setting into the workspace's settings file, between its own marker lines, and
 * imports the file again in a fresh process; a file that no longer loads is put back as it was.
 */
export function writeSyncSetting(ws, value) {
  const file = join(ws.root, CONFIG_FILE)
  const m = words(ws)
  return withLock(file, () => {
    const original = readFileSync(file)
    const text = original.toString("utf8")
    const newline = text.includes("\r\n") ? "\r\n" : "\n"
    const encoded = JSON.stringify(value, null, 2).replaceAll("\n", `${newline}  `)
    const region = `  ${REGION_START}${newline}  sync: ${encoded},${newline}  ${REGION_END}${newline}`
    const marked = new RegExp(`[ \\t]*${REGION_START.replace(/[()/.]/g, "\\$&")}\\r?\\n[\\s\\S]*?${REGION_END.replace(/[/]/g, "\\/")}\\r?\\n`)
    let next
    if (marked.test(text)) next = text.replace(marked, () => region)
    else {
      // A setting the owner wrote by hand is theirs: it is not replaced behind their back.
      if (ws.sync !== undefined) throw new Error(format(m["setting-by-hand"], { file: CONFIG_FILE }))
      const open = text.match(/export\s+default\s*\{[ \t]*(\r?\n)?/)
      if (!open) throw new Error(format(m["setting-unsafe"], { file: CONFIG_FILE, setting: JSON.stringify(value) }))
      const at = open.index + open[0].length
      next = text.slice(0, at) + (open[1] ? "" : newline) + region + text.slice(at)
    }
    writeAtomic(file, next)
    const verified = spawnSync(process.execPath, ["--input-type=module", "-e", VERIFY, pathToFileURL(file).href, JSON.stringify(value)], { cwd: ws.root, encoding: "utf8", timeout: 30000 })
    if (verified.status !== 0) {
      writeAtomic(file, original.toString("utf8"))
      throw new Error(format(m["setting-unsafe"], { file: CONFIG_FILE, setting: JSON.stringify(value) }))
    }
    return next
  }, ws.labels.messages["graph-locked"])
}

/** The workspace's rule for automatic sync, in its language. */
export const syncRuleText = (ws) => renderTemplate("sync-rule.md", { locale: ws.locale }).trim()

/** Adds the automatic-sync rule to the end of the workspace's Rules section (or of the file), once. */
export function addSyncRule(ws) {
  const file = join(ws.root, "AGENTS.md")
  const rule = syncRuleText(ws)
  const flat = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim()
  const text = existsSync(file) ? readFileSync(file, "utf8") : ""
  if (flat(text).includes(flat(rule))) return false
  const lines = text.split("\n")
  const rules = lines.findIndex((line) => /^##\s+(Rules|규칙)\s*$/.test(line))
  let at = lines.length
  if (rules >= 0) {
    const next = lines.findIndex((line, i) => i > rules && /^##\s/.test(line))
    at = next < 0 ? lines.length : next
    while (at > rules + 1 && lines[at - 1].trim() === "") at--
  }
  const joined = [...lines.slice(0, at), ...rule.split("\n"), ...(at < lines.length ? ["", ...lines.slice(at)] : [])]
  writeAtomic(file, `${joined.join("\n").replace(/\n+$/, "")}\n`)
  return true
}

const driveIds = (folder) => {
  try { return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory() && WORKSPACE_ID.test(entry.name)
    && bundlesOf(join(folder, entry.name), "").found.length).map((entry) => entry.name) } catch { return [] }
}

/** `owner/name` of a github.com remote URL, or null for another host. */
const repoOf = (url) => url.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)?.slice(1).join("/") ?? null

/**
 * The visibility of a remote on github.com as gh reports it ("PUBLIC", "PRIVATE", "INTERNAL"), or null when
 * it could not be checked (gh missing or logged out, or the call failed). A remote on another host returns "OTHER".
 */
function visibilityOf(url) {
  const repo = repoOf(url)
  if (!repo) return "OTHER"
  const gh = ghOf()
  if (!gh || !ghUser(gh)) return null
  const seen = ghRun(gh, ["repo", "view", repo, "--json", "visibility"])
  if (seen.status !== 0) return null
  try { return JSON.parse(seen.stdout).visibility ?? null } catch { return null }
}

/** The text of a settings value written as `key: "value"`. */
const settingText = (text, key) => text.match(new RegExp(`^\\s*${key}:\\s*["']([^"']+)["']`, "m"))?.[1]

/**
 * Whether the memo a bundle holds was made with another language or graph folder than this folder: `null` when they
 * match (or cannot be told), else the values for the message. Reads the bundle's settings file without checking anything out.
 */
function joinMismatch(ws, dir) {
  const { found } = bundlesOf(dir, "")
  for (const source of found) {
    if (net(ws, "bundle", "verify", source.path).status !== 0) continue
    const heads = bundleHeads(ws, source.path)
    if (!heads.length) continue
    const ref = `refs/excudo-sync/${source.machine}`
    if (net(ws, "fetch", "-q", source.path, `+refs/heads/${heads[0].branch}:${ref}`).status !== 0) continue
    const config = git(ws, "show", `${ref}:${CONFIG_FILE}`)
    if (config.status !== 0) continue
    const there = { locale: settingText(config.stdout, "locale") ?? "en", graph: settingText(config.stdout, "graph") ?? "notes" }
    const here = { locale: ws.locale, graph: ws.graph }
    if (there.locale !== here.locale || there.graph !== here.graph) return { mismatch: { here: `${here.locale}, ${here.graph}/`, there: `${there.locale}, ${there.graph}/`, locale: there.locale, graph: there.graph } }
    return { ok: true }
  }
  // No bundle of the memo could be read: the id is wrong, or Drive has not finished bringing the folder to this computer.
  return { none: true }
}

const safeReal = (path) => { try { return realpathSync(path) } catch { return path } }

/** Whether `inner` is `outer` or lies inside it (both existing paths, compared through their real locations). */
function within(inner, outer) {
  try {
    const rel = relative(realpathSync(outer), realpathSync(inner))
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  } catch { return false }
}

/** The private repository for `--create`, through gh; `{ code }` when the owner has something to do first. */
function createRepository(ws, repo, say) {
  const m = words(ws)
  const gh = ghOf()
  if (!gh) { say(m["gh-missing"]); return { code: 1 } }
  if (!ghUser(gh)) { say(m["gh-login"]); return { code: 1 } }
  const seen = ghRun(gh, ["repo", "view", repo, "--json", "visibility,url"])
  if (seen.status === 0) {
    let info = {}
    try { info = JSON.parse(seen.stdout) } catch {}
    if (info.visibility && info.visibility !== "PRIVATE") { say(format(m["repo-not-private"], { repo })); return { code: 1 } }
  } else if (ghRun(gh, ["repo", "create", repo, "--private", "--description", m["repo-description"]]).status !== 0) {
    say(format(m["repo-failed"], { repo })); return { code: 1 }
  } else say(format(m["repo-made"], { repo }))
  const url = ghRun(gh, ["repo", "view", repo, "--json", "url", "--jq", ".url"])
  return { url: url.status === 0 && url.stdout.trim() ? `${url.stdout.trim()}.git` : `https://github.com/${repo}.git` }
}

/**
 * `sync setup github|drive`: writes the setting (with a workspace id made once), and for GitHub can make
 * the private repository with gh. Returns `{ code, setting, ... }`; nothing is pulled or pushed here.
 */
export function setupSync(ws, { method, remote, create, folder, machine, id, fresh = false, auto = false, say = () => {} } = {}) {
  const m = words(ws)
  const fail = (key, values) => { say(format(m[key], values)); return { code: 1, error: key } }
  if (!["github", "drive"].includes(method)) return fail("setup-usage")
  if (!inRepository(ws.root)) return fail("needs-git")
  let current
  try { current = syncOf(ws) } catch (error) { say(error.message); return { code: 1, error: "invalid" } }
  if (id !== undefined && !WORKSPACE_ID.test(id)) return fail("invalid-id-option", { id })
  let workspaceId = id ?? current?.id
  const setting = {}
  if (method === "github") {
    const name = remote ?? current?.remote ?? "origin"
    const exists = git(ws, "remote", "get-url", name)
    if (create) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(create)) return fail("create-invalid", { repo: create })
      const made = createRepository(ws, create, say)
      if (made.code) return { code: made.code, error: "create" }
      if (exists.status === 0 && exists.stdout.trim() !== made.url) return fail("remote-differs", { remote: name, url: exists.stdout.trim() })
      if (exists.status !== 0) {
        const added = git(ws, "remote", "add", name, made.url)
        if (added.status !== 0) return fail("remote-failed", { remote: name, why: said(added) })
      }
    } else if (exists.status !== 0) return fail("remote-missing", { remote: name })
    else {
      // A remote that already exists is checked the way a made one is: the memo's notes must not sit in a public repository.
      const seen = visibilityOf(exists.stdout.trim())
      if (seen === "PUBLIC") return fail("repo-not-private", { repo: repoOf(exists.stdout.trim()) })
      if (seen === null) say(m["visibility-unchecked"])
    }
    const branch = currentBranch(ws)
    setting.github = { remote: name, ...(branch ? { branch } : {}) }
  } else {
    if (!folder) return fail("setup-usage")
    if (!isAbsolute(expand(folder))) return fail("drive-relative", { folder })
    const where = resolve(expand(folder))
    if (!existsSync(where)) return fail("drive-missing", { folder: where })
    if (machine !== undefined && !MACHINE.test(machine)) return fail("machine-invalid", { machine })
    // Git's own folder in Drive is what the bundle method exists to avoid, and a bundle among the notes would enter the memo.
    if (within(where, ws.root) || within(ws.root, where)) return fail("drive-nested", { root: ws.root, folder: where })
    if (/[\\/]CloudStorage[\\/]GoogleDrive-/i.test(safeReal(ws.root))) say(words(ws)["drive-cloud-warning"])
    try { if (workspaceId) ensureMachine(ws, join(where, workspaceId), machine ?? readState(ws).machine ?? machineFrom(hostname())) }
    catch (error) { say(error.message); return { code: 1, error: "machine-taken" } }
    if (!workspaceId) {
      const known = driveIds(where)
      if (known.length && !fresh) return fail("drive-has-workspaces", { folder: where, ids: known.join(", ") })
      workspaceId = randomBytes(4).toString("hex")
    }
    setting.drive = { folder }
  }
  // A folder with no history joining a memo must be made the way the memo was (language, graph folder), or the pages never match.
  if (method === "drive" && id) {
    const joined = joinMismatch(ws, join(resolve(expand(setting.drive.folder)), id))
    if (joined.none) return fail("join-no-bundle", { id, folder: resolve(expand(setting.drive.folder)) })
    if (joined.mismatch && !headOf(ws)) return fail("join-mismatch", joined.mismatch)
  }
  markFresh(ws)
  const value = { id: workspaceId ?? randomBytes(4).toString("hex"), ...setting, auto: auto || current?.auto === true }
  try { writeSyncSetting(ws, value) } catch (error) { say(error.message); return { code: 1, error: "setting" } }
  if (method === "drive") {
    // The branch of the memo is recorded here: the one a joined bundle holds, else this computer's own.
    let memoBranch = currentBranch(ws)
    if (id) {
      const joined = bundlesOf(join(resolve(expand(setting.drive.folder)), value.id), "").found[0]
      const heads = joined ? bundleHeads(ws, joined.path) : []
      if (heads.length) memoBranch = heads.find((head) => head.branch === memoBranch)?.branch ?? heads[0].branch
    }
    // A folder with no history that joins a memo waits for its first pull to take the history over; one that takes nothing must fail.
    writeState(ws, { folder: setting.drive.folder, ...(id && !headOf(ws) ? { joining: true } : {}), ...(memoBranch ? { branch: memoBranch } : {}), ...(machine ? { machine, named: true } : {}) })
    machineOf(ws)
  }
  const ruled = value.auto ? addSyncRule(ws) : false
  // The first computer's history must hold what a clone needs; the owner sees what is added.
  // Not on a folder with no commit: a folder that joins a memo takes the memo's history, and a root commit of its own would make it unrelated.
  const added = headOf(ws) ? commitWorkspaceFiles(ws, { modified: true }) : []
  if (added.length) say(format(m["files-added"], { files: added.join(", ") }))
  return { code: 0, setting: value, ruleAdded: ruled, added, machine: method === "drive" ? readState(ws).machine : undefined }
}
