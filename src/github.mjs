// The GitHub command-line tool (gh), which the website's inbox needs on the owner's computer: `site
// setup` makes the inbox's private repository with it and `site pull` reads and closes its issues.
// The tool keeps its own login, as the Vercel CLI does; nothing here enters or stores a credential.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

/** A host query's deadline, or a deployment's, in milliseconds; invalid overrides use the default. */
export function hostTimeout(deploy = false) {
  const seconds = Number(process.env[deploy ? "EXCUDO_DEPLOY_TIMEOUT" : "EXCUDO_HOST_TIMEOUT"])
  return seconds > 0 && seconds < 2_147_480 && Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : (deploy ? 600_000 : 60_000)
}

/** A failed host call lost its connection or its deadline, rather than an account or permission. */
export function isNetworkFailure(result) {
  if (!result || result.status === 0) return false
  return result.error?.code === "ETIMEDOUT" || (result.status === null && Boolean(result.signal)) ||
    /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|proxyconnect|i\/o timeout|dial tcp|error connecting to|could not resolve host|socket hang up|AggregateError/i.test(`${result.stderr ?? ""}\n${result.stdout ?? ""}`)
}

// The parent stays synchronous, but this supervisor can kill the command's entire process group
// while it runs. Killing only spawnSync's direct child leaves native children and their pipes alive.
const SUPERVISOR = `
import { spawn, spawnSync } from "node:child_process"
import { writeSync } from "node:fs"
const [deadline, shell, command, ...args] = process.argv.slice(1)
const grouped = process.platform !== "win32"
const child = spawn(command, args, { stdio: "inherit", detached: grouped, shell: shell === "true" })
let error, timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  if (grouped) { try { process.kill(-child.pid, "SIGKILL") } catch {} }
  else {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 1000, killSignal: "SIGKILL" })
    child.kill("SIGKILL")
  }
}, Number(deadline))
child.on("error", (value) => { error = { code: value.code, message: value.message } })
child.on("close", (status, signal) => {
  clearTimeout(timer)
  writeSync(3, JSON.stringify({ pid: child.pid, status, signal, error, timedOut }))
})
`

/** A bounded synchronous host call; its deadline also kills descendants, including native ones. */
export function hostRun(command, args, { timeout = hostTimeout(), shell = false, ...options } = {}) {
  const ignored = options.stdio === "ignore"
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", SUPERVISOR, String(timeout), String(shell), command, ...args], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options,
    stdio: ["pipe", ignored ? "ignore" : "pipe", ignored ? "ignore" : "pipe", "pipe"], timeout: timeout + 2000, killSignal: "SIGKILL",
  })
  let ended
  try { ended = JSON.parse(result.output?.[3]) } catch {}
  if (!ended) return result
  const error = ended.timedOut ? Object.assign(new Error(`Host call timed out after ${timeout} ms`), { code: "ETIMEDOUT" })
    : ended.error ? Object.assign(new Error(ended.error.message), { code: ended.error.code }) : result.error
  return { ...result, pid: ended.pid, status: ended.timedOut ? null : ended.status, signal: ended.signal, error }
}

/** gh: EXCUDO_GH, one on the PATH, or where Homebrew puts it (a schedule's PATH is short); null when none. */
export function ghOf() {
  if (process.env.EXCUDO_GH) return existsSync(process.env.EXCUDO_GH) ? process.env.EXCUDO_GH : null
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["gh"], { encoding: "utf8" })
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0]
  return ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"].find((path) => existsSync(path)) ?? null
}

/** Runs gh without prompts or colours; `note` gets what a failed call said. */
export function ghRun(gh, args, { input, note = () => {}, timeout = hostTimeout() } = {}) {
  const result = hostRun(gh, args, { input, timeout, env: { ...process.env, NO_COLOR: "1", GH_PROMPT_DISABLED: "1" } })
  if (result.status !== 0) note(`gh ${args.join(" ")} (exit ${result.status})\n${result.stderr ?? ""}${result.stdout ?? ""}${result.error ?? ""}`)
  return result
}

/** The account gh is logged in to, or null. */
export function ghUser(gh, options) {
  if (!gh) return null
  const result = ghRun(gh, ["api", "user", "--jq", ".login"], options)
  return result.status === 0 ? result.stdout.trim() || null : null
}
