// A node can name the folder where its work happens with a path line: the folder in backticks, its
// branch, and the names the owner gave the windows open on it.
//
//   `/Users/me/work/site` · `main` · windows: release prep, review
//
// `workspaces` keeps the branch current from git and takes window names from what an agent passes
// in (from a terminal or editor app the owner names them in). A folder that no longer exists is a
// question for the owner, never a reason to remove or finish anything, unless the `moved` setting
// says where it went. A folder the owner does not track in the memo is recorded in review.json.
//
// A folder several pieces of work happen in (a main checkout many tasks use) is shared: each node
// whose work happens there has its own path line, naming only the windows of that work, and the
// nodes sit below one parent. The app's name for each workspace follows the memo: the node that
// names its folder, or for a shared folder the nearest parent of the nodes that share it.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, posix } from "node:path"
import { prepare } from "./build.mjs"
import { authoredText, markdownStructure } from "./dialects/logseq.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { readDecisions, writeDecisions } from "./keeps.mjs"
import { format } from "./labels.mjs"
import { localPath } from "./sources.mjs"
import { pageOf, ROOT } from "./tree.mjs"

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const lineRule = (word) =>
  new RegExp(`^(?<lead>\\s*(?:- )?)\`(?<path>(?:/|~/)[^\`]+)\`(?: · \`(?<branch>[^\`]*)\`)?(?: · ${escape(word)}: (?<labels>.+?))?\\s*$`)
