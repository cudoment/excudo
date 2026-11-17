// What the engine records about work done outside the memo, in one SQLite file in the workspace cache
// (`<cache>/records.db`): the requests the owner typed to coding agents, what each agent session did,
// the owner's commits, and the scheduled runs. Request text is the owner's own words and the agents
// delete their logs after a while, so the file is kept out of the graph and out of git, and may be the
// only copy left (`backup` writes a consistent copy). Node's built-in `node:sqlite` keeps the engine
// free of native modules. A write runs in one transaction: a failure leaves the file as it was, and
// two commands wait for each other instead of overwriting.
//
// Earlier versions kept these records in JSON files (requests.jsonl, requests.json, activity.json).
// When one is found, it is read into the file once, then renamed to `<name>.imported`.
import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { temporaryOf } from "./files.mjs"
import { format } from "./labels.mjs"

const SCHEMA = 1
const WAIT = 60000
export const recordsFile = (ws) => join(ws.cacheDir, "records.db")
const companions = (file) => ["", "-wal", "-shm", "-journal"].map((suffix) => `${file}${suffix}`)
const legacyOf = (ws) => ({ rows: join(ws.cacheDir, "requests.jsonl"), state: join(ws.cacheDir, "requests.json"), activity: join(ws.cacheDir, "activity.json") })
const real = (path) => { try { return realpathSync(path) } catch { return path } }

// Node 22 still calls its built-in SQLite experimental and prints a notice when it is first loaded;
// the module is loaded when the records are first opened, without that notice.
let sqlite
function database(file, options) {
  if (!sqlite) {
    const emit = process.emitWarning
    process.emitWarning = (warning, ...rest) => (/SQLite/.test(String(warning)) ? undefined : emit.call(process, warning, ...rest))
    try { sqlite = process.getBuiltinModule("node:sqlite") } finally { process.emitWarning = emit }
  }
  return new sqlite.DatabaseSync(file, options)
}

/**
 * The records hold the owner's request text: they must stay on this machine, never in the graph and
 * never where git would pick them up. Throws unless the cache is safe for `files` (default: the
 * records file and the files SQLite keeps beside it).
 */
