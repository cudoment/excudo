// Internal subprocess runner for skill lint. The public lint API stays synchronous; one helper
// runs a bounded number of checks asynchronously and returns only their judgments, in input order.
import { spawn } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { availableParallelism } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const CASE_MAX_BUFFER = 8 * 1024 * 1024

export function caseJobs() {
  const requested = Number(process.env.EXCUDO_CASE_JOBS)
  return Number.isSafeInteger(requested) && requested > 0 ? requested : Math.min(8, availableParallelism())
}

// Shared by the synchronous fallback and the helper, so exit codes and environment errors keep
// exactly the same meaning whichever path ran a check.
export function caseResult(result) {
  if (result.error?.code === "ETIMEDOUT") return "timeout"
  if (result.status !== 0) {
    const cause = `${result.error?.code ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .match(/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|proxyconnect|i\/o timeout|could not connect|Could not resolve host|API Error:\s*401|Failed to authenticate|access token has expired/i)?.[0]
    if (cause) return `infrastructure: ${cause}`
  }
  return result.status === 0 ? "pass" : result.status === 1 ? "fail" : `exit ${result.status ?? result.error?.code ?? result.signal}`
}

const running = new Set()

function run(task) {
  return new Promise((done) => {
    const { command, args, options } = task
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] })
    running.add(child)
    let error, bytes = 0
    const stdout = [], stderr = []
    const stop = (code) => {
      error ??= { code }
      // A timed-out check must end even when it handles or ignores SIGTERM.
      child.kill("SIGKILL")
    }
    const timer = options.timeout > 0 ? setTimeout(() => stop("ETIMEDOUT"), options.timeout) : null
    const collect = (chunks) => (chunk) => {
      if (error) return
      chunks.push(chunk)
      bytes += chunk.length
      if (bytes > options.maxBuffer) stop("ENOBUFS")
    }
    child.stdout.on("data", collect(stdout))
    child.stderr.on("data", collect(stderr))
    child.on("error", (cause) => { error ??= { code: cause.code } })
    child.on("close", (status, signal) => {
      clearTimeout(timer)
      running.delete(child)
      done({ status: status < 0 ? null : status, signal, error, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
    })
  })
}

async function main() {
  const { tasks, jobs } = JSON.parse(readFileSync(0, "utf8"))
  const results = new Array(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = caseResult(await run(tasks[i]))
    }
  }))
  process.stdout.write(JSON.stringify(results))
}

function directlyInvoked() {
  if (!process.argv[1]) return false
  const entry = resolve(process.argv[1]), own = fileURLToPath(import.meta.url)
  try { return realpathSync(entry) === realpathSync(own) }
  catch { return entry === own }
}

if (directlyInvoked()) {
  const stop = () => {
    for (const child of running) child.kill("SIGKILL")
    process.exit(1)
  }
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  main().catch(stop)
}
