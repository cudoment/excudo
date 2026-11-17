// The memo as a website: every node, Home, the generated views and (if asked) the journals, written
// by cudoc-export into a folder outside the graph, to open in a browser on any device. The engine
// writes a copy of the graph in the Markdown cudoc renders (dialects/html.mjs): the outliner's links,
// task markers, properties and queries become links, checkboxes, notes and the results the engine
// evaluated; each node ends with a cudoc tree of the nodes below it, folded the way the outliner
// folds them. cudoc collects that copy and writes the pages; then the engine adds what its own
// runtime needs on each page (site-runtime.mjs). The copy and cudoc's library live in temporary
// folders and are removed again, so the only output is the website.
import { createRequire } from "node:module"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEmbedSpec } from "@cudoment/cudoc/node/resolve-embed"
import { activityOutline } from "./activity.mjs"
import { prepare } from "./build.mjs"
import { walkGraph } from "./check.mjs"
import { dashboardData, dashboardOf } from "./dashboard.mjs"
import { convertInline, regionMarkdown, relativeLink, toSiteMarkdown } from "./dialects/html.mjs"
import { writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { evaluateQuery, parseQuery, queryBlocks, queryMarkdown } from "./queries.mjs"
import { appliedIds } from "./receive.mjs"
import { memoIndex, runtimeAssets, siteIdOf } from "./site-runtime.mjs"
import { localPath } from "./sources.mjs"
import { statusOutline } from "./status.mjs"
import { nodesSpec, ownedHome, pageOf, ROOT, treeColumns } from "./tree.mjs"

export const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url))
const MODES = ["site", "standalone"]
/** The folders of the website copy: every node by its place in the tree, the views, the journals. */
export const NODES = "nodes"
const VIEWS = "views"
const JOURNALS = "journals"
const STATE_FILE = "site.json"
export const INBOX_KEYS = ["github", "schedule"]
export const SITE_KEYS = ["out", "title", "mode", "open", "journals", "css", "id", "onSave", "inbox", "publish", "dashboard"]
const KEYS = SITE_KEYS
/** cudoc's syntax extensions that a memo never means: a `>>` in a table, a `(#id)` after a heading. */
const SYNTAX_OFF = Object.fromEntries(["headingAnchor", "badge", "tableCellList", "tableCellSpan", "tableNote", "codeMeta", "tabs", "callout"].map((key) => [key, "off"]))
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
const DATE_NAME = /^(\d{4})[-_](\d{2})[-_](\d{2})$/

/**
 * The website settings, checked: `{ out, title, mode, open, journals, css, id, onSave, inbox, dashboard }`.
 * Undefined when the workspace has no `site` setting, unless `defaults` asks for the defaults.
 */
export function siteOf(ws, { defaults = false, out, mode } = {}) {
  const m = ws.labels.messages
  const given = ws.site === undefined && defaults ? {} : ws.site
  if (given === undefined) return undefined
  const bad = (field) => { throw new Error(format(m["site-invalid"], { field })) }
  if (!given || typeof given !== "object" || Array.isArray(given)) bad("site")
  for (const key of Object.keys(given)) if (!KEYS.includes(key)) bad(key)
  const settings = {
    out: out ?? given.out ?? join(ws.cache, "site"), title: given.title ?? basename(ws.root), mode: mode ?? given.mode ?? "site",
    open: given.open ?? 0, journals: given.journals ?? false, css: given.css ?? [], id: given.id, onSave: given.onSave ?? true, inbox: given.inbox,
    publish: given.publish, // checked where it is used (publish.mjs)
  }
  if (typeof settings.out !== "string" || !settings.out.trim()) bad("out")
  settings.path = localPath(ws, settings.out)
  // The website is written whole into its folder: nothing else may live there, and the graph least of all.
  if (inside(settings.path, ws.graphDir) || inside(ws.graphDir, settings.path) || inside(ws.root, settings.path) || settings.path === ws.root) throw new Error(format(m["site-inside-graph"], { out: settings.out }))
  if (typeof settings.title !== "string" || !settings.title.trim()) bad("title")
  if (!MODES.includes(settings.mode)) bad("mode")
  if (!Number.isInteger(settings.open) || settings.open < 0) bad("open")
  if (typeof settings.journals !== "boolean") bad("journals")
  if (!Array.isArray(settings.css) || settings.css.some((file) => typeof file !== "string" || !file.trim())) bad("css")
  settings.css = settings.css.map((file) => localPath(ws, file))
  if (settings.id !== undefined && (typeof settings.id !== "string" || !/^[\w-]{1,64}$/.test(settings.id))) bad("id")
  if (typeof settings.onSave !== "boolean") bad("onSave")
  settings.inbox = inboxOf(settings.inbox, bad)
  settings.dashboard = dashboardOf(given.dashboard, { bad, inbox: settings.inbox })
  return settings
}

