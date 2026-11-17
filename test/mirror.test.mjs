import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"
import { markMirror, mirror, mirrorsOf, mirrorText, writeExports } from "../src/index.mjs"
import { put, read, workspace } from "./helpers.mjs"

function git(dir, ...args) {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=Owner", "-c", "user.email=owner@example.invalid", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}
const HOME = "# Home\nWhat I do.\n\n## Plans\n- ### Life · [[Me]]\n\t- TODO pay the rent\n- [[More]]\n\n## Work\n- {{query (task TODO)}}\n"
const BOARD = "# Board\nThe board.\n\n- Life\n\t- call the bank\n- Books\n\t- read a novel\n"
const MIRROR = { name: "plans", places: [{ page: "Home", section: "Plans", tasks: true }, { export: "weekly", region: "Plans" }, { board: "Board" }, { note: "keep", item: "ㄴ " }] }
async function repo() {
  const ws = await workspace({ "Home.md": HOME, "Board.md": BOARD, "Me.md": "# Me\nMe.\n", "More.md": "# More\nMore.\n" },
    { locale: "en", exports: [{ name: "weekly", file: "weekly.md", sections: [{ heading: "# Week", keep: "Plans", pad: 1 }] }], mirrors: [MIRROR] })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nweekly.md\n")
  writeExports(ws)
  git(ws.root, "init", "-q")
  git(ws.root, "add", ".")
  git(ws.root, "commit", "-qm", "Notes")
  return ws
}
const ago = (path, minutes) => { const time = new Date(Date.now() - minutes * 60000); utimesSync(path, time, time) }
const keep = (...blocks) => ({ markers: 2, blocks: blocks.map(([heading, ...lines]) => ({ heading, lines })) })
const region = (ws) => readFileSync(join(ws.root, "weekly.md"), "utf8").split("<!-- Plans -->")[1].split("<!-- end of Plans -->")[0].trim()

test("a mirror checks its places", async () => {
  const ws = await repo()
  assert.equal(mirrorsOf(ws)[0].places.length, 4)
  ws.mirrors = [{ name: "x", places: [{ page: "Home" }, { board: "Board" }] }]
  assert.throws(() => mirrorsOf(ws), /section/)
  ws.mirrors = [{ name: "x", places: [{ board: "Board" }] }]
  assert.throws(() => mirrorsOf(ws), /places/)
})

test("an export place rejects an empty or non-string item marker", async () => {
  const ws = await repo()
  for (const item of ["", "  ", null, 1]) {
    ws.mirrors = [{ name: "plans", places: [{ page: "Home", section: "Plans" }, { export: "weekly", region: "Plans", item }] }]
    assert.throws(() => mirrorsOf(ws), /places\[1\]\.item/)
  }
})

for (const marker of ["ㄴ", " ㄴ ", undefined]) {
  for (const child of ["  ㄴchild", "  ㄴ child", "  - ㄴchild", "  - ㄴ child"]) {
    test(`an export reads ${JSON.stringify(child)} with item ${JSON.stringify(marker)} and preserves its depth`, async () => {
      const ws = await repo()
      ws.mirrors = [{ ...MIRROR, places: MIRROR.places.map((place) => place.export ? { ...place, item: marker } : place) }]
      const notes = { keep: keep(["Life"]) }
      mirror(ws, "plans", { settle: 0, notes })
      const file = join(ws.root, "weekly.md")
      writeFileSync(file, readFileSync(file, "utf8").replace("- pay the rent", `- parent\n${child}`))
      const result = mirror(ws, "plans", { settle: 0, notes })
      const text = marker === undefined ? child.replace(/^  (?:- )?/, "") : "child"
      assert.ok(result.list.includes("\t- parent"))
      assert.ok(result.list.includes(`\t\t- ${text}`))
      assert.ok(read(ws, "Home.md").includes(`\t- TODO parent\n\t\t- TODO ${text}\n`))
      assert.ok(result.notes.keep.lines.includes(`  ㄴ ${text}`))
      if (marker !== undefined) {
        assert.doesNotMatch(read(ws, "Home.md"), /ㄴ/)
      }
      // A later edit elsewhere makes the export write the usual list shape.
      put(ws.root, "Board.md", read(ws, "Board.md").replace("\t- call the bank", "\t- call the bank\n\t- another item"))
      mirror(ws, "plans", { settle: 0 })
      assert.ok(region(ws).includes(`- parent\n  - ${text}`))
      if (marker !== undefined) assert.doesNotMatch(region(ws), /ㄴ/)
      assert.equal(mirror(ws, "plans", { settle: 0 }).decision, "same")
    })
  }
}

test("the first run joins every place's list, and each place shows it in its own shape", async () => {
  const ws = await repo()
  const result = mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license"], ["Clothes", "ㄴ Goldwin"]) } })
  assert.equal(result.decision, "first")
  assert.deepEqual(result.list, ["- Life", "\t- pay the rent", "\t- call the bank", "\t- renew the license", "- Books", "\t- read a novel", "- Clothes", "\t- Goldwin"])
  // The page keeps its own line (link and task marker); new items are tasks, new topics heading blocks; other blocks stay.
  assert.equal(read(ws, "Home.md"), "# Home\nWhat I do.\n\n## Plans\n- ### Life · [[Me]]\n\t- TODO pay the rent\n\t- TODO call the bank\n\t- TODO renew the license\n- ### Books\n\t- TODO read a novel\n- ### Clothes\n\t- TODO Goldwin\n- [[More]]\n\n## Work\n- {{query (task TODO)}}\n")
  assert.equal(region(ws), "### Life\n- pay the rent\n- call the bank\n- renew the license\n\n### Books\n- read a novel\n\n### Clothes\n- Goldwin")
  assert.match(read(ws, "Board.md"), /- Clothes\n\t- Goldwin/)
  assert.deepEqual(result.notes.keep.lines, ["Life", "ㄴ pay the rent", "ㄴ call the bank", "ㄴ renew the license", "", "Books", "ㄴ read a novel", "", "Clothes", "ㄴ Goldwin"])
  assert.equal(result.notes.keep.write, true)
  assert.equal(git(ws.root, "status", "--porcelain").trim(), "")
  // Nothing changed: nothing to do.
  const again = mirror(ws, "plans", { settle: 0 })
  assert.equal(again.decision, "same")
  assert.deepEqual(again.wrote, [])
})

test("an edit in any place reaches the others, and a finished task leaves the list but stays on the page", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  // Board: an item added, with a line written under it.
  put(ws.root, "Board.md", read(ws, "Board.md").replace("\t- read a novel\n", "\t- read a novel\n\t- buy a lamp\n\t  the tall one\n"))
  let result = mirror(ws, "plans", { settle: 0 })
  assert.equal(result.decision, "taken")
  assert.match(read(ws, "Home.md"), /\t- TODO buy a lamp\n\t\t- TODO the tall one\n/)
  assert.match(region(ws), /- buy a lamp\n {2}- the tall one/)
  // Home: a task done.
  put(ws.root, "Home.md", read(ws, "Home.md").replace("\t- TODO pay the rent", "\t- DONE pay the rent"))
  result = mirror(ws, "plans", { settle: 0 })
  assert.doesNotMatch(read(ws, "Board.md"), /pay the rent/)
  assert.doesNotMatch(region(ws), /pay the rent/)
  assert.match(read(ws, "Home.md"), /\t- DONE pay the rent\n/)
  // The export file: an item removed there leaves every place.
  writeFileSync(join(ws.root, "weekly.md"), readFileSync(join(ws.root, "weekly.md"), "utf8").replace("- call the bank\n", ""))
  mirror(ws, "plans", { settle: 0 })
  assert.doesNotMatch(read(ws, "Home.md"), /call the bank/)
  assert.doesNotMatch(read(ws, "Board.md"), /call the bank/)
})

