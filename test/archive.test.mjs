import assert from "node:assert/strict"
import { test } from "node:test"
import { archive, walkGraph } from "../src/index.mjs"
import { read, workspace } from "./helpers.mjs"
import { existingPath } from "../src/files.mjs"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

test("finished items move to Done, newest first, and Done keeps five", async () => {
  const done = Array.from({ length: 7 }, (_, i) => `- DONE finished ${i}\n`).join("")
  const ws = await workspace({
    "projects/Docs.md": `# Docs\n\nSummary.\n\n- TODO still open\n${done}`,
    "Done.md": "# Done\n\nRecently finished.\n\n- DONE older item\n",
  })
  const result = await archive(ws)
  assert.deepEqual([result.moved, result.skipped.length, result.removed], [7, 0, 3])
  const lines = read(ws, "Done.md").split("\n")
  assert.deepEqual(lines.slice(0, 4), ["# Done", "", "Recently finished.", ""])
  assert.equal(lines[4], "- DONE Docs · finished 0")
  assert.equal(lines.filter((ln) => ln.startsWith("- DONE")).length, 5)
  assert.equal(read(ws, "projects/Docs.md"), "# Docs\n\nSummary.\n\n- TODO still open\n")
  const finished = walkGraph(ws).pages.flatMap((page) => readFileSync(page.path, "utf8").split("\n")).filter((line) => /^\s*- DONE /.test(line))
  assert.equal(finished.length, 8, "overflow must remain in monthly nodes")
})

test("--canceled moves only the work the owner decided not to do, and leaves Done alone without any", async () => {
  const done = Array.from({ length: 6 }, (_, i) => `- DONE Docs · kept ${i}\n`).join("")
  const ws = await workspace({
    "Home.md": "## Plans\n- ### Topic\n\t- CANCELED Dropped idea · [[Docs]]  \n\t\t- CANCELED Its part · [[Parts]]\n\t- DONE Finished idea\n\t- TODO Open idea\n",
    "projects/Docs.md": "# Docs\nSummary.\n\n- CANCELLED Old plan\n\t- TODO still wanted\n- TODO keep going\n",
    "Done.md": `# Done\nRecently finished.\n\n${done}`,
  })
  const result = await archive(ws, { canceled: true })
  assert.deepEqual([result.moved, result.skipped.length], [1, 1])
  assert.deepEqual(result.items, [{ page: "Home", text: "CANCELED Dropped idea · [[Docs]]" }, { page: "Home", text: "CANCELED Its part · [[Parts]]" }])
  assert.equal(read(ws, "Home.md"), "## Plans\n- ### Topic\n\t- DONE Finished idea\n\t- TODO Open idea\n")
  assert.match(read(ws, "Done.md"), /\n- CANCELED Home · Dropped idea · \[\[Docs\]\]\n/)
  assert.match(read(ws, "projects/Docs.md"), /- CANCELLED Old plan\n\t- TODO still wanted\n/)
  const again = await archive(ws, { canceled: true })
  assert.equal(again.moved, 0)
  const before = read(ws, "Done.md")
  assert.equal((await archive(ws, { canceled: true })).removed, 0)
  assert.equal(read(ws, "Done.md"), before)
})

test("--canceled moves an item under a finished one that stays, and a page edited meanwhile stops the move", async () => {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nSummary.\n\n- DONE Shipped\n\t- CANCELED Extra polish\n- CANCELED Dropped\n",
  })
  const page = join(ws.graphDir, "projects/Docs.md")
  const running = archive(ws, { canceled: true })
  writeFileSync(page, `${readFileSync(page, "utf8")}- TODO Typed meanwhile\n`)
  await assert.rejects(running, /changed while archiving/)
  assert.match(read(ws, "projects/Docs.md"), /- CANCELED Dropped\n- TODO Typed meanwhile\n/)
  const result = await archive(ws, { canceled: true })
  assert.equal(result.moved, 2)
  assert.equal(read(ws, "projects/Docs.md"), "# Docs\nSummary.\n\n- DONE Shipped\n- TODO Typed meanwhile\n")
  assert.match(read(ws, "Done.md"), /- CANCELED Docs · Extra polish\n/)
})

