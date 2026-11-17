// The memo's website on a host, under the owner's own login, and opened from there: `excudo site
// setup | publish | open | status`. The host is Vercel, reached through its command-line tool: a free
// personal account serves a static folder, and its Vercel Authentication can guard every deployment,
// the production address too, so only the owner's Vercel login opens the memo.
//
// `setup` takes a new owner from nothing to an open website once: it installs what is missing (the
// exporter, the Vercel CLI), writes the website, logs in (the CLI's device flow: the owner approves
// in a browser page this opens), creates and links a project, turns on the protection and publishes.
// `publish` is what a schedule runs: it writes the website and hands it to the host only when the
// host is ready (logged in, linked, every deployment protected) and something changed; otherwise it
// says what is missing and exits 75, so a scheduler tries again later. `open` opens the published
// address, copies it and prints a code a phone can scan. Nothing here enters or stores a credential:
// the CLI keeps its own login.
//
// With an inbox (`site.inbox`), setup goes on: it makes the inbox's private GitHub repository with the
// GitHub CLI, opens the two pages where the owner makes the inbox's token and keeps it on Vercel (the
// token page comes filled in; the engine only waits until the variable's name shows, and never sees
// its value), publishes, and schedules `site pull` on this computer. A token added or changed later
// is noticed by the next publishing, which deploys again so the inbox function has it.
//
// The folder handed to the host holds only the website (`site/`), its settings (`vercel.json`) and
// the CLI's link (`.vercel/`). The CLI would also send the last commit's message and author when the
// folder lies in a git repository; the engine keeps git from finding one above that folder.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { writeAtomic } from "./files.mjs"
import { ghOf, ghRun, ghUser, hostRun, hostTimeout, isNetworkFailure } from "./github.mjs"
import { format } from "./labels.mjs"
import { installPullSchedule, pullCommand, pullScheduleState } from "./schedule.mjs"
import { hasExporter, PACKAGE_ROOT, siteHome, siteOf, siteState, writeSite } from "./site.mjs"
import { siteIdOf } from "./site-runtime.mjs"
import { localPath } from "./sources.mjs"

export const PUBLISH_KEYS = ["host", "project", "dir", "open", "close", "copy"]
const KEYS = PUBLISH_KEYS
const HOSTS = ["vercel"]
const STATE_FILE = "publish.json"
const LOG_FILE = "publish.log"
const LOGIN_MINUTES = 10
/** How long setup waits for the owner to keep the inbox's token on Vercel. */
const TOKEN_MINUTES = 15
const POLL_MS = () => Number(process.env.EXCUDO_POLL_MS ?? 5000)
/** The environment variable that holds the inbox's token on Vercel, read by the inbox functions. */
export const INBOX_TOKEN = "EXCUDO_INBOX_TOKEN"
/** The exit code of a run that waits on the owner (a login, a link, the protection): try again later. */
export const DEFERRED = 75
/** What the host may receive: the website and its settings. Everything else in the folder stays home. */
const VERCEL_IGNORE = "# Written by excudo site: only the website, its inbox function and its settings are sent.\n/*\n!/site\n!/api\n!/vercel.json\n"
/** The inbox functions and the modules they share, copied into the folder's api/ when the website has an inbox. */
const INBOX_FILES = { "edit.mjs": new URL("../assets/vercel/edit.mjs", import.meta.url), "sync.mjs": new URL("../assets/vercel/sync.mjs", import.meta.url),
  "_github.mjs": new URL("../assets/vercel/_github.mjs", import.meta.url), "_edits.mjs": new URL("./edits.mjs", import.meta.url) }
const VERCEL_JSON = `${JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", framework: null, buildCommand: null, installCommand: null, outputDirectory: "site" }, null, 2)}\n`
const DASHBOARD = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fsettings%2Fdeployment-protection&title=Deployment+Protection"
const ENV_DASHBOARD = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fsettings%2Fenvironment-variables&title=Environment+Variables"
const inside = (path, dir) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
const json = (text) => { try { return JSON.parse(text) } catch { return undefined } }
/** A Vercel project name from a folder name: lower case letters, digits and dashes. */
const slug = (name) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 90)

