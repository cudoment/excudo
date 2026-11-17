#!/usr/bin/env node
// Usage: node scripts/public-tree.mjs export --out <folder> [--root <clone>] [--json]
//        node scripts/public-tree.mjs guard [--remove] [--root <clone>]
//        node scripts/public-tree.mjs status [--root <clone>] [--json]
// A maintainer's clone keeps the agent instructions they work with (AGENTS.md, CLAUDE.md), and the
// published repository gets the versions kept in public/, written for every contributor. export
// writes the committed tree (HEAD) to <folder>: each file in public/ takes the place of the file at
// the same path and public/ itself stays out. It refuses when public/ lacks AGENTS.md or CLAUDE.md,
// when another agent instruction or settings file (outside templates/, which ships to workspaces)
// has no version in public/, when a dependency or the lock file does not come from the registry,
// or when a word of the private denylist is in the tree. <folder> is new, empty or a clone of the published
// repository: its .git stays and everything else is replaced, ready to commit and push there.
// guard installs a pre-push hook that refuses every push from this clone, so its history and the
// maintainer's instructions stay here (--remove takes it out). status tells whether the guard is in
// and public/ is complete. Exit 0 when done, 1 when refused, 2 when it cannot run.
import { spawnSync } from "node:child_process"
import { accessSync, chmodSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { localDependencies } from "./dependencies.mjs"

const here = dirname(fileURLToPath(import.meta.url))
export const PUBLIC = "public/"
export const REQUIRED = ["AGENTS.md", "CLAUDE.md"]
// Files that tell an agent how to work, or how its tool behaves, in a clone.
const INSTRUCTIONS = new Set(["AGENTS.md", "AGENTS.override.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md"])
const SETTINGS = [".claude/settings.json", ".claude/settings.local.json", ".codex/config.toml"]
// The workspace templates are part of the product and ship as they are.
const PRODUCT = ["templates/"]
const MARK = "public-tree guard"

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options })
const git = (cwd, args, options) => run("git", ["-C", cwd, ...args], options)
const lines = (text) => (text ?? "").split("\n").filter(Boolean)
// NUL-separated, so git never quotes a path that holds non-ASCII characters.
const paths = (text) => (text ?? "").split("\0").filter(Boolean)
const inside = (child, parent) => child === parent || child.startsWith(parent + sep)
/** The real path of a folder that may not exist yet: its nearest existing ancestor, resolved. */
function real(path) {
  const rest = []
  let dir = resolve(path)
  while (!existsSync(dir) && dirname(dir) !== dir) { rest.unshift(basename(dir)); dir = dirname(dir) }
  return join(realpathSync(dir), ...rest)
}

/** The files of HEAD that an agent reads or obeys, with whether public/ holds a version of each. */
export function instructionFiles(root) {
  const tracked = paths(git(root, ["ls-tree", "-r", "-z", "--name-only", "HEAD"]).stdout)
  const published = new Set(tracked.filter((file) => file.startsWith(PUBLIC)).map((file) => file.slice(PUBLIC.length)))
  const files = tracked.filter((file) => !file.startsWith(PUBLIC) && !PRODUCT.some((dir) => file.startsWith(dir))
    && (INSTRUCTIONS.has(basename(file)) || SETTINGS.includes(file)))
  return { published, files: files.map((file) => ({ file, published: published.has(file) })), missing: REQUIRED.filter((file) => !published.has(file)) }
}

const runs = (file) => { try { accessSync(file, constants.X_OK); return existsSync(file) } catch { return false } }
const holds = (file) => existsSync(file) && readFileSync(file, "utf8").includes(MARK)

/**
 * Where the pre-push hook lives, and whether git runs the guard: the hook git runs is executable and
 * holds the guard, or calls an executable hook beside it that does (as a hook installed later keeps
 * the one it replaced). A copy of the guard that nothing runs does not count.
 */
function hookOf(root) {
  const hooks = resolve(root, git(root, ["rev-parse", "--git-path", "hooks"]).stdout.trim())
  const hook = join(hooks, "pre-push")
  const chained = existsSync(hooks) ? readdirSync(hooks).filter((name) => name.startsWith("pre-push.")).map((name) => join(hooks, name)) : []
  const text = runs(hook) ? readFileSync(hook, "utf8") : null
  const guarded = text !== null && (text.includes(MARK) || chained.some((file) => holds(file) && runs(file) && text.includes(basename(file))))
  return { hooks, hook, before: `${hook}.before-public-tree`, guarded }
}

