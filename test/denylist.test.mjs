import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { tempDir } from "./helpers.mjs"

const script = fileURLToPath(new URL("../scripts/denylist.mjs", import.meta.url))
const root = fileURLToPath(new URL("..", import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })

test("the denylist finds a listed word in a file's text or path, ignoring case, and passes without a list", () => {
  const repo = tempDir("excudo-deny-")
  spawnSync("git", ["init", "-q", repo])
  writeFileSync(join(repo, ".gitignore"), "private/\n")
  mkdirSync(join(repo, "private"))
  writeFileSync(join(repo, "notes.md"), "Nothing to hide here.\n")
  assert.equal(run("--root", repo).status, 0, "no list: nothing to compare")
  writeFileSync(join(repo, "private", "denylist.txt"), "# words that never leave this machine\nAcme-\n")
  assert.equal(run("--root", repo).status, 0)
  writeFileSync(join(repo, "notes.md"), "Nothing to hide here.\nSee ACME-12 for the plan.\n")
  const found = run("--root", repo, "--json")
  assert.equal(found.status, 1)
  assert.deepEqual(JSON.parse(found.stdout).found, [{ file: "notes.md", line: 2 }])
  assert.doesNotMatch(found.stdout, /acme/i, "the report never repeats the word")
  writeFileSync(join(repo, "notes.md"), "Nothing to hide here.\n")
  writeFileSync(join(repo, "acme-plan.md"), "A plan.\n")
  assert.deepEqual(JSON.parse(run("--root", repo, "--json").stdout).found, [{ file: "acme-plan.md" }])
})

test("no file of this repository holds a word of the maintainer's private denylist", { skip: !existsSync(join(root, "private", "denylist.txt")) && "no private/denylist.txt" }, () => {
  const result = run()
  assert.equal(result.status, 0, result.stdout)
})