test("recent mirror writes do not defer another run, but a recent edit does", async () => {
  const ws = await repo()
  assert.match(mirror(ws, "plans").deferred, /last 2 minutes/)
  mirror(ws, "plans", { settle: 0 })
  assert.equal(mirror(ws, "plans").deferred, null)
  put(ws.root, "Home.md", read(ws, "Home.md").replace("What I do.", "What I plan."))
  assert.match(mirror(ws, "plans").deferred, /Home.*last 2 minutes/)
  ago(join(ws.graphDir, "Home.md"), 3)
  assert.equal(mirror(ws, "plans").deferred, null)
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  assert.match(mirror(ws, "plans").deferred, /Board.*last 2 minutes/)
  ago(join(ws.graphDir, "Board.md"), 3)
  assert.equal(mirror(ws, "plans").deferred, null)
  assert.match(read(ws, "Home.md"), /read two novels/)
  assert.equal(mirror(ws, "plans").deferred, null)
})

test("where two places changed the same line the later wins, and the earlier is kept in an overlap item", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Home.md", read(ws, "Home.md").replace("TODO read a novel", "TODO read a long novel"))
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read a short novel"))
  ago(join(ws.graphDir, "Board.md"), 3)
  const result = mirror(ws, "plans", { settle: 0 })
  assert.equal(result.decision, "merged")
  assert.match(read(ws, "Board.md"), /\t- read a short novel\n- Overlapping edits · Board [^\n]+\n\t- read a long novel/)
  assert.match(read(ws, "Home.md"), /\t- TODO read a short novel\n/)
})

