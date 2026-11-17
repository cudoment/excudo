// The outliner's `{{query …}}` macros, evaluated when the memo is written as a website. Tine and
// Logseq run a query each time a page opens; a static site cannot, so the website carries each
// query's result as it stood when the site was built. Only the forms a memo's Home uses are read:
// `(and …)`, `(or …)`, `(not …)`, `(task A B)`, `[[page]]`, `"text"` and `(page "name")`, with the
// options `{:title "…" :collapsed? true}` after the query. Any other form is reported
// (`query-unsupported`) and the macro is left as text, so a page never shows a wrong result.
import { readFileSync } from "node:fs"
import { walkGraph } from "./check.mjs"
import { authoredText, blocksOf, MARKER } from "./dialects/logseq.mjs"
import { ownedHome, pageOf, ROOT } from "./tree.mjs"
import { escapeHtml, relativeLink, toSiteMarkdown } from "./dialects/html.mjs"

// A macro's body holds parentheses and, after the query, one `{:option …}` map; no other braces.
export const QUERY = /\{\{query\s+((?:[^{}]|\{[^{}]*\})*?)\s*\}\}/
const PROPERTY = /^\s*(?:[\w가-힣-]+::|(?:SCHEDULED|DEADLINE):)/

/** The tokens of a query: brackets, `[[pages]]`, `"strings"`, `{:options}` and words. */
function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === "(" || ch === ")") { tokens.push({ type: ch }); i++; continue }
    if (text.startsWith("[[", i)) {
      const end = text.indexOf("]]", i + 2)
      if (end < 0) throw new Error("unterminated [[")
      tokens.push({ type: "page", value: text.slice(i + 2, end).normalize("NFC") })
      i = end + 2
      continue
    }
    if (ch === '"') {
      let j = i + 1, value = ""
      for (; j < text.length && text[j] !== '"'; j++) value += text[j] === "\\" && j + 1 < text.length ? text[++j] : text[j]
      if (j >= text.length) throw new Error("unterminated string")
      tokens.push({ type: "string", value })
      i = j + 1
      continue
    }
    if (ch === "{") {
      const end = text.indexOf("}", i)
      if (end < 0) throw new Error("unterminated {")
      tokens.push({ type: "options", value: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    const match = text.slice(i).match(/^[^\s()"[\]{}]+/)
    tokens.push({ type: "word", value: match[0] })
    i += match[0].length
  }
  return tokens
}

/** The `{:title "…" :collapsed? true}` map after a query. */
function parseOptions(text) {
  const options = {}
  const title = text.match(/:title\s+"((?:[^"\\]|\\.)*)"/)
  if (title) options.title = title[1].replace(/\\(.)/g, "$1")
  if (/:collapsed\?\s+true/.test(text)) options.collapsed = true
  return options
}

/**
 * Reads the text inside `{{query …}}`. Returns `{ ast, options, unsupported }`: `unsupported` lists
 * the forms the website cannot evaluate, and then `ast` is undefined.
 */
export function parseQuery(text) {
  const unsupported = []
  let tokens
  try { tokens = tokenize(text) } catch (error) { return { options: {}, unsupported: [text.trim()] } }
  let at = 0
  const peek = () => tokens[at]
  const next = () => tokens[at++]
  const form = (token) => token.type === "(" ? "(…)" : token.value ?? token.type
  const parse = () => {
    const token = next()
    if (!token) throw new Error("unexpected end")
    if (token.type === "page") return { type: "tag", name: token.value }
    if (token.type === "string") return { type: "text", value: token.value }
    if (token.type === "word" && /^#\S+$/.test(token.value)) return { type: "tag", name: token.value.slice(1).normalize("NFC") }
    if (token.type !== "(") { unsupported.push(form(token)); return { type: "unsupported" } }
    const head = next()
    if (!head || head.type !== "word") throw new Error("a form needs a name")
    const name = head.value.toLowerCase()
    if (name === "task" || name === "todo") {
      // `(task TODO DOING)`: the states are bare words.
      const states = []
      while (peek() && peek().type !== ")") {
        const word = next()
        if (word.type !== "word" || !MARKER.test(word.value.toUpperCase())) throw new Error("task takes states")
        states.push(word.value.toUpperCase())
      }
      if (!next() || !states.length) throw new Error("task takes states")
      return { type: "task", states }
    }
    if (!["and", "or", "not", "page"].includes(name)) {
      // A form the website does not read: skipped whole, so only its name is reported.
      let depth = 1
      while (depth && peek()) { const token = next(); if (token.type === "(") depth++; else if (token.type === ")") depth-- }
      if (depth) throw new Error("unclosed (")
      unsupported.push(`(${head.value} …)`)
      return { type: "unsupported" }
    }
    const args = []
    while (peek() && peek().type !== ")") args.push(parse())
    if (!next()) throw new Error("unclosed (")
    if (["and", "or", "not"].includes(name)) {
      if (name === "not" && args.length !== 1) throw new Error("not takes one form")
      if (!args.length) throw new Error(`${name} takes forms`)
      return { type: name, children: args }
    }
    if (args.length !== 1 || args[0].type !== "text") throw new Error("page takes a name")
    return { type: "page", name: args[0].value.normalize("NFC") }
  }
  let ast, options = {}
  try {
    // Bare words are only valid as the states of (task …); anything else must open a form.
    const last = tokens.at(-1)
    if (last?.type === "options") { options = parseOptions(last.value); tokens.pop() }
    ast = parse()
    if (at < tokens.length) throw new Error("more than one form")
  } catch (error) {
    return { options, unsupported: [...new Set([...unsupported, text.trim()])] }
  }
  if (unsupported.length) return { options, unsupported: [...new Set(unsupported)] }
  return { ast, options, unsupported: [] }
}

const TAGS = [/(^|\s)#\[\[([^\]\n]+)\]\]/g, /(^|\s)#([^\s#.,!?()[\]]+)/g, /\[\[([^\]\n]+)\]\]/g]
/** The pages a block names: `[[page]]`, `#tag` and `#[[tag]]` in its own lines. */
function tagsOf(lines) {
  const names = new Set()
  for (const line of lines) for (const pattern of TAGS) for (const match of line.matchAll(pattern)) names.add((match[2] ?? match[1]).normalize("NFC").toLowerCase())
  return names
}

/**
 * Every bulleted block the queries see: the authored blocks of each node in tree order, the owner's
 * Home, and the journals by date. A block carries its page, its 0-based line and its own text.
 */
export function queryBlocks(ws, model, { home = ownedHome(ws) } = {}) {
  const pages = []
  const walk = (id) => {
    for (const child of model.children.get(id) ?? []) {
      const doc = model.docs.get(child)
      pages.push({ kind: "node", id: child, name: pageOf(child), rel: doc.sourcePath.normalize("NFC"), text: authoredText(doc.source.text, ws.labels.region) })
      walk(child)
    }
  }
  walk(ROOT)
  if (home) pages.push({ kind: "home", name: ws.labels.home.normalize("NFC"), rel: home.rel, text: home.text })
  for (const page of walkGraph(ws).pages.filter((item) => item.journal).sort((a, b) => b.rel.localeCompare(a.rel)))
    pages.push({ kind: "journal", name: page.name, rel: page.rel, text: readFileSync(page.path, "utf8") })
  const blocks = []
  const macros = new RegExp(QUERY.source, "g")
  for (const page of pages) {
    const lines = page.text.split("\n")
    for (const block of blocksOf(lines, 0, lines.length)) {
      // A query names pages and words to look for; it is not a result, so its macros are not read.
      const own = block.ownLines.map((i) => lines[i].replace(macros, ""))
      if (own.every((line) => /^\s*(?:-\s*)?$/.test(line)) && block.ownLines.some((i) => QUERY.test(lines[i]))) continue
      blocks.push({ page, block, line: block.start, text: block.text, state: block.text.match(MARKER)?.[0] ?? "",
        own: own.filter((line) => !PROPERTY.test(line)).join("\n"), tags: tagsOf(own), lines })
    }
  }
  return blocks
}

/** Whether a block satisfies a query. */
export function matches(ast, entry) {
  switch (ast.type) {
    case "and": return ast.children.every((child) => matches(child, entry))
    case "or": return ast.children.some((child) => matches(child, entry))
    case "not": return !matches(ast.children[0], entry)
    case "task": return ast.states.includes(entry.state)
    case "tag": return entry.tags.has(ast.name.toLowerCase())
    case "text": return entry.own.toLowerCase().includes(ast.value.toLowerCase())
    case "page": return entry.page.name.toLowerCase() === ast.name.toLowerCase()
    default: return false
  }
}

/**
 * The blocks a query picks, grouped by page in the order the blocks were read. A block below a
 * picked block is shown with it, not again on its own.
 */
export function evaluateQuery(ast, blocks) {
  const picked = new Set(blocks.filter((entry) => matches(ast, entry)).map((entry) => entry.block))
  const groups = []
  for (const entry of blocks) {
    if (!picked.has(entry.block)) continue
    let parent = entry.block.parent
    while (parent && !picked.has(parent)) parent = parent.parent
    if (parent) continue
    const group = groups.at(-1)?.page === entry.page ? groups.at(-1) : groups[groups.push({ page: entry.page, entries: [] }) - 1]
    group.entries.push(entry)
  }
  return groups
}

/** The `{{query …}}` macros of a text outside code and HTML, with their 0-based lines. */
export function queriesIn(text, literalLines = new Set()) {
  return text.split("\n").flatMap((line, i) => literalLines.has(i) ? [] : [...line.matchAll(new RegExp(QUERY.source, "g"))].map((match) => ({ line: i, macro: match[0], body: match[1] })))
}

/** The query forms a page holds that the website cannot show: `{ line, form }`. */
export function unsupportedQueries(text, literalLines) {
  return queriesIn(text, literalLines).flatMap(({ line, body }) => parseQuery(body).unsupported.map((form) => ({ line, form })))
}

/**
 * The Markdown of a query's result for the website: a folded section titled as the query was, with
 * its count, each page a list item with the blocks picked below it. Every section starts folded, so a
 * page reads as its titles first; the page runtime opens again what the reader opened there. `ctx.page.id` is the page the result appears on
 * (links are relative to it) and `ctx.pageIdOf(page)` the website id of a block's page.
 */
export function queryMarkdown(ws, groups, options, ctx) {
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const lines = [`<details class="excudo-query">`,
    `<summary>${escapeHtml(options.title ?? "")} <small class="excudo-count">${total}</small></summary>`, ""]
  if (!groups.length) lines.push(`<p class="excudo-empty">${escapeHtml(ws.labels.site.none)}</p>`)
  for (const group of groups) {
    const id = ctx.pageIdOf(group.page)
    lines.push(id ? `- [${group.page.name}](${relativeLink(ctx.page.id, id)})` : `- ${group.page.name}`)
    for (const entry of group.entries) {
      const { block } = entry
      const base = entry.lines[block.start].match(/^\s*/)[0]
      const slice = entry.lines.slice(block.start, block.end).map((line) => line.startsWith(base) ? line.slice(base.length) : line.trimStart())
      const text = toSiteMarkdown(slice.join("\n"), { page: { id: ctx.page.id, rel: group.page.rel }, resolve: ctx.resolve, lineOffset: block.start, block: ctx.block })
      for (const line of text.trimEnd().split("\n")) lines.push(line ? `  ${line}` : "")
    }
  }
  lines.push("", "</details>")
  return lines.join("\n")
}
