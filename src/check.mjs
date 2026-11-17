// The rules that keep a memo short at the top and whole underneath.
//
// Errors break the tree or the outliner: a node without a matching title or a
// summary, two files with one page name, a folder with no node for it, text an
// outliner would swallow. Warnings say a list is getting long: a summary over
// its limit, too many nodes below one node, too many open tasks in one node.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { format } from "./labels.mjs"
import { prepare, renderView } from "./build.mjs"
import { INTAKE, ROOT, isArchive, pageOf, plain, summaryRange, ownedHome, homeLinks } from "./tree.mjs"
import { taskLines, visibleLines, collapseState, applyCollapse, firstListItems } from "./dialects/logseq.mjs"
import { history, behindSummaries } from "./history.mjs"
import { outdatedSkillDetails } from "./skills.mjs"
import { blockIssues } from "./blocks.mjs"
import { pathLines, sharedParent } from "./workspaces.mjs"
import { validateAgents } from "./agents.mjs"
import { sourcesOf } from "./sources.mjs"
import { readDecisions, summaryKept } from "./keeps.mjs"
import { privateLine } from "./notes.mjs"
import { unsupportedQueries } from "./queries.mjs"
import { instructionsSize, instructionsBlockedNotice } from "./instructions.mjs"
import { authoredText, markdownStructure } from "./dialects/logseq.mjs"

const SKIP_TOP = new Set(["logseq", "assets", "views"])
const CONFLICT = /(\.sync-conflict-|\(conflicted copy\))/
import { LINK, scanLines } from "./dialects/logseq.mjs"
const toPosix = (path) => path.split(sep).join("/")

/** Every Markdown page in the graph, the way an outliner sees them, and the copies a sync app left. */
export function walkGraph(ws) {
  const pages = []
  const folders = []
  const conflicts = []
  const visitDir = (dir, top) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      const path = join(dir, entry.name)
      const rel = toPosix(relative(ws.graphDir, path)).normalize("NFC")
      if (entry.isDirectory()) {
        if (top && SKIP_TOP.has(entry.name)) continue
        if (!top) folders.push({ rel, path })
        visitDir(path, false)
      } else if (entry.name.endsWith(".md") && CONFLICT.test(entry.name)) {
        conflicts.push({ path, rel, page: entry.name.replace(/\.sync-conflict-[^.]*|\s*\(conflicted copy[^)]*\)/, "").normalize("NFC") })
      } else if (entry.name.endsWith(".md")) {
        pages.push({ path, rel, name: entry.name.replace(/\.md$/, "").normalize("NFC"), journal: rel.startsWith("journals/") })
      }
    }
  }
  if (existsSync(ws.graphDir)) visitDir(ws.graphDir, true)
  return { pages, folders, conflicts }
}

/**
 * The lines the graph gained since its last commit, as { file, line, text } from the graph folder:
 * the added lines of tracked pages and every line of new ones. Generated pages are left out; outside
 * git, or before the first commit, nothing is.
 */
