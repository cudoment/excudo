import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { test } from "node:test"
import { recordRun, runRecords } from "../src/records.mjs"
import { workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
test("runs filters steps and failure states without changing unfiltered JSON", async () => {
  const ws = await workspace({ "Home.md": "# Home\nA memo.\n" }, { locale: "en" })
  const now = new Date()
  const records = [
    { step: "collect", status: "ok", detail: "done" },
    { step: "collect", status: "failed", detail: "a".repeat(300) },
    { step: "mirror", status: "deferred", detail: "한".repeat(300) },
    { step: "save", status: "failed", detail: null },
    { step: "mirror", status: "paused", detail: "paused" },
  ]
  for (const record of records) recordRun(ws, { ...record, started: now.toISOString(), finished: now.toISOString() })
  recordRun(ws, { step: "older", status: "failed", started: new Date(now.getTime() - 9 * 86400000).toISOString(), detail: "old" })
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, "runs", ...args, "--root", ws.root], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  assert.equal(run("--days", "3", "--json"), JSON.stringify(runRecords(ws, { days: 3 }), null, 2) + "\n")
  assert.equal(run("--json"), JSON.stringify(runRecords(ws, { days: 7 }), null, 2) + "\n")
  const filtered = (...args) => JSON.parse(run("--json", ...args)).map(({ step, status }) => [step, status])
  assert.deepEqual(filtered("--step", "collect"), [["collect", "failed"], ["collect", "ok"]])
  assert.deepEqual(filtered("--step", "collect", "--step", "save", "--failed"), [["save", "failed"], ["collect", "failed"]])
  assert.deepEqual(filtered("--deferred"), [["mirror", "deferred"]])
  assert.deepEqual(filtered("--failed", "--deferred"), [["save", "failed"], ["mirror", "deferred"], ["collect", "failed"]])
  assert.deepEqual(filtered("--step", "unknown"), [])
  assert.equal(run("--step", "collect", "--failed").trim().split("  ").at(-1), "a".repeat(159) + "…")
  assert.equal(run("--step", "mirror", "--deferred").trim().split("  ").at(-1), "한".repeat(159) + "…")
  assert.equal(run("--step", "collect", "--failed", "--full").trim().split("  ").at(-1), "a".repeat(300))
  assert.ok(JSON.parse(run("--json", "--failed"))[1].detail.length === 300)
})
