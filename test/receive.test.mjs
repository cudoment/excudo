import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { appliedIds, batchesOf, issueBody, receive, receivedOf, taskHash } from "../src/index.mjs"
import { read, tempDir, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const NOW = new Date(2026, 9, 28, 15, 0)
const WORK = "# Work\nCurrent work.\n\n- TODO Write the plan\n- DOING Ship the site [[Design]]\n\t- WAITING Review: the draft\n- DONE Read the brief\n"

let n = 0
/** A change of the task on `line` of `page` whose words are `text`, as a page sends it. */
const change = (page, line, text, to, from = text.match(/^\S+/)[0]) => ({ id: `change-${String(++n).padStart(4, "0")}`, kind: "task", page, line, hash: taskHash(text), from, to, at: NOW.toISOString() })
const batch = (...entries) => ({ format: "excudo-changes", version: 1, site: "memo-1", entries })
const journal = (ws) => {
  const dir = join(ws.graphDir, "journals")
  return existsSync(dir) ? readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8")).join("") : ""
}

test("a state chosen on the website replaces the state word on its line, and only that", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const result = receive(ws, batchesOf(batch(
    change("projects/Work.md", 4, "TODO Write the plan", "DOING"),
    change("projects/Work.md", 6, "WAITING Review: the draft", "DONE"),
    change("projects/Work.md", 7, "DONE Read the brief", "TODO"),
  )), { now: NOW })
  assert.deepEqual(result.results.map(({ status, reason }) => [status, reason]), [["applied", "line"], ["applied", "line"], ["applied", "line"]])
  assert.equal(read(ws, "projects/Work.md"), "# Work\nCurrent work.\n\n- DOING Write the plan\n- DOING Ship the site [[Design]]\n\t- DONE Review: the draft\n- TODO Read the brief\n")
  assert.deepEqual(result.touched, ["projects/Work.md"])
  assert.deepEqual(result.batches, [{ source: "batch 1", issue: undefined, done: true }])
  assert.equal(journal(ws), "", "nothing to settle")
})

test("a task the owner lets go on the website becomes CANCELED, and one let go before opens again", async () => {
  const ws = await workspace({ "projects/Work.md": "# Work\nCurrent work.\n\n- TODO Write the plan\n- CANCELED Old idea\n- CANCELLED Older idea\n- CANCELLED Oldest idea\n" })
  const result = receive(ws, batchesOf(batch(
    change("projects/Work.md", 4, "TODO Write the plan", "CANCELED"),
    change("projects/Work.md", 5, "CANCELED Old idea", "TODO"),
    // The page shows the other spelling as CANCELED, and sends it so.
    change("projects/Work.md", 6, "CANCELLED Older idea", "TODO", "CANCELED"),
    change("projects/Work.md", 7, "CANCELLED Oldest idea", "CANCELED", "TODO"),
  )), { now: NOW })
  assert.deepEqual(result.results.map(({ status }) => status), ["applied", "applied", "applied", "already"])
  assert.equal(read(ws, "projects/Work.md"), "# Work\nCurrent work.\n\n- CANCELED Write the plan\n- TODO Old idea\n- TODO Older idea\n- CANCELLED Oldest idea\n")
})

