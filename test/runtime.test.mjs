import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"

/*
 * The page runtime (assets/memo-runtime.js) run against a small stand-in for the browser: enough of
 * the DOM for the toolbar, the search results and the links, and a storage object. What is checked
 * is where the runtime thinks it is and where its links lead from there.
 */
const script = readFileSync(new URL("../assets/memo-runtime.js", import.meta.url), "utf8")

/** Toggles a browser fires after a <details> opens or closes, delivered when a test lets time pass. */
const queued = []
let focused = null
const settle = () => { while (queued.length) queued.shift()() }

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.listeners = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.value = ""; this.state = false; this.style = {} }
  /** A <details> fires "toggle" after its state changes, later, as a browser does. */
  get open() { return this.state }
  set open(value) {
    const next = Boolean(value)
    if (next === this.state) return
    this.state = next
    if (this.tagName === "DETAILS") queued.push(() => this.fire("toggle"))
  }
  get classList() {
    const names = () => this.className.split(" ").filter(Boolean)
    return { add: (name) => { if (!names().includes(name)) this.className = [...names(), name].join(" ") }, remove: (name) => { this.className = names().filter((item) => item !== name).join(" ") }, contains: (name) => names().includes(name) }
  }
  focus() { focused = this }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child }
  insertBefore(child, before) { child.parentNode = this; const at = before ? this.children.indexOf(before) : -1; if (at < 0) this.children.push(child); else this.children.splice(at, 0, child); return child }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null }
  get firstChild() { return this.children[0] ?? null }
  get nextSibling() { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler) }
  fire(type, event = {}) { for (const handler of this.listeners[type] ?? []) handler({ type, ...event }) }
  contains(other) { for (let node = other; node; node = node.parentNode) if (node === this) return true; return false }
  /** One compound selector: a tag, classes and one [name="value"]. */
  matches(selector) {
    const match = selector.replace(/^:scope\s*>\s*/, "").match(/^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)="([^"]*)"\])?$/i)
    if (!match) return false
    const [, tag, classes, name, value] = match
    return (!tag || this.tagName === tag.toUpperCase()) && classes.split(".").filter(Boolean).every((item) => this.className.split(" ").includes(item)) && (!name || this.attributes[name] === value)
  }
  all() { return this.children.flatMap((child) => [child, ...child.all()]) }
  closest(selector) { let node = this; while (node) { if (node.matches?.(selector)) return node; node = node.parentNode } return null }
  /** Each part of a selector list, with descendant steps (`main details`), in document order and once. */
  querySelectorAll(selector) {
    const child = selector.match(/^:scope\s*>\s*(.+)$/)
    if (child) return this.children.filter((element) => element.matches(child[1]))
    const parts = selector.split(",").map((part) => part.trim().split(/\s+/))
    const fits = (element, steps) => {
      if (!element.matches(steps.at(-1))) return false
      let node = element.parentNode
      for (let i = steps.length - 2; i >= 0; i--) { while (node && !node.matches(steps[i])) node = node.parentNode; if (!node) return false; node = node.parentNode }
      return true
    }
    return this.all().filter((element) => parts.some((steps) => fits(element, steps)))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
}

const index = {
  version: 1, site: "t", locale: "ko", home: "index.html", mode: "site",
  views: [{ name: "현황", route: "views/현황.html" }], journals: "journals.html",
  nodes: [
    { id: "Work", name: "Work", route: "nodes/Work.html", parent: null, open: 1, total: 2, summary: "Current work." },
    { id: "Work/Design", name: "Design", route: "nodes/Work/Design.html", parent: "Work", open: 1, total: 1, summary: "The look." },
  ],
}

/**
 * The sidebar as cudoc writes it: a title, then a list whose groups are `li.nav-group > details >
 * summary` (a link in the summary when the group is a page) and a list of its own.
 */
function sidebar(parent, items, current) {
  const list = parent.appendChild(new Element("ul"))
  for (const item of items) {
    const li = list.appendChild(new Element("li"))
    const link = (into) => {
      if (!item.href) { into.appendChild(new Element("span")).textContent = item.title; return }
      const a = into.appendChild(new Element("a")); a.textContent = item.title; a.href = item.href
      if (item.title === current) a.setAttribute("aria-current", "page")
    }
    if (!item.items) { link(li); continue }
    li.className = "nav-group"
    const details = li.appendChild(new Element("details")); details.state = item.open ?? true
    const summary = details.appendChild(new Element("summary")); link(summary); summary.textContent = item.title
    sidebar(details, item.items, current)
  }
}
const NAV = [
  { title: "홈", href: "index.html" },
  { title: "노드", open: true, items: [
    { title: "Work", href: "nodes/Work.html", items: [{ title: "Design", href: "nodes/Work/Design.html" }] },
    { title: "Play", href: "nodes/Play.html", items: [{ title: "Games", href: "nodes/Play/Games.html" }] },
  ] },
  { title: "보기", open: false, items: [{ title: "현황", href: "views/현황.html" }] },
]

/** Opens `href` as a page whose runtime script sits at `scriptSrc` (none for an inline script). */
function open(href, { scriptSrc = "https://memo.test/excudo-runtime.js", storage = {}, heading = "Page", data = index, nav = null, current, sections = [], width = 1280, cudocToggle = false, content, browser = {} } = {}) {
  const html = new Element("html"); html.lang = "ko"
  const body = html.appendChild(new Element("body"))
  // cudoc-export 1.1 writes its checkbox before the page; its button, backdrop and close are labels for it.
  if (cudocToggle) { const box = body.appendChild(new Element("input")); box.id = "cudoc-nav-toggle"; box.className = "cudoc-nav-toggle"; box.checked = false }
  if (nav) {
    const side = body.appendChild(new Element("nav")); side.className = "sidebar"
    const title = side.appendChild(new Element("p")); title.className = "nav-title"; title.textContent = "문서"
    sidebar(side, nav, current)
  }
  const main = body.appendChild(new Element("main"))
  const h1 = main.appendChild(new Element("h1")); h1.textContent = heading
  // The engine writes a page's sections folded.
  for (const title of sections) {
    const details = main.appendChild(new Element("details"))
    details.appendChild(new Element("summary")).textContent = title
  }
  content?.(main)
  const keys = []
  const document = { documentElement: html, body, title: `${heading} · Memo`, currentScript: scriptSrc ? { src: scriptSrc } : { src: "" },
    querySelector: (selector) => html.querySelector(selector), querySelectorAll: (selector) => html.querySelectorAll(selector), createElement: (tag) => new Element(tag),
    getElementById: (id) => html.all().find((element) => element.id === id) ?? null,
    addEventListener: (type, handler) => { if (type === "keydown") keys.push(handler) } }
  const window = { location: { href, pathname: new URL(href).pathname },
    matchMedia: (query) => ({ matches: query.includes("max-width: 768px") && width <= 768, addEventListener() {} }),
    localStorage: { getItem: (key) => (key in storage ? storage[key] : null), setItem: (key, value) => { storage[key] = String(value) } }, excudoMemo: data, ...browser }
  vm.runInNewContext(script, { window, document, URL, console }, { filename: "memo-runtime.js" })
  settle()
  const runtime = window.excudoMemoRuntime
  const search = (text) => { const input = main.querySelector("input.excudo-search"); input.value = text; input.fire("input"); return main.querySelectorAll("a.excudo-hit").map((hit) => [hit.textContent, hit.href]) }
  const summaryOf = (details) => details.querySelector(":scope > summary").textContent
  const folds = (place) => Object.fromEntries(html.querySelectorAll("details").filter((details) => Boolean(details.closest("main")) === (place === "main")).map((details) => [summaryOf(details), details.open]))
  /** The reader opens or closes one fold by its summary. */
  const toggle = (title, value) => { html.querySelectorAll("details").find((details) => summaryOf(details) === title).open = value; settle() }
  const click = (text) => { html.querySelectorAll("button").find((button) => button.textContent === text).fire("click"); settle() }
  const press = (key) => keys.forEach((handler) => handler({ key }))
  const kept = (key) => storage[`excudo-memo:t:${key}`] === undefined ? undefined : JSON.parse(storage[`excudo-memo:t:${key}`])
  return { runtime, html, body, main, storage, search, folds, toggle, click, press, kept, last: () => JSON.parse(storage["excudo-memo:t:last"]) }
}