export function addedSinceCommit(ws) {
  // Paths come back as written: git quotes and escapes a name outside ASCII (a Korean page) otherwise.
  const git = (...args) => spawnSync("git", ["-C", ws.graphDir, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const diff = git("diff", "HEAD", "--unified=0", "--no-color", "--no-ext-diff", "--relative", "--", ".")
  if (diff.status !== 0) return []
  const lines = []
  let file, at
  for (const line of diff.stdout.split("\n")) {
    // A path with a space ends its header with a tab.
    if (line.startsWith("+++ ")) { file = line === "+++ /dev/null" ? undefined : line.slice(4).replace(/\t$/, "").replace(/^b\//, ""); continue }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) at = Number(hunk[1])
    else if (file && line.startsWith("+")) lines.push({ file, line: at++, text: line.slice(1) })
  }
  for (const name of git("ls-files", "--others", "--exclude-standard", "-z", "--", ".").stdout.split("\0").filter(Boolean)) {
    let text
    try { text = readFileSync(join(ws.graphDir, name), "utf8") } catch { continue }
    text.split("\n").forEach((each, index) => lines.push({ file: name, line: index + 1, text: each }))
  }
  const generated = new Map()
  const written = (name) => {
    if (!generated.has(name)) {
      let first = ""
      try { first = readFileSync(join(ws.graphDir, name), "utf8").split("\n", 1)[0] } catch {}
      generated.set(name, first.normalize("NFC").startsWith(`${ws.labels.generated}::`.normalize("NFC")))
    }
    return generated.get(name)
  }
  return lines.map((line) => ({ ...line, file: line.file.normalize("NFC") }))
    .filter((line) => /\.mdx?$/.test(line.file) && line.text.trim() && !written(line.file))
}

const lengthOf = (text) => [...text.replace(LINK, "$1").replace(/\s+/g, " ").trim()].length

/** Checks the graph. Resolves to `{ issues }`; an issue with severity "error" should stop a save. */
export async function check(ws, { now = new Date(), prepared, graph = walkGraph(ws), h, behind } = {}) {
  const issues = validateAgents(ws).map((message, index) => ({ severity: "error", code: "agents-setting", key: `agents-setting|${index}`, message }))
  const add = (severity, code, subject, values, where = {}) =>
    issues.push({
      severity,
      code,
      key: `${code}|${subject}`,
      file: where.file,
      line: where.line,
      message: format(ws.labels.messages[code], values),
    })

  // Every check (including scheduled saves) sees the budget, but exceeding it never stops a save.
  const instructions = instructionsSize(ws)
  const budget = { ...instructions, blocked: instructions.targetBlocked ? " " + instructionsBlockedNotice(ws, instructions) : "" }
  if (instructions.over) add("warning", "instructions-size", "AGENTS.md", budget, { file: "AGENTS.md", line: 1 })
  else if (instructions.aboveTarget) add("note", "instructions-target", "AGENTS.md", budget, { file: "AGENTS.md", line: 1 })

  const { pages, folders } = graph
  const byName = new Map()
  for (const page of pages) {
    const key = page.name.toLowerCase()
    const first = byName.get(key)
    if (first) add("error", "duplicate-name", page.name, { name: page.name, a: first.rel, b: page.rel }, { file: page.rel })
    else byName.set(key, page)
  }

  try {
    prepared ??= prepare(ws)
  } catch (error) {
    issues.push({ severity: "error", code: "collect", key: "collect", message: error.message })
    return { issues }
  }
  const { references, model } = prepared
  // An owner who writes Home sees no summaries there, so the first-list summary limit does not apply.
  const owned = ownedHome(ws)
  for (const issue of references.issues) {
    issues.push({
      severity: issue.severity,
      code: issue.code,
      key: `${issue.code}|${issue.sourcePath}|${issue.reference}`,
      file: issue.sourcePath,
      line: issue.position?.start?.line,
      message: `${issue.sourcePath}: ${issue.message}`,
    })
  }

  // An items source's node is an inbox: its tasks close at the source, so splitting it by size would
  // only scatter outside work the owner still has to place.
  let inboxes = new Set()
  try { inboxes = new Set(sourcesOf(ws).filter((source) => source.kind === "items" && source.node).map((source) => model.find(source.node)).filter(Boolean)) } catch {}
  for (const doc of model.nodes) {
    const name = pageOf(doc.id)
    const file = doc.sourcePath.normalize("NFC")
    const [first, second] = doc.tree.children
    if (!(first?.type === "heading" && first.depth === 1 && plain(first).trim().normalize("NFC") === name)) {
      add("error", "node-title", name, { file, name }, { file, line: 1 })
      continue
    }
    if (second?.type !== "paragraph") {
      add("error", "node-summary", name, { file }, { file, line: first.position?.end?.line })
    } else {
      const n = lengthOf(plain(second))
      const where = { file, line: summaryRange(doc)?.start }
      if (n > ws.summaryMax) add("warning", "summary-long", name, { name, n, max: ws.summaryMax }, where)
      if (!owned && model.parentOf(doc.id) === ROOT && n > ws.topSummaryMax) {
        add("warning", "top-summary-long", name, { name, n, max: ws.topSummaryMax }, where)
      }
    }
    const open = model.ownOpen(doc.id)
    // An owner who sets taskMax to false keeps as many tasks in a node as the work needs.
    if (ws.taskMax !== false && open > ws.taskMax && !inboxes.has(doc.id)) add("warning", "node-large", name, { name, n: open }, { file })
  }

  const meta = new Set(ws.metaNodes.map((name) => name.normalize("NFC")))
  const countKids = (parent, kids) => parent === ROOT ? kids.filter((id) => !meta.has(pageOf(id))) : kids.filter((id) => !isArchive(ws, id))
  for (const [parent, allKids] of model.children) {
    if (parent !== ROOT && isArchive(ws, parent)) continue
    const kids = countKids(parent, allKids)
    if (kids.length <= ws.widthMax) continue
    const name = parent === ROOT ? model.rootView ?? ws.labels.home : pageOf(parent)
    const file = parent === ROOT ? undefined : model.docs.get(parent).sourcePath.normalize("NFC")
    add("warning", "list-wide", name, { name, n: kids.length, max: ws.widthMax }, { file })
  }

  const names = new Set(pages.map((page) => page.name.toLowerCase()))
  // Authored pages are read once for the line rules and the DOING count.
  const authoredPages = []
  for (const page of pages) {
    const text = readFileSync(page.path, "utf8")
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    authoredPages.push(text)
    // Only the owner edits their Home, so nothing there may stop an agent's save.
    scanLines(text, page, names, owned?.rel === page.rel ? (severity, ...rest) => add("warning", ...rest) : add, ws)
  }

  for (const issue of blockIssues(ws, graph)) add(issue.severity, issue.code, issue.key.slice(issue.code.length + 1), issue.values, { file: issue.file, line: issue.line })
  // A workspace that writes the website hears of a query the website cannot show.
  if (ws.site !== undefined) for (const page of pages) {
    let text
    try { text = authoredText(readFileSync(page.path, "utf8"), ws.labels.region) } catch { continue }
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    for (const { line, form } of unsupportedQueries(text, markdownStructure(text).literalLines))
      add("warning", "query-unsupported", `${page.rel}:${line + 1}`, { file: page.rel, line: line + 1, form }, { file: page.rel, line: line + 1 })
  }

  // A folder several nodes work in is shared below their common parent, and each window belongs to
  // one node's work. Nodes in different top nodes split one folder's work with nothing to name it.
  const byPath = new Map()
  for (const line of pathLines(ws, { model })) byPath.set(line.path, [...byPath.get(line.path) ?? [], line])
  for (const [path, lines] of byPath) {
    const nodes = [...new Set(lines.map((line) => line.node))]
    if (nodes.length < 2) continue
    const where = lines.map((line) => `${line.file}:${line.line}`).join(", ")
    if (sharedParent(model, nodes) === ROOT) add("warning", "path-duplicate", path, { path, where }, { file: lines[0].file, line: lines[0].line })
    for (const label of new Set(lines.flatMap((line) => line.labels))) {
      const holders = lines.filter((line) => line.labels.includes(label))
      if (new Set(holders.map((line) => line.node)).size > 1)
        add("warning", "path-window-twice", `${path}#${label}`, { path, label, where: holders.map((line) => `${line.file}:${line.line}`).join(", ") }, { file: holders[0].file, line: holders[0].line })
    }
  }
  for (const name of knowledgeNames(ws)) if (!model.find(name)) add("warning", "knowledge-missing", name, { name })
  const reflectFile = join(ws.root, "reflect.json")
  if (existsSync(reflectFile)) try { JSON.parse(readFileSync(reflectFile, "utf8")) } catch (error) { add("error", "reflect-invalid", "reflect.json", { error: error.message }, { file: "reflect.json" }) }

  for (const { rel, path } of folders) {
    // Pages waiting in pages/ are not on the tree yet, so their folders need no node.
    if (rel.startsWith("journals/") || rel.startsWith(`${INTAKE}/`) || existsSync(`${path}.md`)) continue
    add("error", "orphan-folder", rel, { folder: rel }, { file: rel })
  }

  const ownHistory = !h && !behind
  const isKnowledge = knowledgeOf(ws, model)
  if (!behind) {
    h ??= await history(ws, now)
    behind = await behindSummaries(ws, model, h, isKnowledge)
  }
  if (h?.failed) add("warning", "history-failed", "history", {})
  const doing = authoredPages.reduce((sum, text) =>
    sum + taskLines(text, ws.labels.region).filter((task) => /^DOING(?:\s|$)/.test(task.text)).length, 0)
  // The first screen's width (widthMax) also limits tasks in progress unless doingMax says otherwise; false counts none.
  const doingMax = ws.doingMax ?? ws.widthMax
  if (doingMax !== false && doing > doingMax) add("warning", "doing-wide", "doing", { n: doing, max: doingMax })
  for (const { name, preserved, backup } of outdatedSkillDetails(ws.root, { cache: ws.cacheDir })) {
    const action = preserved ? (backup ? format(ws.labels.messages["skills-outdated-kept"], { name, backup }) : format(ws.labels.messages["skills-outdated-kept-new"], { name })) : ws.labels.messages["skills-outdated-plain"]
    add("warning", "skills-outdated", name, { name, action })
  }
  for (const copy of graph.conflicts ?? []) add("warning", "sync-conflict", copy.rel, { file: copy.rel, page: copy.page }, { file: copy.rel })
  // Only what is new is judged, so a line the owner chose to keep is not raised again; the message
  // names the place, never the words.
  for (const line of addedSinceCommit(ws)) if (privateLine(line.text))
    add("warning", "private-line", `${line.file}:${line.line}`, { file: line.file, line: line.line }, { file: line.file, line: line.line })
  const tops = model.children.get(ROOT) ?? []
  const home = prepared.library.documents.find((doc) => model.isView(doc.id) && pageOf(doc.id) === ws.labels.home.normalize("NFC"))
  const existingHome = pages.find((page) => page.name === ws.labels.home.normalize("NFC"))
  const currentHome = existingHome ? readFileSync(existingHome.path, "utf8") : undefined
  const display = home ? applyCollapse(renderView(ws, prepared, home), collapseState(currentHome ?? "")) : currentHome
  // The first list is the owner's own list on their Home, or the top nodes on a generated one.
  const linked = homeLinks(owned, model)
  // Home shows work through queries and embeds; a task copied there from a node would live in two places.
  if (owned) {
    const words = (text) => text.replace(/^[A-Z]+\s+/, "").replace(/\s+/g, " ").trim().normalize("NFC")
    const kept = new Map()
    for (const doc of model.nodes) for (const task of taskLines(doc.source.text, ws.labels.region))
      if (!kept.has(words(task.text))) kept.set(words(task.text), pageOf(doc.id))
    for (const task of taskLines(owned.text, ws.labels.region)) {
      const node = kept.get(words(task.text))
      if (node) add("warning", "home-copy", `${owned.rel}:${task.line}`, { file: owned.rel, line: task.line, node }, { file: owned.rel, line: task.line })
    }
  }
  // A broken review.json stops review, not a save; then no summary counts as kept.
  let decisions = { kept: {} }
  try { decisions = readDecisions(ws) } catch {}
  const kept = summaryKept(ws, model, decisions, now, isKnowledge)
  const top = { count: owned ? firstListItems(owned.text).length : countKids(ROOT, tops).length, max: ws.widthMax,
    summaryOver: owned ? 0 : tops.filter((id) => { const paragraph = model.docs.get(id).tree.children[1]; return paragraph?.type === "paragraph" && lengthOf(plain(paragraph)) > ws.topSummaryMax }).length,
    // A summary the owner chose to keep is not counted as behind, as review does not ask about it again.
    summaryBehind: (owned ? [...linked] : tops).filter((id) => behind.has(id) && !kept(id)).length, doing,
    visibleLines: display === undefined ? model.outline().filter((line) => /^- /.test(line)).length : visibleLines(display.split("\n").slice(display.startsWith(`${ws.labels.generated}::`) ? 1 : 0).join("\n")) }
  if (ownHistory) h.save()
  return { issues, nodes: model.nodes.length, top }
}

export const errorsOf = (issues) => issues.filter((issue) => issue.severity === "error")

/** Whether a node holds reference knowledge: below a `knowledge` node or a watched source's node. */
export function knowledgeOf(ws, model) {
  let watched = []
  try { watched = sourcesOf(ws).filter((source) => source.kind !== "items" && source.node).map((source) => source.node) } catch {}
  const roots = [...knowledgeNames(ws), ...watched].map((name) => model.find(name)).filter(Boolean).map((id) => id.normalize("NFC"))
  return (id) => roots.some((root) => id.normalize("NFC") === root || id.normalize("NFC").startsWith(`${root}/`))
}

/** The nodes named in the `knowledge` setting: reference knowledge an agent keeps, below them. */
export function knowledgeNames(ws) {
  if (ws.knowledge === undefined) return []
  if (!Array.isArray(ws.knowledge) || ws.knowledge.some((name) => typeof name !== "string")) throw new Error(ws.labels.messages["knowledge-invalid"])
  return ws.knowledge
}
