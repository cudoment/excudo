// Writes the generated parts of a graph:
//
//   1. Every view: `views/<name>.mdx` becomes `<name>.md` at the graph root. A
//      ```cudoc-embed tree fence turns into the whole tree, with every line that has
//      children collapsed, so the first screen shows only the top-level nodes.
//      A ```outline fence is copied as outliner blocks (queries and the like). An
//      ```activity fence turns into the owner's recent sessions and commits (activity.mjs), a
//      ```status fence into how the scheduled runs, queued tasks, skills and sources stand (status.mjs),
//      and a ```nodes fence into part of the tree, chosen by node names (tree.mjs).
//   2. The end of every node: a section (`## Subpages` in English) that starts
//      with the node's location, from the view that holds the whole tree (Home,
//      or the Archive when you write Home yourself) down to it, and holds the tree below it in
//      the same shape. Whatever node you open, you see where it sits and
//      everything under it is one expand away.
//
// Generated text is never edited by hand. If it was, the build stops instead of
// overwriting it. Expanding or collapsing a line in the outliner writes
// `collapsed::` into the file; that is a view setting, so it is carried over. An
// outliner that saved the section heading as a list item changed only its shape:
// when the section still holds nothing else, the build puts the heading back.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseEmbedSpec, resolveDocumentEmbeds } from "@cudoment/cudoc/node/resolve-embed"
import { checkReferences } from "@cudoment/cudoc/node/check"
import { toMarkdown } from "mdast-util-to-markdown"
import { SKIP, visit } from "unist-util-visit"
import { COLLAPSED, serializeTree, wikiLink, raw, markdownOptions, toOutline, collapseState, applyCollapse, withoutCollapse, regionStart, straightenRegion, locationLine, tightenHeadings } from "./dialects/logseq.mjs"
export { collapseState, applyCollapse } from "./dialects/logseq.mjs"
import { activityOutline } from "./activity.mjs"
import { statusOutline } from "./status.mjs"
import { writeExports } from "./exports.mjs"
import { siteOf, writeSite } from "./site.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { graphFileAt, heldFiles, heldPath, incomingGraphFiles, inRepository } from "./git.mjs"
import { readState as readSyncState, writeState as writeSyncState } from "./syncstate.mjs"
import { ROOT, collect, makeTree, nodesSpec, pageOf } from "./tree.mjs"

const sha = (text) => createHash("sha256").update(text).digest("hex")
// How many earlier outputs of one page or region are still recognized as the engine's.
const BASELINES = 200

/** The record of generated regions and views that protects edits, kept outside the graph. */
export function readBuildState(ws) {
  const file = join(ws.cacheDir, "build.json")
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
}
export function writeBuildState(ws, state) {
  mkdirSync(ws.cacheDir, { recursive: true })
  writeAtomic(join(ws.cacheDir, "build.json"), `${JSON.stringify(state, null, 2)}\n`)
}

/** Collects the graph and fails on broken references, the way the build does. */
export function prepare(ws) {
  const library = collect(ws)
  const result = checkReferences(library, { sourceRoot: ws.graphDir })
  return { library, references: result, model: makeTree(ws, library) }
}

/**
 * Resolve the same view for building and first-screen measurements. `tree` turns a tree fence's
 * resolved lines into outline text; `home --own` passes one that writes plain links.
 */
export function renderView(ws, { library, model }, doc, { tree = (lines) => serializeTree(lines).join("\n") } = {}) {
  const name = pageOf(doc.id)
  const view = structuredClone(doc)
  visit(view.tree, "code", (node, index, parent) => {
    if (node.lang === "activity") { parent.children[index] = raw(activityOutline(ws, model, node.value)); return SKIP }
    if (node.lang === "status") { parent.children[index] = raw(statusOutline(ws, { library, model }, node.value)); return SKIP }
    if (node.lang === "nodes") { parent.children[index] = raw(tree(model.nodeLines(nodesSpec(node.value, ws.labels)))); return SKIP }
    if (node.lang !== "cudoc-embed") return
    const spec = parseEmbedSpec(node.value)
    if (spec.render?.type !== "tree") return
    parent.children[index] = raw(tree(model.resolve(spec, doc.id)))
    return SKIP
  })
  const viewLibrary = { ...library, documents: library.documents.map((item) => item.id === doc.id ? view : item) }
  const body = tightenHeadings(toMarkdown(toOutline(resolveDocumentEmbeds(viewLibrary, doc.id), model), markdownOptions))
  return `${ws.labels.generated}:: views/${name}.mdx\n\n${body}`
}

