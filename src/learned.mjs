// Skills a workspace learns from its owner's requests. Requests that recur (similar words, in more
// than one session) become candidates; an agent turns a candidate worth it into a skill folder below
// the workspace (`skills/<name>`), and the skill is installed while it meets the skill rule and
// scores at least `minScore`, or the owner keeps it (see skilllint.mjs). Each skill is installed where its record says: for
// this workspace (the default) or, when it was adopted so, for every folder. Upkeep lints the skills
// again, takes a skill that no longer fits out of use, refreshes installations, and counts the
// requests each one answers.
//
// `skills.json` (next to review.json, in git) records each skill and each dismissed candidate by
// request keys, counts and dates: never the requests' words, which stay in the workspace cache. A
// skill's record also names the cases of its check that reproduce mistakes the owner pointed out
// (`mistakes`), and lint keeps each of them a case that must fail.
// Commands that change it hold a lock, so a scheduled upkeep and an agent's adoption do not undo
// each other.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { filesOf, withLock, writeAtomic } from "./files.mjs"
import { format } from "./labels.mjs"
import { heldFiles, heldWithin } from "./git.mjs"
import { failing, skillRuns } from "./records.mjs"
import { copiedPassages, placer, requestRows, requestWindows } from "./requests.mjs"
import { judgeCase, lintSkill, SKILL_NAME } from "./skilllint.mjs"
import { agentLinkTools, packageVersion, skillNames, SKILLS_DIR } from "./skills.mjs"
import { movedFolders, movedPath } from "./workspaces.mjs"

export const LEARNED_FILE = "skills.json"
export const LEARNED_DEFAULTS = {
  /** Where the learned skills' sources live, relative to the workspace. */
  dir: "skills",
  /**
   * Where a newly adopted skill goes: "workspace", usable in this workspace, or "global", copied to
   * ~/.agents/skills for every folder. A skill keeps where it went until it is adopted elsewhere.
   */
  install: "workspace",
  /** The lowest fitness score (0–100) at which a skill is installed. */
  minScore: 80,
  /** Skills upkeep must keep installed even when their checks fail. */
  keep: [],
  /** How often, and in how many sessions, a request must recur to become a candidate. */
  minRequests: 3,
  minSessions: 2,
  /** How far back candidates are looked for. */
  windowDays: 60,
  /** An installed skill no request has called for in this many days is reported as dormant. */
  dormantDays: 90,
  /** How alike two requests' words must be (0–1) to count as the same work. */
  similarity: 0.35,
}
// The request keys a record keeps beyond the window: enough to recognize the work again.
const KEPT_KEYS = 30
const TEXT_MIN = 12
const TEXT_MAX = 2000
const SHOWN_REQUESTS = 8
const SHOWN_CHARS = 500
const MARK = "excudo-learned"
// Copies installed under the engine's former names (Electricity Is Not Free, mindplanter) carry these marks. They
// are still ours, and the next installation names the current mark.
const LEGACY_MARKS = ["electricity-is-not-free-learned", "mindplanter-learned"]
const DAY = 86400000
const LOCK_WAIT = 120000
// Upkeep runs every skill's cases; the lock is taken from a running command only after this long.
const LOCK_STALE = 3600000

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const shorten = (text, n) => [...text].length > n ? `${[...text].slice(0, n - 1).join("")}…` : text

/** The `skills` setting with its defaults, checked. */
export function learnedSettings(ws) {
  const m = ws.labels.messages
  const given = ws.skills ?? {}
  if (typeof given !== "object" || Array.isArray(given)) throw new Error(m["skills-setting-invalid"])
  const settings = { ...LEARNED_DEFAULTS, ...given }
  const number = (key, low, high) => typeof settings[key] === "number" && settings[key] >= low && settings[key] <= high
  if (typeof settings.dir !== "string" || !settings.dir || !["workspace", "global"].includes(settings.install)
    || !Array.isArray(settings.keep) || settings.keep.some((name) => typeof name !== "string" || !SKILL_NAME.test(name) || name.length > 64)
    || !number("minScore", 0, 100) || !number("minRequests", 1, 1000) || !number("minSessions", 1, 1000)
    || !number("windowDays", 1, 3650) || !number("dormantDays", 1, 3650) || !number("similarity", 0.05, 1))
    throw new Error(m["skills-setting-invalid"])
  return { ...settings, root: resolve(ws.root, settings.dir) }
}

export function readLearned(ws) {
  const path = join(ws.root, LEARNED_FILE)
  const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  return { skills: record.skills ?? {}, dismissed: record.dismissed ?? {} }
}
const writeLearned = (ws, record) => writeAtomic(join(ws.root, LEARNED_FILE), `${JSON.stringify(record, null, 2)}\n`)
const lockedRecord = (ws, fn) => withLock(join(ws.cacheDir, "skills"), fn, ws.labels.messages.locked, { wait: LOCK_WAIT, stale: LOCK_STALE })