test("monthly archives that a sync tool renamed to NFD are reused, not taken for other pages", async () => {
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace({
    [nfd("완료.md")]: "# 완료\n최근에 끝낸 항목입니다.\n",
    [nfd("완료/완료 2026.md")]: "# 완료 2026\n2026년에 끝낸 항목 1건과 노드 0개입니다.\n",
    [nfd("완료/완료 2026/완료 2026-10.md")]: "# 완료 2026-10\n2026년 10월에 끝낸 항목 1건과 노드 0개입니다.\n\n- DONE 문서 · 이전 항목\n",
    "projects/참고.md": "# 참고\n나중에 읽을 내용.\n",
  }, { locale: "ko" })
  await archive(ws, { node: "참고", now: new Date(2026, 9, 12) })
  const pages = walkGraph(ws).pages
  assert.equal(new Set(pages.map((page) => page.name)).size, pages.length)
  const month = pages.find((page) => page.name === "완료 2026-10")
  assert.match(readFileSync(month.path, "utf8"), /^# 완료 2026-10\n2026년 10월에 끝낸 항목 1건과 노드 1개입니다\.\n\n- DONE 문서 · 이전 항목\n/)
  assert.ok(pages.find((page) => page.name === "참고").path.normalize("NFC").endsWith("완료/완료 2026/완료 2026-10/참고.md"))
})

test("overflow joins the list already in its month without a blank line", async () => {
  const done = Array.from({ length: 5 }, (_, i) => `- DONE Docs · kept ${i}\n`).join("")
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nSummary.\n\n- DONE newest\n",
    "Done.md": `# Done\nRecently finished.\n\n${done}`,
    "Done/Done 2026.md": "# Done 2026\nSummary.\n",
    "Done/Done 2026/Done 2026-10.md": "# Done 2026-10\nSummary.\n\n- DONE Docs · earlier\n\t- DONE child\n",
  })
  assert.equal((await archive(ws, { now: new Date(2026, 9, 12) })).removed, 1)
  assert.match(read(ws, "Done/Done 2026/Done 2026-10.md"), /\n- DONE Docs · earlier\n\t- DONE child\n- DONE Docs · kept 4\n/)
})

test("overflow starts right below a heading that ends its month", async () => {
  const done = Array.from({ length: 5 }, (_, i) => `- DONE Docs · kept ${i}\n`).join("")
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nSummary.\n\n- DONE newest\n",
    "Done.md": `# Done\nRecently finished.\n\n${done}`,
    "Done/Done 2026.md": "# Done 2026\nSummary.\n",
    "Done/Done 2026/Done 2026-10.md": "# Done 2026-10\nSummary.\n\n## Notes\n",
  })
  await archive(ws, { now: new Date(2026, 9, 12) })
  assert.match(read(ws, "Done/Done 2026/Done 2026-10.md"), /\n\n## Notes\n- DONE Docs · kept 4\n/)
})

test("a path right below the file system root keeps its whole name", () => {
  assert.equal(existingPath("/없는-폴더-excudo"), "/없는-폴더-excudo")
})

test("an item with an open child stays", async () => {
  const ws = await workspace({ "projects/Docs.md": "# Docs\n\nSummary.\n\n- DONE group\n\t- TODO still open\n" })
  const result = await archive(ws)
  assert.deepEqual([result.moved, result.skipped.length], [0, 1])
})

test("nested items move with their children and the Done node is created", async () => {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\n\nSummary.\n\n- TODO parent\n\t- DONE child\n\t\t- DONE grandchild\n\t  note:: kept\n",
  })
  assert.equal((await archive(ws)).moved, 1)
  assert.equal(read(ws, "projects/Docs.md"), "# Docs\n\nSummary.\n\n- TODO parent\n")
  assert.equal(read(ws, "Done.md"), "# Done\nThe most recently finished items.\n\n- DONE Docs · child\n\t- DONE grandchild\n  note:: kept\n")
})
