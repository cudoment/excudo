import assert from "node:assert/strict"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { archive, build, find, init, move, review } from "../src/index.mjs"
import { authoredText } from "../src/dialects/logseq.mjs"
import { workspace, put, read } from "./helpers.mjs"

const view = "# Home\n\n```cudoc-embed\nsources: [/]\nrender: { type: tree }\n```\n"
const now = new Date("2026-10-01T12:00:00Z")

test("nested fence examples retain Subpages headings, DONE and TODO lines through build and archive", async () => {
  const authored = "# Guide\n\nExamples.  \n\n````markdown\n## Subpages\n```text\n- DONE example\n- TODO example 2026-01-01 #check\n```\n~~~\n- DONE another example\n~~~\n````\n\n## Real work\n\n- TODO actual work\n- DONE actual result\n"
  const ws = await workspace({ "Guide.md": authored, "Guide/Detail.md": "# Detail\n\nDetails.\n" })
  assert.equal(build(ws).blocked.length, 0)
  assert.ok(read(ws, "Guide.md").startsWith(authored))
  assert.equal(build(ws).open, 1)
  assert.equal((await archive(ws)).moved, 1)
  assert.equal(authoredText(read(ws, "Guide.md"), ws.labels.region), authored.replace("- DONE actual result\n", ""))
  assert.doesNotMatch(read(ws, "Done.md"), /example/)
  assert.ok(find(ws, "another example").matches.length)
  assert.ok(!(await review(ws, { now })).candidates.some((item) => item.scope === "line" && /example/.test(item.text)))
})

test("indented code, quoted examples and HTML are not completed outline items", async () => {
  const text = "# Guide\n\nExamples.\n\n    ## Subpages\n    - DONE indented example\n\n> ## Subpages\n> - DONE quoted example\n\n<div>\n## Subpages\n- DONE HTML example\n</div>\n\n## Work\n\n- DONE actual result\n"
  const ws = await workspace({ "Guide.md": text })
  assert.equal((await archive(ws)).moved, 1)
  assert.equal(read(ws, "Guide.md"), text.replace("- DONE actual result\n", ""))
  assert.doesNotMatch(read(ws, "Done.md"), /example/)
})

test("a finished item carries its code example without treating an example TODO as an open child", async () => {
  const ws = await workspace({ "Guide.md": "# Guide\n\nExamples.\n\n- DONE actual result\n  ```text\n  - TODO example\n  ```\n" })
  assert.equal((await archive(ws)).moved, 1)
  assert.match(read(ws, "Done.md"), /  ```text\n  - TODO example\n  ```/)
  assert.equal(read(ws, "Guide.md"), "# Guide\n\nExamples.\n\n")
})

test("an unfinished fence prevents appending a region and leaves the body intact", async () => {
  const text = "# Guide\n\nExamples.\n\n```text\n## Subpages\n- DONE example\n"
  const ws = await workspace({ "Guide.md": text, "Guide/Detail.md": "# Detail\n\nDetails.\n" })
  for (let i = 0; i < 2; i++) {
    assert.equal(build(ws).blocked.length, 1)
    assert.equal(read(ws, "Guide.md"), text)
  }
  assert.equal((await archive(ws)).moved, 0)
})

test("init preserves existing Home tasks and reports the ownership conflict in both languages", async () => {
  for (const [locale, home] of [["en", "Home"], ["ko", "홈"]]) {
    const text = `# ${home}\n\nPersonal tasks.\n\n- TODO retain this\n`
    const ws = await workspace({ [`${home}.md`]: text }, { locale })
    const result = await init(ws.root, { locale })
    assert.equal(read(ws, `${home}.md`), text)
    assert.equal(result.built.blocked.length, 1)
    assert.equal(result.built.blocked[0].file, `${home}.md`)
    const cli = spawnSync(process.execPath, [join(process.cwd(), "bin/excudo.mjs"), "init", ws.root, "--locale", locale], { encoding: "utf8" })
    assert.equal(cli.status, 2, cli.stderr)
    assert.match(cli.stderr, new RegExp(home))
    assert.equal(read(ws, `${home}.md`), text)
  }
})

test("unknown generated sections and forged view markers cannot acquire ownership by rebuilding", async () => {
  const body = "# A\n\nA.\n\n## Subpages\n\n- TODO handwritten content\n"
  const home = "generated:: views/Home.mdx\n\n- TODO handwritten home\n"
  const ws = await workspace({ "views/Home.mdx": view, "Home.md": home, "A.md": body })
  assert.equal(build(ws).blocked.length, 2)
  assert.equal(read(ws, "A.md"), body)
  assert.equal(read(ws, "Home.md"), home)
})

test("edited regions retain their protection baseline when a whole subtree moves", async () => {
  const ws = await workspace({ "projects/A.md": "# A\n\nA.\n", "projects/A/Child.md": "# Child\n\nC.\n",
    "projects/A/Child/Detail.md": "# Detail\n\nD.\n", "projects/B.md": "# B\n\nB.\n" })
  build(ws)
  put(ws.root, "projects/A.md", read(ws, "projects/A.md").replace("[[Child]] · C.", "[[Child]] · owner edit A"))
  put(ws.root, "projects/A/Child.md", read(ws, "projects/A/Child.md").replace("[[Detail]] · D.", "[[Detail]] · owner edit Child"))
  await move(ws, "A", "B")
  const state = JSON.parse(readFileSync(join(ws.cacheDir, "build.json"), "utf8"))
  assert.ok(state.regions["projects/B/A"])
  assert.ok(state.regions["projects/B/A/Child"])
  assert.ok(!state.regions["projects/A"])
  assert.deepEqual(build(ws).blocked.map((item) => item.file).sort(), ["projects/B/A.md", "projects/B/A/Child.md"])
  assert.match(read(ws, "projects/B/A.md"), /owner edit A/)
  assert.match(read(ws, "projects/B/A/Child.md"), /owner edit Child/)
  assert.equal(build(ws, { force: true }).blocked.length, 0)
})

test("deleting all caches does not erase hand edits in a view or generated region", async () => {
  const ws = await workspace({ "views/Home.mdx": view, "A.md": "# A\n\nA.\n", "A/Child.md": "# Child\n\nC.\n" })
  build(ws)
  for (const path of ["Home.md", "A.md"]) put(ws.root, path, read(ws, path) + "\n- TODO preserve hand edit\n")
  const home = read(ws, "Home.md"), body = read(ws, "A.md")
  rmSync(ws.cacheDir, { recursive: true, force: true })
  for (let i = 0; i < 2; i++) {
    assert.equal(build(ws).blocked.length, 2)
    assert.equal(read(ws, "Home.md"), home)
    assert.equal(read(ws, "A.md"), body)
  }
  assert.equal(build(ws, { force: true }).blocked.length, 0)
})

test("removing an owned generated region is protected, and code collapse properties remain literal", async () => {
  const ws = await workspace({ "views/Home.mdx": view, "A.md": "# A\n\nA.\n\n```text\n- example\n  collapsed:: true\n```\n",
    "A/Child.md": "# Child\n\nC.\n" })
  build(ws)
  const body = authoredText(read(ws, "A.md"), ws.labels.region)
  put(ws.root, "A.md", body)
  assert.equal(build(ws).blocked.length, 1)
  assert.equal(read(ws, "A.md"), body)
  assert.equal(build(ws, { force: true }).blocked.length, 0)
  assert.ok(read(ws, "A.md").startsWith(body))
  assert.match(read(ws, "A.md"), /  collapsed:: true\n```/)
})
