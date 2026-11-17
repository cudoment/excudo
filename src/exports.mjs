// Files the engine writes from the memo for reading outside the outliner: current work as a plain
// list in the owner's own format, such as a todo file next to the memo. An export picks open tasks
// (by state, node, key or tag) into sections and writes each with the owner's line templates. Every
// build rewrites the files, so they follow the memo, which stays the one place to change the work.
// A file someone edited since it was written is never overwritten, and neither is a file the engine
// did not write: `.excudo/exports.json` remembers what each export wrote. Two kinds of section hold
// no tasks: a kept part (`keep`), which the owner writes by hand between two marker lines and every
// rewrite carries over (`pad` blank lines inside each marker keep typing away from them), and an
// included file (`include`), which another tool of the workspace writes.
// Only what lies outside the kept parts counts as what the engine wrote. A task section may keep the
// order the owner left its entries in (`order: "file"`): the file itself holds that order, new tasks
// join at the end, and moving entries alone is no edit by hand. A `deadline` line writes a task's
// DEADLINE below it. A section written `once` leaves out a task the file already shows above it (its
// key or link in an earlier section or an included file), so a task follows on in one place only.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, join, sep } from "node:path"
import { prepare } from "./build.mjs"
import { knowledgeOf, walkGraph } from "./check.mjs"
import { authoredText, CLOSED, markdownStructure, MARKER, OPEN } from "./dialects/logseq.mjs"
import { writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { localPath, readSourceState, sourcesOf, urlsIn } from "./sources.mjs"
import { pageOf, ROOT } from "./tree.mjs"
import { movedFolders, movedPath } from "./workspaces.mjs"

const NAME = /^[a-z0-9][a-z0-9_-]*$/
/** What a line template may name. */
export const EXPORT_FIELDS = ["title", "key", "keys", "link", "links", "state", "node"]
/** What a deadline line may name: the date, and its year, month and day as numbers. */
export const DEADLINE_FIELDS = ["date", "year", "month", "day"]
const ORDERS = ["memo", "file"]
const DEADLINE = /^\s*DEADLINE:\s*<(\d{4})-(\d{2})-(\d{2})/
const FIELD = /\{([a-z]+)\}/g
const STATE_FILE = "exports.json"
const sha = (text) => createHash("sha256").update(text).digest("hex")
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
const names = (value) => value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim()))
const folded = (name) => name.normalize("NFC").toLowerCase()
const normalUrl = (url) => url.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "")
const oneLine = (text) => text.replace(/\s+/g, " ").trim()
/** Whether a text shows a link: the same address, not one that only starts with it (`/posts/1` is not `/posts/12` or `/posts/1/files`). */
const linkIn = (text, url) => new RegExp(`${normalUrl(url).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-]|/[\\w-])`).test(text)
// One spelling of a file's path, however the workspace was reached (a linked folder, another Unicode form).
const canonical = (path) => { try { return join(realpathSync(dirname(path)), basename(path)).normalize("NFC") } catch { return path.normalize("NFC") } }
/** Where a recorded file is now: a file written before its folder was renamed follows the `moved` setting. */
const movedTo = (ws, path) => { try { return movedPath(movedFolders(ws), path) } catch { return path } }
// A Markdown link, its address allowed one level of balanced parentheses.
const MD_LINK = /\[([^\]\n]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g
const PROPERTY = /^\s*(?:[\w-]+::|(?:SCHEDULED|DEADLINE):)/
// A kept part's name goes into its marker lines, so it is one line without the comment's brackets.
const KEEP_NAME = /^[^\s<>](?:[^\n<>]*[^\s<>])?$/u
const OWN_SECTION = ["heading", "keep", "include", "pad"]

/** The marker lines around a kept part, in the workspace's language. */
export const keepMarks = (ws, name) => [`<!-- ${format(ws.labels.keepStart, { name })} -->`, `<!-- ${format(ws.labels.keepEnd, { name })} -->`]

/**
 * What the owner wrote in each kept part of a file (its lines, by name) and the file with those
 * parts emptied: what the engine wrote. A part whose end marker is gone stays in that frame, so a
 * file whose markers were removed reads as edited by hand.
 */
function keptParts(ws, exp, text) {
  const kept = new Map()
  if (text === undefined) return { kept, frame: undefined }
  const lines = text.split("\n")
  const frame = []
  for (let i = 0; i < lines.length; i++) {
    frame.push(lines[i])
    const section = exp.sections.find((item) => item.keep !== undefined && !kept.has(item.keep) && lines[i].trim() === keepMarks(ws, item.keep)[0])
    if (!section) continue
    const end = lines.findIndex((line, j) => j > i && line.trim() === keepMarks(ws, section.keep)[1])
    if (end < 0) continue
    kept.set(section.keep, lines.slice(i + 1, end))
    i = end - 1
  }
  return { kept, frame: frame.join("\n") }
}

/** The configured exports, checked: `{ name, file, path, sections, retitle }`. */
export function exportsOf(ws) {
  const m = ws.labels.messages
  const list = ws.exports ?? []
  if (!Array.isArray(list)) throw new Error(m["exports-not-list"])
  let items
  const itemSources = () => items ??= sourcesOf(ws).filter((source) => (source.kind ?? "items") === "items").map((source) => source.name)
  const seen = new Set()
  return list.map((given, index) => {
    const bad = (field) => { throw new Error(format(m["export-invalid"], { index, field })) }
    if (!given || typeof given !== "object") bad("export")
    if (typeof given.name !== "string" || !NAME.test(given.name)) bad("name")
    if (seen.has(given.name)) throw new Error(format(m["export-duplicate"], { name: given.name }))
    seen.add(given.name)
    if (typeof given.file !== "string" || !given.file.trim()) bad("file")
    const path = localPath(ws, given.file)
    // A file inside the graph would become a page of the memo it is made from.
    if (inside(path, ws.graphDir) || inside(path, ws.cacheDir)) bad("file")
    if (!names(given.retitle) || (given.retitle ?? []).some((name) => !itemSources().includes(name))) bad("retitle")
    if (!Array.isArray(given.sections) || !given.sections.length) bad("sections")
    const keeps = new Set()
    const sections = given.sections.map((section, i) => {
      const at = `sections[${i}]`
      if (!section || typeof section !== "object") bad(at)
      if (section.keep !== undefined || section.include !== undefined) {
        // A kept part or an included file picks no tasks, so it takes only a heading.
        if (section.keep !== undefined && section.include !== undefined) bad(at)
        for (const key of Object.keys(section)) if (!OWN_SECTION.includes(key)) bad(`${at}.${key}`)
        if (section.heading !== undefined && typeof section.heading !== "string") bad(`${at}.heading`)
        if (section.pad !== undefined && (section.keep === undefined || !(Number.isInteger(section.pad) && section.pad >= 0 && section.pad <= 3)))
          throw new Error(format(m["export-pad"], { index, at }))
        if (section.keep !== undefined) {
          if (typeof section.keep !== "string" || !KEEP_NAME.test(section.keep) || keeps.has(section.keep)) bad(`${at}.keep`)
          keeps.add(section.keep)
          return { ...section }
        }
        if (typeof section.include !== "string" || !section.include.trim()) bad(`${at}.include`)
        return { ...section, includePath: localPath(ws, section.include) }
      }
      if (typeof section.line !== "string" || !section.line.trim()) bad(`${at}.line`)
      for (const key of ["heading", "child", "deadline"]) if (section[key] !== undefined && typeof section[key] !== "string") bad(`${at}.${key}`)
      // The order kept in the file is found below the section's heading.
      if (section.order !== undefined && (!ORDERS.includes(section.order) || (section.order === "file" && !section.heading?.trim()))) bad(`${at}.order`)
      for (const key of ["states", "nodes", "tags", "without"]) if (!names(section[key])) bad(`${at}.${key}`)
      if (section.states?.some((state) => !OPEN.test(state.toUpperCase()))) bad(`${at}.states`)
      for (const key of ["keyed", "once"]) if (section[key] !== undefined && typeof section[key] !== "boolean") bad(`${at}.${key}`)
      if (section.gap !== undefined && !(Number.isInteger(section.gap) && section.gap >= 0 && section.gap <= 3)) bad(`${at}.gap`)
      for (const key of ["line", "child"]) for (const [, field] of (section[key] ?? "").matchAll(FIELD))
        if (!EXPORT_FIELDS.includes(field)) throw new Error(format(m["export-field-unknown"], { index, field: `{${field}}`, fields: EXPORT_FIELDS.map((name) => `{${name}}`).join(" ") }))
      for (const [, field] of (section.deadline ?? "").matchAll(FIELD))
        if (!DEADLINE_FIELDS.includes(field)) throw new Error(format(m["export-field-unknown"], { index, field: `{${field}}`, fields: DEADLINE_FIELDS.map((name) => `{${name}}`).join(" ") }))
      return { ...section, states: section.states?.map((state) => state.toUpperCase()) }
    })
    return { name: given.name, file: given.file, path, sections, retitle: given.retitle ?? [] }
  })
}

/**
 * A line of the memo as an export reads it: its state, its words (`title`), the keys of its key
 * links, its other links, and the tags and pages it names. A link labelled with a key gives the key;
 * one labelled with a source's name, or with its own address, gives only its link.
 */
export function readLine(text, { key, labels = new Set() } = {}) {
  let rest = text
  const state = rest.match(MARKER)?.[0]
  if (state) rest = rest.slice(state.length)
  rest = rest.replace(/^\s*\[#[A-Z]\]/, " ")
  const keys = []
  const links = []
  const tags = []
  rest = rest.replace(MD_LINK, (whole, label, url) => {
    const name = label.trim()
    if (key?.test(name)) { keys.push(name); return " " }
    links.push(url)
    return !name || labels.has(name) || name === url ? " " : ` ${name} `
  })
  for (const url of urlsIn(rest)) { links.push(url); rest = rest.replace(url, " ") }
  rest = rest.replace(/(^|\s)#\[\[([^\]\n]+)\]\]/g, (whole, lead, tag) => { tags.push(tag); return lead })
    .replace(/(^|\s)#([^\s#.,!?()[\]]+)/g, (whole, lead, tag) => { tags.push(tag); return lead })
    .replace(/\[\[([^\]\n]+)\]\]/g, (whole, page) => { tags.push(page); return page })
    .replace(/\*\*/g, "")
  return { state: state ?? "", title: oneLine(rest), keys, links, tags }
}

/** The pages tasks are read from, in the order of the tree, then the journals by date; knowledge and the engine's own nodes aside. */
function pagesOf(ws, model) {
  const isKnowledge = knowledgeOf(ws, model)
  const pages = []
  const walk = (id, chain) => {
    for (const child of model.children.get(id) ?? []) {
      if (model.managed(child) || isKnowledge(child)) continue
      const doc = model.docs.get(child)
      const names = [...chain, folded(pageOf(child))]
      pages.push({ node: pageOf(child), chain: names, rel: doc.sourcePath, text: doc.source.text })
      walk(child, names)
    }
  }
  walk(ROOT, [])
  for (const page of walkGraph(ws).pages.filter((item) => item.journal).sort((a, b) => a.rel.localeCompare(b.rel)))
    pages.push({ node: page.name, chain: [], rel: page.rel, text: readFileSync(page.path, "utf8") })
  return pages
}

/** Every open task of a page with what an export writes of it, and the notes and open items below it. */
function tasksOf(ws, page, reading) {
  const text = authoredText(page.text, ws.labels.region)
  const lines = text.split("\n")
  const { items } = markdownStructure(text)
  const tasks = []
  items.forEach((item, index) => {
    if (!OPEN.test(item.text)) return
    const notes = item.ownLines.filter((i) => i > item.start && lines[i].trim() && !PROPERTY.test(lines[i])).map((i) => readLine(lines[i].trim(), reading))
    const below = items.filter((child) => child.ancestors[0] === index && !CLOSED.test(child.text)).map((child) => readLine(child.text, reading))
    const due = item.ownLines.map((i) => lines[i].match(DEADLINE)).find(Boolean)
    const deadline = due ? { date: `${due[1]}-${due[2]}-${due[3]}`, year: due[1], month: String(Number(due[2])), day: String(Number(due[3])) } : null
    tasks.push({ ...readLine(item.text, reading), index, parent: item.ancestors[0], raw: item.text, node: page.node, chain: page.chain,
      page: page.rel, line: item.start + 1, deadline, children: [...notes, ...below].filter((child) => child.title || child.links.length) })
  })
  return tasks
}

function chosen(section, task) {
  const named = new Set(task.tags.map(folded))
  const under = (name) => task.chain.includes(folded(name))
  if (section.without?.some((name) => named.has(folded(name)) || under(name))) return false
  const asked = Boolean(section.states?.length || section.nodes?.length || section.tags?.length || section.keyed)
  return !asked || Boolean(section.states?.includes(task.state) || section.nodes?.some(under)
    || section.tags?.some((name) => named.has(folded(name))) || (section.keyed && task.keys.length))
}

const fill = (template, task) => template.replace(FIELD, (whole, field) => ({
  title: task.title, key: task.keys[0] ?? "", keys: task.keys.join(", "), link: task.links[0] ?? "",
  links: task.links.join(" "), state: task.state, node: task.node,
}[field] ?? "")).replace(/(\S) {2,}/g, "$1 ").trimEnd()
const fillDate = (template, due) => template.replace(FIELD, (whole, field) => due[field] ?? "").trimEnd()

/**
 * Where a task section stands in a file's lines: `{ from, to }` from below its heading to the next
 * section's heading or kept part, or null when the heading is not there.
 */
function sectionSpan(ws, exp, index, lines) {
  const head = exp.sections[index].heading.split("\n")
  const start = lines.findIndex((line, i) => head.every((part, k) => lines[i + k] === part))
  if (start < 0) return null
  const from = start + head.length
  const stops = new Set(exp.sections.slice(index + 1).flatMap((section) => [
    section.heading?.split("\n").find((line) => line.trim()),
    section.keep === undefined ? undefined : keepMarks(ws, section.keep)[0],
  ]).filter(Boolean))
  const to = lines.findIndex((line, i) => i >= from && stops.has(line))
  return { from, to: to < 0 ? lines.length : to }
}

/** A section's lines as entries: a line that starts an entry and the lines below it (indented, or a child or deadline line). */
function entriesIn(section, lines) {
  const prefixes = [section.child, section.deadline].map((template) => template?.split("{")[0]).filter((prefix) => prefix?.trim())
  const entries = []
  for (const line of lines) {
    if (!line.trim()) continue
    if (entries.length && (/^\s/.test(line) || prefixes.some((prefix) => line.startsWith(prefix)))) entries.at(-1).push(line)
    else entries.push([line])
  }
  return entries
}

/**
 * The entries of an ordered section in the order the file has them: each entry of the file takes the
 * task it shows (the same line, else its key, its link or its title), and the tasks the file does not
 * show yet follow in the memo's order. An entry of the file no task matches is left out.
 */
function inFileOrder(rendered, shown) {
  const words = (line) => new Set(line.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))
  const passes = [
    (entry, line) => entry.main === line,
    (entry, line) => entry.task.keys.some((key) => words(line).has(key)),
    (entry, line) => entry.task.links.some((url) => line.includes(normalUrl(url))),
    (entry, line) => entry.task.title.length >= 4 && line.includes(entry.task.title),
  ]
  const taken = shown.map(() => -1)
  const used = new Set()
  for (const pass of passes) shown.forEach((line, i) => {
    if (taken[i] >= 0) return
    const at = rendered.findIndex((entry, j) => !used.has(j) && pass(entry, line))
    if (at >= 0) { taken[i] = at; used.add(at) }
  })
  return [...taken.filter((at) => at >= 0).map((at) => rendered[at]), ...rendered.filter((entry, j) => !used.has(j))]
}

/** A file's text with the entries of its ordered sections sorted, so that moving entries alone changes nothing. */
function orderFree(ws, exp, text) {
  if (text === undefined) return text
  let lines = text.split("\n")
  exp.sections.forEach((section, index) => {
    if (section.order !== "file") return
    const span = sectionSpan(ws, exp, index, lines)
    if (!span) return
    const sorted = entriesIn(section, lines.slice(span.from, span.to)).map((entry) => entry.join("\n")).sort()
    lines = [...lines.slice(0, span.from), ...sorted, ...lines.slice(span.to)]
  })
  return lines.join("\n")
}

/**
 * The text of an export, the number of tasks in it and the tasks still titled as their source titled
 * them. `kept` holds what the owner wrote in the kept parts of the file as it is now, and `previous`
 * the file as it is now, whose order an ordered section keeps.
 */
function render(ws, exp, pages, reading, collected, kept = new Map(), previous = undefined) {
  const previousLines = previous?.split("\n")
  const tasks = pages.map((page) => tasksOf(ws, page, reading))
  const blocks = []
  const retitle = []
  let count = 0
  for (const [index, section] of exp.sections.entries()) {
    if (section.keep !== undefined) {
      const [start, end] = keepMarks(ws, section.keep)
      let own = kept.get(section.keep) ?? []
      // With a pad, the owner's lines lose their own blank edges and get the pad's, so every rewrite
      // writes the same; an empty part keeps one pad of blank lines to type into.
      if (section.pad) {
        const first = own.findIndex((line) => line.trim())
        const last = own.findLastIndex((line) => line.trim())
        const blank = Array(section.pad).fill("")
        own = first < 0 ? blank : [...blank, ...own.slice(first, last + 1), ...blank]
      }
      blocks.push([section.heading, start, ...own, end].filter((part) => part !== undefined).join("\n"))
      continue
    }
    if (section.include !== undefined) {
      // A file not written yet leaves only the heading.
      const body = existsSync(section.includePath) ? readFileSync(section.includePath, "utf8").replace(/\s+$/, "") : ""
      if (section.heading !== undefined || body) blocks.push([section.heading, body].filter((part) => part !== undefined && part !== "").join("\n"))
      continue
    }
    const picked = tasks.flatMap((list) => {
      const picked = new Set(list.filter((task) => chosen(section, task)).map((task) => task.index))
      // A task below a picked task is written as one of its lines, not again on its own.
      return list.filter((task) => picked.has(task.index) && !picked.has(task.parent))
    })
    // A section written once leaves out a task whose key or link the file already shows above it.
    const above = section.once ? blocks.join("\n") : ""
    const aboveWords = new Set(above.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean))
    const entries = section.once
      ? picked.filter((task) => !task.keys.some((key) => aboveWords.has(key)) && !task.links.some((url) => linkIn(above, url)))
      : picked
    count += entries.length
    for (const task of entries) for (const url of task.links) {
      const title = collected.get(normalUrl(url))
      if (title && oneLine(task.raw).includes(title)) retitle.push({ title: task.title, url, page: task.page, line: task.line })
    }
    const gap = "\n".repeat((section.gap ?? 0) + 1)
    let written = entries.map((task) => ({ task, main: fill(section.line, task), lines: [
      fill(section.line, task),
      ...(section.child === undefined ? [] : task.children.map((child) => fill(section.child, { ...child, node: task.node }))),
      ...(section.deadline !== undefined && task.deadline ? [fillDate(section.deadline, task.deadline)] : []),
    ] }))
    if (section.order === "file" && previousLines) {
      const span = sectionSpan(ws, exp, index, previousLines)
      if (span) written = inFileOrder(written, entriesIn(section, previousLines.slice(span.from, span.to)).map((entry) => entry[0].trimEnd()))
    }
    const body = written.map((entry) => entry.lines.join("\n")).join(gap)
    if (section.heading !== undefined || body) blocks.push([section.heading, body].filter((part) => part !== undefined && part !== "").join("\n"))
  }
  return { text: blocks.length ? `${blocks.join("\n\n")}\n` : "", count, retitle: [...new Map(retitle.map((item) => [`${item.page}:${item.line}`, item])).values()] }
}

const readState = (ws) => { try { return JSON.parse(readFileSync(join(ws.cacheDir, STATE_FILE), "utf8")) } catch { return {} } }

/**
 * Writes the exports (or the one called `only`) from the memo. Each result says what became of its
 * file: written, current, edited (changed by hand since it was written; left alone), exists (a file
 * the engine did not write; left alone), or, with `dryRun`, missing or outdated. `force` replaces an
 * edited or foreign file. `retitle` lists tasks of the export's `retitle` sources whose line still
 * carries the title the source gave.
 */
export function writeExports(ws, { model, only, dryRun = false, force = false } = {}) {
  const m = ws.labels.messages
  const list = exportsOf(ws).filter((exp) => !only || exp.name === only)
  if (only && !list.length) throw new Error(format(m["export-unknown"], { name: only }))
  if (!list.length) return []
  model ??= prepare(ws).model
  const pages = pagesOf(ws, model)
  const sources = sourcesOf(ws).filter((source) => (source.kind ?? "items") === "items")
  const keyed = sources.filter((source) => source.key).map((source) => source.key)
  const reading = { key: keyed.length ? new RegExp(`^(?:${keyed.join("|")})$`) : undefined, labels: new Set(sources.map((source) => source.label).filter(Boolean)) }
  const sourceState = readSourceState(ws)
  const state = readState(ws)
  const results = []
  for (const exp of list) {
    const collected = new Map()
    for (const name of exp.retitle) for (const item of Object.values(sourceState[name]?.items ?? {}))
      if (item.title) for (const url of item.urls ?? [item.url]) collected.set(normalUrl(url), oneLine(item.title))
    const before = existsSync(exp.path) ? readFileSync(exp.path, "utf8") : undefined
    const { kept, frame: written } = keptParts(ws, exp, before)
    const { text, count, retitle } = render(ws, exp, pages, reading, collected, kept, before)
    const frame = keptParts(ws, exp, text).frame
    const ordered = exp.sections.some((section) => section.order === "file")
    const where = canonical(exp.path)
    const recorded = state[exp.name]
    const record = recorded && (recorded.path === where || canonical(movedTo(ws, recorded.path)) === where) ? recorded : undefined
    let outcome
    if (before === text) outcome = "current"
    // Entries the owner only moved in an ordered section are no edit by hand: the rewrite keeps their order.
    else if (before !== undefined && !force && sha(written) !== record?.sha && !(record?.sorted && sha(orderFree(ws, exp, written)) === record.sorted)) outcome = record ? "edited" : "exists"
    else outcome = dryRun ? (before === undefined ? "missing" : "outdated") : "written"
    if (!dryRun && outcome === "written") {
      mkdirSync(dirname(exp.path), { recursive: true })
      writeAtomic(exp.path, text)
    }
    // The record is of what the engine wrote, so the owner's kept parts may change between builds.
    if (outcome === "written" || outcome === "current") state[exp.name] = { path: canonical(exp.path), sha: sha(frame), ...(ordered ? { sorted: sha(orderFree(ws, exp, frame)) } : {}) }
    results.push({ name: exp.name, file: exp.file, path: exp.path, state: outcome, items: count, retitle })
  }
  if (!dryRun) {
    mkdirSync(ws.cacheDir, { recursive: true })
    writeAtomic(join(ws.cacheDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`)
  }
  return results
}

/** What writing the exports now would do, changing nothing. */
export const exportStatus = (ws, options = {}) => writeExports(ws, { ...options, dryRun: true })