test("the runtime knows a view and a journal page by their route from the site's root, so links from them lead up and over", () => {
  const view = open("https://memo.test/views/%ED%98%84%ED%99%A9.html", { heading: "현황" })
  assert.equal(view.runtime.page, "views/현황.html")
  assert.equal(view.runtime.home, false)
  assert.equal(view.runtime.href("nodes/Work.html"), "../nodes/Work.html")
  assert.deepEqual(view.search("work"), [["Work", "../nodes/Work.html"]])
  assert.deepEqual(view.search("the"), [["Design", "../nodes/Work/Design.html"]], "the summary is searched too")
  assert.deepEqual(view.last(), { route: "views/현황.html", title: "현황" })
  const journal = open("https://memo.test/journals/2026-10-20.html", { heading: "2026-10-20" })
  assert.equal(journal.runtime.page, "journals/2026-10-20.html")
  assert.deepEqual(journal.search("design"), [["Design", "../nodes/Work/Design.html"]])
  assert.deepEqual(journal.last(), { route: "journals/2026-10-20.html", title: "2026-10-20" })
  const nested = open("https://memo.test/nodes/Work/Design.html", { heading: "Design" })
  assert.deepEqual(nested.search("current"), [["Work", "../Work.html"]])
})

test("Home opened at the root address or by its file name shows where the reader left off and remembers itself as Home", () => {
  for (const href of ["https://memo.test/", "https://memo.test/index.html"]) {
    const storage = { "excudo-memo:t:last": JSON.stringify({ route: "nodes/Work.html", title: "Work" }) }
    const home = open(href, { storage, heading: "홈" })
    assert.equal(home.runtime.page, "index.html", href)
    assert.equal(home.runtime.home, true, href)
    const again = home.main.querySelector("p.excudo-last")
    assert.ok(again, `a continue link on ${href}`)
    assert.deepEqual([again.firstChild.textContent, again.firstChild.href], ["이어 보기: Work", "nodes/Work.html"])
    assert.deepEqual(home.last(), { route: "index.html", title: "홈 · Memo" })
  }
  const fresh = open("https://memo.test/", { heading: "홈" })
  assert.equal(fresh.main.querySelector("p.excudo-last"), null, "nothing to continue on a first visit")
})

test("a single page with the script inline is its own route", () => {
  const page = open("file:///tmp/memo/%ED%99%88.html", { scriptSrc: null, heading: "홈", data: { ...index, home: "홈.html", mode: "standalone" } })
  assert.equal(page.runtime.page, "홈.html")
  assert.equal(page.runtime.home, true)
})

test("on a narrow screen the list starts folded, its own buttons fold or unfold it all, and a default is not taken for a choice", () => {
  const storage = {}
  const phone = open("https://memo.test/nodes/Work/Design.html", { storage, heading: "Design", nav: NAV, current: "Design", width: 390 })
  assert.deepEqual(phone.folds("nav"), { 노드: false, Work: false, Play: false, 보기: false }, "folded, even on the way to this page")
  assert.equal(phone.kept("folds:nav:narrow"), undefined, "the runtime's own folding is not remembered")
  const side = phone.html.querySelector("nav.sidebar")
  assert.deepEqual(side.children.map((child) => child.className || child.tagName), ["nav-title", "excudo-nav-tools", "UL"], "the buttons sit under the list's title")
  assert.deepEqual(side.querySelectorAll("button").map((button) => button.textContent), ["모두 펼치기", "모두 접기", "닫기"])
  phone.click("모두 펼치기")
  assert.deepEqual(phone.folds("nav"), { 노드: true, Work: true, Play: true, 보기: true })
  const next = open("https://memo.test/nodes/Play.html", { storage, heading: "Play", nav: NAV, current: "Play", width: 390 })
  assert.deepEqual(next.folds("nav"), { 노드: true, Work: true, Play: true, 보기: true }, "what the reader unfolded stays unfolded")
  next.click("모두 접기")
  next.toggle("노드", true)
  const third = open("https://memo.test/index.html", { storage, heading: "홈", nav: NAV, width: 390 })
  assert.deepEqual(third.folds("nav"), { 노드: true, Work: false, Play: false, 보기: false })
  // A wide screen keeps its own folds and is not touched by the phone's.
  const wide = open("https://memo.test/index.html", { storage, heading: "홈", nav: NAV })
  assert.deepEqual(wide.folds("nav"), { 노드: true, Work: false, Play: false, 보기: false })
})

test("on a wide screen the top groups stay as written and only the way to this page is open, with the reader's choices on top", () => {
  const storage = {}
  const design = open("https://memo.test/nodes/Work/Design.html", { storage, heading: "Design", nav: NAV, current: "Design" })
  assert.deepEqual(design.folds("nav"), { 노드: true, Work: true, Play: false, 보기: false })
  assert.equal(design.kept("folds:nav:wide"), undefined)
  design.toggle("Play", true)
  design.toggle("Work", false)
  const games = open("https://memo.test/nodes/Play/Games.html", { storage, heading: "Games", nav: NAV, current: "Games" })
  assert.deepEqual(games.folds("nav"), { 노드: true, Work: false, Play: true, 보기: false }, "the reader's choices hold on the next page")
  const back = open("https://memo.test/nodes/Work/Design.html", { storage, heading: "Design", nav: NAV, current: "Design" })
  assert.equal(back.folds("nav").Work, true, "the way to this page opens even where the reader folded it")
  back.click("모두 접기")
  assert.deepEqual(back.folds("nav"), { 노드: false, Work: false, Play: false, 보기: false })
  assert.deepEqual({ ...back.runtime.navFolds() }, { 노드: false, Work: false, Play: false, 보기: false })
})

