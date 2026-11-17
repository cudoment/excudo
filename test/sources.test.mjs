import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { build, check, commitGraph, ingest, keepCandidates, listSources, loadWorkspace, review, sourceScript } from "../src/index.mjs"
import { SKILLS_DIR } from "../src/skills.mjs"
import { urlsIn } from "../src/sources.mjs"
import { put, read, tempDir, workspace } from "./helpers.mjs"

const now = new Date(2026, 9, 12, 9)
const jira = { name: "jira", label: "Jira", url: "https://jira.example.com/issues", key: "[A-Z]+-\\d+", complete: true }
const board = { name: "board", url: "https://board.example.com/requests", node: "Inbox", marker: "" }
const issue = (key, extra = {}) => ({ id: key, title: `Work on ${key}`, url: `https://jira.example.com/browse/${key}`, ...extra })

async function memo(extra = {}, sources = [jira, board]) {
  const ws = await workspace({
    "projects/Docs.md": "# Docs\nDocs work.\n\n- Branch `feature/PRJ-12`\n- TODO write the intro\n",
    "projects/Docs/Search.md": "# Search\nThe search demo for PRJ-12.\n\n- Note\n",
    "projects/Inbox.md": "# Inbox\nOutside work waits here.\n",
    ...extra,
  }, { sources })
  assert.equal(build(ws).blocked.length, 0)
  return ws
}

