// Moves finished items (DONE, CANCELED) to the Done node, newest first, and keeps
// only the most recent few there. An item moves together with everything nested
// under it, so an item that still has an open task below it stays where it is.
// `canceled` moves only the items marked CANCELED, the work the owner decided not to do,
// and leaves Done as it is when there are none.
import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { walkGraph } from "./check.mjs"
import { prepare } from "./build.mjs"
import { move } from "./nodes.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { history } from "./history.mjs"
import { format } from "./labels.mjs"
import { heldFiles, heldPath, heldWithin } from "./git.mjs"
import { ROOT } from "./tree.mjs"
import { authoredText, OPEN, CLOSED, blocksOf, descendants, authoredEnd } from "./dialects/logseq.mjs"

const CANCELED = /^CANCELL?ED(\s|$)/
const monthOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`

function donePathOf(ws) {
  const page = walkGraph(ws).pages.find((page) => page.name === ws.labels.done.normalize("NFC"))
  return page?.path ?? join(ws.graphDir, `${ws.labels.done}.md`)
}
function ensureMonth(ws, month) {
  const donePath = donePathOf(ws)
  if (!existsSync(donePath)) writeAtomic(donePath, `# ${ws.labels.done}\n${ws.labels.doneSummary}\n`)
  const year = month.slice(0, 4)
  const yearName = `${ws.labels.done} ${year}`
  const monthName = `${ws.labels.done} ${month}`
  const yearPath = existingPath(join(donePath.replace(/\.md$/, ""), `${yearName}.md`))
  const monthPath = existingPath(join(yearPath.replace(/\.md$/, ""), `${monthName}.md`))
  const names = walkGraph(ws).pages
  for (const [path, name, summary] of [[yearPath, yearName, format(ws.labels.yearSummary, { year, items: 0, nodes: 0 })], [monthPath, monthName, format(ws.labels.monthSummary, { year, month: month.slice(5), items: 0, nodes: 0 })]]) {
    if (names.some((page) => page.name === name.normalize("NFC") && page.path !== path)) throw new Error(format(ws.labels.messages["archive-collision"], { name }))
    if (!existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeAtomic(path, `# ${name}\n${summary}\n`) }
  }
  return monthPath
}
function updateSummary(ws, path, values, label) {
  const text = readFileSync(path, "utf8")
  const lines = text.split("\n")
  let start = 1
  while (start < lines.length && !lines[start].trim()) start++
  let end = start
  while (end < lines.length && lines[end].trim()) end++
  lines.splice(start, end - start, format(label, values))
  writeAtomic(path, lines.join("\n"))
}
export function refreshArchives(ws) {
  const { pages } = walkGraph(ws)
  const doneDir = donePathOf(ws).replace(/\.md$/, "")
  const years = new Map()
  for (const page of pages) {
    const prefix = `${ws.labels.done} `
    if (!page.name.startsWith(prefix)) continue
    const month = page.name.slice(prefix.length)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    const text = authoredText(readFileSync(page.path, "utf8"), ws.labels.region)
    const lines = text.split("\n")
    const items = blocksOf(lines, 0, lines.length).filter((block) => CLOSED.test(block.text)).length
    const folder = existingPath(page.path.replace(/\.md$/, ""))
    const nodes = existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".md")).length : 0
    const year = month.slice(0, 4)
    updateSummary(ws, page.path, { year, month: month.slice(5), items, nodes }, ws.labels.monthSummary)
    const total = years.get(year) ?? { items: 0, nodes: 0 }
    total.items += items; total.nodes += nodes; years.set(year, total)
  }
  for (const [year, total] of years) {
    const path = existingPath(join(doneDir, `${ws.labels.done} ${year}.md`))
    updateSummary(ws, path, { year, ...total }, ws.labels.yearSummary)
  }
}
export async function archive(ws, { node, canceled = false, now = new Date() } = {}) {
  // The done node and its months take every move; while someone else is changing one of them (held by a
  // scheduled run), nothing moves now and a later run archives.
  const held = heldFiles(ws)
  const donePathAt = donePathOf(ws)
  if (heldWithin(ws, donePathAt, held) || heldWithin(ws, donePathAt.replace(/\.md$/, ""), held)) throw new Error(ws.labels.messages["archive-held"])
  if (node) {
    const { model } = prepare(ws)
    const id = model.find(node)
    if (!id) throw new Error(format(ws.labels.messages["node-missing"], { name: node }))
    if (model.totalOpen(id)) throw new Error(format(ws.labels.messages["archive-open"], { name: node }))
    // Resolve the names the way `find` does, so `archive record` cannot slip past the guard.
    const metaIds = ws.metaNodes.map((name) => model.find(name)).filter(Boolean)
    const doneId = model.find(ws.labels.done)
    let underDone = false
    for (let at = model.parentOf(id); at !== ROOT; at = model.parentOf(at)) if (at === doneId) underDone = true
    if (metaIds.includes(id) || underDone) throw new Error(format(ws.labels.messages["archive-meta"], { name: node }))
    const source = join(ws.graphDir, model.docs.get(id).sourcePath)
    if (heldWithin(ws, source, held) || heldWithin(ws, source.replace(/\.md$/, ""), held)) throw new Error(ws.labels.messages["archive-held"])
    const monthPath = ensureMonth(ws, monthOf(now))
    const result = await move(ws, node, monthPath.split("/").at(-1).replace(/\.md$/, ""))
    refreshArchives(ws)
    return { ...result, moved: 1, items: [], skipped: [], removed: 0, done: ws.labels.done }
  }
  const donePath = donePathOf(ws)
  const doneDir = donePath.replace(/\.md$/, "")
  const { pages } = walkGraph(ws)
  const moved = []
  const skipped = []
  const changed = new Map()
  const read = new Map()
  for (const page of pages) {
    if (page.path === donePath || page.path.startsWith(doneDir + "/")) continue
    // A held page keeps its finished items until a later run.
    if (heldPath(ws, page.path, held)) continue
    const text = readFileSync(page.path, "utf8")
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    const lines = text.split("\n")
    const blocks = blocksOf(lines, 0, authoredEnd(lines, ws))
    const take = []
    for (const block of blocks) {
      if (!CLOSED.test(block.text) || (canceled && !CANCELED.test(block.text))) continue
      // An item under a finished one moves with it, but only with an item this run moves.
      const moves = canceled ? CANCELED : CLOSED
      let up = block.parent
      while (up && !moves.test(up.text)) up = up.parent
      if (up) continue
      if (descendants(block).some((child) => OPEN.test(child.text))) { skipped.push({ page: page.name, text: block.text }); continue }
      take.push(block)
    }
    if (!take.length) continue
    read.set(page.path, text)
    for (const block of take) {
      const body = lines.slice(block.start, block.end).map((ln) => ln.startsWith(block.prefix) ? ln.slice(block.prefix.length) : ln)
      const [marker, ...rest] = block.text.split(" ")
      const tail = rest.join(" ")
      body[0] = tail.startsWith(`${page.name} · `) ? `- ${block.text}` : `- ${marker} ${page.name} · ${tail}`.trimEnd()
      // The finished lines that moved: the item and those nested under it, read from the text that moved.
      const finished = [block, ...descendants(block)].filter((one) => CLOSED.test(one.text)).map((one) => one.text.trim())
      moved.push({ lines: body, month: monthOf(now), page: page.name, finished })
    }
    const drop = new Set(take.flatMap((block) => Array.from({ length: block.end - block.start }, (_, k) => block.start + k)))
    changed.set(page.path, lines.filter((_, i) => !drop.has(i)).join("\n"))
  }
  if (canceled && !moved.length) return { moved: 0, items: [], skipped, removed: 0, done: ws.labels.done }
  const doneExisted = existsSync(donePath)
  const doneText = doneExisted ? readFileSync(donePath, "utf8") : `# ${ws.labels.done}\n${ws.labels.doneSummary}\n`
  const lines = doneText.split("\n")
  const end = authoredEnd(lines, ws)
  const existing = blocksOf(lines, 0, end).filter((block) => !block.parent && CLOSED.test(block.text))
  const h = await history(ws, now)
  const rel = donePath.slice(ws.graphDir.length + 1)
  const times = await h.times(rel, doneText)
  h.save()
  const entries = [...moved, ...existing.map((block) => ({ lines: lines.slice(block.start, block.end), dated: true, month: monthOf(new Date(times[block.start] ?? now.getTime())) }))]
  const overflow = entries.slice(ws.doneKeep)
  // Unknown history dates items by today; unreadable history must not file them in the wrong month.
  if (h.failed && overflow.some((entry) => entry.dated)) throw new Error(ws.labels.messages["history-failed"])
  const drop = new Set(existing.flatMap((block) => Array.from({ length: block.end - block.start }, (_, k) => block.start + k)))
  const remaining = lines.filter((_, i) => !drop.has(i))
  const at = existing[0]?.start ?? end
  const before = remaining.slice(0, at).join("\n").trimEnd()
  const after = remaining.slice(at).join("\n").trim()
  const recent = entries.slice(0, ws.doneKeep).flatMap((entry) => entry.lines).join("\n")
  const next = [before, recent, after].filter(Boolean).join("\n\n") + "\n"
  if (moved.length || overflow.length) {
    // Reading the history takes a while, and an outliner or a synced phone may write meanwhile; the lock
    // does not stop them. A page that changed since it was read is left alone, and nothing moves.
    const now = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)
    if ([...read].some(([path, text]) => now(path) !== text) || now(donePath) !== (doneExisted ? doneText : null))
      throw new Error(ws.labels.messages["archive-changed"])
    const months = new Map()
    for (const entry of overflow) { if (!months.has(entry.month)) months.set(entry.month, []); months.get(entry.month).push(...entry.lines) }
    for (const [month, content] of months) {
      const path = ensureMonth(ws, month)
      const text = readFileSync(path, "utf8")
      const authored = authoredText(text, ws.labels.region).trimEnd()
      const generated = text.slice(authoredText(text, ws.labels.region).length).trim()
      // Items continue a list that ends the page, or start right below a heading; a blank line there shows as a gap in the outliner.
      const tight = /^(?:\s*- |\s+\S|#)/.test(authored.split("\n").at(-1))
      writeAtomic(path, [tight ? `${authored}\n${content.join("\n")}` : [authored, content.join("\n")].filter(Boolean).join("\n\n"), generated].filter(Boolean).join("\n\n") + "\n")
    }
    for (const [path, text] of changed) writeAtomic(path, text)
    writeAtomic(donePath, next)
    refreshArchives(ws)
  }
  // `items` names each finished line that moved (an item and the finished lines under it), by page, for a
  // caller that acts on exactly those.
  return { moved: moved.length, items: moved.flatMap(({ page, finished }) => finished.map((text) => ({ page, text }))), skipped, removed: overflow.length, done: ws.labels.done }
}