/**
 * The publishing settings (`site.publish`), checked: `{ host, project, dir, path, open, close, copy,
 * sitePath }`. Every key is optional; a workspace without the setting publishes with the defaults.
 */
export function publishOf(ws, site = siteOf(ws, { defaults: true })) {
  const m = ws.labels.messages
  const bad = (field) => { throw new Error(format(m["site-invalid"], { field: `publish${field ? `.${field}` : ""}` })) }
  const given = site.publish ?? {}
  if (!given || typeof given !== "object" || Array.isArray(given)) bad()
  for (const key of Object.keys(given)) if (!KEYS.includes(key)) bad(key)
  const settings = {
    host: given.host ?? "vercel", project: given.project ?? `${slug(basename(ws.root)) || "excudo"}-memo`,
    dir: given.dir ?? join(ws.cache, "publish"), open: given.open, close: given.close, copy: given.copy ?? true, sitePath: site.path,
    // The inbox's repository is the setting's, or the one setup made and kept in the publishing state.
    inbox: site.inbox ? { repo: site.inbox.repo ?? readState(ws).inbox?.repo ?? null, site: siteIdOf(ws, site), schedule: site.inbox.schedule } : null,
  }
  if (!HOSTS.includes(settings.host)) bad("host")
  if (typeof settings.project !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(settings.project) || settings.project.includes("---")) bad("project")
  if (typeof settings.dir !== "string" || !settings.dir.trim()) bad("dir")
  settings.path = localPath(ws, settings.dir)
  // Everything in the folder goes to the host, so it holds the website and nothing of the memo's own.
  if (inside(settings.path, ws.graphDir) || inside(ws.graphDir, settings.path) || inside(ws.root, settings.path) || inside(ws.cacheDir, settings.path)) bad("dir")
  const staged = join(settings.path, "site")
  if ((inside(site.path, settings.path) && resolve(site.path) !== resolve(staged)) || inside(settings.path, site.path)) bad("dir")
  for (const key of ["open", "close"]) {
    const command = settings[key]
    if (command !== undefined && (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== "string" || !part.trim()))) bad(key)
  }
  if (typeof settings.copy !== "boolean") bad("copy")
  return settings
}

/** The Vercel CLI: EXCUDO_VERCEL, the workspace's, the engine's, or one on the PATH; null when none. */
function cliOf(ws) {
  if (process.env.EXCUDO_VERCEL) return existsSync(process.env.EXCUDO_VERCEL) ? process.env.EXCUDO_VERCEL : null
  for (const path of [join(ws.root, "node_modules/.bin/vercel"), join(PACKAGE_ROOT, "node_modules/.bin/vercel")]) if (existsSync(path)) return path
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["vercel"], { encoding: "utf8" })
  return found.status === 0 ? found.stdout.trim().split(/\r?\n/)[0] || null : null
}

/** What the commands share: the CLI, a log, and the way the CLI is run in the publishing folder. */
function hostOf(ws, settings, { networkThrows = false, timeout: queryTimeout } = {}) {
  const log = join(ws.cacheDir, LOG_FILE)
  const env = { ...process.env, NO_COLOR: "1", GIT_CEILING_DIRECTORIES: dirname(settings.path) }
  const note = (text) => {
    if (!text?.trim()) return
    mkdirSync(ws.cacheDir, { recursive: true })
    appendFileSync(log, `${new Date().toISOString()}  ${text.trim()}\n`)
  }
  const cli = cliOf(ws)
  let last
  const run = (args, { input, timeout = queryTimeout ?? hostTimeout(args[0] === "deploy") } = {}) => {
    const result = hostRun(cli, args, { cwd: settings.path, input, env, timeout })
    last = result
    if (result.status !== 0) note(`vercel ${args.join(" ")} (exit ${result.status})\n${result.stderr ?? ""}${result.stdout ?? ""}${result.error ?? ""}`)
    if (networkThrows && isNetworkFailure(result)) {
      const step = args[0] === "api" ? args[1].includes("/env") ? "token" : args[1].includes("/domains") ? "url" : "api" : args.slice(0, 2).join(" ")
      throw Object.assign(new Error(`Vercel unreachable (${step})`), { networkFailure: true, step })
    }
    return result
  }
  return { cli, log, env, note, run, get last() { return last }, rel: (path) => relative(process.cwd(), path) || path }
}

