// Home is either generated from `views/Home.mdx` or written by the owner. Handing it over keeps
// every node: the whole tree moves to the Archive view, and Home starts as plain links to the
// nodes it listed plus the view's other sections, which the owner then edits as they like.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join, posix, relative } from "node:path"
import { visit } from "unist-util-visit"
import { compileDocument } from "@cudoment/cudoc/markdown"
import { checkReferences } from "@cudoment/cudoc/node/check"
import { parseEmbedSpec } from "@cudoment/cudoc/node/resolve-embed"
import { build, prepare, readBuildState, renderView, writeBuildState } from "./build.mjs"
import { walkGraph } from "./check.mjs"
import { applyCollapse, collapseState, embedTargets, linkTargets, wikiLink, withoutCollapse } from "./dialects/logseq.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { homeLinks, outsideHome, ownedHome, pageOf } from "./tree.mjs"

const sha = (text) => createHash("sha256").update(text).digest("hex")
const isTreeFence = (node) => node.type === "code" && node.lang === "cudoc-embed" && parseEmbedSpec(node.value).render?.type === "tree"

/** Whether a document links to `target` (a library id such as `views/Home`) with a Markdown link. */
function linksTo(doc, target) {
  let found = false
  visit(doc.tree, (node) => {
    if (found || !["link", "definition"].includes(node.type) || /^[a-z][a-z0-9+.-]*:/i.test(node.url)) return
    let path = node.url.split("#")[0]
    try { path = decodeURI(path) } catch {}
    if (!path) return
    const full = path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(doc.sourcePath), path)
    found = full.normalize("NFC").replace(/\.mdx?$/, "") === target
  })
  return found
}

/**
 * Who writes Home, and for an owner's Home: what it links to, the pages it embeds and how many nodes
 * the views among them show, what it misses and which top nodes it does not reach.
 */
export function homeStatus(ws) {
  const home = ownedHome(ws)
  if (!home) return { owned: false, view: `views/${ws.labels.home}.mdx` }
  const { model } = prepare(ws)
  const linked = homeLinks(home, model)
  const pages = new Set(walkGraph(ws).pages.map((page) => page.name.toLowerCase()))
  const missing = [...new Set(linkTargets(home.text).map(({ target }) => target).filter((target) => !pages.has(target.toLowerCase())))]
  const embedded = [...new Set(embedTargets(home.text).map(({ target }) => target))]
    .map((page) => ({ page, exists: pages.has(page.toLowerCase()), nodes: new Set(model.viewReach(page)).size }))
  return { owned: true, home: home.rel, archive: model.rootView, linked: [...linked].map(pageOf), embedded, missing,
    outside: outsideHome(ws, model, linked).map(pageOf) }
}

