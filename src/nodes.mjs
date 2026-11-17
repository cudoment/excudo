import { existsSync, renameSync, rmSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { prepare, readBuildState, writeBuildState } from "./build.mjs"
import { check, knowledgeNames, walkGraph } from "./check.mjs"
import { authoredText, DECISION, LINK, markdownStructure, regionStart } from "./dialects/logseq.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { INTAKE, homeLinks, ownedHome } from "./tree.mjs"

const inGraph = (ws, path) => {
  const rel = relative(ws.graphDir, path)
  return rel && !rel.startsWith("..") && !rel.startsWith("/")
}
/** A page created in the outliner that still waits in `pages/` to be placed. */
function intakePage(ws, name) {
  const key = name.normalize("NFC").replace(/\.md$/, "").toLowerCase()
  return walkGraph(ws).pages.find((page) => page.rel.startsWith(`${INTAKE}/`) && page.name.toLowerCase() === key)
}
/** Moves a node with its descendants, or places a page waiting in `pages/`, below `parent`. */
export async function move(ws, name, parent) {
  const { model } = prepare(ws)
  const id = model.find(name)
  const waiting = id ? undefined : intakePage(ws, name)
  if (!id && !waiting) throw new Error(format(ws.labels.messages["node-missing"], { name }))
  const doc = id ? model.docs.get(id) : { sourcePath: waiting.rel }
  // A waiting page keeps its on-disk spelling, which may be NFD after a phone sync.
  const source = id ? join(ws.graphDir, doc.sourcePath) : waiting.path
  const sourceFolder = existingPath(source.replace(/\.md$/, ""))
  const parentId = model.find(parent)
  let targetFolder
  if (parentId) targetFolder = existingPath(join(ws.graphDir, model.docs.get(parentId).sourcePath.replace(/\.md$/, "")))
  else {
    targetFolder = existingPath(resolve(ws.graphDir, parent))
    const rel = relative(ws.graphDir, targetFolder)
    if (!inGraph(ws, targetFolder) || rel.includes("/") || !existsSync(targetFolder) || (new RegExp(`^(?:views|journals|logseq|assets|${INTAKE})$`).test(rel) || rel.startsWith(".")))
      throw new Error(format(ws.labels.messages["move-parent"], { parent }))
  }
  if (targetFolder === sourceFolder || inGraph({ graphDir: sourceFolder }, targetFolder))
    throw new Error(ws.labels.messages["move-cycle"])
  const target = existingPath(join(targetFolder, source.split("/").at(-1)))
  if (source === target) return { from: doc.sourcePath, to: doc.sourcePath, top: (await check(ws)).top }
  const targetChildren = existingPath(target.replace(/\.md$/, ""))
  if (existsSync(target) || existsSync(targetChildren)) throw new Error(format(ws.labels.messages["move-collision"], { path: relative(ws.graphDir, target) }))
  const state = id ? readBuildState(ws) : undefined
  mkdirSync(targetFolder, { recursive: true })
  renameSync(source, target)
  try { if (id && existsSync(sourceFolder)) renameSync(sourceFolder, targetChildren) }
  catch (error) { renameSync(target, source); throw error }
  if (state) carryRegions(ws, state, id, target)
  return { from: doc.sourcePath, to: relative(ws.graphDir, target).normalize("NFC"), top: (await check(ws)).top }
}

/** The protection baseline follows a moved or renamed node, including its descendants. */
function carryRegions(ws, state, id, target) {
  const from = id.normalize("NFC")
  const to = relative(ws.graphDir, target).replace(/\.md$/, "").normalize("NFC")
  for (const [key, value] of Object.entries(state.regions ?? {})) {
    if (key !== from && !key.startsWith(from + "/")) continue
    delete state.regions[key]
    state.regions[to + key.slice(from.length)] = value
  }
  // Retain old locations too: reverting a batch restores those paths.
  for (const [key, hashes] of Object.entries(state.regionBaselines ?? {})) {
    if (key !== from && !key.startsWith(from + "/")) continue
    const targetKey = to + key.slice(from.length)
    state.regionBaselines[targetKey] = [...new Set([...(state.regionBaselines[targetKey] ?? []), ...hashes])]
  }
  writeBuildState(ws, state)
}

const escapeRule = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/**
 * `text` with its links to `from` (in any case) pointing to `to`, outside code and HTML: `[[from]]`,
 * also inside embeds and queries, and `#from` when the name has no spaces. Returns the text and the
 * lines (0-based) that changed and how many links did.
 */
function relink(text, from, to) {
  const key = from.normalize("NFC").toLowerCase()
  const tag = /^[^\s#[\],]+$/u.test(from) ? new RegExp(`(^|[\\s(])#${escapeRule(from.normalize("NFC"))}(?=$|[\\s,.;:!?)\\]])`, "giu") : undefined
  let count = 0
  const swap = (part) => {
    let next = part.replace(LINK, (whole, target) => target.normalize("NFC").toLowerCase() === key ? (count++, `[[${to}]]`) : whole)
    if (tag) next = next.replace(tag, (_, lead) => (count++, `${lead}#${/\s/.test(to) ? `[[${to}]]` : to}`))
    return next
  }
  let out = ""
  let at = 0
  for (const [start, end] of markdownStructure(text).literalRanges) {
    if (start < at) continue
    out += swap(text.slice(at, start)) + text.slice(start, end)
    at = end
  }
  out += swap(text.slice(at))
  const before = text.split("\n")
  const lines = out.split("\n").flatMap((line, i) => line !== before[i] ? [i] : [])
  return { text: out, lines, count }
}

/** The settings in excudo.config.mjs that name a node. */
function settingsNaming(ws, name) {
  const key = name.normalize("NFC").toLowerCase()
  const same = (value) => typeof value === "string" && value.normalize("NFC").toLowerCase() === key
  return [
    ...(ws.sources ?? []).filter((source) => same(source?.node)).map((source) => `sources (${source.name})`),
    ...knowledgeNames(ws).some(same) ? ["knowledge"] : [],
    ...same(ws.interests) ? ["interests"] : [],
    ...(ws.metaNodes ?? []).some(same) ? ["labels"] : [],
  ]
}

/**
 * Renames a node: its file, the folder of its children, its title line, and the links to it across
 * the graph's authored text, keeping its build protection. The owner's Home changes only with
 * `home` (when the owner's request covers it) and is otherwise reported; the settings that name the
 * node are reported, since they are code.
 */
export async function rename(ws, name, newName, { home: relinkHome = false } = {}) {
  const { model } = prepare(ws)
  const id = model.find(name)
  if (!id) throw new Error(format(ws.labels.messages["node-missing"], { name }))
  const title = String(newName ?? "").normalize("NFC").trim()
  if (!title || title.startsWith(".") || /[/\\[\]]/.test(title) || title.endsWith(".md")) throw new Error(format(ws.labels.messages["rename-invalid"], { name: newName }))
  const doc = model.docs.get(id)
  const source = existingPath(join(ws.graphDir, doc.sourcePath))
  const old = source.split("/").at(-1).replace(/\.md$/, "").normalize("NFC")
  const self = doc.sourcePath.normalize("NFC")
  // Page names are unique in the whole graph, whatever their case; a change of case alone is the node itself.
  if (walkGraph(ws).pages.some((page) => page.rel !== self && page.name.toLowerCase() === title.toLowerCase()))
    throw new Error(format(ws.labels.messages["rename-taken"], { name: title }))
  const target = join(dirname(source), `${title}.md`)
  const sourceFolder = existingPath(source.replace(/\.md$/, ""))
  const targetFolder = join(dirname(source), title)
  const caseOnly = old.toLowerCase() === title.toLowerCase()
  if (!caseOnly && (existsSync(target) || existsSync(targetFolder))) throw new Error(format(ws.labels.messages["move-collision"], { path: relative(ws.graphDir, target) }))
  const state = readBuildState(ws)
  if (old !== title) {
    renameSync(source, target)
    try { if (existsSync(sourceFolder)) renameSync(sourceFolder, targetFolder) }
    catch (error) { renameSync(target, source); throw error }
  }
  const heading = readFileSync(target, "utf8").split("\n")
  if (heading[0]?.normalize("NFC") === `# ${old}`) writeAtomic(target, [`# ${title}`, ...heading.slice(1)].join("\n"))

  const home = ownedHome(ws)
  const changed = { links: 0, files: 0 }
  const homeLines = []
  for (const page of walkGraph(ws).pages) {
    const text = readFileSync(page.path, "utf8")
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    // The generated region is written again by the next build.
    const lines = text.split("\n")
    const at = regionStart(text, ws.labels.region)
    const authored = at < 0 ? text : lines.slice(0, at).join("\n")
    const result = relink(authored, old, title)
    if (!result.lines.length) continue
    if (home && page.rel === home.rel && !relinkHome) { homeLines.push(...result.lines.map((line) => line + 1)); continue }
    writeAtomic(page.path, at < 0 ? result.text : [result.text, ...lines.slice(at)].join("\n"))
    changed.links += result.count
    changed.files += 1
  }
  if (state) carryRegions(ws, state, id, target)
  return { from: doc.sourcePath, to: relative(ws.graphDir, target).normalize("NFC"), name: title, previous: old, ...changed,
    home: homeLines, settings: settingsNaming(ws, old), top: (await check(ws)).top }
}
export function remove(ws, name, { force = false } = {}) {
  const { model } = prepare(ws)
  const id = model.find(name)
  if (!id) throw new Error(format(ws.labels.messages["node-missing"], { name }))
  const ids = new Set()
  const collect = (id) => { ids.add(id); for (const child of model.children.get(id) ?? []) collect(child) }
  collect(id)
  const protectedNodes = [...ids].filter((id) => model.ownOpen(id) || DECISION.test(authoredText(model.docs.get(id).source.text, ws.labels.region)))
  if (!force && protectedNodes.length) throw new Error(format(ws.labels.messages["remove-protected"], { name }))
  // Only the owner edits their Home, so a node it links to stays until they drop the link.
  const linked = homeLinks(ownedHome(ws), model)
  if (!force && [...ids].some((id) => linked.has(id))) throw new Error(format(ws.labels.messages["remove-home"], { name }))
  const names = new Set([...ids].map((id) => model.docs.get(id).sourcePath.split("/").at(-1).replace(/\.md$/, "").normalize("NFC").toLowerCase()))
  const deletedPaths = new Set([...ids].map((id) => model.docs.get(id).sourcePath.normalize("NFC")))
  const links = []
  for (const page of walkGraph(ws).pages) {
    if (deletedPaths.has(page.rel)) continue
    const text = readFileSync(page.path, "utf8")
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    authoredText(text, ws.labels.region).split("\n").forEach((text, i) => {
      for (const link of text.matchAll(LINK)) if (names.has(link[1].normalize("NFC").toLowerCase())) links.push({ path: page.rel, line: i + 1, target: link[1].normalize("NFC"), text })
    })
  }
  // Read the build state before deleting anything, so an unreadable cache stops the removal untouched.
  const state = readBuildState(ws)
  const path = join(ws.graphDir, model.docs.get(id).sourcePath)
  rmSync(path)
  rmSync(existingPath(path.replace(/\.md$/, "")), { recursive: true, force: true })
  // A removed node no longer owns a region. Its baselines stay so reverting the removal still builds.
  if (state?.regions) {
    for (const removed of ids) delete state.regions[removed.normalize("NFC")]
    writeBuildState(ws, state)
  }
  return { removed: [...ids].map((id) => id.normalize("NFC")), links }
}