test("a note the workspace has not written yet is not read as the owner removing what it lacks", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license"]) } })
  // The note was not written: it still holds only its own line. Nothing leaves the list.
  let result = mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license"]) } })
  assert.equal(result.decision, "same")
  assert.match(read(ws, "Board.md"), /call the bank/)
  assert.equal(result.notes.keep.write, true)
  // The owner adds a line in the note: only that edit comes in.
  result = mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license", "ㄴ fix the car"]) } })
  assert.match(read(ws, "Home.md"), /\t- TODO fix the car\n/)
  assert.match(read(ws, "Board.md"), /call the bank/)
  // The workspace wrote the note and records it: the note is in step.
  const written = keep(["Life", ...result.notes.keep.lines.slice(1, result.notes.keep.lines.indexOf(""))], ["Books", "ㄴ read a novel"])
  const marked = markMirror(ws, "plans", { wrote: { keep: result.notes.keep.lines }, notes: { keep: written } })
  assert.equal(marked.marked[0].inStep, true)
  assert.equal(mirror(ws, "plans", { settle: 0, notes: { keep: written } }).notes.keep.write, false)
})

test("what was written is a note's base, so an edit made while it was written is merged next time", async () => {
  const ws = await repo()
  const first = mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ pay the rent"]) } })
  // The owner changed the note right after it was written: the read-again note differs from what was written.
  const lines = first.notes.keep.lines.map((line) => line.replace("call the bank", "call the bank today"))
  const blocks = []
  for (const line of lines) if (!line) blocks.push(null); else if (!blocks.length || blocks.at(-1) === null) blocks.push([line]); else blocks.at(-1).push(line)
  const marked = markMirror(ws, "plans", { wrote: { keep: first.notes.keep.lines }, notes: { keep: keep(...blocks.filter(Boolean)) } })
  assert.equal(marked.marked[0].inStep, false)
  const next = mirror(ws, "plans", { settle: 0, notes: { keep: keep(...blocks.filter(Boolean)) } })
  assert.equal(next.decision, "taken")
  assert.match(read(ws, "Board.md"), /call the bank today/)
  assert.equal(next.notes.keep.write, false)
})

test("a note's edit taken while the note waits to be written is not taken again over a later edit", async () => {
  const ws = await repo()
  // The note lacks the Life topic the other places have, so it never holds the whole list until it is written.
  mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Books", "ㄴ read a novel"]) } })
  const edited = keep(["Books", "ㄴ read a long novel"])
  mirror(ws, "plans", { settle: 0, notes: { keep: edited } })
  assert.match(read(ws, "Board.md"), /read a long novel/)
  // The board changes the same line later, without the note.
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a long novel", "read a short novel"))
  ago(join(ws.graphDir, "Board.md"), 1)
  mirror(ws, "plans", { settle: 0 })
  // The note, unchanged since, comes again: nothing is taken from it, and the later edit stays.
  const again = mirror(ws, "plans", { settle: 0, notes: { keep: edited } })
  assert.equal(again.decision, "same")
  assert.deepEqual(again.overlap, [])
  assert.match(read(ws, "Board.md"), /read a short novel/)
  assert.equal(again.notes.keep.write, true)
})

