// Block references in Logseq-format outliners: a block gets `id:: <uuid>` when something points at
// it, `((uuid))` shows it inline and `{{embed ((uuid))}}` shows it with its children. Two blocks with
// one id, a reference to nothing, and an embed that shows itself again break what the outliner
// draws. Copying a block on a phone is the usual way two ids collide; `fix` repairs that.
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { walkGraph } from "./check.mjs"
import { markdownStructure } from "./dialects/logseq.mjs"
import { writeAtomic } from "./files.mjs"

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
const ID_LINE = new RegExp(`^(\\s*)id::\\s*(${UUID})\\s*$`)
const EMBED_BLOCK = new RegExp(`\\{\\{embed\\s+\\(\\((${UUID})\\)\\)\\s*\\}\\}`, "g")
const EMBED_PAGE = /\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}/g
const REF = new RegExp(`\\(\\((${UUID})\\)\\)`, "g")

/** The text with code and HTML blanked out, keeping every line break. */
function visible(text) {
  const units = text.split("")
  for (const [start, end] of markdownStructure(text).literalRanges) for (let i = start; i < end; i++) if (units[i] !== "\n") units[i] = " "
  return units.join("")
}

/** Each page's blocks: id, the blocks and pages it embeds, the blocks it references, and its children. */
function readPages(ws, graph) {
  return graph.pages.map((page) => {
    const text = readFileSync(page.path, "utf8")
    const lines = text.split("\n")
    const shown = visible(text).split("\n")
    const { items } = markdownStructure(text)
    const blocks = items.map((item, index) => {
      const own = [...new Set([item.start, ...item.ownLines])].sort((a, b) => a - b)
      const idLine = own.find((i) => ID_LINE.test(lines[i]))
      const words = own.filter((i) => i !== idLine).map((i) => shown[i]).join("\n")
      // Only the block's own depth is dropped; indentation inside it (code, children) is part of what it says.
      const level = (line) => (line.startsWith(item.prefix) ? line.slice(item.prefix.length) : line).replace(/\r$/, "")
      return { index, page, start: item.start, end: item.end, prefix: item.prefix, parent: item.ancestors[0],
        id: idLine === undefined ? undefined : lines[idLine].match(ID_LINE)[2].toLowerCase(), idLine,
        embeds: [...words.matchAll(EMBED_BLOCK)].map((hit) => hit[1].toLowerCase()),
        pageEmbeds: [...words.matchAll(EMBED_PAGE)].map((hit) => hit[1].normalize("NFC")),
        refs: [...words.replace(EMBED_BLOCK, "").matchAll(REF)].map((hit) => hit[1].toLowerCase()),
        // Everything the block holds but its id, code included: only an exact copy may become an embed.
        words: Array.from({ length: item.end - item.start }, (_, k) => item.start + k).filter((i) => i !== idLine)
          .map((i) => level(lines[i])).join("\n").replace(/^- /, "").normalize("NFC"),
        children: [] }
    })
    for (const block of blocks) if (block.parent !== undefined) blocks[block.parent].children.push(block)
    return { page, lines, blocks, top: blocks.filter((block) => block.parent === undefined) }
  })
}

const where = (block) => `${block.page.rel}:${block.start + 1}`

