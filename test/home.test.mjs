import assert from "node:assert/strict"
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { build, check, homeStatus, inbox, move, ownHome, remove, review } from "../src/index.mjs"
import { codes, outline, put, read, workspace } from "./helpers.mjs"

const HOME_VIEW = "# Home\n\n```cudoc-embed\nsources: [/]\nrender:\n  type: tree\n  open: 0\n  columns: [link, { value: { extractor: openTasks } }, summary]\n  order: [Beta, ..., Done]\n```\n\n## Now\n\n```outline\n- In progress\n\t- {{query (task DOING)}}\n- Waiting\n  collapsed:: true\n\t- {{query (task WAITING)}}\n```\n"

/** A graph whose Home the engine writes, built once. */
async function generatedHome(extra = {}) {
  const ws = await workspace({
    "views/Home.mdx": HOME_VIEW,
    "logseq/config.edn": '{:meta/version 1\n :default-home {:page "Home"}\n :favorites ["Home"]\n :hidden []}\n',
    "Done.md": "# Done\nFinished.\n",
    "projects/Alpha.md": "# Alpha\nAlpha summary.\n\n- TODO a\n",
    "projects/Alpha/Inner.md": "# Inner\nInner summary.\n",
    "projects/Beta.md": "# Beta\nBeta summary.\n",
    ...extra,
  })
  assert.equal(build(ws).blocked.length, 0)
  return ws
}

