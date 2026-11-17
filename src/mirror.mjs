// Mirrors: one list the owner keeps in several places at once, such as an outline section of a page,
// a kept part of an export file, a board page the website edits, and a note in another app. Each place
// shows the same list in its own shape: topics with the items below them. An edit made in any place
// reaches all of them; edits to different lines all stay, and where two places changed the same lines
// the later edit wins and the earlier one's lines are kept in an overlap item at the bottom.
//
// The list is held in one shape: a topic is a top item (`- Topic`), an item below it is indented by a
// tab per level (`\t- item`). Every place remembers the list as it last held it (its base), so an edit
// is told apart from a place that is merely behind: a note the engine could not write yet is not read
// as the owner removing what it lacks. A run merges the places that changed, oldest edit first, writes
// the result to every page and file it can write, and returns, for each note, the text to write there:
// the engine never drives another app; the workspace's own runner writes the note and then records it
// (`mirror mark`).
//
// Another app is often hard to write safely from outside: it needs a real click, it takes the owner's
// focus, or the note holds other text that must not be touched. So the run prepares the text a note
// should hold and keeps it (`mirror text`, `--copy` puts it on the clipboard): a person, or a runner
// that can, pastes it between the markers. A note found holding a text a run prepared for it took no
// edit, even when it is an older one, so a late paste never undoes what changed elsewhere since.
//
// Place kinds (settings `mirrors: [{ name, places: [...] }]`):
// - `{ page, section, tasks }`: the topics under a heading of a page (`## Section`), each a heading block
//   (`- ### Topic`) with its items indented below. With `tasks`, items are tasks: their markers are not
//   part of the text, a new item is written as a task, and a finished one leaves the list (it stays on
//   the page under the item above it). A link at the end of a line (` · [[Node]]`) is the page's own.
// - `{ export, region, item }`: a kept part of an export file: `### Topic` and `- item` lines;
//   an optional `item` marker is stripped when reading items.
// - `{ board }`: a page whose body the website's board shows and edits, in the list's own shape.
// - `{ note, item }`: a note source's marked part, read by the workspace and given to the run: a topic
//   line, then its items starting with `item` (default `- `), two spaces deeper per level.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { boardParts, boardText, mergeLines, withBody } from "./board.mjs"
import { walkGraph } from "./check.mjs"
import { exportsOf, keepMarks } from "./exports.mjs"
import { writeAtomic } from "./files.mjs"
import { commitContents, commitGraph, heldFiles } from "./git.mjs"
import { pausedBy, withGraph } from "./idle.mjs"
import { format } from "./labels.mjs"

