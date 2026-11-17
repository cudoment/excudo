/*
 * The memo's runtime on its website: what a page does beyond showing itself. It opens again the
 * sections this device opened on a page, folds the list of documents on the side (its own buttons
 * fold or unfold it all; on a narrow screen a floating button opens it as a panel over the page),
 * searches the memo's nodes from the index the page carries (excudo-memo.js), and shows on Home where
 * the reader left off. With an inbox (excudo-memo.js names its address), a task's state is a button
 * that offers the states to choose from: the choice shows at once, waits on this device, and goes to
 * the website's own inbox function, the one request the page's policy allows. When the index carries
 * a dashboard, Home opens with it: links, a board to read and edit whose saves go the same way,
 * and the numbers the engine worked out. Every word it shows is set as text, never as markup. Plain
 * script, no build step, so it runs from a file too.
 */
;(function () {
  "use strict"
  var data = window.excudoMemo
  if (!data || typeof data !== "object" || !Array.isArray(data.nodes)) return
  var STRINGS = {
    en: { search: "Search the memo", results: "{n} nodes", none: "No node matches.", navExpand: "Unfold all", navCollapse: "Fold all",
      navTools: "Fold the list", navOpen: "Menu", navClose: "Close", open: "{n} open", last: "Continue: {title}", tools: "Memo tools",
      change: "Change the state", waiting: "waiting for the memo", pending: "{n} waiting for the memo", sending: "Sending…", failed: "Not sent: tap to try again",
      taken: "in the memo", syncNow: "Bring in now", asked: "asked to bring in", askFailed: "Not asked: tap to try again", inboxFailed: "Inbox unavailable: trying again later",
      dashboard: "Dashboard", links: "Links", notes: "Notepad", tasks: "Tasks", done: "Finished", agents: "Agents", runs: "Automation",
      asOf: "As of {at}", noData: "No records", newTab: "opens in a new tab",
      doing: "In progress {n}", todo: "To do {n}", waiting2: "Waiting {n}", overdue: "{n} past their deadline", openTasks: "{n} open",
      thisWeek: "This week {n}", lastWeek: "last week {n}", doneHow: "Lines where an open task became DONE, by week",
      sessions: "{days} days: {n} sessions", cost: "about ${n}", activeDays: "Worked on {n} days", scheduled: "Scheduled sessions {n}",
      queue: "Handed to agents {ready} · waiting for review {waiting}", allOk: "All fine", failedN: "Failed {n}", deferredN: "Deferred {n}",
      states: { ok: "done", failed: "failed", deferred: "deferred", paused: "paused" },
      boardSave: "Save", boardRevert: "Undo edits", boardOpen: "Open the page", boardEdited: "Edited, not saved", boardSending: "Saving…",
      boardPending: "Saved, waiting for the memo", boardTaken: "In the memo", boardNotReady: "Saving opens once the website's inbox answers.",
      boardOffline: "The board is saved from the published website.", boardOther: "Another device saved the board; saving merges it line by line.",
      boardMissing: "No node named {name}", boardTooLong: "The board holds at most {n} characters.", boardLabel: "The board, one item per line" },
    ko: { search: "메모 검색", results: "노드 {n}개", none: "맞는 노드가 없습니다.", navExpand: "모두 펼치기", navCollapse: "모두 접기",
      navTools: "목록 접기", navOpen: "메뉴", navClose: "닫기", open: "{n} open", last: "이어 보기: {title}", tools: "메모 도구",
      change: "상태 바꾸기", waiting: "메모 반영 대기", pending: "메모 반영 대기 {n}개", sending: "보내는 중…", failed: "보내지 못함: 눌러서 다시 보내기",
      taken: "메모에 반영됨", syncNow: "지금 반영", asked: "반영 요청함", askFailed: "요청하지 못함: 눌러서 다시 요청", inboxFailed: "받는 곳 연결 불가: 나중에 다시 확인",
      dashboard: "대시보드", links: "링크", notes: "메모장", tasks: "할 일", done: "완료 추이", agents: "에이전트", runs: "자동화",
      asOf: "기준: {at}", noData: "기록 없음", newTab: "새 탭에서 열림",
      doing: "진행 중 {n}", todo: "할 일 {n}", waiting2: "대기 {n}", overdue: "목표일 지남 {n}", openTasks: "{n}개",
      thisWeek: "이번 주 {n}", lastWeek: "지난주 {n}", doneHow: "열린 할 일이 DONE으로 바뀐 줄을 주마다 셉니다",
      sessions: "{days}일 세션 {n}", cost: "약 ${n}", activeDays: "일한 날 {n}일", scheduled: "예약 실행 세션 {n}",
      queue: "맡긴 일 {ready} · 검토 대기 {waiting}", allOk: "정상", failedN: "실패 {n}", deferredN: "미룸 {n}",
      states: { ok: "성공", failed: "실패", deferred: "미룸", paused: "멈춤" },
      boardSave: "저장", boardRevert: "수정 취소", boardOpen: "페이지 열기", boardEdited: "저장하지 않은 수정", boardSending: "저장하는 중…",
      boardPending: "저장함, 메모 반영 대기", boardTaken: "메모에 반영됨", boardNotReady: "웹 사이트의 받는 곳이 답하면 저장할 수 있습니다.",
      boardOffline: "보드는 올린 웹 사이트에서 저장합니다.", boardOther: "다른 기기에서 저장한 내용이 있습니다. 저장하면 줄 단위로 합칩니다.",
      boardMissing: "{name} 노드가 없습니다", boardTooLong: "보드는 {n}자까지 쓸 수 있습니다.", boardLabel: "보드, 한 줄에 한 항목" },
  }
  var lang = String(document.documentElement.lang || data.locale || "en").toLowerCase().split("-")[0]
  var T = STRINGS[lang] || STRINGS.en
  var fill = function (text, values) { return text.replace(/\{(\w+)\}/g, function (whole, key) { return values[key] === undefined ? whole : String(values[key]) }) }
  var nfc = function (text) { return String(text).normalize ? String(text).normalize("NFC") : String(text) }
  var prefix = "excudo-memo:" + String(data.site || "memo") + ":"
  var store = {
    get: function (key) { try { var raw = window.localStorage.getItem(prefix + key); return raw ? JSON.parse(raw) : undefined } catch (error) { return undefined } },
    set: function (key, value) { try { window.localStorage.setItem(prefix + key, JSON.stringify(value)) } catch (error) {} },
  }
  var main = document.querySelector("main")
  if (!main) return

  // Which page this is, as a route from the site's root. The runtime's own address names the root
  // (the script file sits there); a single page carries the script inline and is its own route.
  var address = ""
  try { var url = new URL(window.location.href); url.hash = ""; url.search = ""; address = url.href } catch (error) { address = String(window.location.href || "") }
  var root = ""
  var self = document.currentScript
  if (self && self.src) { try { root = new URL("./", self.src).href } catch (error) { root = "" } }
  var route = root && address.indexOf(root) === 0 ? address.slice(root.length) : (address.split("/").pop() || "")
  try { route = decodeURIComponent(route) } catch (error) {}
  route = nfc(route)
  if (route === "" || route.slice(-1) === "/") route += nfc(data.home) // the root address shows Home
  var isHome = route === nfc(data.home)
  var title = null
  var named = data.nodes.concat(Array.isArray(data.views) ? data.views : [])
  for (var i = 0; i < named.length && !isHome; i++) if (nfc(named[i].route) === route) { title = named[i].name; break }
  if (title === null) {
    var heading = main.querySelector("h1")
    title = isHome || !heading ? document.title : heading.textContent
  }
  var current = { route: route, title: title }
  var href = function (route) {
    var from = current.route.split("/"); from.pop()
    var to = route.split("/")
    while (from.length && to.length > 1 && from[0] === to[0]) { from.shift(); to.shift() }
    var up = ""
    for (var k = 0; k < from.length; k++) up += "../"
    return up + to.map(encodeURIComponent).join("/")
  }

  var el = function (tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  var foldsOf = function (key) { var kept = store.get(key); return kept && typeof kept === "object" ? kept : {} }
  var keyer = function () {
    var seen = {}
    return function (element) {
      // A section whose title carries numbers names itself, so its fold is kept as the numbers change.
      var named = element.getAttribute && element.getAttribute("data-excudo-fold")
      if (named) return named
      var summary = element.querySelector(":scope > summary")
      var base = nfc(summary ? summary.textContent : "").replace(/\s+/g, " ").trim().slice(0, 200)
      var n = seen[base] = (seen[base] || 0) + 1
      return n > 1 ? base + "~" + n : base
    }
  }
  // A fold the runtime sets itself (a default) is not the reader's choice, so its toggle is not kept.
  var pending = []
  var setOpen = function (element, open) {
    if (element.open === Boolean(open)) return
    pending.push(element)
    element.open = Boolean(open)
  }
  var mine = function (element) {
    var at = pending.indexOf(element)
    if (at < 0) return false
    pending.splice(at, 1)
    return true
  }

  // Home's dashboard (data.dashboard): each section a fold whose title line carries its numbers, in
  // the order the owner listed them. Links open in a new tab and send nothing about the page with them.
  // The board is drawn here and comes to life with the task states below, which it shares a way with.
  var board = null
  // The board's digest and the shape the memo keeps it in, as the engine's board.mjs has them.
  var boardHash = function (text) {
    var value = nfc(text), hash = 0x811c9dc5
    for (var n = 0; n < value.length; n++) { hash ^= value.charCodeAt(n); hash = Math.imul(hash, 0x01000193) >>> 0 }
    return ("0000000" + hash.toString(16)).slice(-8)
  }
  var boardText = function (text) {
    return nfc(text).replace(/\r\n?/g, "\n").split("\n").map(function (line) { return line.replace(/\s+$/, "") })
      .filter(function (line) { return line.trim() }).map(function (line) {
        var parts = line.match(/^(\s*)(.*)$/), indent = parts[1], rest = parts[2]
        if (/^\t* {2}\S/.test(line) && rest.indexOf("- ") !== 0) return line
        var tabs = indent.replace(/ {2}/g, "\t").replace(/ /g, "")
        return rest === "-" || rest.indexOf("- ") === 0 ? tabs + rest : tabs + "- " + rest
      }).join("\n")
  }
  var dashboard = isHome && data.dashboard && typeof data.dashboard === "object" && Array.isArray(data.dashboard.sections) ? data.dashboard : null
  var shortTime = function (time) {
    var d = new Date(time)
    if (isNaN(d.getTime())) return ""
    var two = function (n) { return (n < 10 ? "0" : "") + n }
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + two(d.getHours()) + ":" + two(d.getMinutes())
  }
  var bars = function (rows, className) {
    var max = 0
    rows.forEach(function (row) { if (row.value > max) max = row.value })
    var list = el("div", "excudo-bars" + (className ? " " + className : ""))
    rows.forEach(function (row) {
      var line = list.appendChild(el("div", "excudo-bar"))
      var label = line.appendChild(row.route ? el("a", "excudo-bar-label", row.label) : el("span", "excudo-bar-label", row.label))
      if (row.route) label.href = href(row.route)
      var track = line.appendChild(el("span", "excudo-bar-track"))
      var filled = track.appendChild(el("span", "excudo-bar-fill"))
      filled.style.width = (max ? Math.round((row.value / max) * 100) : 0) + "%"
      line.appendChild(el("span", "excudo-bar-value", String(row.value)))
    })
    return list
  }
  // A section's numbers go on its title line and its parts in its body; `alert` marks what failed.
  // It returns the first of those numbers, which a group's title line gathers from its parts.
  var fillSection = function (section, line, body, alert) {
    var info = section.data
    if (section.type === "links") {
      var grid = body.appendChild(el("div", "excudo-links"))
      var shownLinks = 0
      ;(Array.isArray(section.items) ? section.items : []).forEach(function (item) {
        if (!item || typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return
        shownLinks++
        var link = grid.appendChild(el("a", "excudo-link"))
        link.href = item.url
        link.target = "_blank"
        link.rel = "noopener noreferrer"
        link.title = String(item.title) + " (" + T.newTab + ")"
        link.appendChild(el("span", "excudo-link-icon", String(item.icon || Array.from(String(item.title))[0] || "")))
        link.appendChild(el("span", "excudo-link-title", String(item.title)))
      })
      line.textContent = String(shownLinks)
      return shownLinks
    }
    if (section.type === "notes") {
      if (!info || typeof info.page !== "string" || typeof info.text !== "string") {
        line.textContent = info && info.missing ? fill(T.boardMissing, { name: info.missing }) : T.noData
        body.appendChild(el("p", "excudo-dash-none", line.textContent))
        return line.textContent
      }
      board = { fold: body.parentNode, line: line, page: info.page, built: { text: info.text, hash: String(info.hash || boardHash(info.text)) }, edited: false }
      board.input = body.appendChild(el("textarea", "excudo-board-input"))
      board.input.rows = Math.min(Math.max(info.text.split("\n").length + 2, 6), 30)
      board.input.maxLength = 20000
      board.input.spellcheck = false
      board.input.setAttribute("aria-label", T.boardLabel)
      board.input.value = info.text
      var bar = body.appendChild(el("div", "excudo-board-bar"))
      board.status = bar.appendChild(el("span", "excudo-board-status"))
      board.status.setAttribute("role", "status")
      if (info.route) { var open = bar.appendChild(el("a", "excudo-board-open", T.boardOpen)); open.href = href(info.route) }
      board.revert = bar.appendChild(el("button", "excudo-board-revert", T.boardRevert))
      board.revert.type = "button"
      board.save = bar.appendChild(el("button", "excudo-board-save", T.boardSave))
      board.save.type = "button"
      board.save.disabled = true
      return ""
    }
    if (!info || typeof info !== "object") {
      line.textContent = T.noData
      body.appendChild(el("p", "excudo-dash-none", T.noData))
      return T.noData
    }
    if (section.type === "tasks") {
      var counts = info.counts || {}
      line.textContent = [fill(T.doing, { n: counts.doing || 0 }), fill(T.todo, { n: counts.todo || 0 }), fill(T.waiting2, { n: counts.waiting || 0 })].join(" · ")
      if (info.overdue) body.appendChild(el("p", "excudo-dash-warn", fill(T.overdue, { n: info.overdue })))
      body.appendChild(bars((info.nodes || []).map(function (node) { return { label: String(node.name), route: node.route, value: Number(node.open) || 0 } })))
    } else if (section.type === "done") {
      var weeks = Array.isArray(info.weeks) ? info.weeks : []
      var now = weeks.length ? weeks[weeks.length - 1].n : 0
      var before = weeks.length > 1 ? weeks[weeks.length - 2].n : 0
      line.textContent = fill(T.thisWeek, { n: now }) + " · " + fill(T.lastWeek, { n: before })
      var columns = body.appendChild(el("div", "excudo-columns"))
      var top = 0
      weeks.forEach(function (week) { if (week.n > top) top = week.n })
      weeks.forEach(function (week) {
        var column = columns.appendChild(el("div", "excudo-column"))
        column.appendChild(el("span", "excudo-column-value", String(week.n)))
        var track = column.appendChild(el("span", "excudo-column-track"))
        track.appendChild(el("span", "excudo-column-fill")).style.height = (top ? Math.round((week.n / top) * 100) : 0) + "%"
        var day = String(week.from).split("-")
        column.appendChild(el("span", "excudo-column-label", Number(day[1]) + "/" + Number(day[2])))
      })
      body.appendChild(el("p", "excudo-dash-note", T.doneHow))
    } else if (section.type === "agents") {
      var days = Array.isArray(info.days) ? info.days : []
      line.textContent = fill(T.sessions, { days: days.length, n: info.sessions || 0 }) + (info.cost ? " · " + fill(T.cost, { n: Math.round(info.cost) }) : "")
      var strip = body.appendChild(el("div", "excudo-columns excudo-columns-days"))
      var most = 0
      days.forEach(function (day) { if (day.sessions > most) most = day.sessions })
      days.forEach(function (day) {
        var column = strip.appendChild(el("div", "excudo-column"))
        column.title = day.day + ": " + day.sessions
        var track = column.appendChild(el("span", "excudo-column-track"))
        track.appendChild(el("span", "excudo-column-fill")).style.height = (most ? Math.round((day.sessions / most) * 100) : 0) + "%"
      })
      body.appendChild(el("p", "excudo-dash-note", [fill(T.activeDays, { n: info.activeDays || 0 }), fill(T.scheduled, { n: info.scheduled || 0 })].join(" · ")))
      if (info.queue) body.appendChild(el("p", "excudo-dash-note", fill(T.queue, { ready: info.queue.ready || 0, waiting: info.queue.waiting || 0 })))
    } else if (section.type === "runs") {
      var steps = Array.isArray(info.steps) ? info.steps : []
      var failed = steps.filter(function (step) { return step.status === "failed" }).length
      var deferred = steps.filter(function (step) { return step.status === "deferred" }).length
      line.textContent = failed || deferred ? [failed ? fill(T.failedN, { n: failed }) : "", deferred ? fill(T.deferredN, { n: deferred }) : ""].filter(Boolean).join(" · ") : steps.length ? T.allOk : T.noData
      if (failed) alert()
      var table = body.appendChild(el("ul", "excudo-runs"))
      steps.forEach(function (step) {
        var row = table.appendChild(el("li", "excudo-run excudo-run-" + String(step.status)))
        row.appendChild(el("span", "excudo-run-status", T.states[step.status] || String(step.status)))
        row.appendChild(el("span", "excudo-run-step", String(step.step)))
        row.appendChild(el("span", "excudo-run-at", shortTime(step.at)))
      })
    }
    return String(line.textContent).split(" · ")[0]
  }
  var drawSection = function (section, index) {
    var fold = el("details", "excudo-dash-section excudo-dash-" + section.type)
    fold.setAttribute("data-excudo-fold", "dashboard:" + index + ":" + section.type)
    fold.open = section.open !== false
    var summary = fold.appendChild(el("summary"))
    summary.appendChild(el("span", "excudo-dash-title", String(section.title || T[section.type] || section.type)))
    var line = summary.appendChild(el("span", "excudo-dash-line"))
    var body = fold.appendChild(el("div", "excudo-dash-body"))
    var alert = function () { if (fold.className.indexOf("excudo-dash-alert") < 0) fold.className += " excudo-dash-alert" }
    if (section.type !== "group") { fillSection(section, line, body, alert); return fold }
    // A group: its parts one under another, each under its title with its numbers; the group's title
    // line adds up the links of a group of links, and otherwise gathers each part's first number.
    var parts = (Array.isArray(section.sections) ? section.sections : []).filter(function (part) { return part && typeof part === "object" && part.type !== "group" && part.type !== "notes" })
    var shorts = [], links = 0
    parts.forEach(function (part) {
      var piece = body.appendChild(el("div", "excudo-dash-part excudo-dash-" + part.type))
      var head = piece.appendChild(el("div", "excudo-dash-part-head"))
      head.appendChild(el("span", "excudo-dash-part-title", String(part.title || T[part.type] || part.type)))
      var partLine = head.appendChild(el("span", "excudo-dash-line"))
      var short = fillSection(part, partLine, piece.appendChild(el("div", "excudo-dash-part-body")), function () {
        if (piece.className.indexOf("excudo-dash-alert") < 0) piece.className += " excudo-dash-alert"
        alert()
      })
      if (part.type === "links") links += Number(short) || 0
      else if (short) shorts.push(String(short))
    })
    line.textContent = parts.every(function (part) { return part.type === "links" }) ? String(links) : shorts.join(" · ")
    return fold
  }
  if (dashboard) {
    var panel = el("section", "excudo-dash")
    panel.setAttribute("aria-label", T.dashboard)
    dashboard.sections.forEach(function (section, index) { if (section && typeof section === "object") panel.appendChild(drawSection(section, index)) })
    var counted = function (section) { return section && (section.type === "group" ? Array.isArray(section.sections) && section.sections.some(counted) : section.type !== "links" && section.type !== "notes") }
    if (dashboard.at && dashboard.sections.some(counted))
      panel.appendChild(el("p", "excudo-dash-at", fill(T.asOf, { at: shortTime(dashboard.at) })))
    var headingHere = main.querySelector("h1")
    if (headingHere && headingHere.parentNode === main) main.insertBefore(panel, headingHere.nextSibling)
    else main.insertBefore(panel, main.firstChild)
  }

  // The page's own folding sections (query results, the tree of the nodes below): written folded, so
  // a page reads as its titles first, and opened again where the reader opened them on this page.
  var pageScope = { key: "folds:" + current.route }
  pageScope.folds = foldsOf(pageScope.key)
  var folds = pageScope.folds
  var sections = Array.prototype.slice.call(main.querySelectorAll("details"))
  var pageKey = keyer()
  sections.forEach(function (element) {
    var key = pageKey(element)
    if (Object.prototype.hasOwnProperty.call(folds, key)) element.open = Boolean(folds[key])
    element.addEventListener("toggle", function () {
      if (mine(element)) return
      folds[key] = element.open
      store.set(pageScope.key, folds)
    })
  })

  // The sidebar's list of documents: the same on every page, so its folds are kept once for the whole
  // site, apart for a narrow screen and a wide one. On a narrow screen every group starts folded, so the
  // list stays short above or behind the page; on a wide one the top groups keep the way the site was
  // written and only the groups leading to this page are open. Its own buttons fold or unfold it all.
  var side = document.querySelector("nav.sidebar")
  var groups = side ? Array.prototype.slice.call(side.querySelectorAll("details")) : []
  var narrowQuery = window.matchMedia ? window.matchMedia("(max-width: 768px)") : null
  var navScope = null
  var here = side ? side.querySelector("a[aria-current=\"page\"]") : null
  var built = groups.map(function (element) { return element.open })
  var navKey = keyer()
  var navKeys = groups.map(function (element) { return navKey(element) })
  var topLevel = function (element) { var group = element.parentNode && element.parentNode.parentNode; return !group || !group.closest || !group.closest("details") }
  var leadsHere = function (element) { return Boolean(here) && element.contains(here) }
  var applyNav = function () {
    var narrow = Boolean(narrowQuery && narrowQuery.matches)
    navScope = { key: narrow ? "folds:nav:narrow" : "folds:nav:wide", narrow: narrow }
    navScope.folds = foldsOf(navScope.key)
    groups.forEach(function (element, i) {
      var key = navKeys[i]
      var kept = Object.prototype.hasOwnProperty.call(navScope.folds, key) ? Boolean(navScope.folds[key]) : undefined
      var open = narrow ? Boolean(kept) : kept !== undefined ? kept : topLevel(element) ? built[i] : leadsHere(element)
      if (!narrow && leadsHere(element)) open = true
      setOpen(element, open)
    })
  }
  groups.forEach(function (element, i) {
    element.addEventListener("toggle", function () {
      if (mine(element) || !navScope) return
      navScope.folds[navKeys[i]] = element.open
      store.set(navScope.key, navScope.folds)
    })
  })
  var setNav = function (open) {
    groups.forEach(function (element, i) { element.open = open; navScope.folds[navKeys[i]] = open })
    store.set(navScope.key, navScope.folds)
  }
  if (groups.length) {
    applyNav()
    if (narrowQuery) {
      var onChange = function () { applyNav() }
      if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", onChange)
      else if (narrowQuery.addListener) narrowQuery.addListener(onChange)
    }
    var navBar = el("div", "excudo-nav-tools")
    navBar.setAttribute("role", "group")
    navBar.setAttribute("aria-label", T.navTools)
    // Each button is an icon, chevrons apart to unfold and together to fold, named by its label and
    // tooltip; a browser that cannot draw the icon shows the label instead.
    var foldButton = function (label, paths, open) {
      var button = el("button", "excudo-nav-fold")
      button.type = "button"
      button.title = label
      button.setAttribute("aria-label", label)
      if (document.createElementNS) {
        var NS = "http://www.w3.org/2000/svg"
        var icon = document.createElementNS(NS, "svg")
        icon.setAttribute("viewBox", "0 0 24 24")
        icon.setAttribute("aria-hidden", "true")
        paths.forEach(function (d) { var stroke = document.createElementNS(NS, "path"); stroke.setAttribute("d", d); icon.appendChild(stroke) })
        button.appendChild(icon)
        button.className += " excudo-nav-icon"
      } else button.textContent = label
      button.addEventListener("click", function () { setNav(open) })
      return button
    }
    var navExpand = foldButton(T.navExpand, ["m7 15 5 5 5-5", "m7 9 5-5 5 5"], true)
    var navCollapse = foldButton(T.navCollapse, ["m7 20 5-5 5 5", "m7 4 5 5 5-5"], false)
    navBar.appendChild(navExpand)
    navBar.appendChild(navCollapse)
    var title = side.querySelector(":scope > .nav-title")
    side.insertBefore(navBar, title ? title.nextSibling : side.firstChild)
    // On a wide screen the list scrolls by itself: bring this page's line into view inside it.
    if (here && side.scrollHeight > side.clientHeight && side.getBoundingClientRect) {
      var line = here.getBoundingClientRect(), box = side.getBoundingClientRect()
      if (line.top < box.top || line.bottom > box.bottom) side.scrollTop += line.top - box.top - box.height / 3
    }
  }

  // On a narrow screen the list is not in the page: a floating button opens it as a panel over the
  // page, and it closes again by a close button, a tap beside it, Escape, or a link followed in it.
  // cudoc-export 1.1 draws that button and panel itself, without a script, around its checkbox
  // (#cudoc-nav-toggle); the runtime then adds only what needs one. Before 1.1 the runtime draws them
  // (memo.css hides the list there, and the open panel is the root's excudo-nav-open).
  var html = document.documentElement
  var cudocToggle = side && document.getElementById ? document.getElementById("cudoc-nav-toggle") : null
  var firstShown = function () {
    var shown = here
    for (var node = here && here.parentNode; shown && node && node !== side; node = node.parentNode) if (node.tagName === "DETAILS" && !node.open) shown = null
    return { line: shown, first: shown || side.querySelector("ul a") || side.querySelector("summary") }
  }
  var listOpen = function () { return false }
  if (side && cudocToggle) {
    listOpen = function () { return Boolean(cudocToggle.checked) }
    var shut = function () { if (cudocToggle.checked) { cudocToggle.checked = false; if (cudocToggle.focus) cudocToggle.focus() } }
    cudocToggle.addEventListener("change", function () {
      if (!cudocToggle.checked) return
      var at = firstShown()
      if (at.line && at.line.scrollIntoView) at.line.scrollIntoView({ block: "center" })
      if (at.first && at.first.focus) at.first.focus()
    })
    side.addEventListener("click", function (event) { if (listOpen() && event.target && event.target.closest && event.target.closest("a")) cudocToggle.checked = false })
    document.addEventListener("keydown", function (event) { if (listOpen() && event.key === "Escape") shut() })
    html.classList.add("excudo-js")
  } else if (side) {
    if (!side.id) side.id = "excudo-nav"
    var fab = el("button", "excudo-nav-fab")
    fab.type = "button"
    fab.setAttribute("aria-controls", side.id)
    fab.setAttribute("aria-expanded", "false")
    fab.setAttribute("aria-label", T.navOpen)
    if (document.createElementNS) {
      var NS = "http://www.w3.org/2000/svg"
      var svg = document.createElementNS(NS, "svg")
      svg.setAttribute("viewBox", "0 0 24 24")
      svg.setAttribute("aria-hidden", "true")
      ;[6, 12, 18].forEach(function (y) {
        var stroke = document.createElementNS(NS, "path")
        stroke.setAttribute("d", "M4 " + y + "h16")
        svg.appendChild(stroke)
      })
      fab.appendChild(svg)
    }
    var backdrop = el("div", "excudo-backdrop")
    backdrop.hidden = true
    var close = el("button", "excudo-nav-close", T.navClose)
    close.type = "button"
    close.setAttribute("aria-label", T.navClose)
    var tools = side.querySelector(".excudo-nav-tools")
    if (tools) tools.appendChild(close)
    else side.insertBefore(close, side.firstChild)
    var drawer = false
    var setDrawer = function (open) {
      if (open === drawer) return
      drawer = open
      if (open) html.classList.add("excudo-nav-open")
      else html.classList.remove("excudo-nav-open")
      backdrop.hidden = !open
      fab.setAttribute("aria-expanded", open ? "true" : "false")
      if (open) {
        // This page's line when the list shows it, otherwise the list's first line.
        var at = firstShown()
        if (at.line && at.line.scrollIntoView) at.line.scrollIntoView({ block: "center" })
        if (at.first && at.first.focus) at.first.focus()
      } else if (fab.focus) fab.focus()
    }
    fab.addEventListener("click", function () { setDrawer(true) })
    backdrop.addEventListener("click", function () { setDrawer(false) })
    close.addEventListener("click", function () { setDrawer(false) })
    side.addEventListener("click", function (event) {
      var target = event.target
      if (drawer && target && target.closest && target.closest("a")) setDrawer(false)
    })
    document.addEventListener("keydown", function (event) { if (drawer && event.key === "Escape") setDrawer(false) })
    if (narrowQuery) {
      var onWidth = function () { if (!narrowQuery.matches) setDrawer(false) }
      if (narrowQuery.addEventListener) narrowQuery.addEventListener("change", onWidth)
      else if (narrowQuery.addListener) narrowQuery.addListener(onWidth)
    }
    document.body.appendChild(backdrop)
    document.body.appendChild(fab)
    listOpen = function () { return drawer }
    html.classList.add("excudo-js")
  }

  // The search at the top of the page.
  var bar = el("div", "excudo-tools")
  bar.setAttribute("role", "group")
  bar.setAttribute("aria-label", T.tools)
  var search = el("input", "excudo-search")
  search.type = "search"
  search.placeholder = T.search
  search.setAttribute("aria-label", T.search)
  bar.appendChild(search)
  var results = el("div", "excudo-results")
  results.hidden = true
  var h1 = main.querySelector("h1")
  if (h1 && h1.parentNode === main) { main.insertBefore(bar, h1.nextSibling); main.insertBefore(results, bar.nextSibling) }
  else { main.insertBefore(bar, main.firstChild); main.insertBefore(results, bar.nextSibling) }

  var LIMIT = 30
  var render = function (query) {
    while (results.firstChild) results.removeChild(results.firstChild)
    var q = nfc(query).toLowerCase().trim()
    if (!q) { results.hidden = true; return }
    var hits = []
    for (var j = 0; j < data.nodes.length && hits.length < LIMIT; j++) {
      var node = data.nodes[j]
      var text = nfc(node.name + " " + (node.summary || "")).toLowerCase()
      if (text.indexOf(q) >= 0) hits.push(node)
    }
    var list = el("ul", "excudo-hits")
    hits.forEach(function (node) {
      var item = el("li")
      var link = el("a", "excudo-hit", node.name)
      link.href = href(node.route)
      item.appendChild(link)
      if (node.total) item.appendChild(el("span", "excudo-hit-open", fill(T.open, { n: node.total })))
      if (node.summary) item.appendChild(el("span", "excudo-hit-summary", node.summary))
      list.appendChild(item)
    })
    results.appendChild(el("p", "excudo-hits-count", hits.length ? fill(T.results, { n: hits.length }) : T.none))
    if (hits.length) results.appendChild(list)
    results.hidden = false
  }
  search.addEventListener("input", function () { render(search.value) })
  search.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { var first = results.querySelector("a.excudo-hit"); if (first) window.location.href = first.href }
    if (event.key === "Escape") { search.value = ""; render("") }
  })

  // A task's state, chosen on the page. Each task line carries its address in the memo (page, line,
  // the digest of its text without the state word) and the state the page was built with. A choice
  // shows at once on every line of that task on the page, waits in this device's storage, and goes to
  // the inbox function within half a second, which keeps it as an issue for the owner's machine. The
  // page also asks the function what the memo has not taken yet, so a state chosen on another device
  // shows here too, and what the memo took since the page was built, which shows as taken until the
  // next build names it (data.applied). The owner's machine takes the changes at its own interval, or
  // at once when a page asks it to. The page offers the choice only when the function says it is
  // ready, and keeps every unsent change until it is.
  var inbox = data.inbox && typeof data.inbox === "object" ? data.inbox : null
  var web = /^https?:/i.test(root)
  var endpoint = inbox && web && typeof inbox.endpoint === "string" ? root + inbox.endpoint : ""
  var syncPoint = inbox && web && typeof inbox.sync === "string" ? root + inbox.sync : ""
  var STATES = ["TODO", "DOING", "WAITING", "DONE", "CANCELED"]
  var editing = { ready: false, busy: false, failed: false, timer: null, asking: false, askFailed: false, askAfter: false }
  /** How long a page's claim to send a change holds, should the page close while sending it. */
  var CLAIM = 30000
  /** How much one batch may carry: the inbox takes 64 KiB, and a board may be long. The rest go next. */
  var BATCH_SIZE = 48000
  /** How long a choice waits for the next one before they go together. */
  var SEND_AFTER = 500
  /** How often a page in view asks again while changes wait, and while the machine is asked to take them. */
  var REFRESH = 30000
  var ASKED_REFRESH = 15000
  var appliedIds = {}
  ;(Array.isArray(data.applied) ? data.applied : []).forEach(function (id) { appliedIds[id] = true })
  var tasks = Array.prototype.slice.call(main.querySelectorAll("span.excudo-task")).filter(function (span) {
    return span.getAttribute("data-excudo-page") && span.getAttribute("data-excudo-line") && span.getAttribute("data-excudo-hash") && STATES.indexOf(span.getAttribute("data-excudo-state")) >= 0
  })
  // A board's saves are one line of their own: each waits for the one before, and no task shows them.
  var keyOf = function (item) {
    if (item.getAttribute) return item.getAttribute("data-excudo-page") + "#" + item.getAttribute("data-excudo-line") + "#" + item.getAttribute("data-excudo-hash")
    return item.kind === "board" ? "board#" + item.page : item.page + "#" + item.line + "#" + item.hash
  }
  var shown = {}
  tasks.forEach(function (span) { shown[keyOf(span)] = span.getAttribute("data-excudo-state") })
  var month = 30 * 86400000
  // What the inbox function said last: the changes of its recent issues (open while the memo has not
  // taken them, applied once it took them all, closed when it noted one to settle) and an open request.
  var remote = { changes: [], done: {}, sync: null, known: false, answered: false, failed: false }
  // The waiting changes are shared by every page of the website open on this device. Each step reads
  // them afresh and writes them back at once, so a page never drops what another page added, and a
  // change being sent carries the time its claim ends, so no other page changes or sends it meanwhile.
  var outbox = { entries: [] }
  var read = function () {
    var kept = store.get("outbox")
    return kept && Array.isArray(kept.entries) ? kept.entries.filter(function (entry) { return entry && typeof entry === "object" && typeof entry.id === "string" }) : []
  }
  var update = function (change) {
    var entries = read()
    var result = change ? change(entries) : undefined
    store.set("outbox", { entries: entries })
    outbox.entries = entries
    return result
  }
  var claimed = function (entry) { return typeof entry.sending === "number" && entry.sending > Date.now() }
  /** A change the page was not built with: one the inbox holds, other than `id`, that the memo may not show yet. */
  var newerRemote = function (key, id) {
    return remote.changes.some(function (change) { return keyOf(change) === key && change.id !== id && change.state !== "closed" && !appliedIds[change.id] })
  }
  // A change is let go once the memo has it: the website or the inbox names it as taken, or, for the
  // first change of a line still waiting, the page already shows the state it chose (the owner made it
  // elsewhere). That last needs the inbox's answer, which tells whether the memo took a change the
  // page does not show yet. A later change of the same line waits for the earlier ones.
  var prune = function (entries) {
    var earlier = {}
    for (var n = 0; n < entries.length; n++) {
      var entry = entries[n], key = keyOf(entry)
      var first = remote.known && !earlier[key] && !newerRemote(key, entry.id)
      var gone = appliedIds[entry.id] || remote.done[entry.id] || ((entry.kind || "task") === "task" && first && shown[key] === entry.to) || (entry.sent && Date.now() - Date.parse(entry.at) > month)
      if (gone) entries.splice(n--, 1)
      else earlier[key] = true
    }
  }
  update(prune)
  // The changes of a line in order: those the inbox holds, by issue, then this device's that it does
  // not hold yet. A change the page was built with, or one the memo noted to settle, is left out.
  var chainOf = function (key, entries) {
    var list = [], held = {}
    remote.changes.forEach(function (change) {
      if (keyOf(change) !== key) return
      held[change.id] = true
      if (change.state === "closed" || appliedIds[change.id]) return
      list.push({ to: change.to, mark: change.state === "open" ? "pending" : "applied" })
    })
    entries.forEach(function (entry) { if (keyOf(entry) === key && !held[entry.id]) list.push({ to: entry.to, mark: "pending", entry: entry }) })
    return list
  }
  var effectiveOf = function (key, entries) { var chain = chainOf(key, entries || outbox.entries); return chain.length ? chain[chain.length - 1] : null }
  var boxOf = function (span) { var parent = span.parentNode; return parent && parent.querySelector ? parent.querySelector("input[type=\"checkbox\"]") : null }
  var paint = function (key) {
    var last = effectiveOf(key)
    tasks.forEach(function (span) {
      if (keyOf(span) !== key) return
      var state = last ? last.to : span.getAttribute("data-excudo-state")
      span.textContent = state
      span.className = "excudo-task excudo-" + state.toLowerCase() + (last ? " excudo-" + last.mark : "")
      if (editing.ready) span.setAttribute("aria-label", T.change + ": " + state + (last ? ", " + (last.mark === "pending" ? T.waiting : T.taken) : ""))
      var box = boxOf(span)
      // A finished task, done or let go, shows its box ticked; unticking it opens the task again.
      if (box) box.checked = state === "DONE" || state === "CANCELED"
    })
  }
  var paintAll = function () { Object.keys(shown).forEach(paint); paintBoard() }
  // The board as the memo will have it: the latest save of it, from the inbox or this device, that the
  // website does not show yet, else the body the page was built with.
  var boardKnown = function () {
    var known = { text: board.built.text, hash: board.built.hash, mark: "" }, held = {}
    remote.changes.forEach(function (change) {
      if (change.kind !== "board" || change.page !== board.page) return
      held[change.id] = true
      if (change.state === "closed" || appliedIds[change.id]) return
      known = { text: change.text, hash: boardHash(change.text), mark: change.state === "open" ? "pending" : "taken", other: true }
    })
    outbox.entries.forEach(function (entry) {
      if (entry.kind !== "board" || entry.page !== board.page || held[entry.id]) return
      known = { text: entry.text, hash: boardHash(entry.text), mark: entry.sent ? "pending" : "sending", entry: entry }
    })
    return known
  }
  var paintBoard = function () {
    if (!board) return
    var known = boardKnown()
    // What the reader is writing stays; otherwise the board shows what the memo will have.
    if (!board.edited && board.input.value !== known.text) board.input.value = known.text
    var other = board.edited && known.other && known.hash !== board.base
    board.status.textContent = !editing.ready ? (endpoint ? T.boardNotReady : T.boardOffline)
      : other ? T.boardOther : board.edited ? T.boardEdited : known.mark === "sending" ? T.boardSending
      : known.mark === "pending" ? T.boardPending : known.mark === "taken" ? T.boardTaken : ""
    board.line.textContent = board.edited ? T.boardEdited : known.mark === "pending" || known.mark === "sending" ? T.boardPending : ""
    board.save.disabled = !editing.ready || !board.edited
    board.revert.hidden = !board.edited
  }
  /** Keeps the board's new body on this device and sends it with the next batch, from the body it was edited from. */
  var saveBoard = function () {
    if (!editing.ready || !board.edited) return
    var text = boardText(board.input.value)
    if (text.length > 20000) { board.status.textContent = fill(T.boardTooLong, { n: 20000 }); return }
    var known = boardKnown()
    if (text !== known.text) {
      update(function (entries) {
        var mine = null, base = board.base || known.hash
        entries.forEach(function (entry) { if (entry.kind === "board" && entry.page === board.page && !entry.sent && !claimed(entry)) mine = entry })
        // An unsent save this edit started from is replaced, so the memo gets one save from where that
        // one started. An edit that started elsewhere (another tab's) is a save of its own, merged in turn.
        if (mine && boardHash(mine.text) === base) { mine.text = text; mine.at = new Date().toISOString() }
        else entries.push({ id: newId(), kind: "board", page: board.page, base: base, text: text, at: new Date().toISOString() })
      })
    }
    board.input.value = text
    board.edited = false
    board.base = null
    store.set("board-draft", null)
    paintBoard()
    showStatus()
    later()
  }
  /** How many changes the memo has not taken, from every device. */
  var waitingCount = function () {
    var held = {}, n = 0
    remote.changes.forEach(function (change) { if (change.state === "open") { held[change.id] = true; n++ } })
    outbox.entries.forEach(function (entry) { if (!held[entry.id]) n++ })
    return n
  }
  var status = el("div", "excudo-outbox")
  status.setAttribute("role", "status")
  status.hidden = true
  var statusText = status.appendChild(el("span", "excudo-outbox-text"))
  var syncButton = status.appendChild(el("button", "excudo-sync", T.syncNow))
  syncButton.type = "button"
  syncButton.hidden = true
  var showStatus = function () {
    var waiting = waitingCount()
    status.className = "excudo-outbox" + (editing.failed || editing.askFailed || remote.failed ? " excudo-failed" : "")
    statusText.textContent = editing.failed ? T.failed : editing.busy ? T.sending : editing.askFailed ? T.askFailed
      : remote.failed ? T.inboxFailed : fill(T.pending, { n: waiting }) + (remote.sync || editing.asking ? " · " + T.asked : "")
    syncButton.hidden = !editing.ready || !syncPoint || !waiting || Boolean(remote.sync) || editing.asking || editing.failed
    status.hidden = !editing.failed && !editing.busy && !editing.askFailed && !remote.failed && !waiting
  }
  var newId = function () {
    var cryptoObject = window.crypto
    if (cryptoObject && cryptoObject.randomUUID) return cryptoObject.randomUUID()
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12)
  }
  var send = function () {
    editing.timer = null
    if (!editing.ready || editing.busy) return
    // The unsent changes no other page is sending, in the order they were chosen. A change waits while
    // an earlier change of its line is still being sent elsewhere, so the memo gets them in order.
    var batch = update(function (entries) {
      var blocked = {}, mine = [], until = Date.now() + CLAIM, size = 0, full = false
      entries.forEach(function (entry) {
        var key = keyOf(entry)
        if (entry.sent || (entry.kind && entry.kind !== "task" && entry.kind !== "board")) return
        if (full || blocked[key] || claimed(entry) || mine.length >= 100) { blocked[key] = true; return }
        var item = entry.kind === "board" ? { id: entry.id, kind: "board", page: entry.page, base: entry.base, text: entry.text, at: entry.at }
          : { id: entry.id, kind: "task", page: entry.page, line: entry.line, hash: entry.hash, from: entry.from, to: entry.to, at: entry.at }
        var length = JSON.stringify(item).length
        if (mine.length && size + length > BATCH_SIZE) { full = true; blocked[key] = true; return }
        size += length
        entry.sending = until
        mine.push(item)
      })
      return mine
    })
    if (!batch.length) { showStatus(); return }
    editing.busy = true
    editing.failed = false
    showStatus()
    var ids = {}
    batch.forEach(function (entry) { ids[entry.id] = true })
    var done = function (ok, reply) {
      editing.busy = false
      editing.failed = !ok
      update(function (entries) {
        entries.forEach(function (entry) { if (!ids[entry.id]) return; delete entry.sending; if (ok) entry.sent = reply && reply.issue ? reply.issue : true })
      })
      paintAll()
      showStatus()
      if (ok && outbox.entries.some(function (entry) { return !entry.sent })) later()
      else if (ok && editing.askAfter) ask()
      else soon(REFRESH)
    }
    var body = { format: "excudo-changes", version: 1, site: String(data.site), entries: batch }
    window.fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-excudo-edit": "1" }, body: JSON.stringify(body) })
      .then(function (response) { if (!response.ok) throw new Error(String(response.status)); return response.json() })
      .then(function (reply) { done(true, reply) }, function () { done(false) })
  }
  var later = function () {
    if (editing.timer) window.clearTimeout(editing.timer)
    editing.timer = window.setTimeout(send, SEND_AFTER)
  }
  // Bring in now: the page first lets every change it holds reach the inbox (its own, sent now, and
  // those another page is sending, waited for), then asks the function to have the owner's machine
  // take the waiting changes at once, and asks again more often until the request is taken.
  var askTimer = null
  var ask = function () {
    if (askTimer) { window.clearTimeout(askTimer); askTimer = null }
    if (!syncPoint || !editing.ready || editing.asking || remote.sync) { showStatus(); return }
    outbox.entries = read()
    var unsent = outbox.entries.filter(function (entry) { return !entry.sent })
    if (unsent.length) {
      editing.askAfter = true
      if (!editing.busy && unsent.some(function (entry) { return !claimed(entry) })) send()
      // Look again shortly, whoever is sending them, until every change reached the inbox.
      askTimer = window.setTimeout(ask, 2000)
      showStatus()
      return
    }
    editing.askAfter = false
    editing.asking = true
    editing.askFailed = false
    showStatus()
    window.fetch(syncPoint, { method: "POST", credentials: "same-origin", headers: { "x-excudo-edit": "1" } })
      .then(function (response) { if (!response.ok) throw new Error(String(response.status)); return response.json() })
      .then(function (reply) { editing.asking = false; remote.sync = { issue: reply.issue, at: reply.at }; showStatus(); soon(ASKED_REFRESH) },
        function () { editing.asking = false; editing.askFailed = true; showStatus() })
  }
  var refreshing = false
  var refreshTimer = null
  var lastRefresh = 0
  var visible = function () { return document.visibilityState !== "hidden" }
  // Ask again after `delay` while changes wait, a request is open, or the function has not answered
  // yet (after a failure, also when nothing is known to wait).
  var soon = function (delay, failed) {
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(function () {
      refreshTimer = null
      if (visible() && (failed || !remote.answered || waitingCount() || remote.sync)) refresh()
    }, delay)
  }
  var take = function (reply) {
    if (!reply || !reply.inbox) { soon(REFRESH, true); return }
    if (reply.error) { remote.failed = true; showStatus(); soon(REFRESH, true); return }
    remote.failed = false
    remote.answered = true
    if (Array.isArray(reply.changes)) {
      remote.changes = reply.changes.filter(function (change) {
        if (!change || typeof change !== "object" || typeof change.id !== "string") return false
        if (typeof change.page !== "string") return false
        return change.kind === "board" ? typeof change.text === "string" : STATES.indexOf(change.to) >= 0
      })
      remote.done = {}
      remote.changes.forEach(function (change) { if (change.state !== "open") remote.done[change.id] = true })
      remote.sync = reply.sync && typeof reply.sync === "object" ? reply.sync : null
      remote.known = true
      update(prune)
    }
    if (reply.ready && !editing.ready) enable()
    paintAll()
    showStatus()
    soon(remote.sync ? ASKED_REFRESH : REFRESH)
  }
  /** Asks the function what the memo has not taken yet and what it took since the page was built. */
  var refresh = function () {
    if (refreshing || !endpoint) return
    refreshing = true
    lastRefresh = Date.now()
    window.fetch(endpoint + "?view=state", { credentials: "same-origin", headers: { "x-excudo-edit": "1" } })
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (reply) { refreshing = false; if (reply) take(reply); else soon(REFRESH, true) }, function () { refreshing = false; soon(REFRESH, true) })
  }
  var choose = function (span, state) {
    var key = keyOf(span)
    var changed = update(function (entries) {
      var last = effectiveOf(key, entries)
      var base = last ? last.to : span.getAttribute("data-excudo-state")
      if (state === base) return false
      var at = new Date().toISOString()
      var mine = last && last.entry && !last.entry.sent && !claimed(last.entry) ? last.entry : null
      if (mine) {
        mine.to = state
        mine.at = at
        if (mine.to === mine.from) entries.splice(entries.indexOf(mine), 1)
      } else {
        entries.push({ id: newId(), kind: "task", page: span.getAttribute("data-excudo-page"), line: Number(span.getAttribute("data-excudo-line")),
          hash: span.getAttribute("data-excudo-hash"), from: base, to: state, at: at })
      }
      return true
    })
    if (!changed) return
    paint(key)
    showStatus()
    later()
  }
  var menu = null
  var closeMenu = function (back) {
    if (!menu) return
    var anchor = menu.anchor
    if (menu.parentNode) menu.parentNode.removeChild(menu)
    menu = null
    anchor.setAttribute("aria-expanded", "false")
    if (back && anchor.focus) anchor.focus()
  }
  var openMenu = function (span) {
    var opened = menu && menu.anchor === span
    closeMenu(false)
    if (opened) return
    var last = effectiveOf(keyOf(span))
    var now = last ? last.to : span.getAttribute("data-excudo-state")
    menu = el("span", "excudo-states")
    menu.setAttribute("role", "menu")
    menu.setAttribute("aria-label", T.change)
    menu.anchor = span
    STATES.forEach(function (state) {
      var item = el("button", "excudo-state-choice", state)
      item.type = "button"
      item.setAttribute("role", "menuitemradio")
      item.setAttribute("aria-checked", state === now ? "true" : "false")
      item.addEventListener("click", function () { choose(span, state); closeMenu(true) })
      menu.appendChild(item)
    })
    span.parentNode.insertBefore(menu, span.nextSibling)
    span.setAttribute("aria-expanded", "true")
    var first = menu.querySelector("button")
    if (first && first.focus) first.focus()
  }
  var enable = function () {
    editing.ready = true
    tasks.forEach(function (span) {
      span.setAttribute("role", "button")
      span.setAttribute("tabindex", "0")
      span.setAttribute("aria-haspopup", "menu")
      span.setAttribute("aria-expanded", "false")
      span.addEventListener("click", function () { openMenu(span) })
      span.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { if (event.preventDefault) event.preventDefault(); openMenu(span) } })
      var box = boxOf(span)
      if (box && !box.excudoReady) {
        box.excudoReady = true
        box.disabled = false
        box.addEventListener("change", function () { choose(span, box.checked ? "DONE" : "TODO") })
      }
    })
    paintAll()
    showStatus()
    send()
  }
  if (board) {
    // An edit not saved yet stays on this device with the body it started from.
    var startEdit = function () { if (!board.edited) { board.edited = true; board.base = boardKnown().hash } }
    var draft = store.get("board-draft")
    if (draft && typeof draft === "object" && draft.page === board.page && typeof draft.text === "string" && draft.text !== boardKnown().text) {
      board.input.value = draft.text
      board.edited = true
      board.base = typeof draft.base === "string" ? draft.base : boardKnown().hash
    }
    // A note the earlier notepad kept on this device and never sent goes onto the board, to save from there.
    var kept = update(function (entries) {
      var notes = entries.filter(function (entry) { return entry.kind === "note" && typeof entry.text === "string" })
      notes.forEach(function (entry) { entries.splice(entries.indexOf(entry), 1) })
      return notes
    })
    if (kept.length) {
      startEdit()
      board.input.value = [board.input.value].concat(kept.map(function (entry) { return entry.text })).filter(function (text) { return text.trim() }).join("\n")
      store.set("board-draft", { page: board.page, base: board.base, text: board.input.value })
    }
    var edit = function () {
      startEdit()
      store.set("board-draft", { page: board.page, base: board.base, text: board.input.value })
      paintBoard()
    }
    board.input.addEventListener("input", edit)
    // Tab and Shift+Tab move the line in or out, as in the outliner; Ctrl+S or Cmd+S saves.
    board.input.addEventListener("keydown", function (event) {
      var input = board.input
      if ((event.key === "s" || event.key === "S") && (event.ctrlKey || event.metaKey)) { if (event.preventDefault) event.preventDefault(); saveBoard(); return }
      if (event.key !== "Tab" || typeof input.selectionStart !== "number") return
      if (event.preventDefault) event.preventDefault()
      var value = input.value, at = input.selectionStart, from = value.lastIndexOf("\n", at - 1) + 1
      if (event.shiftKey) {
        if (value.charAt(from) !== "\t") return
        input.value = value.slice(0, from) + value.slice(from + 1)
        input.selectionStart = input.selectionEnd = Math.max(at - 1, from)
      } else {
        input.value = value.slice(0, from) + "\t" + value.slice(from)
        input.selectionStart = input.selectionEnd = at + 1
      }
      edit()
    })
    board.save.addEventListener("click", saveBoard)
    board.revert.addEventListener("click", function () {
      board.edited = false
      board.base = null
      store.set("board-draft", null)
      board.input.value = boardKnown().text
      paintBoard()
    })
  }
  paintAll()
  if (endpoint && (tasks.length || outbox.entries.length || board)) {
    document.body.appendChild(status)
    showStatus()
    status.addEventListener("click", function (event) {
      if (event && event.target === syncButton) return
      if (editing.failed) send()
      else if (editing.askFailed) ask()
    })
    syncButton.addEventListener("click", function () { ask() })
    document.addEventListener("keydown", function (event) { if (menu && event.key === "Escape") closeMenu(true) })
    document.addEventListener("click", function (event) {
      var target = event.target
      if (menu && target && target.closest && !target.closest(".excudo-states") && !target.closest("span.excudo-task")) closeMenu(false)
    })
    // Back in view, the page asks again, at most every ten seconds.
    var again = function () { if (visible() && Date.now() - lastRefresh > 10000) refresh() }
    document.addEventListener("visibilitychange", again)
    if (window.addEventListener) {
      window.addEventListener("focus", again)
      window.addEventListener("online", function () { if (editing.failed) send() })
      // Another page of the website changed the waiting list: show it here too.
      window.addEventListener("storage", function (event) { if (event.key === prefix + "outbox") { outbox.entries = read(); paintAll(); showStatus() } })
    }
    refresh()
  }

  // Where the reader left off, shown on Home.
  var last = store.get("last")
  if (isHome && last && typeof last === "object" && typeof last.route === "string" && last.route && last.route !== current.route) {
    var again = el("p", "excudo-last")
    var link = el("a", "", fill(T.last, { title: String(last.title || last.route) }))
    link.href = href(last.route)
    again.appendChild(link)
    bar.parentNode.insertBefore(again, results.nextSibling)
  }
  store.set("last", { route: current.route, title: current.title })
  window.excudoMemoRuntime = { version: 1, page: current.route, home: isHome, href: href, folds: function () { return folds }, navFolds: function () { return navScope ? navScope.folds : {} },
    listOpen: function () { return listOpen() }, editable: function () { return editing.ready }, outbox: function () { return outbox.entries.slice() },
    send: function () { send() }, ask: function () { ask() }, boardHash: boardHash, boardText: boardText }
})()