// Requests are compared by the three-character pieces of their words, which works for Korean, where
// particles change word endings, as well as for English.
const normal = (text) => text.replace(/\[pasted \d+\]/g, " ").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
function piecesOf(text) {
  const chars = [...` ${text} `]
  const set = new Set()
  for (let i = 0; i + 3 <= chars.length; i++) set.add(chars.slice(i, i + 3).join(""))
  return set
}
function similarity(a, b) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  let shared = 0
  for (const piece of small) if (large.has(piece)) shared++
  return shared / (a.size + b.size - shared || 1)
}

/** The skill names agents can already use here: the engine's, the learned ones and those installed. */
function knownSkillNames(ws, settings, home) {
  const names = new Set([...skillNames(), ...Object.keys(readLearned(ws).skills)])
  for (const dir of [join(ws.root, ".agents", "skills"), join(home, ".agents", "skills"), settings.root])
    if (existsSync(dir)) for (const entry of readdirSync(dir)) if (SKILL_NAME.test(entry)) names.add(entry)
  return [...names]
}

/**
 * Groups the requests of the window. Requests like a learned skill's or a dismissed candidate's are
 * theirs (`attributed`); the rest are clustered around the first request of each cluster, oldest first.
 */
function survey(ws, settings, record, { now, refresh }) {
  const all = requestRows(ws, { refresh })
  const byKey = new Map(all.map((row) => [row.key, row]))
  const texts = new Map()
  const textOf = (row) => texts.get(row.key) ?? texts.set(row.key, normal(row.text ?? "")).get(row.key)
  const usable = (row) => { const n = [...textOf(row)].length; return n >= TEXT_MIN && n <= TEXT_MAX }
  const pieces = new Map()
  const piecesFor = (row) => pieces.get(row.key) ?? pieces.set(row.key, piecesOf(textOf(row))).get(row.key)
  const groups = [
    ...Object.entries(record.skills).map(([name, entry]) => ({ kind: "skill", name, keys: entry.evidence?.requests ?? [] })),
    ...Object.entries(record.dismissed).map(([id, entry]) => ({ kind: "dismissed", id, keys: entry.requests ?? [] })),
  ].map((group) => ({ ...group, members: group.keys.map((key) => byKey.get(key)).filter((row) => row && usable(row)).map(piecesFor) }))
  const known = new Set(groups.flatMap((group) => group.keys))
  const from = now.getTime() - settings.windowDays * DAY
  const attributed = new Map(groups.map((group) => [group, []]))
  const clusters = []
  for (const row of all) {
    if (known.has(row.key) || new Date(row.ts).getTime() <= from || !usable(row)) continue
    const own = piecesFor(row)
    let best, score = 0
    for (const group of groups) for (const member of group.members) {
      const value = similarity(own, member)
      if (value > score) { score = value; best = group }
    }
    if (best && score >= settings.similarity) { attributed.get(best).push(row); continue }
    let cluster, closest = 0
    for (const item of clusters) {
      const value = similarity(own, item.leader)
      if (value > closest) { closest = value; cluster = item }
    }
    if (cluster && closest >= settings.similarity) cluster.rows.push(row)
    else clusters.push({ leader: own, rows: [row] })
  }
  return { groups, attributed, clusters, byKey, since: new Date(from).toISOString() }
}

const realOrSame = (path) => { try { return realpathSync(path).normalize("NFC") } catch { return path.normalize("NFC") } }

/**
 * Where the owner typed the requests behind a skill: in this workspace (`here`) or in other folders.
 * A skill installed for the workspace is read only there, so one asked for mostly elsewhere is never
 * read where its work is done. Null when the workspace reads no requests.
 */
export function typedWhere(ws, keys, byKey) {
  if (!byKey) return null
  const root = realOrSame(ws.root)
  const typed = { here: 0, elsewhere: 0 }
  for (const key of keys) {
    const cwd = byKey.get(key)?.cwd
    if (!cwd) continue
    const at = realOrSame(cwd)
    typed[at === root || at.startsWith(`${root}/`) ? "here" : "elsewhere"]++
  }
  return typed
}

const sessionsOf = (keys) => new Set(keys.map((key) => key.split("|").slice(0, 2).join("|"))).size
const timeOf = (key) => new Date(key.split("|").slice(2).join("|")).getTime() || 0
const idOf = (rows) => `c${createHash("sha256").update(rows.map((row) => row.key).sort().join("\n")).digest("hex").slice(0, 10)}`

/**
 * The keys a record keeps: every key still inside the window, so a request is never counted twice,
 * and the newest few beyond it, so the work is still recognized after the window has moved on.
 */