const MARKER = /^(TODO|DOING|WAITING|LATER|NOW|DONE|CANCELED|CANCELLED)\s+/
const FINISHED = new Set(["DONE", "CANCELED", "CANCELLED"])
const TRAILING = /(?:\s*·\s*\[\[[^\]\n]+\]\])+\s*$/
const LINK = /\[\[([^\]\n]+)\]\]/g
const GROUP = /^- #{3,6}\s+(.+)$/
const same = (a, b) => a.length === b.length && a.every((line, i) => line === b[i])
/** How many texts a run prepared for a note are kept, so a paste of any of them is known. */
const PREPARED = 20
/** The kept texts with `list` as the newest: one prepared or given out again moves to the end, so the oldest unused one goes first. */
const freshest = (kept, list, now) => [...kept.filter((one) => !same(one.list, list)), { at: new Date(now).toISOString(), list }].slice(-PREPARED)
/** A line's text without its task marker and the page's own trailing links; links in it keep their names. */
const plain = (text) => text.replace(MARKER, "").replace(TRAILING, "").replace(LINK, (whole, name) => name).trim()
/** Not part of a list: queries, embeds, and lines that are only links with a label. */
const notItem = (text) => /\{\{(?:query|embed)\b/.test(text)
  || (/\[\[[^\]\n]+\]\]/.test(text) && /^(?:[^:]+:)?$/.test(text.replace(LINK, "").replace(/[·\s]/g, "")))

/** The configured mirrors, checked: `[{ name, places: [{ id, kind, … }] }]`. */
export function mirrorsOf(ws) {
  const m = ws.labels.messages
  const list = ws.mirrors ?? []
  if (!Array.isArray(list)) throw new Error(format(m["mirror-invalid"], { index: "", field: "mirrors" }))
  const seen = new Set()
  return list.map((given, index) => {
    const bad = (field) => { throw new Error(format(m["mirror-invalid"], { index, field })) }
    if (!given || typeof given !== "object" || typeof given.name !== "string" || !given.name.trim() || seen.has(given.name)) bad("name")
    seen.add(given.name)
    if (!Array.isArray(given.places) || given.places.length < 2) bad("places")
    const ids = new Set()
    const files = new Set()
    const places = given.places.map((place, at) => {
      const kinds = ["page", "export", "board", "note"].filter((kind) => typeof place?.[kind] === "string" && place[kind].trim())
      if (kinds.length !== 1) bad(`places[${at}]`)
      const kind = kinds[0]
      if (kind === "page" && (typeof place.section !== "string" || !place.section.trim())) bad(`places[${at}].section`)
      if (kind === "export" && (typeof place.region !== "string" || !place.region.trim())) bad(`places[${at}].region`)
      if ((kind === "note" || kind === "export") && place.item !== undefined && (typeof place.item !== "string" || !place.item.trim())) bad(`places[${at}].item`)
      const id = `${kind}:${place[kind]}${place.section ? `#${place.section}` : place.region ? `#${place.region}` : ""}`
      if (ids.has(id)) bad(`places[${at}]`)
      ids.add(id)
      // Two places in one file would each be written from the file as it was read, the later write
      // undoing the earlier one: a page (or board) and an export file appear once per mirror.
      const file = kind === "board" ? `page:${place.board.normalize("NFC")}` : kind === "page" ? `page:${place.page.normalize("NFC")}`
        : kind === "export" ? `file:${exportsOf(ws).find((item) => item.name === place.export)?.path ?? place.export}` : `note:${place.note}`
      if (files.has(file)) bad(`places[${at}]`)
      files.add(file)
      return { ...place, kind, id, label: place.label ?? place[kind] }
    })
    return { name: given.name, places }
  })
}

const stateFile = (ws, name) => join(ws.cacheDir, "mirrors", `${encodeURIComponent(name)}.json`)
const readState = (ws, name) => { try { return JSON.parse(readFileSync(stateFile(ws, name), "utf8")) } catch { return null } }
const writeState = (ws, name, state) => { mkdirSync(dirname(stateFile(ws, name)), { recursive: true }); writeAtomic(stateFile(ws, name), `${JSON.stringify(state, null, 2)}\n`) }

/** Board shape: every line an item, tabs for depth; a line written under an item becomes an item one deeper. */
function boardLines(text) {
  const out = boardText(text)
  return out ? out.split("\n").map((line) => line.replace(/^(\t*) {2}(?=\S)/, (whole, tabs) => `${tabs}\t- `)) : []
}

/** The page file of a page name, or undefined. */
function pagePath(ws, name) {
  const want = name.normalize("NFC")
  return walkGraph(ws).pages.find((page) => page.name.normalize("NFC") === want)?.path
}

const SEP = "\u0000"
const depthOf = (line) => line.match(/^\t*/)[0].length
/**
 * Each line's key in a list: its text under its parents' keys, with how many times the same text came
 * before under the same parent, so two items of the same words stay two and an item is told apart by
 * where it hangs. `norm` gives the text compared.
 */
function pathKeys(lines, norm = (line) => line.replace(/^\t*- /, "")) {
  const stack = []
  const seen = new Map()
  return lines.map((line) => {
    const d = depthOf(line)
    stack.length = d
    const path = stack.slice(0, d).map((part) => part ?? "").join(SEP)
    const at = `${path}${SEP}${norm(line)}`
    const n = seen.get(at) ?? 0
    seen.set(at, n + 1)
    stack[d] = `${norm(line)}#${n}`
    return d ? `${path}${SEP}${stack[d]}` : stack[d]
  })
}

/**
 * A page's section: its lines split into top blocks; topic blocks carry their rows (the list's lines
 * and the raw lines behind each). Returns `{ lines, start, end, blocks }` or `{ error }`.
 */
function readSection(text, section, tasks) {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.match(/^#{1,6}\s+(.*?)\s*$/)?.[1] === section)
  if (start < 0) return { error: "section" }
  const level = lines[start].match(/^#+/)[0].length
  let end = lines.findIndex((line, j) => j > start && (line.match(/^(#{1,6})\s/)?.[1].length ?? 99) <= level)
  if (end < 0) end = lines.length
  const blocks = []
  const prefix = []
  for (const line of lines.slice(start + 1, end)) {
    if (/^- /.test(line)) blocks.push({ raw: [line] })
    else if (blocks.length) blocks.at(-1).raw.push(line)
    else prefix.push(line)
  }
  // Blank lines at the end of the section belong to the section, not to its last row, which may move.
  const suffix = []
  while (blocks.length && blocks.at(-1).raw.length > 1 && !blocks.at(-1).raw.at(-1).trim()) suffix.unshift(blocks.at(-1).raw.pop())
  for (const block of blocks) {
    const title = block.raw[0].match(GROUP)?.[1]
    if (!title) continue
    block.title = plain(title)
    // Rows: an item line and the lines after it that are not items (properties, continued text).
    const rows = []
    for (const line of block.raw.slice(1)) {
      if (/^\t+- /.test(line) || !rows.length) rows.push({ raw: [line], after: [] })
      else rows.at(-1).raw.push(line)
    }
    // Finished items and what lies deeper below them, and lines that are not items, stay with the row above.
    const visible = []
    let below = null
    for (const row of rows) {
      const item = row.raw[0].match(/^(\t+)- (.*)$/)
      const tabs = item ? item[1].length : 0
      if (below !== null && tabs > below) { (visible.at(-1)?.after ?? (block.loose ??= [])).push(...row.raw); continue }
      const marker = item?.[2].match(MARKER)?.[1]
      const hidden = !item || (tasks && FINISHED.has(marker)) || notItem(item[2])
      below = hidden && item ? tabs : null
      if (hidden) { (visible.at(-1)?.after ?? (block.loose ??= [])).push(...row.raw); continue }
      visible.push({ ...row, line: `${"\t".repeat(tabs)}- ${plain(item[2])}` })
    }
    block.rows = visible
  }
  return { lines, start, end, prefix, blocks, suffix }
}
const sectionList = (parsed) => parsed.blocks.filter((block) => block.title !== undefined)
  .flatMap((block) => [`- ${block.title}`, ...block.rows.map((row) => row.line)])

/** The section rewritten to hold `list`, keeping each existing line as written; new ones get the page's shape. */
function writeSection(parsed, list, tasks) {
  const topics = parsed.blocks.map((block, i) => (block.title !== undefined ? i : -1)).filter((i) => i >= 0)
  // Existing lines are found by their place first (the same parents, the same count), then under the same
  // topic, then anywhere: moving topics or parents keeps each row's state, links and history with it, and a
  // row whose topic was renamed is still found.
  const pool = new Map()
  const queue = (key, entry) => { const all = pool.get(key) ?? []; all.push(entry); pool.set(key, all) }
  const taken = new Set()
  const take = (...keys) => {
    for (const key of keys) {
      const entry = (pool.get(key) ?? []).find((one) => !taken.has(one))
      if (entry) { taken.add(entry); return entry }
    }
    return undefined
  }
  for (const i of topics) {
    const block = parsed.blocks[i]
    queue(`- ${block.title}`, { block })
    const keys = pathKeys([`- ${block.title}`, ...block.rows.map((row) => row.line)])
    block.rows.forEach((row, k) => { queue(`\u0001${keys[k + 1]}`, row); queue(`- ${block.title}${SEP}${row.line}`, row); queue(row.line, row) })
  }
  const listKeys = pathKeys(list)
  let topic = ""
  const assigned = list.map((line, n) => {
    if (!line.startsWith("\t")) { topic = line; return take(line) }
    return take(`\u0001${listKeys[n]}`, `${topic}${SEP}${line}`, line)
  })
  // A finished item kept under a row that is not written moves up to the nearest row that is.
  const staying = new Set(assigned.filter(Boolean))
  for (const i of topics) {
    const rows = parsed.blocks[i].rows
    rows.forEach((row, at) => {
      if (staying.has(row) || !row.after.length) return
      const host = rows.slice(0, at).reverse().find((other) => staying.has(other))
      if (host) host.after.push(...row.after)
      else (parsed.blocks[i].loose ??= []).push(...row.after)
      row.after = []
    })
  }
  // Each topic of the list is a segment: its heading block, then its rows.
  const segments = []
  const into = () => segments.at(-1) ?? (segments.push([]), segments.at(-1))
  const used = new Set()
  list.forEach((line, n) => {
    const entry = assigned[n]
    if (entry?.block) { used.add(entry.block); segments.push([entry.block.raw[0], ...(entry.block.loose ?? [])]); return }
    if (entry) { into().push(...entry.raw, ...entry.after); return }
    const item = line.match(/^(\t*)- (.*)$/)
    if (!item) return
    if (!item[1]) segments.push([`- ### ${item[2]}`])
    else into().push(`${item[1]}- ${tasks && !MARKER.test(item[2]) ? "TODO " : ""}${item[2]}`)
  })
  // A topic renamed or removed elsewhere still has its finished items here: they stay, under the topic
  // now in its place (the one before it when it was the last). Its own properties go with its heading.
  topics.forEach((i, ordinal) => {
    const block = parsed.blocks[i]
    if (used.has(block) || !block.loose?.length) return
    const from = block.loose.findIndex((line) => /^\t+- /.test(line))
    if (from < 0) return
    if (segments.length) segments[Math.min(ordinal, segments.length - 1)].push(...block.loose.slice(from))
    else segments.push([block.raw[0], ...block.loose])
  })
  const written = segments.flat()
  const first = topics.length ? topics[0] : parsed.blocks.length
  const last = topics.length ? topics.at(-1) : parsed.blocks.length - 1
  const others = (from, to) => parsed.blocks.slice(from, to).filter((block) => block.title === undefined).flatMap((block) => block.raw)
  const body = [...parsed.prefix, ...others(0, first), ...written, ...others(first, last + 1), ...others(last + 1), ...parsed.suffix]
  return [...parsed.lines.slice(0, parsed.start + 1), ...body, ...parsed.lines.slice(parsed.end)].join("\n")
}

/** A kept part's lines in the list's shape: `### Topic` is a top item, `- item` one level below it. */
function regionList(lines, prefix) {
  const mark = prefix?.trim()
  const unmark = (text) => {
    const value = text.trim()
    return mark && value.startsWith(mark) ? value.slice(mark.length).trimStart() : value
  }
  return lines.flatMap((line) => {
    if (!line.trim()) return []
    const topic = line.match(/^#{3,6}\s+(.+)$/)
    if (topic) return [`- ${topic[1].trim()}`]
    const item = line.match(/^( *)- (.*)$/)
    if (item) return [`${"\t".repeat(Math.floor(item[1].length / 2) + 1)}- ${unmark(item[2])}`]
    const more = line.match(/^( *)(\S.*)$/)
    return [`${"\t".repeat(Math.floor(more[1].length / 2) + 1)}- ${unmark(more[2])}`]
  })
}
/** The list as a kept part: topics as `### Topic` with a blank line before each but the first. */
function regionLines(list) {
  return list.flatMap((line, i) => {
    const item = line.match(/^(\t*)- (.*)$/)
    if (!item) return []
    if (!item[1]) return [...(i ? [""] : []), `### ${item[2]}`]
    return [`${"  ".repeat(item[1].length - 1)}- ${item[2]}`]
  })
}

/** A note's marked part (`{ blocks: [{ heading, lines }] }`) in the list's shape. */
function noteList(data, prefix) {
  const mark = prefix.trim()
  return (data?.blocks ?? []).flatMap((block) => {
    const heading = String(block.heading ?? "").trim()
    const items = (block.lines ?? []).map((line) => {
      const match = String(line).match(/^( *)(.*)$/)
      const text = match[2].startsWith(mark) ? match[2].slice(mark.length) : match[2].replace(/^-\s+/, "")
      return { depth: Math.floor(match[1].length / 2) + 1, text: text.trim() }
    }).filter((item) => item.text)
    return heading ? [`- ${heading}`, ...items.map((item) => `${"\t".repeat(item.depth)}- ${item.text}`)] : items.map((item) => `- ${item.text}`)
  })
}
/** The list as a note's text: a topic line, its items after `prefix`, two spaces deeper per level, a blank line between topics. */
function noteLines(list, prefix) {
  return list.flatMap((line, i) => {
    const item = line.match(/^(\t*)- (.*)$/)
    if (!item) return []
    if (!item[1]) return [...(i ? [""] : []), item[2]]
    return [`${"  ".repeat(item[1].length - 1)}${prefix}${item[2]}`]
  })
}

/**
 * The first time places are linked, the list is the first place's, with each other place's topics and
 * items it lacks added: a topic another place also has (the same words, any case or spacing) takes the
 * items it lacks, and a new topic goes to the end. An item is the same only under the same parents, and
 * one the list lacks goes after the last line under its parent.
 */
function union(lists) {
  const norm = (line) => line.replace(/^\t*- /, "").toLowerCase().replace(/\s+/g, "")
  const out = [...lists[0]]
  for (const lines of lists.slice(1)) {
    const keys = pathKeys(lines, norm)
    lines.forEach((line, i) => {
      const now = pathKeys(out, norm)
      if (now.includes(keys[i])) return
      const parent = keys[i].split(SEP).slice(0, -1).join(SEP)
      const at = parent ? now.indexOf(parent) : -1
      let to = out.length
      if (at >= 0) { to = at + 1; while (to < out.length && depthOf(out[to]) > depthOf(out[at])) to++ }
      out.splice(to, 0, line)
    })
  }
  return out
}

/** Reads one place: `{ lines, text, file, mtime }`, `{ missing }` when a note was not given, or `{ error }`. */
function readPlace(ws, place, notes) {
  if (place.kind === "note") {
    const data = notes?.[place.note]
    if (data === undefined) return { missing: true }
    if (data.markers !== undefined && data.markers !== 2) return { error: format(ws.labels.messages["mirror-note-markers"], { note: place.note, count: data.markers }) }
    return { lines: noteList(data, place.item ?? "- ") }
  }
  if (place.kind === "export") {
    const exp = exportsOf(ws).find((item) => item.name === place.export)
    if (!exp || !exp.sections.some((section) => section.keep === place.region)) return { error: format(ws.labels.messages["mirror-place-missing"], { place: place.id }) }
    const text = existsSync(exp.path) ? readFileSync(exp.path, "utf8") : undefined
    const [open, close] = keepMarks(ws, place.region)
    const lines = text?.split("\n") ?? []
    const from = lines.findIndex((line) => line.trim() === open)
    const to = lines.findIndex((line, j) => j > from && line.trim() === close)
    if (from < 0 || to < 0) return { error: format(ws.labels.messages["mirror-place-missing"], { place: place.id }) }
    const pad = exp.sections.find((section) => section.keep === place.region).pad ?? 0
    return { lines: regionList(lines.slice(from + 1, to), place.item), text, file: exp.path, mtime: statSync(exp.path).mtimeMs, from, to, pad }
  }
  const file = pagePath(ws, place.kind === "page" ? place.page : place.board)
  if (!file) return { error: format(ws.labels.messages["mirror-place-missing"], { place: place.id }) }
  const text = readFileSync(file, "utf8")
  const mtime = statSync(file).mtimeMs
  if (place.kind === "board") return { lines: boardLines(boardParts(text, ws.labels.region).body), text, file, mtime }
  const parsed = readSection(text, place.section, Boolean(place.tasks))
  if (parsed.error) return { error: format(ws.labels.messages["mirror-place-missing"], { place: place.id }) }
  return { lines: sectionList(parsed), text, file, mtime, parsed }
}

/** The text a place holds after it takes `list`. */
function placeText(ws, place, read, list) {
  if (place.kind === "page") return writeSection(read.parsed, list, Boolean(place.tasks))
  if (place.kind === "board") return withBody(boardParts(read.text, ws.labels.region), list.join("\n"))
  const lines = read.text.split("\n")
  const inner = regionLines(list)
  const pad = Array(read.pad).fill("")
  return [...lines.slice(0, read.from + 1), ...(inner.length ? [...pad, ...inner, ...pad] : pad), ...lines.slice(read.to)].join("\n")
}

/**
 * Brings every place of a mirror to the same list. `notes` gives each note place's marked part as the
 * workspace read it (`{ <source>: { markers, blocks } }`); a note not given is left as it is. Pages are
 * written only when nobody touched them in the last `settle` minutes and they are not held; otherwise
 * the run is put off (`deferred`). A page's own uncommitted edits get a commit of their own first, then
 * the pages the run wrote are committed. Returns `{ name, decision, list, places, notes, overlap, deferred }`;
 * `notes` holds, for each note place, the text to write there (`lines`) and whether it differs (`write`).
 */
export function mirror(ws, name, { notes = {}, dryRun = false, now = Date.now(), settle = 2 } = {}) {
  const m = ws.labels.messages
  const all = mirrorsOf(ws)
  const config = name === undefined && all.length === 1 ? all[0] : all.find((item) => item.name === name)
  if (!config) throw new Error(format(m["mirror-unknown"], { name: name ?? "", names: all.map((item) => item.name).join(", ") }))
  const result = { name: config.name, decision: "same", list: [], places: [], notes: {}, overlap: [], deferred: null, committed: false }
  const reads = new Map(config.places.map((place) => [place.id, readPlace(ws, place, notes)]))
  const failed = config.places.find((place) => reads.get(place.id).error)
  if (failed) throw new Error(reads.get(failed.id).error)
  // A paused memo takes nothing from a run.
  const paused = pausedBy(ws)
  if (paused.length) { result.deferred = format(m["mirror-paused"], { pages: paused.join(", ") }); return result }
  // A page someone is writing in, or a page or file a run holds, is left alone this time.
  const held = heldFiles(ws)
  const state = readState(ws, config.name)
  for (const place of config.places.filter((one) => one.kind !== "note")) {
    const read = reads.get(place.id)
    const rel = relative(ws.root, read.file).split("\\").join("/").normalize("NFC")
    if (held.some((one) => rel === one || rel.startsWith(`${one}/`))) { result.deferred = format(m["mirror-held"], { place: place.label }); return result }
    if (place.kind === "export") continue
    if (settle > 0 && state?.places?.[place.id]?.text !== read.text && now - read.mtime < settle * 60000) { result.deferred = format(m["mirror-recent"], { place: place.label, minutes: settle }); return result }
  }
  const present = config.places.filter((place) => !reads.get(place.id).missing)
  let list
  const bases = {}
  const pending = {}
  if (!state) {
    list = union(present.map((place) => reads.get(place.id).lines))
    result.decision = "first"
    for (const place of present) bases[place.id] = reads.get(place.id).lines
  } else {
    list = state.list
    // A place linked after the first run joins the way the first run did: what it adds is taken, nothing is removed.
    for (const place of present.filter((one) => !state.places?.[one.id])) {
      list = union([list, reads.get(place.id).lines])
      bases[place.id] = reads.get(place.id).lines
    }
    // A place changed when it no longer holds what it held last time. Its edit time is the file's for
    // pages, and the first time the change was seen for files the engine rewrites and for notes.
    const changed = present.filter((place) => state.places?.[place.id]).map((place) => {
      const lines = reads.get(place.id).lines
      const base = state.places?.[place.id]?.base ?? state.list
      if (same(lines, base)) return null
      // A note holding a text a run prepared for it was pasted, not edited: that text is its base now.
      if (place.kind === "note" && (state.places?.[place.id]?.prepared ?? []).some((one) => same(lines, one.list))) { bases[place.id] = lines; return null }
      const seen = state.places?.[place.id]?.seen
      const key = lines.join("\n")
      const at = place.kind === "page" || place.kind === "board" ? reads.get(place.id).mtime
        : seen?.text === key ? seen.at : place.kind === "export" ? reads.get(place.id).mtime : now
      pending[place.id] = { text: key, at }
      return { place, lines, base, at }
    }).filter(Boolean).sort((a, b) => a.at - b.at)
    for (const edit of changed) {
      // The later edit wins where both changed the same lines; the earlier lines go to the overlap item.
      const merged = mergeLines(edit.base, list, edit.lines)
      list = merged.lines
      if (merged.conflicts.length) result.overlap.push({ place: edit.place.label, at: edit.at, lines: merged.conflicts })
      result.places.push({ id: edit.place.id, changed: true, at: new Date(edit.at).toISOString() })
      // What a note held is now in the list: it is the note's base, so the same text is not taken again
      // while the note waits to be written, and what it lacks is not read as removed.
      if (edit.place.kind === "note") bases[edit.place.id] = edit.lines
    }
    if (changed.length) result.decision = changed.length > 1 ? "merged" : "taken"
  }
  for (const item of result.overlap) {
    const stamp = new Date(item.at)
    list = [...list, `- ${format(m["mirror-overlap"], { place: item.place, at: `${stamp.getMonth() + 1}/${stamp.getDate()} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}` })}`,
      ...item.lines.map((line) => `\t- ${line.replace(/^\t*- /, "")}`)]
  }
  result.list = list
  // What each place should hold: pages and files are written here, notes are returned.
  const writes = []
  const prepared = {}
  for (const place of config.places) {
    const read = reads.get(place.id)
    if (place.kind === "note") {
      // Every list a run leaves is kept as a text the note may be given to paste, newest last, even when
      // the note was not read this time (`mirror text` gives the latest list), so a paste of any of them
      // is known. A note never read yet keeps nothing: it joins later as a new place.
      const prior = state?.places?.[place.id]
      if (read.missing && !prior?.base) continue
      const write = !same(read.missing ? prior.base : read.lines, list)
      if (!read.missing) {
        result.notes[place.note] = { lines: noteLines(list, place.item ?? "- "), write }
        if (!write) bases[place.id] = list
      }
      const kept = (prior?.prepared ?? []).filter((one) => Array.isArray(one?.list))
      prepared[place.id] = { wanted: write, prepared: freshest(kept, list, now) }
      continue
    }
    if (read.missing) continue
    bases[place.id] = list
    if (same(read.lines, list)) continue
    const text = placeText(ws, place, read, list)
    if (text !== read.text) writes.push({ place, read, text })
  }
  if (dryRun) { result.writes = writes.map((item) => item.place.id); return result }
  const pages = writes.filter((item) => item.place.kind !== "export")
  const rels = pages.map((item) => relative(ws.graphDir, item.read.file).split("\\").join("/"))
  // Pages an earlier run wrote but could not commit: what it wrote is committed first (not what the page
  // holds now), so a later edit, and this run's own writing, each get a commit of their own.
  const retry = (state?.uncommitted ?? []).filter((item) => item && typeof item.file === "string" && typeof item.text === "string")
  let uncommitted = []
  const done = withGraph(ws, () => {
    // Read again under the lock: a place changed since, or a memo paused since, is left for the next run.
    for (const item of writes) if (readFileSync(item.read.file, "utf8") !== item.read.text) return false
    if (pausedBy(ws).length) return false
    const message = format(m["mirror-commit"], { name: config.name })
    if (retry.length) {
      try { result.committed = commitContents(ws, message, retry.map((item) => ({ file: item.file, content: Buffer.from(item.text) }))) === "committed" } catch (error) {
        // Still not committed: nothing more is written, so the owner's edits are not mixed into it.
        uncommitted = retry
        result.uncommitted = { pages: retry.map((item) => item.file), error: error.message }
        return "stopped"
      }
    }
    if (rels.length) commitGraph(ws, ws.labels.snapshot, { only: rels })
    for (const item of writes) writeAtomic(item.read.file, item.text)
    try {
      if (rels.length) result.committed = commitGraph(ws, message, { only: rels }) === "committed" || result.committed
    } catch (error) {
      uncommitted = pages.map((item) => ({ file: relative(ws.graphDir, item.read.file).split("\\").join("/"), text: item.text }))
      result.uncommitted = { pages: uncommitted.map((item) => item.file), error: error.message }
    }
    return true
  })
  if (!done) { result.deferred = m["mirror-moved"]; return result }
  if (done === "stopped") {
    writeState(ws, config.name, { ...state, uncommitted })
    return result
  }
  result.wrote = writes.map((item) => item.place.id)
  const places = { ...(state?.places ?? {}) }
  for (const place of config.places) {
    if (bases[place.id]) places[place.id] = { base: bases[place.id] }
    else if (!places[place.id] && reads.get(place.id).lines) places[place.id] = { base: reads.get(place.id).lines }
    // A note left behind keeps the base it had, so it is not read as the owner removing what it lacks.
    if (pending[place.id] && !bases[place.id]) places[place.id].seen = pending[place.id]
    if (prepared[place.id]) places[place.id] = { ...places[place.id], ...prepared[place.id] }
    if (place.kind !== "note" && !reads.get(place.id).missing) places[place.id].text = writes.find((item) => item.place.id === place.id)?.text ?? reads.get(place.id).text
  }
  writeState(ws, config.name, { at: new Date(now).toISOString(), list, places, ...(uncommitted.length ? { uncommitted } : {}) })
  return result
}

/** A note's text lines (as `mirror` returned them to write) back in the note's read shape. */
function noteData(lines) {
  const blocks = []
  for (const line of lines) {
    if (!String(line).trim()) { blocks.push(null); continue }
    if (!blocks.length || blocks.at(-1) === null) blocks.push({ heading: line, lines: [] })
    else blocks.at(-1).lines.push(line)
  }
  return { blocks: blocks.filter(Boolean) }
}

/**
 * Records what the workspace wrote to a note: `wrote` gives, for each note, the lines it wrote (as the
 * run returned them), and `notes` the note's marked part as read again after writing. What was written
 * is the note's base, so whatever the note holds beyond it (the owner's edit while it was written, a line
 * the app changed) is read by the next run as an edit and merged, never taken as already known.
 */
export function markMirror(ws, name, { notes = {}, wrote = {} } = {}) {
  const all = mirrorsOf(ws)
  const config = name === undefined && all.length === 1 ? all[0] : all.find((item) => item.name === name)
  if (!config) throw new Error(format(ws.labels.messages["mirror-unknown"], { name: name ?? "", names: all.map((item) => item.name).join(", ") }))
  const state = readState(ws, config.name)
  if (!state) throw new Error(format(ws.labels.messages["mirror-unmarked"], { name: config.name }))
  const marked = []
  for (const place of config.places.filter((one) => one.kind === "note" && wrote[one.note] !== undefined)) {
    if (!Array.isArray(wrote[place.note])) throw new Error(ws.labels.messages["mirror-needs-note"])
    const base = noteList(noteData(wrote[place.note]), place.item ?? "- ")
    const read = notes[place.note] === undefined ? null : readPlace(ws, place, notes)
    if (read?.error) throw new Error(read.error)
    const kept = state.places[place.id] ?? {}
    state.places[place.id] = { base, wanted: !same(base, state.list), ...(kept.prepared ? { prepared: kept.prepared } : {}) }
    marked.push({ note: place.note, inStep: Boolean(read && same(read.lines, base)) })
  }
  writeState(ws, config.name, state)
  return { name: config.name, marked }
}

/**
 * The text a note of a mirror should hold, as the last run left the list: `{ name, note, lines, wanted, at }`.
 * `wanted` is whether the note did not hold it then. With `copy`, the text goes to the clipboard and
 * `copied` says whether it did, for the owner to paste between the note's markers; the next run knows
 * the pasted text as one it prepared.
 */
export function mirrorText(ws, name, note, { copy = false } = {}) {
  const m = ws.labels.messages
  const all = mirrorsOf(ws)
  const config = name === undefined && all.length === 1 ? all[0] : all.find((item) => item.name === name)
  if (!config) throw new Error(format(m["mirror-unknown"], { name: name ?? "", names: all.map((item) => item.name).join(", ") }))
  const places = config.places.filter((one) => one.kind === "note")
  const place = note === undefined && places.length === 1 ? places[0] : places.find((one) => one.note === note)
  if (!place) throw new Error(format(m["mirror-no-note"], { name: config.name, note: note ?? "", notes: places.map((one) => one.note).join(", ") }))
  const state = readState(ws, config.name)
  if (!state) throw new Error(format(m["mirror-unmarked"], { name: config.name }))
  const kept = state.places?.[place.id] ?? {}
  // A state from before texts were kept, or a note never read: the text given out is kept now, so its paste is known.
  if (kept.base) {
    state.places[place.id] = { ...kept, prepared: freshest((kept.prepared ?? []).filter((one) => Array.isArray(one?.list)), state.list, Date.now()) }
    writeState(ws, config.name, state)
  }
  const result = { name: config.name, note: place.note, lines: noteLines(state.list, place.item ?? "- "), wanted: kept.wanted !== false, at: state.at }
  if (copy) result.copied = copyText(`${result.lines.join("\n")}\n`)
  return result
}

/** Puts text on the system clipboard; false when no clipboard command works here. */
function copyText(text) {
  const tries = process.platform === "darwin" ? [["pbcopy", [], text]]
    // clip reads the console's code page unless the text starts with a UTF-16 byte order mark.
    : process.platform === "win32" ? [["clip", [], Buffer.from(`\ufeff${text}`, "utf16le")]]
    : [["wl-copy", [], text], ["xclip", ["-selection", "clipboard"], text], ["xsel", ["--clipboard", "--input"], text]]
  return tries.some(([command, args, input]) => { const run = spawnSync(command, args, { input, stdio: ["pipe", "ignore", "ignore"] }); return !run.error && run.status === 0 })
}
