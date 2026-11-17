import { gfmToMarkdown } from "mdast-util-gfm"
import { toMarkdown } from "mdast-util-to-markdown"
import { SKIP, visit } from "unist-util-visit"
import { compileDocument } from "@cudoment/cudoc/markdown"
import { LOCALES } from "../labels.mjs"

// All file-format decisions for Tine's Logseq-compatible Markdown live here.
export const OPEN = /^(TODO|DOING|NOW|LATER|WAITING)(\s|$)/
export const CLOSED = /^(DONE|CANCELED|CANCELLED)(\s|$)/
export const MARKER = /^(?:TODO|DOING|NOW|LATER|WAITING|DONE|CANCELED|CANCELLED)(?=\s|$)/
/** A bullet line whose block is a task, open or closed. */
export const isTaskLine = (line) => MARKER.test(line.match(/^\s*- (.*)$/)?.[1] ?? "")
// Note prefixes and the question tag (`markers` in the labels) are recognized in every language,
// whatever the locale, so a memo keeps working when its language setting changes.
const markerWords = (kind) => [...new Set(Object.values(LOCALES).map((locale) => locale.markers[kind]))]
  .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
export const IDEA = new RegExp(`(?:^|\\s)(?:${markerWords("idea")}):`)
export const DECISION = new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?(?:${markerWords("decision")}):`)
export const NOTE_PREFIX = new RegExp(`^(?:${markerWords("idea")}|${markerWords("decision")}):\\s*`)
export const CHECK_TAG = new RegExp(`#(?:${markerWords("check")})(?=\\s|$|[.,!?])`)
export const LINK = /\[\[([^\]\n]+)\]\]/g
export const COLLAPSED = /^(\t*)  collapsed:: (true|false)\s*$/
export const wikiLink = (name) => `[[${name.normalize("NFC")}]]`
// Keep source positions for edits; never serialize the owner's body through mdast.
// Each text is parsed once into the little the rules read: literal (code and HTML) lines, top-level
// headings and bulleted list items. Entries are small, so the cache holds every page of a large graph.
const STRUCTURE_LIMIT = 20000
const structures = new Map()
const nodeText = (node) => node.value ?? (node.children ?? []).map(nodeText).join("")
export function markdownStructure(text) {
  const cached = structures.get(text)
  if (cached) return cached
  const tree = compileDocument(text).tree
  const lines = text.split("\n")
  const literalLines = new Set()
  // Source ranges of code and HTML, inline or block, where a `[[link]]` is only text.
  const literalRanges = []
  visit(tree, (node) => {
    if (!["code", "html", "inlineCode"].includes(node.type)) return
    literalRanges.push([node.position.start.offset, node.position.end.offset])
    if (node.type === "inlineCode") return
    for (let i = node.position.start.line - 1; i < node.position.end.line; i++) literalLines.add(i)
  })
  const headings = tree.children.filter((node) => node.type === "heading")
    .map((node) => ({ depth: node.depth, text: nodeText(node).trim(), line: node.position.start.line - 1, end: node.position.end.line - 1 }))
  // Items in document order; `ancestors` lists the bulleted items around each one, nearest first.
  const items = []
  const walk = (node, ancestors) => {
    if (["code", "html", "blockquote"].includes(node.type)) return
    let around = ancestors
    if (node.type === "listItem") {
      const start = node.position.start.line - 1
      const bullet = lines[start]?.match(BULLET)
      if (bullet) {
        const ownLines = node.children.filter((child) => child.type === "paragraph").flatMap((child) =>
          Array.from({ length: child.position.end.line - child.position.start.line + 1 }, (_, i) => child.position.start.line - 1 + i))
        const properties = ownLines.filter((i) => i > start).map((i) => lines[i].trim()).filter((line) => /^(?:DEADLINE|SCHEDULED):/.test(line))
        items.push({ start, end: node.position.end.line, width: widthOf(lines[start]), prefix: bullet[1], text: bullet[2], properties, ownLines, ancestors })
        around = [items.length - 1, ...ancestors]
      }
    }
    for (const child of node.children ?? []) walk(child, around)
  }
  walk(tree, [])
  const blocks = tree.children.map((node) => ({ type: node.type, line: node.position.start.line - 1, end: node.position.end.line - 1 }))
  const result = { literalLines, literalRanges, headings, items, blocks, tasks: new Map() }
  if (structures.size >= STRUCTURE_LIMIT) structures.delete(structures.keys().next().value)
  structures.set(text, result)
  return result
}
// Tine may save the generated heading as a list item (`- ## Subpages`), its location line as that
// item's continuation and blank items above it. The section still starts there; the build straightens it.
const bulletRegion = (region) => `- ## ${region}`
export function regionStart(text, region) {
  const { headings, literalLines } = markdownStructure(text)
  const heading = headings.find((item) => item.depth === 2 && item.text === region)
  if (heading) return heading.line
  return text.split("\n").findIndex((line, i) => !literalLines.has(i) && line.trimEnd() === bulletRegion(region))
}
/**
 * A section an outliner saved with its heading as a list item, put back in the shape the build writes:
 * the authored part without the empty items and blank lines above the section, and the section with
 * its heading, its location line, one blank line and the subtree. Undefined when the section is fine.
 */