/** The whole tree (or the part below one node) as plain outline text. */
export function renderTree(ws, { node, path } = {}) {
  const { library, model } = prepare(ws)
  if (path) {
    let id = model.find(path)
    if (!id) throw new Error(format(ws.labels.messages["node-missing"], { name: path }))
    const lines = []
    while (id !== ROOT) {
      const item = model.data.get(id)
      lines.unshift(`- ${wikiLink(pageOf(id))} · ${item.cells.at(-1).text}`)
      id = model.parentOf(id)
    }
    return lines.map((line, depth) => "\t".repeat(depth) + line).join("\n")
  }
  let start = ROOT
  let order
  if (node) {
    start = model.find(node)
    if (!start) throw new Error(format(ws.labels.messages["node-missing"], { name: node }))
  } else {
    const views = library.documents.filter((doc) => model.isView(doc.id))
    const root = views.find((doc) => pageOf(doc.id) === model.rootView) ?? views[0]
    const fence = root?.tree.children.find((item) => item.type === "code" && item.lang === "cudoc-embed" && parseEmbedSpec(item.value).render?.type === "tree")
    order = fence ? parseEmbedSpec(fence.value).render.order : undefined
  }
  return model.outline(start, order).filter((ln) => !COLLAPSED.test(ln)).join("\n")
}

/** Whether a view shows what only one computer knows: an `activity` or `status` fence reads that computer's own records. */
function readsLocalRecords(node) {
  if (node?.type === "code" && (node.lang === "activity" || node.lang === "status")) return true
  return (node?.children ?? []).some(readsLocalRecords)
}

/** Whether the working copy of a generated view page (as a merge or the first build after a clone brought it) is the engine's output. */
function acceptsPage(ws, accepted, doc, file, current) {
  const name = file.normalize("NFC")
  if (!accepted?.files.has(name)) return false
  if (accepted.whole) return true
  if (!readsLocalRecords(doc.tree)) return false
  const was = graphFileAt(ws, accepted.before, file)
  return was === undefined || sha(withoutCollapse(was)) !== sha(withoutCollapse(current))
}

/**
 * Builds the generated parts. Returns what changed; `blocked` lists files that
 * were edited by hand and left alone. With `force` they are overwritten.
 * `prepared` reuses a collection made since the graph last changed, as `save` does after `check`.
 */