test("a page's sections start folded and open again where the reader opened them on that page, with no buttons of their own", () => {
  const storage = {}
  const home = open("https://memo.test/", { storage, heading: "홈", nav: NAV, sections: ["대기", "확인"] })
  assert.deepEqual(home.folds("main"), { 대기: false, 확인: false })
  assert.deepEqual(home.main.querySelectorAll("button").map((button) => button.textContent), [], "the page has no fold buttons")
  home.toggle("대기", true)
  const work = open("https://memo.test/nodes/Work.html", { storage, heading: "Work", nav: NAV, current: "Work", sections: ["대기"] })
  assert.deepEqual(work.folds("main"), { 대기: false }, "a section of the same name on another page is its own")
  assert.deepEqual(open("https://memo.test/index.html", { storage, heading: "홈", nav: NAV, sections: ["대기", "확인"] }).folds("main"), { 대기: true, 확인: false })
})

test("on a narrow screen a floating button opens the list as a panel, and it closes by its button, a tap beside it, Escape or a link", () => {
  const phone = open("https://memo.test/nodes/Work/Design.html", { heading: "Design", nav: NAV, current: "Design", width: 390 })
  const fab = phone.body.querySelector("button.excudo-nav-fab")
  const backdrop = phone.body.querySelector("div.excudo-backdrop")
  const side = phone.html.querySelector("nav.sidebar")
  assert.ok(fab && backdrop, "the button and the backdrop are on the page")
  assert.deepEqual([fab.getAttribute("aria-controls"), fab.getAttribute("aria-expanded"), fab.getAttribute("aria-label")], [side.id, "false", "메뉴"])
  assert.equal(phone.html.classList.contains("excudo-js"), true)
  const opened = () => [phone.runtime.listOpen(), backdrop.hidden, fab.getAttribute("aria-expanded")]
  fab.fire("click")
  assert.deepEqual(opened(), [true, false, "true"])
  assert.equal(focused.textContent, "홈", "with the way to this page folded, the list's first line takes the focus")
  phone.click("닫기")
  phone.toggle("노드", true); phone.toggle("Work", true)
  fab.fire("click")
  assert.equal(focused.textContent, "Design", "this page's line takes it once the list shows it")
  phone.click("닫기")
  assert.deepEqual(opened(), [false, true, "false"])
  assert.equal(focused, fab, "the focus goes back to the button")
  fab.fire("click"); backdrop.fire("click")
  assert.equal(phone.runtime.listOpen(), false, "a tap beside the panel closes it")
  fab.fire("click"); phone.press("Escape")
  assert.equal(phone.runtime.listOpen(), false, "Escape closes it")
  fab.fire("click")
  side.fire("click", { target: side.querySelector("a") })
  assert.equal(phone.runtime.listOpen(), false, "following a link closes it")
  assert.deepEqual(side.querySelectorAll("button").map((button) => button.textContent), ["모두 펼치기", "모두 접기", "닫기"], "the panel's buttons sit together")
})

test("with cudoc-export 1.1's own floating panel the runtime draws none of its own and adds Escape, a followed link and the focus", () => {
  const phone = open("https://memo.test/nodes/Work/Design.html", { heading: "Design", nav: NAV, current: "Design", width: 390, cudocToggle: true })
  const box = phone.body.querySelector("input.cudoc-nav-toggle")
  const side = phone.html.querySelector("nav.sidebar")
  assert.equal(phone.body.querySelector("button.excudo-nav-fab"), null, "no second button")
  assert.equal(phone.body.querySelector("div.excudo-backdrop"), null)
  assert.deepEqual(side.querySelectorAll("button").map((button) => button.textContent), ["모두 펼치기", "모두 접기"], "cudoc's panel has its own close")
  box.checked = true; box.fire("change")
  assert.equal(phone.runtime.listOpen(), true)
  assert.equal(focused.textContent, "홈", "the list's first line takes the focus while this page's way is folded")
  phone.press("Escape")
  assert.deepEqual([box.checked, focused], [false, box], "Escape closes it and the focus goes back to its checkbox")
  box.checked = true; box.fire("change")
  side.fire("click", { target: side.querySelector("a") })
  assert.equal(box.checked, false, "following a link closes it")
})

/*
 * Choosing a task's state on the page. The page has the tasks as the engine writes them (a checkbox,
 * then the state with the address of its line), and a browser whose requests and timers the test
 * answers by hand.
 */
const TASKS = [
  { page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", state: "TODO", text: "Write the plan" },
  { page: "notes/Work.md", line: 4, hash: "bbbbbbbbbb", state: "DONE", text: "Read the brief" },
  { page: "notes/Work.md", line: 5, hash: "cccccccccc", state: "CANCELED", text: "Old idea" },
]
const withInbox = { ...index, inbox: { endpoint: "api/edit", sync: "api/sync" }, applied: [] }
function taskPage({ href = "https://memo.test/nodes/Work.html", heading = "Work", storage = {}, data = withInbox, ready = true, answer = () => ({ ok: true, issue: 7 }), tasks = TASKS, state = () => ({ changes: [], appliedAt: null, sync: null }), asked = () => ({ ok: true, issue: 20, at: "2026-10-28T10:00:00Z" }), gate = null } = {}) {
  const requests = []
  const timers = []
  const browser = {
    setTimeout: (run) => { timers.push(run); return timers.length },
    clearTimeout: (id) => { timers[id - 1] = null },
    fetch: (url, init = {}) => {
      requests.push({ url, method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
      if (!init.method) {
        const held = ready && url.endsWith("?view=state") ? state() : {}
        if (held === null) return Promise.resolve({ ok: false, status: 502 })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ inbox: true, ready, ...held }) })
      }
      if (url.endsWith("api/sync")) { const reply = asked(); return Promise.resolve(reply ? { ok: true, json: () => Promise.resolve(reply) } : { ok: false, status: 502 }) }
      const reply = answer(JSON.parse(init.body))
      const response = reply ? { ok: true, json: () => Promise.resolve(reply) } : { ok: false, status: 502 }
      return gate ? gate.then(() => response) : Promise.resolve(response)
    },
  }
  const content = (main) => {
    const list = main.appendChild(new Element("ul"))
    for (const task of tasks) {
      const li = list.appendChild(new Element("li"))
      const box = li.appendChild(new Element("input")); box.setAttribute("type", "checkbox"); box.checked = task.state === "DONE"; box.disabled = true
      const span = li.appendChild(new Element("span")); span.className = `excudo-task excudo-${task.state.toLowerCase()}`; span.textContent = task.state
      for (const [name, value] of Object.entries({ page: task.page, line: task.line, hash: task.hash, state: task.state })) span.setAttribute(`data-excudo-${name}`, value)
    }
  }
  const page = open(href, { heading, storage, data, content, browser })
  const spans = () => page.main.querySelectorAll("span.excudo-task")
  const boxes = () => page.main.querySelectorAll("input[type=\"checkbox\"]")
  const wait = () => new Promise((resolve) => setImmediate(resolve))
  /** The timers fire now; the answers come when the test waits. */
  const fire = () => { for (const run of timers.splice(0)) run?.() }
  const later = async () => { await wait(); fire(); await wait() }
  const choose = (n, state) => { spans()[n].fire("click"); page.main.querySelectorAll("button").find((button) => button.textContent === state).fire("click") }
  const status = () => page.body.querySelector("div.excudo-outbox")
  /** What the status line says, without its button. */
  const said = () => status().querySelector("span").textContent
  // The runtime's arrays come from the page's realm; a copy compares as plain data.
  const outbox = () => JSON.parse(JSON.stringify(page.runtime.outbox()))
  return { ...page, requests, spans, boxes, wait, fire, later, choose, status, said, outbox }
}