test("a task that moved is found by its words when they are on one line only; anything else is noted, not guessed", async () => {
  const ws = await workspace({
    "projects/Work.md": "# Work\nCurrent work.\n\n- TODO New first line\n- TODO Write the plan\n- DOING Ship the site [[Design]]\n- TODO Twice\n- TODO Twice\n- DONE Read the brief\n",
    "projects/Other.md": "# Other\nMore.\n\n- TODO Something\n",
  })
  const moved = change("projects/Work.md", 4, "TODO Write the plan", "DONE")
  const reworded = change("projects/Work.md", 5, "DOING Ship the website", "DONE")
  const several = change("projects/Work.md", 9, "TODO Twice", "DONE")
  const changed = change("projects/Work.md", 9, "TODO Read the brief", "DOING")
  const gone = change("projects/Gone.md", 4, "TODO Something", "DONE")
  const result = receive(ws, batchesOf(batch(moved, reworded, several, changed, gone)), { now: NOW })
  assert.deepEqual(result.results.map(({ status, reason, line }) => [status, reason, line]),
    [["applied", "moved", 5], ["uncertain", "changed", 5], ["uncertain", "several", 9], ["uncertain", "state", 9], ["uncertain", "missing", 4]])
  assert.equal(read(ws, "projects/Work.md").split("\n")[4], "- DONE Write the plan")
  assert.equal(result.results[3].now, "DONE", "the line holds the task, in another state than the page showed")
  const noted = journal(ws).trim().split("\n")
  assert.equal(noted.length, 4)
  assert.ok(noted.every((line) => line.startsWith("- WAITING ")), "each one is a waiting task for the owner")
  assert.match(noted[0], /\[\[Work\]\] line 5 to DONE, the line changed/)
  assert.match(noted[2], /\[\[Work\]\] line 9 to DOING, the task is DONE now/)
  assert.match(noted[3], /\[\[Gone\]\] line 4 to DONE, the page is gone/)
  assert.deepEqual(result.touched, ["projects/Work.md", "journals/2026_10_28.md"])
})

test("a task already in the chosen state is left alone, and a change read twice changes nothing twice", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const first = change("projects/Work.md", 4, "TODO Write the plan", "DONE")
  const same = change("projects/Work.md", 5, "DOING Ship the site [[Design]]", "DOING", "TODO")
  const doc = batch(first, same)
  const once = receive(ws, batchesOf(doc), { now: NOW })
  assert.deepEqual(once.results.map(({ status }) => status), ["applied", "already"])
  const text = read(ws, "projects/Work.md")
  const twice = receive(ws, batchesOf(doc), { now: NOW })
  assert.deepEqual(twice.results.map(({ status, reason }) => [status, reason]), [["already", "received"], ["already", "received"]])
  assert.equal(read(ws, "projects/Work.md"), text)
  assert.deepEqual(twice.touched, [])
  assert.deepEqual(Object.keys(receivedOf(ws)).sort(), [first.id, same.id].sort())
  assert.deepEqual(appliedIds(ws, { now: NOW }), [first.id, same.id].sort(), "the website names them so a page stops waiting")
  assert.deepEqual(appliedIds(ws, { now: new Date(NOW.getTime() + 31 * 86400000) }), [], "a month later they are no longer named")
})

test("a dry run reports and writes nothing, and the ledger forgets what is three months old", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const dry = receive(ws, batchesOf(batch(change("projects/Work.md", 4, "TODO Write the plan", "DONE"), change("projects/Work.md", 99, "TODO Nowhere", "DONE"))), { dryRun: true, now: NOW })
  assert.deepEqual(dry.results.map(({ status }) => status), ["applied", "uncertain"])
  assert.deepEqual([dry.writes, dry.touched], [["projects/Work.md", "journals/2026_10_28.md"], []], "what it would write, so its caller can commit the owner's edits there first")
  assert.equal(read(ws, "projects/Work.md"), WORK)
  assert.equal(journal(ws), "")
  assert.deepEqual(receivedOf(ws), {})
  mkdirSync(ws.cacheDir, { recursive: true })
  writeFileSync(join(ws.cacheDir, "received.json"), JSON.stringify({ version: 1, received: { "old-change1": { status: "applied", at: "2026-01-01T00:00:00.000Z", source: "#1" } } }))
  receive(ws, batchesOf(batch(change("projects/Work.md", 4, "TODO Write the plan", "DONE"))), { now: NOW })
  assert.equal(Object.keys(receivedOf(ws)).includes("old-change1"), false)
})

test("a page named in one form finds its file written in the other", async () => {
  const name = "개인 운영"
  const ws = await workspace({ [`projects/${name.normalize("NFD")}.md`]: `# ${name}\nSummary.\n\n- TODO 메모 정리\n` })
  const result = receive(ws, batchesOf(batch(change(`projects/${name.normalize("NFC")}.md`, 4, "TODO 메모 정리", "DONE"))), { now: NOW })
  assert.equal(result.results[0].status, "applied")
  assert.equal(read(ws, `projects/${name.normalize("NFD")}.md`).split("\n")[3], "- DONE 메모 정리")
})

