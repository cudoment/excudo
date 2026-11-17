import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { build, idle, relativeLink, siteOf, siteState, taskHash, toSiteMarkdown, writeSite } from "../src/index.mjs"
import { injectRuntime } from "../src/site.mjs"
import { put, tempDir, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const ctx = { page: { id: "nodes/Work", rel: "projects/Work.md" }, resolve: (name) => ({ design: "nodes/Work/Design", home: "Home", "2026-10-20": "journals/2026-10-20", check: "nodes/Check" })[name.toLowerCase()],
  query: (body) => body === "(task TODO)" ? "<details class=\"excudo-query\" open>\n<summary>Open</summary>\n\n- x\n\n</details>" : undefined }

test("links between pages are relative to the page they are on, every segment encoded", () => {
  assert.equal(relativeLink("Home", "nodes/Work/Design"), "nodes/Work/Design.md")
  assert.equal(relativeLink("nodes/Work/Design", "Home"), "../../Home.md")
  assert.equal(relativeLink("nodes/Work/Design", "nodes/Work"), "../Work.md")
  assert.equal(relativeLink("nodes/Work", "nodes/Work/Design"), "Work/Design.md")
  assert.equal(relativeLink("nodes/개인 운영/메모", "nodes/문서 도구"), "../%EB%AC%B8%EC%84%9C%20%EB%8F%84%EA%B5%AC.md")
  assert.equal(taskHash("TODO a task"), taskHash("TODO a task  "), "trailing blanks do not change a task's digest")
  assert.equal(taskHash("TODO 메모".normalize("NFD")), taskHash("TODO 메모".normalize("NFC")))
})

const cases = [
  ["a page link", "See [[Design]] and [[Nowhere]].", 'See [Design](Work/Design.md) and <span class="excudo-missing">Nowhere</span>.'],
  ["a link in code stays", "Run `[[Design]]` now", "Run `[[Design]]` now"],
  ["an open task", "- TODO Pick a font", '- [ ] <span class="excudo-task excudo-todo" data-excudo-page="projects/Work.md" data-excudo-line="1" data-excudo-hash="' + taskHash("TODO Pick a font") + '" data-excudo-state="TODO">TODO</span> Pick a font'],
  ["a finished task with a priority", "- DONE [#A] Pick colours", '- [x] <span class="excudo-task excudo-done" data-excudo-page="projects/Work.md" data-excudo-line="1" data-excudo-hash="' + taskHash("DONE [#A] Pick colours") + '" data-excudo-state="DONE">DONE</span> <span class="excudo-priority">A</span> Pick colours'],
  ["a deadline below a task", "- TODO Pick a font\n  DEADLINE: <2026-11-01 Sat>", '- [ ] <span class="excudo-task excudo-todo" data-excudo-page="projects/Work.md" data-excudo-line="1" data-excudo-hash="' + taskHash("TODO Pick a font") + '" data-excudo-state="TODO">TODO</span> Pick a font <span class="excudo-date excudo-deadline">2026-11-01</span>'],
  ["a tag with a page, and one without", "- Ask #check about #later", '- Ask [#check](Check.md) about <span class="excudo-tag">#later</span>'],
  ["the outliner's own properties go, others stay", "- Line\n  collapsed:: true\n  id:: 64b1c2d3-0000-4000-8000-000000000000\n  window:: Me", '- Line\n  <small class="excudo-property">window: Me</small>'],
  ["a heading block becomes a heading over its items", "- ### Work · [[Design]]\n\t- TODO One\n- Plain item", '### Work · [Design](Work/Design.md)\n\n- [ ] <span class="excudo-task excudo-todo" data-excudo-page="projects/Work.md" data-excudo-line="2" data-excudo-hash="' + taskHash("TODO One") + '" data-excudo-state="TODO">TODO</span> One\n\n<!-- -->\n\n- Plain item'],
  ["tabs become spaces", "- A\n\t- B\n\t\t- C", "- A\n  - B\n    - C"],
  ["a query becomes its result, and one the website cannot show stays as words", "- {{query (task TODO)}}\n- {{query (property x y)}}", '<details class="excudo-query" open>\n<summary>Open</summary>\n\n- x\n\n</details>\n\n- <span class="excudo-query-unsupported">{{query (property x y)}}</span>'],
  ["a nested query is the item's content", "- Group\n\t- {{query (task TODO)}}", '- Group\n  - <details class="excudo-query" open>\n    <summary>Open</summary>\n\n    - x\n\n    </details>'],
  ["an embedded page becomes a cudoc embed", "- {{embed [[Design]]}}", '- ```cudoc-embed\n  sources: ["Work/Design.md"]\n  ```'],
  ["a date page links to its journal", "Written on [[2026-10-20]].", "Written on [2026-10-20](../journals/2026-10-20.md)."],
  ["the generated region is cut off", "- Item\n\n## Subpages\nLocation: [[Home]] › Work\n\n- [[Design]]", "- Item"],
]
for (const [name, input, expected] of cases) test(`the website's Markdown: ${name}`, () => {
  assert.equal(toSiteMarkdown(input, { ...ctx, region: "Subpages" }), `${expected}\n`)
})

test("the site setting is checked: its folder lies outside the graph and the workspace, its mode and inbox are known", async () => {
  const ws = await workspace({ "Work.md": "# Work\nWork.\n" }, { site: { out: "../site", open: 2, inbox: { github: { repo: "me/inbox" } } } })
  const settings = siteOf(ws)
  assert.equal(settings.path, resolve(ws.root, "../site"))
  assert.deepEqual([settings.mode, settings.open, settings.journals, settings.onSave, settings.inbox], ["site", 2, false, true, { repo: "me/inbox", schedule: true }])
  // An inbox setup names, or one whose changes the owner's own schedule brings in.
  assert.deepEqual(siteOf({ ...ws, site: { inbox: true } }).inbox, { repo: null, schedule: true })
  assert.deepEqual(siteOf({ ...ws, site: { inbox: { github: { repo: "me/inbox" }, schedule: false } } }).inbox, { repo: "me/inbox", schedule: false })
  assert.equal(siteOf({ ...ws, site: { inbox: false } }).inbox, null)
  assert.equal(siteOf({ ...ws, site: undefined }), undefined)
  assert.equal(siteOf({ ...ws, site: undefined }, { defaults: true }).path, join(ws.cacheDir, "site"))
  for (const [site, field] of [[{ out: "notes/site" }, "site:"], [{ out: "." }, "site:"], [{ mode: "pdf" }, "mode"], [{ open: -1 }, "open"], [{ nope: 1 }, "nope"],
    [{ inbox: { github: { repo: "bad repo" } } }, "inbox.github.repo"], [{ inbox: { github: { repo: "me/inbox", template: "x.yml" } } }, "inbox.github.template"], [{ inbox: { gitlab: {} } }, "inbox.gitlab"], [{ inbox: "yes" }, "inbox"], [{ inbox: { schedule: "no" } }, "inbox.schedule"]])
    assert.throws(() => siteOf({ ...ws, site: site }), new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), JSON.stringify(site))
})

