import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { batchesOf, boardHash, checkChanges, doneByWeek, mergeLines, receive, receivedOf, recordRun, siteOf, writeSite } from "../src/index.mjs"
import { put, read, tempDir, workspace } from "./helpers.mjs"

const NOW = new Date(2026, 9, 29, 15, 0)
const LINKS = { type: "links", title: "Work", items: [{ title: "Tracker", url: "https://tracker.example/board", icon: "T" }, { title: "Docs", url: "https://docs.example" }] }

test("a dashboard lists its sections in the owner's order, with each kind's defaults, and refuses what it cannot show", async () => {
  const ws = await workspace({}, { site: { inbox: true, dashboard: { sections: [LINKS, { type: "notes", page: "Board" }, { type: "tasks", open: false }, { type: "done", weeks: 4 }, { type: "agents" }, { type: "runs", title: "Runs" }] } } })
  assert.deepEqual(siteOf(ws).dashboard.sections, [
    { type: "links", title: "Work", open: true, items: [{ title: "Tracker", url: "https://tracker.example/board", icon: "T" }, { title: "Docs", url: "https://docs.example/" }] },
    { type: "notes", open: true, page: "Board" }, { type: "tasks", open: false, nodes: 8, except: [] }, { type: "done", open: true, weeks: 4 },
    { type: "agents", open: true, days: 14 }, { type: "runs", title: "Runs", open: true, days: 7 },
  ])
  assert.equal(siteOf(await workspace({}, { site: {} })).dashboard, null, "without the setting there is no dashboard")
  const wrong = [
    [{ sections: [] }, "dashboard.sections"], [{ sections: [{ type: "weather" }] }, "dashboard.sections[0].type"], [{ list: [] }, "dashboard.list"],
    [{ sections: [{ type: "tasks", weeks: 3 }] }, "dashboard.sections[0].weeks"], [{ sections: [{ type: "done", weeks: 0 }] }, "dashboard.sections[0].weeks"],
    [{ sections: [{ ...LINKS, items: [{ title: "Files", url: "file:///etc/passwd" }] }] }, "dashboard.sections[0].items[0].url"],
    [{ sections: [{ ...LINKS, items: [{ title: "Long", url: "https://a.example", icon: "ABC" }] }] }, "dashboard.sections[0].items[0].icon"],
    [{ sections: [{ type: "notes", page: "Board" }] }, "dashboard.sections[0].type"], [{ sections: [{ type: "tasks", except: "Paused" }] }, "dashboard.sections[0].except"],
    [{ sections: [{ type: "notes", page: "Board", recent: 5 }] }, "dashboard.sections[0].recent"],
  ]
  for (const [dashboard, field] of wrong) {
    const bad = await workspace({}, { locale: "en", site: { dashboard } })
    assert.throws(() => siteOf(bad), (error) => error.message.includes(field), field)
  }
  const twice = await workspace({}, { locale: "en", site: { inbox: true, dashboard: { sections: [{ type: "notes", page: "Board" }, { type: "notes", page: "Board" }] } } })
  assert.throws(() => siteOf(twice), (error) => error.message.includes("dashboard.sections[1].type"), "one notepad only")
  const nameless = await workspace({}, { locale: "en", site: { inbox: true, dashboard: { sections: [{ type: "notes" }] } } })
  assert.throws(() => siteOf(nameless), (error) => error.message.includes("dashboard.sections[0].page"), "the board names its node")
})