test("without an inbox a task's state is only shown, and the page asks nothing of anyone", async () => {
  const page = taskPage({ data: index })
  await page.wait()
  assert.equal(page.requests.length, 0)
  assert.equal(page.spans()[0].getAttribute("role"), null)
  assert.equal(page.status(), null)
  assert.equal(page.runtime.editable(), false)
})

test("when the inbox says it is not ready the states stay as they are, but a change kept from before is still shown", async () => {
  const entry = { id: "kept-0001", kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "TODO", to: "DOING", at: "2026-10-28T01:00:00.000Z" }
  const page = taskPage({ ready: false, storage: { "excudo-memo:t:outbox": JSON.stringify({ entries: [entry] }) } })
  await page.wait()
  assert.deepEqual(page.requests.map((request) => [request.method, request.url, request.headers["x-excudo-edit"]]), [["GET", "https://memo.test/api/edit?view=state", "1"]])
  assert.equal(page.runtime.editable(), false)
  assert.equal(page.spans()[0].getAttribute("role"), null)
  assert.equal(page.spans()[0].textContent, "DOING", "the kept change shows")
  assert.ok(page.spans()[0].classList.contains("excudo-pending"))
  assert.equal(page.said(), "메모 반영 대기 1개")
})

test("a task let go shows its box ticked, and unticking it opens the task again", async () => {
  const page = taskPage()
  await page.wait()
  page.choose(0, "CANCELED")
  assert.deepEqual([page.spans()[0].textContent, page.boxes()[0].checked], ["CANCELED", true])
  assert.equal(page.boxes()[2].checked, true, "a task built as CANCELED shows its box ticked too")
  page.boxes()[2].checked = false
  page.boxes()[2].fire("change")
  assert.equal(page.spans()[2].textContent, "TODO")
  assert.deepEqual(page.outbox().map(({ from, to }) => [from, to]), [["TODO", "CANCELED"], ["CANCELED", "TODO"]])
})

test("a state chosen on the page shows at once, waits on this device, and goes to the inbox as one change for its line", async () => {
  const page = taskPage()
  await page.wait()
  assert.equal(page.runtime.editable(), true)
  const [plan, brief, old] = page.spans()
  assert.deepEqual([plan.getAttribute("role"), plan.getAttribute("aria-haspopup"), brief.getAttribute("role")], ["button", "menu", "button"])
  assert.equal(old.getAttribute("role"), "button", "a task let go can be opened again")
  plan.fire("click")
  const menu = page.main.querySelector("span.excudo-states")
  assert.deepEqual(menu.querySelectorAll("button").map((button) => [button.textContent, button.getAttribute("aria-checked")]),
    [["TODO", "true"], ["DOING", "false"], ["WAITING", "false"], ["DONE", "false"], ["CANCELED", "false"]])
  menu.querySelectorAll("button")[1].fire("click")
  assert.equal(page.main.querySelector("span.excudo-states"), null, "choosing closes the menu")
  assert.deepEqual([plan.textContent, plan.className], ["DOING", "excudo-task excudo-doing excudo-pending"])
  assert.equal(plan.getAttribute("aria-label"), "상태 바꾸기: DOING, 메모 반영 대기")
  page.choose(0, "WAITING")
  assert.equal(page.outbox().length, 1, "choosing again before it is sent moves the same change")
  assert.deepEqual(page.outbox().map(({ from, to }) => [from, to]), [["TODO", "WAITING"]])
  assert.equal(page.kept("outbox").entries.length, 1, "it waits in this device's storage")
  assert.equal(page.said(), "메모 반영 대기 1개")
  await page.later()
  const sent = page.requests.filter((request) => request.method === "POST")
  assert.equal(sent.length, 1)
  assert.deepEqual([sent[0].url, sent[0].headers["x-excudo-edit"], sent[0].headers["content-type"]], ["https://memo.test/api/edit", "1", "application/json"])
  assert.deepEqual(Object.keys(sent[0].body), ["format", "version", "site", "entries"])
  assert.deepEqual([sent[0].body.format, sent[0].body.version, sent[0].body.site], ["excudo-changes", 1, "t"])
  const [change] = sent[0].body.entries
  assert.deepEqual({ ...change, id: undefined, at: undefined }, { id: undefined, kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "TODO", to: "WAITING", at: undefined })
  assert.match(change.id, /^[A-Za-z0-9_-]{8,40}$/)
  assert.equal(page.outbox()[0].sent, 7, "the issue it went in")
  assert.ok(plan.classList.contains("excudo-pending"), "it waits until the memo has it")
  page.choose(0, "DONE")
  assert.equal(page.outbox().length, 2, "a change after one already sent is a new change, from the state that one leaves")
  assert.deepEqual(page.outbox()[1].from, "WAITING")
})

test("going back to the state the memo has drops the change, and the checkbox chooses DONE or TODO", async () => {
  const page = taskPage()
  await page.wait()
  page.choose(0, "DOING")
  page.choose(0, "TODO")
  assert.equal(page.outbox().length, 0)
  assert.deepEqual([page.spans()[0].textContent, page.spans()[0].className], ["TODO", "excudo-task excudo-todo"])
  const [planBox, briefBox] = page.boxes()
  assert.equal(planBox.disabled, false)
  planBox.checked = true; planBox.fire("change")
  briefBox.checked = false; briefBox.fire("change")
  assert.deepEqual(page.outbox().map(({ line, from, to }) => [line, from, to]), [[3, "TODO", "DONE"], [4, "DONE", "TODO"]])
  assert.equal(page.spans()[0].textContent, "DONE")
  page.choose(1, "DOING")
  assert.equal(briefBox.checked, false, "the checkbox follows the state")
  await page.later()
  assert.equal(page.requests.filter((request) => request.method === "POST")[0].body.entries.length, 2, "changes chosen within a moment go together")
})