/**
 * The publishing folder: the host's settings, the inbox function when the website has an inbox (api/,
 * with the repository it writes to and the website's id), and, unless the website is written there,
 * a copy of it.
 */
function stage(settings) {
  mkdirSync(settings.path, { recursive: true })
  writeFileSync(join(settings.path, "vercel.json"), VERCEL_JSON)
  writeFileSync(join(settings.path, ".vercelignore"), VERCEL_IGNORE)
  const api = join(settings.path, "api")
  rmSync(api, { recursive: true, force: true })
  if (settings.inbox?.repo) {
    mkdirSync(api, { recursive: true })
    for (const [name, source] of Object.entries(INBOX_FILES)) cpSync(fileURLToPath(source), join(api, name))
    const inbox = { repo: settings.inbox.repo, site: settings.inbox.site }
    writeFileSync(join(api, "_inbox.mjs"), `// Written by excudo site publish: where the inbox keeps changes, and the website they come from.\nexport default ${JSON.stringify(inbox)}\n`)
  }
  const target = join(settings.path, "site")
  if (resolve(settings.sitePath) === resolve(target)) return
  rmSync(target, { recursive: true, force: true })
  cpSync(settings.sitePath, target, { recursive: true })
}

const whoami = (host) => {
  if (!host.cli) return null
  const result = host.run(["whoami"])
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? null : null
}
const linked = (settings) => json(existsSync(join(settings.path, ".vercel/project.json")) ? readFileSync(join(settings.path, ".vercel/project.json"), "utf8") : "") ?? null
const scope = (project) => project.orgId?.startsWith("team_") ? `?teamId=${encodeURIComponent(project.orgId)}` : ""
/** Which deployments Vercel Authentication guards: `all`, a narrower scope, `none`, or `unknown`. */
function protection(host) {
  const result = host.run(["project", "protection", "--json"])
  const reply = result.status === 0 ? json(result.stdout) : undefined
  return reply ? String(reply.ssoProtection?.deploymentType ?? "none") : "unknown"
}
/** The project's own production address: a domain of its own first, then its shortest vercel.app name. */
function productionUrl(host, project) {
  const result = host.run(["api", `/v9/projects/${encodeURIComponent(project.projectId)}/domains${scope(project)}`, "--raw"])
  const domains = (json(result.stdout)?.domains ?? []).filter((domain) => domain.name && !domain.redirect && !domain.gitBranch)
  domains.sort((a, b) => Number(a.name.endsWith(".vercel.app")) - Number(b.name.endsWith(".vercel.app")) || a.name.length - b.name.length)
  return domains[0] ? `https://${domains[0].name}` : null
}
/** What a deployment is made of: its project, the host settings and every file of the website. */
function fingerprint(settings, project) {
  const hash = createHash("sha256")
  hash.update(`${project.orgId ?? ""}\0${project.projectId ?? ""}\0${VERCEL_JSON}\0${VERCEL_IGNORE}\0`)
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else { hash.update(relative(settings.path, path)); hash.update("\0"); hash.update(readFileSync(path)) }
    }
  }
  for (const part of ["site", "api"]) if (existsSync(join(settings.path, part))) walk(join(settings.path, part))
  return hash.digest("hex")
}

function readState(ws) { return json(existsSync(join(ws.cacheDir, STATE_FILE)) ? readFileSync(join(ws.cacheDir, STATE_FILE), "utf8") : "") ?? {} }
/** What the last publishing left: `{ host, project, projectId, url, deployment, hash, at, inbox: { repo, tokenAt } }`. */
export const publishState = (ws) => readState(ws)
const keepState = (ws, change) => {
  mkdirSync(ws.cacheDir, { recursive: true })
  writeAtomic(join(ws.cacheDir, STATE_FILE), `${JSON.stringify({ ...readState(ws), ...change }, null, 2)}\n`)
}

