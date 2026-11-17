// The memo website's inbox, published beside its pages by `excudo site publish` as api/edit.mjs. A
// page sends the task states chosen on it here; each batch, once checked, becomes one issue in the
// owner's private inbox repository, which the owner's machine reads with `excudo receive`. Nothing is
// ever written to a file in that repository, so two batches never meet; an issue is added and later
// closed, as completed when the memo took every change, as not planned when it noted one to settle.
// A page also asks here what the memo has not taken yet, so a state chosen on one device shows on all
// of them. Vercel Authentication guards this function as it guards the pages, and a request must come
// from the website's own pages. The token is the project's environment variable EXCUDO_INBOX_TOKEN,
// which the owner sets on Vercel; nothing here holds it.
import { changesFromIssue, checkChanges, isSyncIssue, issueBody, issueTitle, LIMITS } from "./_edits.mjs"
import { fromOwnPage, github, inbox, issues, ready, reply } from "./_github.mjs"

/**
 * Whether the website takes changes, and with `?view=state` the changes of the last issues: `open`
 * while the memo has not taken them, `applied` once it took them all, `closed` when it noted one to
 * settle. Also when the memo last took any, and an open request to take them now.
 */
export async function GET(request) {
  const url = new URL(request.url)
  if (!ready() || url.searchParams.get("view") !== "state") return reply(200, { inbox: true, ready: ready() })
  if (!fromOwnPage(request)) return reply(403, { error: "origin" })
  let open, closed
  try { [open, closed] = await Promise.all([issues("open", 100), issues("closed", 50)]) } catch (error) { return reply(200, { inbox: true, ready: true, error: error.code === "github-timeout" ? error.code : "github" }) }
  const changes = []
  let appliedAt = null
  let sync = null
  for (const issue of [...open, ...closed]) {
    if (isSyncIssue(issue.body)) { if (issue.state === "open" && isSyncIssue(issue.body, inbox.site)) sync = { issue: issue.number, at: issue.created_at }; continue }
    let doc
    try { doc = changesFromIssue(issue.body) } catch { continue }
    if (!doc || doc.site !== inbox.site) continue
    const state = issue.state === "open" ? "open" : issue.state_reason === "not_planned" ? "closed" : "applied"
    if (issue.state === "closed" && issue.closed_at && (!appliedAt || issue.closed_at > appliedAt)) appliedAt = issue.closed_at
    for (const entry of doc.entries) changes.push({ ...entry, issue: issue.number, state })
  }
  changes.sort((a, b) => a.issue - b.issue)
  return reply(200, { inbox: true, ready: true, changes, appliedAt, sync })
}

/** One batch of changes from a page of this website, kept as an issue. */
export async function POST(request) {
  if (!fromOwnPage(request, { origin: true })) return reply(403, { error: "origin" })
  if (!ready()) return reply(503, { error: "no-token" })
  const text = await request.text()
  if (text.length > LIMITS.bytes) return reply(413, { error: "size" })
  let doc
  try { doc = checkChanges(JSON.parse(text)) } catch (error) { return reply(400, { error: String(error.reason ?? error.message) }) }
  if (doc.site !== inbox.site) return reply(400, { error: "site" })
  let response
  try { response = await github("/issues", { method: "POST", body: { title: issueTitle(doc), body: issueBody(doc) } }) } catch { return reply(502, { error: "github" }) }
  if (response.error) return reply(502, response)
  if (!response.ok) return reply(502, { error: "github", status: response.status })
  const issue = await response.json().catch(() => ({}))
  return reply(201, { ok: true, issue: issue.number ?? null, ids: doc.entries.map((entry) => entry.id) })
}
