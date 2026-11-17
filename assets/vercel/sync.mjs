// A request from a page of the memo website to bring the waiting changes into the memo now, published
// beside the pages as api/sync.mjs. It leaves one issue in the inbox repository, or names the one
// already open; the owner's machine looks for it often and brings the changes in at once instead of
// at its usual interval, then closes it.
import { isSyncIssue, syncBody, syncTitle } from "./_edits.mjs"
import { fromOwnPage, github, inbox, issues, ready, reply } from "./_github.mjs"

export async function POST(request) {
  if (!fromOwnPage(request, { origin: true })) return reply(403, { error: "origin" })
  if (!ready()) return reply(503, { error: "no-token" })
  try {
    const asked = (await issues("open", 100)).find((issue) => isSyncIssue(issue.body, inbox.site))
    if (asked) return reply(200, { ok: true, issue: asked.number, at: asked.created_at })
    const at = new Date().toISOString()
    const response = await github("/issues", { method: "POST", body: { title: syncTitle(), body: syncBody(inbox.site, at) } })
    if (response.error) return reply(502, response)
    if (!response.ok) return reply(502, { error: "github", status: response.status })
    const issue = await response.json().catch(() => ({}))
    return reply(201, { ok: true, issue: issue.number ?? null, at })
  } catch (error) { return reply(502, { error: error.code === "github-timeout" ? error.code : "github" }) }
}