/**
 * The inbox setting, checked: null without one, else `{ repo, schedule }`. `true` asks for an inbox
 * whose private repository `site setup` makes and names; `{ github: { repo } }` names one; `schedule:
 * false` leaves bringing the changes in to a schedule of the owner's own instead of the engine's.
 */
function inboxOf(given, bad) {
  if (given === undefined || given === false || given === null) return null
  if (given === true) return { repo: null, schedule: true }
  if (typeof given !== "object" || Array.isArray(given)) bad("inbox")
  for (const key of Object.keys(given)) if (!INBOX_KEYS.includes(key)) bad(`inbox.${key}`)
  let repo = null
  if (given.github !== undefined) {
    const github = given.github
    if (!github || typeof github !== "object" || Array.isArray(github)) bad("inbox.github")
    for (const key of Object.keys(github)) if (key !== "repo") bad(`inbox.github.${key}`)
    if (typeof github.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(github.repo)) bad("inbox.github.repo")
    repo = github.repo
  }
  if (given.schedule !== undefined && typeof given.schedule !== "boolean") bad("inbox.schedule")
  return { repo, schedule: given.schedule ?? true }
}

/** Whether cudoc-export can be loaded for this workspace, so a setup knows to install it first. */
export function hasExporter(ws) {
  try { exporter(ws); return true } catch { return false }
}

/** cudoc-export, loaded only when a website is written; a memo that writes none need not install it. */
function exporter(ws) {
  try { return createRequire(join(ws.root, "package.json"))("cudoc-export") } catch {}
  try { return createRequire(import.meta.url)("cudoc-export") } catch {}
  throw new Error(ws.labels.messages["site-missing-export"])
}

const nfc = (text) => text.normalize("NFC")
const journalDate = (name) => { const match = nfc(name).match(DATE_NAME); return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined }

/**
 * The website copy of the graph: what each page is (`pages`), how a page name resolves (`resolve`),
 * and the website id of each node (`copyId`). Nothing is written yet.
 */
export function planSite(ws, { library, model }, settings) {
  const home = ownedHome(ws)
  const homeId = nfc(ws.labels.home)
  const copyIds = new Map()
  const copyId = (id) => {
    if (!copyIds.has(id)) {
      const names = []
      for (let at = id; at !== ROOT; at = model.parentOf(at)) names.unshift(pageOf(at))
      copyIds.set(id, [NODES, ...names].join("/"))
    }
    return copyIds.get(id)
  }
  const realIds = new Map(model.nodes.map((doc) => [copyId(doc.id), doc.id]))
  const views = library.documents.filter((doc) => model.isView(doc.id) && pageOf(doc.id) !== homeId)
  const viewIds = new Map(views.map((doc) => [pageOf(doc.id).toLowerCase(), `${VIEWS}/${pageOf(doc.id)}`]))
  const journals = settings.journals ? walkGraph(ws).pages.filter((page) => page.journal && journalDate(page.name)).sort((a, b) => b.name.localeCompare(a.name)) : []
  const journalIds = new Map(journals.map((page) => [journalDate(page.name), `${JOURNALS}/${journalDate(page.name)}`]))
  const resolve = (name) => {
    const key = nfc(name).toLowerCase()
    if (key === homeId.toLowerCase()) return homeId
    const id = model.find(name)
    if (id) return copyId(id)
    if (viewIds.has(key)) return viewIds.get(key)
    const date = journalDate(name)
    if (date && journalIds.has(date)) return journalIds.get(date)
    return undefined
  }
  const homeView = library.documents.find((doc) => model.isView(doc.id) && pageOf(doc.id) === homeId)
  return { home, homeId, homeView, copyId, realIds, views, viewIds, journals, journalIds, resolve }
}