test("a group holds several sections in one fold: its parts take no fold of their own, and no notepad or group goes inside", async () => {
  const ws = await workspace({}, { site: { dashboard: { sections: [
    { type: "group", title: "Links", sections: [LINKS, { type: "links", title: "Own", items: [{ title: "Code", url: "https://code.example" }] }] },
    { type: "group", title: "Numbers", open: false, sections: [{ type: "tasks" }, { type: "runs", days: 3 }] },
  ] } } })
  assert.deepEqual(siteOf(ws).dashboard.sections, [
    { type: "group", title: "Links", open: true, sections: [
      { type: "links", title: "Work", items: [{ title: "Tracker", url: "https://tracker.example/board", icon: "T" }, { title: "Docs", url: "https://docs.example/" }] },
      { type: "links", title: "Own", items: [{ title: "Code", url: "https://code.example/" }] },
    ] },
    { type: "group", title: "Numbers", open: false, sections: [{ type: "tasks", nodes: 8, except: [] }, { type: "runs", days: 3 }] },
  ])
  const wrong = [
    [{ type: "group", sections: [LINKS] }, "dashboard.sections[0].title"],
    [{ type: "group", title: "G", sections: [] }, "dashboard.sections[0].sections"],
    [{ type: "group", title: "G", sections: [{ ...LINKS, open: false }] }, "dashboard.sections[0].sections[0].open"],
    [{ type: "group", title: "G", sections: [{ type: "group", title: "H", sections: [LINKS] }] }, "dashboard.sections[0].sections[0].type"],
    [{ type: "group", title: "G", sections: [{ type: "notes", page: "Board" }] }, "dashboard.sections[0].sections[0].type"],
    [{ type: "group", title: "G", sections: [{ type: "done", weeks: 0 }] }, "dashboard.sections[0].sections[0].weeks"],
  ]
  for (const [section, field] of wrong) {
    const bad = await workspace({}, { locale: "en", site: { inbox: true, dashboard: { sections: [section] } } })
    assert.throws(() => siteOf(bad), (error) => error.message.includes(field), field)
  }
})

const git = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}
const commit = (ws, message) => { git(ws.root, "add", "-A"); git(ws.root, "commit", "-q", "-m", message) }

test("finished tasks are counted by the commit that turned an open task into DONE, and a finished task moved elsewhere is not counted again", async () => {
  const ws = await workspace({ "Work.md": "# Work\nWork.\n\n- TODO Write the plan\n- DOING Ship the site\n- TODO Call the printer\n" })
  git(ws.root, "init", "-q")
  commit(ws, "start")
  put(ws.root, "Work.md", "# Work\nWork.\n\n- DONE Write the plan\n- DOING Ship the site\n- TODO Call the printer\n")
  commit(ws, "one finished")
  // Moving the finished task to another page removes a DONE line and adds one: no new finish.
  put(ws.root, "Work.md", "# Work\nWork.\n\n- DOING Ship the site\n- TODO Call the printer\n")
  put(ws.root, "Done.md", "# Done\nFinished work.\n\n- DONE Write the plan\n")
  commit(ws, "moved")
  // Two finished at once, and a task written down already done, which was never open.
  put(ws.root, "Work.md", "# Work\nWork.\n\n- DONE Ship the site\n- DONE Call the printer\n- DONE Something new\n")
  commit(ws, "two finished")
  // A task removed while a finished one of the same words moves to another page: nothing new finished.
  put(ws.root, "Work.md", "# Work\nWork.\n\n- DONE Something new\n- TODO Ship the site\n- DONE Ship the site\n")
  commit(ws, "reopened")
  put(ws.root, "Work.md", "# Work\nWork.\n\n- DONE Something new\n")
  put(ws.root, "Done.md", "# Done\nFinished work.\n\n- DONE Write the plan\n- DONE Ship the site\n")
  commit(ws, "dropped one, moved its twin")
  const weeks = doneByWeek(ws, { weeks: 3, now: new Date() })
  assert.equal(weeks.length, 3)
  assert.deepEqual(weeks.map((week) => week.n), [0, 0, 3])
  assert.ok(weeks[1].from < weeks[2].from)
  const cached = JSON.parse(readFileSync(join(ws.cacheDir, "dashboard-done.json"), "utf8")).commits
  assert.deepEqual(Object.values(cached).sort(), [0, 0, 0, 0, 1, 2], "each commit's count is kept")
  assert.deepEqual(doneByWeek(ws, { weeks: 3 }).map((week) => week.n), [0, 0, 3], "read again from the cache")
  assert.equal(doneByWeek(await workspace({}), { weeks: 2 }), null, "a memo outside git has no history to count")
})

