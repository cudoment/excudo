// The changes a page of the website sends back to the memo, in one shape for every place that handles
// them: the page runtime builds them, the website's inbox function checks them and keeps each batch
// as an issue, and `excudo receive` checks them again and brings them into the memo. A page may also
// ask for the waiting changes to be brought in now, as an issue of its own (`SYNC_MARK`). A task change
// names a task by its page, its line and the digest of its text without the state word, with the state
// the page showed (`from`) and the one chosen (`to`); it carries no text of the task. A save of the
// dashboard's board (board.mjs) carries the board's whole new body, with the digest of the body it was
// edited from, so an issue holding one holds those words. The publishing step copies this file beside
// the inbox function, so it imports nothing.

export const FORMAT = "excudo-changes"
export const VERSION = 1
/** The states a page offers, CANCELED for a task the owner decided not to do; a task may be in any outliner state before. */
export const STATES = ["TODO", "DOING", "WAITING", "DONE", "CANCELED"]
export const LIMITS = { entries: 100, bytes: 64 * 1024, page: 300, line: 1000000, board: 20000 }
/** Where a batch starts in an issue's body, so the reader finds it among anything else written there. */
export const MARK = "<!-- excudo-changes -->"

const ID = /^[A-Za-z0-9_-]{8,40}$/
const HASH = /^[0-9a-f]{10}$/
const BOARD_HASH = /^[0-9a-f]{8}$/
const WORD = /^[A-Z][A-Z-]{1,15}$/
const SITE = /^[A-Za-z0-9_-]{1,64}$/

const fail = (reason) => { const error = new Error(`excudo-changes: ${reason}`); error.reason = reason; throw error }

/** A page's path inside the memo: relative, Markdown, without a step out of it. */
const safePage = (page) => typeof page === "string" && page.length > 0 && page.length <= LIMITS.page && page.endsWith(".md")
  && !page.startsWith("/") && !/[\\\0]/.test(page) && !page.split("/").some((part) => part === "" || part === "." || part === "..")

/**
 * A batch of changes, checked: `{ format, version, site, entries }`, each entry a task change `{ id,
 * kind: "task", page, line, hash, from, to, at }` or a board's save `{ id, kind: "board", page, base,
 * text, at }`. Throws with the first thing wrong; returns a copy holding only the known fields.
 */
export function checkChanges(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("not an object")
  if (doc.format !== FORMAT) fail("format")
  if (doc.version !== VERSION) fail("version")
  if (typeof doc.site !== "string" || !SITE.test(doc.site)) fail("site")
  if (!Array.isArray(doc.entries) || !doc.entries.length) fail("entries")
  if (doc.entries.length > LIMITS.entries) fail(`more than ${LIMITS.entries} entries`)
  const seen = new Set()
  const entries = doc.entries.map((entry, i) => {
    const at = `entries[${i}]`
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(at)
    if (typeof entry.id !== "string" || !ID.test(entry.id)) fail(`${at}.id`)
    if (seen.has(entry.id)) fail(`${at}.id repeated`)
    seen.add(entry.id)
    if (entry.kind !== "task" && entry.kind !== "board") fail(`${at}.kind`)
    if (entry.at !== undefined && (typeof entry.at !== "string" || entry.at.length > 40 || Number.isNaN(Date.parse(entry.at)))) fail(`${at}.at`)
    if (!safePage(entry.page)) fail(`${at}.page`)
    if (entry.kind === "board") {
      if (typeof entry.base !== "string" || !BOARD_HASH.test(entry.base)) fail(`${at}.base`)
      // The words as written, possibly none, without a control character other than a line break or a tab.
      if (typeof entry.text !== "string" || entry.text.length > LIMITS.board || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(entry.text)) fail(`${at}.text`)
      return { id: entry.id, kind: "board", page: entry.page.normalize("NFC"), base: entry.base, text: entry.text.normalize("NFC"), ...(entry.at ? { at: entry.at } : {}) }
    }
    if (!Number.isInteger(entry.line) || entry.line < 1 || entry.line > LIMITS.line) fail(`${at}.line`)
    if (typeof entry.hash !== "string" || !HASH.test(entry.hash)) fail(`${at}.hash`)
    if (typeof entry.from !== "string" || !WORD.test(entry.from)) fail(`${at}.from`)
    if (!STATES.includes(entry.to)) fail(`${at}.to`)
    return { id: entry.id, kind: "task", page: entry.page.normalize("NFC"), line: entry.line, hash: entry.hash, from: entry.from, to: entry.to, ...(entry.at ? { at: entry.at } : {}) }
  })
  return { format: FORMAT, version: VERSION, site: doc.site, entries }
}

/** Where a request to bring the waiting changes in now starts in an issue's body. */
export const SYNC_MARK = "<!-- excudo-sync -->"
export const SYNC_FORMAT = "excudo-sync"
/** A request's title and body: the website it comes from and when, nothing else. */
export const syncTitle = () => `${SYNC_FORMAT}: bring the changes in now`
export const syncBody = (site, at) => `${SYNC_MARK}\n\n\`\`\`json\n${JSON.stringify({ format: SYNC_FORMAT, version: VERSION, site, at }, null, 2)}\n\`\`\`\n`
/** Whether an issue's body is a request to bring the changes in now; with `site`, one from that website. */
export function isSyncIssue(body, site) {
  // A request starts with its mark; the mark inside a note's words does not make a batch a request.
  const text = String(body ?? "").trimStart()
  if (!text.startsWith(SYNC_MARK)) return false
  const at = 0
  if (site === undefined) return true
  const block = text.slice(at + SYNC_MARK.length).match(/```json\s*\n([\s\S]*?)\n```/)
  try { return JSON.parse(block[1]).site === site } catch { return false }
}

/** An issue's title: how many changes, and nothing of what they touch. */
export const issueTitle = (doc) => `${FORMAT}: ${doc.entries.length} change${doc.entries.length === 1 ? "" : "s"}`

/** An issue's body: the mark, then the batch as JSON in a fenced block. */
export const issueBody = (doc) => `${MARK}\n\n\`\`\`json\n${JSON.stringify(doc, null, 2)}\n\`\`\`\n`

/** The batch an issue's body carries, checked, or null when it carries none. Throws when it carries a broken one. */
export function changesFromIssue(body) {
  const text = String(body ?? "")
  const at = text.indexOf(MARK)
  if (at < 0) return null
  const block = text.slice(at + MARK.length).match(/```json\s*\n([\s\S]*?)\n```/)
  if (!block) fail("no JSON block after the mark")
  let doc
  try { doc = JSON.parse(block[1]) } catch { fail("JSON") }
  return checkChanges(doc)
}