const trimSlash = (path) => path.length > 1 ? path.replace(/\/+$/, "") : path
/** Whether `path` is `folder` or inside it. */
export const within = (path, folder) => path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`)

/** The `moved` setting: folders renamed or moved since, as [old, new] absolute paths, longest old path first. */
export function movedFolders(ws) {
  const given = ws.moved ?? {}
  if (!given || typeof given !== "object" || Array.isArray(given)
    || Object.entries(given).some(([from, to]) => !from.trim() || typeof to !== "string" || !to.trim()))
    throw new Error(ws.labels.messages["moved-invalid"])
  return Object.entries(given).map(([from, to]) => [trimSlash(localPath(ws, from)), trimSlash(localPath(ws, to))])
    .sort((a, b) => b[0].length - a[0].length)
}
/**
 * Where a folder is now, following the moves (a folder may have moved more than once). Each move
 * applies once. A move into its own subfolder leaves a folder already inside that subfolder alone.
 */
export function movedPath(moves, path) {
  let at = path
  const used = new Set()
  const arrived = ([from, to]) => within(to, from) && within(at, to)
  for (;;) {
    const move = moves.find((move) => !used.has(move) && within(at, move[0]) && !arrived(move))
    if (!move) return at
    used.add(move)
    at = posix.join(move[1], at.slice(move[0].length))
  }
}

/** The folders the owner does not track in the memo (none while review.json cannot be read). */
export function untrackedFolders(ws) {
  try { return Object.keys(readDecisions(ws).untracked ?? {}) } catch { return [] }
}
/**
 * Records that the owner does not track these folders (`track: false`), or tracks them again: a
 * folder no node names is then no longer asked about. Returns the folders recorded.
 */
export function trackFolders(ws, folders, { track = false, now = new Date() } = {}) {
  if (!folders.length) throw new Error(format(ws.labels.messages["needs-args"], { command: `workspaces ${track ? "track" : "untrack"}`, args: "<folder>..." }))
  const record = readDecisions(ws)
  const untracked = { ...record.untracked }
  const paths = folders.map((folder) => trimSlash(localPath(ws, folder)))
  for (const path of paths) track ? delete untracked[path] : untracked[path] = { at: now.toISOString() }
  record.untracked = untracked
  if (!Object.keys(untracked).length) delete record.untracked
  writeDecisions(ws, record)
  return paths
}

/** The path lines of a node's text, by line index: outside code blocks and generated regions. */
function linesIn(ws, text) {
  const rule = lineRule(ws.labels.windows)
  const authored = authoredText(text, ws.labels.region)
  const { literalLines } = markdownStructure(authored)
  return authored.split("\n").flatMap((line, i) => {
    const hit = !literalLines.has(i) && line.match(rule)
    return hit ? [{ i, line, hit }] : []
  })
}

/**
 * The nearest node (its id, NFC) that is, or is above, every one of `nodes` (ids); ROOT when they
 * are in different top nodes.
 */
export function sharedParent(model, nodes) {
  // Ids come NFC from path lines, while the model keeps a file's own spelling (NFD after a phone sync).
  const chain = (id) => {
    const ids = []
    for (let at = model.find(id) ?? ROOT; at !== ROOT; at = model.parentOf(at)) ids.push(at.normalize("NFC"))
    return ids
  }
  const [first, ...rest] = nodes.map(chain)
  return first?.find((id) => rest.every((ids) => ids.includes(id))) ?? ROOT
}

/** Every path line in the nodes' own text, outside code blocks. */
export function pathLines(ws, { model = prepare(ws).model } = {}) {
  const found = []
  for (const doc of model.nodes) {
    for (const { i, line, hit } of linesIn(ws, doc.source.text)) {
      const { lead, path, branch, labels } = hit.groups
      found.push({ node: doc.id.normalize("NFC"), name: pageOf(doc.id), file: doc.sourcePath.normalize("NFC"), disk: doc.sourcePath, line: i + 1, text: line,
        lead, written: path, path: trimSlash(localPath(ws, path)), branch: branch ?? null, labels: labels ? labels.split(/,\s*/).filter(Boolean) : [] })
    }
  }
  return found
}

function readWorkspaces(ws, input) {
  let data = input
  for (let i = 0; i < 2 && typeof data === "string"; i++)
    try { data = JSON.parse(data) } catch (error) { throw new Error(format(ws.labels.messages["workspaces-input"], { error: error.message })) }
  const list = Array.isArray(data) ? data : data?.workspaces
  if (!Array.isArray(list) || list.some((item) => !item || typeof item.path !== "string" || !item.path.startsWith("/")
    || (item.labels !== undefined && (!Array.isArray(item.labels) || item.labels.some((label) => typeof label !== "string")))))
    throw new Error(format(ws.labels.messages["workspaces-input"], { error: "path" }))
  return new Map(list.map((item) => [trimSlash(item.path), { path: trimSlash(item.path), name: item.name, branch: item.branch,
    // A window name may not hold the separator of the line, so commas become middle dots.
    labels: item.labels?.map((label) => label.replace(/\s+/g, " ").replace(/,/g, " ·").trim()).filter(Boolean) }]))
}

const branchOf = (path) => {
  if (!existsSync(join(path, ".git"))) return undefined
  const result = spawnSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" })
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined
}

/** Path lines by the folder they name now (after the `moved` setting). */
function byFolder(lines, moves) {
  const folders = new Map()
  for (const line of lines) {
    const path = existsSync(line.path) ? line.path : movedPath(moves, line.path)
    folders.set(path, [...folders.get(path) ?? [], line])
  }
  return folders
}
const nodesOf = (lines) => [...new Set(lines.map((line) => line.node))]

/**
 * The name each passed-in workspace takes from the memo: the name of the node that names its folder;
 * for a folder several nodes share, the nearest node above them all (none when they are in different
 * top nodes); a node whose work has more than one folder of its own adds the folder's name. Only
 * workspaces some node names are listed: { path, name, expected, nodes, shared, status } with status
 * `ok`, `rename` or `unnamed`.
 */
export function workspaceNames(model, folders, given) {
  const own = new Map()
  for (const [path, lines] of folders) {
    const nodes = nodesOf(lines)
    if (nodes.length === 1 && given.has(path)) own.set(nodes[0], [...own.get(nodes[0]) ?? [], path])
  }
  const names = []
  for (const [path, item] of given) {
    const lines = folders.get(path)
    if (!lines) continue
    const nodes = nodesOf(lines)
    const shared = nodes.length > 1
    const owner = shared ? sharedParent(model, nodes) : nodes[0]
    const expected = owner === ROOT ? null : own.get(owner)?.length > 1 ? `${pageOf(owner)} · ${posix.basename(path)}` : pageOf(owner)
    const name = typeof item.name === "string" ? item.name.normalize("NFC") : null
    names.push({ path, name, expected, nodes: nodes.map(pageOf), shared, status: expected === null ? "unnamed" : name === expected ? "ok" : "rename" })
  }
  return names
}

/**
 * What `workspaces` would change: the edits per file, lines whose folder is gone, passed-in
 * workspaces that no node names, windows of a shared folder that no node's line names, and the name
 * each passed-in workspace takes from the memo. Nothing is written.
 */
export function planWorkspaces(ws, { input } = {}) {
  const given = input === undefined ? undefined : readWorkspaces(ws, input)
  const moves = movedFolders(ws)
  const { model } = prepare(ws)
  const lines = pathLines(ws, { model })
  const folders = byFolder(lines, moves)
  const plan = { lines: lines.length, edits: [], gone: [], unplaced: [], untracked: [], unassigned: [], names: [] }
  for (const line of lines) {
    let { path, written } = line
    if (!existsSync(path)) {
      // A folder the owner moved (the `moved` setting) is written where it is now.
      const now = movedPath(moves, path)
      if (now === path || !existsSync(now)) { plan.gone.push({ node: line.name, file: line.file, line: line.line, path: line.written }); continue }
      const home = homedir()
      path = now
      written = written.startsWith("~/") && now.startsWith(`${home}/`) ? `~/${now.slice(home.length + 1)}` : now
    }
    const from = given?.get(path)
    // Git knows the branch best; an app's export only fills in for a folder git cannot answer for.
    const branch = branchOf(path) || from?.branch || line.branch
    // A line on a shared folder keeps the windows of its own work that are still open.
    const shared = nodesOf(folders.get(path) ?? []).length > 1
    const labels = !from?.labels ? line.labels : shared ? line.labels.filter((label) => from.labels.includes(label)) : from.labels
    const text = `${line.lead}\`${written}\`${branch ? ` · \`${branch}\`` : ""}${labels.length ? ` · ${ws.labels.windows}: ${labels.join(", ")}` : ""}`
    if (text !== line.text) plan.edits.push({ disk: line.disk, file: line.file, node: line.name, line: line.line, before: line.text, text })
  }
  const untracked = untrackedFolders(ws)
  for (const [path, item] of given ?? []) {
    const named = folders.get(path)
    if (named) {
      // Windows open on a shared folder that no node's line names: which work they belong to is the owner's call.
      const placed = new Set(named.flatMap((line) => line.labels))
      const loose = nodesOf(named).length > 1 ? (item.labels ?? []).filter((label) => !placed.has(label)) : []
      if (loose.length) plan.unassigned.push({ path, labels: loose, nodes: nodesOf(named).map(pageOf) })
      continue
    }
    if (untracked.some((folder) => within(path, folder))) plan.untracked.push(item)
    else plan.unplaced.push(item)
  }
  if (given) plan.names = workspaceNames(model, folders, given)
  return plan
}

/**
 * Writes planned edits. A file may have changed since it was read (a phone sync): each line is found
 * again by its text, and left alone when it is gone or no longer unique.
 */
export function applyWorkspaces(ws, edits, { dryRun = false } = {}) {
  const updated = []
  const conflicts = []
  const byFile = new Map()
  for (const edit of edits) byFile.set(edit.disk, [...byFile.get(edit.disk) ?? [], edit])
  for (const [disk, changes] of byFile) {
    const path = existingPath(join(ws.graphDir, disk))
    const raw = readFileSync(path, "utf8")
    const text = raw.split("\n")
    // Only a path line counts: the same text moved into a code example since is left alone.
    const spots = new Set(linesIn(ws, raw).map((spot) => spot.i))
    let changed = false
    for (const change of changes) {
      let at = change.line - 1
      if (text[at] !== change.before || !spots.has(at)) {
        const hits = text.flatMap((line, i) => line === change.before && spots.has(i) ? [i] : [])
        at = hits.length === 1 ? hits[0] : -1
      }
      if (at < 0) { conflicts.push({ node: change.node, file: change.file, line: change.line, text: change.before.trim() }); continue }
      text[at] = change.text
      changed = true
      updated.push({ node: change.node, file: change.file, line: at + 1, text: change.text.trim() })
    }
    if (changed && !dryRun) writeAtomic(path, text.join("\n"))
  }
  return { updated, conflicts }
}

/**
 * Brings path lines up to date: branches from git, window names from `input` (a list of
 * `{ path, branch?, labels?, name? }`, or `{ workspaces: [...] }`, or that as JSON text). Lines whose
 * folder is gone, passed-in workspaces that no node names and windows of a shared folder that no
 * line names are reported, with the name each workspace takes from the memo (`names`; the app
 * renames it, never the engine). `dryRun` writes nothing.
 */
export function workspaces(ws, { input, dryRun = false } = {}) {
  const plan = planWorkspaces(ws, { input })
  return { dryRun, lines: plan.lines, gone: plan.gone, unplaced: plan.unplaced, untracked: plan.untracked, unassigned: plan.unassigned,
    names: plan.names, ...applyWorkspaces(ws, plan.edits, { dryRun }) }
}

/** Path lines whose folder no longer exists, and did not move to one that does: review asks about them. */
export function workspaceFollowUps(ws, model) {
  let moves = []
  try { moves = movedFolders(ws) } catch {}
  return pathLines(ws, { model }).filter((line) => !existsSync(line.path) && !existsSync(movedPath(moves, line.path)))
}
