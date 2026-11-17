import { readFileSync } from "node:fs"
import { check, knowledgeOf, walkGraph } from "./check.mjs"
import { prepare } from "./build.mjs"
import { inbox } from "./inbox.mjs"
import { ROOT, isArchive, pageOf, plain, summaryRange, ownedHome, homeLinks, outsideHome } from "./tree.mjs"
import { authoredText, taskLines, markdownStructure, MARKER, isTaskLine, IDEA, NOTE_PREFIX, CHECK_TAG } from "./dialects/logseq.mjs"
import { history, behindSummaries, summarizedParents } from "./history.mjs"
import { format } from "./labels.mjs"
import { keptAt, legacyReasonId, nodeSubject, questionId, readDecisions, reasonId, subtreeFingerprint, writeDecisions } from "./keeps.mjs"
import { sourceFollowUps } from "./sources.mjs"
import { workspaceFollowUps } from "./workspaces.mjs"

const lineKinds = new Set(["task-overdue", "task-stale", "check-pile", "idea-old", "duplicate", "journal-old", "source-closed", "source-gone", "workspace-gone"])
const topKinds = new Set(["top-warning", "top-inactive", "home-outside"])
const CHECK_TAGS = new RegExp(CHECK_TAG.source, "g")
const normalizeLine = (text) => text.replace(/^\s*-\s*/, "").replace(MARKER, "").trimStart().replace(NOTE_PREFIX, "").replace(CHECK_TAGS, "").replace(/\s+/g, " ").trim().normalize("NFC")
const validDate = (year, month, day) => {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined
}
function dateIn(text, now) {
  const full = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (full) return validDate(...full.slice(1).map(Number))
  const short = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/) ?? text.match(/(\d{1,2})월\s*(\d{1,2})일/)
  if (!short) return undefined
  // A date without a year means the nearest one: "1/5" written in December is next January.
  // Four years each way always include a February 29 before and after.
  const [month, day] = short.slice(1).map(Number)
  const dates = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((offset) => validDate(now.getFullYear() + offset, month, day)).filter(Boolean)
  return dates.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0]
}

/** Everything a review reads, collected once: the tree, history, the waiting journal items and the check. */
async function readGraph(ws, now) {
  const prepared = prepare(ws)
  const { model } = prepared
  const graph = walkGraph(ws)
  const h = await history(ws, now)
  const region = ws.labels.region
  // Journal items still waiting in the inbox, read once per journal page.
  const journals = new Map(graph.pages.filter((page) => page.journal).reverse().map((page) => [page.name, page]))
  const waiting = h.available ? inbox(ws, { graph }).filter((item) => item.kind === "journal") : []
  const journalTexts = new Map(waiting.map((item) => [item.page, readFileSync(journals.get(item.page).path, "utf8")]))
  // Blame every file whose line dates this review reads in one parallel batch: parent summaries,
  // then task and idea lines and waiting journal items when the history is long enough.
  const datedLines = (doc) => taskLines(doc.source.text, region).length > 0
    || !model.managed(doc.id) && !isArchive(ws, doc.id) && IDEA.test(authoredText(doc.source.text, region))
  await h.loadTimes([...new Set([...summarizedParents(model), ...(h.available ? model.nodes.filter(datedLines) : [])])]
    .map((doc) => ({ path: doc.sourcePath, text: doc.source.text }))
    .concat([...journalTexts].map(([name, text]) => ({ path: journals.get(name).rel, text }))))
  const isKnowledge = knowledgeOf(ws, model)
  const behind = await behindSummaries(ws, model, h, isKnowledge)
  const checked = await check(ws, { now, prepared, graph, h, behind })
  // When the owner writes Home, the first list is theirs: ask instead where top nodes outside it belong.
  const owned = ownedHome(ws)
  const linked = homeLinks(owned, model)
  return { model, h, journals, waiting, journalTexts, isKnowledge, behind, checked, owned, linked,
    outside: new Set(owned ? outsideHome(ws, model, linked) : []) }
}

/** Collects candidates: one per reason, with the line or node it is about. */
function candidateList(ws) {
  const candidates = []
  // The subject of a line candidate: its text and which occurrence of that text it is in its node.
  const subjects = new Map()
  const add = (kind, doc, line, text, extra = {}) => {
    // `priorFingerprint` is how an earlier version fingerprinted the reason; a keep recorded under it holds.
    const { priorFingerprint, ...shown } = extra
    const id = doc.id.normalize("NFC")
    const evidence = format(ws.labels.review[kind], { days: ws.staleDays, max: ws.bodyMax, ...shown })
    const subject = lineKinds.has(kind) ? subjects.get(`${id}|${line}`) ?? `${line}|${text}` : nodeSubject(ws, doc)
    const priorIds = priorFingerprint === undefined ? []
      : [reasonId(id, kind, subject, text, priorFingerprint), legacyReasonId(ws, doc, kind, text, priorFingerprint, lineKinds.has(kind))]
    candidates.push({ id: reasonId(id, kind, subject, text, shown.fingerprint), legacyId: legacyReasonId(ws, doc, kind, text, shown.fingerprint, lineKinds.has(kind)),
      priorIds, priorFingerprint: priorFingerprint ?? shown.fingerprint, kind, subject, node: id,
      path: doc.sourcePath.normalize("NFC"), line, text, evidence, recommendation: ws.labels.recommendations[kind], ...shown })
  }
  return { candidates, subjects, add }
}

