import assert from "node:assert/strict"
import { test } from "node:test"
import { build, check, renderTree } from "../src/index.mjs"
import { outline, put, read, workspace } from "./helpers.mjs"

const DEPTH = 6

/** A chain of nodes six levels deep, plus one leaf next to it. */
async function deepTree(config) {
  const files = { "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n  columns: [link, { value: { extractor: openTasks } }, summary]\n  order: [Root, ...]\n```\n", "projects/Side.md": "# Side\n\nA node with nothing below it.\n" }
  let folder = "projects"
  for (let level = 0; level < DEPTH; level++) {
    const name = level ? `Level${level}` : "Root"
    files[`${folder}/${name}.md`] = `# ${name}\n\nSummary of level ${level}.\n\n- TODO work\n`
    folder = `${folder}/${name}`
  }
  return workspace(files, config)
}

test("Home holds every depth once, collapsed below the first list", async () => {
  const ws = await deepTree()
  const result = build(ws)
  assert.equal(result.blocked.length, 0)
  const home = read(ws, "Home.md")
  const tree = outline(home)
  assert.deepEqual(tree.filter(([depth]) => depth === 0).map(([, name]) => name), ["Root", "Side"])
  assert.deepEqual(tree.slice(0, DEPTH), Array.from({ length: DEPTH }, (_, level) => [level, level ? `Level${level}` : "Root"]))
  assert.equal(new Set(tree.map(([, name]) => name)).size, tree.length)
  assert.equal(home.match(/collapsed:: true/g).length, DEPTH - 1)
  assert.match(home, /^generated:: views\/Home\.mdx$/m)
  assert.match(home, /\[\[Root\]\] · 6 open · Summary of level 0\./)
})

test("every node page holds its location and its whole subtree", async () => {
  const ws = await deepTree()
  build(ws)
  const region = read(ws, "projects/Root/Level1/Level2.md").split("## Subpages")[1]
  assert.match(region, /^\nLocation: \[\[Home\]\] › \[\[Root\]\] › \[\[Level1\]\] › Level2\n\n- \[\[Level3\]\]/)
  assert.deepEqual(outline(region), [3, 4, 5].map((level) => [level - 3, `Level${level}`]))
  assert.ok(read(ws, "projects/Side.md").endsWith("## Subpages\nLocation: [[Home]] › Side\n"))
})

test("the reader's expanded lines survive a rebuild and edits are protected", async () => {
  const ws = await deepTree()
  build(ws)
  const line = "- [[Root]] · 6 open · Summary of level 0."
  put(ws.root, "Home.md", read(ws, "Home.md").replace(`${line}\n  collapsed:: true\n`, `${line}\n`))
  put(ws.root, "projects/Side.md", read(ws, "projects/Side.md").replace("A node with nothing below it.", "A new summary."))
  assert.equal(build(ws).blocked.length, 0)
  assert.match(read(ws, "Home.md"), /- \[\[Root\]\] · 6 open · Summary of level 0\.\n\t- \[\[Level1\]\]/)
  assert.match(read(ws, "Home.md"), /\[\[Side\]\] · A new summary\./)

  const path = "projects/Root.md"
  put(ws.root, path, read(ws, path).replace("Summary of level 1.", "edited by hand"))
  const blocked = build(ws)
  assert.equal(blocked.blocked.length, 1)
  assert.match(read(ws, path), /edited by hand/)
  assert.equal(build(ws, { force: true }).blocked.length, 0)
  assert.doesNotMatch(read(ws, path), /edited by hand/)
})

test("order puts listed pages first and ... stands for the rest", async () => {
  const ws = await workspace({
    "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n  columns: [link, { value: { extractor: openTasks } }, summary]\n  order: [Beta, ..., Done]\n```\n",
    "Done.md": "# Done\n\nFinished.\n",
    "projects/Alpha.md": "# Alpha\n\nA.\n",
    "projects/Beta.md": "# Beta\n\nB.\n",
    "projects/Gamma.md": "# Gamma\n\nG.\n",
  })
  build(ws)
  assert.deepEqual(outline(read(ws, "Home.md")).map(([, name]) => name), ["Beta", "Alpha", "Gamma", "Done"])
  assert.equal(renderTree(ws).split("\n")[0], "- [[Beta]] · B.")
})

test("tree prints the part below one node", async () => {
  const ws = await deepTree()
  assert.deepEqual(outline(renderTree(ws, { node: "level4" })), [[0, "Level5"]])
})

test("Korean labels", async () => {
  const ws = await deepTree({ locale: "ko" })
  build(ws)
  assert.match(read(ws, "Home.md"), /^생성:: views\/Home\.mdx$/m)
  assert.match(read(ws, "Home.md"), /\[\[Root\]\] · 할 일 6 · /)
  assert.match(read(ws, "projects/Root.md"), /\n## 하위 문서\n/)
})

test("file names in NFD (as Syncthing leaves them on macOS) still give NFC page names", async () => {
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace(
    {
      "views/홈.mdx": "# 홈\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n  columns: [link, { value: { extractor: openTasks } }, summary]\n  order: [개발, ...]\n```\n",
      [nfd("projects/개발.md")]: "# 개발\n개발 요약입니다.\n\n- TODO 일\n",
      [nfd("projects/개발/세부.md")]: "# 세부\n세부 요약입니다. [[개발]]을 가리킵니다.\n",
      [nfd("홈.md")]: "생성:: views/홈.mdx\n\n",
    },
    { locale: "ko" },
  )
  const result = build(ws, { force: true })
  assert.equal(result.errors.length, 0)
  const home = read(ws, "홈.md")
  assert.ok(home.includes("[[개발]] · 할 일 1 · 개발 요약입니다."))
  assert.equal(home, home.normalize("NFC"))
  assert.deepEqual((await check(ws)).issues, [])
})

test("metadata omitted from an explicit order still follows all topic nodes in Home and tree", async () => {
  const ws = await workspace({
    "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n  order: [Beta]\n```\n",
    "Done.md": "# Done\n\nFinished.\n", "Record.md": "# Record\n\nHistory.\n",
    "projects/Alpha.md": "# Alpha\n\nA.\n", "projects/Beta.md": "# Beta\n\nB.\n", "projects/Gamma.md": "# Gamma\n\nG.\n",
  })
  build(ws)
  const expected = ["Beta", "Alpha", "Gamma", "Done", "Record"]
  assert.deepEqual(outline(read(ws, "Home.md")).map(([, name]) => name), expected)
  assert.deepEqual(outline(renderTree(ws)).map(([, name]) => name), expected)
})

test("the dialect adapts regular cudoc tables and document links alongside standard tree views", async () => {
  const ws = await workspace({
    "views/Home.mdx": "# Home\n\n```cudoc-embed\nsources: [/projects/A.md]\nselect: { depth: 1 }\nrender: { type: table, columns: [link, summary] }\n```\n",
    "projects/A.md": "# A\n\nA useful summary.\n",
  })
  const result = build(ws)
  assert.equal(result.errors.length, 0)
  assert.match(read(ws, "Home.md"), /- \[\[A\]\]\n  A useful summary\./)
})