test("Home's dashboard reaches the page with its numbers: open tasks by state and node, the runs, and the board's body", async () => {
  const out = join(tempDir(), "site")
  const ws = await workspace({
    "Work.md": "# Work\nWork.\n\n- DOING Ship the site\n- TODO Write the plan\n  DEADLINE: <2026-10-01 Thu>\n- WAITING Review the draft\n",
    "Me.md": "# Me\nMine.\n\n- TODO Renew the passport\n",
    "Paused.md": "# Paused\nOn hold.\n",
    "Paused/Old.md": "# Old\nAn old plan.\n\n- TODO Someday\n- DOING Half done\n",
    "Work/Later.md": "# Later\nNot now.\n\n- TODO One day\n",
    "Board.md": "# Board\nThe board.\n\n- First thing\n\t- under it\n",
  }, { locale: "en", site: { out, journals: true, inbox: true, dashboard: { sections: [LINKS, { type: "notes", page: "Board" }, { type: "tasks", except: ["Paused", "Later"] }, { type: "runs" }, { type: "agents", days: 3 }] } } })
  recordRun(ws, { step: "Backup", status: "ok", started: new Date(Date.now() - 3600000).toISOString() })
  recordRun(ws, { step: "Sources", status: "failed", started: new Date(Date.now() - 1800000).toISOString() })
  writeSite(ws)
  const text = readFileSync(join(out, "excudo-memo.js"), "utf8")
  const { dashboard } = JSON.parse(text.slice("window.excudoMemo = ".length, -2))
  assert.ok(!Number.isNaN(Date.parse(dashboard.at)))
  assert.deepEqual(dashboard.sections.map((section) => section.type), ["links", "notes", "tasks", "runs", "agents"])
  assert.deepEqual(dashboard.sections[0].items.map((item) => item.url), ["https://tracker.example/board", "https://docs.example/"])
  assert.deepEqual(dashboard.sections[1].data, { page: "Board.md", name: "Board", route: "nodes/Board.html", text: "- First thing\n\t- under it", hash: boardHash("- First thing\n\t- under it") })
  const tasks = dashboard.sections[2].data
  assert.deepEqual([tasks.counts, tasks.overdue], [{ doing: 1, todo: 2, waiting: 1 }, 1], "the tasks below a node left out do not count")
  assert.deepEqual(tasks.nodes.map((node) => [node.name, node.route, node.open]), [["Work", "nodes/Work.html", 3], ["Me", "nodes/Me.html", 1]])
  assert.deepEqual(dashboard.sections[3].data.steps.map((step) => [step.step, step.status]), [["Sources", "failed"], ["Backup", "ok"]], "a failed step comes first")
  assert.deepEqual([dashboard.sections[4].data.sessions, dashboard.sections[4].data.days.length], [0, 3])
})

test("a group reaches the page with each part's numbers, in the order the owner listed them", async () => {
  const out = join(tempDir(), "site")
  const ws = await workspace({ "Work.md": "# Work\nWork.\n\n- DOING Ship the site\n" }, { locale: "en", site: { out, dashboard: { sections: [
    { type: "group", title: "Numbers", open: false, sections: [{ type: "tasks" }, LINKS, { type: "runs" }] },
  ] } } })
  recordRun(ws, { step: "Backup", status: "ok", started: new Date(Date.now() - 3600000).toISOString() })
  writeSite(ws)
  const text = readFileSync(join(out, "excudo-memo.js"), "utf8")
  const [group] = JSON.parse(text.slice("window.excudoMemo = ".length, -2)).dashboard.sections
  assert.deepEqual([group.type, group.title, group.open, group.sections.map((part) => part.type)], ["group", "Numbers", false, ["tasks", "links", "runs"]])
  assert.deepEqual(group.sections[0].data.counts, { doing: 1, todo: 0, waiting: 0 })
  assert.equal(group.sections[1].items.length, 2)
  assert.deepEqual(group.sections[2].data.steps.map((step) => step.step), ["Backup"])
  assert.ok(group.sections.every((part) => !("open" in part)), "the parts fold with the group")
})

