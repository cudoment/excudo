import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { build, exportStatus, writeExports } from "../src/index.mjs"
import { readLine } from "../src/exports.mjs"
import { SKILLS_DIR } from "../src/skills.mjs"
import { put, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const tracker = { name: "tracker", url: "https://tracker.example.com", key: "SITE-\\d+", label: "Tracker" }
const board = { name: "board", url: "https://board.example.com", label: "Board", node: "Requests" }
const todo = {
  name: "todo", file: "todo.md", retitle: ["board"],
  sections: [
    { heading: "- Now", states: ["DOING"], line: "{title}" },
    { nodes: ["Requests"], keyed: true, without: ["later", "Someday"], line: "- [{key}] {title} {links}", child: "  ㄴ{title} {links}", gap: 1 },
  ],
}

/** Work with a key, a tag and notes below it, requests from a board, a someday node, knowledge and a journal. */
async function memo(exports = [todo]) {
  const ws = await workspace({
    "Work.md": "# Work\nCurrent work.\n\n- DOING Ship the site redesign\n- TODO Fix the search box [SITE-12](https://tracker.example.com/browse/SITE-12) #later\n"
      + "- TODO Review the API text [SITE-14](https://tracker.example.com/browse/SITE-14)\n  The review needs the new screenshots.\n"
      + "\t- Send the draft to the designer https://board.example.com/posts/7#comment_3\n\t- DONE Collect the old screenshots\n"
      + "\t- TODO Check the legal note [SITE-15](https://tracker.example.com/browse/SITE-15)\n- TODO Plain idea\n",
    "Work/Requests.md": "# Requests\nRequests from the board.\n\n- TODO Weekly report request · Team board [Board](https://board.example.com/posts/1)\n"
      + "- TODO Fix the footer typo [Board](https://board.example.com/posts/2)\n",
    "Someday.md": "# Someday\nOne day.\n\n- TODO Learn the cello [SITE-20](https://tracker.example.com/browse/SITE-20)\n",
    "Knowledge.md": "# Knowledge\nWhat agents keep.\n\n- TODO Not work [SITE-99](https://tracker.example.com/browse/SITE-99)\n",
    "journals/2026_10_14.md": "- DOING Call the printer\n",
  }, { knowledge: ["Knowledge"], sources: [tracker, board], exports })
  writeFileSync(join(ws.root, "sources.json"), JSON.stringify({ board: { items: {
    1: { url: "https://board.example.com/posts/1", title: "Weekly report request · Team board" },
    2: { url: "https://board.example.com/posts/2", title: "Footer request · Team board" },
  } } }))
  return ws
}

const expected = `- Now
Ship the site redesign
Call the printer

- [SITE-14] Review the API text
  ㄴThe review needs the new screenshots.
  ㄴSend the draft to the designer https://board.example.com/posts/7#comment_3
  ㄴCheck the legal note

- [] Weekly report request · Team board https://board.example.com/posts/1

- [] Fix the footer typo https://board.example.com/posts/2
`

test("a line gives its state, words, keys, links and the tags and pages it names", () => {
  const reading = { key: /^(?:SITE-\d+)$/, labels: new Set(["Board"]) }
  assert.deepEqual(readLine("TODO [#A] Fix [[Search box]] [SITE-1](https://t.example.com/SITE-1) [Board](https://b.example.com/p/1) see https://x.example.com/a_(b) #later **now**", reading),
    { state: "TODO", title: "Fix Search box see now", keys: ["SITE-1"], links: ["https://b.example.com/p/1", "https://x.example.com/a_(b)"], tags: ["later", "Search box"] })
  assert.equal(readLine("A [guide](https://g.example.com/1) to read", reading).title, "A guide to read", "a link with its own words keeps them")
})

test("an export writes the picked tasks in the owner's format, and lists those still titled by their source", async () => {
  const ws = await memo()
  const [result] = writeExports(ws)
  assert.deepEqual([result.state, result.items], ["written", 5])
  assert.equal(readFileSync(join(ws.root, "todo.md"), "utf8"), expected)
  assert.deepEqual(result.retitle, [{ title: "Weekly report request · Team board", url: "https://board.example.com/posts/1", page: "Work/Requests.md", line: 4 }])
  assert.equal(writeExports(ws)[0].state, "current")
})

test("build keeps an export current, never overwrites a file edited by hand or one it did not write, and force replaces it", async () => {
  const ws = await memo([todo, { ...todo, name: "other", file: "other.md", retitle: [] }])
  writeFileSync(join(ws.root, "other.md"), "The owner's own file.\n")
  let built = build(ws)
  assert.deepEqual(built.exports.map((item) => [item.name, item.state]), [["todo", "written"], ["other", "exists"]])
  assert.equal(readFileSync(join(ws.root, "other.md"), "utf8"), "The owner's own file.\n")
  assert.equal(built.blocked.length, 0, "a file left alone does not stop the build")

  put(ws.root, "Work/Requests.md", "# Requests\nRequests from the board.\n\n- TODO Fix the footer typo [Board](https://board.example.com/posts/2)\n")
  assert.deepEqual(exportStatus(ws, { only: "todo" }).map((item) => item.state), ["outdated"])
  assert.match(readFileSync(join(ws.root, "todo.md"), "utf8"), /Weekly report/, "a dry run writes nothing")
  assert.equal(build(ws).exports[0].state, "written")
  assert.doesNotMatch(readFileSync(join(ws.root, "todo.md"), "utf8"), /Weekly report/)

  writeFileSync(join(ws.root, "todo.md"), "- My own line\n")
  built = build(ws)
  assert.equal(built.exports[0].state, "edited")
  assert.equal(readFileSync(join(ws.root, "todo.md"), "utf8"), "- My own line\n")
  assert.equal(writeExports(ws, { only: "todo", force: true })[0].state, "written")
  assert.equal(writeExports(ws, { only: "other", force: true })[0].state, "written")
  assert.throws(() => writeExports(ws, { only: "nope" }), /nope/)
})

test("a kept part keeps what the owner wrote there across rewrites, and an included file is written as another tool left it", async () => {
  const report = {
    name: "report", file: "report.md", sections: [
      { heading: "# This week", include: "parts/week.md" },
      { heading: "## Notes", keep: "notes" },
      { heading: "## Now", states: ["DOING"], line: "- {title}" },
    ],
  }
  const ws = await memo([report])
  const file = join(ws.root, "report.md")
  const marks = ["<!-- notes -->", "<!-- end of notes -->"]
  assert.equal(writeExports(ws)[0].state, "written")
  assert.equal(readFileSync(file, "utf8"), `# This week\n\n## Notes\n${marks.join("\n")}\n\n## Now\n- Ship the site redesign\n- Call the printer\n`,
    "an included file not written yet leaves its heading, and a new kept part is empty")

  mkdirSync(join(ws.root, "parts"))
  writeFileSync(join(ws.root, "parts", "week.md"), "- Shipped the footer fix\n\n")
  const own = "Ask about the cello\n\n  - [ ] call back"
  writeFileSync(file, readFileSync(file, "utf8").replace(marks.join("\n"), `${marks[0]}\n${own}\n${marks[1]}`))
  put(ws.root, "Work.md", "# Work\nCurrent work.\n\n- DOING Ship the site redesign\n- DOING Plan the launch\n")
  assert.equal(build(ws).exports[0].state, "written", "an edit inside the kept part is not an edit by hand")
  const text = readFileSync(file, "utf8")
  assert.equal(text, `# This week\n- Shipped the footer fix\n\n## Notes\n${marks[0]}\n${own}\n${marks[1]}\n\n## Now\n- Ship the site redesign\n- Plan the launch\n- Call the printer\n`)
  assert.equal(writeExports(ws)[0].state, "current")

  writeFileSync(file, text.replace(own, "Only this now"))
  assert.equal(exportStatus(ws)[0].state, "current", "a changed kept part is still current")
  writeFileSync(file, text.replace("## Now", "## Today"))
  assert.equal(build(ws).exports[0].state, "edited", "an edit outside the kept part is an edit by hand")
  writeFileSync(file, text.replace(`${marks[1]}\n`, ""))
  assert.equal(build(ws).exports[0].state, "edited", "a kept part without its end is no kept part")
  assert.equal(writeExports(ws, { force: true })[0].state, "written")
  assert.doesNotMatch(readFileSync(file, "utf8"), /Ask about the cello/, "force writes the frame again")
})

test("a padded kept part keeps blank lines inside its comment lines, writes the same every time and may go without a heading", async () => {
  const report = { name: "report", file: "report.md", sections: [{ heading: "## Now", states: ["DOING"], line: "- {title}" }, { keep: "notes", pad: 1 }] }
  const ws = await memo([report])
  const file = join(ws.root, "report.md")
  const marks = ["<!-- notes -->", "<!-- end of notes -->"]
  const now = "## Now\n- Ship the site redesign\n- Call the printer\n\n"
  assert.equal(writeExports(ws)[0].state, "written")
  assert.equal(readFileSync(file, "utf8"), `${now}${marks[0]}\n\n${marks[1]}\n`, "an empty padded part leaves one blank line to type into, and needs no heading")

  writeFileSync(file, readFileSync(file, "utf8").replace(`${marks[0]}\n\n`, `${marks[0]}\nAsk about the cello\n\n\n`))
  assert.equal(writeExports(ws)[0].state, "written", "an edit inside the part is not an edit by hand")
  const padded = `${now}${marks[0]}\n\nAsk about the cello\n\n${marks[1]}\n`
  assert.equal(readFileSync(file, "utf8"), padded, "the owner's blank edges give way to the pad")
  assert.equal(writeExports(ws)[0].state, "current", "a rewrite writes the same")

  ws.exports = [{ ...report, sections: [report.sections[0], { keep: "notes", pad: 2 }] }]
  assert.equal(writeExports(ws)[0].state, "written", "a changed pad is no edit by hand")
  assert.equal(readFileSync(file, "utf8"), `${now}${marks[0]}\n\n\nAsk about the cello\n\n\n${marks[1]}\n`)
  ws.exports = [report]
  assert.equal(writeExports(ws)[0].state, "written")
  assert.equal(readFileSync(file, "utf8"), padded)

  for (const pad of [-1, 1.5, 4, "1"]) {
    ws.exports = [{ ...report, sections: [report.sections[0], { keep: "notes", pad }] }]
    assert.throws(() => writeExports(ws), /pad/, `pad ${JSON.stringify(pad)} is refused`)
  }
  ws.exports = [{ ...report, sections: [report.sections[0], { include: "parts/week.md", pad: 1 }] }]
  assert.throws(() => writeExports(ws), /pad/, "an included file takes no pad")
})

test("an ordered section keeps the order the owner left, adds new tasks at the end, and moving entries alone is no edit by hand", async () => {
  const ordered = {
    name: "todo", file: "todo.md", sections: [
      { heading: "## Work", states: ["DOING"], keyed: true, without: ["later"], order: "file", line: "- [{key}] {title}", child: "  ㄴ{title}", deadline: "  ㄴ[{month}/{day}]", gap: 1 },
      { heading: "## Notes", keep: "notes" },
    ],
  }
  const ws = await memo([ordered])
  const file = join(ws.root, "todo.md")
  assert.equal(writeExports(ws)[0].state, "written")
  const [head, rest] = readFileSync(file, "utf8").split("\n\n## Notes")
  const entries = head.replace("## Work\n", "").split("\n\n")
  assert.deepEqual(entries.map((entry) => entry.split("\n")[0]), ["- [SITE-20] Learn the cello", "- [] Ship the site redesign", "- [SITE-14] Review the API text", "- [] Call the printer"])
  // The owner puts the last entry first and the review before the redesign.
  const moved = [entries[3], entries[0], entries[2], entries[1]]
  writeFileSync(file, `## Work\n${moved.join("\n\n")}\n\n## Notes${rest}`)
  assert.equal(build(ws).exports[0].state, "current", "moving entries alone is no edit by hand, and the order holds")

  put(ws.root, "Work.md", readFileSync(join(ws.graphDir, "Work.md"), "utf8")
    .replace("  The review needs", "  DEADLINE: <2026-10-27 Tue>\n  The review needs").replace("- TODO Plain idea", "- DOING Plain idea"))
  assert.equal(build(ws).exports[0].state, "written")
  const text = readFileSync(file, "utf8")
  assert.deepEqual(text.split("\n\n## Notes")[0].replace("## Work\n", "").split("\n\n").map((entry) => entry.split("\n")[0]),
    ["- [] Call the printer", "- [SITE-20] Learn the cello", "- [SITE-14] Review the API text", "- [] Ship the site redesign", "- [] Plain idea"], "a new task joins at the end")
  assert.match(text, /- \[SITE-14\] Review the API text\n(  ㄴ.*\n){3}  ㄴ\[10\/27\]\n/, "the deadline line follows the task's notes")

  writeFileSync(file, text.replace("Learn the cello", "Learn the viola"))
  assert.equal(build(ws).exports[0].state, "edited", "a changed entry is an edit by hand")
  writeFileSync(file, text)
  assert.equal(build(ws).exports[0].state, "current")

  ws.exports = [{ ...ordered, sections: [{ ...ordered.sections[0], order: undefined }, ordered.sections[1]] }]
  assert.equal(writeExports(ws, { force: true })[0].state, "written", "without the order the memo's order comes back")
  const plain = readFileSync(file, "utf8")
  const swapped = plain.replace("- [] Ship the site redesign\n\n", "").replace("## Notes", "- [] Ship the site redesign\n\n## Notes")
  writeFileSync(file, swapped)
  assert.equal(build(ws).exports[0].state, "edited", "a section without the order counts a move as an edit")

  for (const [change, pattern] of [[{ order: "file", heading: undefined }, /sections\[0\]\.order/], [{ order: "newest" }, /sections\[0\]\.order/], [{ deadline: "{title}" }, /\{title\}/]]) {
    ws.exports = [{ ...ordered, sections: [{ ...ordered.sections[0], ...change }] }]
    assert.throws(() => exportStatus(ws), pattern)
  }
})

test("a section written once leaves out a task the file already shows above it, by its key or its link", async () => {
  const once = {
    name: "week", file: "week.md", sections: [
      { heading: "# Report", include: "parts/report.md" },
      { heading: "## Work", keyed: true, nodes: ["Requests"], without: ["later", "Someday"], once: true, line: "- [{key}] {title} {links}", child: "  ㄴ{title}", gap: 1 },
    ],
  }
  const ws = await memo([once])
  const file = join(ws.root, "week.md")
  mkdirSync(join(ws.root, "parts"))
  writeFileSync(join(ws.root, "parts", "report.md"), "- [SITE-14] API text review\n  ㄴ[40%]\n- Footer fix https://board.example.com/posts/2/\n- Another request https://board.example.com/posts/12\n- Its files https://board.example.com/posts/1/files\n")
  assert.equal(writeExports(ws)[0].state, "written")
  const work = readFileSync(file, "utf8").split("## Work\n")[1]
  assert.equal(work, "- [] Weekly report request · Team board https://board.example.com/posts/1\n",
    "the task whose key the report shows and the one whose link it shows are written once, in the report")

  writeFileSync(join(ws.root, "parts", "report.md"), "- Nothing yet\n")
  assert.equal(writeExports(ws)[0].state, "written")
  assert.match(readFileSync(file, "utf8"), /- \[SITE-14\] Review the API text\n(  ㄴ.*\n){3}\n- \[\] Weekly report request[^\n]*\n\n- \[\] Fix the footer typo/,
    "a task the report no longer shows comes back with its notes")

  ws.exports = [{ ...once, sections: [once.sections[0], { ...once.sections[1], once: "yes" }] }]
  assert.throws(() => exportStatus(ws), /sections\[1\]\.once/)
})

test("a file an export wrote before the workspace moved is still its own, by the moved setting", async () => {
  const ws = await memo()
  assert.equal(build(ws).exports[0].state, "written")
  // As the record reads when the workspace sat in another folder.
  const record = join(ws.cacheDir, "exports.json")
  const state = JSON.parse(readFileSync(record, "utf8"))
  state.todo.path = "/no/such/folder-before-the-move/todo.md"
  writeFileSync(record, JSON.stringify(state))
  put(ws.root, "Work/Requests.md", "# Requests\nRequests from the board.\n\n- TODO Fix the footer typo [Board](https://board.example.com/posts/2)\n")
  assert.equal(exportStatus(ws, { only: "todo" })[0].state, "exists", "a record of another folder is not this file's")
  ws.moved = { "/no/such/folder-before-the-move": ws.root }
  assert.equal(build(ws).exports[0].state, "written")
  assert.doesNotMatch(readFileSync(join(ws.root, "todo.md"), "utf8"), /Weekly report/)
})

test("an export is checked: outside the graph, known fields and states, item sources to retitle", async () => {
  const ws = await memo()
  const bad = (change, pattern) => {
    ws.exports = [{ ...todo, ...change }]
    assert.throws(() => exportStatus(ws), pattern)
  }
  bad({ file: "notes/todo.md" }, /exports\[0\]: file/)
  bad({ retitle: ["nope"] }, /retitle/)
  bad({ sections: [{ line: "{title} {owner}" }] }, /\{owner\}/)
  bad({ sections: [{ states: ["DONE"], line: "{title}" }] }, /states/)
  bad({ sections: [] }, /sections/)
  bad({ sections: [{ keep: "notes", line: "{title}" }] }, /sections\[0\]\.line/)
  bad({ sections: [{ keep: "notes", include: "part.md" }] }, /sections\[0\]/)
  bad({ sections: [{ keep: "notes" }, { keep: "notes" }] }, /sections\[1\]\.keep/)
  bad({ sections: [{ keep: "a -->" }] }, /sections\[0\]\.keep/)
  bad({ sections: [{ include: " " }] }, /sections\[0\]\.include/)
  ws.exports = []
  assert.deepEqual(exportStatus(ws), [])
  assert.ok(!existsSync(join(ws.root, "todo.md")))
})

test("export says what became of each file and exits 2 when one was left alone", async () => {
  const ws = await memo()
  const run = (...args) => spawnSync(process.execPath, [cli, "export", "--root", ws.root, ...args], { encoding: "utf8", timeout: 60000 })
  let result = run("--dry-run")
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /todo: todo\.md is not written yet \(5 tasks\)/)
  assert.match(result.stdout, /todo: 1 tasks still carry the title their source gave/)
  assert.match(result.stdout, /Work\/Requests\.md:4 Weekly report request/)
  result = run()
  assert.match(result.stdout, /todo: wrote todo\.md \(5 tasks\)/)
  writeFileSync(join(ws.root, "todo.md"), "edited\n")
  result = run()
  assert.equal(result.status, 2)
  assert.match(result.stderr, /changed by hand/)
  assert.equal(JSON.parse(run("--json", "--force").stdout)[0].state, "written")
})

