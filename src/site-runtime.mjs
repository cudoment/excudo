// What the website's pages carry for the engine's own runtime (assets/memo-runtime.js): the index
// of the memo, written as a script the page loads (`excudo-memo.js`), since a page may be opened
// from a file and its policy allows no fetch. The index names every node with its address on the
// website, its open tasks and its summary, so the runtime can search the memo and point at a node
// without reading another page; nothing in it is a time, so a rebuild without changes writes the
// same bytes, unless Home has a dashboard, whose numbers carry the time they were worked out. `site` names the memo in the browser's storage.
import { createHash } from "node:crypto"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { pageOf, plain, ROOT } from "./tree.mjs"

/** The runtime's files, shipped with the package. */
export const runtimeAssets = () => ({
  script: fileURLToPath(new URL("../assets/memo-runtime.js", import.meta.url)),
  css: fileURLToPath(new URL("../assets/memo.css", import.meta.url)),
})

/** The inbox functions' addresses from the website's root, where the publishing step puts them. */
export const INBOX_ENDPOINT = "api/edit"
export const INBOX_SYNC = "api/sync"

/** The id that names this memo in a browser: the setting, or a digest of the workspace folder's name. */
export const siteIdOf = (ws, settings) => settings.id ?? createHash("sha256").update(basename(ws.root).normalize("NFC")).digest("hex").slice(0, 16)

const summaryOf = (doc) => doc.tree.children[1]?.type === "paragraph" ? plain(doc.tree.children[1]).replace(/\s+/g, " ").trim().normalize("NFC") : ""

/** The text of `excudo-memo.js`. */
export function memoIndex(ws, { model, plan, routes, settings, siteId, home = "index.html", applied = [], dashboard = null }) {
  const nodes = []
  const walk = (id) => {
    for (const child of model.children.get(id) ?? []) {
      const doc = model.docs.get(child)
      const route = routes.get(child)
      if (route) nodes.push({ id: child.normalize("NFC"), name: pageOf(child), route, parent: id === ROOT ? null : id.normalize("NFC"),
        open: model.ownOpen(child), total: model.totalOpen(child), summary: summaryOf(doc) })
      walk(child)
    }
  }
  walk(ROOT)
  const index = {
    version: 1, site: siteId, locale: ws.locale, home, mode: settings.mode,
    views: plan.views.map((doc) => ({ name: pageOf(doc.id), route: `views/${pageOf(doc.id)}.html` })),
    journals: plan.journals.length ? "journals.html" : null,
    states: { open: ["TODO", "DOING", "NOW", "LATER", "WAITING"], closed: ["DONE", "CANCELED"] },
    // Where a page sends the states chosen on it: the website's inbox function, beside its pages.
    inbox: settings.inbox ? { endpoint: INBOX_ENDPOINT, sync: INBOX_SYNC } : null, applied, nodes,
    // Home's dashboard, with its numbers as of this build (dashboard.mjs); the one part of the index that names a time.
    ...(dashboard ? { dashboard } : {}),
  }
  return `window.excudoMemo = ${JSON.stringify(index).replace(/</g, "\\u003c")};\n`
}
