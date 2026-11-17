// What the website shows of a page: the outliner's Markdown turned into the standard Markdown that
// cudoc renders. Every reading of Tine's syntax stays in logseq.mjs; this module only decides what
// each of its forms becomes on a web page. A `[[page]]` becomes a link to that page, a task marker a
// checkbox with its state, a `DEADLINE:` line a date beside its task, a `{{query}}` the result the
// engine evaluated (queries.mjs), a `{{embed}}` a cudoc embed, and a property line either nothing
// (the outliner's own: `collapsed::`, `id::`, the generated marker) or a small note. A task keeps an
// address in the page (`data-excudo-page`, `data-excudo-line`, `data-excudo-hash`) so that a change
// made on the page can find its line in the memo again.
import { createHash } from "node:crypto"
import { posix } from "node:path"
import { authoredText, CLOSED, headingBlocks, markdownStructure, MARKER } from "./logseq.mjs"

const BULLET = /^(\s*)- (.*)$/
const PROPERTY = /^(\s*)([^\s:][^:\n]*?)::\s*(.*)$/
const DATE_LINE = /^\s*(DEADLINE|SCHEDULED):\s*<([^>\n]*)>\s*$/
const DATE_INLINE = /\s*\b(DEADLINE|SCHEDULED):\s*<([^>\n]*)>/g
const EMBED_PAGE = /^\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}$/
const EMBED_INLINE = /\{\{embed\s+\[\[([^\]\n]+)\]\]\s*\}\}/g
const QUERY_LINE = /^\{\{query\s+([\s\S]*?)\s*\}\}$/
const LINK = /\[\[([^\]\n]+)\]\]/g
const TAG_PAGE = /(^|\s)#\[\[([^\]\n]+)\]\]/g
const TAG = /(^|[\s(])#([^\s#.,!?()[\]]+)/g
const REF = /\(\(([0-9a-fA-F-]{36})\)\)/g
const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/
/** The outliner's own properties, which say nothing on a web page. */
const OWN_PROPERTIES = new Set(["collapsed", "id", "generated", "생성", "automation", "자동 실행"])

export const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const encodePath = (path) => path.split("/").map((segment) => segment === ".." ? ".." : encodeURIComponent(segment)).join("/")
/** A link from one page of the website to another, by their ids, as cudoc resolves it. */
export function relativeLink(fromId, toId) {
  const from = posix.dirname(fromId)
  return encodePath(posix.relative(from === "." ? "" : from, `${toId}.md`))
}
/** A task's text without its state word: what stays the same while its state changes. */
export const taskText = (text) => text.replace(MARKER, "").replace(/^\s+/, "")
/**
 * The first ten hex digits of the digest of a task's text without its state word, which a change made
 * on the website names: a change of state leaves it as it was, so two changes in a row find the line.
 */
export const taskHash = (text) => createHash("sha256").update(taskText(text).normalize("NFC").trimEnd()).digest("hex").slice(0, 10)

/** A task's checkbox and state, with the address of its line in the memo. */
function taskPrefix(text, ctx, line) {
  const marker = text.match(MARKER)?.[0]
  if (!marker) return { prefix: "", rest: text }
  let rest = text.slice(marker.length)
  const priority = rest.match(/^\s*\[#([A-Z])\]/)
  if (priority) rest = rest.slice(priority[0].length)
  const box = CLOSED.test(marker) ? "[x]" : "[ ]"
  const state = marker.replace(/^CANCELLED$/, "CANCELED")
  const address = ctx.page?.rel === undefined ? "" : ` data-excudo-page="${escapeHtml(ctx.page.rel)}" data-excudo-line="${line + 1 + (ctx.lineOffset ?? 0)}" data-excudo-hash="${taskHash(text)}"`
  const prefix = `${box} <span class="excudo-task excudo-${state.toLowerCase()}"${address} data-excudo-state="${state}">${state}</span>`
    + (priority ? ` <span class="excudo-priority">${priority[1]}</span>` : "")
  return { prefix: `${prefix} `, rest: rest.replace(/^\s+/, "") }
}

/** Renders a page name as a link to its page, or as plain words when the website has no such page. */
function pageLink(name, ctx, text = name) {
  const target = name.normalize("NFC")
  const id = ctx.resolve(target)
  if (id) return `[${text.replace(/[[\]]/g, "")}](${relativeLink(ctx.page.id, id)})`
  return `<span class="excudo-missing">${escapeHtml(text)}</span>`
}

/** The inline forms of a line outside its inline code: `[[page]]`, `#tag`, `((block))`, `{{embed}}`. */
export function convertInline(text, ctx) {
  return text.split(/(`+[^`]*`+)/).map((part, index) => {
    if (index % 2) return part
    return part
      .replace(EMBED_INLINE, (whole, name) => pageLink(name, ctx))
      .replace(REF, (whole, uuid) => {
        const block = ctx.block?.(uuid.toLowerCase())
        return block ? pageLink(block.page, ctx, block.text) : whole
      })
      .replace(TAG_PAGE, (whole, lead, name) => `${lead}${tagLink(name, ctx)}`)
      .replace(TAG, (whole, lead, name) => `${lead}${tagLink(name, ctx)}`)
      .replace(LINK, (whole, name) => pageLink(name, ctx))
  }).join("")
}
function tagLink(name, ctx) {
  const id = ctx.resolve(name.normalize("NFC"))
  return id ? `[#${name}](${relativeLink(ctx.page.id, id)})` : `<span class="excudo-tag">#${escapeHtml(name)}</span>`
}
const dedent = (line) => line.startsWith("\t") ? line.slice(1) : line.startsWith("  ") ? line.slice(2) : line.replace(/^ /, "")
const spaces = (lead) => lead.replace(/\t/g, "  ")

/**
 * The website's Markdown for a page's authored text. `ctx` carries the page (`{ id, rel }`),
 * `resolve(name)` (the website id of a page name, or undefined), `query(body, options)` (the Markdown
 * of a query's result, or undefined when the website cannot show it), `block(uuid)` and `region`.
 */
export function toSiteMarkdown(text, ctx) {
  const authored = ctx.region ? authoredText(text, ctx.region) : text
  const lines = authored.split("\n")
  const { literalLines, items } = markdownStructure(authored)
  const itemAt = new Map(items.map((item) => [item.start, item]))
  const grouped = headingBlocks(authored)
  // A task's DEADLINE and SCHEDULED lines join the task's line as dates.
  const dates = new Map()
  const skip = new Set()
  for (const item of items) for (const i of item.ownLines) {
    const match = lines[i]?.match(DATE_LINE)
    if (!match || literalLines.has(i)) continue
    dates.set(item.start, [...(dates.get(item.start) ?? []), { kind: match[1], date: match[2].match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? match[2].trim() }])
    skip.add(i)
  }
  // A bulleted heading with items under it (`- ### Work`) becomes a heading, and its items move up a level.
  const lifts = []
  const out = []
  const lift = (line) => { let result = line; for (let n = 0; n < lifts.length; n++) result = dedent(result); return result }
  const push = (...added) => out.push(...added)
  for (let i = 0; i < lines.length; i++) {
    let closed = false
    while (lifts.length && i >= lifts.at(-1)) { lifts.pop(); closed = true }
    if (skip.has(i)) continue
    // An item after a heading block's items is not one of them: a comment line ends their list.
    if (closed && itemAt.has(i) && !/^\s/.test(lift(lines[i]))) push("", "<!-- -->", "")
    const raw = lift(lines[i])
    if (literalLines.has(i)) { push(raw); continue }
    const item = itemAt.get(i)
    if (item) {
      const lead = spaces(raw.match(/^\s*/)[0])
      const text = item.text
      const heading = text.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        push("", `${heading[1]} ${convertInline(heading[2], ctx)}`, "")
        if (grouped.has(i)) lifts.push(item.end)
        continue
      }
      const query = text.match(QUERY_LINE)
      if (query) {
        const block = ctx.query?.(query[1])
        if (block === undefined) { push(`${lead}- <span class="excudo-query-unsupported">${escapeHtml(text)}</span>`); continue }
        const body = block.split("\n")
        if (!lead) push("", ...body, "")
        else push(`${lead}- ${body[0]}`, ...body.slice(1).map((line) => line ? `${lead}  ${line}` : ""))
        continue
      }
      const embed = text.match(EMBED_PAGE)
      if (embed) {
        const id = ctx.resolve(embed[1].normalize("NFC"))
        if (!id) { push(`${lead}- <span class="excudo-missing">${escapeHtml(embed[1])}</span>`); continue }
        push(`${lead}- \`\`\`cudoc-embed`, `${lead}  sources: ["${relativeLink(ctx.page.id, id)}"]`, `${lead}  \`\`\``)
        continue
      }
      const { prefix, rest } = taskPrefix(text, ctx, i)
      const own = [...(dates.get(i) ?? [])]
      // A date written on the task's own line, as an outliner may keep it, is a date too.
      const words = rest.replace(DATE_INLINE, (whole, kind, value) => { own.push({ kind, date: value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? value.trim() }); return "" }).trimEnd()
      const due = own.map((date) => ` <span class="excudo-date excudo-${date.kind.toLowerCase()}">${escapeHtml(date.date)}</span>`).join("")
      push(`${lead}- ${prefix}${convertInline(words, ctx)}${due}`)
      continue
    }
    const property = raw.match(PROPERTY)
    if (property && !/^\s*- /.test(raw) && !raw.trim().startsWith("|")) {
      const key = property[2].trim()
      if (OWN_PROPERTIES.has(key) || (ctx.ownProperties ?? []).includes(key)) continue
      push(`${spaces(property[1])}<small class="excudo-property">${escapeHtml(key)}: ${escapeHtml(property[3].trim())}</small>`)
      continue
    }
    if (DATE_LINE.test(raw)) continue
    push(/^\s*$/.test(raw) ? "" : `${spaces(raw.match(/^\s*/)[0])}${convertInline(raw.trimStart(), ctx)}`)
  }
  // Blank lines the lifts and queries added never stack.
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trimEnd()}\n`
}

/**
 * The generated end of a node page: the section heading, where the node sits, and a cudoc tree of
 * the nodes below it. `ancestors` are `{ name, id }` from the top; `folder` is the website folder
 * the node's children are in, or undefined for a leaf.
 */
export function regionMarkdown({ labels, ancestors, name, folder, open = 1, columns }) {
  const crumbs = [...ancestors.map((item) => `[${item.name.replace(/[[\]]/g, "")}](${item.href})`), name]
  const lines = ["", `## ${labels.region}`, "", `<small class="excudo-location">${labels.location}: ${crumbs.join(" › ")}</small>`]
  if (folder) lines.push("", "```cudoc-embed", `sources: ["/${folder}/"]`, "render:", "  type: tree", `  open: ${open}`,
    `  columns: ${JSON.stringify(columns)}`, "```")
  return `${lines.join("\n")}\n`
}
