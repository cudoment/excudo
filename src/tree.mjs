// cudoc owns folder ancestry, ordering, Unicode matching and tree cells.
// This project supplies the task extractor and serializes the returned data.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix, relative } from "node:path"
import { buildDocuments } from "@cudoment/cudoc/node/library"
import { parseEmbedSpec, resolveTree } from "@cudoment/cudoc/node/resolve-embed"
import { existingPath } from "./files.mjs"
import { format } from "./labels.mjs"
import { embedTargets, taskLines, serializeTree, linkTargets } from "./dialects/logseq.mjs"

export const ROOT = ""
/** Where Tine and Logseq put a page you create by following a new link: it waits there to be placed. */
export const INTAKE = "pages"
const spellings = (name) => [...new Set([`${name}.md`.normalize("NFC"), `${name}.md`.normalize("NFD")])]
/**
 * Home is a view the engine writes (`views/Home.mdx`) or, without that view, a page the owner
 * writes. Returns the owner's page, or undefined when the engine writes Home or there is none.
 */
export function ownedHome(ws) {
  if (existsSync(existingPath(join(ws.graphDir, "views", `${ws.labels.home}.mdx`)))) return undefined
  const path = existingPath(join(ws.graphDir, `${ws.labels.home}.md`))
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, "utf8")
  if (text.startsWith(`${ws.labels.generated}::`)) return undefined
  return { path, rel: relative(ws.graphDir, path).normalize("NFC"), text }
}
/**
 * The nodes the owner's Home links to. A page Home embeds is on Home itself: an embedded node counts,
 * and so does every node an embedded view lists.
 */
export function homeLinks(home, model) {
  if (!home) return new Set()
  const embedded = embedTargets(home.text).flatMap(({ target }) => [model.find(target), ...model.viewReach(target)])
  return new Set([...linkTargets(home.text).map(({ target }) => model.find(target)), ...embedded].filter(Boolean))
}

const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, "$2").trim()
/**
 * The settings of a ```nodes fence, one per line: `from: <node>` (the top unless set), `depth: <n>`
 * (levels shown, 2 unless set) and `except: [<node>, …]` (left out with what is below them).
 */
export function nodesSpec(text, labels) {
  const spec = {}
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^(from|depth|except):\s*(.*)$/)
    const value = match?.[2].trim() ?? ""
    if (match?.[1] === "depth" && /^[1-9]\d*$/.test(value)) spec.depth = Number(value)
    else if (match?.[1] === "from" && unquote(value)) spec.from = unquote(value)
    else if (match?.[1] === "except") spec.except = (/^\[.*\]$/.test(value) ? value.slice(1, -1).split(",") : [value]).map(unquote).filter(Boolean)
    else throw new Error(format(labels.messages["nodes-fence"], { line }))
  }
  return spec
}
/** Top nodes, metadata aside, that Home reaches neither directly nor through a node below them. */
export function outsideHome(ws, model, linked) {
  const meta = new Set(ws.metaNodes.map((name) => name.normalize("NFC")))
  const reached = (id) => linked.has(id) || (model.children.get(id) ?? []).some(reached)
  return (model.children.get(ROOT) ?? []).filter((id) => !meta.has(pageOf(id)) && !reached(id))
}
export const plain = (node) => node.type === "text" || node.type === "inlineCode"
  ? node.value : (node.children ?? []).map(plain).join("")