test("a change the memo has is let go: by its id in the website, or by the state the page now shows", async () => {
  const entries = [
    { id: "applied-01", kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "TODO", to: "DOING", at: "2026-10-28T01:00:00.000Z", sent: 3 },
    { id: "shown-0001", kind: "task", page: "notes/Work.md", line: 4, hash: "bbbbbbbbbb", from: "TODO", to: "DONE", at: "2026-10-28T01:00:00.000Z", sent: 3 },
    { id: "waits-0001", kind: "task", page: "notes/Elsewhere.md", line: 9, hash: "dddddddddd", from: "TODO", to: "DONE", at: "2026-10-28T01:00:00.000Z", sent: 3 },
  ]
  const page = taskPage({ data: { ...withInbox, applied: ["applied-01"] }, storage: { "excudo-memo:t:outbox": JSON.stringify({ entries }) } })
  await page.wait()
  assert.deepEqual(page.outbox().map((entry) => entry.id), ["waits-0001"], "a sent change of another page still waits")
  assert.equal(page.spans()[0].textContent, "TODO", "the page shows what the memo has")
  assert.equal(page.said(), "메모 반영 대기 1개")
  await page.later()
  assert.equal(page.requests.filter((request) => request.method === "POST").length, 0, "nothing is sent twice")
})

test("a change the inbox did not take stays, says so, and goes again when the reader asks", async () => {
  let up = false
  const page = taskPage({ answer: () => (up ? { ok: true, issue: 9 } : null) })
  await page.wait()
  page.choose(0, "DOING")
  await page.later()
  assert.equal(page.said(), "보내지 못함: 눌러서 다시 보내기")
  assert.ok(page.status().classList.contains("excudo-failed"))
  assert.equal(page.outbox()[0].sent, undefined)
  up = true
  page.status().fire("click")
  await page.wait(); await page.wait()
  assert.equal(page.outbox()[0].sent, 9)
  assert.equal(page.said(), "메모 반영 대기 1개")
  assert.equal(page.requests.filter((request) => request.method === "POST").length, 2)
})

test("going back on a change already sent waits for the memo, also after the page is opened again", async () => {
  const storage = {}
  const first = taskPage({ storage })
  await first.wait()
  first.choose(0, "DOING")
  await first.later()
  first.choose(0, "TODO")
  assert.deepEqual(first.outbox().map(({ from, to, sent }) => [from, to, Boolean(sent)]), [["TODO", "DOING", true], ["DOING", "TODO", false]])
  // Opened again before the memo has either: the page still shows TODO, as it was built.
  const again = taskPage({ storage })
  await again.wait()
  assert.deepEqual(again.outbox().map(({ from, to }) => [from, to]), [["TODO", "DOING"], ["DOING", "TODO"]], "the later change waits for the earlier one")
  assert.ok(again.spans()[0].classList.contains("excudo-pending"))
  await again.later()
  const sent = again.requests.filter((request) => request.method === "POST")
  assert.deepEqual(sent.flatMap((request) => request.body.entries.map(({ from, to }) => [from, to])), [["DOING", "TODO"]])
  // Once the memo has both, the website names them and the page lets them go.
  const ids = again.outbox().map((entry) => entry.id)
  const settled = taskPage({ storage, data: { ...withInbox, applied: ids } })
  await settled.wait()
  assert.deepEqual(settled.outbox(), [])
})

test("pages open side by side share the waiting list: none drops another's change, and a change being sent is not changed", async () => {
  const storage = {}
  const a = taskPage({ storage })
  const b = taskPage({ storage })
  await a.wait(); await b.wait()
  a.choose(0, "DOING")
  b.choose(1, "TODO")
  assert.deepEqual(a.kept("outbox").entries.map(({ line, to }) => [line, to]), [[3, "DOING"], [4, "TODO"]], "both wait")
  a.fire()
  b.choose(0, "WAITING")
  const waiting = b.kept("outbox").entries.filter((entry) => entry.line === 3)
  assert.deepEqual(waiting.map(({ from, to }) => [from, to]), [["TODO", "DOING"], ["DOING", "WAITING"]], "the change a is sending stays as it went")
  await a.wait(); await a.wait()
  assert.deepEqual(a.requests.filter((request) => request.method === "POST").map((request) => request.body.entries.map(({ line, to }) => [line, to])), [[[3, "DOING"], [4, "TODO"]]])
  await b.later()
  assert.deepEqual(b.requests.filter((request) => request.method === "POST").map((request) => request.body.entries.map(({ line, from, to }) => [line, from, to])), [[[3, "DOING", "WAITING"]]])
  assert.ok(b.kept("outbox").entries.every((entry) => entry.sent && entry.sending === undefined))
})

/*
 * What the inbox holds, as its function answers `?view=state`: changes of every device, open until the
 * memo takes them, applied once it took them all, closed when it noted one to settle.
 */
const held = (id, line, hash, from, to, state, issue = 5) => ({ id, kind: "task", page: "notes/Work.md", line, hash, from, to, at: "2026-10-28T01:00:00.000Z", issue, state })

test("a state chosen on another device shows here too, and a choice here goes on from it", async () => {
  const page = taskPage({ state: () => ({ changes: [held("other-0001", 3, "aaaaaaaaaa", "TODO", "DOING", "open")], appliedAt: null, sync: null }) })
  await page.wait(); await page.wait()
  assert.deepEqual([page.spans()[0].textContent, page.spans()[0].className], ["DOING", "excudo-task excudo-doing excudo-pending"])
  assert.equal(page.said(), "메모 반영 대기 1개", "the other device's change waits for the memo")
  page.choose(0, "WAITING")
  assert.deepEqual(page.outbox().map(({ from, to }) => [from, to]), [["DOING", "WAITING"]], "it starts from the state the other device chose")
  assert.equal(page.said(), "메모 반영 대기 2개")
})

test("what the memo took since the page was built shows as taken, until a build names it", async () => {
  const kept = { id: "mine-00001", kind: "task", page: "notes/Work.md", line: 4, hash: "bbbbbbbbbb", from: "DONE", to: "TODO", at: "2026-10-28T01:00:00.000Z", sent: 6 }
  const lost = { id: "lost-00001", kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "TODO", to: "DONE", at: "2026-10-28T01:00:00.000Z", sent: 7 }
  const changes = [held("mine-00001", 4, "bbbbbbbbbb", "DONE", "TODO", "applied", 6), held("lost-00001", 3, "aaaaaaaaaa", "TODO", "DONE", "closed", 7)]
  const page = taskPage({ storage: { "excudo-memo:t:outbox": JSON.stringify({ entries: [kept, lost] }) }, state: () => ({ changes, appliedAt: "2026-10-28T01:05:00Z", sync: null }) })
  await page.wait(); await page.wait()
  assert.deepEqual(page.outbox(), [], "the memo took one and noted the other to settle: neither waits")
  assert.deepEqual([page.spans()[1].textContent, page.spans()[1].className], ["TODO", "excudo-task excudo-todo excudo-applied"])
  assert.equal(page.spans()[1].getAttribute("aria-label"), "상태 바꾸기: TODO, 메모에 반영됨")
  assert.deepEqual([page.spans()[0].textContent, page.spans()[0].className], ["TODO", "excudo-task excudo-todo"], "nothing is guessed for the one noted to settle")
  assert.equal(page.status().hidden, true, "nothing waits")
  const rebuilt = taskPage({ data: { ...withInbox, applied: ["mine-00001"] }, state: () => ({ changes, sync: null }) })
  await rebuilt.wait(); await rebuilt.wait()
  assert.equal(rebuilt.spans()[1].className, "excudo-task excudo-done", "a build that has it shows the page as built")
})