export function status(root) {
  const { files, missing } = instructionFiles(root)
  const pending = lines(git(root, ["status", "--porcelain", "--", PUBLIC]).stdout)
  return { guarded: hookOf(root).guarded, missing, unpublished: files.filter((item) => !item.published).map((item) => item.file), pending }
}

export function guard(root, { remove = false } = {}) {
  const { hooks, hook, before, guarded } = hookOf(root)
  const ours = holds(hook)
  if (remove) {
    if (ours) unlinkSync(hook)
    if (ours && existsSync(before)) renameSync(before, hook)
    return { removed: ours }
  }
  if (guarded) return { installed: false, already: true }
  if (ours) { chmodSync(hook, 0o755); return { installed: true, kept: null } }
  mkdirSync(hooks, { recursive: true })
  if (existsSync(hook)) {
    if (existsSync(before)) throw new Error(`${before} is in the way of keeping the current pre-push hook`)
    renameSync(hook, before)
  }
  writeFileSync(hook, [
    "#!/bin/sh",
    `# ${MARK} (scripts/public-tree.mjs guard): this clone keeps its maintainer's history and agent`,
    "# instructions, so nothing is pushed from it. Push the tree that scripts/public-tree.mjs export",
    "# writes from the published clone instead.",
    `echo "${MARK}: nothing is pushed from this clone (remote: $1)." >&2`,
    'echo "  Write the published tree: node scripts/public-tree.mjs export --out <published clone>" >&2',
    'echo "  and push from there. To take the guard out: node scripts/public-tree.mjs guard --remove" >&2',
    "exit 1",
    "",
  ].join("\n"))
  chmodSync(hook, 0o755)
  return { installed: true, kept: existsSync(before) ? before : null }
}

