import assert from "node:assert/strict"
import { test } from "node:test"
import { batchesOf, CHANGE_LIMITS as LIMITS, CHANGES_MARK as MARK, changesFromIssue, checkChanges, isSyncIssue, issueBody, issueTitle, syncBody, syncTitle } from "../src/index.mjs"

const entry = { id: "change-0001", kind: "task", page: "projects/Work.md", line: 3, hash: "0123456789", from: "TODO", to: "DONE", at: "2026-10-28T01:00:00.000Z" }
const batch = (entries = [entry], more = {}) => ({ format: "excudo-changes", version: 1, site: "memo-1", entries, ...more })

test("a batch of changes keeps only the fields it knows, and its page in one form", () => {
  const checked = checkChanges(batch([{ ...entry, text: "the task's words", page: "projects/메모.md".normalize("NFD") }], { extra: true }))
  assert.deepEqual(Object.keys(checked), ["format", "version", "site", "entries"])
  assert.deepEqual(checked.entries[0], { ...entry, page: "projects/메모.md".normalize("NFC") }, "no text of the task travels")
  assert.deepEqual(checkChanges(batch([{ ...entry, at: undefined }])).entries[0].at, undefined)
})

test("a batch that is not one is refused with what is wrong first", () => {
  const wrong = [
    [null, "not an object"], [[], "not an object"], [batch([], { format: "other" }), "format"], [batch([entry], { version: 2 }), "version"],
    [batch([entry], { site: "a b" }), "site"], [batch([]), "entries"],
    [batch(Array.from({ length: LIMITS.entries + 1 }, (_, i) => ({ ...entry, id: `change-${String(i).padStart(4, "0")}` }))), `more than ${LIMITS.entries} entries`],
    [batch([{ ...entry, id: "short" }]), "entries[0].id"], [batch([entry, entry]), "entries[1].id repeated"],
    [batch([{ ...entry, kind: "append" }]), "entries[0].kind"],
    [batch([{ ...entry, line: 0 }]), "entries[0].line"], [batch([{ ...entry, line: 2.5 }]), "entries[0].line"],
    [batch([{ ...entry, hash: "XYZ" }]), "entries[0].hash"], [batch([{ ...entry, from: "todo" }]), "entries[0].from"],
    [batch([{ ...entry, to: "LATER" }]), "entries[0].to"], [batch([{ ...entry, at: "yesterday" }]), "entries[0].at"],
  ]
  for (const [doc, reason] of wrong) assert.throws(() => checkChanges(doc), (error) => error.reason === reason, reason)
  for (const page of ["../outside.md", "/etc/passwd.md", "a//b.md", "a/./b.md", "notes.txt", "a\\b.md", "", "x".repeat(LIMITS.page) + ".md"]) {
    assert.throws(() => checkChanges(batch([{ ...entry, page }])), (error) => error.reason === "entries[0].page", page)
  }
})

test("an issue carries a batch after its mark, and says only how many changes it holds", () => {
  const doc = checkChanges(batch())
  assert.equal(issueTitle(doc), "excudo-changes: 1 change")
  assert.equal(issueTitle(checkChanges(batch([entry, { ...entry, id: "change-0002" }]))), "excudo-changes: 2 changes")
  assert.ok(issueBody(doc).startsWith(MARK))
  assert.deepEqual(changesFromIssue(issueBody(doc)), doc)
  assert.deepEqual(changesFromIssue(`Written by hand above.\n\n${issueBody(doc)}`), doc, "words before the mark are passed over")
  assert.equal(changesFromIssue("An issue someone wrote."), null)
  assert.equal(changesFromIssue(undefined), null)
  assert.throws(() => changesFromIssue(`${MARK}\n\nno block`), /no JSON block/)
  assert.throws(() => changesFromIssue(`${MARK}\n\n\`\`\`json\n{ broken\n\`\`\``), /JSON/)
  assert.throws(() => changesFromIssue(`${MARK}\n\n\`\`\`json\n{"format":"other"}\n\`\`\``), /format/)
})

test("a request to bring the changes in now is told apart from a batch, and carries nothing of the memo", () => {
  const body = syncBody("memo-1", "2026-10-28T02:00:00.000Z")
  assert.ok(isSyncIssue(body))
  assert.equal(isSyncIssue(issueBody(checkChanges(batch()))), false)
  // A board may name the request's mark in its words; its batch is still a batch.
  const board = { id: "board-0001", kind: "board", page: "Board.md", base: "0a1b2c3d", text: "- Remember <!-- excudo-sync --> in the engine", at: "2026-10-29T03:00:00Z" }
  assert.equal(isSyncIssue(issueBody(checkChanges(batch([board])))), false)
  assert.equal(changesFromIssue(body), null, "it holds no change")
  assert.deepEqual(batchesOf([{ number: 4, body }]), [], "receive passes it over")
  assert.equal(syncTitle(), "excudo-sync: bring the changes in now")
  assert.deepEqual(JSON.parse(body.match(/```json\n([\s\S]*?)\n```/)[1]), { format: "excudo-sync", version: 1, site: "memo-1", at: "2026-10-28T02:00:00.000Z" })
})
