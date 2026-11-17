// Brings into the memo the changes made on its website (`excudo receive`): a task's state chosen on a
// page, or a save of the dashboard's board, kept as an issue in the owner's inbox until this machine
// takes it. A board's save replaces the board node's body, merged line by line with what changed in
// the node since the body it was edited from (board.mjs). Only this machine writes
// the memo, so a change is checked against the line as it is now before anything is written: the line
// must still hold the task the page showed (the digest of its text without the state word) in the
// state the page showed. A line that moved keeps its change when its text is found once elsewhere in
// the page. Anything else is not guessed: the change is noted on today's journal as a waiting task
// for the owner to settle. Every change is recorded by its id (`.excudo/received.json`), so a batch
// read twice changes nothing twice, and the website names the recorded ids so a page stops showing
// them as waiting.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import { boardHash, boardParts, boardText, contains, mergeLines, withBody } from "./board.mjs"
import { MARKER } from "./dialects/logseq.mjs"
import { taskHash } from "./dialects/html.mjs"
import { changesFromIssue, checkChanges } from "./edits.mjs"
import { existingPath, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { heldFiles, heldPath } from "./git.mjs"
import { gitOutput } from "./history.mjs"
import { appendToJournal, journalName } from "./sources.mjs"

const LEDGER = "received.json"
const BULLET = /^(\s*)- (.*)$/
/** How long the ledger remembers a change, and so how long a page may still name it as waiting. */
const KEEP_DAYS = 90

const ledgerPath = (ws) => join(ws.cacheDir, LEDGER)
/** The changes received so far: `{ [id]: { status, at, source, file } }`, `file` being the one it wrote. */
export function receivedOf(ws) {
  try {
    const kept = JSON.parse(readFileSync(ledgerPath(ws), "utf8"))
    return kept && typeof kept.received === "object" ? kept.received : {}
  } catch { return {} }
}
/** The ids received in the last `days` days, which a page clears from its waiting list. */
export const appliedIds = (ws, { days = 30, now = new Date() } = {}) => Object.entries(receivedOf(ws))
  .filter(([, item]) => now - Date.parse(item.at) <= days * 86400000).map(([id]) => id).sort()

/**
 * What a list of inputs holds: a batch, a list of batches, or issues as `gh issue list --json
 * number,body` prints them. Returns `[{ source, doc }]`, and `{ source, error }` for an issue whose
 * batch is broken; an issue that carries none is left out. Issues come oldest first, by number,
 * whatever order they were listed in (gh lists the newest first): a later change of a task starts
 * from the state an earlier one left.
 */
export function batchesOf(input) {
  const given = Array.isArray(input) ? input : [input]
  const number = (item) => (item && typeof item === "object" && Number.isFinite(item.number) ? item.number : Infinity)
  const list = given.map((item, i) => ({ item, i })).sort((a, b) => number(a.item) - number(b.item) || a.i - b.i).map(({ item }) => item)
  return list.flatMap((item, i) => {
    if (item && typeof item === "object" && "body" in item) {
      const source = item.number === undefined ? `issue ${i + 1}` : `#${item.number}`
      try {
        const doc = changesFromIssue(item.body)
        return doc ? [{ source, issue: item.number, doc }] : []
      } catch (error) { return [{ source, issue: item.number, error: error.message }] }
    }
    try { return [{ source: `batch ${i + 1}`, doc: checkChanges(item) }] } catch (error) { return [{ source: `batch ${i + 1}`, error: error.message }] }
  })
}

/** The line that holds the task a change names: where it was, or the one line in the page with its text. */
function locate(lines, entry) {
  const fits = (line) => {
    const bullet = line?.match(BULLET)
    return Boolean(bullet && MARKER.test(bullet[2]) && taskHash(bullet[2]) === entry.hash)
  }
  if (fits(lines[entry.line - 1])) return { index: entry.line - 1 }
  const found = lines.map((line, i) => (fits(line) ? i : -1)).filter((i) => i >= 0)
  if (found.length === 1) return { index: found[0], moved: true }
  return { reason: found.length ? "several" : "changed" }
}

/**
 * The body a board's save was edited from, by its digest: a body this run wrote or was sent, a save
 * the ledger keeps, or one the node had in one of its last commits. Undefined when none matches.
 */
function baseBody(ws, page, hash, written, received) {
  if (written.has(hash)) return written.get(hash)
  for (const item of Object.values(received)) if (item.page === page && typeof item.text === "string" && boardHash(item.text) === hash) return item.text
  const commits = gitOutput(ws.graphDir, ["log", "--format=%H", "-n", "100", "--", page])
  for (const commit of commits?.split("\n").filter(Boolean) ?? []) {
    const text = gitOutput(ws.graphDir, ["show", `${commit}:./${page}`])
    if (text == null) continue
    const body = boardParts(text, ws.labels.region).body
    if (boardHash(body) === hash) return body
  }
  return undefined
}

const clock = (time) => { const d = new Date(time); const two = (n) => String(n).padStart(2, "0"); return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}` }

/**
 * Brings the batches into the memo. Returns `{ results: [{ source, id, page, line, to, status,
 * reason, file }], batches: [{ source, issue, done, error }], writes, touched }`; `status` is
 * `applied`, `already` or `uncertain`. A batch is `done` once each of its changes has a status, so its
 * issue may be closed. `writes` lists the files it writes, from the graph folder, and `touched` the
 * ones it wrote: with `dryRun` nothing is written, so a caller can first commit the owner's own edits
 * there. A result's `file` is the file its change wrote (the page, or the journal that notes it), also
 * when the change was received before, so a caller that failed to commit it can find it again; such a
 * result also says what became of the change then (`was`), so it is closed the same way again.
 */
export function receive(ws, batches, { dryRun = false, now = new Date() } = {}) {
  const m = ws.labels.messages
  const received = receivedOf(ws)
  const files = new Map()
  const fileOf = (page) => {
    const path = existingPath(join(ws.graphDir, ...page.split("/")))
    if (!files.has(path)) files.set(path, { path, page, lines: existsSync(path) ? readFileSync(path, "utf8").split("\n") : null, changed: false })
    return files.get(path)
  }
  const results = []
  const waiting = []
  const holding = heldFiles(ws)
  const summary = []
  let journalFile
  const journalOf = () => (journalFile ??= existingPath(join(ws.graphDir, "journals", `${journalName(ws, now)}.md`)))
  const journalRel = () => `journals/${basename(journalOf())}`
  for (const batch of batches) {
    if (batch.error) { summary.push({ source: batch.source, issue: batch.issue, done: false, error: batch.error }); continue }
    let held = false
    for (const entry of batch.doc.entries) {
      const result = { source: batch.source, id: entry.id, page: entry.page, line: entry.line, to: entry.to }
      results.push(result)
      // A page someone else is changing (held by a scheduled run) takes the change at a later pull: it is
      // not recorded as received, and its batch stays open.
      if (!received[entry.id] && heldPath(ws, join(ws.graphDir, ...entry.page.split("/")), holding)) {
        Object.assign(result, { status: "held", reason: "held" })
        held = true
        continue
      }
      if (received[entry.id]) {
        const before = received[entry.id]
        Object.assign(result, { status: "already", reason: "received", was: before.status, ...(before.file ? { file: before.file } : {}) })
        continue
      }
      const file = fileOf(entry.page)
      const settle = (status, reason, extra = {}) => {
        const wrote = status === "applied" ? entry.page : status === "uncertain" ? journalRel() : undefined
        Object.assign(result, { status, reason }, extra, wrote ? { file: wrote } : {})
        received[entry.id] = { status, at: now.toISOString(), source: batch.source, ...(wrote ? { file: wrote } : {}) }
        if (status === "uncertain") waiting.push(result)
      }
      if (!file.lines) { settle("uncertain", "missing"); continue }
      if (entry.kind === "board") {
        const parts = boardParts(file.lines.join("\n"), ws.labels.region)
        const mine = boardText(entry.text)
        if (boardHash(parts.body) === boardHash(mine)) { settle("already", "board"); continue }
        let body = mine, reason = "board"
        const written = (file.boards ??= new Map())
        if (boardHash(parts.body) !== entry.base) {
          // Changed meanwhile: merged with the body it was edited from.
          const base = baseBody(ws, entry.page, entry.base, written, received)
          const lines = (text) => (text ? text.split("\n") : [])
          let merged
          if (base !== undefined) merged = mergeLines(lines(base), lines(mine), lines(parts.body))
          // Without it, a save that only adds lines to the node is taken; any other keeps the node and
          // puts the whole save under the marked item, since what it removed cannot be told apart.
          else if (contains(lines(mine), lines(parts.body))) merged = { lines: lines(mine), conflicts: [] }
          else merged = { lines: lines(parts.body), conflicts: lines(mine).length ? lines(mine) : [`- ${m["receive-board-emptied"]}`] }
          body = merged.lines.join("\n")
          reason = "merged"
          if (merged.conflicts.length) {
            body = [body, `- ${format(m["receive-board-overlap"], { at: clock(entry.at ?? now) })}`, ...merged.conflicts.map((line) => `\t${line}`)].filter(Boolean).join("\n")
            reason = "overlap"
          }
        }
        // Both the save as sent and the body written can be what a later save started from.
        written.set(boardHash(mine), mine)
        written.set(boardHash(body), body)
        file.lines = withBody(parts, body).split("\n")
        file.changed = true
        settle("applied", reason)
        // The save as sent, kept on this machine so a save started from it in a later run finds it.
        Object.assign(received[entry.id], { page: entry.page, text: mine })
        continue
      }
      const at = locate(file.lines, entry)
      if (at.index === undefined) { settle("uncertain", at.reason); continue }
      const [, indent, text] = file.lines[at.index].match(BULLET)
      const state = text.match(MARKER)[0]
      // The website writes the outliner's other spelling, CANCELLED, as CANCELED; both are the same state.
      const same = (word) => state.replace(/^CANCELLED$/, "CANCELED") === word
      if (same(entry.to)) { settle("already", "state", { line: at.index + 1 }); continue }
      if (!same(entry.from)) { settle("uncertain", "state", { now: state, line: at.index + 1 }); continue }
      file.lines[at.index] = `${indent}- ${entry.to}${text.slice(state.length)}`
      file.changed = true
      settle("applied", at.moved ? "moved" : "line", { line: at.index + 1 })
    }
    summary.push({ source: batch.source, issue: batch.issue, done: !held, ...(held ? { held: true } : {}) })
  }
  const changed = [...files.values()].filter((file) => file.changed)
  let journal = waiting.length ? journalOf() : null
  // The journal that would note the uncertain changes is being changed elsewhere (held by a scheduled
  // run): those changes are not taken now, and their batches stay open for a later pull.
  if (journal && heldPath(ws, journal, holding)) {
    for (const item of waiting) {
      delete received[item.id]
      delete item.file
      Object.assign(item, { status: "held", reason: "held" })
    }
    for (const one of summary) if (waiting.some((item) => item.source === one.source)) Object.assign(one, { done: false, held: true })
    waiting.length = 0
    journal = null
  }
  const writes = [...changed.map((file) => file.page), ...(journal ? [journalRel()] : [])]
  if (!dryRun) {
    for (const file of changed) writeAtomic(file.path, file.lines.join("\n"))
    if (journal) {
      appendToJournal(journal, waiting.map((item) => `- WAITING ${format(m["receive-uncertain-line"], {
        page: `[[${basename(item.page, ".md")}]]`, line: item.line, to: item.to, reason: format(m[`receive-reason-${item.reason}`], { state: item.now ?? "" }) })}`))
    }
    const cutoff = now - KEEP_DAYS * 86400000
    const kept = Object.fromEntries(Object.entries(received).filter(([, item]) => Date.parse(item.at) >= cutoff))
    mkdirSync(ws.cacheDir, { recursive: true })
    writeAtomic(ledgerPath(ws), `${JSON.stringify({ version: 1, received: kept }, null, 2)}\n`)
  }
  return { results, batches: summary, writes, touched: dryRun ? [] : writes }
}