test("the first run keeps an item under each of its parents", async () => {
  const ws = await repo()
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- Life\n\t- call the bank\n\t\t- ask about the card\n\t- pay the rent\n\t\t- ask about the card\n")
  const result = mirror(ws, "plans", { settle: 0 })
  assert.deepEqual(result.list, ["- Life", "\t- pay the rent", "\t\t- ask about the card", "\t- call the bank", "\t\t- ask about the card"])
})

test("finished items stay on the page when another place renames or removes their topic", async () => {
  const ws = await repo()
  put(ws.root, "Home.md", HOME.replace("\t- TODO pay the rent\n", "\t- DONE paid in May\n\t- TODO pay the rent\n"))
  ago(join(ws.graphDir, "Home.md"), 5)
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", read(ws, "Board.md").replace("- Life\n", "- Home life\n"))
  ago(join(ws.graphDir, "Board.md"), 3)
  mirror(ws, "plans", { settle: 0 })
  assert.match(read(ws, "Home.md"), /- ### Home life\n(?:\t- [^\n]*\n)*\t- DONE paid in May\n/)
  put(ws.root, "Board.md", read(ws, "Board.md").replace(/- Home life\n(?:\t[^\n]*\n)*/, ""))
  ago(join(ws.graphDir, "Board.md"), 1)
  mirror(ws, "plans", { settle: 0 })
  assert.match(read(ws, "Home.md"), /\t- DONE paid in May\n/)
  assert.doesNotMatch(read(ws, "Home.md"), /Home life/)
})

test("a mirror refuses two places in one file, and waits while the memo is paused or the export file is held", async () => {
  const ws = await repo()
  ws.mirrors = [{ name: "x", places: [{ page: "Home", section: "Plans" }, { page: "Home", section: "Work" }] }]
  assert.throws(() => mirrorsOf(ws), /places\[1\]/)
  ws.mirrors = [{ name: "x", places: [{ page: "Board", section: "Plans" }, { board: "Board" }] }]
  assert.throws(() => mirrorsOf(ws), /places\[1\]/)
  ws.mirrors = [MIRROR]
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "More.md", "# More\nMore.\n\n- automation:: paused\n")
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  assert.match(mirror(ws, "plans", { settle: 0 }).deferred, /paused/)
  assert.doesNotMatch(read(ws, "Home.md"), /two novels/)
  put(ws.root, "More.md", "# More\nMore.\n")
  process.env.EXCUDO_HOLD = "weekly.md"
  try { assert.match(mirror(ws, "plans", { settle: 0 }).deferred, /held/) } finally { delete process.env.EXCUDO_HOLD }
  assert.match(mirror(ws, "plans", { settle: 0 }).decision, /taken/)
})

test("pages a run wrote but could not commit are committed by the next run", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  git(ws.root, "add", "-A")
  git(ws.root, "commit", "-qm", "Board")
  ago(join(ws.graphDir, "Board.md"), 5)
  const hook = join(ws.root, ".git", "hooks", "pre-commit")
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  const failed = mirror(ws, "plans", { settle: 0 })
  assert.deepEqual(failed.uncommitted.pages, ["Home.md"])
  assert.match(git(ws.root, "status", "--porcelain"), /Home\.md/)
  rmSync(hook)
  const next = mirror(ws, "plans", { settle: 0 })
  assert.deepEqual(next.wrote, [])
  assert.equal(next.committed, true)
  assert.equal(git(ws.root, "status", "--porcelain").trim(), "")
})

