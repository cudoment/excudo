import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { queueItems, queueReport } from "../src/index.mjs"
import { graphNow, tasksOf } from "../src/skillkit.mjs"
import { workspace } from "./helpers.mjs"

const NAME = "한글 페이지"

test("graphNow and tasksOf give NFC paths for a page written with a decomposed name, and a write-back still reaches the file", async () => {
  const ws = await workspace({ "Seed.md": "# Seed\n" }, { locale: "en" })
  const disk = `${NAME.normalize("NFD")}.md`
  writeFileSync(join(ws.graphDir, disk), "# Page\n\n- TODO Check the links #agent\n")
  const onDisk = readdirSync(ws.graphDir).find((name) => name.normalize("NFC") === `${NAME}.md`)
  assert.ok(onDisk)
  const files = graphNow(ws)
  const file = files.find((entry) => entry.file.normalize("NFC").endsWith(`${NAME}.md`))
  assert.equal(file.file, `notes/${NAME}.md`.normalize("NFC"))
  assert.match(file.text, /Check the links/)
  const task = tasksOf(files).find((each) => each.text.startsWith("Check the links"))
  assert.equal(task.file, `notes/${NAME}.md`.normalize("NFC"))
  // A caller that writes back resolves the NFC name to the spelling on disk.
  const [item] = queueItems(ws)
  queueReport(ws, item.key, { summary: "Two links are broken" })
  assert.match(readFileSync(join(ws.graphDir, onDisk), "utf8"), /WAITING Review: Two links are broken/)
  assert.equal(readdirSync(ws.graphDir).filter((name) => name.endsWith(".md") && name.normalize("NFC") === `${NAME}.md`).length, 1)
  assert.ok(existsSync(join(ws.graphDir, onDisk)))
})