const BOARD = "# Board\nThe board.\n\n- First thing\n- Second thing\n\t- under it\n\n## Subpages\nUnder Board.\n"
const save = (page, base, text, id = "board-0001") => ({ format: "excudo-changes", version: 1, site: "memo-1", entries: [{ id, kind: "board", page, base, text, at: NOW.toISOString() }] })

test("a board's save replaces the node's body when the node still holds the body it was edited from", async () => {
  const ws = await workspace({ "Board.md": BOARD }, { locale: "en" })
  const base = boardHash("- First thing\n- Second thing\n\t- under it")
  const result = receive(ws, batchesOf(save("Board.md", base, "- First thing, done\n- Second thing\n\t- under it\n- A new line")), { now: NOW })
  assert.deepEqual(result.results.map(({ status, reason }) => [status, reason]), [["applied", "board"]])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- First thing, done\n- Second thing\n\t- under it\n- A new line\n\n## Subpages\nUnder Board.\n", "the head and the generated section stay")
  assert.equal(receivedOf(ws)["board-0001"].status, "applied")
  const again = receive(ws, batchesOf(save("Board.md", base, "- First thing, done\n- Second thing\n\t- under it\n- A new line", "board-0002")), { now: NOW })
  assert.deepEqual(again.results.map(({ status }) => status), ["already"], "a save the node already holds changes nothing")
  // Two saves in a row from one device: the second starts from the first.
  const first = "- One\n- Two"
  const both = batchesOf({ format: "excudo-changes", version: 1, site: "memo-1", entries: [
    { id: "board-0003", kind: "board", page: "Board.md", base: boardHash("- First thing, done\n- Second thing\n\t- under it\n- A new line"), text: first, at: NOW.toISOString() },
    { id: "board-0004", kind: "board", page: "Board.md", base: boardHash(first), text: "- One\n- Two\n- Three", at: NOW.toISOString() },
  ] })
  assert.deepEqual(receive(ws, both, { now: NOW }).results.map(({ status, reason }) => [status, reason]), [["applied", "board"], ["applied", "board"]])
  assert.match(read(ws, "Board.md"), /\n\n- One\n- Two\n- Three\n\n## Subpages/)
})

test("a board changed meanwhile is merged line by line, and lines both sides changed differently go to its end under a marked item", async () => {
  const ws = await workspace({ "Board.md": BOARD }, { locale: "en" })
  git(ws.root, "init", "-q")
  commit(ws, "board")
  const base = boardHash("- First thing\n- Second thing\n\t- under it")
  // In Tine meanwhile: the second line changed and a line added at the end.
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- First thing\n- Second thing, in Tine\n\t- under it\n- Added in Tine\n\n## Subpages\nUnder Board.\n")
  const merged = receive(ws, batchesOf(save("Board.md", base, "- First thing, on the web\n- Second thing\n\t- under it")), { now: NOW })
  assert.deepEqual(merged.results.map(({ status, reason }) => [status, reason]), [["applied", "merged"]])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- First thing, on the web\n- Second thing, in Tine\n\t- under it\n- Added in Tine\n\n## Subpages\nUnder Board.\n")
  commit(ws, "merged")
  // The same line changed on both sides: the node's line stays, the website's goes to the end.
  const now = boardHash("- First thing, on the web\n- Second thing, in Tine\n\t- under it\n- Added in Tine")
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- First thing, in Tine again\n- Second thing, in Tine\n\t- under it\n- Added in Tine\n")
  const overlap = receive(ws, batchesOf(save("Board.md", now, "- First thing, on the web again\n- Second thing, in Tine\n\t- under it\n- Added in Tine", "board-0002")), { now: NOW })
  assert.deepEqual(overlap.results.map(({ status, reason }) => [status, reason]), [["applied", "overlap"]])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- First thing, in Tine again\n- Second thing, in Tine\n\t- under it\n- Added in Tine\n- Overlapping edit from the website, 10/29 15:00: keep what you want and remove this item\n\t- First thing, on the web again\n")
})

test("saves in a row merge from the save before them, in one run or the next, and a removal beside a line added elsewhere both hold", async () => {
  const ws = await workspace({ "Board.md": "# Board\nThe board.\n\n- A\n- B\n" }, { locale: "en" })
  git(ws.root, "init", "-q")
  commit(ws, "board")
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- A\n- B, in Tine\n")
  const first = "- A, on the web\n- B"
  const two = { format: "excudo-changes", version: 1, site: "memo-1", entries: [
    { id: "board-0001", kind: "board", page: "Board.md", base: boardHash("- A\n- B"), text: first, at: NOW.toISOString() },
    { id: "board-0002", kind: "board", page: "Board.md", base: boardHash(first), text: "- A, on the web again\n- B", at: NOW.toISOString() },
  ] }
  assert.deepEqual(receive(ws, batchesOf(two), { now: NOW }).results.map(({ reason }) => reason), ["merged", "merged"])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- A, on the web again\n- B, in Tine\n")
  // The next run: a save started from the second one, which the node never held as it was sent.
  const third = save("Board.md", boardHash("- A, on the web again\n- B"), "- A, on the web again\n- B\n- C", "board-0003")
  assert.deepEqual(receive(ws, batchesOf(third), { now: NOW }).results.map(({ reason }) => reason), ["merged"])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- A, on the web again\n- B, in Tine\n- C\n")
  assert.deepEqual(mergeLines(["- A", "- B"], ["- B"], ["- A", "- X", "- B"]), { lines: ["- X", "- B"], conflicts: [] }, "a line removed on the web beside one added in Tine")
  assert.deepEqual(mergeLines(["- A", "- B"], ["- A2", "- B"], ["- A", "- X", "- B"]), { lines: ["- A2", "- X", "- B"], conflicts: [] })
})

test("a board whose earlier body cannot be found takes a save that only adds lines, and keeps any other under the marked item whole", async () => {
  const ws = await workspace({ "Board.md": "# Board\nThe board.\n\n- Kept line\n- Changed in Tine\n" }, { locale: "en" })
  const result = receive(ws, batchesOf(save("Board.md", "00000000", "- Kept line\n- Written on the web")), { now: NOW })
  assert.deepEqual(result.results.map(({ status, reason }) => [status, reason]), [["applied", "overlap"]])
  assert.equal(read(ws, "Board.md"), "# Board\nThe board.\n\n- Kept line\n- Changed in Tine\n- Overlapping edit from the website, 10/29 15:00: keep what you want and remove this item\n\t- Kept line\n\t- Written on the web\n")
  const added = await workspace({ "Board.md": "# Board\nThe board.\n\n- One\n- Two\n" }, { locale: "en" })
  assert.deepEqual(receive(added, batchesOf(save("Board.md", "00000000", "- One\n- Between\n- Two\n- Three")), { now: NOW }).results.map(({ reason }) => reason), ["merged"])
  assert.equal(read(added, "Board.md"), "# Board\nThe board.\n\n- One\n- Between\n- Two\n- Three\n", "only lines added: taken")
  // An emptied board whose start is unknown removes nothing, and says so on the board.
  const emptied = await workspace({ "Board.md": "# Board\nThe board.\n\n- Keep\n" }, { locale: "en" })
  assert.deepEqual(receive(emptied, batchesOf(save("Board.md", "00000000", "")), { now: NOW }).results.map(({ reason }) => reason), ["overlap"])
  assert.equal(read(emptied, "Board.md"), "# Board\nThe board.\n\n- Keep\n- Overlapping edit from the website, 10/29 15:00: keep what you want and remove this item\n\t- (the website emptied the board)\n")
  const check = (entry) => () => checkChanges({ ...save("Board.md", "00000000", ""), entries: [{ ...save("Board.md", "00000000", "").entries[0], ...entry }] })
  assert.doesNotThrow(check({}), "an emptied board is a save too")
  assert.throws(check({ base: "xyz" }), (error) => error.reason === "entries[0].base")
  assert.throws(check({ text: "x".repeat(20001) }), (error) => error.reason === "entries[0].text")
  assert.throws(check({ text: "bell\u0007" }), (error) => error.reason === "entries[0].text")
  assert.throws(check({ page: "../outside.md" }), (error) => error.reason === "entries[0].page")
})