export function checkCache(ws, files = companions(recordsFile(ws))) {
  const inside = (dir, parent) => dir === parent || dir.startsWith(parent.endsWith(sep) ? parent : parent + sep)
  // Where the cache really lands, through links, judged by the repository around it, not the workspace's.
  let near = ws.cacheDir
  while (!existsSync(near) && dirname(near) !== near) near = dirname(near)
  const cache = join(real(near), relative(near, ws.cacheDir))
  // A file written through a temporary one next to it needs that one ignored as well.
  // So does a file of an earlier version, renamed to `<name>.imported` once read: it holds request text.
  const ignored = () => {
    const inRepo = spawnSync("git", ["-C", real(near), "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })
    if (inRepo.status !== 0) return true
    const renamed = Object.values(legacyOf(ws)).filter((file) => existsSync(file)).map((file) => `${file}.imported`)
    return everyIgnored(real(near), [...files.flatMap((file) => [file, temporaryOf(file)]), ...renamed].map((file) => join(cache, relative(ws.cacheDir, file))))
  }
  // A cache file that is a link could lead anywhere, the graph included.
  const linked = [...files, ...Object.values(legacyOf(ws))].some((file) => { try { return lstatSync(file).isSymbolicLink() } catch { return false } })
  if (linked || inside(cache, real(ws.graphDir)) || !ignored())
    throw new Error(format(ws.labels.messages["requests-cache-unsafe"], { cache: ws.cacheDir }))
}

function migrate(db) {
  if (db.prepare("PRAGMA user_version").get().user_version >= SCHEMA) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cursors (kind TEXT NOT NULL, path TEXT NOT NULL, size INTEGER, mtime INTEGER, count INTEGER, shape TEXT, PRIMARY KEY (kind, path));
    CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, tool TEXT NOT NULL, session TEXT, ts TEXT, time INTEGER, cwd TEXT, text TEXT NOT NULL, pasted TEXT);
    CREATE INDEX IF NOT EXISTS requests_time ON requests (time);
    CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, tool TEXT NOT NULL, id TEXT NOT NULL, title TEXT, batch INTEGER NOT NULL, skills TEXT NOT NULL, prs TEXT NOT NULL, cost REAL);
    CREATE TABLE IF NOT EXISTS spans (session TEXT NOT NULL REFERENCES sessions (key) ON DELETE CASCADE, day TEXT NOT NULL, cwd TEXT NOT NULL,
      started TEXT NOT NULL, ended TEXT NOT NULL, turns INTEGER NOT NULL, PRIMARY KEY (session, day, cwd));
    CREATE INDEX IF NOT EXISTS spans_day ON spans (day);
    CREATE TABLE IF NOT EXISTS checks (session TEXT NOT NULL REFERENCES sessions (key) ON DELETE CASCADE, seq INTEGER NOT NULL, skill TEXT NOT NULL,
      ok INTEGER NOT NULL, at TEXT, cwd TEXT, PRIMARY KEY (session, seq));
    CREATE INDEX IF NOT EXISTS checks_skill ON checks (skill, at);
    CREATE TABLE IF NOT EXISTS commits (hash TEXT PRIMARY KEY, at TEXT NOT NULL, subject TEXT NOT NULL, repo TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, step TEXT NOT NULL, started TEXT NOT NULL, finished TEXT, status TEXT NOT NULL, detail TEXT);
    CREATE INDEX IF NOT EXISTS runs_started ON runs (started);
    PRAGMA user_version = ${SCHEMA};
  `)
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return undefined } }
export const setting = (db, key) => { const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key); return row ? JSON.parse(row.value) : undefined }
export const setSetting = (db, key, value) => value === undefined
  ? db.prepare("DELETE FROM settings WHERE key = ?").run(key)
  : db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value))

/**
 * Reads the JSON files of earlier versions into the records; returns the files read, to rename once
 * committed. That an import is done is kept in the same transaction as what it read, so a file left
 * behind by a rename that was cut short is only renamed later, never read over the records again.
 */
function importLegacy(ws, db) {
  const legacy = legacyOf(ws)
  const read = []
  if ((existsSync(legacy.rows) || existsSync(legacy.state)) && setting(db, "imported.requests")) read.push(legacy.rows, legacy.state)
  else if (existsSync(legacy.rows) || existsSync(legacy.state)) {
    const state = readJson(legacy.state) ?? { cursor: {}, marks: {} }
    const rows = existsSync(legacy.rows) ? readFileSync(legacy.rows, "utf8").split("\n").flatMap((line) => { try { return line ? [JSON.parse(line)] : [] } catch { return [] } }) : []
    db.exec("DELETE FROM requests; DELETE FROM cursors WHERE kind = 'requests'")
    insertRequests(db, rows)
    const cursor = db.prepare("INSERT INTO cursors (kind, path, size, mtime, count, shape) VALUES ('requests', ?, ?, ?, ?, ?)")
    for (const [path, mark] of Object.entries(state.cursor ?? {})) cursor.run(path, mark.size ?? null, mark.mtime ?? null, mark.count ?? null, mark.shape ?? null)
    setSetting(db, "requests.extraction", state.extraction)
    setSetting(db, "requests.marks", state.marks ?? {})
    setSetting(db, "requests.shown", state.shown ?? {})
    setSetting(db, "imported.requests", new Date().toISOString())
    read.push(legacy.rows, legacy.state)
  }
  if (existsSync(legacy.activity) && setting(db, "imported.activity")) read.push(legacy.activity)
  else if (existsSync(legacy.activity)) {
    const store = readJson(legacy.activity)
    if (store?.version === 1) {
      db.exec("DELETE FROM sessions; DELETE FROM commits; DELETE FROM cursors WHERE kind = 'activity'")
      for (const [key, session] of Object.entries(store.sessions ?? {})) putSession(db, key, session)
      const commit = db.prepare("INSERT OR IGNORE INTO commits (hash, at, subject, repo) VALUES (?, ?, ?, ?)")
      for (const item of Object.values(store.commits ?? {})) commit.run(item.hash, item.at, item.subject, item.repo)
      const cursor = db.prepare("INSERT INTO cursors (kind, path, size, mtime) VALUES ('activity', ?, ?, ?)")
      for (const [path, mark] of Object.entries(store.cursor ?? {})) cursor.run(path, mark.size ?? null, mark.mtime ?? null)
    }
    setSetting(db, "imported.activity", new Date().toISOString())
    read.push(legacy.activity)
  }
  return read.filter((file) => existsSync(file))
}

/**
 * Runs `fn(db)` on the records. With `write`, inside one transaction that waits for another writer;
 * the file is made when missing. Without it, `fn(null)` is called when there is no file yet.
 */
export function withRecords(ws, fn, { write = false } = {}) {
  checkCache(ws)
  const file = recordsFile(ws)
  const legacy = Object.values(legacyOf(ws)).some((path) => existsSync(path))
  if (!write && !legacy && !existsSync(file)) return fn(null)
  mkdirSync(ws.cacheDir, { recursive: true })
  const db = database(file, { timeout: WAIT })
  let imported = []
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL")
    db.exec("BEGIN IMMEDIATE")
    try {
      migrate(db)
      imported = importLegacy(ws, db)
      // A reader commits only the schema and the import, before it reads.
      if (!write) { db.exec("COMMIT"); db.exec("BEGIN") }
      const result = fn(db)
      db.exec("COMMIT")
      // Another command reading the records at the same moment may have renamed a file already.
      for (const path of imported) try { renameSync(path, `${path}.imported`) } catch (error) { if (error.code !== "ENOENT") throw error }
      return result
    } catch (error) {
      try { db.exec("ROLLBACK") } catch {}
      throw error
    }
  } finally { db.close() }
}

/** Inserts request rows ({ ts, tool, cwd, session, text, pasted }). */
export function insertRequests(db, rows) {
  const insert = db.prepare("INSERT INTO requests (tool, session, ts, time, cwd, text, pasted) VALUES (?, ?, ?, ?, ?, ?, ?)")
  for (const row of rows) {
    const time = Date.parse(row.ts)
    insert.run(row.tool, row.session ?? null, row.ts ?? null, Number.isFinite(time) ? time : null, row.cwd ?? null, row.text, row.pasted ? JSON.stringify(row.pasted) : null)
  }
}
/** Request rows in the shape the JSON cache had; `after` keeps those later than a time in milliseconds. */
export function requestRecords(db, { after = 0 } = {}) {
  if (!db) return []
  return db.prepare("SELECT tool, session, ts, cwd, text, pasted FROM requests WHERE time > ? ORDER BY id").all(after)
    .map(({ pasted, ...row }) => ({ ts: row.ts, tool: row.tool, cwd: row.cwd, session: row.session, text: row.text, ...(pasted ? { pasted: JSON.parse(pasted) } : {}) }))
}

/** Replaces one session ({ tool, id, title, batch, skills, prs, cost, spans, checks }) and its spans and checks. */
export function putSession(db, key, session) {
  db.prepare("DELETE FROM sessions WHERE key = ?").run(key)
  db.prepare("INSERT INTO sessions (key, tool, id, title, batch, skills, prs, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(key, session.tool, session.id, session.title ?? null, session.batch ? 1 : 0, JSON.stringify(session.skills ?? []), JSON.stringify(session.prs ?? []), session.cost ?? null)
  const span = db.prepare("INSERT OR REPLACE INTO spans (session, day, cwd, started, ended, turns) VALUES (?, ?, ?, ?, ?, ?)")
  for (const each of session.spans ?? []) span.run(key, each.day, each.cwd, each.start, each.end, each.turns ?? 0)
  const check = db.prepare("INSERT INTO checks (session, seq, skill, ok, at, cwd) VALUES (?, ?, ?, ?, ?, ?)")
  ;(session.checks ?? []).forEach((each, seq) => check.run(key, seq, each.skill, each.ok ? 1 : 0, each.at ?? null, each.cwd ?? null))
}
/** Every session as { key, tool, id, title, batch, skills, prs, cost, spans, checks }. */
export function sessionRecords(db) {
  if (!db) return []
  const sessions = new Map(db.prepare("SELECT * FROM sessions").all().map((row) => [row.key, {
    key: row.key, tool: row.tool, id: row.id, title: row.title, batch: Boolean(row.batch), skills: JSON.parse(row.skills), prs: JSON.parse(row.prs), cost: row.cost, spans: [], checks: [] }]))
  for (const row of db.prepare("SELECT * FROM spans ORDER BY session, started").all())
    sessions.get(row.session)?.spans.push({ day: row.day, cwd: row.cwd, start: row.started, end: row.ended, turns: row.turns })
  for (const row of db.prepare("SELECT * FROM checks ORDER BY session, seq").all())
    sessions.get(row.session)?.checks.push({ skill: row.skill, ok: Boolean(row.ok), at: row.at, cwd: row.cwd })
  return [...sessions.values()]
}

/** Records one scheduled step: `status` is ok, failed, deferred or paused. Returns its id. */
export function recordRun(ws, { step, status, started, finished = new Date().toISOString(), detail }) {
  if (!step || !RUN_STATES.includes(status)) throw new Error(format(ws.labels.messages["runs-invalid"], { states: RUN_STATES.join(", ") }))
  return withRecords(ws, (db) => Number(db.prepare("INSERT INTO runs (step, started, finished, status, detail) VALUES (?, ?, ?, ?, ?)")
    .run(step, started ?? finished, finished, status, detail ?? null).lastInsertRowid), { write: true })
}
export const RUN_STATES = ["ok", "failed", "deferred", "paused"]
/** The scheduled steps recorded since `days` ago, newest first. */
export function runRecords(ws, { days = 14, now = new Date(), steps = [], failed = false, deferred = false } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString()
  const states = [failed && "failed", deferred && "deferred"].filter(Boolean)
  return withRecords(ws, (db) => db ? db.prepare("SELECT step, started, finished, status, detail FROM runs WHERE started >= ? ORDER BY started DESC, id DESC").all(since)
    .filter((run) => (!steps.length || steps.includes(run.step)) && (!states.length || states.includes(run.status))) : [])
}

/** Small, read-only diagnostics: no migrations, legacy imports, new cache or request text. */
export function diagnosticRecords(ws) {
  const file = recordsFile(ws)
  if (!existsSync(file)) return { checks: [], runs: [], unavailable: false }
  checkCache(ws)
  const db = database(file, { readOnly: true, timeout: 1000 })
  try {
    const checks = db.prepare(`SELECT skill, ok, at FROM checks AS current
      WHERE NOT EXISTS (SELECT 1 FROM checks AS newer WHERE newer.skill = current.skill
        AND (coalesce(newer.at, '') > coalesce(current.at, '')
          OR (coalesce(newer.at, '') = coalesce(current.at, '') AND newer.rowid > current.rowid)))
      ORDER BY at DESC, rowid DESC LIMIT 20`).all().filter((row) => !row.ok).map((row) => row.skill)
    const runs = db.prepare("SELECT step, started, status, detail FROM runs ORDER BY started DESC, id DESC LIMIT 5").all()
    return { checks, runs, unavailable: false }
  } finally { db.close() }
}

/**
 * How each skill was used in the sessions of the last `days`: `used` sessions ran it (through the
 * agent's skill tool) and `lastUsed` is the latest of them; `sessions` ran its check and `passed`
 * passed it. A check is run again once what it reported is fixed, so only a session's last result
 * counts. `scheduled` of those were scheduled runs.
 */
export function skillRuns(ws, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString()
  return withRecords(ws, (db) => {
    const runs = new Map()
    if (!db) return runs
    const entryOf = (skill) => runs.get(skill) ?? runs.set(skill, { used: 0, lastUsed: null, sessions: 0, passed: 0, scheduled: 0, last: null, lastOk: null, days }).get(skill)
    for (const row of db.prepare(`SELECT j.value AS skill, COUNT(DISTINCT s.key) AS used, MAX(sp.ended) AS last FROM sessions s, json_each(s.skills) j
      JOIN spans sp ON sp.session = s.key WHERE sp.ended >= ? GROUP BY j.value`).all(since)) Object.assign(entryOf(row.skill), { used: row.used, lastUsed: row.last })
    const rows = db.prepare(`SELECT c.skill, c.ok, c.at, s.batch FROM checks c JOIN sessions s ON s.key = c.session
      WHERE c.at >= ? AND c.seq = (SELECT MAX(seq) FROM checks d WHERE d.session = c.session AND d.skill = c.skill) ORDER BY c.at`).all(since)
    for (const row of rows) {
      const entry = entryOf(row.skill)
      entry.sessions++
      if (row.ok) entry.passed++
      if (row.batch) entry.scheduled++
      entry.last = row.at
      entry.lastOk = Boolean(row.ok)
    }
    return runs
  })
}
/** Whether a skill's checks fail more often than they pass, over enough sessions to tell. */
export const failing = (runs) => Boolean(runs && runs.sessions >= 3 && runs.passed * 2 < runs.sessions)

/**
 * A backup holds the request text as the records do: it may not go into the cache itself (it would
 * replace what it copies), into the graph, through a link, or where git would commit it.
 */
const BACKUP_DB = ["records.db", `.records.db.${process.pid}.tmp`]
const BACKUP_DIRS = ["watch", "reports"]
const BACKUP_FILES = ["build.json", "history.json", "exports.json", "skills-installed.json", ...BACKUP_DIRS]

/** Whether git, run in `dir`, ignores every one of `paths`. */
function everyIgnored(dir, paths) {
  const result = spawnSync("git", ["-C", dir, "check-ignore", "--stdin", "-z"], { input: paths.join("\0"), encoding: "utf8" })
  const listed = new Set(result.stdout.split("\0").filter(Boolean))
  return paths.every((path) => listed.has(path))
}

function safeBackup(ws, dir) {
  const inside = (path, parent) => path === parent || path.startsWith(parent.endsWith(sep) ? parent : parent + sep)
  let near = dir
  while (!existsSync(near) && dirname(near) !== near) near = dirname(near)
  const at = join(real(near), relative(near, dir))
  const cache = real(ws.cacheDir)
  const linked = [dir, join(dir, "records.db")].some((path) => { try { return lstatSync(path).isSymbolicLink() } catch { return false } })
  // Every file a backup writes must be one git ignores: the records, their temporary copy, and the cache files.
  const tracked = () => {
    const inRepo = spawnSync("git", ["-C", real(near), "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" })
    if (inRepo.status !== 0) return false
    // The folders are copied whole, so each file in them, and a name a new one would take.
    const inside = (name) => {
      const from = join(ws.cacheDir, name)
      if (!existsSync(from)) return []
      const files = readdirSync(from, { recursive: true }).map(String).filter((rel) => statSync(join(from, rel)).isFile())
      return [join(name, "file"), ...files.map((rel) => join(name, rel))]
    }
    const paths = [...BACKUP_DB, ...BACKUP_FILES.flatMap((name) => BACKUP_DIRS.includes(name) ? inside(name) : [name])].map((name) => join(at, name))
    return !everyIgnored(real(near), paths)
  }
  if (inside(at, cache) || inside(cache, at) || inside(at, real(ws.graphDir)) || linked || tracked())
    throw new Error(format(ws.labels.messages["backup-unsafe"], { dir }))
}

/**
 * Writes a consistent copy of the cache into `dir`: the records through SQLite, and the other cache
 * files (build protection, history digests, watched notes) as they are. Returns the files written.
 */
export function backupRecords(ws, dir) {
  safeBackup(ws, dir)
  mkdirSync(dir, { recursive: true })
  const written = []
  const target = join(dir, "records.db")
  // The copy is made beside the old one and takes its place only when complete.
  const temporary = join(dir, `.records.db.${process.pid}.tmp`)
  rmSync(temporary, { force: true })
  withRecords(ws, (db) => {
    if (!db) return
    db.exec("COMMIT")
    try {
      db.exec(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`)
      renameSync(temporary, target)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    } finally { db.exec("BEGIN") }
    written.push(target)
  })
  for (const name of BACKUP_FILES) {
    const from = join(ws.cacheDir, name)
    if (!existsSync(from)) continue
    // A fresh copy: whatever the folder held there goes first, so a link left in it is never followed.
    rmSync(join(dir, name), { recursive: true, force: true })
    if (lstatSync(from).isDirectory()) cpSync(from, join(dir, name), { recursive: true })
    else copyFileSync(from, join(dir, name))
    written.push(join(dir, name))
  }
  return written
}
