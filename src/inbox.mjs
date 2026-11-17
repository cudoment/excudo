// Journals are the inbox: what you jot down on the phone waits there until the
// next tidy-up moves it into a node. So does a page you create in the outliner by
// following a new link; it lands in `pages/` until it is placed on the tree.
import { readFileSync } from "node:fs"
import { walkGraph } from "./check.mjs"
import { INTAKE } from "./tree.mjs"

import { CLOSED, blocksOf } from "./dialects/logseq.mjs"
const REF_ONLY = /^(\(\([0-9a-f-]{36}\)\)|\{\{embed .*\}\})$/i

/** Top-level journal items that still need a home, oldest journal first, then the pages waiting in `pages/`. */
export function inbox(ws, { graph = walkGraph(ws) } = {}) {
  const items = []
  const journals = graph.pages.filter((page) => page.journal).sort((a, b) => a.name.localeCompare(b.name))
  for (const page of journals) {
    const lines = readFileSync(page.path, "utf8").split("\n")
    blocksOf(lines, 0, lines.length).filter((block) => !block.parent).forEach((block) => {
      const text = block.text.trim()
      if (!text || CLOSED.test(text) || REF_ONLY.test(text)) return
      const children = block.children.map((child) => child.text.trim())
      items.push({ kind: "journal", page: page.name, line: block.start + 1, text, children })
    })
  }
  for (const page of graph.pages.filter((page) => page.rel.startsWith(`${INTAKE}/`))) {
    const lines = readFileSync(page.path, "utf8").split("\n")
    const line = lines.findIndex((text) => text.trim())
    items.push({ kind: "page", page: page.name, path: page.rel, line: line + 1 || 1, text: line < 0 ? "" : lines[line].trim(), children: [] })
  }
  return items
}