test("new items go to the node that names their key, else the source's node or today's journal; a dry run leaves the memo alone", async () => {
  const ws = await memo()
  const before = read(ws, "projects/Docs/Search.md")
  const items = [issue("PRJ-12"), issue("PRJ-13", { title: "TODO Fix [[links]]" }), issue("PRJ-14", { done: true })]
  const plan = ingest(ws, "jira", items, { dryRun: true, now })
  assert.deepEqual(plan.added.map((item) => [item.id, item.to, item.reason]), [
    ["PRJ-12", "projects/Docs/Search.md", "key"],
    ["PRJ-13", "journals/2026_10_12.md", "journal"],
  ])
  assert.equal(plan.finished, 1)
  assert.equal(read(ws, "projects/Docs/Search.md"), before)
  assert.ok(!existsSync(join(ws.graphDir, "journals")) && !existsSync(join(ws.root, "sources.json")))

  ingest(ws, "jira", JSON.stringify(JSON.stringify(items)), { now })
  // The deepest node naming the key wins, and the item joins its list before the generated section.
  assert.match(read(ws, "projects/Docs/Search.md"), /\n- Note\n- TODO Work on PRJ-12 \[PRJ-12\]\(https:\/\/jira\.example\.com\/browse\/PRJ-12\)\n\n## Subpages\n/)
  assert.equal(read(ws, "journals/2026_10_12.md"), "- TODO Fix [ [links]] [PRJ-13](https://jira.example.com/browse/PRJ-13)\n")
  // Two mentions on one post bring the post in once.
  ingest(ws, "board", [{ id: 7, title: "Read the\nrelease post", url: "https://board.example.com/p/7" }, { id: 8, title: "Again", url: "https://board.example.com/p/7/" }], { now })
  assert.match(read(ws, "projects/Inbox.md"), /^# Inbox\nOutside work waits here\.\n\n- Read the release post \[board\]\(https:\/\/board\.example\.com\/p\/7\)\n\n## Subpages\n/)
  assert.equal(build(ws).blocked.length, 0)
  assert.deepEqual((await check(ws)).issues.filter((item) => item.severity === "error"), [])
  // Another task after the existing ones, not after the branch line.
  ingest(ws, "jira", [issue("PRJ-12"), issue("PRJ-15", { node: "Docs" })], { now })
  assert.match(read(ws, "projects/Docs.md"), /\n- TODO write the intro\n- TODO Work on PRJ-15 \[PRJ-15\]/)
})

test("an item the memo has had never comes back: linked, archived, removed or skipped; a reopened one does", async () => {
  const ws = await memo({ "Done.md": "# Done\nFinished.\n\n- DONE Docs · Old work [PRJ-20](https://jira.example.com/browse/PRJ-20)\n" })
  ingest(ws, "jira", [issue("PRJ-21"), issue("PRJ-22", { skip: true }), issue("PRJ-23", { done: true })], { now })
  put(ws.root, "journals/2026_10_12.md", "- something else\n")
  const again = ingest(ws, "jira", [issue("PRJ-20"), issue("PRJ-21"), issue("PRJ-22"), issue("PRJ-23")], { now })
  assert.deepEqual([again.known, again.ignored, again.finished], [2, 1, 0])
  assert.deepEqual(again.added.map((item) => item.id), ["PRJ-23"], "finished when first seen, open now: new to the memo")
  assert.equal(read(ws, "journals/2026_10_12.md"), "- something else\n- TODO Work on PRJ-23 [PRJ-23](https://jira.example.com/browse/PRJ-23)\n")
  assert.deepEqual(listSources(ws).map((source) => [source.name, source.tracked, source.open, source.ignored]), [["jira", 4, 1, 1], ["board", 0, 0, 0]])
})

test("finished or dropped items still open in the memo become questions; only the owner marks them done", async () => {
  const ws = await memo()
  ingest(ws, "jira", [issue("PRJ-31", { node: "Inbox" }), issue("PRJ-32", { node: "Inbox" })], { now })
  const later = ingest(ws, "jira", [issue("PRJ-31", { done: true })], { now: new Date(2026, 9, 13) })
  assert.deepEqual(later.closed.map((item) => [item.id, item.places.map((place) => place.path)]), [["PRJ-31", ["projects/Inbox.md"]]])
  assert.deepEqual(later.gone.map((item) => item.id), ["PRJ-32"])
  assert.match(read(ws, "projects/Inbox.md"), /- TODO Work on PRJ-31 .*\n- TODO Work on PRJ-32 /)
  const kinds = async () => (await review(ws, { now: new Date(2026, 9, 13) })).candidates.flatMap((item) => item.reasons.map((reason) => [reason.kind, reason.text.match(/PRJ-\d+/)?.[0]]))
    .filter(([kind]) => kind.startsWith("source-"))
  assert.deepEqual(await kinds(), [["source-closed", "PRJ-31"], ["source-gone", "PRJ-32"]])
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md").replace("- TODO Work on PRJ-31", "- DONE Work on PRJ-31"))
  assert.deepEqual(await kinds(), [["source-gone", "PRJ-32"]])
  // A source that lists only what is new never reports what it left out.
  ingest(ws, "board", [{ id: 1, title: "Post", url: "https://board.example.com/p/1" }], { now })
  assert.deepEqual(ingest(ws, "board", [], { now }).gone, [])
})

test("a source set to settle closes the tasks whose items are all finished; an open, waiting, hand-settled or uncollected link keeps one open", async () => {
  const requests = { name: "requests", url: "https://board.example.com/requests", node: "Inbox", finished: "settle" }
  const mentions = { name: "mentions", url: "https://board.example.com/mentions", marker: "" }
  const tracker = { name: "tracker", url: "https://tracker.example.com/issues", key: "T-\\d+" }
  const post = (n) => `https://board.example.com/p/${n}`
  const ws = await memo({
    "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n"
      + "- TODO Fix the footer [PRJ-1](https://jira.example.com/browse/PRJ-1)\n"
      + `- TODO Two parts [PRJ-2](https://jira.example.com/browse/PRJ-2) [board](${post(2)})\n`
      + "- WAITING Wait on [PRJ-3](https://jira.example.com/browse/PRJ-3)\n"
      + `- TODO Parent [board](${post(4)})\n`
      + `\t- TODO Child part [board](${post(5)}#comment_9) [board](${post(5)})\n`
      + `- TODO Mentioned [board](${post(7)})\n`
      + "- TODO Settled by hand [T-1](https://tracker.example.com/T-1)\n"
      + "- TODO Read the guide https://example.com/guide\n"
      // Links to items no source collected: an issue someone else holds, a post the board never listed, a guide.
      + `- TODO Someone else's issue [PRJ-8](https://jira.example.com/browse/PRJ-8) [board](${post(8)})\n`
      + `- TODO Two posts [board](${post(10)}) [board](${post(11)})\n`
      + `- TODO With a guide [board](${post(9)}) https://example.com/guide/9\n`
      // A mention of a post says nothing about that work being finished.
      + `- TODO Also mentioned [board](${post(12)}) [board](${post(13)})\n`,
  }, [{ ...jira, finished: "settle" }, requests, mentions, tracker])
  const lines = () => read(ws, "projects/Inbox.md").split("\n").filter((line) => /^\s*- /.test(line)).map((line) => line.trim().split(" ").slice(0, 2).join(" "))
  const titles = (result) => result.settled.map((item) => item.title.split(" [")[0])

  ingest(ws, "mentions", [{ id: "m1", title: "Mention", url: post(7) }, { id: "m2", title: "Mention", url: post(13) }], { now })
  ingest(ws, "tracker", [{ id: "T-1", title: "Hand", url: "https://tracker.example.com/T-1", done: true }], { now })
  // A mention points at a finished request: notes are no work, so the request alone decides.
  const first = ingest(ws, "requests", [{ id: 2, title: "Two", url: post(2) }, { id: 4, title: "Four", url: post(4), done: true },
    { id: 5, title: "Five", url: post(5) }, { id: 7, title: "Seven", url: post(7), done: true }, { id: 8, title: "Eight", url: post(8), done: true },
    { id: 9, title: "Nine", url: post(9), done: true }, { id: 11, title: "Eleven", url: post(11), done: true }, { id: 12, title: "Twelve", url: post(12), done: true }], { now })
  // Before the first issue collection, an issue link on the issue source's host with its key already keeps a task open;
  // a post no source listed has the shape of the board's posts; a guide is only a reference.
  assert.deepEqual(titles(first), ["Mentioned", "With a guide"])
  assert.deepEqual(first.closed.map((item) => item.id), ["4", "8", "11", "12"], "the parent waits for its open child; an uncollected link keeps its finished request a question")

  const issues = [issue("PRJ-1", { done: true }), issue("PRJ-2", { done: true }), issue("PRJ-3", { done: true }), issue("PRJ-6", { done: true, covers: [`${post(5)}#comment_9`] })]
  const before = read(ws, "projects/Inbox.md")
  const plan = ingest(ws, "jira", issues, { dryRun: true, now })
  assert.deepEqual(titles(plan), ["Fix the footer", "Parent", "Child part"])
  assert.equal(read(ws, "projects/Inbox.md"), before, "a dry run writes nothing")

  const settled = ingest(ws, "jira", issues, { now })
  // The comment link speaks for the part an issue covers; the post it belongs to is only its context.
  assert.deepEqual(titles(settled), ["Fix the footer", "Parent", "Child part"])
  assert.deepEqual(settled.closed.map((item) => item.id), ["PRJ-2", "PRJ-3"], "an open request and a waiting task stay questions")
  assert.deepEqual(lines(), ["- DONE", "- TODO", "- WAITING", "- DONE", "- DONE", "- DONE", "- TODO", "- TODO", "- TODO", "- TODO", "- DONE", "- TODO"])
  assert.match(JSON.stringify(JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8")).jira.items["PRJ-6"]), /"covers":\["https:\/\/board\.example\.com\/p\/5#comment_9"\]/)

  // A source that does not settle reports as before.
  const asks = await memo({ "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n- TODO Fix [PRJ-1](https://jira.example.com/browse/PRJ-1)\n" })
  const asked = ingest(asks, "jira", [issue("PRJ-1", { done: true })], { now })
  assert.deepEqual([asked.settled, asked.closed.map((item) => item.id)], [[], ["PRJ-1"]])
  asks.sources = [{ ...jira, finished: "maybe" }]
  assert.throws(() => ingest(asks, "jira", [], { now }), /finished/)
  asks.sources = [jira]
  assert.throws(() => ingest(asks, "jira", [issue("PRJ-9", { covers: ["not a link"] })], { now }), /covers/)
})

test("the sources check tells a task the engine settled from one closed by hand, which needs the owner's word", async () => {
  const ws = await memo({ "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n"
    + "- TODO Fix the footer [PRJ-1](https://jira.example.com/browse/PRJ-1)\n- TODO Write the notes [PRJ-2](https://jira.example.com/browse/PRJ-2)\n" },
  [{ ...jira, finished: "settle" }])
  const git = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: ws.root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\nnode_modules/\n")
  git("add", "-A")
  git("commit", "-qm", "start")
  const since = git("rev-parse", "HEAD").stdout.trim()
  const check = (...args) => spawnSync(process.execPath, [join(SKILLS_DIR, "excudo-sources", "scripts", "check.mjs"), "--source", "jira", ...args], { cwd: ws.root, encoding: "utf8", timeout: 60000 })

  assert.equal(ingest(ws, "jira", [issue("PRJ-1", { done: true }), issue("PRJ-2")]).settled.length, 1)
  writeFileSync(join(ws.graphDir, "projects/Inbox.md"), read(ws, "projects/Inbox.md").replace("- TODO Write the notes", "- DONE Write the notes"))
  git("add", "-A")
  git("commit", "-qm", "collect")
  let result = check("--since", since)
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stdout, /✗ done-by-owner: .*Write the notes/)
  assert.doesNotMatch(result.stdout, /done-by-owner: .*footer/, "the engine settled the footer for a settling source")
  result = check("--since", since, "--allow-done", "write the notes")
  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /✓ done-by-owner: .*settled 1/)
  assert.match(check().stdout, /✓ done-by-owner: Without --since/)
})

test("scripts are composed for the browser, and configuration mistakes are named", async () => {
  // A config module is imported once per path, so this one is written before anything loads it.
  const root = tempDir()
  writeFileSync(join(root, "excudo.config.mjs"), `export default { graph: "notes", sources: [{ name: "jira", url: "https://jira.example.com",
    script: async ({ since, url }) => JSON.stringify([{ id: "A-1", title: since ?? url, url }]),
    actions: { create: { script: "async ({ summary }) => summary" } } }] }\n`)
  put(root, "A.md", "# A\nA.\n")
  const fresh = await loadWorkspace({ root })
  assert.equal(sourceScript(fresh, "jira"), `(async ({ since, url }) => JSON.stringify([{ id: "A-1", title: since ?? url, url }]))({"since":null,"url":"https://jira.example.com"})`)
  ingest(fresh, "jira", [], { now })
  assert.ok(sourceScript(fresh, "jira").endsWith(`({"since":"${now.toISOString()}","url":"https://jira.example.com"})`))
  assert.equal(sourceScript(fresh, "jira", { action: "create", args: '{"summary":"S"}' }), `(async ({ summary }) => summary)({"summary":"S"})`)
  assert.throws(() => sourceScript(fresh, "jira", { action: "close" }), /no action close\. Its actions: create/)
  assert.throws(() => sourceScript(fresh, "gitlab"), /No source named gitlab\. Configured sources: jira/)
  assert.throws(() => ingest(fresh, "jira", [{ id: "A-1", title: "x", url: "ftp://x" }]), /Item 0 from jira: url/)
  for (const [sources, message] of [[{}, /must be a list/], [[{ name: "Jira", url: "https://x" }], /sources\[0\]: name/],
    [[{ name: "a", url: "x" }], /sources\[0\]: url/], [[{ name: "a", url: "https://x" }, { name: "a", url: "https://y" }], /Two sources are named a/],
    [[{ name: "a", url: "https://x", marker: "TODO later" }], /sources\[0\]: marker/]]) {
    const broken = await workspace({}, { sources })
    assert.throws(() => listSources(broken), message)
  }
})

test("save commits what the sources delivered and the settings with the graph, and the CLI previews an ingest", async () => {
  const ws = await memo()
  const git = (...args) => spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8" })
  git("init", "-q"); git("config", "user.email", "t@example.com"); git("config", "user.name", "T")
  const file = join(ws.root, "items.json")
  writeFileSync(file, JSON.stringify([issue("PRJ-41")]))
  const cli = (...args) => spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "--root", ws.root, ...args], { encoding: "utf8" })
  const preview = cli("ingest", "jira", file, "--dry-run")
  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /\+ journals\/\d{4}_\d{2}_\d{2}\.md: - TODO Work on PRJ-41 \[PRJ-41\]/)
  assert.ok(!existsSync(join(ws.root, "sources.json")))
  assert.equal(cli("ingest", "jira", file).status, 0)
  assert.equal(commitGraph(ws, "Collect Jira", { includeReview: true }), "committed")
  assert.deepEqual(git("show", "--format=", "--name-only", "HEAD").stdout.trim().split("\n").filter((name) => !name.startsWith("notes/")), ["excudo.config.mjs", "sources.json"])
  // A settings change made in a batch, such as sending a source to another node, is committed with it.
  const config = join(ws.root, "excudo.config.mjs")
  writeFileSync(config, readFileSync(config, "utf8").replace('"node":"Inbox"', '"node":"Docs"'))
  assert.equal(commitGraph(ws, "Send board items to Docs", { includeReview: true }), "committed")
  assert.deepEqual(git("show", "--format=", "--name-only", "HEAD").stdout.trim().split("\n"), ["excudo.config.mjs"])
  assert.equal(JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8")).jira.items["PRJ-41"].noted, true)
  assert.match(cli("sources").stdout, /^jira \(Jira\) · https:\/\/jira\.example\.com\/issues · last collected .* · tracked 1 · open in the memo 1\n/)
})