/** The YAML of a tree fence for the website: its sources moved to the copy, its order kept. */
function treeFence(spec, { sources, order }) {
  const render = { ...spec.render, order }
  if (!order?.length) delete render.order
  return ["```cudoc-embed", `sources: ${JSON.stringify(sources)}`, "render:", ...Object.entries(render).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`), "```"].join("\n")
}

/** A nested list of tree lines (a ```nodes fence) as Markdown. */
function treeMarkdown(lines, ctx, depth = 0) {
  return lines.flatMap((line) => {
    const name = nfc(line.name)
    const cells = line.cells.map((cell) => cell.url ? `[${name}](${relativeLink(ctx.page.id, ctx.resolve(name) ?? name)})` : nfc(cell.text)).filter(Boolean)
    return [`${"  ".repeat(depth)}- ${cells.join(" · ") || name}`, ...treeMarkdown(line.children, ctx, depth + 1)]
  })
}

/** A view's Markdown for the website: its fences resolved, the tree fence left to cudoc. */
function viewMarkdown(ws, prepared, doc, plan, ctx, settings) {
  const { model } = prepared
  const lines = doc.source.text.split("\n")
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^```(\S*)\s*$/)
    if (!fence) { out.push(convertInline(lines[i], ctx)); continue }
    const end = lines.findIndex((line, j) => j > i && /^```\s*$/.test(line))
    const body = lines.slice(i + 1, end < 0 ? lines.length : end).join("\n")
    i = end < 0 ? lines.length : end
    const lang = fence[1]
    if (lang === "cudoc-embed") {
      const spec = parseEmbedSpec(body)
      if (spec.render?.type === "tree") {
        // The engine orders the first level (meta nodes last unless the view says otherwise).
        const order = model.resolve(spec, doc.id).map((line) => nfc(line.name))
        out.push(treeFence(spec, { sources: [`/${NODES}/`], order }))
      } else {
        const sources = (spec.sources ?? []).map((source) => {
          const id = model.find(String(source).replace(/^\//, "").replace(/\.mdx?$/, ""))
          return id ? `/${plan.copyId(id)}.md` : source
        })
        out.push(["```cudoc-embed", body.replace(/^sources:.*$/m, `sources: ${JSON.stringify(sources)}`), "```"].join("\n"))
      }
    } else if (lang === "nodes") out.push(treeMarkdown(model.nodeLines(nodesSpec(body, ws.labels)), ctx).join("\n"))
    else if (lang === "activity") out.push(toSiteMarkdown(activityOutline(ws, model, body), { ...ctx, page: { id: ctx.page.id } }).trimEnd())
    else if (lang === "status") out.push(toSiteMarkdown(statusOutline(ws, prepared, body), { ...ctx, page: { id: ctx.page.id } }).trimEnd())
    else if (lang === "outline" || lang === "tine") out.push(toSiteMarkdown(body, { ...ctx, page: { id: ctx.page.id } }).trimEnd())
    else out.push(["```" + lang, body, "```"].join("\n"))
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`
}

/** Writes the website copy of the graph into `dir`. Returns the pages written, by website id. */
export function writeCopy(ws, prepared, settings, dir) {
  const { library, model } = prepared
  const plan = planSite(ws, prepared, settings)
  const blocks = queryBlocks(ws, model, { home: plan.home })
  const pages = new Map()
  const query = (ctx) => (body) => {
    const { ast, options } = parseQuery(body)
    if (!ast) return undefined
    return queryMarkdown(ws, evaluateQuery(ast, blocks), options, { ...ctx, resolve: plan.resolve, pageIdOf: (page) => page.kind === "home" ? plan.homeId : page.kind === "journal" ? plan.journalIds.get(journalDate(page.name)) : plan.copyId(page.id) })
  }
  const context = (page) => {
    const ctx = { page, resolve: plan.resolve, region: ws.labels.region, ownProperties: [ws.labels.generated, ws.labels.pause.key] }
    ctx.query = query(ctx)
    return ctx
  }
  const write = (id, text) => {
    const path = join(dir, ...id.split("/")) + ".md"
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    pages.set(id, path)
  }
  const columns = treeColumns
  for (const doc of model.nodes) {
    const id = plan.copyId(doc.id)
    const ctx = context({ id, rel: nfc(doc.sourcePath) })
    const ancestors = []
    for (let at = model.parentOf(doc.id); at !== ROOT; at = model.parentOf(at)) ancestors.unshift({ name: pageOf(at), href: relativeLink(id, plan.copyId(at)) })
    ancestors.unshift({ name: nfc(ws.labels.home), href: relativeLink(id, plan.homeId) })
    const folder = (model.children.get(doc.id) ?? []).length ? id : undefined
    write(id, toSiteMarkdown(doc.source.text, ctx) + regionMarkdown({ labels: ws.labels, ancestors, name: pageOf(doc.id), folder, open: settings.open, columns }))
  }
  if (plan.home) {
    const text = toSiteMarkdown(plan.home.text, context({ id: plan.homeId, rel: plan.home.rel }))
    write(plan.homeId, /^#\s/.test(text) ? text : `# ${plan.homeId}\n\n${text}`)
  } else if (plan.homeView) write(plan.homeId, viewMarkdown(ws, prepared, plan.homeView, plan, context({ id: plan.homeId }), settings))
  else {
    // A memo that was never built has no Home yet: the website then starts from the top nodes.
    const top = (model.children.get(ROOT) ?? []).map((id) => `- [${pageOf(id)}](${relativeLink(plan.homeId, plan.copyId(id))})`)
    write(plan.homeId, `# ${plan.homeId}

${top.length ? top.join("\n") : ws.labels.site.none}
`)
  }
  for (const doc of plan.views) write(`${VIEWS}/${pageOf(doc.id)}`, viewMarkdown(ws, prepared, doc, plan, context({ id: `${VIEWS}/${pageOf(doc.id)}` }), settings))
  if (plan.journals.length) {
    for (const page of plan.journals) {
      const date = journalDate(page.name)
      write(`${JOURNALS}/${date}`, `# ${date}\n\n${toSiteMarkdown(readFileSync(page.path, "utf8"), context({ id: `${JOURNALS}/${date}`, rel: page.rel }))}`)
    }
    write(JOURNALS, `# ${ws.labels.site.journals}\n\n${plan.journals.map((page) => `- [${journalDate(page.name)}](${JOURNALS}/${journalDate(page.name)}.md)`).join("\n")}\n`)
  }
  const assets = join(ws.graphDir, "assets")
  if (existsSync(assets)) cpSync(assets, join(dir, "assets"), { recursive: true })
  return { plan, pages }
}

/** The navigation on the left: Home, the nodes in the tree's order, the views, the journals. */
function navigation(ws, prepared, plan, settings) {
  const { model } = prepared
  const order = model.rootData().map((line) => nfc(line.name))
  const items = [`${plan.homeId}.md`, { folder: NODES, title: ws.labels.site.nodes, order }]
  if (plan.views.length) items.push({ folder: VIEWS, title: ws.labels.site.views, collapsed: true })
  if (plan.journals.length) items.push({ folder: JOURNALS, title: ws.labels.site.journals, collapsed: true, order: plan.journals.map((page) => journalDate(page.name)) })
  return { items, hidden: plan.journals.length ? [`${JOURNALS}.md`] : [] }
}

/** Every `.html` page under `dir`, relative to it. */
function htmlFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? htmlFiles(path, base) : entry.name.endsWith(".html") ? [relative(base, path).split(sep).join("/")] : []
  })
}
/** Adds the engine's scripts to a page that cudoc wrote, before `</body>`. */
/** Without scripts a narrow page shows its list in place, since before cudoc-export 1.1 the button that opens it is the runtime's. */
const NOSCRIPT = "<noscript><style>@media (max-width: 768px) { nav.sidebar { display: block !important; } }</style></noscript>"