/** Problems with block ids, references and embeds, as `{ severity, code, values, file, line }`. */
export function blockIssues(ws, graph = walkGraph(ws)) {
  const pages = readPages(ws, graph)
  const byId = new Map()
  for (const { blocks } of pages) for (const block of blocks) if (block.id) byId.set(block.id, [...byId.get(block.id) ?? [], block])
  const byName = new Map(pages.map((entry) => [entry.page.name.toLowerCase(), entry]))
  const issues = []
  const add = (severity, code, block, values) => issues.push({ severity, code, key: `${code}|${values.key ?? where(block)}`, file: block.page.rel, line: block.start + 1, values: { file: block.page.rel, line: block.start + 1, ...values } })
  for (const [id, blocks] of byId) if (blocks.length > 1) add("error", "block-id-duplicate", blocks[0], { id, n: blocks.length, where: blocks.map(where).join(", "), key: id })
  for (const { blocks } of pages) for (const block of blocks) {
    for (const id of [...block.embeds, ...block.refs]) if (!byId.has(id)) add("error", "block-ref-missing", block, { id })
    for (const name of block.pageEmbeds) if (!byName.has(name.toLowerCase())) add("warning", "embed-page-missing", block, { target: name })
  }
  // Open each page the way the outliner draws it: an embed that reaches itself loops, and a block
  // reached twice is shown twice.
  const reported = new Set()
  for (const entry of pages) {
    const seen = new Set()
    const active = new Set()
    const openPages = new Set([entry.page.name.toLowerCase()])
    const visit = (block) => {
      const key = `${block.page.rel}:${block.index}`
      if (seen.has(key)) {
        if (!reported.has(`twice|${entry.page.rel}|${key}`)) { reported.add(`twice|${entry.page.rel}|${key}`); add("warning", "embed-twice", block, { page: entry.page.name, key: `${entry.page.rel}>${key}` }) }
        return
      }
      seen.add(key)
      active.add(key)
      for (const id of block.embeds) {
        const found = byId.get(id)
        if (found?.length !== 1) continue
        if (active.has(`${found[0].page.rel}:${found[0].index}`)) {
          if (!reported.has(`cycle|${key}|${id}`)) { reported.add(`cycle|${key}|${id}`); add("error", "embed-cycle", block, { target: `((${id}))`, key: `${key}>${id}` }) }
          continue
        }
        visit(found[0])
      }
      for (const name of block.pageEmbeds) {
        const target = byName.get(name.toLowerCase())
        if (!target) continue
        if (openPages.has(name.toLowerCase())) {
          if (!reported.has(`cycle|${key}|${name}`)) { reported.add(`cycle|${key}|${name}`); add("error", "embed-cycle", block, { target: `[[${name}]]`, key: `${key}>${name}` }) }
          continue
        }
        openPages.add(name.toLowerCase())
        target.top.forEach(visit)
        openPages.delete(name.toLowerCase())
      }
      block.children.forEach(visit)
      active.delete(key)
    }
    entry.top.forEach(visit)
  }
  return issues
}

/**
 * Repairs blocks that share an id. The first one (outside the journals, then by page and line)
 * keeps it; a copy with the same words and no children becomes an embed of it, and any other block
 * gets a new id. References keep pointing at the first block.
 */
export function fixBlocks(ws, { dryRun = false } = {}) {
  const pages = readPages(ws, walkGraph(ws))
  const byId = new Map()
  for (const { blocks } of pages) for (const block of blocks) if (block.id) byId.set(block.id, [...byId.get(block.id) ?? [], block])
  const linesOf = new Map(pages.map((entry) => [entry.page.path, entry.lines]))
  const edits = new Map()
  const fixed = []
  const edit = (block, change) => {
    if (!edits.has(block.page.path)) edits.set(block.page.path, { lines: linesOf.get(block.page.path), changes: [] })
    edits.get(block.page.path).changes.push(change)
  }
  for (const [id, blocks] of byId) {
    if (blocks.length < 2) continue
    const [first, ...others] = [...blocks].sort((a, b) => Number(a.page.journal) - Number(b.page.journal)
      || (a.page.name < b.page.name ? -1 : a.page.name > b.page.name ? 1 : 0) || a.start - b.start)
    // Words include children, so a childless copy never equals a block it sits inside: no embed loops.
    for (const block of others) {
      if (block.words === first.words && !block.children.length) {
        edit(block, { from: block.start, to: block.end, lines: [`${block.prefix}- {{embed ((${id}))}}`] })
        fixed.push({ action: "embedded", id, file: block.page.rel, line: block.start + 1 })
      } else {
        const fresh = randomUUID()
        const indent = linesOf.get(block.page.path)[block.idLine].match(ID_LINE)[1]
        edit(block, { from: block.idLine, to: block.idLine + 1, lines: [`${indent}id:: ${fresh}`] })
        fixed.push({ action: "new-id", id, fresh, file: block.page.rel, line: block.start + 1 })
      }
    }
  }
  if (!dryRun) for (const [path, { lines, changes }] of edits) {
    const out = [...lines]
    // From the bottom up, so earlier line numbers stay valid.
    for (const change of changes.sort((a, b) => b.from - a.from)) out.splice(change.from, change.to - change.from, ...change.lines)
    writeAtomic(path, out.join("\n"))
  }
  return { dryRun, fixed }
}