test("a change waiting after one the memo took but the page does not show yet is kept", async () => {
  const back = { id: "back-00001", kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "DOING", to: "TODO", at: "2026-10-28T01:00:00.000Z" }
  const page = taskPage({ storage: { "excudo-memo:t:outbox": JSON.stringify({ entries: [back] }) }, state: () => ({ changes: [held("went-00001", 3, "aaaaaaaaaa", "TODO", "DOING", "applied")], sync: null }) })
  await page.wait(); await page.wait()
  assert.deepEqual(page.outbox().map((entry) => entry.id), ["back-00001"], "the page still shows TODO, but the memo is at DOING")
  assert.deepEqual([page.spans()[0].textContent, page.spans()[0].className], ["TODO", "excudo-task excudo-todo excudo-pending"])
})

test("bring in now sends what waits here, then asks the owner's machine to take it, once", async () => {
  let sync = null
  const page = taskPage({ state: () => ({ changes: [], sync }), asked: () => { sync = { issue: 20, at: "2026-10-28T10:00:00Z" }; return { ok: true, ...sync } } })
  await page.wait(); await page.wait()
  const button = page.status().querySelector("button")
  assert.equal(button.textContent, "지금 반영")
  page.choose(0, "DOING")
  assert.equal(button.hidden, false, "it is offered while something waits")
  page.runtime.ask()
  await page.wait(); await page.wait(); await page.wait()
  const posts = page.requests.filter((request) => request.method === "POST").map((request) => request.url)
  assert.deepEqual(posts, ["https://memo.test/api/edit", "https://memo.test/api/sync"], "the change first, then the request")
  assert.equal(page.said(), "메모 반영 대기 1개 · 반영 요청함")
  assert.equal(button.hidden, true, "not offered again while the request is open")
  page.runtime.ask()
  await page.wait()
  assert.equal(page.requests.filter((request) => request.url.endsWith("api/sync")).length, 1, "not asked again while the request is open")
})

test("a request the function did not take says so and goes again when the reader taps", async () => {
  let up = false
  const page = taskPage({ asked: () => (up ? { ok: true, issue: 21, at: "2026-10-28T10:00:00Z" } : null) })
  await page.wait(); await page.wait()
  page.choose(0, "DOING")
  await page.later()
  page.runtime.ask()
  await page.wait(); await page.wait()
  assert.equal(page.said(), "요청하지 못함: 눌러서 다시 요청")
  up = true
  page.status().fire("click")
  await page.wait(); await page.wait()
  assert.equal(page.said(), "메모 반영 대기 1개 · 반영 요청함")
})

test("bring in now waits for a change still being sent, by this page or by another, before it asks", async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const storage = {}
  const page = taskPage({ storage, gate })
  await page.wait(); await page.wait()
  page.choose(0, "DOING")
  page.fire()
  page.runtime.ask()
  await page.wait()
  const urls = () => page.requests.filter((request) => request.method === "POST").map((request) => request.url.replace("https://memo.test/", ""))
  assert.deepEqual(urls(), ["api/edit"], "the request waits while the change is on its way")
  release()
  await page.wait(); await page.wait(); await page.wait()
  assert.deepEqual(urls(), ["api/edit", "api/sync"], "then it asks")

  // Another page is sending a change of this device: this page waits for it, without asking itself again and again.
  const other = { id: "other-sent", kind: "task", page: "notes/Work.md", line: 4, hash: "bbbbbbbbbb", from: "DONE", to: "TODO", at: "2026-10-28T01:00:00.000Z", sending: Date.now() + 30000 }
  const after = { ...other, id: "after-0001", from: "TODO", to: "DOING", sending: undefined }
  const shared = { "excudo-memo:t:outbox": JSON.stringify({ entries: [other, after] }) }
  const second = taskPage({ storage: shared })
  await second.wait(); await second.wait()
  second.runtime.ask()
  await second.wait()
  assert.equal(second.requests.filter((request) => request.method === "POST").length, 0, "nothing goes while an earlier change of the line is being sent elsewhere")
  const entries = JSON.parse(shared["excudo-memo:t:outbox"]).entries
  entries[0].sent = 9; delete entries[0].sending
  shared["excudo-memo:t:outbox"] = JSON.stringify({ entries })
  await second.later(); await second.later()
  const sent = second.requests.filter((request) => request.method === "POST").map((request) => request.url.replace("https://memo.test/", ""))
  assert.deepEqual(sent, ["api/edit", "api/sync"], "once it went, the page sends its own and asks")
})

test("a page that could not ask the inbox asks again later while something waits", async () => {
  let down = false
  const page = taskPage({ state: () => (down ? null : { changes: [held("other-0002", 3, "aaaaaaaaaa", "TODO", "DOING", "open")], sync: null }) })
  await page.wait(); await page.wait()
  const looks = () => page.requests.filter((request) => request.url.endsWith("?view=state")).length
  assert.equal(looks(), 1)
  down = true
  await page.later()
  assert.equal(looks(), 2, "it asked and failed")
  down = false
  await page.later()
  assert.equal(looks(), 3, "it asks again after a failure")
  assert.equal(page.said(), "메모 반영 대기 1개")
})

test("bring in now asks once every change reached the inbox, also when two pages were sending at once", async () => {
  const storage = {}
  let releaseA, releaseB
  const a = taskPage({ storage, gate: new Promise((resolve) => { releaseA = resolve }) })
  const b = taskPage({ storage, gate: new Promise((resolve) => { releaseB = resolve }) })
  await a.wait(); await b.wait(); await a.wait(); await b.wait()
  a.choose(0, "DOING"); a.fire()
  b.choose(1, "TODO"); b.fire()
  b.runtime.ask()
  releaseB()
  await b.later(); await b.later()
  const syncs = () => b.requests.filter((request) => request.url.endsWith("api/sync")).length
  assert.equal(syncs(), 0, "a's change is still on its way")
  releaseA()
  await a.wait(); await a.wait()
  await b.later(); await b.later()
  assert.equal(syncs(), 1, "then b asks, once")
  assert.ok(JSON.parse(storage["excudo-memo:t:outbox"]).entries.every((entry) => entry.sent))
})

test("a page whose first question to the inbox failed asks again, and offers the choice once it answers", async () => {
  let calls = 0
  const page = taskPage({ state: () => (++calls === 1 ? null : { changes: [], sync: null }) })
  await page.wait(); await page.wait()
  assert.equal(page.runtime.editable(), false, "no answer yet")
  const looks = () => page.requests.filter((request) => request.url.endsWith("?view=state")).length
  await page.later()
  assert.equal(looks(), 2, "it asked again")
  assert.equal(page.runtime.editable(), true, "and offers the choice once the inbox answers")
  const down = taskPage({ ready: true, state: () => null })
  await down.wait()
  await down.later(); await down.later()
  assert.ok(down.requests.filter((request) => request.url.endsWith("?view=state")).length >= 3, "it keeps asking while the inbox does not answer")
})

