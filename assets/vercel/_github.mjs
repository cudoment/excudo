// What the website's inbox functions share, published beside them as api/_github.mjs (a file whose name
// starts with an underscore is not a route): the inbox's repository and website (_inbox.mjs), the
// answer they give, the check that a request comes from the website's own pages, and calls to GitHub
// with the token the owner keeps on Vercel as EXCUDO_INBOX_TOKEN.
import inbox from "./_inbox.mjs"

export { inbox }
export const TOKEN = "EXCUDO_INBOX_TOKEN"
export const ready = () => Boolean(process.env[TOKEN])

export const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

/**
 * Whether a request comes from a page of this website: it carries the header only a script of the
 * page sets (another website's page cannot send it without the website allowing it), and, when the
 * browser names where it comes from, that is this website.
 */
export function fromOwnPage(request, { origin: needed = false } = {}) {
  if (request.headers.get("x-excudo-edit") !== "1") return false
  const origin = request.headers.get("origin")
  if (!origin) return !needed
  const forwarded = request.headers.get("x-forwarded-host")
  return origin === new URL(request.url).origin || Boolean(forwarded && origin === `https://${forwarded}`)
}

/** A call to the inbox repository's part of the GitHub API. */
export async function github(path, { method = "GET", body } = {}) {
  try { return await globalThis.fetch(`https://api.github.com/repos/${inbox.repo}${path}`, {
    method,
    signal: AbortSignal.timeout(8000),
    headers: { authorization: `Bearer ${process.env[TOKEN]}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "excudo-site",
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) } catch (error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return { error: "github-timeout" }
    throw error
  }
}

/** The repository's issues, newest first, without pull requests; throws when GitHub does not answer. */
export async function issues(state, count) {
  const response = await github(`/issues?state=${state}&per_page=${count}&sort=created&direction=desc`)
  if (response.error) throw Object.assign(new Error(response.error), { code: response.error })
  if (!response.ok) throw new Error(`github ${response.status}`)
  const list = await response.json()
  return Array.isArray(list) ? list.filter((issue) => !issue.pull_request) : []
}