export function straightenRegion(lines, at, region) {
  if (lines[at]?.trimEnd() !== bulletRegion(region)) return undefined
  let end = at
  while (end > 0 && /^\s*(?:-\s*)?$/.test(lines[end - 1])) end--
  const section = [`## ${region}`]
  let i = at + 1
  // The heading item's own lines: its location line, and `collapsed::`, a view setting, which goes. Any
  // other property (an `id::` a block reference needs) stays, so the section no longer matches and is kept.
  for (; i < lines.length && /^ {2}\S/.test(lines[i]) && !/^ {2}- /.test(lines[i]); i++)
    if (!/^ {2}collapsed:: (?:true|false)\s*$/.test(lines[i])) section.push(lines[i].slice(2))
  const rest = lines.slice(i).filter((line) => line.trim())
  return { authored: `${lines.slice(0, end).join("\n")}\n`, current: [...section, ...(rest.length ? ["", ...rest] : [])].join("\n").trimEnd() }
}
export const authoredText = (text, region) => {
  const lines = text.split("\n")
  const end = regionStart(text, region)
  return (end < 0 ? text : lines.slice(0, end).join("\n"))
}
/** Open tasks of the authored part, computed once per text; each call gets its own copies. */
export function taskLines(text, region) {
  const memo = markdownStructure(text).tasks
  if (!memo.has(region)) {
    const lines = authoredText(text, region).split("\n")
    memo.set(region, blocksOf(lines, 0, lines.length).filter((block) => OPEN.test(block.text)).map((block) => ({
      text: block.text, line: block.start + 1, end: block.end, properties: block.properties,
      ownLines: block.ownLines.filter((i) => !COLLAPSED.test(lines[i])),
    })))
  }
  return memo.get(region).map((task) => ({ ...task, properties: [...task.properties], ownLines: [...task.ownLines] }))
}
export function serializeTree(nodes, depth = 0) {
  return nodes.flatMap((node) => {
    const indent = "\t".repeat(depth)
    const cells = node.cells.map((cell) => cell.url ? wikiLink(node.name) : cell.text.normalize("NFC")).filter(Boolean)
    return [
      `${indent}- ${cells.join(" · ") || wikiLink(node.name)}`,
      ...(node.children.length ? [`${indent}  collapsed:: true`, ...serializeTree(node.children, depth + 1)] : []),
    ]
  })
}
/** Where a node sits: links from the view that holds the whole tree down to its parent, then its own name. */
export const locationLine = (label, ancestors, name) =>
  `${label}: ${[...ancestors.map(wikiLink), name.normalize("NFC")].join(" › ")}`
// Home opens first and stays pinned in the sidebar favorites, which Tine and Logseq read from here.
export function configTemplate(home) {
  return ["{:meta/version 1", " :preferred-format :markdown", " :preferred-workflow :todo",
    " :file/name-format :triple-lowbar", ' :journal/page-title-format "yyyy-MM-dd EEE"',
    ' :journal/file-name-format "yyyy_MM_dd"', ` :default-home {:page "${home}"}`, ` :favorites ["${home}"]`, " :hidden []}", ""].join("\n")
}