test("GitHub errors and deadlines retry even when nothing waits, then enable the page after recovery", async () => {
  for (const error of ["github", "github-timeout"]) {
    let failed = true
    const page = taskPage({ state: () => failed ? { error } : { changes: [], sync: null } })
    await page.wait(); await page.wait()
    assert.equal(page.runtime.editable(), false)
    assert.equal(page.said(), "받는 곳 연결 불가: 나중에 다시 확인")
    assert.equal(page.status().hidden, false)
    const looks = () => page.requests.filter((request) => request.url.endsWith("?view=state")).length
    const before = looks()
    await page.later()
    assert.equal(looks(), before + 1, `${error} is retried with no pending changes`)
    failed = false
    await page.later()
    assert.equal(page.runtime.editable(), true)
    assert.equal(page.status().hidden, true)
    const answered = looks()
    await page.later()
    assert.equal(looks(), answered, "ordinary polling stops again after recovery")
  }
})

/*
 * Home's dashboard: the sections the index carries, drawn on Home only, each a fold that keeps its
 * state by its place, whatever numbers its title line shows.
 */
const DASHBOARD = { at: "2026-10-29T06:00:00.000Z", sections: [
  { type: "links", title: "업무", open: true, items: [{ title: "Tracker", url: "https://tracker.example/board", icon: "T" }, { title: "Docs", url: "https://docs.example/" }, { title: "Bad", url: "javascript:alert(1)" }] },
  { type: "notes", open: true, data: { page: "Board.md", name: "Board", route: "nodes/Board.html", text: "- First thing\n\t- under it", hash: "748bf705" } },
  { type: "tasks", open: true, data: { counts: { doing: 2, todo: 5, waiting: 1 }, overdue: 1, nodes: [{ name: "Work", route: "nodes/Work.html", open: 4 }, { name: "Play", route: "nodes/Play.html", open: 2 }] } },
  { type: "done", open: false, data: { weeks: [{ from: "2026-10-20", n: 5 }, { from: "2026-10-27", n: 7 }] } },
  { type: "agents", open: false, data: null },
  { type: "runs", open: false, data: { steps: [{ step: "Sources", status: "failed", at: "2026-10-29T02:00:00.000Z" }, { step: "Backup", status: "ok", at: "2026-10-29T01:00:00.000Z" }] } },
] }

test("Home opens with its dashboard: links to a new tab, numbers on each title line, and folds kept by their place", async () => {
  const storage = {}
  const home = taskPage({ href: "https://memo.test/index.html", heading: "홈", storage, data: { ...withInbox, dashboard: DASHBOARD }, tasks: [] })
  await home.wait()
  const board = home.main.querySelector("section.excudo-dash")
  assert.ok(board, "Home shows the dashboard")
  assert.equal(home.main.children.indexOf(board) > home.main.children.indexOf(home.main.querySelector("h1")), true, "below the title")
  const folds = board.querySelectorAll("details.excudo-dash-section")
  assert.deepEqual(folds.map((fold) => [fold.querySelector("span.excudo-dash-title").textContent, fold.querySelector("span.excudo-dash-line").textContent, fold.open]), [
    ["업무", "2", true], ["메모장", "", true], ["할 일", "진행 중 2 · 할 일 5 · 대기 1", true], ["완료 추이", "이번 주 7 · 지난주 5", false],
    ["에이전트", "기록 없음", false], ["자동화", "실패 1", false],
  ])
  const links = board.querySelectorAll("a.excudo-link")
  assert.deepEqual(links.map((link) => [link.href, link.target, link.rel]), [["https://tracker.example/board", "_blank", "noopener noreferrer"], ["https://docs.example/", "_blank", "noopener noreferrer"]], "only web addresses become links")
  assert.deepEqual(board.querySelectorAll("a.excudo-bar-label").map((link) => [link.textContent, link.href]), [["Work", "nodes/Work.html"], ["Play", "nodes/Play.html"]])
  assert.ok(folds[5].classList.contains("excudo-dash-alert"), "a failed step is marked")
  assert.equal(board.querySelector("p.excudo-dash-at").textContent.startsWith("기준: 10/29"), true)
  // The reader closes the task fold; the next build shows other numbers, and the fold stays closed.
  folds[2].open = false
  settle()
  const numbers = { ...DASHBOARD, sections: DASHBOARD.sections.map((section) => section.type === "tasks" ? { ...section, data: { ...section.data, counts: { doing: 0, todo: 1, waiting: 0 } } } : section) }
  const again = taskPage({ href: "https://memo.test/index.html", heading: "홈", storage, data: { ...withInbox, dashboard: numbers }, tasks: [] })
  await again.wait()
  assert.equal(again.main.querySelectorAll("details.excudo-dash-section")[2].open, false)
  const node = taskPage({ storage: {}, data: { ...withInbox, dashboard: DASHBOARD } })
  await node.wait()
  assert.equal(node.main.querySelector("section.excudo-dash"), null, "another page has no dashboard")
})

test("a group is one fold: its parts under their titles, and its title line adding up the links or gathering each part's first number", async () => {
  const [links, , tasks, done, agents, runs] = DASHBOARD.sections
  const grouped = { at: DASHBOARD.at, sections: [
    { type: "group", title: "링크", open: true, sections: [{ ...links, open: undefined }, { type: "links", title: "개인", items: [{ title: "Code", url: "https://code.example/" }] }] },
    { type: "group", title: "통계", open: false, sections: [tasks, done, agents, runs].map((part) => ({ ...part, open: undefined })) },
  ] }
  const home = taskPage({ href: "https://memo.test/index.html", heading: "홈", storage: {}, data: { ...withInbox, dashboard: grouped }, tasks: [] })
  await home.wait()
  const folds = home.main.querySelector("section.excudo-dash").querySelectorAll("details.excudo-dash-section")
  assert.deepEqual(folds.map((fold) => [fold.querySelector("span.excudo-dash-title").textContent, fold.querySelector("span.excudo-dash-line").textContent, fold.open]), [
    ["링크", "3", true], ["통계", "진행 중 2 · 이번 주 7 · 기록 없음 · 실패 1", false],
  ])
  assert.deepEqual(folds[0].querySelectorAll("span.excudo-dash-part-title").map((title) => title.textContent), ["업무", "개인"])
  assert.deepEqual(folds[1].querySelectorAll("span.excudo-dash-part-title").map((title) => title.textContent), ["할 일", "완료 추이", "에이전트", "자동화"])
  assert.equal(folds[0].querySelectorAll("a.excudo-link").length, 3)
  assert.ok(folds[1].classList.contains("excudo-dash-alert"), "a failed step marks the group")
  assert.ok(home.main.querySelector("p.excudo-dash-at"), "the numbers say as of when")
})