/** A memo with NFD file names, an owner's Home with heading blocks and queries, a view and a journal. */
async function memo(config = {}) {
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace({
    [nfd("projects/일.md")]: "# 일\n지금 하는 일.\n\n- DOING 사이트 만들기 [[디자인]] #에이전트\n\t- 아래 메모\n- TODO 나중 일 #중기\n- 방침: 옛 링크를 지킨다\n",
    [nfd("projects/일/디자인.md")]: "# 디자인\n보이는 모습.\n\n- TODO 글꼴 고르기\n  DEADLINE: <2026-11-01 Sat>\n- DONE 색 고르기\n",
    "Me.md": "# Me\nMine.\n\n- TODO Renew the passport\n",
    [nfd("홈.md")]: "## 생각과 계획\n- ### 지금 · [[일]]\n\t- TODO 홈의 할 일\n- [[현황]]\n\n## 업무와 자동화\n- ### 할 일\n\t- {{query (and (task DOING) (not (page \"홈\"))) {:title \"진행 중\"}}}\n\t- {{query (and (task TODO) (not [[중기]]) (not (page \"홈\"))) {:title \"다음 할 일\" :collapsed? true}}}\n",
    [nfd("views/현황.mdx")]: "# 현황\n\n현황입니다.\n\n```status\ndays: 7\n```\n",
    "journals/2026_10_20.md": "- TODO 인쇄소에 전화\n",
  }, { locale: "ko", ...config })
  return ws
}
const hashes = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true }).filter((rel) => statSync(join(dir, rel)).isFile())
  .map((rel) => [rel.normalize("NFC"), createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex")]))

test("the website is written outside the graph with NFC names: Home with its queries, every node with its tree, the views, the journals and the runtime", async () => {
  const out = join(tempDir(), "site")
  const ws = await memo({ site: { out, journals: true } })
  const summary = writeSite(ws)
  assert.deepEqual([summary.out, summary.pages, summary.home, summary.omitted, summary.diagnostics], [out, 7, "index.html", [], []])
  const files = Object.keys(hashes(out))
  for (const file of ["index.html", "nodes/일.html", "nodes/일/디자인.html", "nodes/Me.html", "views/현황.html", "journals.html", "journals/2026-10-20.html", "excudo-memo.js", "excudo-runtime.js", "cudoc-css/1-memo.css"])
    assert.ok(files.includes(file), `${file} is written`)
  assert.ok(!files.some((file) => file !== file.normalize("NFC")), "every file name is NFC")
  const home = readFileSync(join(out, "index.html"), "utf8")
  assert.match(home, /<h1[^>]*>홈<\/h1>/)
  assert.match(home, /<h3[^>]*>지금 · <a href="nodes\/일\.html">일<\/a><\/h3>/)
  assert.match(home, /data-excudo-page="홈\.md" data-excudo-line="3"/, "a task on Home carries Home's address")
  assert.match(home, /<details class="excudo-query">\s*<summary>진행 중 <small class="excudo-count">1<\/small><\/summary>/)
  assert.match(home, /<details class="excudo-query">\s*<summary>다음 할 일 <small class="excudo-count">3<\/small>/, "Home's own task is left out by (not (page \"홈\"))")
  assert.match(home, /<a href="views\/현황\.html">현황<\/a>/, "a view is linked from Home")
  assert.match(home, /<script defer src="excudo-memo\.js"><\/script><script defer src="excudo-runtime\.js"><\/script>/)
  const node = readFileSync(join(out, "nodes/일.html"), "utf8")
  assert.match(node, /<ul class="cudoc-tree">\s*<li class="cudoc-tree-leaf"><a href="일\/디자인\.html">디자인<\/a> · 할 일 1 · 보이는 모습\.<\/li>/)
  assert.match(node, /excudo-location">위치: <a href="\.\.\/index\.html">홈<\/a> › 일</)
  assert.match(node, /data-excudo-page="projects\/일\.md" data-excudo-line="4"/)
  assert.match(readFileSync(join(out, "nodes/일/디자인.html"), "utf8"), /excudo-deadline">2026-11-01</)
  assert.match(readFileSync(join(out, "journals/2026-10-20.html"), "utf8"), /data-excudo-page="journals\/2026_10_20\.md"/)
  const index = readFileSync(join(out, "excudo-memo.js"), "utf8")
  assert.match(index, /^window\.excudoMemo = \{/)
  const data = JSON.parse(index.slice("window.excudoMemo = ".length, -2))
  assert.deepEqual(data.nodes.map((item) => [item.id, item.route, item.total]), [["Me", "nodes/Me.html", 1], ["projects/일", "nodes/일.html", 3], ["projects/일/디자인", "nodes/일/디자인.html", 1]])
  assert.deepEqual([data.home, data.journals, data.locale, data.views], ["index.html", "journals.html", "ko", [{ name: "현황", route: "views/현황.html" }]])
  assert.equal(siteState(ws).pages, 7)
  const first = hashes(out)
  writeSite(ws)
  assert.deepEqual(hashes(out), first, "building again writes the same bytes")
})

test("a dry run builds nowhere, a build writes the website when the setting asks, and the graph stays idle", async () => {
  const out = join(tempDir(), "site")
  const ws = await memo({ site: { out } })
  assert.equal(writeSite(ws, { dryRun: true }).pages, 5)
  assert.ok(!existsSync(out), "a dry run writes nothing")
  spawnSync("git", ["init", "-q"], { cwd: ws.root })
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], { cwd: ws.root })
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "start"], { cwd: ws.root })
  const result = build(ws)
  assert.equal(result.site.pages, 5)
  assert.equal(result.siteError, undefined)
  assert.ok(existsSync(join(out, "index.html")))
  assert.ok(!result.written.some((file) => file.startsWith(out)), "the website is not among the graph files written")
  // Only the graph counts for idleness; the website lies outside it.
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], { cwd: ws.root })
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "built"], { cwd: ws.root })
  assert.equal(idle(ws).state, "idle")
  const out2 = join(tempDir(), "site2")
  const quiet = await memo({ site: { out: out2, onSave: false } })
  assert.equal(build(quiet).site, undefined)
  assert.ok(!existsSync(out2))
})