/**
 * When the inbox's token was last set on Vercel for production, or null when it is not there. Only
 * the variable's name and times are read; the value stays on Vercel.
 */
function inboxToken(host, project) {
  if (!project) return null
  const result = host.run(["api", `/v9/projects/${encodeURIComponent(project.projectId)}/env${scope(project)}`, "--raw"])
  const found = (json(result.stdout)?.envs ?? []).find((env) => env.key === INBOX_TOKEN && [].concat(env.target ?? []).includes("production"))
  return found ? Number(found.updatedAt ?? found.createdAt ?? 1) : null
}
/** The project's environment variables page: its own address, or the dashboard's way to it. */
function envPage(host, project, settings) {
  const team = project.orgId?.startsWith("team_") ? json(host.run(["api", `/v2/teams/${encodeURIComponent(project.orgId)}`, "--raw"]).stdout)?.slug
    : json(host.run(["api", "/v2/user", "--raw"]).stdout)?.user?.username
  return team ? `https://vercel.com/${encodeURIComponent(team)}/${encodeURIComponent(project.projectName ?? settings.project)}/settings/environment-variables` : ENV_DASHBOARD
}
/** The GitHub page that makes the inbox's token, filled in but for the repository, which the owner picks. */
export function tokenPage(settings, repo, description) {
  const [owner] = repo.split("/")
  const query = new URLSearchParams({ name: `${settings.project} inbox`.slice(0, 40), description, target_name: owner, expires_in: "366", issues: "write" })
  return `https://github.com/settings/personal-access-tokens/new?${query}`
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Opens a link: with the `open` setting, that command gets the link as its last argument and
 * `EXCUDO_LINK` (login, site or dashboard) in its environment, and the first line it prints is kept to
 * close a login page again; without it, the system's own opener.
 */
function openLink(ws, settings, url, purpose) {
  if (settings.open) {
    const [command, ...rest] = settings.open
    const result = spawnSync(command, [...rest, url], { cwd: ws.root, encoding: "utf8", env: { ...process.env, EXCUDO_LINK: purpose } })
    return result.status === 0 ? { opened: true, handle: result.stdout.trim().split(/\r?\n/)[0] || undefined } : { opened: false }
  }
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]]
  try { const child = spawn(command, args, { stdio: "ignore", detached: true }); child.on("error", () => {}); child.unref(); return { opened: true } } catch { return { opened: false } }
}
function closeLink(ws, settings, link) {
  if (!settings.close || !link?.handle) return
  spawnSync(settings.close[0], [...settings.close.slice(1), link.handle], { cwd: ws.root, stdio: "ignore", env: { ...process.env, EXCUDO_LINK: "login" } })
}
function copy(settings, text) {
  if (!settings.copy) return false
  const command = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : null
  return Boolean(command) && spawnSync(command, { input: text, shell: process.platform === "win32" }).status === 0
}
/** A code a phone camera reads, drawn with block characters; empty when the drawing library is absent. */
export function scanCode(text) {
  let drawn = ""
  try { createRequire(import.meta.url)("qrcode-terminal").generate(text, { small: true }, (code) => { drawn = code }) } catch {}
  return drawn
}

function install(ws, host, say, spec) {
  const m = ws.labels.messages
  say(format(m["publish-installing"], { package: spec }))
  const result = hostRun("npm", ["install", "--save-dev", spec], { cwd: ws.root, env: { ...process.env, CUDOC_SKIP_BROWSER_DOWNLOAD: "1" }, shell: process.platform === "win32", timeout: 600_000 })
  if (result.status !== 0) host.note(`npm install --save-dev ${spec} (exit ${result.status})\n${result.stderr ?? ""}${result.stdout ?? ""}`)
  return result.status === 0
}

/**
 * Writes the website and hands it to the host when the host is ready and something changed.
 * Returns `{ code, published, url, reason }`: code 0 when published or unchanged, 75 when the owner
 * has something to do first (`reason` says what), 1 when the host refused it.
 */
