import { readFileSync, realpathSync } from "node:fs"
import { relative, resolve } from "node:path"
import { walkGraph } from "./check.mjs"
import { authoredText } from "./dialects/logseq.mjs"
import { format } from "./labels.mjs"
import { gitOutput } from "./history.mjs"

export function find(ws, term, { history: includeHistory = false } = {}) {
  if (!term) throw new Error(format(ws.labels.messages["needs-args"], { command: "find", args: "<words>" }))
  const want = term.normalize("NFC").toLowerCase()
  const matches = []
  for (const page of walkGraph(ws).pages) {
    const text = readFileSync(page.path, "utf8")
    if (text.startsWith(`${ws.labels.generated}::`)) continue
    const lines = authoredText(text, ws.labels.region).split("\n")
    if (page.name.toLowerCase().includes(want)) matches.push({ node: page.name, path: page.rel, line: 1, text: lines[0], field: "name" })
    lines.forEach((text, i) => {
      if (text.normalize("NFC").toLowerCase().includes(want) && !(i === 0 && page.name.toLowerCase().includes(want)))
        matches.push({ node: page.name, path: page.rel, line: i + 1, text, field: "text" })
    })
  }
  const past = []
  const repo = includeHistory ? gitOutput(ws.root, ["rev-parse", "--show-toplevel"])?.trim() : undefined
  if (repo) {
    const graphPath = relative(repo, resolve(realpathSync(ws.graphDir))).split("\\").join("/") || "."
    // Commits are selected with rename detection, so a move that keeps the words is not a removal.
    // Their whole patches then come from one log over those commits, instead of a `git show` per commit.
    const commits = gitOutput(repo, ["log", "--format=%H", "--regexp-ignore-case", `-S${term}`, "--", graphPath]) ?? ""
    const log = commits.trim() ? gitOutput(repo, ["-c", "core.quotePath=false", "log", "--no-walk=unsorted", "--stdin", "--format=%x00%H %cI",
      "--no-renames", "--unified=0", "-p", "--", graphPath], commits, 256 * 1024 * 1024) ?? "" : ""
    for (const entry of log.split("\0").slice(1)) {
      const [header, ...patch] = entry.split("\n")
      const [commit, date] = header.split(" ")
      let path, line = 0
      for (const text of patch) {
        if (text.startsWith("--- a/")) path = text.slice(6).normalize("NFC")
        const hunk = text.match(/^@@ -(\d+)/)
        if (hunk) line = Number(hunk[1])
        if (text.startsWith("-") && !text.startsWith("---")) {
          const removed = text.slice(1)
          if (removed.normalize("NFC").toLowerCase().includes(want)) past.push({ commit, date, path, line, text: removed })
          line++
        }
      }
    }
  }
  return { matches, history: past }
}