export function injectRuntime(html, scripts, inline = []) {
  // cudoc-export 1.1 opens the list on a narrow page without a script, so it needs no fallback.
  const fallback = html.includes("cudoc-nav-toggle") ? [] : [NOSCRIPT]
  const tags = [...scripts.map((src) => `<script defer src="${src}"></script>`), ...inline.map((text) => `<script>${text}</script>`), ...fallback].join("")
  const at = html.lastIndexOf("</body>")
  return at < 0 ? html + tags : html.slice(0, at) + tags + html.slice(at)
}

const readState = (ws) => { try { return JSON.parse(readFileSync(join(ws.cacheDir, STATE_FILE), "utf8")) } catch { return undefined } }
/** What the last website build wrote, from `.excudo/site.json`. */
export const siteState = (ws) => readState(ws)

/**
 * Writes the website. Returns `{ out, mode, pages, files, omitted, diagnostics }`. With `dryRun`
 * the website is built in a temporary folder and discarded, so the output folder is untouched.
 */
export function writeSite(ws, { prepared, out, mode, dryRun = false, now = new Date() } = {}) {
  const settings = siteOf(ws, { defaults: true, out, mode })
  const { buildSite } = exporter(ws)
  prepared ??= prepare(ws)
  const errors = prepared.references.issues.filter((issue) => issue.severity === "error")
  if (errors.length) throw new Error(`${errors[0].sourcePath}: ${errors[0].message}`)
  const tmp = mkdtempSync(join(tmpdir(), "excudo-site-"))
  try {
    const copy = join(tmp, "copy")
    const { plan } = writeCopy(ws, prepared, settings, copy)
    const outDir = dryRun ? join(tmp, "out") : settings.path
    const { model } = prepared
    const counts = new WeakMap()
    const result = buildSite({
      sourceRoot: copy, outDir, libraryDir: join(tmp, "library"), title: settings.title, home: `${plan.homeId}.md`, mode: settings.mode,
      ...(settings.mode === "standalone" ? { documents: [`${plan.homeId}.md`] } : {}),
      host: "html", syntax: SYNTAX_OFF, exclude: ["assets/**"],
      extractors: { openTasks: { version: "site-1", extract(row, { library, node }) {
        if (!counts.has(library)) counts.set(library, new Map(library.documents.map((doc) => [doc.id, model.ownOpen(plan.realIds.get(nfc(doc.id)) ?? "")])))
        const own = counts.get(library)
        const count = (line) => (own.get(line.documentId) ?? 0) + line.children.reduce((sum, child) => sum + count(child), 0)
        const n = node ? count(node) : own.get(row.document.id) ?? 0
        return n ? format(ws.labels.tasks, { n }) : undefined
      } } },
      navigation: settings.mode === "site" ? navigation(ws, prepared, plan, settings) : undefined,
      locales: { [ws.locale]: ws.locale === "ko" ? "한국어" : "English" },
      toc: { depth: 3 }, css: [runtimeAssets().css, ...settings.css], themeSwitch: true, links: "relative",
      // With an inbox a page sends the states chosen on it to the website's own function, and nowhere else.
      ...(settings.inbox ? { connect: ["'self'"] } : {}),
    })
    const pages = htmlFiles(outDir).filter((file) => !/\.print\.html$/.test(file))
    // A site opens on index.html; a standalone page keeps Home's own name.
    const home = settings.mode === "standalone" ? `${plan.homeId}.html` : "index.html"
    const routes = new Map([...plan.realIds].map(([copyId, id]) => [id, `${copyId}.html`]).filter(([, route]) => pages.includes(route)))
    const dashboard = dashboardData(ws, { prepared, plan, routes, settings, now })
    const index = memoIndex(ws, { model, plan, routes, pages, settings, home, siteId: siteIdOf(ws, settings), applied: appliedIds(ws, { now }), dashboard })
    const runtime = readFileSync(runtimeAssets().script, "utf8")
    if (settings.mode === "standalone") {
      // A single page carries everything it shows, the engine's scripts too.
      for (const file of pages) {
        const path = join(outDir, ...file.split("/"))
        writeFileSync(path, injectRuntime(readFileSync(path, "utf8"), [], [index, runtime]))
      }
    } else {
      writeFileSync(join(outDir, "excudo-memo.js"), index)
      writeFileSync(join(outDir, "excudo-runtime.js"), runtime)
      for (const file of pages) {
        const path = join(outDir, ...file.split("/"))
        const up = "../".repeat(file.split("/").length - 1)
        writeFileSync(path, injectRuntime(readFileSync(path, "utf8"), [`${up}excudo-memo.js`, `${up}excudo-runtime.js`]))
      }
    }
    const summary = { out: settings.path, mode: settings.mode, pages: pages.length, files: result.files.length + (settings.mode === "standalone" ? 0 : 2), omitted: result.omitted, diagnostics: result.diagnostics, home }
    if (!dryRun) {
      mkdirSync(ws.cacheDir, { recursive: true })
      writeAtomic(join(ws.cacheDir, STATE_FILE), `${JSON.stringify({ ...summary, at: now.toISOString() }, null, 2)}\n`)
    }
    return summary
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

/** The address of the website's home page, for `--open`. */
export const siteHome = (ws, summary) => resolve(summary.out, summary.home)
