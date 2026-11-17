// What `excudo save` does, given back as data: check the memo, build what is generated, then commit.
// With `only`, those graph files and what the build wrote are committed, but not a file someone else
// had changed before, so edits made meanwhile elsewhere in the memo keep their own commit. The CLI
// says the result; a command that writes the memo by itself (`site pull`) commits the same way.
import { resolve } from "node:path"
import { build, prepare } from "./build.mjs"
import { check, errorsOf } from "./check.mjs"
import { changedGraphFiles, commitGraph, heldFiles, heldPath, onlyGraphPaths } from "./git.mjs"

/**
 * Returns `{ code, top, errors, loud, built, state }`: code 1 when the check found errors (nothing
 * built or committed) or the build failed, 2 when the build was blocked, else 0 with the commit's
 * `state` (committed, clean, not-git). `loud` holds what should not reach git, said without stopping.
 */
export async function saveGraph(ws, message, { only, force = false } = {}) {
  const selected = only && onlyGraphPaths(ws, only)
  const before = only ? new Set(changedGraphFiles(ws).map((file) => file.normalize("NFC"))) : null
  const mine = selected ? new Set(selected.map((file) => file.normalize("NFC"))) : null
  // Collect once for both the check and the build; nothing changes the graph in between.
  let prepared
  try { prepared = prepare(ws) } catch {}
  const { issues, top } = await check(ws, { prepared })
  // A page someone else is changing (held by a scheduled run) may be half written; its errors are that
  // person's to fix and do not stop this save, which leaves the page out of its commit.
  const held = heldFiles(ws)
  const errors = errorsOf(issues).filter((issue) => !issue.file || !heldPath(ws, resolve(ws.graphDir, issue.file), held))
  const loud = issues.filter((issue) => ["private-line", "sync-conflict"].includes(issue.code))
  if (errors.length) return { code: 1, top, errors, loud }
  const built = build(ws, { force, prepared })
  if (built.errors.length || built.blocked.length) return { code: built.errors.length ? 1 : 2, top, errors, loud, built }
  const state = commitGraph(ws, message, { includeReview: true,
    only: only && [...mine, ...built.written.filter((file) => mine.has(file.normalize("NFC")) || !before.has(file.normalize("NFC")))] })
  return { code: 0, top, errors, loud, built, state }
}
