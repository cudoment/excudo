import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { tempDir } from "./helpers.mjs"

const script = fileURLToPath(new URL("../scripts/public-tree.mjs", import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
const git = (dir, ...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })
const write = (root, rel, text) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text) }

// A maintainer's clone: their own instructions at the top, the published ones in public/.
function clone({ published = true } = {}) {
  const root = tempDir("excudo-public-")
  git(root, "init", "-q")
  git(root, "config", "user.email", "maintainer@example.invalid")
  git(root, "config", "user.name", "Maintainer")
  write(root, ".gitignore", "private/\n")
  write(root, "AGENTS.md", "# Working here\n\nMy own way of working, with my machine's paths.\n")
  write(root, "CLAUDE.md", "@AGENTS.md\n@my-notes.md\n")
  write(root, "package.json", JSON.stringify({ name: "tool", dependencies: { yaml: "^2.0.0" } }))
  write(root, "src/index.mjs", "export const tool = true\n")
  write(root, ".github/workflows/test.yml", "name: Tests\n")
  write(root, ".github/ISSUE_TEMPLATE/bug.yml", "name: Bug report\n")
  write(root, "CONTRIBUTING.md", "# Contributing\n\nUse dummy notes.\n")
  write(root, "templates/AGENTS.md", "# A workspace\n")
  mkdirSync(join(root, "skills", "one"), { recursive: true })
  write(root, "skills/one/SKILL.md", "# One\n")
  mkdirSync(join(root, ".claude", "skills"), { recursive: true })
  symlinkSync("../../skills/one", join(root, ".claude", "skills", "one"), "dir")
  if (published) {
    write(root, "public/AGENTS.md", "# Working on the tool\n\nRules for every contributor.\n")
    write(root, "public/CLAUDE.md", "@AGENTS.md\n")
  }
  git(root, "add", "-A")
  git(root, "commit", "-qm", "Start")
  return root
}

test("the published tree takes its instructions from public/, leaves public/ and uncommitted work out, and keeps links", () => {
  const root = clone()
  write(root, "src/draft.mjs", "not committed\n")
  const out = join(tempDir("excudo-public-out-"), "published")
  const done = run("export", "--root", root, "--out", out)
  assert.equal(done.status, 0, done.stdout + done.stderr)
  assert.equal(readFileSync(join(out, "AGENTS.md"), "utf8"), "# Working on the tool\n\nRules for every contributor.\n")
  assert.equal(readFileSync(join(out, "CLAUDE.md"), "utf8"), "@AGENTS.md\n")
  assert.equal(readFileSync(join(out, "templates", "AGENTS.md"), "utf8"), "# A workspace\n", "the templates ship as they are")
  assert.ok(!existsSync(join(out, "public")))
  assert.ok(!existsSync(join(out, "src", "draft.mjs")), "only the committed tree is published")
  assert.equal(readFileSync(join(out, ".github/workflows/test.yml"), "utf8"), "name: Tests\n")
  assert.equal(readFileSync(join(out, ".github/ISSUE_TEMPLATE/bug.yml"), "utf8"), "name: Bug report\n")
  assert.equal(readFileSync(join(out, "CONTRIBUTING.md"), "utf8"), "# Contributing\n\nUse dummy notes.\n")
  assert.equal(readFileSync(join(out, ".claude", "skills", "one", "SKILL.md"), "utf8"), "# One\n")
  assert.match(done.stdout, /1 uncommitted change/)
  assert.match(done.stdout, /no push guard/)
})