export function publishSite(ws, { force = false, say = () => {} } = {}) {
  const m = ws.labels.messages
  const site = siteOf(ws, { defaults: true })
  const settings = publishOf(ws, site)
  const host = hostOf(ws, settings, { networkThrows: true })
  const wait = (reason, values = {}) => { say(format(m[`publish-${reason}`], { log: host.rel(host.log), ...values })); return { code: DEFERRED, published: false, reason } }
  try {
    // What setup installs is a wait for the owner, not a failure: a schedule tries again after setup.
    if (!hasExporter(ws)) return wait("no-exporter")
    writeSite(ws)
    stage(settings)
    const project = linked(settings)
    const before = readState(ws)
    const state = before.projectId === project?.projectId ? before : {}
    const hash = project ? fingerprint(settings, project) : null
    const protectedAt = Date.parse(state.protectionAt)
    const protectionAge = Date.now() - protectedAt
    const protectionFresh = (state.protectionProjectId ?? state.projectId) === project?.projectId && protectionAge >= 0 && protectionAge < 24 * 60 * 60_000
    const unchanged = () => { say(format(m["publish-unchanged"], { url: state.url })); return { code: 0, published: false, url: state.url } }
    if (!force && hash && state.hash === hash && state.url && protectionFresh) return unchanged()
    if (!host.cli) return wait("no-cli")
    if (!whoami(host)) return wait(/not logged in|no existing credentials|authentication required|login required/i.test(`${host.last?.stderr ?? ""}${host.last?.stdout ?? ""}`) ? "not-logged-in" : "login-failed", { minutes: LOGIN_MINUTES })
    if (!project) return wait("not-linked")
    const mode = protection(host)
    if (mode === "unknown") return wait("protection-unknown")
    if (mode !== "all") return wait("unprotected", { mode })
    const protectionAt = new Date().toISOString()
    keepState(ws, { protectionAt, protectionProjectId: project.projectId })
    if (settings.inbox && !settings.inbox.repo) return wait("inbox-not-set-up")
    // A token set or changed on Vercel reaches the inbox function only with a new deployment.
    const tokenAt = settings.inbox ? inboxToken(host, project) : null
    const fresh = Boolean(tokenAt && tokenAt > (state.inbox?.tokenAt ?? 0))
    if (!force && !fresh && state.hash === hash && state.url) return unchanged()
    // Resolve the address before deploying, so a failed query never hides a successful deployment.
    const production = productionUrl(host, project)
    const result = host.run(["deploy", "--prod", "--yes"])
    if (result.status !== 0) { say(format(m["publish-failed"], { code: result.status, log: host.rel(host.log) })); return { code: 1, published: false, reason: "failed" } }
    // The CLI prints the deployment's own address and may print the production one too.
    const printed = `${result.stdout}`.match(/https:\/\/[^\s"'<>]+/g) ?? []
    const url = production ?? state.url ?? printed.at(-1) ?? null
    const deployment = printed.find((address) => address !== url) ?? printed.at(-1) ?? null
    const inbox = settings.inbox ? { repo: settings.inbox.repo, tokenAt: tokenAt ?? null } : before.inbox
    keepState(ws, { host: settings.host, project: project.projectName ?? settings.project, projectId: project.projectId, url, deployment, hash, at: new Date().toISOString(), inbox, protectionAt, protectionProjectId: project.projectId })
    say(format(m["publish-done"], { url }))
    return { code: 0, published: true, url }
  } catch (error) {
    if (!error.networkFailure) throw error
    return wait("network", { step: error.step })
  }
}

/** The CLI's device login: the approval page opens in a browser, and the run waits for the owner. */
async function login(ws, settings, host, say) {
  const m = ws.labels.messages
  say(format(m["publish-login"], { minutes: LOGIN_MINUTES }))
  // CI keeps the CLI from opening a browser itself, so the page opens the way the owner set.
  const child = spawn(host.cli, ["login"], { cwd: settings.path, env: { ...host.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] })
  let text = "", link = null
  const read = (chunk) => {
    text += chunk
    const url = text.match(/https:\/\/vercel\.com\/oauth\/device\?[^\s\x07\x1b"'<>]+/)?.[0]
    if (!url || link) return
    link = openLink(ws, settings, url, "login")
    say(format(m["publish-login-link"], { url }))
  }
  child.stdout.on("data", read)
  child.stderr.on("data", read)
  const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_MINUTES * 60_000)
  const code = await new Promise((done) => { child.on("close", done); child.on("error", () => done(1)) })
  clearTimeout(timer)
  closeLink(ws, settings, link)
  host.note(`vercel login (exit ${code})\n${text.replace(/user_code=[\w-]+/g, "user_code=…")}`)
  return code === 0 ? whoami(host) : null
}

/**
 * The GitHub CLI's device login, like the Vercel one: the code is copied and its page opens, and the
 * run waits for the owner. Null when the CLI would not log in this way; setup then says the command.
 */
async function ghLogin(ws, settings, gh, say) {
  const m = ws.labels.messages
  // The CLI opens no browser itself (the page opens the way the owner set) and is told Enter at once.
  const child = spawn(gh, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], {
    env: { ...process.env, NO_COLOR: "1", GH_BROWSER: process.platform === "win32" ? "rem" : "true", BROWSER: process.platform === "win32" ? "rem" : "true" }, stdio: ["pipe", "pipe", "pipe"] })
  let text = "", link = null
  const read = (chunk) => {
    text += chunk
    const code = text.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1]
    if (!code || link) return
    copy(settings, code)
    link = openLink(ws, settings, "https://github.com/login/device", "login")
    say(format(m["inbox-gh-code"], { code }))
    child.stdin.write("\n")
  }
  child.stdout.on("data", read)
  child.stderr.on("data", read)
  child.stdin.on("error", () => {})
  const timer = setTimeout(() => child.kill("SIGTERM"), LOGIN_MINUTES * 60_000)
  await new Promise((done) => { child.on("close", done); child.on("error", () => done(1)) })
  clearTimeout(timer)
  closeLink(ws, settings, link)
  return ghUser(gh)
}

/**
 * The inbox's private repository: the setting's, or `<account>/<project>-inbox`, made when missing.
 * Returns the repository, or `{ code }` when the owner has something to do first.
 */
async function inboxRepository(ws, settings, host, say) {
  const m = ws.labels.messages
  const note = (text) => host.note(text)
  let gh = ghOf()
  // Homebrew installs it on macOS; a gh named by EXCUDO_GH (a test's stand-in) is never replaced.
  if (!gh && !process.env.EXCUDO_GH && process.platform === "darwin" && spawnSync("which", ["brew"]).status === 0) {
    say(format(m["publish-installing"], { package: "gh" }))
    hostRun("brew", ["install", "gh"], { stdio: "ignore", timeout: 600_000 })
    gh = ghOf()
  }
  if (!gh) { say(m["inbox-no-gh"]); return { code: DEFERRED } }
  const user = ghUser(gh, { note }) ?? await ghLogin(ws, settings, gh, say)
  if (!user) { say(m["inbox-gh-login"]); return { code: DEFERRED } }
  const repo = settings.inbox.repo ?? `${user}/${settings.project}-inbox`
  const seen = ghRun(gh, ["repo", "view", repo, "--json", "visibility,hasIssuesEnabled"], { note })
  if (seen.status === 0) {
    const info = json(seen.stdout) ?? {}
    // The issues hold where the memo's tasks are; others must not read them.
    if (info.visibility && info.visibility !== "PRIVATE") { say(format(m["inbox-not-private"], { repo })); return { code: 1 } }
    if (info.hasIssuesEnabled === false) ghRun(gh, ["repo", "edit", repo, "--enable-issues"], { note })
  } else {
    const made = ghRun(gh, ["repo", "create", repo, "--private", "--description", m["inbox-repo-description"]], { note })
    if (made.status !== 0) { say(format(m["inbox-repo-failed"], { repo, log: host.rel(host.log) })); return { code: 1 } }
    say(format(m["inbox-repo-made"], { repo }))
  }
  keepState(ws, { inbox: { ...(readState(ws).inbox ?? {}), repo } })
  return { repo, gh }
}

/**
 * From nothing to an open website: what is missing is installed, the owner logs in, a project is
 * created and linked, Vercel Authentication is set to guard every deployment, and the website is
 * published and opened. With an inbox, its repository is made, the owner keeps its token on Vercel
 * and `site pull` is scheduled. A step already done is passed over, so running it again picks up
 * where it stopped. Returns `{ code }` like `publishSite`.
 */
export async function setupSite(ws, { project, say = () => {} } = {}) {
  const m = ws.labels.messages
  const steps = ws.labels.publish.steps
  const site = siteOf(ws, { defaults: true })
  const settings = publishOf(ws, project ? { ...site, publish: { ...site.publish, project } } : site)
  const total = settings.inbox ? 8 : 5
  let n = 0
  const step = (name) => say(`\n[${++n}/${total}] ${steps[name]}`)
  let host = hostOf(ws, settings)

  step("site")
  if (!hasExporter(ws) && !install(ws, host, say, "cudoc-export@^1.0.0")) { say(format(m["publish-install-failed"], { package: "cudoc-export", log: host.rel(host.log) })); return { code: 1 } }
  writeSite(ws)
  stage(settings)
  if (!host.cli) {
    if (!install(ws, host, say, "vercel")) { say(format(m["publish-install-failed"], { package: "vercel", log: host.rel(host.log) })); return { code: 1 } }
    host = hostOf(ws, settings)
    if (!host.cli) return { code: 1 }
  }

  step("login")
  let user = whoami(host)
  if (!user && isNetworkFailure(host.last)) {
    say(format(m["publish-network"], { step: "whoami" }))
    return { code: DEFERRED, reason: "network" }
  }
  user ??= await login(ws, settings, host, say)
  if (!user) { say(format(m["publish-login-failed"], { minutes: LOGIN_MINUTES, log: host.rel(host.log) })); return { code: DEFERRED } }
  say(format(m["publish-logged-in"], { user }))

  step("project")
  let linkedProject = linked(settings)
  if (!linkedProject) {
    // Creating fails when the name is taken in the account; linking then picks up that project.
    host.run(["project", "create", settings.project])
    host.run(["link", "--yes", "--project", settings.project])
    linkedProject = linked(settings)
    if (!linkedProject) { say(format(m["publish-link-failed"], { project: settings.project, log: host.rel(host.log) })); return { code: 1 } }
  }
  say(format(m["publish-linked"], { project: linkedProject.projectName ?? settings.project }))

  step("protect")
  if (protection(host) !== "all") {
    host.run(["api", `/v9/projects/${encodeURIComponent(linkedProject.projectId)}${scope(linkedProject)}`, "-X", "PATCH", "--input", "-", "--silent"],
      { input: JSON.stringify({ ssoProtection: { deploymentType: "all" } }) })
    if (protection(host) !== "all") {
      openLink(ws, settings, DASHBOARD, "dashboard")
      say(m["publish-protect-failed"])
      return { code: DEFERRED }
    }
  }
  say(m["publish-protected"])

  let gh = null
  if (settings.inbox) {
    step("inbox")
    const made = await inboxRepository(ws, settings, host, say)
    if (!made.repo) return made
    settings.inbox.repo = made.repo
    gh = made.gh
    say(format(m["inbox-repo-ready"], { repo: made.repo }))

    step("token")
    if (!inboxToken(host, linkedProject)) {
      // Two pages: GitHub's, filled in but for the repository; Vercel's, where the token is kept.
      say(format(m["inbox-token-steps"], { repo: made.repo, key: INBOX_TOKEN, minutes: TOKEN_MINUTES }))
      openLink(ws, settings, tokenPage(settings, made.repo, format(m["inbox-token-description"], { repo: made.repo })), "token")
      openLink(ws, settings, envPage(host, linkedProject, settings), "dashboard")
      const until = Date.now() + TOKEN_MINUTES * 60_000
      while (!inboxToken(host, linkedProject) && Date.now() < until) await pause(POLL_MS())
      if (!inboxToken(host, linkedProject)) { say(format(m["inbox-token-missing"], { key: INBOX_TOKEN, minutes: TOKEN_MINUTES })); return { code: DEFERRED } }
    }
    say(format(m["inbox-token-ready"], { key: INBOX_TOKEN }))
  }

  step("publish")
  const published = publishSite(ws, { force: !readState(ws).url, say })
  if (published.code !== 0) return published

  if (settings.inbox) {
    step("pull")
    if (!settings.inbox.schedule) say(format(m["inbox-pull-own"], { command: "excudo site pull" }))
    else {
      const scheduled = installPullSchedule(ws, { siteId: settings.inbox.site, gh })
      if (scheduled.state === "installed") say(format(m["inbox-pull-scheduled"], { label: scheduled.label }))
      else if (scheduled.state === "unsupported") say(format(m["inbox-pull-command"], { command: scheduled.command }))
      else { say(format(m["inbox-pull-failed"], { error: scheduled.error ?? "", command: pullCommand(ws) })); return { code: 1 } }
    }
  }
  return openSite(ws, { say })
}

/**
 * Opens the published website, copies its address and prints a code a phone can scan; before
 * anything is published, opens the website written on this computer.
 */
export function openSite(ws, { say = () => {} } = {}) {
  const m = ws.labels.messages
  const site = siteOf(ws, { defaults: true })
  const settings = publishOf(ws, site)
  const { url } = readState(ws)
  if (!url) {
    const written = siteState(ws)
    if (!written) { say(m["publish-none"]); return { code: DEFERRED } }
    const local = pathToFileURL(siteHome(ws, written)).href
    say(format(m["publish-local"], { url: local }))
    openLink(ws, settings, local, "site")
    return { code: 0, url: local }
  }
  say(format(m[copy(settings, url) ? "publish-address-copied" : "publish-address"], { url }))
  const code = scanCode(url)
  if (code) say(`\n${code.trimEnd().replace(/^/gm, "  ")}\n`)
  say(m["publish-phone"])
  const opened = openLink(ws, settings, url, "site")
  if (!opened.opened) say(m["publish-not-opened"])
  return { code: 0, url }
}

/** Where publishing stands, for `excudo site status`: nothing is changed. */
export function publishStatus(ws, { onCached = () => {}, onLive = () => {} } = {}) {
  const site = siteOf(ws, { defaults: true })
  const settings = publishOf(ws, site)
  const host = hostOf(ws, settings, { timeout: Math.min(10_000, hostTimeout()) })
  const project = linked(settings)
  const state = readState(ws)
  const inbox = settings.inbox ? { repo: settings.inbox.repo, token: null, tokenAt: state.inbox?.tokenAt ?? null,
    schedule: settings.inbox.schedule ? pullScheduleState(settings.inbox.site) : "own" } : null
  const status = {
    host: settings.host, cli: Boolean(host.cli), user: null, project: project ? { name: project.projectName ?? settings.project, id: project.projectId } : null,
    protection: null, protectionAt: state.protectionAt ?? null, url: state.url ?? null, deployment: state.deployment ?? null, at: state.at ?? null,
    dir: host.rel(settings.path), log: host.rel(host.log), inbox, reachable: host.cli ? true : null,
  }
  // Stored facts reach the terminal before any host query can wait on its deadline.
  onCached(structuredClone(status))
  const probe = (field, read) => {
    const value = read()
    const reachable = !isNetworkFailure(host.last)
    if (!reachable) status.reachable = false
    onLive(field, reachable ? value : null, { reachable })
    return reachable ? value : null
  }
  status.user = probe("login", () => whoami(host))
  if (status.user && project) {
    status.protection = probe("protection", () => protection(host))
    if (inbox) inbox.token = probe("token", () => Boolean(inboxToken(host, project)))
  } else if (status.reachable !== false) {
    onLive("protection", null, { reachable: true })
    if (inbox) onLive("token", null, { reachable: true })
  }
  return status
}
