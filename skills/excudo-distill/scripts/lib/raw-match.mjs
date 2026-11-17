// Matches a pasted, unorganized memo (a list copied from another app, `ㄴ` indents, lines without a
// title, addresses) against the memo, the same way every time. raw.mjs prints the result before the
// owner is asked anything; check.mjs uses the same matching to tell which lines an interview added.
import { basename } from "node:path"

export const URLS = /https?:\/\/[^\s)\]>]+/g
/**
 * Whether an answer keeps a pasted line as it is (keep, skip, or the same in Korean). `\b` would not end a Korean
 * word, so the word must end the answer or be followed by a space or a mark.
 */
export const keepsAsIs = (answer) => /^(?:keep|skip|남김|건너뜀|그대로)(?=$|[\s.,;:!?)\]])/i.test(String(answer ?? "").trim())
const OPEN = new Set(["TODO", "DOING", "WAITING", "LATER", "NOW"])
const MARKER = /^(TODO|DOING|WAITING|LATER|NOW|DONE|CANCELED|CANCELLED)\s+/
// What leads a line in a list someone typed by hand: indents, bullets, tree marks, numbers, checkboxes.
const LEAD = /^(?:\s|[-*+•·>]|ㄴ|ㅡ|—|–|\d+[.)](?=\s)|\[[ xX]\](?=\s)|#{1,6}(?=\s))+/u

/** A pasted line without what leads it, and how deep it sits (indent plus tree marks). */
export function plainLine(line) {
  const lead = line.match(LEAD)?.[0] ?? ""
  const indent = (lead.match(/^\s*/)[0].replace(/ {2}/g, "\t").match(/\t/g) ?? []).length
  return { text: line.slice(lead.length).replace(MARKER, "").trim(), depth: indent + (lead.match(/ㄴ/g) ?? []).length }
}

/** Letters and digits only, lowercased, links reduced to their words: what two lines are compared by. */
export const compact = (text) => String(text).normalize("NFC").toLowerCase().replace(URLS, " ")
  .replace(/\[\[([^\]\n]+)\]\]/g, "$1").replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1").replace(/[^\p{L}\p{N}]+/gu, "")
const pairs = (text) => {
  const set = new Set()
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2))
  return set
}
const urlsOf = (text) => [...String(text).matchAll(URLS)].map((match) => match[0].replace(/[.,;]+$/, "").replace(/\/$/, ""))

/**
 * The memo's own lines, read from Markdown files ({ file, text }): every line of a node page up to its
 * generated subpages section, without generated pages (first line `<generated>::`), the title,
 * headings and properties. Each line says its node, file, line number and kind: an open or finished
 * task, or a note; anything in the done node counts as finished.
 */
export function memoLines(files, labels) {
  const lines = []
  for (const { file, text } of files) {
    const rows = text.split("\n")
    if (rows[0]?.startsWith(`${labels.generated}::`)) continue
    const node = basename(file, ".md").normalize("NFC")
    const done = node === labels.done || file.normalize("NFC").split("/").includes(labels.done)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.trim() === `## ${labels.region}`) break
      if (!row.trim() || /^#{1,6}\s/.test(row) || /^\s*[\w\p{L}.-]+::/u.test(row) || /^\s*(?:SCHEDULED|DEADLINE):/.test(row) || /^\s*```/.test(row)) continue
      const body = row.replace(/^\s*(?:- )?/, "")
      const marker = body.match(MARKER)?.[1]
      const text = body.replace(MARKER, "").replace(/\s+(?:SCHEDULED|DEADLINE):\s*<[^>]*>/g, "").trim()
      if (!compact(text)) continue
      lines.push({ file, line: i + 1, node, text, marker: marker ?? null,
        kind: marker ? (OPEN.has(marker) && !done ? "open" : "done") : done ? "done" : "note", key: compact(text), urls: urlsOf(text) })
    }
  }
  return lines
}

/**
 * How close a pasted line is to a memo line: 1 for the same words, about 0.8–1 when one holds the
 * other, up to 0.75 when most letter pairs of the pasted line appear in the memo line, 0 otherwise.
 */
export function closeness(raw, memo) {
  if (!raw || !memo) return 0
  if (raw === memo) return 1
  const [short, long] = raw.length <= memo.length ? [raw, memo] : [memo, raw]
  // One holding the other counts only when the shorter is a fair part of the longer, not one word of a sentence.
  if (short.length >= 4 && short.length >= 0.3 * long.length && long.includes(short)) return 0.8 + 0.2 * (short.length / long.length)
  const mine = pairs(raw)
  if (mine.size < 3) return 0
  const theirs = pairs(memo)
  const share = [...mine].filter((pair) => theirs.has(pair)).length / mine.size
  return share >= 0.7 ? 0.75 * share : 0
}

/** The best memo line for a pasted line: { score, how, match } or null. A shared address is the best. */
export function bestMatch(text, memo) {
  const key = compact(text)
  const links = urlsOf(text)
  let best = null
  const rank = { open: 3, done: 2, note: 1 }
  for (const line of memo) {
    const how = links.some((url) => line.urls.includes(url)) ? "address" : null
    const score = how ? 1 : closeness(key, line.key)
    if (!score) continue
    const better = !best || score > best.score || (score === best.score && rank[line.kind] > rank[best.match.kind])
    if (better) best = { score, how: how ?? (score === 1 ? "same" : score >= 0.8 ? "contains" : "similar"), match: line }
  }
  return best
}

/**
 * Sorts the lines of a pasted memo against the memo: `node` (names a node), `open` (an open task
 * already says it), `done` (a finished or archived line says it), `note` (a note says it), `new`
 * (nothing does). A `similar` match is only likely and is asked about. Blank lines and separators
 * are left out. Each entry keeps its line number, depth, the line it sits under and whether lines
 * sit under it (a group).
 */
export function sortRaw(text, memo, nodes) {
  const names = new Map(nodes.map((name) => [compact(name), name]))
  const entries = []
  const stack = []
  String(text).split("\n").forEach((line, index) => {
    const { text: plain, depth } = plainLine(line)
    if (!compact(plain) && !urlsOf(plain).length) return
    while (stack.length && stack.at(-1).depth >= depth) stack.pop()
    const parent = stack.at(-1) ?? null
    const node = names.get(compact(plain))
    const best = node ? null : bestMatch(plain, memo)
    const entry = { n: index + 1, text: plain, depth, under: parent?.n ?? null, group: false,
      kind: node ? "node" : best ? best.match.kind : "new", how: node ? "name" : best?.how ?? null, score: node ? 1 : best ? Math.round(best.score * 100) / 100 : 0,
      match: node ? { node } : best ? { file: best.match.file, line: best.match.line, node: best.match.node, text: best.match.text, marker: best.match.marker } : null }
    if (parent) parent.group = true
    entries.push(entry)
    stack.push(entry)
  })
  return entries
}
