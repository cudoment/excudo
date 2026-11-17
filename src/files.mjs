// File helpers shared by every command that writes into a graph or a workspace.
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"

/** The on-disk spelling of `path`, matching each segment in either Unicode form. */
export function existingPath(path) {
  // macOS finds a file under either Unicode form, so only an ASCII path that exists is surely spelled as on disk.
  if (/^[\x00-\x7f]*$/.test(path) && existsSync(path)) return path
  const parent = dirname(path)
  if (parent === path) return path
  const actualParent = existingPath(parent)
  const name = basename(path)
  if (!existsSync(actualParent)) return join(actualParent, name)
  const match = readdirSync(actualParent).find((entry) => entry.normalize("NFC") === name.normalize("NFC"))
  return join(actualParent, match ?? name)
}

/** Every file below `dir`, relative to `base`. */
export function filesOf(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return statSync(path).isDirectory() ? filesOf(path, base) : [relative(base, path)]
  })
}

/** The temporary file `writeAtomic` writes before it replaces `path`. */
export const temporaryOf = (path) => join(dirname(path), `.${basename(path)}.${process.pid}.excudo.tmp`)

/** Replaces a file through a temporary file in its own folder, so the rename never crosses devices. */
export function writeAtomic(path, text) {
  const tmp = temporaryOf(path)
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

/** Whether a process with this id runs (one that exists but belongs to someone else counts). */
function running(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === "EPERM" }
}

/**
 * Removes `lock` only if it still holds `seen`. The file is first moved aside, which only one process
 * can do; a lock that turns out to be someone else's by then is put back, unless another has already
 * taken the place. Returns whether `seen` was removed.
 */
export function reclaimLock(lock, seen) {
  const aside = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}.old`
  try { renameSync(lock, aside) } catch { return false }
  let content
  try { content = readFileSync(aside, "utf8") } catch {}
  if (content !== seen) try { linkSync(aside, lock) } catch {}
  rmSync(aside, { force: true })
  return content === seen
}

/** Takes `<path>.lock` (see withLock), or throws `message` after `wait`. Returns what releases it. */
function acquire(path, message, { wait = 10000, stale = 120000 } = {}) {
  const lock = `${path}.lock`
  const token = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}`
  mkdirSync(dirname(lock), { recursive: true })
  const start = Date.now()
  for (;;) {
    try { writeFileSync(lock, token, { flag: "wx" }); break } catch (error) {
      if (error.code !== "EEXIST") throw error
      try {
        const holder = readFileSync(lock, "utf8")
        const pid = Number(holder.split(" ")[0])
        // A lock without a process id comes from an earlier version: only its age tells.
        const gone = holder ? !running(pid) : false
        if (gone || Date.now() - statSync(lock).mtimeMs > stale) {
          reclaimLock(lock, holder)
          continue
        }
      } catch {}
      if (Date.now() - start > wait) throw new Error(message)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
  return () => reclaimLock(lock, token)
}

/**
 * Runs `fn` while holding `<path>.lock`, so two commands updating one state file (a scheduled
 * reflection and a tidy-up, say) do not overwrite each other. The lock names the process holding it:
 * it is taken over at once when that process is gone, and otherwise only once it is older than
 * `stale` (a process that hangs, or a reused process id). After `wait` without the lock, `message`
 * is thrown. Only the lock this call took is released.
 */
export function withLock(path, fn, message, options) {
  const release = acquire(path, message, options)
  try { return fn() } finally { release() }
}

/** withLock for work that waits: the lock is held until what `fn` returns has settled. */
export async function withLockAsync(path, fn, message, options) {
  const release = acquire(path, message, options)
  try { return await fn() } finally { release() }
}

/** Whether a running process holds `<path>.lock`. */
export function lockHeld(path) {
  try {
    const holder = readFileSync(`${path}.lock`, "utf8")
    return Boolean(holder) && running(Number(holder.split(" ")[0]))
  } catch { return false }
}