export function build(ws, { force = false, prepared, accepted } = {}) {
  const { library, references, model } = prepared ?? prepare(ws)
  const errors = references.issues.filter((issue) => issue.severity === "error")
  if (errors.length) return { references, errors, written: [], blocked: [], repaired: [] }

  const recorded = readBuildState(ws)
  const state = recorded ?? {}
  // A workspace that syncs across computers receives generated pages another computer's build wrote. Two cases are the
  // engine's own output and not a hand edit, and nothing else is:
  //  - a computer that has not built the history it holds yet (right after a clone or a takeover; sync marks it `fresh` and
  //    there is no build record) takes every generated page and region the history holds as it is;
  //  - after a merge (`accepted`: the files it changed and the commit before it), only a view that shows what one computer knows
  //    (an `activity` or `status` fence) and whose generated text the merge itself changed. A node's region shows the shared tree,
  //    so another computer's change to it, or a record lost with the build record, stays protected like any hand edit.
  const fresh = Boolean(ws.sync && typeof ws.sync === "object" && !recorded && inRepository(ws.root) && readSyncState(ws).fresh)
  if (fresh) {
    try { accepted = { files: incomingGraphFiles(ws, null), before: null, whole: true } } catch { accepted = undefined }
  }
  state.pages ??= {}
  state.regions ??= {}
  state.pageBaselines ??= {}
  state.regionBaselines ??= {}
  // A page that changes with every build (an activity view) would grow its list without end; the
  // oldest outputs are forgotten first.
  const remember = (baselines, key, hash) => {
    baselines[key] ??= []
    if (!baselines[key].includes(hash)) baselines[key].push(hash)
    if (baselines[key].length > BASELINES) baselines[key].splice(0, baselines[key].length - BASELINES)
  }
  for (const [key, hash] of Object.entries(state.pages)) remember(state.pageBaselines, key, hash)
  for (const [key, hash] of Object.entries(state.regions)) remember(state.regionBaselines, key, hash)
  const written = []
  const blocked = []
  const repaired = []
  const heading = `## ${ws.labels.region}`
  // The location starts at the view that holds the whole tree, when the graph has one to link to.
  const start = model.rootView ? [model.rootView] : []
  const ancestorsOf = (id) => {
    const names = []
    for (let at = model.parentOf(id); at !== ROOT; at = model.parentOf(at)) names.unshift(pageOf(at))
    return [...start, ...names]
  }

  const write = (path, text) => {
    writeAtomic(path, text)
    written.push(path)
  }

  // A page someone else is changing (held by a scheduled run) is left as it is; its section follows
  // at the next build, as its protection record is left as it was.
  const held = heldFiles(ws)
  for (const doc of model.nodes) {
    const key = doc.id.normalize("NFC")
    const path = join(ws.graphDir, doc.sourcePath)
    if (heldPath(ws, path, held)) continue
    const text = readFileSync(path, "utf8")
    const lines = text.split("\n")
    const at = regionStart(text, ws.labels.region)
    const straightened = at < 0 ? undefined : straightenRegion(lines, at, ws.labels.region)
    const authored = straightened?.authored ?? (at < 0 ? text : lines.slice(0, at).join("\n") + "\n")
    const current = straightened?.current ?? (at < 0 ? "" : lines.slice(at).join("\n").trimEnd())
    const subtree = model.outline(doc.id)
    const location = locationLine(ws.labels.location, ancestorsOf(doc.id), pageOf(doc.id))
    const generated = [`${heading}\n${location}`, subtree.join("\n")].filter(Boolean).join("\n\n")
    const region = current ? applyCollapse(generated, collapseState(current)) : generated
    const expected = state.regions[key]
    const currentHash = sha(withoutCollapse(current))
    if (current && accepted?.whole && accepted.files.has(doc.sourcePath.normalize("NFC"))) remember(state.regionBaselines, key, currentHash)
    const matchesOutput = currentHash === sha(withoutCollapse(region))
    if (!force && !matchesOutput && (current || expected) && !state.regionBaselines[key]?.includes(currentHash)) {
      const code = straightened ? "region-mangled" : expected ? "region-edited" : "protection-missing"
      blocked.push({ file: doc.sourcePath, message: format(ws.labels.messages[code], { file: doc.sourcePath, region: ws.labels.region }) })
      continue
    }
    const separator = authored.endsWith("\n\n") ? "" : authored.endsWith("\n") ? "\n" : "\n\n"
    const next = region ? `${authored}${separator}${region}\n` : authored
    if (region && regionStart(next, ws.labels.region) < 0) {
      blocked.push({ file: doc.sourcePath, message: format(ws.labels.messages["region-unavailable"], { file: doc.sourcePath }) })
      continue
    }
    if (next !== text) write(path, next)
    if (straightened) repaired.push({ file: doc.sourcePath, message: format(ws.labels.messages["region-repaired"], { file: doc.sourcePath, region: ws.labels.region }) })
    if (region) {
      state.regions[key] = sha(withoutCollapse(region))
      remember(state.regionBaselines, key, state.regions[key])
    }
    else delete state.regions[key]
  }

  for (const doc of library.documents.filter((d) => model.isView(d.id))) {
    const name = pageOf(doc.id)
    const target = existingPath(join(ws.graphDir, `${name}.md`))
    const current = existsSync(target) ? readFileSync(target, "utf8") : undefined
    const fresh = renderView(ws, { library, model }, doc)
    const owned = current?.split("\n")[0].normalize("NFC") === `${ws.labels.generated}:: views/${name}.mdx`.normalize("NFC")
    if (owned && acceptsPage(ws, accepted, doc, `${name}.md`, current)) remember(state.pageBaselines, name, sha(withoutCollapse(current)))
    if (current !== undefined && !force && (!owned ||
      sha(withoutCollapse(current)) !== sha(withoutCollapse(fresh)) &&
      !state.pageBaselines[name]?.includes(sha(withoutCollapse(current))))) {
      const code = !owned ? "page-unowned" : state.pages[name] ? "page-edited" : "protection-missing"
      blocked.push({ file: `${name}.md`, message: format(ws.labels.messages[code], { file: `${name}.md` }) })
      continue
    }
    const text = current === undefined ? fresh : applyCollapse(fresh, collapseState(current))
    if (text !== current) write(target, text)
    state.pages[name] = sha(withoutCollapse(text))
    remember(state.pageBaselines, name, state.pages[name])
  }

  writeBuildState(ws, state)
  if (fresh) { try { writeSyncState(ws, { fresh: false }) } catch {} }
  // The files written from the memo follow it. One that cannot be written leaves the build done.
  let exports = [], exportError
  try { exports = writeExports(ws, { model }) } catch (error) { exportError = error.message }
  // So does the website, when the workspace keeps one and asks for it on every build.
  let site, siteError
  try { if (siteOf(ws)?.onSave) site = writeSite(ws, { prepared: { library, references, model } }) } catch (error) { siteError = error.message }
  return { references, errors, written, blocked, repaired, nodes: model.nodes.length, open: model.totalOpen(ROOT), exports, exportError, site, siteError }
}