test("a mirror waits while a page is being written or held, and a note without its markers is not read", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  assert.match(mirror(ws, "plans", { settle: 2 }).deferred, /Board/)
  ago(join(ws.graphDir, "Board.md"), 5)
  process.env.EXCUDO_HOLD = "notes/Home.md"
  try { assert.match(mirror(ws, "plans", { settle: 2 }).deferred, /Home/) } finally { delete process.env.EXCUDO_HOLD }
  assert.throws(() => mirror(ws, "plans", { settle: 0, notes: { keep: { markers: 1, blocks: [] } } }), /marker/)
  ago(join(ws.graphDir, "Home.md"), 5)
  assert.equal(mirror(ws, "plans", { settle: 2 }).decision, "taken")
})

test("two exports of one file are one file, and items of the same words stay as many as they were", async () => {
  const ws = await repo()
  ws.exports = [...ws.exports, { name: "again", file: "weekly.md", sections: [{ heading: "# Again", keep: "More" }] }]
  ws.mirrors = [{ name: "x", places: [{ export: "weekly", region: "Plans" }, { export: "again", region: "More" }] }]
  assert.throws(() => mirrorsOf(ws), /places\[1\]/)
  ws.mirrors = [MIRROR]
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- Life\n\t- call the bank\n\t- call the bank\n")
  const result = mirror(ws, "plans", { settle: 0 })
  assert.deepEqual(result.list, ["- Life", "\t- pay the rent", "\t- call the bank", "\t- call the bank"])
})

test("moving a topic keeps each row's state and link with it", async () => {
  const ws = await repo()
  put(ws.root, "Home.md", "# Home\nWhat I do.\n\n## Plans\n- ### A\n\t- TODO same · [[Me]]\n- ### B\n\t- DOING same · [[More]]\n")
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- A\n\t- same\n- B\n\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 5)
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- B\n\t- same\n- A\n\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 1)
  mirror(ws, "plans", { settle: 0 })
  assert.match(read(ws, "Home.md"), /- ### B\n\t- DOING same · \[\[More\]\]\n+- ### A\n\t- TODO same · \[\[Me\]\]/)
})

test("a commit retried later holds what the run wrote, and a later edit stays for its own commit", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  git(ws.root, "add", "-A")
  git(ws.root, "commit", "-qm", "Board")
  ago(join(ws.graphDir, "Board.md"), 5)
  const hook = join(ws.root, ".git", "hooks", "pre-commit")
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  mirror(ws, "plans", { settle: 0 })
  rmSync(hook)
  // The owner edits Home's summary before the next run.
  put(ws.root, "Home.md", read(ws, "Home.md").replace("What I do.", "What I do now."))
  ago(join(ws.graphDir, "Home.md"), 5)
  const next = mirror(ws, "plans", { settle: 0 })
  assert.equal(next.committed, true)
  assert.match(git(ws.root, "show", `HEAD:${relative(ws.root, join(ws.graphDir, "Home.md"))}`), /What I do\.\n[\s\S]*read two novels/)
  assert.match(git(ws.root, "status", "--porcelain"), /Home\.md/)
})

test("a removed topic's finished items stay even when a row of the same words is written elsewhere", async () => {
  const ws = await repo()
  put(ws.root, "Home.md", "# Home\nWhat I do.\n\n## Plans\n- ### A\n\t- TODO same\n\t- DONE finished in A\n- ### B\n\t- DOING same\n")
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- A\n\t- same\n- B\n\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 5)
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- B\n\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 1)
  mirror(ws, "plans", { settle: 0 })
  assert.match(read(ws, "Home.md"), /- ### B\n\t- DOING same\n[\s\S]*\t- DONE finished in A/)
})

test("items of the same words added in two places at once stay as many as either place has", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", read(ws, "Board.md").replace("\t- read a novel\n", "\t- read a novel\n\t- buy a lamp\n\t- buy a lamp\n"))
  ago(join(ws.graphDir, "Board.md"), 5)
  put(ws.root, "Home.md", read(ws, "Home.md").replace("\t- TODO read a novel", "\t- TODO read a novel\n\t- TODO buy a lamp"))
  ago(join(ws.graphDir, "Home.md"), 3)
  const result = mirror(ws, "plans", { settle: 0 })
  assert.equal(result.list.filter((line) => line === "\t- buy a lamp").length, 2)
})