export const pageOf = (id) => posix.basename(id).normalize("NFC")
/** A dated archive node below Done: `Done 2026` or `Done 2026-10`. */
export function isArchive(ws, id) {
  const name = pageOf(id)
  return name.startsWith(`${ws.labels.done} `) && /^\d{4}(?:-\d{2})?$/.test(name.slice(ws.labels.done.length + 1))
}
export const treeColumns = ["link", { value: { extractor: "openTasks" } }, "summary"]
// Collected cudoc ASTs intentionally omit parser positions. Read this small
// source range for blame and locations while cudoc supplies the summary value.
export function summaryRange(doc) {
  if (doc.tree.children[1]?.type !== "paragraph") return undefined
  const lines = doc.source.text.split("\n")
  let start = lines.findIndex((line) => /^#\s/.test(line)) + 1
  while (start < lines.length && !lines[start].trim()) start++
  let end = start
  while (end < lines.length && lines[end].trim()) end++
  return { start: start + 1, end }
}
export function viewNames(ws) {
  const views = join(ws.graphDir, "views")
  return existsSync(views) ? readdirSync(views).filter((name) => name.endsWith(".mdx")).map((name) => name.replace(/\.mdx$/, "")) : []
}
export function collect(ws) {
  // Generated view pages and Home are never nodes, whoever writes Home. cudoc matches a name
  // without a folder anywhere, so Home is excluded only when the graph root has one; a node of
  // the same name elsewhere is then a duplicate page name, which `check` reports.
  const home = existsSync(existingPath(join(ws.graphDir, `${ws.labels.home}.md`))) ? [ws.labels.home] : []
  const generated = [...viewNames(ws), ...home].flatMap(spellings)
  const counts = new WeakMap()
  // cudoc publishes what it collects, but the engine reads only the library it returns. The output goes
  // to a temporary folder that is removed again, so no command, a dry run included, leaves files behind.
  const out = mkdtempSync(join(tmpdir(), "excudo-documents-"))
  try { return buildDocuments({
    sourceRoot: ws.graphDir, outDir: join(out, "documents"), host: "markdown",
    exclude: ["journals/**", "logseq/**", "assets/**", `${INTAKE}/**`, ...generated],
    extractors: { openTasks: { version: "1", extract(row, { library, node }) {
      if (!counts.has(library)) counts.set(library, new Map(library.documents.map((doc) => [doc.id, taskLines(doc.source.text, ws.labels.region).length])))
      const own = counts.get(library)
      const count = (line) => own.get(line.documentId)
        + line.children.reduce((sum, child) => sum + count(child), 0)
      const n = node ? count(node) : own.get(row.document.id)
      return n ? format(ws.labels.tasks, { n }) : undefined
    } } },
  }) } finally { rmSync(out, { recursive: true, force: true }) }
}
export function makeTree(ws, library) {
  const isView = (id) => id.startsWith("views/")
  const nodes = library.documents.filter((doc) => !isView(doc.id))
  // The view that holds the whole tree starts every location: Home, or the Archive when the owner writes Home.
  const viewPages = new Set(library.documents.filter((doc) => isView(doc.id)).map((doc) => pageOf(doc.id)))
  const rootView = [ws.labels.home, ws.labels.archive].map((name) => name.normalize("NFC")).find((name) => viewPages.has(name))
  const docs = new Map(library.documents.map((doc) => [doc.id, doc]))
  const nodeLibrary = { ...library, documents: nodes }
  const resolveBase = (spec, documentId = "views/home") => nodes.length ? resolveTree(nodeLibrary, spec, { documentId }) : []
  const all = resolveBase({ sources: ["/"], render: { type: "tree", columns: treeColumns } })
  const children = new Map([[ROOT, all.map((node) => node.documentId)]])
  const parents = new Map()
  const data = new Map()
  function index(lines, parent) {
    for (const line of lines) {
      data.set(line.documentId, line)
      parents.set(line.documentId, parent)
      children.set(line.documentId, line.children.map((child) => child.documentId))
      index(line.children, line.documentId)
    }
  }
  index(all, ROOT)
  const openCounts = new Map(nodes.map((doc) => [doc.id, taskLines(doc.source.text, ws.labels.region).length]))
  const ownOpen = (id) => openCounts.get(id) ?? 0
  const totals = new Map()
  const count = (line) => {
    if (!totals.has(line.documentId)) totals.set(line.documentId, ownOpen(line.documentId) + line.children.reduce((sum, child) => sum + count(child), 0))
    return totals.get(line.documentId)
  }
  const totalOpen = (id) => {
    return (id === ROOT ? all : [data.get(id)]).reduce((sum, line) => sum + count(line), 0)
  }
  const meta = new Set(ws.metaNodes.map((name) => name.normalize("NFC")))
  // Done holds archived work and Record the log; the engine manages them and their subtrees.
  const managedIds = new Map()
  const managed = (id) => {
    if (id === ROOT || !data.has(id)) return false
    if (!managedIds.has(id)) managedIds.set(id, meta.has(pageOf(id)) || managed(parents.get(id)))
    return managedIds.get(id)
  }
  const defaultOrder = ["...", ...all.filter((node) => meta.has(node.name.normalize("NFC"))).map((node) => node.name)]
  const resolve = (spec, documentId) => {
    const lines = resolveBase(spec, documentId)
    const authored = spec.render.order ?? []
    const named = new Set(authored.map((name) => name.normalize("NFC")))
    const missing = lines.filter((line) => meta.has(line.name.normalize("NFC")) && !named.has(line.name.normalize("NFC"))).map((line) => line.name)
    if (authored.length && !missing.length) return lines
    const order = [...authored, ...(authored.includes("...") ? [] : ["..."]), ...missing]
    return resolveBase({ ...spec, render: { ...spec.render, order } }, documentId)
  }
  const rootData = (order) => resolve({ sources: ["/"], render: { type: "tree", columns: treeColumns, order: order ?? defaultOrder } })
  // A ```nodes fence: the nodes below `from` (the top unless set) down `depth` levels, by name, so a
  // view keeps up when nodes move. The nodes the engine keeps (Done, Record) and `except` stay out.
  /** @param {{ from?: string, depth?: number, except?: string[] }} [spec] */
  const nodeLines = ({ from, depth = 2, except = [] } = {}) => {
    const start = from ? find(from) : ROOT
    if (start === undefined) throw new Error(format(ws.labels.messages["node-missing"], { name: from }))
    const skip = new Set(except.map((name) => name.normalize("NFC").toLowerCase()))
    const trim = (lines, level) => lines.filter((line) => !managed(line.documentId) && !skip.has(pageOf(line.documentId).toLowerCase()))
      .map((line) => ({ ...line, children: level < depth ? trim(line.children, level + 1) : [] }))
    return trim(start === ROOT ? rootData(rootOrder()) : data.get(start).children, 1)
  }
  // The order the view holding the whole tree (Home or the Archive) gives the top nodes.
  const rootOrder = () => {
    const view = library.documents.find((doc) => isView(doc.id) && pageOf(doc.id) === rootView)
    const fence = view?.tree.children.find((node) => node.type === "code" && node.lang === "cudoc-embed")
    try {
      const render = fence ? parseEmbedSpec(fence.value).render : undefined
      return typeof render === "object" && render.type === "tree" ? render.order : undefined
    } catch { return undefined }
  }
  /** The nodes a view lists through its tree and nodes fences: what a page that embeds it shows. */
  const viewReach = (name) => {
    const doc = library.documents.find((item) => isView(item.id) && pageOf(item.id) === name.normalize("NFC"))
    const ids = []
    const add = (lines) => { for (const line of lines) { ids.push(line.documentId); add(line.children) } }
    const walk = (node) => {
      if (node.type === "code" && node.lang === "nodes") try { add(nodeLines(nodesSpec(node.value, ws.labels))) } catch {}
      else if (node.type === "code" && node.lang === "cudoc-embed") try {
        const spec = parseEmbedSpec(node.value)
        if (typeof spec.render === "object" && spec.render.type === "tree") add(resolve(spec, doc.id))
      } catch {}
      for (const child of node.children ?? []) walk(child)
    }
    if (doc) walk(doc.tree)
    return ids
  }
  const outline = (parent = ROOT, order) => serializeTree(parent === ROOT ? rootData(order) : data.get(parent)?.children ?? [])
  // The first node whose id or page name matches wins, as with a linear search.
  let byName
  const find = (name) => {
    if (!byName) {
      byName = new Map()
      for (const doc of nodes) for (const key of [doc.id.normalize("NFC").toLowerCase(), pageOf(doc.id).toLowerCase()])
        if (!byName.has(key)) byName.set(key, doc.id)
    }
    return byName.get(name.normalize("NFC").replace(/\.md$/, "").toLowerCase())
  }
  const idForUrl = (url) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined
    let path = url.split("#")[0]
    try { path = decodeURI(path) } catch {}
    return nodes.find((doc) => doc.route === path || doc.id === path.replace(/^\//, "").replace(/\.mdx?$/, ""))?.id
  }
  return { docs, nodes, isView, rootView, children, parentOf: (id) => parents.get(id) ?? ROOT,
    ownOpen, totalOpen, idForUrl, outline, rootData, nodeLines, viewReach, data, resolve, find, managed }
}