/** A node's own line subjects: its text, and for a task the text of all its own lines. */
function lineSubjects(subjects, doc, lines, tasks) {
  const key = doc.id.normalize("NFC")
  const taskAt = new Map(tasks.map((task) => [task.line, task]))
  const occurrences = new Map()
  lines.forEach((text, i) => {
    const task = taskAt.get(i + 1)
    const content = task ? task.ownLines.map((i) => lines[i]).join("\n").replace(/^\s*- /, "").trim() : text.trim()
    const n = occurrences.get(content) ?? 0
    occurrences.set(content, n + 1)
    subjects.set(`${key}|${i + 1}`, `${content}\noccurrence:${n}`)
  })
  for (const task of tasks) {
    const subject = subjects.get(`${key}|${task.line}`)
    for (const i of task.ownLines) subjects.set(`${key}|${i + 1}`, subject)
  }
}

/** The candidates of every node: its place on the first list, its size and age, its tasks and lines. */
function nodeCandidates(ws, graph, { subjects, add }, stats, now) {
  const { model, h, isKnowledge, behind, checked, owned, outside } = graph
  const meta = new Set(ws.metaNodes.map((name) => name.normalize("NFC")))
  const longTopSummaries = new Map()
  for (const issue of checked.issues) if (issue.code === "top-summary-long") longTopSummaries.set(issue.file, [...longTopSummaries.get(issue.file) ?? [], issue])
  const duplicates = new Map()
  const oldSubtrees = new Map()
  const old = (time, days = ws.staleDays) => time !== undefined && now.getTime() - time > days * 86400000
  function subtreeOld(id) {
    if (!oldSubtrees.has(id)) {
      const child = model.docs.get(id)
      oldSubtrees.set(id, old(h.file(child.sourcePath, child.source.text).last) && (model.children.get(id) ?? []).every(subtreeOld))
    }
    return oldSubtrees.get(id)
  }
  for (const doc of model.nodes) {
    const lines = authoredText(doc.source.text, ws.labels.region).split("\n")
    stats.lines += lines.length
    const isTop = model.parentOf(doc.id) === ROOT
    const f = h.file(doc.sourcePath, doc.source.text)
    const name = pageOf(doc.id)
    const tasks = taskLines(doc.source.text, ws.labels.region)
    lineSubjects(subjects, doc, lines, tasks)
    for (const issue of longTopSummaries.get(doc.sourcePath.normalize("NFC")) ?? [])
      add("top-warning", doc, issue.line, issue.message)
    if (!owned && isTop && checked.top.count > ws.widthMax && !meta.has(name)) add("top-warning", doc, 1, format(ws.labels.messages["list-wide"], { name: ws.labels.home, n: checked.top.count, max: ws.widthMax }))
    if (behind.has(doc.id)) {
      // Knowledge nodes below are left out of the fingerprint; keeps recorded with them still hold.
      const fingerprint = subtreeFingerprint(ws, model, doc, isKnowledge)
      const prior = subtreeFingerprint(ws, model, doc)
      add("summary-behind", doc, summaryRange(doc)?.start ?? 1, plain(doc.tree.children[1]), { fingerprint, ...(prior === fingerprint ? {} : { priorFingerprint: prior }) })
    }
    // Reference knowledge that agents keep from its sources: its length, age and repeats are no clutter.
    const knowledge = isKnowledge(doc.id)
    if (!owned && isTop && !meta.has(name) && !knowledge && (model.totalOpen(doc.id) === 0 || (h.available && subtreeOld(doc.id))))
      add("top-inactive", doc, 1, lines.join("\n"))
    if (outside.has(doc.id)) add("home-outside", doc, 1, lines.join("\n"))
    // Archived work and the record log are not clutter to review by age or emptiness.
    const managedNode = model.managed(doc.id) || isArchive(ws, doc.id) || knowledge
    if (!model.ownOpen(doc.id) && !model.children.get(doc.id)?.length && !managedNode) add("node-idle", doc, 1, lines.join("\n"))
    const body = lines.slice(summaryRange(doc)?.end ?? 1).filter((line) => line.trim() && !isTaskLine(line))
    if (body.length > ws.bodyMax && !knowledge) add("node-body-long", doc, 1, body.join("\n"))
    if (h.available && old(f.last) && !managedNode) add("node-stale", doc, 1, lines.join("\n"))
    for (const task of tasks) {
      const explicit = [...task.properties, ...task.text.matchAll(/(?:DEADLINE|SCHEDULED):\s*(?:<[^>]*>|\S+)/g)].map(String)
      const dates = explicit.length ? explicit.map((property) => dateIn(property, now)).filter(Boolean) : [dateIn(task.text, now)].filter(Boolean)
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (dates.some((date) => date < today)) add("task-overdue", doc, task.line, task.text, { properties: task.properties })
      const times = h.available ? task.ownLines.map((i) => f.times[i]).filter(Number.isFinite) : []
      if (times.length && old(Math.max(...times))) add("task-stale", doc, task.line, task.text)
    }
    const { literalLines } = markdownStructure(authoredText(doc.source.text, ws.labels.region))
    lines.forEach((text, i) => {
      if (literalLines.has(i) || !text.trim() || /^#/.test(text)) return
      if (CHECK_TAG.test(text)) add("check-pile", doc, i + 1, text)
      if (h.available && !managedNode && IDEA.test(text) && old(f.times[i])) add("idea-old", doc, i + 1, text)
      if (i + 1 <= (summaryRange(doc)?.end ?? 1) || knowledge) return
      const key = normalizeLine(text)
      if (!key || /^(?:collapsed|id|[\w-]+)::/.test(key) || /^\s*(?:DEADLINE|SCHEDULED):/.test(text)) return
      if (!duplicates.has(key)) duplicates.set(key, [])
      duplicates.get(key).push({ doc, line: i + 1, text })
    })
  }
  for (const [, locations] of duplicates) {
    if (new Set(locations.map((hit) => hit.doc.id)).size < 2) continue
    const refs = locations.map(({ doc, line }) => ({ path: doc.sourcePath.normalize("NFC"), line }))
    for (const hit of locations) add("duplicate", hit.doc, hit.line, hit.text, { locations: refs, fingerprint: JSON.stringify(refs) })
  }
}

/** Journal items waiting too long, outside items finished or gone at their source, and folders that are gone. */
function followUpCandidates(ws, graph, { subjects, add }, now) {
  const { model, h, journals, waiting, journalTexts } = graph
  for (const item of waiting) {
    const page = journals.get(item.page)
    const f = h.file(page.rel, journalTexts.get(item.page))
    if (now.getTime() - (f.times[item.line - 1] ?? now.getTime()) > ws.staleDays / 2 * 86400000)
      add("journal-old", { id: page.rel.replace(/\.md$/, ""), sourcePath: page.rel }, item.line, item.text)
  }
  // Outside items finished at their source, or dropped from a complete listing, while the memo still has them open.
  const docsByPath = new Map(model.nodes.map((doc) => [doc.sourcePath.normalize("NFC"), doc]))
  // Each outside item is its own reason, so two items on one line stay apart.
  for (const hit of sourceFollowUps(ws)) {
    const doc = docsByPath.get(hit.path) ?? { id: hit.path.replace(/\.md$/, ""), sourcePath: hit.path }
    // A journal task has no node subject yet; its own text (with continuation lines) stands in.
    if (!subjects.has(`${doc.id.normalize("NFC")}|${hit.line}`)) subjects.set(`${doc.id.normalize("NFC")}|${hit.line}`, hit.content)
    add(hit.kind, doc, hit.line, hit.text,
      { fingerprint: `${hit.source}:${hit.id}`, source: hit.source, item: hit.id, title: hit.title, url: hit.url })
  }
  // A node's workspace folder that is gone is a question about the work, never evidence it is done.
  for (const line of workspaceFollowUps(ws, model)) {
    const doc = docsByPath.get(line.file)
    if (doc) add("workspace-gone", doc, line.line, line.text.trim(), { folder: line.written, fingerprint: line.written })
  }
}

/** First-list questions first, then from the top of the tree down, nodes before their lines. */
function sortCandidates(candidates, { model, owned, linked }) {
  // Resolve each candidate's place once; the comparator runs many times per candidate.
  const places = new Map()
  const place = (candidate) => {
    if (!places.has(candidate.node)) {
      let id = model.find(candidate.node), n = 0
      const top = id !== undefined && (owned ? linked.has(id) : model.parentOf(id) === ROOT)
      while (id && model.parentOf(id)) { n++; id = model.parentOf(id) }
      places.set(candidate.node, { top, depth: n })
    }
    return places.get(candidate.node)
  }
  const topKind = (candidate) => topKinds.has(candidate.kind) || candidate.kind === "summary-behind" && place(candidate).top
  candidates.sort((a, b) => Number(topKind(b)) - Number(topKind(a)) || place(a).depth - place(b).depth
    || Number(lineKinds.has(a.kind)) - Number(lineKinds.has(b.kind))
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || a.kind.localeCompare(b.kind, "en"))
}

/** One question per node or individual line, with every reason attached. */
function questionsOf(candidates) {
  const groups = new Map()
  for (const candidate of candidates) {
    const scope = lineKinds.has(candidate.kind) ? "line" : "node"
    const key = `${candidate.node}|${scope}|${candidate.subject}`
    if (!groups.has(key)) {
      const { subject, legacyId, priorIds, priorFingerprint, ...item } = candidate
      groups.set(key, { ...item, scope, reasons: [], legacyIds: [], priorPrints: [] })
    }
    const group = groups.get(key)
    if (!group.reasons.some((reason) => reason.id === candidate.id)) {
      const { subject, legacyId, priorIds, priorFingerprint, ...reason } = candidate
      group.reasons.push(reason)
      if (reason.kind === "summary-behind") group.priorPrints.push(priorFingerprint)
    }
    group.legacyIds.push(candidate.legacyId, ...candidate.priorIds)
  }
  for (const [key, group] of groups) {
    const fingerprints = group.reasons.filter((reason) => reason.kind === "summary-behind").map((reason) => reason.fingerprint).join("\n")
    group.id = questionId(group.node, group.scope, key, fingerprints)
    // The question's id from before knowledge nodes left the fingerprint; a keep under it still holds.
    const prior = group.priorPrints.join("\n")
    if (prior !== fingerprints) group.legacyIds.push(questionId(group.node, group.scope, key, prior))
    delete group.priorPrints
    group.evidence = group.reasons.map((reason) => reason.evidence).join(" ")
  }
  return [...groups.values()]
}

/** The questions no keep decision covers, unless `includeKept`. */
function unanswered(ws, questions, now, includeKept) {
  const activeKeep = keptAt(ws, readDecisions(ws), now)
  const legacyGroups = new Map()
  for (const question of questions) for (const id of question.legacyIds) {
    if (!legacyGroups.has(id)) legacyGroups.set(id, new Set())
    legacyGroups.get(id).add(question.id)
  }
  const open = questions.filter((question) => includeKept || ![question.id,
    ...question.reasons.map((reason) => reason.id),
    // A formerly shared task id cannot identify which identical occurrence was kept.
    ...question.legacyIds.filter((id) => legacyGroups.get(id).size === 1),
  ].some(activeKeep))
  for (const question of questions) delete question.legacyIds
  return open
}

export async function review(ws, { limit, node, now = new Date(), includeKept = false } = {}) {
  const graph = await readGraph(ws, now)
  const { model, h, checked } = graph
  const stats = { nodes: model.nodes.length, lines: 0, open: model.totalOpen(ROOT) }
  const list = candidateList(ws)
  nodeCandidates(ws, graph, list, stats, now)
  followUpCandidates(ws, graph, list, now)
  const { candidates } = list
  sortCandidates(candidates, graph)
  const questions = questionsOf(candidates)
  let selected = unanswered(ws, questions, now, includeKept)
  const suppressedQuestions = questions.length - selected.length
  if (node) {
    const id = model.find(node)
    if (!id) throw new Error(format(ws.labels.messages["node-missing"], { name: node }))
    selected = selected.filter((candidate) => candidate.node === id.normalize("NFC") || candidate.node.startsWith(`${id.normalize("NFC")}/`))
  }
  stats.reasons = candidates.length
  stats.questions = selected.length
  stats.mergedReasons = candidates.length - questions.length
  stats.suppressedQuestions = suppressedQuestions
  if (limit !== undefined) selected = selected.slice(0, limit)
  h.save()
  const notice = h.failed ? ws.labels.messages["history-failed"] : h.available ? undefined : ws.labels.messages["history-short"]
  return { stats, top: checked.top, ageAvailable: h.available, notice, candidates: selected }
}

export async function keepCandidates(ws, ids, { now = new Date() } = {}) {
  const { candidates } = await review(ws, { now, includeKept: true })
  const all = new Map(candidates.flatMap((candidate) => [candidate.id, ...candidate.reasons.map((reason) => reason.id)].map((id) => [id, candidate])))
  for (const id of ids) if (!all.has(id)) throw new Error(format(ws.labels.messages["review-unknown"], { id }))
  const record = readDecisions(ws)
  // Expired decisions no longer suppress anything; drop them so the file stays small.
  const active = keptAt(ws, record, now)
  record.kept = Object.fromEntries(Object.entries(record.kept).filter(([id]) => active(id)))
  const groups = new Set(ids.map((id) => all.get(id)))
  for (const candidate of groups) record.kept[candidate.id] = { at: now.toISOString(), reasons: candidate.reasons.map((reason) => reason.id) }
  writeDecisions(ws, record)
  return groups.size
}
