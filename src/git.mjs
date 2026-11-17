// Commits scoped to the graph folder, so a memo can live inside a larger repository
// without picking up anything else. Commit your own edits (snapshot) before an
// agent tidies up, and the agent's changes can be reverted on their own.
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { format } from "./labels.mjs"
import { conversationsOf, copiedPassages, jsonValues, requestRows } from "./requests.mjs"
import { CONFIG_FILE } from "./workspace.mjs"

// Paths come back as written: git quotes and escapes a name outside ASCII (a Korean page) otherwise,
// and such a file would be missed when a commit is checked for copied request text.
function git(dir, ...args) {
  return spawnSync("git", ["-C", dir, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

const indexLock = (ws) => git(ws.root, "rev-parse", "--path-format=absolute", "--git-path", "index.lock").stdout.trim()
const lockedError = (ws, lock) => new Error(format(ws.labels.messages["git-locked"], { lock }))
function gitError(ws, result) {
  const text = result.stderr.trim() || result.stdout.trim()
  if (/index\.lock[^\n]*File exists|Another git process seems to be running/i.test(text)) {
    const lock = text.match(/['"]([^'"\n]*index\.lock)['"]/)?.[1] ?? indexLock(ws)
    return lockedError(ws, lock)
  }
  return new Error(text)
}

/**
 * The files someone else is changing while a scheduled run works, from `EXCUDO_HOLD` (one path a line,
 * from the workspace folder or absolute), as paths from the workspace folder. A run that finds another
 * session's edit in progress names it here instead of waiting: commits leave these files out, so the
 * run records them as they were before that edit, and the edit stays in place for its own commit.
 */
export function heldFiles(ws, env = process.env) {
  const files = String(env.EXCUDO_HOLD ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
    .map((file) => relative(ws.root, resolve(ws.root, file)).split("\\").join("/").normalize("NFC"))
  return [...new Set(files.filter((file) => file && !file.startsWith("..")))]
}

/** Pathspecs that keep the held files out of a git command. */
export const holdSpecs = (held) => held.map((file) => `:(exclude,literal)${file}`)

/** Whether `path` (from the workspace folder) is held or lies inside a held folder. */
const isHeld = (held, path) => {
  const file = path.split("\\").join("/").normalize("NFC")
  return held.some((one) => file === one || file.startsWith(`${one}/`))
}

/** Whether `path` (absolute, or from the workspace folder) is held: a run must not write it. */
export function heldPath(ws, path, held = heldFiles(ws)) {
  if (!held.length) return false
  return isHeld(held, relative(ws.root, resolve(ws.root, path)))
}

/** Whether `path` is held, or is a folder holding a held file. */
export function heldWithin(ws, path, held = heldFiles(ws)) {
  if (!held.length) return false
  const rel = relative(ws.root, resolve(ws.root, path)).split("\\").join("/").normalize("NFC")
  return isHeld(held, rel) || held.some((one) => one.startsWith(`${rel}/`))
}

export function inRepository(dir) {
  const result = git(dir, "rev-parse", "--is-inside-work-tree")
  return result.status === 0 && result.stdout.trim() === "true"
}

// The tree of a repository without commits, to compare a first commit with.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * What a commit of `paths` would add: new files whole, changed files by their added lines, and a JSON
 * file by the string values it did not have before (JSON escapes line breaks, so its lines would hide
 * a copied text).
 */
function addedText(ws, paths) {
  const base = git(ws.root, "rev-parse", "--verify", "--quiet", "HEAD").status === 0 ? "HEAD" : EMPTY_TREE
  const lines = (text) => text.split("\n")
  const changed = lines(git(ws.root, "diff", "--relative", "--name-only", "--no-renames", base, "--", ...paths).stdout).filter(Boolean)
  const untracked = lines(git(ws.root, "ls-files", "--others", "--exclude-standard", "--", ...paths).stdout).filter(Boolean)
  const items = []
  for (const rel of [...changed, ...untracked]) {
    if (!existsSync(join(ws.root, rel))) continue
    const bytes = readFileSync(join(ws.root, rel))
    if (bytes.includes(0)) continue
    const now = bytes.toString("utf8")
    const before = untracked.includes(rel) ? undefined : git(ws.root, "show", `${base}:./${rel}`)
    const values = rel.endsWith(".json") ? jsonValues(now) : undefined
    if (values !== undefined) {
      // Whole values are compared, so one new value made of lines the file already had still counts.
      const had = new Set(before?.status === 0 ? jsonValues(before.stdout) ?? [] : [])
      items.push({ file: `${rel} (strings)`, text: values.filter((value) => !had.has(value)).join("\n") })
    } else if (before?.status === 0) {
      const added = lines(git(ws.root, "diff", "--relative", "--unified=0", "--no-color", "--no-ext-diff", base, "--", rel).stdout)
        .filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).map((line) => line.slice(1))
      items.push({ file: rel, text: added.join("\n") })
    } else items.push({ file: rel, text: now })
  }
  return items.filter((item) => item.text)
}

/** The names of the skills the workspace has learned (skills.json), whatever their state. */
function learnedNames(ws) {
  try { return Object.keys(JSON.parse(readFileSync(join(ws.root, "skills.json"), "utf8")).skills ?? {}).filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) } catch { return [] }
}

/** The graph files with changes not committed yet, as absolute paths. */
export function changedGraphFiles(ws) {
  if (!inRepository(ws.graphDir)) return []
  // The paths are relative to the top of the repository, which may hold the workspace in a folder;
  // they are given back as the workspace spells its own path (not through the links git resolves).
  const prefix = git(ws.root, "rev-parse", "--show-prefix").stdout.trim()
  const out = git(ws.root, "status", "--porcelain", "-z", "--untracked-files=all", "--", relative(ws.root, ws.graphDir) || ".").stdout
  return out.split("\0").filter((entry) => /^.. ./.test(entry)).map((entry) => resolve(ws.root, relative(prefix || ".", entry.slice(3))))
}

/** Resolve every selected graph file before a save can write or commit anything. */
export function onlyGraphPaths(ws, only) {
  // Editors and git may spell the same folder through different links (such as the system temp folder).
  const canonical = (path) => {
    let parent = path
    while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
    return resolve(realpathSync(parent), relative(parent, path))
  }
  const graph = canonical(ws.graphDir)
  return only.map((file) => {
    const paths = [...new Set([resolve(ws.root, file), resolve(ws.graphDir, file)])]
    const found = paths.find((path) => {
      const rel = relative(graph, canonical(path))
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
      try { return !lstatSync(path).isDirectory() } catch {}
      // A tracked deletion is still a graph file that can be saved.
      return git(ws.graphDir, "ls-files", "--", rel).stdout.split("\n").includes(rel.split("\\").join("/"))
    })
    if (!found) throw new Error(format(ws.labels.messages["only-unknown"], { path: file }))
    return resolve(ws.graphDir, relative(graph, canonical(found)))
  })
}

/**
 * Commits every change under the graph folder. Returns "committed", "clean" or "not-git". With `only`
 * (files, relative to the workspace or graph, or absolute), it commits those files alone: a scheduled run leaves
 * what someone writes meanwhile elsewhere in the memo for that person's own commit. The held files
 * (`EXCUDO_HOLD`) are never committed, wherever they are.
 */
export function commitGraph(ws, message, { includeReview = false, only } = {}) {
  const selected = only && onlyGraphPaths(ws, only)
  if (!inRepository(ws.graphDir)) return "not-git"
  const held = heldFiles(ws)
  const paths = selected ? [...new Set(selected.map((file) => relative(ws.root, file)))].filter((file) => !isHeld(held, file)) : [relative(ws.root, ws.graphDir) || "."]
  if (!paths.length) return "clean"
  // Review decisions, what the sources have delivered, the reflection candidates, the learned skills
  // (their record and sources) and the settings travel with the graph, so they match after a revert:
  // a batch that sends a source to a new node changes the settings and the graph together.
  const skills = ws.skills?.dir ?? "skills"
  // A learned skill installed for this workspace is reached through links next to the engine's
  // skills; they come and go with its record (a link may point nowhere for a moment, hence lstat).
  const there = (file) => { try { lstatSync(join(ws.root, file)); return true } catch { return false } }
  const links = learnedNames(ws).flatMap((name) => [".agents", ".claude"].map((tool) => `${tool}/skills/${name}`))
  if (includeReview && !only) for (const file of ["review.json", "sources.json", "reflect.json", "skills.json", skills, CONFIG_FILE, ...links])
    if ((there(file) || git(ws.root, "ls-files", "--error-unmatch", file).status === 0) && !isHeld(held, file)) paths.push(file)
  const keep = holdSpecs(held)
  const status = git(ws.root, "status", "--porcelain", "--", ...paths, ...keep)
  if (!status.stdout.trim()) return "clean"
  // What agents write from the owner's requests must be in their own words before it reaches git:
  // the reflection record and the learned skills. The graph is not compared, since a capture keeps
  // the owner's words on purpose.
  const guarded = paths.filter((path) => ["reflect.json", "skills.json", skills].includes(path))
  const added = guarded.length && conversationsOf(ws) ? addedText(ws, [...guarded, ...keep]) : []
  // The logs are read first, so a request typed a moment ago counts; a failure to read them stops the commit.
  if (added.length) requestRows(ws, { refresh: true })
  const copied = added.length ? copiedPassages(ws, added) : null
  if (copied?.length) throw new Error(format(ws.labels.messages["commit-copied"], { passages: copied.slice(0, 5).map((item) => `${item.file}: “${item.passage}”`).join("; ") }))
  const add = git(ws.root, "add", "-A", "--", ...paths, ...keep)
  if (add.status !== 0) throw gitError(ws, add)
  // A folder that held only held files is unknown to git now, and a pathspec git does not know stops
  // the commit; a path in the index or in the last commit (a deletion) stays.
  const known = held.length ? paths.filter((path) => git(ws.root, "ls-files", "--error-unmatch", "--", path).status === 0
    || git(ws.root, "ls-tree", "-r", "--name-only", "HEAD", "--", path).stdout.trim()) : paths
  if (!known.length) return "clean"
  const commit = git(ws.root, "commit", "-q", "-m", message, "--", ...known, ...keep)
  if (commit.status !== 0) throw gitError(ws, commit)
  return "committed"
}

/**
 * Commits the given contents of graph files (`{ file, content }`, file from the graph folder, content a
 * Buffer, or null for a file to delete) as they are given, not as they are on disk now: what a check
 * passed is what gets committed, and a later edit stays in the work tree for its own commit. It builds
 * the commit in a separate index from the last commit, so nothing else staged joins it, and then
 * points the working index at the committed files. Returns "committed", "clean" or "not-git".
 */
export function commitContents(ws, message, entries) {
  if (!inRepository(ws.graphDir)) return "not-git"
  if (!entries.length) return "clean"
  // This command uses a separate index, but must update the working index after committing.
  const lock = indexLock(ws)
  if (existsSync(lock)) throw lockedError(ws, lock)
  const top = realpathSync(git(ws.graphDir, "rev-parse", "--show-toplevel").stdout.trim())
  const graph = realpathSync(ws.graphDir)
  const folder = mkdtempSync(join(tmpdir(), "excudo-index-"))
  const env = { ...process.env, GIT_INDEX_FILE: join(folder, "index") }
  const run = (args, input) => spawnSync("git", ["-C", top, "-c", "core.quotePath=false", ...args], { env, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const paths = entries.map((entry) => relative(top, join(graph, entry.file)).split("\\").join("/"))
  try {
    const must = (result) => { if (result.status !== 0) throw gitError(ws, result); return result }
    must(run(["read-tree", "HEAD"]))
    entries.forEach((entry, i) => {
      if (entry.content === null) must(run(["update-index", "--force-remove", "--", paths[i]]))
      else {
        const sha = must(run(["hash-object", "-w", "--stdin"], entry.content)).stdout.trim()
        must(run(["update-index", "--add", "--cacheinfo", `100644,${sha},${paths[i]}`]))
      }
    })
    if (run(["diff", "--cached", "--quiet", "HEAD"]).status === 0) return "clean"
    must(run(["commit", "-q", "-m", message]))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
  const reset = git(top, "reset", "-q", "--", ...paths)
  if (reset.status !== 0) throw gitError(ws, reset)
  return "committed"
}
