// The documentation outline: README.md and README.ko.md are the short start documents, and docs/ holds the
// reference pages as pairs (docs/<name>.md in English, docs/<name>.ko.md in Korean). This module reads
// the pairs and checks their headings and links; release-check.mjs and test/docs.test.mjs use it.
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const DOCS_DIR = "docs"

/** The lines of a Markdown text that are not inside a code fence, with their line numbers (1-based). */
export function proseLines(text) {
  const result = []
  let fence = false
  text.split("\n").forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) { fence = !fence; return }
    if (!fence) result.push({ line, number: index + 1 })
  })
  return result
}

/** The headings of levels 1 to `max` (3 unless given) outside code fences: `{ level, text, number }`. */
export function headings(text, max = 3) {
  return proseLines(text).flatMap(({ line, number }) => {
    const match = /^(#{1,6}) +(.+?) *#*$/.exec(line)
    return match && match[1].length <= max ? [{ level: match[1].length, text: match[2], number }] : []
  })
}

/** The anchor GitHub gives a heading: lower case, punctuation removed, spaces as hyphens. */
export function slug(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*~]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-")
}

/** Every anchor of a Markdown text: a repeated heading gets -1, -2 as on GitHub. */
export function anchors(text) {
  const seen = new Map()
  return new Set(headings(text, 6).map(({ text: heading }) => {
    const base = slug(heading)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count ? `${base}-${count}` : base
  }))
}

/** The pairs of documents: README.md with README.ko.md, and each docs/<name>.md with docs/<name>.ko.md. */
export function docPairs(root) {
  const pairs = [{ en: "README.md", ko: "README.ko.md" }]
  const dir = join(root, DOCS_DIR)
  if (!existsSync(dir)) return pairs
  const names = readdirSync(dir).filter((file) => file.endsWith(".md"))
  const stems = [...new Set(names.map((file) => file.replace(/(?:\.ko)?\.md$/, "")))].sort()
  for (const stem of stems) pairs.push({ en: `${DOCS_DIR}/${stem}.md`, ko: `${DOCS_DIR}/${stem}.ko.md` })
  return pairs
}

/** The links of a file that point at a local file or heading and do not resolve, with the reason. */
export function brokenLinks(root, file) {
  const base = dirname(join(root, file))
  const cache = new Map()
  const anchorsOf = (path) => {
    if (!cache.has(path)) cache.set(path, anchors(readFileSync(path, "utf8")))
    return cache.get(path)
  }
  const broken = []
  for (const { line, number } of proseLines(readFileSync(join(root, file), "utf8"))) {
    const text = line.replace(/`[^`]*`/g, "")
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^(?:[a-z][a-z0-9+.-]*:|<)/i.test(target)) continue
      const [path, fragment] = target.split("#")
      const full = path ? resolve(base, decodeURIComponent(path)) : join(root, file)
      if (!existsSync(full)) { broken.push({ file, number, target, reason: "no such file" }); continue }
      if (fragment !== undefined && full.endsWith(".md") && !anchorsOf(full).has(decodeURIComponent(fragment).toLowerCase())) {
        broken.push({ file, number, target, reason: "no such heading" })
      }
    }
  }
  return broken
}
