// Outside sources (an issue tracker, a team board, mentions) reach the memo through a browser that
// the agent drives with the owner's login. The agent collects items with the source's script or by
// reading the page; the engine checks, places and remembers them and never goes online itself.
// Watched sources (`repo`, `page`) feed a knowledge node instead, and a `note` source is a note the
// owner keeps in another app, followed between marker lines; changes.mjs tells when they changed.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { prepare } from "./build.mjs"
import { knowledgeOf, walkGraph } from "./check.mjs"
import { authoredEnd, authoredText, blocksOf, markdownStructure, MARKER, OPEN } from "./dialects/logseq.mjs"
import { existingPath, withLock, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { heldFiles, heldPath } from "./git.mjs"
import { NOTE_MARKER, noteRegion } from "./notes.mjs"

/** What the engine remembers per source, next to review.json, so a removed item is not added again. */
export const SOURCE_STATE = "sources.json"
const NAME = /^[a-z0-9][a-z0-9_-]*$/
const WEB = /^https?:\/\/\S+$/
// A link ends at whitespace, quotes or the bracket that closes a Markdown link; balanced parentheses,
// however deep, stay in it.
const SCHEME = /https?:\/\//g
const LINK_STOP = /[\s()<>[\]"'`]/
const GROUP_STOP = /[\s<>]/
// An item not seen at its source for this long shrinks once no open task needs it.
const FORGET_DAYS = 180
const DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*<?(https?:\/\/[^\s>]+)>?/
const REFERENCE = /\[([^\]]*)\](?:\[([^\]]*)\])?/g
const OPEN_MARKER = /^(?:TODO|DOING|NOW|LATER|WAITING)$/
/**
 * items: work to bring into the memo; repo: a local repository or folder; page: a web page read in a
 * browser; note: a note the owner keeps in another app, followed between marker lines.
 */
export const SOURCE_KINDS = ["items", "repo", "page", "note"]
/** What happens to a block the owner removed from a followed note: ask about it, or settle it as finished or dropped. */
export const NOTE_REMOVED = ["ask", "settle"]
/** What happens to an open task whose outside items are all finished: ask about it, or settle it as done. */
export const ITEM_FINISHED = ["ask", "settle"]
/** A configured path: `~` is the home folder, a relative path starts at the workspace. */
export const localPath = (ws, path) => resolve(ws.root, path.replace(/^~(?=\/|$)/, homedir()))
const normalUrl = (url) => url.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "")
/** Every link an item has had; its memo line may still carry an older one. */
const urlsOf = (item) => item.urls ?? [item.url]
/** A link's host and path with every part that holds a number made general: the shape a source's items share. */
const shapeOf = (url) => {
  try {
    const { host, pathname } = new URL(url)
    return `${host}${pathname.replace(/\/+$/, "").split("/").map((part) => (/\d/.test(part) ? "*" : part)).join("/")}`
  } catch { return null }
}