test("a standalone website is one page carrying Home", async () => {
  const out = join(tempDir(), "single")
  const ws = await memo({ site: { out, mode: "standalone" } })
  const summary = writeSite(ws)
  assert.deepEqual([summary.pages, summary.home], [1, "홈.html"])
  const page = readFileSync(join(out, "홈.html"), "utf8")
  assert.match(page, /<style>/)
  assert.match(page, /excudo-query/)
  assert.match(page, /<script>window\.excudoMemo = \{/, "the index is inside the page")
  assert.ok(!existsSync(join(out, "excudo-runtime.js")), "no script file beside a single page")
})

test("the site command writes the website and says so, in JSON too", async () => {
  const ws = await memo()
  const out = join(tempDir(), "site")
  const run = spawnSync(process.execPath, [cli, "site", "--out", out, "--json"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).pages, 5)
  const words = spawnSync(process.execPath, [cli, "site", "--out", out, "--dry-run"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(words.status, 0, words.stderr)
  assert.match(words.stdout, /웹 사이트: .*5쪽을 쓰게 됩니다/)
  const inside = spawnSync(process.execPath, [cli, "site", "--out", "notes/site"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(inside.status, 1)
  assert.match(inside.stderr, /그래프와 작업 폴더 밖/)
})

test("a page name that two Unicode forms spell is one page on the website", async () => {
  const out = join(tempDir(), "site")
  const ws = await memo({ site: { out } })
  put(ws.root, "projects/일/메모.md".normalize("NFD"), "# 메모\n메모.\n\n- 위로: [[일]] · [[디자인]]\n")
  writeSite(ws)
  const page = readFileSync(join(out, "nodes/일/메모.html"), "utf8")
  assert.match(page, /<a href="\.\.\/일\.html">일<\/a> · <a href="디자인\.html">디자인<\/a>/)
})

test("a memo that was never built still has a Home on the website: its top nodes", async () => {
  const ws = await workspace({ "Work.md": "# Work\nCurrent work.\n", "Play.md": "# Play\nGames.\n" }, { locale: "en" })
  const out = join(tempDir(), "site")
  writeSite(ws, { out })
  const home = readFileSync(join(out, "index.html"), "utf8")
  assert.match(home, /<a href="nodes\/Work\.html">Work<\/a>/)
  assert.match(home, /<a href="nodes\/Play\.html">Play<\/a>/)
})

test("a page gets the runtime's scripts, and a fallback that shows the list without scripts unless cudoc opens the list itself", () => {
  const page = injectRuntime("<html><body><main></main></body></html>", ["excudo-memo.js", "excudo-runtime.js"])
  assert.match(page, /<script defer src="excudo-memo\.js"><\/script><script defer src="excudo-runtime\.js"><\/script><noscript><style>@media \(max-width: 768px\) \{ nav\.sidebar \{ display: block !important; \} \}<\/style><\/noscript><\/body>/)
  const own = injectRuntime('<html><body><input type="checkbox" id="cudoc-nav-toggle" class="cudoc-nav-toggle" hidden><main></main></body></html>', ["excudo-runtime.js"])
  assert.doesNotMatch(own, /<noscript>/)
})