test("handing Home over keeps every node: Home becomes links and the tree moves to the Archive", async () => {
  const ws = await generatedHome()
  // The reader expanded Waiting on the generated Home; that choice survives the handover.
  put(ws.root, "Home.md", read(ws, "Home.md").replace("- Waiting\n  collapsed:: true\n", "- Waiting\n"))
  const result = ownHome(ws)
  assert.equal(result.built.blocked.length, 0)
  assert.equal(result.favorite, true)
  assert.equal(read(ws, "Home.md"), "- [[Beta]]\n- [[Alpha]]\n- [[Done]]\n- [[Archive]]\n\n## Now\n- In progress\n\t- {{query (task DOING)}}\n- Waiting\n\t- {{query (task WAITING)}}\n")
  assert.ok(!existsSync(join(ws.graphDir, "views/Home.mdx")))
  assert.match(read(ws, "views/Archive.mdx"), /^# Archive\n\n```cudoc-embed\nsources: \[\/\]/)
  assert.match(read(ws, "Archive.md"), /^generated:: views\/Archive\.mdx\n/)
  assert.deepEqual(outline(read(ws, "Archive.md")).map(([, name]) => name), ["Beta", "Alpha", "Inner", "Done"])
  assert.match(read(ws, "projects/Alpha/Inner.md"), /\nLocation: \[\[Archive\]\] › \[\[Alpha\]\] › Inner\n/)
  assert.match(readFileSync(join(ws.graphDir, "logseq/config.edn"), "utf8"), /:favorites \["Home" "Archive"\]/)
  assert.deepEqual(homeStatus(ws), { owned: true, home: "Home.md", archive: "Archive", linked: ["Beta", "Alpha", "Done"], embedded: [], missing: [], outside: [] })

  // From now on the owner writes Home: builds leave it alone and check holds no node rule against it.
  const mine = "- [[Alpha]] first\n- Later\n\t- [[Gone]]\n\n## Now\n- In progress\n"
  put(ws.root, "Home.md", mine)
  const again = build(ws)
  assert.deepEqual([again.blocked.length, again.errors.length], [0, 0])
  assert.equal(read(ws, "Home.md"), mine)
  const { issues, top } = await check(ws)
  assert.deepEqual(codes(issues), ["dangling-link"])
  assert.equal(issues[0].file, "Home.md")
  assert.equal(top.count, 2)
  assert.deepEqual(homeStatus(ws), { owned: true, home: "Home.md", archive: "Archive", linked: ["Alpha"], embedded: [], missing: ["Gone"], outside: ["Beta"] })
  assert.throws(() => ownHome(ws), /no generated Home view/)
})

test("a nodes view shows part of the tree by name, and a Home that embeds it reaches its nodes without copying their tasks", async () => {
  const ws = await generatedHome({
    "projects/Paused.md": "# Paused\nOn hold.\n\n- TODO later\n",
    "projects/Alpha/Inner/Deep.md": "# Deep\nDeep summary.\n",
    "views/Thinking.mdx": "# Thinking\n\n```nodes\ndepth: 2\nexcept: [Paused]\n```\n",
    "views/Inside.mdx": "# Inside\n\n```nodes\nfrom: Alpha\n```\n",
  })
  // In the order of the tree, without Done, Paused or the levels below the depth.
  const thinking = read(ws, "Thinking.md")
  assert.deepEqual(outline(thinking).map(([, name]) => name), ["Beta", "Alpha", "Inner"])
  assert.match(thinking, /^generated:: views\/Thinking\.mdx\n/)
  assert.match(thinking, /- \[\[Alpha\]\] · 1 open · Alpha summary\.\n  collapsed:: true\n\t- \[\[Inner\]\] · Inner summary\.\n/)
  assert.deepEqual(outline(read(ws, "Inside.md")), [[0, "Inner"], [1, "Deep"]])
  ownHome(ws)
  put(ws.root, "Home.md", "## Thinking and plans\n- {{embed [[Thinking]]}}\n\n## Work and automation\n- {{query (task TODO)}}\n- [[Paused]] · [[Archive]]\n")
  const status = homeStatus(ws)
  assert.deepEqual([status.embedded, status.linked.sort(), status.outside], [[{ page: "Thinking", exists: true, nodes: 3 }], ["Alpha", "Beta", "Inner", "Paused"], []])
  // A node the view leaves out and Home does not link is outside Home again.
  put(ws.root, "Home.md", "- {{embed [[Thinking]]}}\n")
  assert.deepEqual(homeStatus(ws).outside, ["Paused"])
  // A task copied onto Home from its node is said, as a warning.
  put(ws.root, "Home.md", "- {{embed [[Thinking]]}}\n- TODO a\n- TODO my own\n")
  const copies = (await check(ws)).issues.filter((issue) => issue.code === "home-copy")
  assert.deepEqual(copies.map((issue) => [issue.severity, issue.line]), [["warning", 2]])
  assert.match(copies[0].message, /Alpha/)
  // A setting the fence does not know stops the build instead of showing something else.
  put(ws.root, "views/Thinking.mdx", "# Thinking\n\n```nodes\ndeep: 2\n```\n")
  assert.throws(() => build(ws), /nodes fence takes only/)
})

test("an owner's Home is not held to first-list limits, and its line rules never stop a save", async () => {
  const ws = await generatedHome({ "projects/Beta.md": `# Beta\n${"b".repeat(80)}.\n` })
  assert.ok(codes((await check(ws)).issues).includes("top-summary-long"))
  ownHome(ws)
  put(ws.root, "Home.md", `${Array.from({ length: 11 }, (_, i) => `- item ${i}\n`).join("")}text the outliner would swallow\n`)
  const { issues, top } = await check(ws)
  assert.ok(!codes(issues).includes("top-summary-long"))
  assert.equal(issues.find((issue) => issue.code === "list-trailing-text").severity, "warning")
  assert.deepEqual([top.count, top.summaryOver], [11, 0])
  // An outliner that bullets the next heading still ends the first list there.
  put(ws.root, "Home.md", "- [[Alpha]]\n- [[Beta]]\n- ## Now\n- In progress\n")
  assert.equal((await check(ws)).top.count, 2)
  // Heading blocks with their items indented under them are the list's items.
  put(ws.root, "Home.md", "## Thinking\n- ### Work\n\t- [[Alpha]]\n- ### Life\n\t- [[Beta]]\n\t- renew the licence\n\n## Doing\n- {{query (task DOING)}}\n")
  const grouped = await check(ws)
  assert.equal(grouped.top.count, 2)
  assert.ok(!codes(grouped.issues).includes("bullet-heading"))
})

test("review asks where top nodes outside Home belong, never about Home's own list", async () => {
  const ws = await generatedHome({
    "projects/Gamma.md": "# Gamma\nGamma summary.\n",
    "projects/Gamma/Deep.md": "# Deep\nDeep summary.\n",
    "projects/Delta.md": "# Delta\nDelta summary.\n",
  })
  ownHome(ws)
  put(ws.root, "Home.md", `- [[Alpha]]\n- [[Deep]]\n${Array.from({ length: 10 }, (_, i) => `- note ${i}\n`).join("")}`)
  const { candidates } = await review(ws)
  const kinds = (node) => candidates.filter((c) => c.node === node).flatMap((c) => c.reasons.map((r) => r.kind))
  assert.ok(kinds("projects/Beta").includes("home-outside"))
  assert.ok(kinds("projects/Delta").includes("home-outside"))
  assert.ok(!kinds("projects/Alpha").includes("home-outside"))
  assert.ok(!kinds("projects/Gamma").includes("home-outside"), "Home reaches Gamma through Deep")
  assert.ok(!candidates.some((c) => c.reasons.some((r) => ["top-warning", "top-inactive"].includes(r.kind))))
  assert.equal(candidates[0].kind, "home-outside")
})

test("remove keeps a node that the owner's Home links to unless forced", async () => {
  const ws = await generatedHome()
  ownHome(ws)
  put(ws.root, "Home.md", "- ``a ` tick`` [[Beta]] `[[InCode]]` <!-- the one\n  [[Ghost]] I use -->\n- [[Inner]]\n")
  assert.throws(() => remove(ws, "Beta"), /Home links to Beta/, "inline code and comments hide no link beside them")
  assert.ok(!codes((await check(ws)).issues).includes("dangling-link"), "a link inside code or a comment is no link")
  put(ws.root, "projects/Alpha.md", "# Alpha\nAlpha summary.\n")
  assert.throws(() => remove(ws, "Alpha"), /Home links to Alpha/, "Home links to a node below it")
  const result = remove(ws, "Beta", { force: true })
  assert.deepEqual(result.links.map((link) => [link.path, link.line]), [["Home.md", 1]])
})

test("a page created by following a new link waits in pages/ until it is placed", async () => {
  const ws = await generatedHome()
  ownHome(ws)
  put(ws.root, "Home.md", "- [[새 생각]]\n")
  put(ws.root, "pages/새 생각.md".normalize("NFD"), "- written on the phone\n")
  put(ws.root, "pages/Folder/Nested.md", "- also waiting\n")
  assert.deepEqual((await check(ws)).issues, [])
  assert.deepEqual(inbox(ws).filter((item) => item.kind === "page"), [
    { kind: "page", page: "Nested", path: "pages/Folder/Nested.md", line: 1, text: "- also waiting", children: [] },
    { kind: "page", page: "새 생각", path: "pages/새 생각.md", line: 1, text: "- written on the phone", children: [] },
  ])
  const moved = await move(ws, "새 생각", "Alpha")
  assert.equal(moved.to, "projects/Alpha/새 생각.md")
  // Placed on the tree, it is a node like any other and needs a title and a summary.
  assert.ok(codes((await check(ws)).issues).includes("node-title"))
  await assert.rejects(() => move(ws, "Beta", "pages"), /Unknown parent/)
  put(ws.root, "pages-backlog/Waiting.md", "# Waiting\nA top category whose name starts like the intake folder.\n")
  assert.equal((await move(ws, "Beta", "pages-backlog")).to, "pages-backlog/Beta.md")
})

test("nothing is lost: an edited Home, a broken build record or a failed write stops the handover untouched", { skip: process.platform === "win32" && "POSIX directory permissions" }, async () => {
  const ws = await generatedHome()
  const view = read(ws, "views/Home.mdx")
  const generated = read(ws, "Home.md")
  put(ws.root, "Home.md", `${generated}- a line added by hand\n`)
  assert.throws(() => ownHome(ws), /changed after it was built/)
  assert.equal(read(ws, "views/Home.mdx"), view)
  put(ws.root, "Home.md", generated)

  const record = join(ws.cacheDir, "build.json")
  const saved = readFileSync(record, "utf8")
  writeFileSync(record, "{ not json")
  assert.throws(() => ownHome(ws), SyntaxError)
  assert.deepEqual([read(ws, "views/Home.mdx"), read(ws, "Home.md"), existsSync(join(ws.graphDir, "views/Archive.mdx"))], [view, generated, false])
  writeFileSync(record, saved)

  // The favorites write comes last; when it fails every earlier change is undone.
  const logseq = join(ws.graphDir, "logseq")
  chmodSync(logseq, 0o555)
  try { assert.throws(() => ownHome(ws), /EACCES|EPERM/) } finally { chmodSync(logseq, 0o755) }
  assert.deepEqual([read(ws, "views/Home.mdx"), read(ws, "Home.md"), existsSync(join(ws.graphDir, "views/Archive.mdx"))], [view, generated, false])
  assert.equal(readFileSync(record, "utf8"), saved)

  // A page that links to or embeds the Home view would break, so it stops the handover too.
  const beta = read(ws, "projects/Beta.md")
  put(ws.root, "projects/Beta.md", beta.replace("Beta summary.", "Beta summary, see [Now](/views/Home.mdx)."))
  assert.throws(() => ownHome(ws), /the handover removes: projects\/Beta\.md\./)
  put(ws.root, "projects/Beta.md", beta)
  put(ws.root, "views/Other.mdx", "# Other\n\n```cudoc-embed\nsources: [/views/Home.mdx#now]\n```\n")
  assert.throws(() => ownHome(ws), /the handover removes: views\/Other\.mdx\./)
  assert.ok(existsSync(join(ws.graphDir, "views/Home.mdx")))
  rmSync(join(ws.graphDir, "views/Other.mdx"))
  assert.deepEqual(ownHome(ws).built.blocked, [])
})

test("favorites spread over lines or after a commented example still gain the Archive", async () => {
  const ws = await generatedHome({ "logseq/config.edn": '{;; :favorites ["Example"]\n :favorites ;; pinned pages\n ["Home" ;; "Archive" one day\n  #_ "Archive" "Beta"]\n :hidden []}\n' })
  assert.equal(ownHome(ws).favorite, true)
  assert.equal(readFileSync(join(ws.graphDir, "logseq/config.edn"), "utf8"), '{;; :favorites ["Example"]\n :favorites ;; pinned pages\n ["Home" ;; "Archive" one day\n  #_ "Archive" "Beta" "Archive"]\n :hidden []}\n')
})

test("a node named like Home stays on the tree when the graph has no Home page", async () => {
  const ws = await workspace({ "projects/Home.md": "# Home\nA project called Home.\n", "projects/Other.md": "# Other\nOther.\n" })
  const result = await check(ws)
  assert.deepEqual([result.nodes, result.issues.length], [2, 0])
})
