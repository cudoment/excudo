// The dashboard's notepad is a board: a node of the memo whose body the website shows and the owner
// edits in place, then saves. The body is the node's own text below its title and summary, above the
// generated subpages section. A save sends the whole new body with the digest of the body it was edited
// from; the memo takes it as it is when the node still holds that body, and otherwise merges line by
// line with what changed meanwhile (in Tine, or a save from another device). Lines both sides changed
// differently keep the node's version, and the website's lines go to the end of the board under a
// marked item, for the owner to settle. The page runtime keeps a copy of `boardHash` and `boardText`
// (assets/memo-runtime.js); a test holds the two to the same results.
import { regionStart } from "./dialects/logseq.mjs"

/** A short digest of a body (FNV-1a over its UTF-16 code units), the same in the engine and the page. */
export function boardHash(text) {
  const value = String(text).normalize("NFC")
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/**
 * A body as the memo keeps it: no blank lines, no trailing spaces, and every line a list item, the
 * continuation lines of an item (two spaces after its tabs) kept as they are. Applying it twice
 * changes nothing.
 */
export function boardText(text) {
  return String(text).normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim()).map((line) => {
      const [, indent, rest] = line.match(/^(\s*)(.*)$/)
      if (/^\t* {2}\S/.test(line) && !rest.startsWith("- ")) return line
      const tabs = indent.replace(/ {2}/g, "\t").replace(/ /g, "")
      return rest === "-" || rest.startsWith("- ") ? `${tabs}${rest}` : `${tabs}- ${rest}`
    }).join("\n")
}

/** A node's text cut into its head (title and summary), its body, and the generated section after it. */
export function boardParts(text, region) {
  const lines = String(text).replace(/\s+$/, "").split("\n")
  const head = lines[0]?.startsWith("# ") && lines[1]?.trim() && !/^\s*-\s/.test(lines[1]) ? 2 : lines[0]?.startsWith("# ") ? 1 : 0
  const at = regionStart(lines.join("\n"), region)
  const end = at < 0 ? lines.length : at
  return {
    head: lines.slice(0, head),
    body: lines.slice(head, Math.max(end, head)).join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, ""),
    tail: at < 0 ? "" : lines.slice(at).join("\n"),
  }
}

/** The node's text with `body` in place of its body. */
export function withBody(parts, body) {
  const blocks = [parts.head.join("\n"), body, parts.tail].filter((block) => block.trim())
  return `${blocks.join("\n\n")}\n`
}

/** The pairs of equal lines of `a` and `b` in a longest common subsequence, in order. */
function common(a, b) {
  const rows = a.length + 1, cols = b.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
  const pairs = []
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++
    else j++
  }
  return pairs
}

const same = (a, b) => a.length === b.length && a.every((line, i) => line === b[i])

/** Whether every line of `a` appears in `b` in the same order (b only adds lines to a). */
export const contains = (b, a) => common(a, b).length === a.length

/** One side's edits of `base` as hunks: the base lines `start`..`end` replaced by `lines` (an insertion when start is end). */
function hunks(base, side, name) {
  const out = []
  let b = 0, s = 0
  for (const [i, j] of [...common(base, side), [base.length, side.length]]) {
    if (i > b || j > s) out.push({ start: b, end: i, lines: side.slice(s, j), side: name })
    b = i + 1; s = j + 1
  }
  return out
}

/** Whether two hunks touch the same base lines, or insert at the same place. */
function meet(a, b) {
  if (a.start === a.end && b.start === b.end) return a.start === b.start
  if (a.start === a.end) return a.start > b.start && a.start < b.end
  if (b.start === b.end) return b.start > a.start && b.start < a.end
  return a.start < b.end && b.start < a.end
}

/** The base lines `start`..`end` with one side's hunks applied. */
function apply(base, start, end, list) {
  const lines = []
  let at = start
  for (const hunk of list) { lines.push(...base.slice(at, hunk.start), ...hunk.lines); at = hunk.end }
  return [...lines, ...base.slice(at, end)]
}

/**
 * Merges two edits of `base`, line by line: `mine` (the website's) and `theirs` (the node as it is).
 * Each side's edits are hunks of base lines replaced, removed or inserted; hunks of the two sides that
 * touch different lines are all applied. Where they meet: the same edit is taken once, lines both
 * inserted at one place are all kept, neighbouring one-line edits are settled line by line, and
 * anything else keeps `theirs`, with `mine`'s lines of it returned in `conflicts`. Returns
 * `{ lines, conflicts }`.
 */
export function mergeLines(base, mine, theirs) {
  const all = [...hunks(base, mine, "mine"), ...hunks(base, theirs, "theirs")]
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start))
  const groups = []
  for (const hunk of all) {
    const group = groups.at(-1)
    if (group && group.hunks.some((other) => meet(other, hunk))) { group.hunks.push(hunk); group.end = Math.max(group.end, hunk.end) }
    else groups.push({ start: hunk.start, end: hunk.end, hunks: [hunk] })
  }
  const lines = [], conflicts = []
  let at = 0
  for (const group of groups) {
    lines.push(...base.slice(at, group.start))
    const was = base.slice(group.start, group.end)
    const ours = group.hunks.filter((hunk) => hunk.side === "mine"), others = group.hunks.filter((hunk) => hunk.side === "theirs")
    const mineText = apply(base, group.start, group.end, ours), theirText = apply(base, group.start, group.end, others)
    if (!others.length || same(mineText, theirText)) lines.push(...mineText)
    else if (!ours.length) lines.push(...theirText)
    // Lines both sides only inserted at one place: both stay, the node's first; a line both inserted is
    // kept as many times as the side that has it most.
    else if (!was.length) {
      const left = new Map()
      for (const line of theirText) left.set(line, (left.get(line) ?? 0) + 1)
      lines.push(...theirText, ...mineText.filter((line) => (left.get(line) ?? 0) > 0 ? (left.set(line, left.get(line) - 1), false) : true))
    }
    else if (was.length === mineText.length && was.length === theirText.length) {
      // Neighbouring lines edited one each, no line added or removed: settled line by line.
      was.forEach((line, i) => {
        if (mineText[i] === line || mineText[i] === theirText[i]) lines.push(theirText[i])
        else if (theirText[i] === line) lines.push(mineText[i])
        else { lines.push(theirText[i]); conflicts.push(mineText[i]) }
      })
    } else { lines.push(...theirText); conflicts.push(...ours.flatMap((hunk) => hunk.lines)) }
    at = group.end
  }
  lines.push(...base.slice(at))
  return { lines, conflicts }
}