test("moving a parent keeps the state and link of each item under it", async () => {
  const ws = await repo()
  put(ws.root, "Home.md", "# Home\nWhat I do.\n\n## Plans\n- ### Life\n\t- TODO first\n\t\t- TODO same · [[Me]]\n\t- TODO second\n\t\t- DOING same · [[More]]\n")
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- Life\n\t- first\n\t\t- same\n\t- second\n\t\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 5)
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", "# Board\nThe board.\n\n- Life\n\t- second\n\t\t- same\n\t- first\n\t\t- same\n")
  ago(join(ws.graphDir, "Board.md"), 1)
  mirror(ws, "plans", { settle: 0 })
  assert.match(read(ws, "Home.md"), /\t- TODO second\n\t\t- DOING same · \[\[More\]\]\n\t- TODO first\n\t\t- TODO same · \[\[Me\]\]/)
})

test("a page written again after a failed commit gets what was written first, then the owner's edit, then the new list", async () => {
  const ws = await repo()
  mirror(ws, "plans", { settle: 0 })
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read a novel", "read two novels"))
  git(ws.root, "add", "-A")
  git(ws.root, "commit", "-qm", "Board")
  ago(join(ws.graphDir, "Board.md"), 5)
  const hook = join(ws.root, ".git", "hooks", "pre-commit")
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  mirror(ws, "plans", { settle: 0 })
  rmSync(hook)
  put(ws.root, "Home.md", read(ws, "Home.md").replace("What I do.", "What I do now."))
  ago(join(ws.graphDir, "Home.md"), 5)
  put(ws.root, "Board.md", read(ws, "Board.md").replace("read two novels", "read three novels"))
  git(ws.root, "commit", "-qm", "Board again", "--", relative(ws.root, join(ws.graphDir, "Board.md")))
  ago(join(ws.graphDir, "Board.md"), 3)
  const next = mirror(ws, "plans", { settle: 0 })
  assert.equal(next.committed, true)
  const home = relative(ws.root, join(ws.graphDir, "Home.md"))
  const log = git(ws.root, "log", "--format=%s", "-3", "--", home).trim().split("\n")
  assert.equal(log.length, 3)
  assert.match(git(ws.root, "show", `HEAD~2:${home}`), /What I do\.\n[\s\S]*read two novels/)
  assert.match(git(ws.root, "show", `HEAD~1:${home}`), /What I do now\.\n[\s\S]*read two novels/)
  assert.match(git(ws.root, "show", `HEAD:${home}`), /What I do now\.\n[\s\S]*read three novels/)
})