const MACRO = /\{\{.*?\}\}/g
const DATE_NAME = /^(\d{4}[-_/]\d{2}[-_/]\d{2}|[A-Z][a-z]{2} \d{1,2}(st|nd|rd|th), \d{4})$/
/** The `[[page]]` links of a text outside code, HTML and macros, with their 0-based lines. */
// Blank out code and HTML in place, keeping line breaks, so the links around them stay on their lines.
function visibleText(text) {
  let visible = ""
  let at = 0
  for (const [start, end] of markdownStructure(text).literalRanges) {
    if (start < at) continue
    visible += text.slice(at, start) + text.slice(start, end).replace(/[^\n]/g, " ")
    at = end
  }
  return visible + text.slice(at)
}
export function linkTargets(text) {
  return visibleText(text).split("\n").flatMap((line, i) =>
    [...line.replace(MACRO, "").matchAll(LINK)].map((match) => ({ line: i, target: match[1].normalize("NFC") })))
}
const EMBED = /\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}/g
/** The pages a text shows whole with `{{embed [[Page]]}}`, outside code and HTML. */
export function embedTargets(text) {
  return visibleText(text).split("\n").flatMap((line, i) =>
    [...line.matchAll(EMBED)].map((match) => ({ line: i, target: match[1].normalize("NFC") })))
}
/**
 * The start lines of the heading blocks in a text: bulleted headings with items indented under them
 * (`- ### Work`, then `\t- …`). An outliner that bullets a heading (`- ## Now`) leaves what followed
 * it beside it, not under it; an owner groups items under a heading block on purpose, since outliners
 * show a heading outside a list at the depth of the items around it.
 */
export function headingBlocks(text) {
  const { items } = markdownStructure(text)
  const parents = new Set(items.flatMap((item) => item.ancestors))
  return new Set(items.filter((item, i) => parents.has(i) && /^#{1,6}\s/.test(item.text)).map((item) => item.start))
}

/**
 * The top-level items of the first list in a text: the first list of an owner's Home. An outliner
 * may turn the next heading into an item (`- ## Now`); the list ends there too. A heading block with
 * items under it is one of the list's items.
 */
export function firstListItems(text) {
  const { blocks, items } = markdownStructure(text)
  const list = blocks.find((block) => block.type === "list")
  if (!list) return []
  const grouped = headingBlocks(text)
  const top = items.filter((item) => !item.ancestors.length && item.start >= list.line && item.start <= list.end)
  const heading = top.findIndex((item) => /^#{1,6}\s/.test(item.text) && !grouped.has(item.start))
  return heading < 0 ? top : top.slice(0, heading)
}
export function scanLines(text, page, names, add, ws) {
  let inList = false
  const authored = authoredText(text, ws.labels.region)
  for (const line of headingSpacing(authored)) {
    const where = { file: page.rel, line: line + 1 }
    add("warning", "heading-spacing", `${page.rel}:${line + 1}`, where, where)
  }
  for (const line of paragraphGaps(authored)) {
    const where = { file: page.rel, line: line + 1 }
    add("warning", "paragraph-gap", `${page.rel}:${line + 1}`, where, where)
  }
  const { literalLines } = markdownStructure(authored)
  const grouped = headingBlocks(authored)
  authored.split("\n").forEach((ln, i) => {
    const where = { file: page.rel, line: i + 1 }
    const issue = (severity, code) => add(severity, code, `${page.rel}:${i + 1}`, where, where)
    if (literalLines.has(i)) {
      if (inList && ln.trim() && !/^\s/.test(ln)) { issue("error", "list-trailing-text"); inList = false }
      return
    }
    if (/^\s*- #{1,6}\s/.test(ln) && !grouped.has(i)) issue("warning", "bullet-heading")
    if (/^#{1,6}\s/.test(ln)) inList = false
    else if (/^\s*-(\s|$)/.test(ln)) inList = true
    else if (ln.trim() && !/^\s/.test(ln) && inList) { issue("error", "list-trailing-text"); inList = false }
  })
  for (const { line, target } of linkTargets(authored)) {
    const where = { file: page.rel, line: line + 1 }
    if (!names.has(target.toLowerCase()) && !DATE_NAME.test(target))
      add("warning", "dangling-link", `${page.rel}|${target}`, { ...where, target }, where)
  }
}

export const raw = (value) => ({ type: "html", value })
export const markdownOptions = {
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
  bullet: "-",
  listItemIndent: "one",
}
const OUTLINE_FENCES = new Set(["outline", "tine"])

/** Tine does not wrap long text in table cells, so a table becomes one block per row. */
function tableToBlocks(table) {
  const cell = (node) => toMarkdown({ type: "paragraph", children: node.children }, markdownOptions).trim()
  const lines = table.children.slice(1).map((row) => {
    const cells = row.children.map(cell)
    const head = cells.slice(0, -1).filter(Boolean).join(" · ")
    const tail = cells.at(-1)
    if (!head) return `- ${tail}`
    return tail ? `- ${head}\n  ${tail}` : `- ${head}`
  })
  return raw(lines.join("\n"))
}

/** Turns the mdast cudoc resolved for a view into an outliner page. */
export function toOutline(tree, model) {
  const title = tree.children.findIndex((node) => node.type === "heading" && node.depth === 1)
  if (title >= 0) tree.children.splice(title, 1)
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return

    if (node.type === "code" && OUTLINE_FENCES.has(node.lang)) {
      parent.children[index] = raw(node.value)
      return SKIP
    }
    if (node.type === "link") {
      const id = model.idForUrl(node.url)
      if (id) {
        parent.children[index] = raw(wikiLink(id.split("/").at(-1)))
        return SKIP
      }
    }
    // A [[page]] in the source is plain text to cudoc; keep its brackets unescaped.
    if (node.type === "text" && node.value.includes("[[")) {
      const parts = node.value.split(/(\[\[[^\]\n]+\]\])/).filter(Boolean)
      parent.children.splice(
        index,
        1,
        ...parts.map((part) => (part.startsWith("[[") ? raw(part) : { type: "text", value: part })),
      )
      return [SKIP, index + parts.length]
    }
  })
  visit(tree, "table", (node, index, parent) => {
    parent.children[index] = tableToBlocks(node)
    return SKIP
  })
  return tree
}

const keyOf = (bullet) => (bullet.match(/\[\[[^\]]+\]\]/) ?? [bullet.replace(/^\t*- /, "").trim()])[0]

/**
 * Which lines the reader collapsed or expanded. A line that had no children
 * could not be collapsed, so it says nothing about the reader's choice.
 */
export function collapseState(text) {
  const state = new Map()
  const lines = text.split("\n")
  const { literalLines } = markdownStructure(text)
  const depths = lines.map((ln, i) => literalLines.has(i) ? undefined : ln.match(/^(\t*)- /)?.[1].length)
  lines.forEach((ln, i) => {
    if (depths[i] === undefined) return
    const next = depths.slice(i + 1).find((depth) => depth !== undefined)
    if (next === undefined || next <= depths[i]) return
    state.set(keyOf(ln), lines[i + 1]?.match(COLLAPSED)?.[2] === "true")
  })
  return state
}

export function applyCollapse(text, state) {
  const lines = text.split("\n")
  const { literalLines } = markdownStructure(text)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (literalLines.has(i)) { out.push(ln); continue }
    if (COLLAPSED.test(ln)) continue
    out.push(ln)
    const bullet = ln.match(/^(\t*)- /)
    if (!bullet) continue
    const generated = lines[i + 1]?.match(COLLAPSED)
    const key = keyOf(ln)
    const want = state.has(key) ? state.get(key) : generated?.[2] === "true"
    if (want) out.push(`${bullet[1]}  collapsed:: true`)
  }
  return out.join("\n")
}