test("the export refuses a clone without published instructions, an unpublished instruction file, a local dependency or a denied word", () => {
  const bare = clone({ published: false })
  const missing = run("export", "--root", bare, "--out", join(tempDir("excudo-public-out-"), "x"))
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /public\/AGENTS\.md is not committed/)
  assert.match(missing.stdout, /public\/CLAUDE\.md is not committed/)

  const nested = clone()
  write(nested, "src/AGENTS.md", "# Notes for my agents here\n")
  write(nested, "문서/CLAUDE.md", "# 이 폴더에서 일하는 방식\n")
  write(nested, ".claude/settings.local.json", "{}\n")
  git(nested, "add", "-A", "-f"); git(nested, "commit", "-qm", "Nested")
  const unpublished = run("export", "--root", nested, "--out", join(tempDir("excudo-public-out-"), "x"))
  assert.equal(unpublished.status, 1)
  assert.match(unpublished.stdout, /src\/AGENTS\.md has no published version/)
  assert.match(unpublished.stdout, /문서\/CLAUDE\.md has no published version/, "a path git would quote is found too")
  assert.match(unpublished.stdout, /\.claude\/settings\.local\.json has no published version/)

  const local = clone()
  write(local, "package.json", JSON.stringify({ name: "tool", dependencies: { lib: "file:../lib" } }))
  git(local, "commit", "-qam", "Local lib")
  const linked = run("export", "--root", local, "--out", join(tempDir("excudo-public-out-"), "x"))
  assert.equal(linked.status, 1)
  assert.match(linked.stdout, /dependencies lib is file:\.\.\/lib, not from the registry/)

  const locked = clone()
  write(locked, "package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "tool" }, "node_modules/lib": { resolved: "../lib", link: true }, "../lib": { version: "1.0.0" } } }))
  git(locked, "add", "-A"); git(locked, "commit", "-qm", "Lock a linked lib")
  const lock = run("export", "--root", locked, "--out", join(tempDir("excudo-public-out-"), "x"))
  assert.equal(lock.status, 1)
  assert.match(lock.stdout, /package-lock\.json still links node_modules\/lib, \.\.\/lib/)

  const denied = clone()
  write(denied, "private/denylist.txt", "Acme-\n")
  write(denied, "public/AGENTS.md", "# Working on the tool\n\nAsk ACME-42 first.\n")
  git(denied, "commit", "-qam", "Name an issue")
  const word = run("export", "--root", denied, "--out", join(tempDir("excudo-public-out-"), "x"))
  assert.equal(word.status, 1)
  assert.match(word.stdout, /a word of the private denylist is in AGENTS\.md/)
})

test("the export replaces a published clone but its .git, and refuses a folder that is neither empty nor a clone", () => {
  const root = clone()
  const out = tempDir("excudo-public-out-")
  write(out, "notes.txt", "someone's files\n")
  assert.match(run("export", "--root", root, "--out", out).stdout, /neither empty nor a git clone/)
  const published = tempDir("excudo-public-clone-")
  git(published, "init", "-q")
  write(published, "old.mjs", "removed upstream\n")
  const done = run("export", "--root", root, "--out", published)
  assert.equal(done.status, 0, done.stdout + done.stderr)
  assert.ok(existsSync(join(published, ".git")) && !existsSync(join(published, "old.mjs")))
  assert.match(done.stdout, /change\(s\) to commit and push/)
  assert.match(run("export", "--root", root, "--out", join(root, "out")).stdout, /must be outside the clone/)
})

test("the guard refuses every push from the clone, keeps an earlier hook, and comes out again", { skip: process.platform === "win32" && "POSIX hook permission bits" }, () => {
  const root = clone()
  const remote = tempDir("excudo-public-remote-")
  git(remote, "init", "-q", "--bare")
  git(root, "remote", "add", "origin", remote)
  write(root, ".git/hooks/pre-push", "#!/bin/sh\nexit 0\n")
  assert.equal(run("status", "--root", root).status, 1)
  assert.equal(run("guard", "--root", root).status, 0)
  assert.ok(existsSync(join(root, ".git", "hooks", "pre-push.before-public-tree")))
  const pushed = git(root, "push", "-q", "origin", "HEAD")
  assert.notEqual(pushed.status, 0)
  assert.match(pushed.stderr, /public-tree guard: nothing is pushed from this clone/)
  assert.equal(git(remote, "rev-parse", "--verify", "-q", "HEAD").status, 1, "nothing reached the remote")
  assert.equal(run("status", "--root", root).status, 0)
  assert.match(run("guard", "--root", root).stdout, /already in/)
  assert.equal(run("guard", "--remove", "--root", root).status, 0)
  assert.equal(readFileSync(join(root, ".git", "hooks", "pre-push"), "utf8"), "#!/bin/sh\nexit 0\n")

  // A copy of the guard that git never runs is no guard; one that the running hook calls is.
  const hooks = join(root, ".git", "hooks")
  assert.equal(run("guard", "--root", root).status, 0)
  renameSync(join(hooks, "pre-push"), join(hooks, "pre-push.saved"))
  rmSync(join(hooks, "pre-push.before-public-tree"))
  assert.equal(run("status", "--root", root).status, 1, "only a saved copy is left")
  write(root, ".git/hooks/pre-push", '#!/bin/sh\n"$(dirname "$0")/pre-push.saved" "$@" || exit $?\n')
  chmodSync(join(hooks, "pre-push"), 0o755)
  assert.equal(run("status", "--root", root).status, 0, "the running hook calls the guard")
  chmodSync(join(hooks, "pre-push"), 0o644)
  assert.equal(run("status", "--root", root).status, 1, "git does not run a hook that is not executable")
  assert.equal(run("nothing").status, 2)
})