test("a text prepared for a note, pasted late, takes no edit, and mirror text gives the latest one", async () => {
  const ws = await repo()
  const asNote = (lines) => {
    const blocks = []
    for (const line of lines) if (!line) blocks.push(null); else if (!blocks.length || blocks.at(-1) === null) blocks.push([line]); else blocks.at(-1).push(line)
    return keep(...blocks.filter(Boolean))
  }
  const note = keep(["Life", "ㄴ renew the license"])
  const first = mirror(ws, "plans", { settle: 0, notes: { keep: note } })
  assert.equal(first.notes.keep.write, true)
  // The list changes on Home twice while the note waits: a new item, then an item removed.
  put(ws.root, "Home.md", read(ws, "Home.md").replace("\t- TODO renew the license\n", "\t- TODO renew the license\n\t- TODO buy milk\n"))
  mirror(ws, "plans", { settle: 0, notes: { keep: note } })
  put(ws.root, "Home.md", read(ws, "Home.md").replace("\t- TODO pay the rent\n", ""))
  const third = mirror(ws, "plans", { settle: 0, notes: { keep: note } })
  assert.doesNotMatch(read(ws, "Board.md"), /pay the rent/)
  // The owner pastes the first prepared text, now out of date: it is known, so nothing it lacks or holds is read as an edit.
  const late = mirror(ws, "plans", { settle: 0, notes: { keep: asNote(first.notes.keep.lines) } })
  assert.equal(late.decision, "same")
  assert.deepEqual(late.list, third.list)
  assert.doesNotMatch(read(ws, "Board.md"), /pay the rent/)
  assert.match(read(ws, "Board.md"), /buy milk/)
  assert.equal(late.notes.keep.write, true)
  // mirror text gives what the note should hold now; once pasted, the note is in step.
  const text = mirrorText(ws, "plans", "keep")
  assert.deepEqual(text.lines, late.notes.keep.lines)
  assert.equal(text.wanted, true)
  const pasted = mirror(ws, "plans", { settle: 0, notes: { keep: asNote(text.lines) } })
  assert.equal(pasted.decision, "same")
  assert.equal(pasted.notes.keep.write, false)
  assert.equal(mirrorText(ws, "plans").wanted, false)
  // An owner's edit after a paste is still an edit.
  const edited = mirror(ws, "plans", { settle: 0, notes: { keep: asNote(text.lines.map((line) => line.replace("buy milk", "buy oat milk"))) } })
  assert.equal(edited.decision, "taken")
  assert.match(read(ws, "Board.md"), /buy oat milk/)
  assert.throws(() => mirrorText(ws, "plans", "phone"), /no note/)
})

test("a text given out while the note was not read is known when pasted after a later change", async () => {
  const ws = await repo()
  const asNote = (lines) => {
    const blocks = []
    for (const line of lines) if (!line) blocks.push(null); else if (!blocks.length || blocks.at(-1) === null) blocks.push([line]); else blocks.at(-1).push(line)
    return keep(...blocks.filter(Boolean))
  }
  mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license"]) } })
  // The board gains an item in a run that does not read the note; the owner copies the text then.
  put(ws.root, "Board.md", read(ws, "Board.md").replace("\t- read a novel\n", "\t- read a novel\n\t- buy a lamp\n"))
  mirror(ws, "plans", { settle: 0 })
  const copied = mirrorText(ws, "plans", "keep")
  assert.ok(copied.lines.includes("ㄴ buy a lamp"))
  // The item is removed before the paste, again without reading the note.
  put(ws.root, "Board.md", read(ws, "Board.md").replace("\t- buy a lamp\n", ""))
  mirror(ws, "plans", { settle: 0 })
  const late = mirror(ws, "plans", { settle: 0, notes: { keep: asNote(copied.lines) } })
  assert.equal(late.decision, "same")
  assert.doesNotMatch(read(ws, "Board.md"), /buy a lamp/)
  assert.doesNotMatch(read(ws, "Home.md"), /buy a lamp/)
  assert.equal(late.notes.keep.write, true)
})

test("a text prepared again becomes the newest kept one, so a full history does not drop it", async () => {
  const ws = await repo()
  const asNote = (lines) => {
    const blocks = []
    for (const line of lines) if (!line) blocks.push(null); else if (!blocks.length || blocks.at(-1) === null) blocks.push([line]); else blocks.at(-1).push(line)
    return keep(...blocks.filter(Boolean))
  }
  mirror(ws, "plans", { settle: 0, notes: { keep: keep(["Life", "ㄴ renew the license"]) } })
  const board = read(ws, "Board.md")
  const first = mirrorText(ws, "plans").lines
  // Twenty more lists fill the history; the first one is given out again in between.
  for (let i = 0; i < 20; i++) {
    put(ws.root, "Board.md", board.replace("\t- read a novel\n", `\t- read a novel\n\t- item ${i}\n`))
    mirror(ws, "plans", { settle: 0 })
    if (i === 18) {
      put(ws.root, "Board.md", board)
      mirror(ws, "plans", { settle: 0 })
      assert.deepEqual(mirrorText(ws, "plans").lines, first)
    }
  }
  const late = mirror(ws, "plans", { settle: 0, notes: { keep: asNote(first) } })
  assert.equal(late.decision, "same")
  assert.match(read(ws, "Board.md"), /item 19/)
})
