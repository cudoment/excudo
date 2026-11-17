import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { commitSubjects, groupSubjects, prependRelease, recentSections } from "../scripts/changelog.mjs"
import { tempDir } from "./helpers.mjs"

test("changelog groups subjects by area, retains order and deduplicates summaries", () => {
  assert.deepEqual(groupSubjects(["Site: Open Home", "CLI: Check version", "Site: Open Home", "Site: Keep tasks", "Initial tree"]), [
    { area: "CLI", summaries: ["Check version"] }, { area: "Other", summaries: ["Initial tree"] }, { area: "Site", summaries: ["Open Home", "Keep tasks"] },
  ])
})

test("changelog writes are idempotent and keep older sections", () => {
  const before = "# Changelog\n\n## 0.6.0\n\n- Earlier work\n"
  const subjects = ["CLI: Check versions"]
  const first = prependRelease(before, "0.7.0", subjects)
  assert.equal(prependRelease(first, "0.7.0", subjects), first)
  assert.match(first, /## 0\.7\.0[\s\S]*### CLI[\s\S]*Check versions[\s\S]*## 0\.6\.0/)
  assert.equal((prependRelease(first, "0.7.0", ["CLI: Revised"]).match(/## 0\.7\.0/g) ?? []).length, 1)
})

test("changelog CLI limits the history with --since and writes the requested version", () => {
  const root = tempDir()
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git("init", "-q"); git("config", "user.name", "Test User"); git("config", "user.email", "test@example.invalid")
  git("commit", "--allow-empty", "-qm", "Base: Begin")
  const base = git("rev-parse", "HEAD")
  git("commit", "--allow-empty", "-qm", "Site: Open Home")
  assert.deepEqual(commitSubjects(root, base), ["Site: Open Home"])
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "0.7.0" }))
  const script = resolve("scripts/changelog.mjs")
  const run = () => spawnSync(process.execPath, [script, "--since", base, "--write", "0.7.0"], { cwd: root, encoding: "utf8" })
  assert.equal(run().status, 0)
  const first = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  assert.equal(run().status, 0)
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), first)
  assert.doesNotMatch(first, /Begin/)
  const published = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.equal(published.excudoReleaseNotes.version, "0.7.0")
  assert.match(published.excudoReleaseNotes.markdown, /### Site[\s\S]*Open Home/)
})


test("only short capitalized areas group commit subjects", () => {
  const sentences = ["Keep a workspace's own skills in the workspace under install: global", "Refuse any dependency from a folder, not only file: specs",
    "Write the memo as a website with cudoc-export: keep the outline", "lowercase: keep the subject", "Four Word Area Title: retain it", "Capitalized Extremely Long: retain it", "Add cudoc-memo: Initial work"]
  const groups = groupSubjects([...sentences, "CLI: A command", "Release Notes: A section"])
  assert.deepEqual(groups.find((item) => item.area === "Other").summaries, sentences)
  assert.ok(groups.some((item) => item.area === "Release Notes"))
  assert.ok(!groups.some((item) => item.area === "Add cudoc-memo"))
})

test("packaged notes keep the newest sections, not only the latest", () => {
  const text = "# Changelog\n\n## 0.9.0\n\n- C\n\n## 0.8.0\n\n- B\n\n## 0.7.0\n\n- A\n"
  assert.equal(recentSections(text, 2), "## 0.9.0\n\n- C\n\n## 0.8.0\n\n- B\n")
  assert.match(recentSections(text), /0\.7\.0/)
})