test("open tasks are found by their own text: continuation links count, code examples do not", async () => {
  const ws = await memo({ "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n- TODO investigate the report\n  see [PRJ-50](https://jira.example.com/browse/PRJ-50)\n- Example:\n  ```text\n  - TODO example [PRJ-51](https://jira.example.com/browse/PRJ-51)\n  ```\n" })
  const result = ingest(ws, "jira", [issue("PRJ-50", { done: true }), issue("PRJ-51", { done: true })], { now })
  assert.deepEqual(result.closed.map((item) => [item.id, item.places.map((place) => place.line)]), [["PRJ-50", [4]]])
})

test("links keep balanced parentheses, and an item whose link changed is still followed through its old link", async () => {
  const wiki = { name: "wiki", url: "https://wiki.example.com", node: "Inbox" }
  const ws = await memo({}, [jira, board, wiki])
  const page = { id: "p1", title: "Draft page", url: "https://wiki.example.com/page_(draft)" }
  assert.match(ingest(ws, "wiki", [page], { now }).added[0].line, /\(https:\/\/wiki\.example\.com\/page_\(draft\)\)$/)
  assert.equal(ingest(ws, "wiki", [{ ...page, done: true }], { now }).closed[0]?.places.length, 1)
  ingest(ws, "jira", [issue("PRJ-60", { node: "Inbox" })], { now })
  const moved = ingest(ws, "jira", [issue("PRJ-60", { url: "https://jira.example.com/browse/NEW-60", done: true })], { now })
  assert.deepEqual(moved.closed.map((item) => item.places[0].path), ["projects/Inbox.md"])
  assert.deepEqual((await review(ws, { now })).candidates.flatMap((item) => item.reasons).filter((reason) => reason.item === "PRJ-60").map((reason) => reason.kind), ["source-closed"])
})

