import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { commitGraph } from "../src/git.mjs"
import { put, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
function git(ws, ...args) {
  const result = spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
async function repo() {
  const ws = await workspace({ "Page.md": "# Page\nA page.\n", "Other.md": "# Other\nAnother page.\n" }, { locale: "en" })
  writeFileSync(join(ws.root, ".gitignore"), ".excudo/\n")
  git(ws, "init", "-q")
  git(ws, "config", "user.name", "Owner")
  git(ws, "config", "user.email", "owner@example.invalid")
  git(ws, "add", ".")
  git(ws, "commit", "-qm", "Notes")
  put(ws.root, "Page.md", "# Page\nAn edited page.\n")
  put(ws.root, "Other.md", "# Other\nAnother edited page.\n")
  return ws
}

for (const command of ["save", "snapshot"]) {
  test(`${command} --only accepts graph, workspace and absolute paths`, async () => {
    for (const form of ["Page.md", "notes/Page.md", "absolute"]) {
      const ws = await repo()
      const selected = form === "absolute" ? join(ws.graphDir, "Page.md") : form
      const result = spawnSync(process.execPath, [cli, command, ...(command === "save" ? ["Edited page"] : []), "--only", selected], { cwd: ws.root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr + result.stdout)
      assert.equal(git(ws, "show", "--format=", "--name-only", "HEAD"), "notes/Page.md")
      assert.match(git(ws, "status", "--porcelain"), /Other.md/)
      assert.doesNotMatch(git(ws, "status", "--porcelain"), /Page.md/)
    }
  })

  test(`${command} --only rejects an unknown path before committing any selection`, async () => {
    const ws = await repo()
    const before = git(ws, "rev-parse", "HEAD")
    for (const unknown of ["missing.md", "../outside.md", "notes", ws.root]) {
      const result = spawnSync(process.execPath, [cli, command, ...(command === "save" ? ["Edited page"] : []), "--only", "Page.md", "--only", unknown], { cwd: ws.root, encoding: "utf8" })
      assert.equal(result.status, 1, result.stderr + result.stdout)
      assert.ok(result.stderr.includes(`--only ${unknown}`), result.stderr)
      assert.equal(git(ws, "rev-parse", "HEAD"), before)
      assert.equal(git(ws, "diff", "--cached", "--name-only"), "")
    }
  })
}

test("a selected tracked deletion is saved with either relative path", async () => {
  for (const file of ["Page.md", "notes/Page.md"]) {
    const ws = await repo()
    rmSync(join(ws.graphDir, "Page.md"))
    assert.equal(commitGraph(ws, "Deleted page", { only: [file] }), "committed")
    assert.equal(git(ws, "show", "--format=", "--name-status", "HEAD"), "D\tnotes/Page.md")
  }
})
