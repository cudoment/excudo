// Usage: imported by ../where.mjs and ../check.mjs (not run by itself).
// How a line of a followed note is found in the memo, the same way for the search and the check:
// both are reduced to their letters and digits, and a memo line holds a note line when it holds most
// of its pairs of neighbouring characters. That survives what merging does to a thought (particles,
// spacing, a bullet, a link added) and does not depend on a language's word endings.

/** A line's letters and digits, without bullets, links, task markers or case. */
export function plain(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*(?:[-*]\s+)?(?:todo|doing|waiting|done|later|now|canceled|cancelled)\b/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

const pairs = (text) => {
  const found = new Set()
  for (let i = 0; i + 1 < text.length; i++) found.add(text.slice(i, i + 2))
  return found
}

/** How much of `line` the memo line `other` holds, from 0 to 1. A line of links alone is held by a line with the same links. */
export function coverage(line, other) {
  const a = plain(line)
  const b = plain(other)
  if (!a) {
    const links = String(line ?? "").match(/https?:\/\/[^\s<>()[\]]+/g) ?? []
    return links.length && links.every((link) => String(other ?? "").includes(link)) ? 1 : 0
  }
  if (a.length < 3) return b.includes(a) ? 1 : 0
  const mine = pairs(a)
  const theirs = pairs(b)
  let shared = 0
  for (const pair of mine) if (theirs.has(pair)) shared++
  return shared / mine.size
}

/** A memo line holds a note line from here on. */
export const HOLDS = 0.6

/**
 * The memo's own lines, with the node each sits in: every page's authored text, without the generated
 * `## <region>` part of a node and without pages the engine writes (a first line `<generated>::`).
 */
export function memoLines(files, labels) {
  const region = new RegExp(`^##\\s+${labels.region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`)
  return files.flatMap(({ file, text }) => {
    const lines = text.split("\n")
    if (lines[0]?.startsWith(`${labels.generated}::`)) return []
    const node = lines[0]?.match(/^#\s+(.+)$/)?.[1]?.trim() ?? file.replace(/^.*\//, "").replace(/\.md$/, "")
    const end = lines.findIndex((line) => region.test(line))
    return lines.slice(0, end < 0 ? lines.length : end).flatMap((text, index) => (text.trim() ? [{ file, line: index + 1, node, text }] : []))
  })
}

/**
 * The memo lines that hold most of `line`, best first. Between lines that hold it equally, the one
 * that is mostly this line comes first: a node's title before a long line that mentions it.
 */
export function placesOf(line, memo, { limit = 3, least = HOLDS } = {}) {
  return memo.map((place) => ({ ...place, score: coverage(line, place.text) })).filter((place) => place.score >= least)
    .map((place) => ({ ...place, focus: coverage(place.text, line) }))
    .sort((a, b) => b.score - a.score || b.focus - a.focus).slice(0, limit).map(({ focus, ...place }) => place)
}

/**
 * Whether the memo holds a block: its heading alone when it has no lines, otherwise at least half of
 * its lines. A merged thought may be reworded, but most of what the owner wrote is in the memo.
 */
export function holds(block, memo) {
  const lines = block.lines.length ? block.lines : [block.heading]
  const found = lines.filter((line) => placesOf(line, memo, { limit: 1 }).length).length
  return found * 2 >= lines.length
}

const OPEN = /^\s*- (?:TODO|DOING|WAITING|LATER|NOW)\s/
/**
 * Open task lines that still hold a line the owner removed from the note. A task that also holds a
 * line the note still has is backed by it and stays: a removed area name such as a heading shares its
 * word with tasks that live on. Lines of the note shorter than six letters back nothing, since a
 * short word appears everywhere.
 */
export function stillOpen(line, memo, current = [], least = 0.8) {
  const backing = current.filter((kept) => plain(kept).length >= 6)
  return memo.filter((place) => OPEN.test(place.text) && coverage(line, place.text) >= least
    && !backing.some((kept) => coverage(kept, place.text) >= least))
}