test("a link the memo has had never returns, whichever source or id brings it", async () => {
  const ws = await memo()
  ingest(ws, "board", [{ id: "__proto__", title: "Odd id", url: "https://board.example.com/p/9" }], { now })
  assert.ok(Object.hasOwn(JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8")).board.items, "__proto__"))
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md").replace(/\n- Odd id .*\n/, "\n"))
  assert.equal(ingest(ws, "board", [{ id: "__proto__", title: "Odd id", url: "https://board.example.com/p/9" }], { now }).known, 1)
  assert.equal(ingest(ws, "jira", [issue("PRJ-90", { url: "https://board.example.com/p/9" })], { now }).known, 1)
  assert.equal(ingest(ws, "board", [{ id: "other", title: "Same page", url: "https://board.example.com/p/9/" }], { now }).known, 1)
})

test("journal names follow the graph's format, and scripts may be written as methods", async () => {
  const root = tempDir()
  writeFileSync(join(root, "excudo.config.mjs"), `export default { graph: "notes", sources: [{ name: "news", url: "https://news.example.com",
    async script({ url }) { return JSON.stringify([{ id: 1, title: "Story", url }]) },
    actions: { reply: { script({ text }) { return text } } } }] }\n`)
  put(root, "A.md", "# A\nA.\n")
  put(root, "logseq/config.edn", '{:journal/file-name-format "yyyy-M-d"}\n')
  const ws = await loadWorkspace({ root })
  for (const expression of [sourceScript(ws, "news"), sourceScript(ws, "news", { action: "reply", args: '{"text":"hi"}' })])
    assert.doesNotThrow(() => new Function(`return ${expression}`), expression)
  assert.equal(ingest(ws, "news", [{ id: 1, title: "Story", url: "https://news.example.com/1" }], { now: new Date(2026, 0, 5) }).added[0].to, "journals/2026-1-5.md")
})

test("review names the outside item behind each question, even when one line links two", async () => {
  const ws = await memo({ "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n- TODO pair [PRJ-70](https://jira.example.com/browse/PRJ-70) [PRJ-71](https://jira.example.com/browse/PRJ-71)\n" })
  ingest(ws, "jira", [issue("PRJ-70"), issue("PRJ-71")], { now })
  ingest(ws, "jira", [issue("PRJ-70", { done: true }), issue("PRJ-71", { done: true })], { now })
  const reasons = (await review(ws, { now })).candidates.flatMap((item) => item.reasons).filter((reason) => reason.kind === "source-closed")
  assert.deepEqual(reasons.map((reason) => reason.item).sort(), ["PRJ-70", "PRJ-71"])
  assert.match(reasons[0].evidence, /^jira shows this item as finished, but it is still open here: Work on PRJ-7\d$/)
  // Two collections at the same moment still tell what is gone.
  ingest(ws, "jira", [issue("PRJ-72", { node: "Inbox" })], { now })
  ingest(ws, "jira", [], { now })
  assert.ok((await review(ws, { now })).candidates.flatMap((item) => item.reasons).some((reason) => reason.kind === "source-gone" && reason.item === "PRJ-72"))
})

test("second look: nested parentheses, links in code, reference links and aliases within one collection", async () => {
  const wiki = { name: "wiki", url: "https://wiki.example.com", node: "Inbox" }
  const ws = await memo({
    "projects/Inbox.md": "# Inbox\nOutside work waits here.\n\n- TODO resolve [the issue][p]\n- Example:\n  ```json\n  {\"url\": \"https://wiki.example.com/q\"}\n  ```\n\n[p]: https://jira.example.com/browse/PRJ-95\n",
  }, [jira, board, wiki])
  const nested = { id: "n1", title: "Nested", url: "https://wiki.example.com/a(b(c)d)" }
  ingest(ws, "wiki", [nested], { now })
  assert.equal(ingest(ws, "wiki", [{ ...nested, done: true }], { now }).closed.length, 1)
  // A link shown only in code is no link: the real item still comes in.
  assert.equal(ingest(ws, "wiki", [{ id: "q", title: "Q page", url: "https://wiki.example.com/q" }], { now }).added.length, 1)
  assert.deepEqual(ingest(ws, "jira", [issue("PRJ-95", { done: true })], { now }).closed.map((item) => item.places[0].line), [4])
  ingest(ws, "board", [{ id: "A", title: "Post A", url: "https://board.example.com/old" }], { now })
  const again = ingest(ws, "board", [{ id: "A", title: "Post A", url: "https://board.example.com/new" }, { id: "B", title: "Mention", url: "https://board.example.com/new" }], { now })
  assert.deepEqual([again.added.length, again.known], [0, 2])
})

test("second look: a changed journal task asks again, and a skipped item asks nothing", async () => {
  const ws = await memo()
  put(ws.root, "journals/2026_10_12.md", "- TODO investigate\n  [A](https://jira.example.com/browse/PRJ-96)\n")
  ingest(ws, "jira", [issue("PRJ-96", { done: true }), issue("PRJ-97", { done: true })], { now })
  const first = (await review(ws, { now })).candidates.find((item) => item.kind === "source-closed")
  await keepCandidates(ws, [first.id], { now })
  assert.ok(!(await review(ws, { now })).candidates.some((item) => item.kind === "source-closed"))
  put(ws.root, "journals/2026_10_12.md", "- TODO investigate\n  [B](https://jira.example.com/browse/PRJ-97)\n")
  assert.ok((await review(ws, { now })).candidates.some((item) => item.kind === "source-closed"), "the kept question was about another link")
  ingest(ws, "board", [{ id: "S", title: "Skip me", url: "https://board.example.com/s", skip: true }], { now })
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md").replace("waits here.\n", "waits here.\n\n- TODO my own [S](https://board.example.com/s)\n"))
  assert.deepEqual(ingest(ws, "board", [{ id: "S", title: "Skip me", url: "https://board.example.com/s", done: true }], { now }).closed, [])
  assert.ok(!(await review(ws, { now })).candidates.flatMap((item) => item.reasons).some((reason) => reason.item === "S"))
})

test("links keep parentheses nested to any depth, and stop at one that does not close", () => {
  assert.deepEqual(urlsIn("see https://x.example/a_(b_(c_(d))) and [t](https://y.example/p?q=(1)) or https://z.example/(open"),
    ["https://x.example/a_(b_(c_(d)))", "https://y.example/p?q=(1)", "https://z.example/"])
  assert.deepEqual(urlsIn("https://a.example/?next=https://b.example/x"), ["https://a.example/?next=https://b.example/x"])
})

test("ingest shrinks items long unseen once no open task needs them, and never adds back one the memo had", async () => {
  const ws = await memo({ "Done.md": "# Done\nFinished.\n\n- DONE Docs · Old [PRJ-80](https://jira.example.com/browse/PRJ-80)\n" })
  ingest(ws, "jira", [issue("PRJ-80"), issue("PRJ-81", { node: "Inbox" }), issue("PRJ-82", { node: "Inbox" }), issue("PRJ-83", { done: true })], { now: new Date(2026, 0, 5) })
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md").replace(/\n- TODO Work on PRJ-82 .*\n/, "\n"))
  const items = () => JSON.parse(readFileSync(join(ws.root, "sources.json"), "utf8")).jira.items
  const preview = ingest(ws, "jira", [issue("PRJ-84")], { now, dryRun: true })
  assert.deepEqual([preview.forgotten, preview.compacted], [1, 2])
  assert.ok(items()["PRJ-83"].title, "a dry run changes nothing")
  assert.deepEqual([ingest(ws, "jira", [issue("PRJ-84")], { now })].map((result) => [result.forgotten, result.compacted]), [[1, 2]])
  // Never in the memo (PRJ-83): forgotten. In it or removed by the owner (PRJ-80, PRJ-82): only id and link. Open (PRJ-81): whole.
  const kept = items()
  assert.deepEqual(Object.keys(kept).sort(), ["PRJ-80", "PRJ-81", "PRJ-82", "PRJ-84"])
  assert.deepEqual(kept["PRJ-82"], { url: "https://jira.example.com/browse/PRJ-82", noted: true, lastSeen: kept["PRJ-82"].lastSeen })
  assert.ok(kept["PRJ-81"].title)
  // Neither comes back, even under another link.
  const again = ingest(ws, "jira", [issue("PRJ-80", { url: "https://jira.example.com/issues/PRJ-80" }), issue("PRJ-82"), issue("PRJ-84")], { now })
  assert.deepEqual([again.added.length, again.known], [0, 3])
})

test("an item whose link the owner wrote into the memo is kept by its id when it shrinks", async () => {
  const ws = await memo()
  ingest(ws, "jira", [issue("PRJ-90", { done: true })], { now: new Date(2026, 0, 5) })
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md") + "\n- DONE Handled [PRJ-90](https://jira.example.com/browse/PRJ-90)\n")
  assert.deepEqual([ingest(ws, "jira", [issue("PRJ-91")], { now })].map((result) => [result.forgotten, result.compacted]), [[0, 1]])
  assert.equal(ingest(ws, "jira", [issue("PRJ-90", { url: "https://jira.example.com/issues/PRJ-90" }), issue("PRJ-91")], { now }).added.length, 0)
})

test("an item never in the memo is kept by its links when another item brings one of them in", async () => {
  const ws = await memo()
  const old = "https://jira.example.com/browse/PRJ-95"
  const moved = "https://jira.example.com/issues/PRJ-95"
  ingest(ws, "jira", [issue("PRJ-95", { done: true })], { now: new Date(2026, 0, 5) })
  ingest(ws, "jira", [issue("PRJ-95", { done: true, url: moved })], { now: new Date(2026, 0, 6) })
  const result = ingest(ws, "jira", [issue("PRJ-96", { node: "Inbox", url: moved })], { now })
  assert.deepEqual([result.added.length, result.forgotten, result.compacted], [1, 0, 1])
  put(ws.root, "projects/Inbox.md", read(ws, "projects/Inbox.md").replace(/\n- TODO Work on PRJ-96 .*\n/, "\n"))
  assert.equal(ingest(ws, "jira", [issue("PRJ-95", { url: old })], { now }).added.length, 0)
})

test("a key named only in knowledge does not draw an item there, and new items wait in a node's lead, above its sections", async () => {
  const ws = await workspace({
    "projects/Guide.md": "# Guide\nThe guide work.\n\n- Branch `feature/PRJ-50`\n\n## References\nSee [[Decisions]].\n",
    "projects/Screens.md": "# Screens\nScreen fixes.\n\n- Fixes wait for the design review\n\n## Tables\n- TODO review the rich tables\n",
    "Knowledge.md": "# Knowledge\nWhat agents keep.\n",
    "Knowledge/Decisions.md": "# Decisions\nWhat was decided for the guides.\n\n- Confirmed: the PRJ-50 guide records its sources\n- Confirmed: PRJ-51 was dropped\n",
  }, { sources: [jira], knowledge: ["Knowledge"] })
  assert.equal(build(ws).blocked.length, 0)
  const plan = ingest(ws, "jira", [issue("PRJ-50"), issue("PRJ-51"), issue("PRJ-60", { node: "Screens" })], { now })
  // The deeper knowledge node names PRJ-50 too, but the work lives in the owner's node.
  assert.deepEqual(plan.added.map((item) => [item.id, item.to, item.reason]), [
    ["PRJ-50", "projects/Guide.md", "key"],
    ["PRJ-51", "journals/2026_10_12.md", "journal"],
    ["PRJ-60", "projects/Screens.md", "chosen"],
  ])
  assert.match(read(ws, "projects/Guide.md"), /\n- Branch `feature\/PRJ-50`\n- TODO Work on PRJ-50 \[PRJ-50\]\([^)]+\)\n\n## References\nSee \[\[Decisions\]\]\.\n/)
  // Not after the last task of a themed section: the lead holds what is not sorted yet.
  assert.match(read(ws, "projects/Screens.md"), /\n- Fixes wait for the design review\n- TODO Work on PRJ-60 \[PRJ-60\]\([^)]+\)\n\n## Tables\n- TODO review the rich tables\n/)
  assert.doesNotMatch(read(ws, "Knowledge/Decisions.md"), /TODO/)
  assert.equal(build(ws).blocked.length, 0)
  assert.deepEqual((await check(ws)).issues.filter((item) => item.severity === "error"), [])
})

test("an items source's node is an inbox that may hold many tasks; other nodes are still told to split", async () => {
  const tasks = (n) => Array.from({ length: n }, (_, i) => `- TODO task ${i + 1}\n`).join("")
  const ws = await memo({ "projects/Inbox.md": `# Inbox\nOutside work waits here.\n\n${tasks(3)}`, "projects/Docs.md": `# Docs\nDocs work.\n\n${tasks(3)}` })
  ws.taskMax = 2
  const large = (await check(ws)).issues.filter((item) => item.code === "node-large").map((item) => item.key)
  assert.deepEqual(large, ["node-large|Docs"])
})