test("the board shows the node's body to edit, saves it from the body it started from, and shows another device's save", async () => {
  const saves = []
  const page = (storage = {}) => taskPage({ href: "https://memo.test/index.html", heading: "홈", storage, data: { ...withInbox, dashboard: DASHBOARD }, tasks: [],
    state: () => ({ changes: saves, appliedAt: null, sync: null }) })
  const home = page()
  await home.wait()
  const input = home.main.querySelector("textarea.excudo-board-input")
  const save = home.main.querySelector("button.excudo-board-save")
  const status = () => home.main.querySelector("span.excudo-board-status").textContent
  assert.equal(input.value, "- First thing\n\t- under it")
  assert.equal(home.main.querySelector("a.excudo-board-open").href, "nodes/Board.html")
  assert.equal(save.disabled, true, "nothing to save yet")
  input.value = "- First thing, done\n\t- under it\nA new line\n\n"
  input.fire("input")
  assert.deepEqual([save.disabled, status()], [false, "저장하지 않은 수정"])
  assert.deepEqual(home.kept("board-draft"), { page: "Board.md", base: home.runtime.boardHash("- First thing\n\t- under it"), text: input.value }, "the edit waits on this device")
  save.fire("click")
  assert.equal(input.value, "- First thing, done\n\t- under it\n- A new line", "saved as the memo keeps it: a list, no blank lines")
  assert.deepEqual(home.outbox().map(({ kind, page, base, text }) => [kind, page, base, text]),
    [["board", "Board.md", home.runtime.boardHash("- First thing\n\t- under it"), "- First thing, done\n\t- under it\n- A new line"]])
  await home.later()
  const [entry] = home.requests.filter((request) => request.method === "POST")[0].body.entries
  assert.deepEqual(Object.keys(entry).sort(), ["at", "base", "id", "kind", "page", "text"])
  assert.equal(status(), "저장함, 메모 반영 대기")
  // Another device opens Home: it shows the saved board, waiting for the memo.
  saves.push({ ...entry, issue: 9, state: "open" })
  const other = page()
  await other.wait()
  assert.equal(other.main.querySelector("textarea.excudo-board-input").value, "- First thing, done\n\t- under it\n- A new line")
  assert.equal(other.said(), "메모 반영 대기 1개")
  // Undo puts back what the memo will have.
  const back = other.main.querySelector("textarea.excudo-board-input")
  back.value = "- scratch"
  back.fire("input")
  other.main.querySelector("button.excudo-board-revert").fire("click")
  assert.equal(back.value, "- First thing, done\n\t- under it\n- A new line")
})

test("the page keeps the board in the shape and digest the engine does", async () => {
  const { boardHash, boardText } = await import("../src/board.mjs")
  const home = taskPage({ href: "https://memo.test/index.html", heading: "홈", data: { ...withInbox, dashboard: DASHBOARD }, tasks: [] })
  await home.wait()
  for (const text of ["첫 줄\n\n  - 들여쓴 줄  \n\t둘째\n- 이미\n\t  DEADLINE: <2026-11-03 Tue>\n-", "", "  \n", "- a\r\n- b", "가".normalize("NFD")]) {
    assert.equal(home.runtime.boardText(text), boardText(text), JSON.stringify(text))
    assert.equal(home.runtime.boardHash(text), boardHash(text), JSON.stringify(text))
  }
  assert.equal(DASHBOARD.sections[1].data.hash, boardHash(DASHBOARD.sections[1].data.text))
})

test("a long outbox goes in batches the inbox takes, and a task change behind long boards still goes", async () => {
  const notes = Array.from({ length: 33 }, (_, i) => ({ id: `board-${String(i).padStart(4, "0")}`, kind: "board", page: `b${i}.md`, base: "0a1b2c3d", text: "가".repeat(2000), at: "2026-10-29T01:00:00.000Z" }))
  const task = { id: "task-0001", kind: "task", page: "notes/Work.md", line: 3, hash: "aaaaaaaaaa", from: "TODO", to: "DOING", at: "2026-10-29T01:00:00.000Z" }
  const page = taskPage({ storage: { "excudo-memo:t:outbox": JSON.stringify({ entries: [...notes, task] }) } })
  await page.wait()
  for (let i = 0; i < 4; i++) await page.later()
  const posts = page.requests.filter((request) => request.method === "POST")
  assert.ok(posts.length >= 2, "more than one batch")
  for (const post of posts) assert.ok(JSON.stringify(post.body).length <= 64 * 1024, "each batch fits the inbox")
  assert.deepEqual(posts.flatMap((post) => post.body.entries.map((entry) => entry.id)).sort(), [...notes.map((note) => note.id), "task-0001"].sort(), "every change goes once")
})

test("two tabs that edit the board from different starts each keep their save, and a note the earlier notepad never sent lands on the board", async () => {
  const storage = {}
  const tab = () => taskPage({ href: "https://memo.test/index.html", heading: "홈", storage, data: { ...withInbox, dashboard: DASHBOARD }, tasks: [] })
  const left = tab(), right = tab()
  await left.wait(); await right.wait()
  const edit = (page, text) => { const input = page.main.querySelector("textarea.excudo-board-input"); input.value = text; input.fire("input"); page.main.querySelector("button.excudo-board-save").fire("click") }
  edit(left, "- First thing, left\n\t- under it")
  edit(right, "- First thing\n\t- under it\n- Right adds")
  // Both tabs share this device's storage, where the waiting saves are.
  const boards = () => left.kept("outbox").entries.filter((entry) => entry.kind === "board")
  const saves = boards()
  assert.deepEqual(saves.map(({ base, text }) => [base, text]), [["748bf705", "- First thing, left\n\t- under it"], ["748bf705", "- First thing\n\t- under it\n- Right adds"]],
    "the right tab's save does not replace the left's: both go, each from where it started")
  // The left tab saves again: the latest waiting save is the right tab's, so this one goes on its own too.
  edit(left, "- First thing, left again\n\t- under it")
  assert.equal(boards().length, 3)
  assert.equal(boards()[2].base, left.runtime.boardHash("- First thing, left\n\t- under it"), "from the left tab's own save")
  const old = { id: "note-0001", kind: "note", text: "Call the printer", at: "2026-10-30T01:00:00.000Z" }
  const later = taskPage({ href: "https://memo.test/index.html", heading: "홈", storage: { "excudo-memo:t:outbox": JSON.stringify({ entries: [old] }) }, data: { ...withInbox, dashboard: DASHBOARD }, tasks: [] })
  await later.wait()
  assert.equal(later.main.querySelector("textarea.excudo-board-input").value, "- First thing\n\t- under it\nCall the printer")
  assert.equal(later.outbox().length, 0, "the note left the outbox for the board")
  assert.equal(later.main.querySelector("button.excudo-board-save").disabled, false, "and waits to be saved")
})
