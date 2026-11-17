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
  assert.match(skill, /excudo update --apply/)
  assert.match(skill, /excudo feedback --title/)
  assert.match(skill, /--allow-details/)
})