function keptKeys(keys, settings, now) {
  const from = now.getTime() - settings.windowDays * DAY
  const sorted = [...new Set(keys)].sort((a, b) => timeOf(a) - timeOf(b))
  const newest = new Set(sorted.slice(-KEPT_KEYS))
  return sorted.filter((key) => timeOf(key) > from || newest.has(key))
}

function evidenceOf(keys, rows, earlier, settings, now) {
  const all = [...new Set([...(earlier?.requests ?? []), ...keys])]
  const times = rows.map((row) => row.ts).sort()
  return {
    ...earlier,
    count: (earlier?.count ?? 0) + rows.length,
    sessions: Math.max(earlier?.sessions ?? 0, sessionsOf(all)),
    first: [earlier?.first, times[0]].filter(Boolean).sort()[0] ?? null,
    last: [earlier?.last, times.at(-1)].filter(Boolean).sort().at(-1) ?? null,
    requests: keptKeys(all, settings, now),
  }
}

/**
 * The recurring requests not yet a skill or dismissed: { id, count, sessions, first, last, places,
 * covered (skill names the requests mention), requests (the newest few, with their words) }. The
 * words are for the agent deciding; they never go into a file.
 */
export function skillCandidates(ws, { now = new Date(), refresh = true, home = homedir() } = {}) {
  const settings = learnedSettings(ws)
  const record = readLearned(ws)
  const { clusters, since } = survey(ws, settings, record, { now, refresh })
  const place = placer(ws)
  const names = knownSkillNames(ws, settings, home)
  // A repository's own skills, where the requests were typed, count as covering them too.
  const local = new Map()
  const namesAt = (cwd) => {
    if (!cwd) return []
    if (!local.has(cwd)) local.set(cwd, [".agents", ".claude"].flatMap((tool) => { try { return readdirSync(join(cwd, tool, "skills")) } catch { return [] } }).filter((name) => SKILL_NAME.test(name)))
    return local.get(cwd)
  }
  const candidates = clusters
    .filter((cluster) => cluster.rows.length >= settings.minRequests && sessionsOf(cluster.rows.map((row) => row.key)) >= settings.minSessions)
    .map((cluster) => {
      const rows = cluster.rows
      const where = rows.map((row) => place(row.cwd).where)
      const words = rows.map((row) => row.text ?? "").join("\n")
      const known = [...new Set([...names, ...rows.flatMap((row) => namesAt(row.cwd))])]
      return {
        id: idOf(rows), count: rows.length, sessions: sessionsOf(rows.map((row) => row.key)), first: rows[0].ts, last: rows.at(-1).ts,
        places: [...new Set(where)].slice(0, 5), covered: known.filter((name) => (name.includes("-") || name.length > 4) && words.includes(name)),
        requests: rows.slice(-SHOWN_REQUESTS).map((row) => ({ ts: row.ts, where: place(row.cwd).where, text: shorten(row.text ?? "", SHOWN_CHARS), ...(row.pasted?.length ? { pasted: row.pasted.length } : {}) })),
        keys: rows.map((row) => row.key),
      }
    })
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1))
  return { since, candidates }
}

// ——— Installation ———

const isLink = (path) => { try { return lstatSync(path).isSymbolicLink() } catch { return false } }
const present = (path) => { try { lstatSync(path); return true } catch { return false } }

/** Where a skill installed `install`-wise goes: one folder and the agents' links to it. */
function placesFor(ws, install, name, home) {
  if (install === "global") {
    const dest = join(home, ".agents", "skills", name)
    // Each agent that keeps skills in the home folder gets a link, as for the engine's skills.
    const links = agentLinkTools(home, { global: true }).map((tool) => join(home, tool, "skills", name))
    return { global: true, dest, links }
  }
  return { global: false, dest: join(ws.root, ".agents", "skills", name), links: agentLinkTools(ws.root).map((tool) => join(ws.root, tool, "skills", name)) }
}

