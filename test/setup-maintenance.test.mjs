import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { feedbackDraft } from "../src/feedback.mjs"
import { tempDir, workspace } from "./helpers.mjs"

test("the setup skill validates real report files before setup and despite broken configuration", async () => {
  const ws = await workspace({})
  const draft = feedbackDraft(ws)
  const root = tempDir(), file = join(root, "draft.json")
  writeFileSync(join(root, "excudo.config.mjs"), "export default {")
  const run = (...args) => spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--feedback", file, "--json", ...args],
    { cwd: root, encoding: "utf8" })
  writeFileSync(file, JSON.stringify(draft))
  const valid = run()
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(JSON.parse(valid.stdout).checks[0].id, "feedback-draft")
  const unsafe = structuredClone(draft)
  unsafe.diagnostic.runs = [{ step: "build", status: "failed", codes: [], detail: "Private owner notes" }]
  writeFileSync(file, JSON.stringify(unsafe))
  assert.equal(run().status, 1)
  writeFileSync(file, JSON.stringify({ ...draft, details: true }))
  assert.equal(run().status, 1)
  assert.equal(run("--allow-details").status, 0)
})

test("setup discovery includes update and problem-report requests with concrete commands", () => {
  const skill = readFileSync(resolve("skills/excudo-setup/SKILL.md"), "utf8")
  assert.match(skill, /"update the engine"/)
  assert.match(skill, /"report a problem"/)
  assert.match(skill, /excudo update --apply --json/)
  assert.match(skill, /Quote each item verbatim/)
  assert.match(skill, /excudo feedback --title/)
  assert.match(skill, /--allow-details/)
})

test("the setup skill checks that an update's owner actions were relayed first and again after apply", () => {
  const root = tempDir(), update = join(root, "update.json"), first = join(root, "first.txt"), after = join(root, "after.txt")
  const run = (...relays) => spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--update", update, "--json",
    ...relays.flatMap((file) => ["--relay", file])], { cwd: root, encoding: "utf8" })
  const data = { applied: true, changelog: "## 0.8.0\n\n- Open Home\n", ownerActions: [{ version: "0.8.0", items: ["Settings: Rename the inbox setting"] }] }
  writeFileSync(update, JSON.stringify(data))
  writeFileSync(first, "0.8.0: Settings: Rename the inbox setting\nOpen Home\n")
  writeFileSync(after, "After applying: 0.8.0: Settings: Rename the inbox setting\n")
  assert.equal(run(first, after).status, 0)
  assert.equal(run(first).status, 1, "applied updates need the relay again")
  writeFileSync(first, "Open Home\n0.8.0: Settings: Rename the inbox setting\n")
  assert.equal(run(first, after).status, 1, "other notes came first")
  writeFileSync(first, "0.8.0: Settings: Rename the inbox setting\nOpen Home\n")
  const stale = spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--update", update, "--applied", "--json", "--relay", first, "--relay", after], { cwd: root, encoding: "utf8" })
  assert.equal(stale.status, 0, "an apply JSON carries applied: true")
  writeFileSync(update, JSON.stringify({ ...data, applied: false }))
  const before = spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--update", update, "--applied", "--json", "--relay", first, "--relay", after], { cwd: root, encoding: "utf8" })
  assert.equal(before.status, 1, "the JSON from before the apply is refused after an apply")
  writeFileSync(first, "직접 해야 할 일: 0.8.0 설정 이름 변경\n")
  assert.equal(run(first, after).status, 1, "a translation alone omits the verbatim item")
  writeFileSync(update, JSON.stringify({ ...data, ownerActions: [] }))
  assert.equal(run().status, 0)
  assert.match(readFileSync(resolve("skills/excudo-setup/SKILL.md"), "utf8"), /ownerActions/)
})