test("the export skill's check judges a real workspace", async () => {
  const ws = await memo()
  const git = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: ws.root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nnode_modules/\n")
  git("add", "-A")
  git("commit", "-qm", "start")
  const check = () => spawnSync(process.execPath, [join(SKILLS_DIR, "excudo-export", "scripts", "check.mjs")], { cwd: ws.root, encoding: "utf8", timeout: 60000 })
  let result = check()
  assert.equal(result.status, 1)
  assert.match(result.stdout, /✗ current: .*todo\.md \(not written yet\)/)
  assert.match(result.stdout, /✗ retitled: .*Weekly report request/)

  writeExports(ws)
  result = check()
  assert.match(result.stdout, /✓ current/)
  assert.match(result.stdout, /✗ ignored: .*todo\.md/)
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nnode_modules/\n/todo.md\n")
  put(ws.root, "Work/Requests.md", "# Requests\nRequests from the board.\n\n- TODO Write the weekly report [Board](https://board.example.com/posts/1)\n"
    + "- TODO Fix the footer typo [Board](https://board.example.com/posts/2)\n")
  result = check()
  assert.match(result.stdout, /✓ retitled/)
  assert.match(result.stdout, /✓ ignored/)
  assert.match(result.stdout, /✗ current: .*behind the memo/)
  assert.match(result.stdout, /✗ saved/)
  build(ws)
  git("add", "-A")
  git("commit", "-qm", "titles")
  result = check()
  assert.equal(result.status, 0, result.stdout)
})