/** Source text of a script given as a function; a method (`async script() {}`) becomes a function expression. */
function code(value) {
  if (typeof value !== "function") return value
  const text = String(value)
  return /^(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/.test(text) ? text : text.replace(/^(async\s+)?/, (prefix) => `${prefix}function `)
}
const compiles = (script) => { try { new Function(`return (${script})`); return true } catch { return false } }

/** The configured sources, checked, with defaults filled in. Scripts written as functions become source text. */
export function sourcesOf(ws) {
  const m = ws.labels.messages
  const list = ws.sources ?? []
  if (!Array.isArray(list)) throw new Error(m["sources-not-list"])
  const names = new Set()
  return list.map((given, index) => {
    const bad = (field) => { throw new Error(format(m["source-invalid"], { index, field })) }
    if (!given || typeof given !== "object") bad("source")
    const source = { ...given, script: code(given.script) }
    if (typeof source.name !== "string" || !NAME.test(source.name)) bad("name")
    if (names.has(source.name)) throw new Error(format(m["source-duplicate"], { name: source.name }))
    names.add(source.name)
    const kind = source.kind ?? "items"
    if (!SOURCE_KINDS.includes(kind)) bad("kind")
    if (kind === "repo") {
      if (typeof source.path !== "string" || !source.path.trim()) bad("path")
      if (source.url !== undefined && (typeof source.url !== "string" || !WEB.test(source.url))) bad("url")
    } else if (typeof source.url !== "string" || !WEB.test(source.url)) bad("url")
    if (source.aliases !== undefined && (!Array.isArray(source.aliases) || source.aliases.some((alias) => typeof alias !== "string"))) bad("aliases")
    if (source.enabled !== undefined && typeof source.enabled !== "boolean") bad("enabled")
    for (const field of ["label", "collect", "notes", "script", "node", "marker", "key"])
      if (source[field] !== undefined && typeof source[field] !== "string") bad(field)
    if (source.script !== undefined && !compiles(source.script)) bad("script")
    if (source.marker && !OPEN_MARKER.test(source.marker)) bad("marker")
    if (source.key !== undefined) try { new RegExp(source.key) } catch { bad("key") }
    if (kind === "note") {
      if (source.between !== undefined && (typeof source.between !== "string" || !source.between.trim() || /\n/.test(source.between))) bad("between")
      if (source.removed !== undefined && !NOTE_REMOVED.includes(source.removed)) bad("removed")
    }
    if (kind === "items" && source.finished !== undefined && !ITEM_FINISHED.includes(source.finished)) bad("finished")
    if (source.complete !== undefined && typeof source.complete !== "boolean") bad("complete")
    if (source.watch !== undefined && !["all", "commits"].includes(source.watch)) bad("watch")
    if (source.actions !== undefined && (!source.actions || typeof source.actions !== "object" || Array.isArray(source.actions))) bad("actions")
    const actions = Object.fromEntries(Object.entries(source.actions ?? {}).map(([name, action]) => {
      if (!action || !["string", "function"].includes(typeof action.script) || !compiles(code(action.script))) bad(`actions.${name}`)
      return [name, { ...action, script: code(action.script) }]
    }))
    const paths = kind === "repo" ? { path: localPath(ws, source.path), aliases: (source.aliases ?? []).map((alias) => localPath(ws, alias)) } : {}
    const note = kind === "note" ? { between: (source.between ?? NOTE_MARKER).trim(), removed: source.removed ?? "ask" } : {}
    const finished = kind === "items" ? { finished: source.finished ?? "ask" } : {}
    return { label: source.name, marker: "TODO", complete: false, enabled: true, ...source, kind, ...paths, ...note, ...finished, actions }
  })
}

export function sourceNamed(ws, name) {
  const all = sourcesOf(ws)
  const source = all.find((item) => item.name === name)
  if (!source) throw new Error(format(ws.labels.messages["source-unknown"], { name, names: all.map((item) => item.name).join(", ") || "-" }))
  return source
}

export function readSourceState(ws) {
  const path = join(ws.root, SOURCE_STATE)
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
}

/** Text outside code and HTML, with the same line breaks: a link shown as code is no link. */
function prose(text) {
  const ranges = markdownStructure(text).literalRanges
  if (!ranges.length) return text
  // The ranges are UTF-16 offsets, so blank by code unit.
  const units = text.split("")
  for (const [start, end] of ranges) for (let i = start; i < end; i++) if (units[i] !== "\n") units[i] = " "
  return units.join("")
}
/** The index after the balanced `(…)` that opens at `at`, or -1 when it does not close. */
function groupEnd(line, at) {
  let depth = 0
  for (let i = at; i < line.length; i++) {
    if (GROUP_STOP.test(line[i])) return -1
    if (line[i] === "(") depth++
    else if (line[i] === ")" && --depth === 0) return i + 1
  }
  return -1
}
/** The links written out in a line. */
export function urlsIn(line) {
  const found = []
  let end = 0
  for (const match of line.matchAll(SCHEME)) {
    if (match.index < end) continue
    let i = match.index + match[0].length
    while (i < line.length) {
      if (line[i] === "(") { const after = groupEnd(line, i); if (after < 0) break; i = after }
      else if (LINK_STOP.test(line[i])) break
      else i++
    }
    if (i > match.index + match[0].length) found.push(line.slice(match.index, i))
    end = i
  }
  return found
}
/** Links in some lines of a page: written out, or through a reference definition elsewhere on the page. */
function linksIn(lines, definitions) {
  const found = []
  for (const line of lines) {
    for (const url of urlsIn(line)) found.push(url)
    for (const [, text, label] of line.matchAll(REFERENCE)) {
      const url = definitions.get((label || text).trim().toLowerCase())
      if (url) found.push(url)
    }
  }
  return found
}
const definitionsOf = (lines) => new Map(lines.flatMap((line) => {
  const hit = line.match(DEFINITION)
  return hit ? [[hit[1].trim().toLowerCase(), hit[2]]] : []
}))

/** Every page's text, by graph-relative path. */
const pageTexts = (ws) => new Map(walkGraph(ws).pages.map((page) => [page.rel, { page, text: readFileSync(page.path, "utf8") }]))

/**
 * Open tasks by the links in their own text (the task line and its continuation lines): where the
 * memo still waits on an outside item. Code is no task, so an example in a code block does not count.
 */
function openLinks(texts) {
  const links = new Map()
  for (const [rel, { text }] of texts) {
    const lines = text.split("\n")
    const plain = prose(text).split("\n")
    const definitions = definitionsOf(plain)
    const { items } = markdownStructure(text)
    for (const item of items) {
      if (!OPEN.test(item.text)) continue
      const own = [...new Set([item.start, ...item.ownLines])].sort((a, b) => a - b)
      // content: the task's own text, so a changed continuation line is a changed question.
      const place = { path: rel, line: item.start + 1, text: lines[item.start].trim(), content: own.map((i) => lines[i].trim()).join("\n") }
      const found = new Set(linksIn(own.map((i) => plain[i]), definitions).map(normalUrl))
      for (const url of found) {
        if (!links.has(url)) links.set(url, [])
        links.get(url).push(place)
      }
    }
  }
  return links
}
const placesOf = (open, urls) => [...new Map(urls.flatMap((url) => open.get(normalUrl(url)) ?? []).map((place) => [`${place.path}:${place.line}`, place])).values()]

/** The sources with what the engine knows of each: last collection, tracked items and those still open in the memo. */
export function listSources(ws) {
  const state = readSourceState(ws)
  const open = openLinks(pageTexts(ws))
  return sourcesOf(ws).map(({ script, actions, ...source }) => {
    if (source.kind !== "items") return { ...source, script: Boolean(script), actions: Object.keys(actions), markedAt: state[source.name]?.watch?.markedAt ?? null }
    const items = Object.values(state[source.name]?.items ?? {})
    return { ...source, script: Boolean(script), actions: Object.keys(actions), fetchedAt: state[source.name]?.fetchedAt ?? null,
      tracked: items.length, open: items.filter((item) => placesOf(open, urlsOf(item)).length).length, ignored: items.filter((item) => item.ignored).length }
  })
}

/**
 * The JavaScript to evaluate in the source's page: its collecting script called with
 * `{ since, url }` (since: the last collection, or null), or one of its actions called with `args`.
 */
export function sourceScript(ws, name, { action, args } = {}) {
  const m = ws.labels.messages
  const source = sourceNamed(ws, name)
  if (source.kind === "repo") throw new Error(format(m["source-no-script"], { name }))
  if (action) {
    const chosen = source.actions[action]
    if (!chosen) throw new Error(format(m["source-action-unknown"], { name, action, actions: Object.keys(source.actions).join(", ") || "-" }))
    let values = {}
    if (args !== undefined) try { values = typeof args === "string" ? JSON.parse(args) : args } catch (error) { throw new Error(format(m["source-args"], { error: error.message })) }
    return `(${chosen.script})(${JSON.stringify(values)})`
  }
  if (!source.script) throw new Error(format(m["source-no-script"], { name }))
  const record = readSourceState(ws)[name]
  const given = JSON.stringify({ since: record?.fetchedAt ?? record?.watch?.markedAt ?? null, url: source.url })
  // A note's script reads the whole note; only the part between the markers, without private lines, leaves the page.
  if (source.kind === "note") return `(async (args) => JSON.stringify((${noteRegion})(await (${source.script})(args), ${JSON.stringify(source.between)})))(${given})`
  return `(${source.script})(${given})`
}

function readItems(ws, name, input) {
  const m = ws.labels.messages
  let data = input
  // A browser tool may hand back the script's JSON as a string, sometimes encoded twice.
  for (let i = 0; i < 2 && typeof data === "string"; i++)
    try { data = JSON.parse(data) } catch (error) { throw new Error(format(m["source-input"], { error: error.message })) }
  const list = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(list)) throw new Error(format(m["source-input"], { error: typeof data }))
  const ids = new Set()
  return list.flatMap((raw, index) => {
    const bad = (field) => { throw new Error(format(m["source-item-invalid"], { name, index, field })) }
    if (!raw || typeof raw !== "object") bad("item")
    const id = raw.id === undefined || raw.id === null ? "" : String(raw.id).trim()
    if (!id) bad("id")
    if (typeof raw.url !== "string" || !WEB.test(raw.url)) bad("url")
    const title = String(raw.title ?? "").replace(/\s+/g, " ").trim().replace(MARKER, "").replace(/\[\[/g, "[ [").trim()
    if (!title) bad("title")
    if (raw.marker !== undefined && raw.marker !== "" && !OPEN_MARKER.test(String(raw.marker))) bad("marker")
    if (raw.node !== undefined && typeof raw.node !== "string") bad("node")
    if (raw.covers !== undefined && (!Array.isArray(raw.covers) || raw.covers.some((url) => typeof url !== "string" || !WEB.test(url)))) bad("covers")
    // The same item listed twice (for example in two columns) counts once.
    if (ids.has(id)) return []
    ids.add(id)
    return [{ id, url: raw.url, title, done: Boolean(raw.done), state: raw.state === undefined ? undefined : String(raw.state),
      marker: raw.marker === undefined ? undefined : String(raw.marker), node: raw.node, skip: Boolean(raw.skip),
      covers: raw.covers?.length ? [...new Set(raw.covers.map(normalUrl))] : undefined }]
  })
}

/** Journal file name for a day, following the graph's `:journal/file-name-format` (default yyyy_MM_dd). */
export function journalName(ws, day) {
  const config = join(ws.graphDir, "logseq", "config.edn")
  const pattern = (existsSync(config) && readFileSync(config, "utf8").match(/:journal\/file-name-format\s+"([^"]+)"/)?.[1]) || "yyyy_MM_dd"
  const pad = (n) => String(n).padStart(2, "0")
  const parts = { yyyy: day.getFullYear(), yy: pad(day.getFullYear() % 100), MM: pad(day.getMonth() + 1), M: day.getMonth() + 1, dd: pad(day.getDate()), d: day.getDate() }
  return pattern.replace(/yyyy|yy|MM|M|dd|d/g, (token) => parts[token])
}

/** Where a new item goes: the node the agent chose, the node that already names its key, the source's node, or today's journal. */
function placeOf(ws, source, item, model, isKnowledge) {
  const m = ws.labels.messages
  const node = (name) => {
    const id = model.find(name)
    if (!id) throw new Error(format(m["source-node-missing"], { name: source.name, node: name }))
    return id
  }
  if (item.node) return { node: node(item.node), reason: "chosen" }
  if (source.key && new RegExp(`^(?:${source.key})$`).test(item.id)) {
    const escaped = item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const word = new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, "u")
    // A knowledge node names a key only as a reference (a source path, a decision's history); the
    // work itself lives in the owner's nodes, so knowledge nodes never receive items.
    const hits = model.nodes.filter((doc) => !isKnowledge(doc.id) && word.test(authoredText(doc.source.text, ws.labels.region)))
    // The deepest node that names the key is the most specific place for it.
    const best = hits.sort((a, b) => b.id.split("/").length - a.id.split("/").length)[0]
    if (best) return { node: best.id, reason: "key" }
  }
  if (source.node) return { node: node(source.node), reason: "source" }
  return { journal: true, reason: "journal" }
}

/**
 * Inserts lines into a node's lead, the text above its first section heading: after the lead's last
 * top-level task, or after its last text. Sections (`## …`) hold material the owner sorted by topic,
 * such as references or one theme's tasks, so new outside work waits in the lead until placed.
 */
function insertIntoNode(ws, path, added) {
  const lines = readFileSync(path, "utf8").split("\n")
  const authored = authoredEnd(lines, ws)
  const section = markdownStructure(lines.join("\n")).headings.find((heading) => heading.line > 0 && heading.depth > 1 && heading.line < authored)
  const end = section ? section.line : authored
  const tasks = blocksOf(lines, 0, end).filter((block) => !block.parent && MARKER.test(block.text))
  let at = tasks.length ? tasks.at(-1).end : end
  if (!tasks.length) while (at > 0 && !lines[at - 1].trim()) at--
  // A list starts one blank line below a paragraph, and right below a heading or another list item.
  const previous = lines[at - 1] ?? ""
  const gap = !tasks.length && previous.trim() && !/^(?:\s*-\s|\s|#)/.test(previous) ? [""] : []
  const after = lines.slice(at)
  // Keep the blank line that a following heading needs above it.
  const spacer = after.length && after[0].trim() && /^#/.test(after[0]) ? [""] : []
  writeAtomic(path, [...lines.slice(0, at), ...gap, ...added, ...spacer, ...after].join("\n"))
}

export function appendToJournal(path, added) {
  const text = existsSync(path) ? readFileSync(path, "utf8").replace(/\s+$/, "") : ""
  mkdirSync(dirname(path), { recursive: true })
  writeAtomic(path, `${text ? `${text}\n` : ""}${added.join("\n")}\n`)
}

/**
 * Open tasks whose outside items are all finished, closed as DONE. A source settles them only when
 * the owner set `finished: "settle"` on it: the owner takes a finished item at that source for their
 * own mark. A link on a task counts when a tracked item has it, or covers it (a request an issue
 * stands for); a link to a part of a page (`#…`) speaks for that part, so the same page linked plainly
 * on that line is only its context. Every item a link meets must be finished and come from a
 * settling source: an open one, or one from a source the owner settles by hand, keeps the task open.
 * Items of a source that brings plain notes rather than tasks (an empty `marker`) are not work and
 * take no part.
 * A waiting task, and a task with an open task below it, stay open; a parent closes once its last
 * child has. Returns what was (or, with `dryRun`, would be) closed: page, line and the line's text.
 */
function settleFinished(ws, state, texts, { dryRun = false } = {}) {
  // A source that brings plain notes (an empty marker, such as mentions) tells nothing about whether work is finished.
  const sources = sourcesOf(ws).filter((source) => source.kind === "items" && source.marker !== "")
  const settles = new Set(sources.filter((source) => source.finished === "settle").map((source) => source.name))
  if (!settles.size) return []
  const known = new Set(sources.map((source) => source.name))
  const meets = new Map()
  // A link no item has can still be one of a source's items that the source has not collected (work
  // someone else holds, or one from before the source's first collection). It keeps the task open when
  // it has the shape of that source's links (host and path, numbers aside) or carries the source's
  // `key` on the source's host. Any other link (a guide, a reference page) takes no part. Only an item
  // the owner set aside (`skip`) frees its link; a source of plain notes (mentions) seeing a link says
  // nothing about whether that work is finished.
  const seen = new Set()
  const shapes = new Set()
  const keyed = sources.filter((source) => source.key && source.url).flatMap((source) => {
    try { return [{ host: new URL(source.url).host, key: new RegExp(`(?:^|[^A-Za-z0-9])(?:${source.key})(?![A-Za-z0-9])`) }] } catch { return [] }
  })
  for (const [name, record] of Object.entries(state)) {
    if (!known.has(name)) continue
    for (const item of Object.values(record.items ?? {})) {
      for (const url of urlsOf(item)) {
        if (item.ignored) seen.add(normalUrl(url))
        shapes.add(shapeOf(url))
      }
    }
    for (const item of Object.values(record.items ?? {})) {
      if (item.ignored) continue
      const entry = { done: Boolean(item.done), settles: settles.has(name) }
      for (const url of [...urlsOf(item), ...(item.covers ?? [])]) {
        const key = normalUrl(url)
        if (!meets.has(key)) meets.set(key, [])
        meets.get(key).push(entry)
      }
    }
  }
  const page = (url) => url.slice(0, url.indexOf("#"))
  const uncollected = (url) => {
    if (seen.has(url) || (url.includes("#") && seen.has(normalUrl(page(url))))) return false
    let host
    try { host = new URL(url).host } catch { return false }
    return shapes.has(shapeOf(url)) || keyed.some((source) => source.host === host && source.key.test(url))
  }
  const settled = []
  const held = heldFiles(ws)
  for (const [rel, { page: file, text }] of texts) {
    // A page someone else is changing (held by a scheduled run) is settled at a later collection.
    if (!dryRun && file && heldPath(ws, file.path, held)) continue
    const lines = text.split("\n")
    const plain = prose(text).split("\n")
    const definitions = definitionsOf(plain)
    const { items } = markdownStructure(text)
    /** Whether every outside item the task's own text links is finished at a settling source. */
    const finished = (item) => {
      const links = [...new Set(linksIn([...new Set([item.start, ...item.ownLines])].map((i) => plain[i]), definitions).map(normalUrl))]
      const parts = new Set(links.filter((url) => url.includes("#")).map(page))
      let met = 0
      for (const url of links) {
        if (parts.has(url)) continue
        const entries = meets.get(url) ?? (url.includes("#") ? meets.get(normalUrl(page(url))) : undefined)
        if (!entries) {
          if (uncollected(url)) return false
          continue
        }
        if (entries.some((entry) => !entry.done || !entry.settles)) return false
        met++
      }
      return met > 0
    }
    const closed = new Set()
    for (let changed = true; changed;) {
      changed = false
      items.forEach((item, index) => {
        if (closed.has(index) || !OPEN.test(item.text) || /^WAITING(?=\s|$)/.test(item.text)) return
        if (items.some((other, j) => !closed.has(j) && other.ancestors.includes(index) && OPEN.test(other.text))) return
        if (!finished(item)) return
        closed.add(index)
        changed = true
      })
    }
    let wrote = false
    for (const index of [...closed].sort((a, b) => a - b)) {
      const at = items[index].start
      const done = lines[at].replace(/^(\s*[-*+]\s+)(?:TODO|DOING|NOW|LATER)(?=\s|$)/, "$1DONE")
      if (done === lines[at]) continue
      settled.push({ path: rel, line: at + 1, text: lines[at].trim(), title: items[index].text.replace(MARKER, "").trim() })
      lines[at] = done
      wrote = true
    }
    if (wrote && !dryRun) writeAtomic(file.path, lines.join("\n"))
  }
  return settled
}

/**
 * The task lines the engine settles as done on the given pages (`{ file, text }`, such as the graph at
 * an earlier commit), with what the sources last told: the open tasks whose outside items are all
 * finished at sources set to `finished: "settle"`. Nothing is written. Returns `{ file, line, text }`
 * with the line as it stands on that page; a check tells the engine's settling from a task closed by
 * hand this way.
 */
export function settledOn(ws, pages) {
  const texts = new Map(pages.map(({ file, text }) => [file, { page: null, text }]))
  return settleFinished(ws, readSourceState(ws), texts, { dryRun: true }).map(({ path, line, text }) => ({ file: path, line, text }))
}

/**
 * Takes the items an agent collected from source `name` (a list, `{ items }`, or that as JSON text)
 * and adds the new open ones to the memo. Known items are those whose link is in the graph or that
 * the memo has had before through any source, so a line the owner removed or archived does not come
 * back. Finished items are never added; when the memo still has them open they are reported, as are
 * items a complete source no longer lists. Completion stays the owner's call, unless the owner set
 * the source to settle what it finished (`finished: "settle"`): then the tasks whose items are all
 * finished become DONE (`settled`). With `dryRun` neither the memo nor `sources.json` changes, and
 * nothing else is written.
 */
export function ingest(ws, name, input, options = {}) {
  const source = sourceNamed(ws, name)
  if (source.kind !== "items") throw new Error(format(ws.labels.messages["source-kind"], { name, kind: source.kind }))
  // Collections and marks rewrite sources.json; one at a time, so neither loses the other's update.
  return options.dryRun ? collectItems(ws, source, name, input, options) : withLock(join(ws.cacheDir, SOURCE_STATE), () => collectItems(ws, source, name, input, options), ws.labels.messages.locked)
}

function collectItems(ws, source, name, input, { dryRun = false, now = new Date() } = {}) {
  const items = readItems(ws, name, input)
  const { model } = prepare(ws)
  const isKnowledge = knowledgeOf(ws, model)
  const texts = pageTexts(ws)
  const linked = new Set([...texts.values()].flatMap(({ text }) => {
    const plain = prose(text).split("\n")
    return linksIn(plain, definitionsOf(plain)).map(normalUrl)
  }))
  const open = openLinks(texts)
  const state = readSourceState(ws)
  // Links the memo has had through any source or under any id.
  for (const record of Object.values(state)) for (const item of Object.values(record.items ?? {}))
    if (item.noted) for (const url of urlsOf(item)) linked.add(normalUrl(url))
  const previous = new Map(Object.entries(state[name]?.items ?? {}))
  const tracked = new Map(previous)
  const stamp = now.toISOString()
  const result = { source: name, dryRun, added: [], known: 0, finished: 0, ignored: 0, skipped: [], closed: [], gone: [], held: [] }
  const held = heldFiles(ws)
  const targets = new Map()
  // Two items may point at one page (two comments on a post); the memo gets that page once.
  const queued = new Set()
  for (const item of items) {
    const before = previous.get(item.id)
    const urls = [...new Set([...(before ? urlsOf(before) : []), item.url])]
    const places = placesOf(open, urls)
    // Noted: the memo has had this item, so it is never added again even after the owner removes it.
    const noted = Boolean(before?.noted || urls.some((url) => linked.has(normalUrl(url))))
    const record = (extra = {}) => tracked.set(item.id, { url: item.url, ...(urls.length > 1 ? { urls } : {}), title: item.title,
      ...(item.state === undefined ? {} : { state: item.state }), done: item.done, firstSeen: before?.firstSeen ?? stamp, lastSeen: stamp,
      ...(source.complete ? { listed: true } : {}), ...(noted ? { noted } : {}), ...(before?.ignored ? { ignored: true } : {}),
      ...(item.covers ? { covers: item.covers } : {}), ...extra })
    record()
    if (before?.ignored) { result.ignored++; continue }
    if (item.skip) { record({ ignored: true }); result.skipped.push({ id: item.id, title: item.title }); continue }
    if (item.done && places.length) result.closed.push({ id: item.id, title: item.title, url: item.url, places })
    if (item.done) { result.finished++; continue }
    if (noted || urls.some((url) => queued.has(normalUrl(url)))) {
      // Its links now stand for it, so another item pointing at them this time is the same page.
      for (const url of urls) queued.add(normalUrl(url))
      record({ noted: true }); result.known++; continue
    }
    for (const url of urls) queued.add(normalUrl(url))
    record({ noted: true })
    const place = placeOf(ws, source, item, model, isKnowledge)
    const keyed = source.key && new RegExp(`^(?:${source.key})$`).test(item.id)
    const marker = item.marker ?? source.marker
    const line = `- ${marker ? `${marker} ` : ""}${item.title} [${keyed ? item.id : source.label}](${item.url})`
    const path = place.journal ? existingPath(join(ws.graphDir, "journals", `${journalName(ws, now)}.md`)) : join(ws.graphDir, model.docs.get(place.node).sourcePath)
    // A page someone else is changing (held by a scheduled run) is not written: the item is not taken,
    // so the next collection brings it again.
    if (heldPath(ws, path, held)) {
      if (before) tracked.set(item.id, before)
      else tracked.delete(item.id)
      for (const url of urls) queued.delete(normalUrl(url))
      result.held.push({ id: item.id, title: item.title, url: item.url, to: relative(ws.graphDir, path).normalize("NFC") })
      continue
    }
    if (!targets.has(path)) targets.set(path, { journal: Boolean(place.journal), lines: [] })
    targets.get(path).lines.push(line)
    result.added.push({ id: item.id, title: item.title, url: item.url, to: relative(ws.graphDir, path).normalize("NFC"), reason: place.reason, line })
  }
  if (source.complete) {
    // A complete listing tells what is gone; remember it per item, so review can ask about it later.
    const listed = new Set(items.map((item) => item.id))
    for (const [id, item] of previous) {
      if (listed.has(id)) continue
      tracked.set(id, { ...item, listed: false })
      if (item.ignored || item.done) continue
      const places = placesOf(open, urlsOf(item))
      if (places.length) result.gone.push({ id, title: item.title, url: item.url, places })
    }
  }
  // Items the source has not listed for a long time shrink once no open task links to them. One the
  // memo never had is forgotten; one it had keeps only its id and links, so it is never added again,
  // even under another of its links. An item the owner skipped stays as it is.
  result.forgotten = 0
  result.compacted = 0
  for (const [id, item] of tracked) {
    const unseen = now.getTime() - new Date(item.lastSeen ?? 0).getTime() > FORGET_DAYS * 86400000
    if (!unseen || item.ignored || placesOf(open, urlsOf(item)).length) continue
    // The memo may have its link without the engine having added it: then it counts as had.
    if (!item.noted && !urlsOf(item).some((url) => linked.has(normalUrl(url)) || queued.has(normalUrl(url)))) { tracked.delete(id); result.forgotten++; continue }
    if (Object.keys(item).every((key) => ["url", "urls", "noted", "lastSeen"].includes(key))) continue
    tracked.set(id, { url: item.url, ...(item.urls ? { urls: item.urls } : {}), noted: true, lastSeen: item.lastSeen })
    result.compacted++
  }
  const after = { ...state, [name]: { fetchedAt: stamp, complete: source.complete, items: Object.fromEntries(tracked) } }
  if (!dryRun) {
    for (const [path, target] of targets) target.journal ? appendToJournal(path, target.lines) : insertIntoNode(ws, path, target.lines)
    writeAtomic(join(ws.root, SOURCE_STATE), `${JSON.stringify(after, null, 2)}\n`)
  }
  // Settle on the pages as they are now, with what every source last told, this one included.
  result.settled = source.finished === "settle" ? settleFinished(ws, after, dryRun ? texts : pageTexts(ws), { dryRun }) : []
  const gone = new Set(result.settled.map((item) => `${item.path}\n${item.text}`))
  result.closed = result.closed.map((item) => ({ ...item, places: item.places.filter((place) => !gone.has(`${place.path}\n${place.text}`)) })).filter((item) => item.places.length)
  return result
}

/**
 * Open memo tasks whose outside item is finished at the source, or no longer listed by a source
 * that lists everything. Review turns them into questions; only the owner marks them done.
 */
export function sourceFollowUps(ws, texts = pageTexts(ws)) {
  const state = readSourceState(ws)
  let configured
  try { configured = new Set(sourcesOf(ws).filter((source) => source.kind === "items").map((source) => source.name)) } catch { return [] }
  const open = openLinks(texts)
  const found = []
  for (const [name, record] of Object.entries(state)) {
    if (!configured.has(name)) continue
    for (const [id, item] of Object.entries(record.items ?? {})) {
      if (item.ignored) continue
      const kind = item.done ? "source-closed" : record.complete && item.listed === false ? "source-gone" : undefined
      if (!kind) continue
      for (const place of placesOf(open, urlsOf(item))) found.push({ kind, source: name, id, title: item.title, url: item.url, ...place })
    }
  }
  return found
}
