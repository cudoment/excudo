import assert from "node:assert/strict"
import { test } from "node:test"
import { check, evaluateQuery, parseQuery, prepare, queryBlocks, queryMarkdown, taskHash, unsupportedQueries } from "../src/index.mjs"
import { workspace } from "./helpers.mjs"

test("a query is read into its forms and options, and a form the website cannot show is named", () => {
  const read = parseQuery('(and (task TODO DOING) (not [[보관]]) (not (page "홈")) "검토:") {:title "다음 할 일" :collapsed? true}')
  assert.deepEqual(read.unsupported, [])
  assert.deepEqual(read.options, { title: "다음 할 일", collapsed: true })
  assert.deepEqual(read.ast, { type: "and", children: [
    { type: "task", states: ["TODO", "DOING"] }, { type: "not", children: [{ type: "tag", name: "보관" }] },
    { type: "not", children: [{ type: "page", name: "홈" }] }, { type: "text", value: "검토:" }] })
  assert.deepEqual(parseQuery("(task doing)").ast, { type: "task", states: ["DOING"] })
  assert.deepEqual(parseQuery("(or [[a]] #b)").ast, { type: "or", children: [{ type: "tag", name: "a" }, { type: "tag", name: "b" }] })
  assert.deepEqual(parseQuery('(and (property type book) [[x]])').unsupported, ["(property …)"])
  assert.deepEqual(parseQuery('(between -7d today)').unsupported, ["(between …)"])
  assert.deepEqual(parseQuery('(task TODO').unsupported, ["(task TODO"])
  assert.deepEqual(parseQuery('(and "unterminated)').unsupported, ['(and "unterminated)'])
  assert.deepEqual(unsupportedQueries('- {{query (task TODO) {:title "Open" :collapsed? true}}}\n- {{query (namespace x)}}\n- {{query (and (task WAITING) "검토:") {:title "검토 대기"}}}\n'), [{ line: 1, form: "(namespace …)" }])
})

/** A node with tasks and a child, the owner's Home with a task of its own, and a journal. */
const memo = () => workspace({
  "Work.md": "# Work\nCurrent work.\n\n- DOING Ship the site [[Design]] #agent\n\t- Notes below it\n\t- WAITING Review: the draft\n- TODO Later thing #later\n- Decision: keep the old links\n",
  "Work/Design.md": "# Design\nThe look.\n\n- TODO Pick a font\n  DEADLINE: <2026-11-01 Sat>\n- DONE Pick colours\n",
  "Home.md": "## Now\n- TODO A task on Home\n- {{query (task TODO)}}\n- {{query (and [[later]]) {:title \"Later\"}}}\n- {{query (and \"Decision:\")}}\n",
  "journals/2026_10_20.md": "- TODO Call the printer\n- Idea: a journal idea\n",
}, { locale: "en" })

test("a query picks blocks by state, page, tag and text, groups them by page and shows a picked block once", async () => {
  const ws = await memo()
  const { model } = prepare(ws)
  const blocks = queryBlocks(ws, model)
  const names = (groups) => groups.map((group) => [group.page.name, group.entries.map((entry) => entry.text)])
  assert.deepEqual(names(evaluateQuery(parseQuery("(task TODO)").ast, blocks)),
    [["Work", ["TODO Later thing #later"]], ["Design", ["TODO Pick a font"]], ["Home", ["TODO A task on Home"]], ["2026_10_20", ["TODO Call the printer"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery('(and (task TODO) (not (page "Home")) (not [[later]]))').ast, blocks)), [["Design", ["TODO Pick a font"]], ["2026_10_20", ["TODO Call the printer"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery('(and (task WAITING) "review:")').ast, blocks)), [["Work", ["WAITING Review: the draft"]]])
  // The child WAITING block is shown under its picked parent, not on its own.
  assert.deepEqual(names(evaluateQuery(parseQuery("(task DOING WAITING)").ast, blocks)), [["Work", ["DOING Ship the site [[Design]] #agent"]]])
  // The query blocks on Home name the same tag and words but are not results themselves.
  assert.deepEqual(names(evaluateQuery(parseQuery('(and "Decision:")').ast, blocks)), [["Work", ["Decision: keep the old links"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery("[[later]]").ast, blocks)), [["Work", ["TODO Later thing #later"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery('(page "Home")').ast, blocks)), [["Home", ["TODO A task on Home"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery("[[agent]]").ast, blocks)), [["Work", ["DOING Ship the site [[Design]] #agent"]]])
  assert.deepEqual(names(evaluateQuery(parseQuery('(and (task TODO) (page "Design"))').ast, blocks)), [["Design", ["TODO Pick a font"]]])
})

test("a query's result is a folding section whose links lead from the page it is on, with the tasks' addresses", async () => {
  const ws = await memo()
  const { model } = prepare(ws)
  const blocks = queryBlocks(ws, model)
  const ctx = { page: { id: "Home" }, resolve: (name) => ({ work: "nodes/Work", design: "nodes/Work/Design" })[name.toLowerCase()],
    pageIdOf: (page) => page.kind === "node" ? `nodes/${page.id.replace(/^projects\//, "")}` : undefined }
  const text = queryMarkdown(ws, evaluateQuery(parseQuery("(task DOING)").ast, blocks), { title: "In progress" }, ctx)
  assert.equal(text, [
    '<details class="excudo-query">', '<summary>In progress <small class="excudo-count">1</small></summary>', "",
    "- [Work](nodes/Work.md)",
    `  - [ ] <span class="excudo-task excudo-doing" data-excudo-page="Work.md" data-excudo-line="4" data-excudo-hash="${taskHash("DOING Ship the site [[Design]] #agent")}" data-excudo-state="DOING">DOING</span> Ship the site [Design](nodes/Work/Design.md) <span class="excudo-tag">#agent</span>`,
    "    - Notes below it",
    `    - [ ] <span class="excudo-task excudo-waiting" data-excudo-page="Work.md" data-excudo-line="6" data-excudo-hash="${taskHash("WAITING Review: the draft")}" data-excudo-state="WAITING">WAITING</span> Review: the draft`,
    "", "</details>"].join("\n"))
  const empty = queryMarkdown(ws, [], { title: "None", collapsed: true }, ctx)
  assert.match(empty, /^<details class="excudo-query">\n<summary>None <small class="excudo-count">0<\/small><\/summary>\n\n<p class="excudo-empty">Nothing at the moment.<\/p>\n\n<\/details>$/)
})

test("check names the queries the website cannot show only when the workspace writes a website", async () => {
  const files = { "Work.md": "# Work\nWork.\n\n- {{query (and (task TODO) (property kind x))}}\n- {{query (task TODO)}}\n" }
  const without = await workspace(files)
  assert.deepEqual((await check(without)).issues.filter((issue) => issue.code === "query-unsupported"), [])
  const site = await workspace(files, { site: { out: "../site" } })
  const issues = (await check(site)).issues.filter((issue) => issue.code === "query-unsupported")
  assert.deepEqual(issues.map((issue) => [issue.file, issue.line]), [["Work.md", 4]])
  assert.match(issues[0].message, /\(property …\)/)
})