export function exportTree(root, out) {
  const target = resolve(out)
  const head = git(root, ["rev-parse", "--short", "HEAD"])
  if (head.status !== 0) throw new Error(`${root} has no commit to export`)
  if (inside(real(target), realpathSync(root)) || inside(realpathSync(root), real(target))) {
    return { refused: [`${out} must be outside the clone`] }
  }
  if (existsSync(target) && readdirSync(target).length && !existsSync(join(target, ".git"))) {
    return { refused: [`${out} is neither empty nor a git clone; give a new folder or the published clone`] }
  }
  const { files, missing } = instructionFiles(root)
  const refused = [
    ...missing.map((file) => `${PUBLIC}${file} is not committed: write and commit the published version first`),
    ...files.filter((item) => !item.published).map((item) => `${item.file} has no published version in ${PUBLIC}`),
  ]
  if (refused.length) return { refused }

  const tree = mkdtempSync(join(tmpdir(), "excudo-public-"))
  try {
    const archive = git(root, ["archive", "--format=tar", "HEAD"], { encoding: "buffer" })
    if (archive.status !== 0 || run("tar", ["-x", "-C", tree], { input: archive.stdout, encoding: "buffer" }).status !== 0) {
      throw new Error("cannot unpack the committed tree")
    }
    const overlay = join(tree, PUBLIC)
    for (const file of paths(git(root, ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", PUBLIC]).stdout)) {
      const name = file.slice(PUBLIC.length)
      mkdirSync(dirname(join(tree, name)), { recursive: true })
      cpSync(join(tree, file), join(tree, name))
    }
    rmSync(overlay, { recursive: true, force: true })
    if (existsSync(join(tree, "package.json"))) {
      for (const item of localDependencies(JSON.parse(readFileSync(join(tree, "package.json"), "utf8")))) {
        refused.push(`${item.field} ${item.name} is ${item.spec}, not from the registry`)
      }
    }
    // A lock file written while a dependency was linked still points at the folder on this machine.
    if (existsSync(join(tree, "package-lock.json"))) {
      const packages = JSON.parse(readFileSync(join(tree, "package-lock.json"), "utf8")).packages ?? {}
      const linked = Object.entries(packages).filter(([path, entry]) => path.startsWith("..") || path.startsWith("/") || entry.link).map(([path]) => path)
      if (linked.length) refused.push(`package-lock.json still links ${linked.join(", ")}: run npm install with the published versions`)
    }
    git(tree, ["init", "-q"]); git(tree, ["add", "-A", "-f"])
    const denied = run(process.execPath, [join(here, "denylist.mjs"), "--root", tree, "--list", join(root, "private", "denylist.txt"), "--json"])
    let deny = {}
    try { deny = JSON.parse(denied.stdout) } catch {}
    if (denied.status !== 0) refused.push(deny.found?.length ? `a word of the private denylist is in ${deny.found.map((item) => item.file).join(", ")}` : "the denylist could not run")
    rmSync(join(tree, ".git"), { recursive: true, force: true })
    if (refused.length) return { refused }

    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(target)) if (entry !== ".git") rmSync(join(target, entry), { recursive: true, force: true })
    cpSync(tree, target, { recursive: true, verbatimSymlinks: true })
    const uncommitted = lines(git(root, ["status", "--porcelain"]).stdout).length
    const clone = existsSync(join(target, ".git"))
    return {
      out: target, commit: head.stdout.trim(), files: lines(run("find", [".", "-type", "f", "-not", "-path", "./.git/*"], { cwd: target }).stdout).length,
      published: [...REQUIRED], denylist: deny.skipped ? "no private list" : "clean", uncommitted, guarded: hookOf(root).guarded,
      changes: clone ? lines(git(target, ["status", "--porcelain"]).stdout).length : null,
    }
  } finally {
    rmSync(tree, { recursive: true, force: true })
  }
}

// Run as a command, also through a linked node_modules path (Node loads the module from its real path).
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const usage = "Usage: node scripts/public-tree.mjs export --out <folder> | guard [--remove] | status  [--root <clone>] [--json]"
  let parsed
  try {
    parsed = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, root: { type: "string" }, remove: { type: "boolean" }, json: { type: "boolean" } } })
  } catch (error) {
    console.error(`${error.message}\n${usage}`)
    process.exit(2)
  }
  const { values, positionals: [action] } = parsed
  const root = resolve(values.root ?? join(here, ".."))
  const print = (result, text) => console.log(values.json ? JSON.stringify(result, null, 2) : text)
  try {
    if (action === "export" && values.out) {
      const result = exportTree(root, values.out)
      if (result.refused) {
        print(result, result.refused.map((reason) => `✗ public-tree: ${reason}`).join("\n"))
        process.exit(1)
      }
      print(result, [
        `✓ public-tree: wrote ${result.files} files of ${result.commit} to ${result.out}, with ${PUBLIC}${REQUIRED.join(` and ${PUBLIC}`)} as the instructions (denylist: ${result.denylist}).`,
        result.uncommitted ? `- ${result.uncommitted} uncommitted change(s) in the clone are not in it: commit them and export again to include them.` : "",
        result.changes === null ? "- The folder is not a git clone: clone the published repository there to commit and push." : `- ${result.changes} change(s) to commit and push from ${result.out}.`,
        result.guarded ? "" : "- This clone has no push guard yet: node scripts/public-tree.mjs guard",
      ].filter(Boolean).join("\n"))
    } else if (action === "guard") {
      const result = guard(root, { remove: values.remove })
      print(result, values.remove ? (result.removed ? "✓ public-tree: the push guard is out." : "- public-tree: there was no push guard.")
        : result.already ? "✓ public-tree: the push guard is already in." : `✓ public-tree: the push guard refuses every push from this clone${result.kept ? ` (the earlier hook is kept as ${result.kept})` : ""}.`)
    } else if (action === "status") {
      const result = status(root)
      print(result, [
        result.guarded ? "✓ guard: nothing is pushed from this clone." : "✗ guard: pushes are not refused; node scripts/public-tree.mjs guard",
        result.missing.length ? `✗ ${PUBLIC}: ${result.missing.join(", ")} not committed` : `✓ ${PUBLIC}: ${REQUIRED.join(", ")} committed`,
        ...result.unpublished.map((file) => `✗ ${file} has no published version in ${PUBLIC}`),
        result.pending.length ? `- ${PUBLIC} has uncommitted changes: ${result.pending.join(", ")}` : "",
      ].filter(Boolean).join("\n"))
      process.exit(result.guarded && !result.missing.length && !result.unpublished.length ? 0 : 1)
    } else {
      console.error(usage)
      process.exit(2)
    }
  } catch (error) {
    console.error(`✗ public-tree: ${error.message}`)
    process.exit(2)
  }
}