/** A digest of a skill folder's files, without the SOURCE.md a copy gets. */
const digestOf = (dir) => {
  const hash = createHash("sha256")
  for (const file of filesOf(dir).filter((file) => file !== "SOURCE.md").sort()) hash.update(`${file}\0`).update(readFileSync(join(dir, file))).update("\0")
  return hash.digest("hex")
}
const noteOf = (dest) => { try { return createHash("sha256").update(readFileSync(join(dest, "SOURCE.md"))).digest("hex") } catch { return null } }
// What each global copy looked like when it was installed (its files and its SOURCE.md), to tell a
// copy someone edited since.
const installedFile = (ws) => join(ws.cacheDir, "skills-installed.json")
const readInstalled = (ws) => { try { return JSON.parse(readFileSync(installedFile(ws), "utf8")) } catch { return {} } }
function recordInstalled(ws, name, dest) {
  const record = readInstalled(ws)
  if (dest) record[name] = { files: digestOf(dest), note: noteOf(dest) }
  else delete record[name]
  mkdirSync(ws.cacheDir, { recursive: true })
  writeAtomic(installedFile(ws), `${JSON.stringify(record, null, 2)}\n`)
}
/** The mark and workspace on the first line of a global copy's SOURCE.md, when an installation of ours wrote it. */
function ownerOf(dest) {
  let first
  try { first = readFileSync(join(dest, "SOURCE.md"), "utf8").split("\n", 1)[0] } catch { return null }
  const found = /^<!-- (\S+): (.+) -->$/.exec(first)
  return found && [MARK, ...LEGACY_MARKS].includes(found[1]) ? { mark: found[1], root: found[2] } : null
}
// Git reports relative directories from the queried checkout; real paths also handle symlinked roots.
function commonGitDir(root, option = "--git-common-dir") {
  const result = spawnSync("git", ["-C", root, "rev-parse", option], { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout.trim()) return null
  try { return realpathSync(resolve(root, result.stdout.trim())) } catch { return null }
}
/** The owning checkout, including a read-only view from another worktree of its repository. */
const ownsCopy = (ws, dest) => {
  const owner = ownerOf(dest)
  if (!owner) return null
  if (owner.root === ws.root) return { ...owner, linked: false }
  try { if (movedPath(movedFolders(ws), owner.root) === ws.root) return { ...owner, linked: false } } catch {}
  const common = commonGitDir(ws.root)
  return common && common === commonGitDir(owner.root) ? { ...owner, linked: true } : null
}
/** A copy of ours whose SOURCE.md names a former mark or folder: installing it again names the current ones. */
const staleNote = (ws, owner) => owner.mark !== MARK || !owner.linked && owner.root !== ws.root

// Only inspection may borrow another checkout's cache. Never pass this record to recordInstalled.
function installedRecord(ws, owner) {
  if (!owner.linked || existsSync(installedFile(ws))) return readInstalled(ws)
  return readInstalled({ cacheDir: resolve(owner.root, ws.cache) })
}

const linkedReason = (ws, scope, name, home) => {
  if (scope !== "global") return undefined
  const { dest } = placesFor(ws, scope, name, home)
  const owner = ownsCopy(ws, dest)
  if (owner?.linked) return format(ws.labels.messages["skills-install-linked"], { root: owner.root })
  // A fresh global name has no owner to compare yet. A linked checkout must not claim it either.
  if (!present(dest)) {
    const common = commonGitDir(ws.root)
    if (common && common !== commonGitDir(ws.root, "--git-dir")) return ws.labels.messages["skills-install-linked-new"]
  }
  return undefined
}

/**
 * Where an installed skill stands: missing, current, outdated (the source changed), edited (the copy
 * changed since it was installed, or nothing says what it was) or exists (someone else's).
 */
function installState(ws, settings, install, name, home) {
  const source = join(settings.root, name)
  const hasSource = existsSync(join(source, "SKILL.md"))
  const { global, dest } = placesFor(ws, install, name, home)
  if (!present(dest)) return "missing"
  if (!global) {
    const ours = isLink(dest) && resolve(dirname(dest), readlinkSync(dest)) === source
    return !ours ? "exists" : hasSource ? "current" : "outdated"
  }
  const owner = !isLink(dest) && ownsCopy(ws, dest)
  if (!owner) return "exists"
  const recorded = installedRecord(ws, owner)[name]
  const files = digestOf(dest)
  // Without a record SOURCE.md cannot be judged; with one, an edit to it counts like any other.
  const note = !recorded || recorded.note === noteOf(dest)
  if (hasSource && note && files === digestOf(source)) return staleNote(ws, owner) ? "outdated" : "current"
  return recorded && note && files === recorded.files ? "outdated" : "edited"
}

// A skill whose source or installation someone else is changing (held by a scheduled run) is left as it
// is: installing or removing it now would undo that person's edit, such as a link they took away.
const heldSkill = (ws, settings, scope, name, home) => {
  const held = heldFiles(ws)
  if (!held.length) return false
  const { dest, links } = placesFor(ws, scope, name, home)
  return [join(settings.root, name), dest, ...links].some((path) => heldWithin(ws, path, held))
}

function install(ws, settings, scope, name, { home, now, force = false }) {
  if (heldSkill(ws, settings, scope, name, home)) return "held"
  const source = join(settings.root, name)
  const { global, dest, links } = placesFor(ws, scope, name, home)
  if (linkedReason(ws, scope, name, home)) return "exists"
  let state = installState(ws, settings, scope, name, home)
  if (state === "exists" || state === "edited" && !force) return state
  if (state === "edited") state = "outdated"
  if (state !== "current") {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    if (global) {
      cpSync(source, dest, { recursive: true, dereference: true })
      writeFileSync(join(dest, "SOURCE.md"), sourceNote(ws, settings, name, now))
    } else symlinkSync(relative(dirname(dest), source), dest)
  }
  // A copy that matches its source is ours as it stands, also when the record of it was lost.
  if (global) recordInstalled(ws, name, dest)
  for (const link of links) if (!present(link)) {
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(join("..", "..", ".agents", "skills", name), link)
  }
  return state === "missing" ? "installed" : state === "outdated" ? "updated" : "current"
}

/** Takes an installation of ours away; a copy someone edited stays ("edited"). */
function uninstall(ws, settings, install, name, home) {
  if (heldSkill(ws, settings, install, name, home)) return "held"
  const { global, dest, links } = placesFor(ws, install, name, home)
  if (linkedReason(ws, install, name, home)) return "exists"
  const state = installState(ws, settings, install, name, home)
  if (state === "missing" || state === "exists") return state
  if (state === "edited") return state
  rmSync(dest, { recursive: true, force: true })
  for (const link of links) if (isLink(link) && readlinkSync(link) === join("..", "..", ".agents", "skills", name)) rmSync(link, { force: true })
  if (global) recordInstalled(ws, name, undefined)
  return "removed"
}

function sourceNote(ws, settings, name, now) {
  return `<!-- ${MARK}: ${ws.root} -->\n${format(ws.labels.messages["skills-source-note"], { name, workspace: ws.root, source: join(settings.root, name), date: localDay(now), version: packageVersion() })}\n`
}

// ——— Commands ———

/** The owner's words as of now: the cache is read from the logs first, so a request typed a moment ago counts. */
function freshWindows(ws) {
  if (!ws.conversations) return undefined
  requestRows(ws, { refresh: true })
  return requestWindows(ws) ?? undefined
}

/** The names of the cases a skill's record keeps for mistakes the owner pointed out; none in a record from before. */
export const mistakeCases = (entry) => (Array.isArray(entry?.mistakes) ? entry.mistakes : [])
  .map((item) => item?.case).filter((name) => typeof name === "string" && name)

/** Lints a learned skill with what its record keeps: `entry`, its record in skills.json (read when not given). */
function lintLearned(ws, settings, name, windows, entry = readLearned(ws).skills[name]) {
  return lintSkill(join(settings.root, name), { labels: ws.labels, cwd: ws.root, mistakes: mistakeCases(entry),
    copied: windows === undefined ? undefined : (items) => copiedPassages(ws, items, windows) })
}

/**
 * Lints learned skills (default: all of them) and, given their names or folder paths, the engine's or
 * any skill. A path to a learned skill's source (relative, absolute, through a link or with a trailing
 * slash) lints it as its name does, with what its record keeps.
 */
export function lintSkills(ws, targets = []) {
  const settings = learnedSettings(ws)
  const learned = existsSync(settings.root) ? readdirSync(settings.root).filter((name) => existsSync(join(settings.root, name, "SKILL.md"))) : []
  const sources = new Map(learned.map((name) => [realOrSame(join(settings.root, name)), name]))
  const learnedName = (target) => learned.includes(target) ? target : sources.get(realOrSame(resolve(target)))
  const list = (targets.length ? targets : learned).map((target) => ({ target, name: learnedName(target) }))
  const windows = list.some((item) => item.name) ? freshWindows(ws) : undefined
  const record = list.some((item) => item.name) ? readLearned(ws) : { skills: {} }
  return list.map(({ target, name }) => name ? lintLearned(ws, settings, name, windows, record.skills[name])
    : lintSkill(skillNames().includes(target) ? join(SKILLS_DIR, target) : resolve(target), { labels: ws.labels, cwd: ws.root }))
}

/**
 * Makes `name` (a folder below the skills dir) a learned skill: it is linted, recorded with its
 * evidence (the candidate `from`, or `requested` when the owner asked for it), and installed when
 * it fits. One that does not fit is recorded as a draft and stays out of use. `install` says where
 * ("workspace" or "global"); without it a skill stays where it is, and a new one goes where the
 * `install` setting says. A skill sent to every folder against the setting carries `why`, the
 * agent's reason in its own words, unless the owner asked for it. `force` replaces an installed copy
 * someone edited.
 */
export function adoptSkill(ws, name, { from, requested = false, install: scope, why, force = false, now = new Date(), home = homedir(), refresh = true } = {}) {
  const m = ws.labels.messages
  const settings = learnedSettings(ws)
  if (scope !== undefined && !["workspace", "global"].includes(scope)) throw new Error(format(m["skills-scope-invalid"], { scope }))
  if (!SKILL_NAME.test(name) || name.length > 64) throw new Error(format(m["skills-name-invalid"], { name }))
  if (skillNames().includes(name)) throw new Error(format(m["skills-name-engine"], { name }))
  if (!existsSync(join(settings.root, name, "SKILL.md"))) throw new Error(format(m["skills-folder-missing"], { name, dir: relative(ws.root, settings.root) }))
  return lockedRecord(ws, () => {
    const record = readLearned(ws)
    const entry = record.skills[name]
    let evidence = entry?.evidence
    if (from) {
      const candidate = skillCandidates(ws, { now, refresh, home }).candidates.find((item) => item.id === from)
      // A candidate this skill already holds (adopted before, perhaps as a draft) is no longer listed.
      if (!candidate && !evidence) throw new Error(format(m["skills-candidate-unknown"], { id: from }))
      if (candidate) {
        const keys = new Set(candidate.keys)
        evidence = evidenceOf(candidate.keys, requestRows(ws, { refresh: false }).filter((row) => keys.has(row.key)), evidence, settings, now)
      }
    }
    if (requested) evidence = { ...evidence, requested: localDay(now) }
    if (!evidence) throw new Error(format(m["skills-evidence-needed"], { name }))
    const where = scope ?? entry?.install ?? settings.install
    const reason = why?.trim() || (where === "global" ? entry?.why : undefined)
    // Where the workspace keeps its skills to itself, a skill reaches every folder on the agent's
    // judgment, given with its reason, or because the owner asked; one already there stays.
    if (where === "global" && settings.install !== "global" && entry?.install !== "global" && !evidence.requested && !reason)
      throw new Error(format(m["skills-global-why"], { name }))
    const windows = freshWindows(ws)
    if (why?.trim() && windows !== undefined && copiedPassages(ws, [{ file: "why", text: why }], windows)?.length) throw new Error(m["skills-reason-copied"])
    const lint = lintLearned(ws, settings, name, windows, entry)
    const fit = lint.ok && lint.score >= settings.minScore
    let state = "draft", left, installReason
    if (fit) {
      state = install(ws, settings, where, name, { home, now, force })
      if (state === "exists") throw new Error(linkedReason(ws, where, name, home) ?? format(m["skills-install-exists"], { name, dest: placesFor(ws, where, name, home).dest }))
      // A skill moving to another kind of installation leaves the old one once the new one is in place;
      // a copy someone edited there stays, and the owner is told.
      if (entry?.install && entry.install !== where) {
        const removed = uninstall(ws, settings, entry.install, name, home)
        installReason = linkedReason(ws, entry.install, name, home)
        if (removed === "edited" || installReason) left = placesFor(ws, entry.install, name, home).dest
      }
    } else if (entry?.status === "active") {
      uninstall(ws, settings, entry.install ?? settings.install, name, home)
      installReason = linkedReason(ws, entry.install ?? settings.install, name, home)
    }
    const { why: earlier, ...kept } = entry ?? {}
    record.skills[name] = {
      ...kept,
      status: fit ? "active" : "draft",
      install: where,
      // Why a skill is in every folder; one back in the workspace needs none.
      ...(where === "global" && reason ? { why: reason } : {}),
      created: entry?.created ?? localDay(now),
      updated: localDay(now),
      score: lint.score,
      evidence,
      matched: entry?.matched ?? { count: 0, last: null },
    }
    writeLearned(ws, record)
    return { name, status: record.skills[name].status, install: where, score: lint.score, minScore: settings.minScore, state, ...(left ? { left } : {}), ...(installReason ? { reason: installReason } : {}), lint }
  })
}

/** Records that a candidate is not worth a skill, so it and requests like it are not offered again. */
export function dismissCandidate(ws, id, { reason, now = new Date(), refresh = true, home = homedir() } = {}) {
  const m = ws.labels.messages
  if (!reason?.trim()) throw new Error(m["skills-reason-needed"])
  const settings = learnedSettings(ws)
  return lockedRecord(ws, () => {
    // The candidates read the logs first; the reason is then compared with requests up to now.
    const candidate = skillCandidates(ws, { now, refresh, home }).candidates.find((item) => item.id === id)
    if (!candidate) throw new Error(format(m["skills-candidate-unknown"], { id }))
    if (copiedPassages(ws, [{ file: "reason", text: reason }])?.length) throw new Error(m["skills-reason-copied"])
    const record = readLearned(ws)
    record.dismissed[id] = { at: localDay(now), reason: reason.trim(), count: candidate.count, requests: keptKeys(candidate.keys, settings, now) }
    writeLearned(ws, record)
    return { id, count: candidate.count }
  })
}

/**
 * Records that the case `case` of a learned skill's check reproduces a mistake the owner pointed out,
 * with `why`, the agent's summary in its own words, so lint keeps that case one that must fail. The
 * case must be in the skill's cases file, expect "fail", and the check must fail on its facts and
 * arguments now; a summary that copies the owner's requests is refused. A case recorded before is
 * recorded again with the new summary and date.
 */
export function recordMistake(ws, name, { case: given, why, now = new Date() } = {}) {
  const m = ws.labels.messages
  const settings = learnedSettings(ws)
  if (skillNames().includes(name)) throw new Error(format(m["skills-mistake-engine"], { name }))
  if (!readLearned(ws).skills[name]) throw new Error(format(m["skills-unknown"], { name }))
  const dir = join(settings.root, name)
  if (!existsSync(join(dir, "SKILL.md"))) throw new Error(format(m["skills-folder-missing"], { name, dir: relative(ws.root, settings.root) }))
  const label = typeof given === "string" ? given : ""
  if (!label.trim()) throw new Error(format(m["needs-args"], { command: "skills mistake", args: `${name} --case <name> --why <words>` }))
  if (!why?.trim()) throw new Error(m["skills-mistake-why"])
  // Judged before the record is locked: running the check may take a while, and it changes nothing.
  const judged = judgeCase(dir, label, { labels: ws.labels, cwd: ws.root })
  if (!judged) throw new Error(format(m["skills-mistake-no-case"], { name, case: label }))
  if (judged.problem) throw new Error(format(m["skills-mistake-cases"], { name, problem: judged.problem }))
  if (judged.expect !== "fail") throw new Error(format(m["skills-mistake-case-pass"], { name, case: label }))
  if (judged.got !== "fail") throw new Error(format(m["skills-mistake-not-caught"], { name, case: label, got: judged.got }))
  const windows = freshWindows(ws)
  if (windows !== undefined && copiedPassages(ws, [{ file: "why", text: why }], windows)?.length) throw new Error(m["skills-reason-copied"])
  return lockedRecord(ws, () => {
    const record = readLearned(ws)
    const entry = record.skills[name]
    if (!entry) throw new Error(format(m["skills-unknown"], { name }))
    const kept = (Array.isArray(entry.mistakes) ? entry.mistakes : []).filter((item) => item?.case !== label)
    record.skills[name] = { ...entry, mistakes: [...kept, { case: label, why: why.trim(), date: localDay(now) }] }
    writeLearned(ws, record)
    return { name, case: label, n: record.skills[name].mistakes.length }
  })
}

/** Takes a learned skill out of use; its source and record stay, and so does a copy someone edited. */
export function retireSkill(ws, name, { now = new Date(), home = homedir() } = {}) {
  const settings = learnedSettings(ws)
  return lockedRecord(ws, () => {
    const record = readLearned(ws)
    const entry = record.skills[name]
    if (!entry) throw new Error(format(ws.labels.messages["skills-unknown"], { name }))
    const state = uninstall(ws, settings, entry.install ?? settings.install, name, home)
    record.skills[name] = { ...entry, status: "retired", retired: localDay(now) }
    writeLearned(ws, record)
    const reason = linkedReason(ws, entry.install ?? settings.install, name, home)
    return { name, state, dest: placesFor(ws, entry.install ?? settings.install, name, home).dest, ...(reason ? { reason } : {}) }
  })
}

/**
 * Keeps the learned skills in order: lints each again, takes an active one that no longer fits out
 * of use (back to draft), refreshes installed copies whose source changed (each where its record
 * says; the `install` setting only places new skills), and adds the requests that called for a
 * skill or a dismissed candidate since. Each skill's report says where its requests were typed
 * (`typed`: here or elsewhere). With `dryRun`, nothing is written or installed: each skill keeps its recorded
 * status, and `state` says what upkeep would do ("unfit" for one it would take out of use).
 */
export function upkeepSkills(ws, { now = new Date(), home = homedir(), dryRun = false, refresh = true } = {}) {
  const run = () => keep(ws, { now, home, dryRun, refresh })
  return dryRun ? run() : lockedRecord(ws, run)
}

function keep(ws, { now, home, dryRun, refresh }) {
  const settings = learnedSettings(ws)
  const record = readLearned(ws)
  const surveyed = ws.conversations ? survey(ws, settings, record, { now, refresh }) : { groups: [], attributed: new Map(), clusters: [] }
  // How each skill went in the sessions recorded by `activity`: its checks, and when it was last used.
  let runs = new Map()
  if (ws.conversations) try { runs = skillRuns(ws, { days: settings.dormantDays, now }) } catch {}
  const report = []
  for (const [name, entry] of Object.entries(record.skills)) {
    // One skill that cannot be kept (a folder that cannot be read, say) leaves the others to be kept.
    try { report.push(keepOne(ws, settings, record, surveyed, name, entry, { now, home, dryRun, runs: runs.get(name) ?? null })) } catch (error) {
      report.push({ name, status: entry.status, install: entry.install ?? settings.install, score: entry.score ?? 0, fit: false, state: "error", dormant: false, matched: 0, missing: false, typed: null, problems: [error.message] })
    }
  }
  for (const group of surveyed.groups.filter((item) => item.kind === "dismissed")) {
    const rows = surveyed.attributed.get(group)
    const entry = record.dismissed[group.id]
    record.dismissed[group.id] = { ...entry, count: (entry.count ?? 0) + rows.length, requests: keptKeys([...(entry.requests ?? []), ...rows.map((row) => row.key)], settings, now) }
  }
  const unregistered = existsSync(settings.root) ? readdirSync(settings.root).filter((name) => existsSync(join(settings.root, name, "SKILL.md")) && !record.skills[name]) : []
  const waiting = surveyed.clusters.filter((cluster) => cluster.rows.length >= settings.minRequests && sessionsOf(cluster.rows.map((row) => row.key)) >= settings.minSessions).length
  if (!dryRun && (existsSync(join(ws.root, LEARNED_FILE)) || report.length || Object.keys(record.dismissed).length)) writeLearned(ws, record)
  return { skills: report, unregistered, candidates: waiting, minScore: settings.minScore, install: settings.install }
}

function keepOne(ws, settings, record, surveyed, name, entry, { now, home, dryRun, runs }) {
  const group = surveyed.groups.find((item) => item.kind === "skill" && item.name === name)
  const rows = group ? surveyed.attributed.get(group) : []
  let next = entry
  if (rows.length) {
    const times = rows.map((row) => row.ts).sort()
    next = { ...entry, evidence: evidenceOf(rows.map((row) => row.key), rows, entry.evidence, settings, now),
      matched: { count: (entry.matched?.count ?? 0) + rows.length, last: [entry.matched?.last, times.at(-1)].filter(Boolean).sort().at(-1) } }
  } else if (entry.evidence?.requests) next = { ...entry, evidence: { ...entry.evidence, requests: keptKeys(entry.evidence.requests, settings, now) } }
  const folder = existsSync(join(settings.root, name, "SKILL.md"))
  // Whether a skill is the owner's words was settled when it was adopted, and its later changes are
  // compared when they are committed; a later request quoting the skill must not take it out of use.
  const lint = folder ? lintLearned(ws, settings, name, undefined, next) : undefined
  const fit = Boolean(lint?.ok && lint.score >= settings.minScore)
  const kept = settings.keep.includes(name)
  // The owner's kept skills stay installed; an inconclusive check also holds a skill that still meets minScore.
  const held = !fit && (kept || Boolean(lint?.held && lint.score >= settings.minScore))
  // A record from before skills kept their own place (none written) takes the setting's.
  const installed = entry.install ?? settings.install
  const reason = !dryRun && linkedReason(ws, installed, name, home)
  if (!entry.install) next = { ...next, install: installed }
  let state = next.status === "active" ? installState(ws, settings, installed, name, home) : "off"
  if (lint) next = { ...next, score: lint.score }
  // A skill someone else is changing keeps its standing and installation: a half-written check is no reason to demote it.
  if (!dryRun && heldSkill(ws, settings, installed, name, home)) state = "held"
  // Kept skills and checks interrupted by their environment wait for a later verdict.
  else if (next.status === "active" && !fit && held) state = "held"
  else if (next.status === "active" && !fit) {
    if (dryRun) state = "unfit"
    else {
      const left = uninstall(ws, settings, installed, name, home)
      state = left === "edited" || left === "exists" && reason ? "demoted-kept" : "demoted"
      next = { ...next, status: "draft", demoted: localDay(now) }
    }
  } else if (next.status === "active" && !dryRun) state = install(ws, settings, installed, name, { home, now })
  // A skill the agents ran lately is in use, whatever the requests that called for it said.
  const seen = [next.evidence?.last, next.matched?.last, next.updated, runs?.lastUsed, runs?.last].filter(Boolean).sort().at(-1)
  const dormant = next.status === "active" && Boolean(seen) && now.getTime() - new Date(seen).getTime() > settings.dormantDays * DAY
  record.skills[name] = next
  return { name, status: next.status, install: installed, score: next.score ?? 0, fit, held, kept, state, ...(reason ? { reason } : {}), dormant, matched: rows.length, runs, failing: failing(runs),
    missing: !folder, typed: typedWhere(ws, next.evidence?.requests ?? [], surveyed.byKey),
    // The mistakes the check keeps, and those whose case is gone or no longer must fail.
    mistakes: mistakeCases(next).length, lost: lint?.checks.find((item) => item.id === "mistakes")?.lost ?? [],
    problems: lint ? lint.checks.filter((item) => !item.ok).map((item) => `${item.id}: ${item.message}`) : [] }
}

/** How the learned skills stand, without changing anything. */
export const skillsStatus = (ws, options = {}) => upkeepSkills(ws, { ...options, dryRun: true })
