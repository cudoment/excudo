import assert from "node:assert/strict"
import { test } from "node:test"
import { check } from "../src/index.mjs"
import { codes, workspace } from "./helpers.mjs"

test("a valid tree has no issues", async () => {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nThe documentation site.\n",
    "projects/Docs/Fixes.md": "# Fixes\nWhat to fix next.\n\n- TODO one\n\n## Notes\n- a note\n",
    "projects/Docs/Fixes/Detail.md": "# Detail\nA detail that links to [[Docs]].\n",
    "journals/2026_09_27.md": "- see [[2026_09_28]] and {{query [[check]]}}\n",
  })
  assert.deepEqual((await check(ws)).issues, [])
})

test("contract violations are reported", async () => {
  const ws = await workspace({
    "projects/No title.md": "Only a summary.\n",
    "projects/No summary.md": "# No summary\n\n- TODO work\n",
    "projects/Long summary.md": `# Long summary\n\n${"a".repeat(130)}\n`,
    "projects/Text after list.md": "# Text after list\n\nSummary.\n\n- TODO work\n\nswallowed paragraph\n",
    "projects/Big.md": `# Big\n\nSummary.\n\n${Array.from({ length: 13 }, (_, i) => `- TODO task ${i}\n`).join("")}`,
    "projects/Heading item.md": "# Heading item\n\nSummary.\n\n- ## was a heading\n",
    "projects/Orphan/Child.md": "# Child\n\nSummary with [[Missing page]].\n",
  })
  const found = codes((await check(ws)).issues)
  for (const code of ["node-title", "node-summary", "summary-long", "list-trailing-text", "node-large", "bullet-heading", "orphan-folder", "dangling-link"]) {
    assert.ok(found.includes(code), `${code} in ${found}`)
  }
})

test("a heading block with items indented under it is no outliner's edit", async () => {
  const ws = await workspace({
    "projects/Plan.md": "# Plan\nThe plan.\n\n## Areas\n- ### Work\n\t- write the report\n\t\t- with the numbers\n- ### Life\n\t- renew the licence\n",
    "projects/Bulleted.md": "# Bulleted\nA heading an outliner bulleted.\n\n- ## Now\n- in progress\n",
  })
  const flagged = (await check(ws)).issues.filter((issue) => issue.code === "bullet-heading").map((issue) => issue.key)
  assert.deepEqual(flagged, ["bullet-heading|projects/Bulleted.md:4"])
})

test("the first list stays short", async () => {
  const ws = await workspace({
    "projects/Top.md": `# Top\n\n${"a".repeat(70)}\n`,
    "projects/Top/Below.md": `# Below\n\n${"b".repeat(70)}\n`,
  })
  const keys = (await check(ws)).issues.map((issue) => issue.key)
  assert.ok(keys.includes("top-summary-long|Top"))
  assert.ok(!keys.includes("top-summary-long|Below"))
})

test("a list wider than the limit is reported", async () => {
  const files = {}
  for (let i = 0; i < 10; i++) files[`projects/Node ${i}.md`] = `# Node ${i}\n\nSummary.\n`
  const ws = await workspace(files)
  assert.ok((await check(ws)).issues.some((issue) => issue.key === "list-wide|Home"))
})

test("two files with one page name are an error", async () => {
  const ws = await workspace({
    "projects/Plan.md": "# Plan\n\nOne.\n",
    "areas/Plan.md": "# Plan\n\nTwo.\n",
  })
  assert.ok(codes((await check(ws)).issues).includes("duplicate-name"))
})

test("messages follow the locale", async () => {
  const ws = await workspace({ "projects/Plan.md": "# Plan\n\n- TODO work\n" }, { locale: "ko" })
  const issue = (await check(ws)).issues.find((i) => i.code === "node-summary")
  assert.match(issue.message, /핵심 요약/)
})

test("the first-screen DOING count includes journals without counting generated pages twice", async () => {
  const ws = await workspace({
    "A.md": "# A\n\nA.\n\n- DOING node task\n",
    "journals/2026_10_01.md": "- DOING journal task\n",
    "Home.md": "generated:: views/Home.mdx\n\n- DOING copied task\n",
  }, { widthMax: 1 })
  const result = await check(ws)
  assert.equal(result.top.doing, 2)
  assert.ok(result.issues.some((issue) => issue.code === "doing-wide"))
})

test("an owner can set the in-progress and per-node task limits apart from the list width, or turn them off", async () => {
  const files = { "A.md": "# A\n\nA.\n\n- DOING one\n- DOING two\n- TODO three\n" }
  const codes = async (settings) => (await check(await workspace(files, settings))).issues.map((issue) => issue.code)
  assert.ok((await codes({ widthMax: 1 })).includes("doing-wide"), "without doingMax the list width limits tasks in progress")
  assert.ok(!(await codes({ widthMax: 1, doingMax: 5 })).includes("doing-wide"), "doingMax sets its own limit")
  assert.ok((await codes({ doingMax: 1 })).includes("doing-wide"))
  assert.ok(!(await codes({ widthMax: 1, doingMax: false })).includes("doing-wide"), "false counts no tasks in progress")
  assert.ok((await codes({ taskMax: 2 })).includes("node-large"))
  assert.ok(!(await codes({ taskMax: false })).includes("node-large"), "false counts no open tasks in a node")
})