export function withoutCollapse(text) {
  const { literalLines } = markdownStructure(text)
  return text.split("\n").filter((ln, i) => literalLines.has(i) || !COLLAPSED.test(ln)).join("\n").trimEnd()
}

// A path line's branch and window names follow the folder's state, not the owner's writing.
const PATH_LINE = /^(\s*)`((?:\/|~\/)[^`]+)`(?: · `[^`]*`)?(?: · [^:`]+: .+)?$/
// Layout is not an authored change: blank lines, trailing spaces and whether a line is a bullet.
export const meaningfulText = (text, region) => withoutCollapse(authoredText(text, region)).split("\n")
  .filter((line) => line.trim()).map((line) => line.trimEnd().replace(/^(\s*)[-*+] /, "$1").replace(PATH_LINE, "$1`$2`")).join("\n")

/**
 * The memo's heading layout: a heading's content starts on the very next line, and one blank line
 * stands above every heading but the first line. Tine shows a blank line under a heading as a gap
 * inside the heading's block. `headingSpacing` lists the lines of headings that break it.
 */
function headingLayout(text) {
  const lines = text.split("\n")
  const { headings } = markdownStructure(text)
  const starts = new Set(headings.map((heading) => heading.line))
  return headings.map((heading) => {
    let next = heading.end + 1
    while (next < lines.length && !lines[next].trim()) next++
    // A heading without content keeps the blank line that the next heading needs above it.
    const gapBelow = next < lines.length && next > heading.end + 1 && !starts.has(next) ? [heading.end + 1, next] : undefined
    const tightAbove = heading.line > 0 && Boolean(lines[heading.line - 1].trim())
    return { line: heading.line, gapBelow, tightAbove }
  }).filter((heading) => heading.gapBelow || heading.tightAbove)
}
export const headingSpacing = (text) => headingLayout(text).map((heading) => heading.line)

/**
 * Text under a heading stays in the heading's block until the next bullet or heading, and Tine shows
 * a blank line inside that block as a gap. So a heading takes at most one paragraph (or other text)
 * of its own; anything after a blank line belongs in a list item. Returns those blocks.
 */
function blockGaps(text) {
  const { blocks } = markdownStructure(text)
  const gaps = []
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "heading") continue
    for (let j = i + 2; j < blocks.length && !["heading", "list"].includes(blocks[j].type); j++)
      if (blocks[j].line - blocks[j - 1].end > 1) gaps.push(blocks[j])
  }
  return gaps
}
export const paragraphGaps = (text) => blockGaps(text).map((block) => block.line)
/** Turns the paragraphs that `paragraphGaps` reports into list items joined to the list after them. */
export function bulletParagraphs(text) {
  const gaps = blockGaps(text).filter((block) => block.type === "paragraph")
  if (!gaps.length) return text
  const lines = text.split("\n")
  const { blocks } = markdownStructure(text)
  const converted = new Set(gaps.map((block) => block.line))
  const drop = new Set()
  for (const block of gaps) {
    for (let i = block.line; i <= block.end; i++) lines[i] = `${i === block.line ? "- " : "  "}${lines[i].trim()}`
    // Join the item to the next converted paragraph or to the list that follows it.
    const next = blocks.find((other) => other.line > block.end)
    if (next && (converted.has(next.line) || next.type === "list")) for (let i = block.end + 1; i < next.line; i++) drop.add(i)
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n")
}
/** Removes blank lines under headings and adds one above headings that lack it. */
export function tightenHeadings(text) {
  const layout = headingLayout(text)
  if (!layout.length) return text
  const lines = text.split("\n")
  const drop = new Set(layout.flatMap(({ gapBelow }) => gapBelow ? Array.from({ length: gapBelow[1] - gapBelow[0] }, (_, i) => gapBelow[0] + i) : []))
  const spaced = new Set(layout.filter((heading) => heading.tightAbove).map((heading) => heading.line))
  return lines.flatMap((line, i) => drop.has(i) ? [] : spaced.has(i) ? ["", line] : [line]).join("\n")
}


const BULLET = /^(\s*)- (.*)$/

/** Visual indent: a tab counts as a whole level, so a child always sits deeper. */
const widthOf = (ln) => {
  const lead = ln.match(/^\s*/)[0]
  return [...lead].reduce((sum, ch) => sum + (ch === "\t" ? 8 : 1), 0)
}

/** The outline blocks of some lines: each bullet with the lines nested under it. */
export function blocksOf(lines, from, to) {
  const { items } = markdownStructure(lines.join("\n"))
  const made = new Map()
  const blocks = []
  items.forEach((item, index) => {
    if (item.start < from || item.start >= to) return
    // An item outside the range is not a block; its children belong to the nearest block around it.
    const parent = made.get(item.ancestors.find((at) => made.has(at)))
    const block = { start: item.start, end: Math.min(item.end, to), width: item.width, prefix: item.prefix, text: item.text,
      parent, children: [], properties: [...item.properties], ownLines: [...item.ownLines] }
    parent?.children.push(block)
    made.set(index, block)
    blocks.push(block)
  })
  return blocks
}

export const descendants = (block) => block.children.flatMap((child) => [child, ...descendants(child)])

export function authoredEnd(lines, ws) {
  const at = regionStart(lines.join("\n"), ws.labels.region)
  return at < 0 ? lines.length : at
}

/** Visible nonblank source rows, honoring folds; query results and wrapping are separate. */
export function visibleLines(text) {
  const lines = text.split("\n")
  const { literalLines } = markdownStructure(text)
  const hidden = new Set()
  for (const block of blocksOf(lines, 0, lines.length)) {
    if (lines[block.start + 1]?.match(COLLAPSED)?.[2] !== "true") continue
    for (let i = block.start + 1; i < block.end; i++) hidden.add(i)
  }
  return lines.filter((line, i) => line.trim() && !hidden.has(i) && (literalLines.has(i) || !COLLAPSED.test(line))
    && !/^<!--.*-->$/.test(line.trim())).length
}
