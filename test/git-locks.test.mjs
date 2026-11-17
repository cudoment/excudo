import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { commitContents, commitGraph } from "../src/git.mjs"
import { put, workspace } from "./helpers.mjs"

test("graph and content commits name an existing index lock without removing it", async () => {
  const ws = await workspace({ "Page.md": "# Page\nA page.\n" }, { locale: "en" })
  const git = (...args) => {
    const result = spawnSync("git", ["-C", ws.root, "-c", "user.name=Owner", "-c", "user.email=owner@example.invalid", ...args], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q")
  git("add", ".")
  git("commit", "-qm", "Notes")
  const before = git("rev-parse", "HEAD")
  put(ws.root, "Page.md", "# Page\nAn edited page.\n")
  const lock = git("rev-parse", "--path-format=absolute", "--git-path", "index.lock")
  writeFileSync(lock, "leftover lock")
  for (const commit of [() => commitGraph(ws, "Edited page"), () => commitContents(ws, "Edited page", [{ file: "Page.md", content: Buffer.from("# Page\nSaved contents.\n") }])]) {
    assert.throws(commit, (error) => error.message.includes(lock) && /Retry when no git command is running/.test(error.message))
    assert.ok(existsSync(lock))
    assert.equal(readFileSync(lock, "utf8"), "leftover lock")
    assert.equal(git("rev-parse", "HEAD"), before)
    assert.equal(readFileSync(join(ws.graphDir, "Page.md"), "utf8"), "# Page\nAn edited page.\n")
  }
})