test("issues as gh lists them: a batch after the mark is read, an issue without one is passed over, a broken one is kept open", () => {
  const good = batch(change("projects/Work.md", 4, "TODO Write the plan", "DONE"))
  const read = batchesOf([
    { number: 3, title: "excudo-changes: 1 change", body: issueBody(good) },
    { number: 4, title: "A question", body: "Someone wrote this." },
    { number: 5, title: "excudo-changes: 1 change", body: "<!-- excudo-changes -->\n\n```json\n{\"format\":\"excudo-changes\"}\n```" },
  ])
  assert.deepEqual(read.map(({ source, issue }) => [source, issue]), [["#3", 3], ["#5", 5]])
  assert.equal(read[0].doc.entries.length, 1)
  assert.match(read[1].error, /version/)
  assert.deepEqual(batchesOf(good).map(({ source }) => source), ["batch 1"])
  assert.match(batchesOf([{ format: "nope" }])[0].error, /format/)
})

test("excudo receive brings in issues from a file or standard input, and says what it did", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const file = join(tempDir(), "issues.json")
  writeFileSync(file, JSON.stringify([{ number: 8, body: issueBody(batch(change("projects/Work.md", 4, "TODO Write the plan", "DONE"))) }]))
  const dry = spawnSync(process.execPath, [cli, "receive", "--input", file, "--dry-run", "--json"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(dry.status, 0, dry.stderr)
  assert.deepEqual(JSON.parse(dry.stdout).batches, [{ source: "#8", issue: 8, done: true }])
  assert.equal(read(ws, "projects/Work.md"), WORK)
  const run = spawnSync(process.execPath, [cli, "receive", "--input", "-"], { cwd: ws.root, encoding: "utf8", input: readFileSync(file, "utf8") })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /1 applied, 0 already in the memo, 0 noted/)
  assert.equal(read(ws, "projects/Work.md").split("\n")[3], "- DONE Write the plan")
  const none = spawnSync(process.execPath, [cli, "receive", "--input", "-"], { cwd: ws.root, encoding: "utf8", input: "[]" })
  assert.match(none.stdout, /No change from the website/)
  const missing = spawnSync(process.execPath, [cli, "receive"], { cwd: ws.root, encoding: "utf8" })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /--input/)
})

test("issues listed newest first are taken oldest first, so a task changed twice ends in the last state", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const first = change("projects/Work.md", 4, "TODO Write the plan", "DOING")
  const second = change("projects/Work.md", 4, "DOING Write the plan", "DONE")
  const result = receive(ws, batchesOf([{ number: 12, body: issueBody(batch(second)) }, { number: 11, body: issueBody(batch(first)) }]), { now: NOW })
  assert.deepEqual(result.results.map(({ source, status }) => [source, status]), [["#11", "applied"], ["#12", "applied"]])
  assert.equal(read(ws, "projects/Work.md").split("\n")[3], "- DONE Write the plan")
})

test("a change received before still names the file it wrote, the journal too, so a commit that failed can be made again", async () => {
  const ws = await workspace({ "projects/Work.md": WORK })
  const doc = batch(change("projects/Work.md", 4, "TODO Write the plan", "DONE"), change("projects/Work.md", 5, "DOING Ship the website", "DONE"))
  const once = receive(ws, batchesOf(doc), { now: NOW })
  assert.deepEqual(once.results.map(({ status, file }) => [status, file]), [["applied", "projects/Work.md"], ["uncertain", "journals/2026_10_28.md"]])
  const again = receive(ws, batchesOf(doc), { now: NOW })
  assert.deepEqual(again.results.map(({ status, file, was }) => [status, file, was]), [["already", "projects/Work.md", "applied"], ["already", "journals/2026_10_28.md", "uncertain"]],
    "and what became of it, so it is closed the same way again")
  assert.deepEqual([again.writes, again.touched], [[], []])
})