/** Past a `;` comment or a string at `i` in EDN text; `i` itself when neither starts there. */
function skipEdn(text, i) {
  if (text[i] === ";") { const end = text.indexOf("\n", i); return end < 0 ? text.length : end }
  if (text[i] !== '"') return i
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++
    else if (text[j] === '"') return j + 1
  }
  return text.length
}
/** Past the next EDN form after `i`: a string, a bracketed form or a token. */
function skipForm(text, i) {
  while (i < text.length && (/[\s,]/.test(text[i]) || text[i] === ";")) i = text[i] === ";" ? skipEdn(text, i) : i + 1
  if (text[i] === '"') return skipEdn(text, i)
  const close = { "[": "]", "(": ")", "{": "}" }[text[i]]
  if (!close) { while (i < text.length && !/[\s,;"[\](){}]/.test(text[i])) i++; return i }
  for (let at = i + 1; at < text.length;) {
    if (text[at] === close) return at + 1
    const after = /[[({]/.test(text[at]) ? skipForm(text, at) : skipEdn(text, at)
    at = after === at ? at + 1 : after
  }
  return text.length
}
/** The `[...]` vector after `key` in EDN text and the strings in it, ignoring comments and discarded forms. */
function ednVector(text, key) {
  for (let i = 0; i < text.length;) {
    const next = skipEdn(text, i)
    if (next !== i) { i = next; continue }
    if (!text.startsWith(key, i) || /[\w?!*.:/-]/.test(text[i + key.length] ?? "")) { i++; continue }
    let open = i + key.length
    for (let after; open < text.length; open = after) {
      after = text[open] === ";" ? skipEdn(text, open) : /[\s,]/.test(text[open]) ? open + 1 : open
      if (after === open) break
    }
    if (text[open] !== "[") return undefined
    const strings = []
    for (let at = open + 1; at < text.length;) {
      if (text[at] === "]") return { open, close: at, strings }
      // `#_` discards the next form, so a string after it is no entry.
      if (text.startsWith("#_", at)) { at = skipForm(text, at + 2); continue }
      const after = skipEdn(text, at)
      if (after === at) { at++; continue }
      if (text[at] === '"') strings.push(text.slice(at + 1, after - 1).replace(/\\(.)/g, "$1"))
      at = after
    }
    return undefined
  }
  return undefined
}

/** Adds a page to the sidebar favorites in logseq/config.edn, if the graph keeps a favorites list there. */
function addFavorite(ws, name) {
  const path = join(ws.graphDir, "logseq", "config.edn")
  if (!existsSync(path)) return false
  const text = readFileSync(path, "utf8")
  const vector = ednVector(text, ":favorites")
  if (!vector) return false
  if (vector.strings.some((item) => item.normalize("NFC") === name.normalize("NFC"))) return false
  const inside = text.slice(vector.open + 1, vector.close)
  const gap = inside.trim() && !/\s$/.test(inside) ? " " : ""
  writeAtomic(path, `${text.slice(0, vector.close)}${gap}"${name}"${text.slice(vector.close)}`)
  return true
}

/**
 * Hands Home over to the owner. `views/Home.mdx` becomes `views/Archive.mdx` with the tree, and
 * `Home.md` becomes the owner's page: links to the nodes the tree listed first, a link to the
 * Archive and the view's other sections, keeping the reader's folds. Then it builds.
 * Everything that could stop it is checked before a file changes, and a failed write puts every
 * file back, so the handover can be retried.
 */
export function ownHome(ws) {
  const views = join(ws.graphDir, "views")
  const viewPath = existingPath(join(views, `${ws.labels.home}.mdx`))
  if (!existsSync(viewPath)) throw new Error(format(ws.labels.messages["home-own-missing"], { view: relative(ws.graphDir, viewPath) }))
  const archiveView = existingPath(join(views, `${ws.labels.archive}.mdx`))
  const archiveName = ws.labels.archive.normalize("NFC").toLowerCase()
  const clash = existsSync(archiveView) ? relative(ws.graphDir, archiveView)
    : walkGraph(ws).pages.find((page) => page.name.toLowerCase() === archiveName)?.rel
  if (clash) throw new Error(format(ws.labels.messages["home-own-exists"], { path: clash }))

  const state = readBuildState(ws)
  const prepared = prepare(ws)
  const errors = prepared.references.issues.filter((issue) => issue.severity === "error")
  if (errors.length) throw new Error(errors.map((issue) => `${issue.sourcePath}: ${issue.message}`).join("\n"))
  const { library, model } = prepared
  const doc = library.documents.find((item) => model.isView(item.id) && pageOf(item.id) === ws.labels.home.normalize("NFC"))
  // Another page that links to or embeds the Home view would break when the view goes.
  // cudoc finds a broken embed once the view leaves the library; a link it checks on disk, so look for those directly.
  const others = library.documents.filter((item) => item !== doc)
  const dependents = [
    ...checkReferences({ ...library, documents: others }, { sourceRoot: ws.graphDir }).issues.filter((issue) => issue.severity === "error").map((issue) => issue.sourcePath),
    ...others.filter((item) => linksTo(item, doc.id.normalize("NFC"))).map((item) => item.sourcePath),
  ]
  if (dependents.length) throw new Error(format(ws.labels.messages["home-own-referenced"], { files: [...new Set(dependents.map((path) => path.normalize("NFC")))].join(", ") }))
  const source = readFileSync(viewPath, "utf8")
  const fences = compileDocument(source).tree.children.filter(isTreeFence)
  if (!fences.length) throw new Error(format(ws.labels.messages["home-own-missing"], { view: relative(ws.graphDir, viewPath) }))
  const lines = source.split("\n")
  const fenceText = fences.map((fence) => lines.slice(fence.position.start.line - 1, fence.position.end.line).join("\n")).join("\n\n")

  const homePath = existingPath(join(ws.graphDir, `${ws.labels.home}.md`))
  const current = existsSync(homePath) ? readFileSync(homePath, "utf8") : undefined
  // Hand-made changes to the generated Home would be lost, so they stop the handover as they stop a build.
  if (current !== undefined) {
    const name = ws.labels.home.normalize("NFC")
    const hash = sha(withoutCollapse(current))
    const owned = current.split("\n")[0].normalize("NFC") === `${ws.labels.generated}:: views/${name}.mdx`.normalize("NFC")
    const known = hash === sha(withoutCollapse(renderView(ws, prepared, doc))) || state?.pages?.[name] === hash
      || state?.pageBaselines?.[name]?.includes(hash)
    if (!owned || !known) throw new Error(format(ws.labels.messages["home-own-edited"], { file: relative(ws.graphDir, homePath).normalize("NFC") }))
  }
  const listed = []
  const links = (tree) => {
    listed.push(...tree.map((line) => wikiLink(line.name)))
    return [...tree.map((line) => `- ${wikiLink(line.name)}`), `- ${wikiLink(ws.labels.archive)}`].join("\n")
  }
  const rendered = renderView(ws, prepared, doc, { tree: links })
  // Keep the reader's folds in the other sections; the new links have nothing below them to fold.
  const folds = collapseState(current ?? "")
  for (const key of listed) folds.delete(key)
  const home = applyCollapse(rendered.slice(rendered.indexOf("\n\n") + 2), folds)

  const undo = []
  let favorite
  try {
    writeAtomic(archiveView, `# ${ws.labels.archive}\n\n${fenceText}\n`)
    undo.push(() => rmSync(archiveView, { force: true }))
    writeAtomic(homePath, home.endsWith("\n") ? home : `${home}\n`)
    undo.push(() => current === undefined ? rmSync(homePath, { force: true }) : writeAtomic(homePath, current))
    rmSync(viewPath)
    undo.push(() => writeAtomic(viewPath, source))
    // Home is no generated page any more, so its protection record goes.
    if (state) {
      const saved = structuredClone(state)
      const name = ws.labels.home.normalize("NFC")
      delete state.pages?.[name]
      delete state.pageBaselines?.[name]
      writeBuildState(ws, state)
      undo.push(() => writeBuildState(ws, saved))
    }
    // Last, so a failure leaves the configuration as it was.
    favorite = addFavorite(ws, ws.labels.archive)
  } catch (error) {
    for (const step of undo.reverse()) try { step() } catch {}
    throw error
  }
  // Home is handed over now; a failed build leaves a valid graph that the next build completes.
  let built
  try { built = build(ws) } catch (error) { throw new Error(format(ws.labels.messages["home-own-build"], { error: error.message })) }
  return { home: relative(ws.graphDir, homePath).normalize("NFC"), archive: `${ws.labels.archive}.md`, favorite, built }
}
