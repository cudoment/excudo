// What the engine's skill scripts share: argument handling, the report, the self-test, and the facts
// most checks read. A check gathers facts (read only), then judges them in a pure function, so its
// self-test can feed it known cases without a workspace. Scripts find this module through the
// workspace's engine (`excudo/skill-kit`).
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import * as engine from "./index.mjs"
import { renderTemplate } from "./init.mjs"
import { copiedPassages, requestState } from "./requests.mjs"
import { readSourceState, urlsIn } from "./sources.mjs"
import { linkTargets } from "./dialects/logseq.mjs"
import { heldFiles, holdSpecs } from "./git.mjs"

export { engine, copiedPassages, requestState, readSourceState, urlsIn, linkTargets }

/** An error in how the script was called: exit code 2 with the usage. */
export class UsageError extends Error {}

const pick = (message, locale) => typeof message === "string" ? message : message?.[locale] ?? message?.en ?? ""

/**
 * Runs a check script: `--help` prints `usage`; `--facts <file>` judges the facts in that JSON file
 * instead of reading the workspace (lint feeds the known cases this way); `--self-test` judges each
 * case of `cases` (a URL or path of a JSON list of { name, expect: "pass"|"fail", facts, args? }).
 * Otherwise `gather(ws, options, positionals)` reads the facts. `evaluate(facts, options)` returns
 * the requirements as { id, ok, message } (a message may be { en, ko }).
 */
export async function runCheck({ usage, options = {}, gather, evaluate, cases, argv = process.argv.slice(2) }) {
  const all = { ...options, json: { type: "boolean" }, facts: { type: "string" }, "self-test": { type: "boolean" }, help: { type: "boolean", short: "h" } }
  const parse = (args) => parseArgs({ args, allowPositionals: true, options: all })
  let values, positionals
  try {
    ({ values, positionals } = parse(argv))
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`)
    return void (process.exitCode = 2)
  }
  if (values.help) return void console.log(usage)
  if (values["self-test"]) {
    const list = Array.isArray(cases) ? cases : JSON.parse(readFileSync(cases, "utf8"))
    const results = list.map((item) => {
      let got
      try { got = passes(evaluate(item.facts, parse((item.args ?? []).map(String)).values)) ? "pass" : "fail" } catch (error) { got = `error: ${error.message}` }
      return { name: item.name, expect: item.expect, got }
    })
    console.log(JSON.stringify({ cases: results }, null, 2))
    return void (process.exitCode = results.length && results.every((item) => item.got === item.expect) ? 0 : 1)
  }
  let locale = "en"
  let checks
  try {
    if (values.facts) checks = evaluate(JSON.parse(readFileSync(values.facts, "utf8")), values)
    else {
      const ws = await engine.loadWorkspace()
      if (!ws.hasConfig) {
        const env = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").slice(0, 2)
        console.error(engine.format((engine.LOCALES[env] ?? engine.LOCALES.en).messages["workspace-missing"], { dir: ws.root }))
        return void (process.exitCode = 2)
      }
      locale = ws.locale
      checks = evaluate(await gather(ws, values, positionals), values)
    }
  } catch (error) {
    console.error(error instanceof UsageError ? `${error.message}\n\n${usage}` : error.message)
    return void (process.exitCode = 2)
  }
  const ok = passes(checks)
  const shown = checks.map((item) => ({ id: item.id, ok: item.ok, message: pick(item.message, locale) }))
  if (values.json) console.log(JSON.stringify({ ok, checks: shown }, null, 2))
  else {
    for (const item of shown) console.log(`${item.ok ? "✓" : "✗"} ${item.id}: ${item.message}`)
    const failed = shown.filter((item) => !item.ok).length
    console.log(locale === "ko" ? (failed || !ok ? `요구 사항 ${failed}개를 충족하지 못했습니다.` : "모든 요구 사항을 충족합니다.")
      : failed || !ok ? `${failed} requirement${failed === 1 ? "" : "s"} not met.` : "Every requirement is met.")
  }
  process.exitCode = ok ? 0 : 1
}

// A check that judged nothing has not shown that anything holds.
const passes = (checks) => Array.isArray(checks) && checks.length > 0 && checks.every((item) => item.ok)

function git(ws, ...args) {
  // Paths come back as written, not octal-escaped, so reports can show them.
  return spawnSync("git", ["-C", ws.root, "-c", "core.quotePath=false", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}
const graphPath = (ws) => relative(ws.root, ws.graphDir) || "."

/**
 * Uncommitted changes below the graph and in the given workspace files, or null outside git. With
 * `pages` (graph files as `save --only` takes them: relative to the graph, or absolute), only those
 * pages of the graph count, so work saved with `save --only` passes while someone writes elsewhere.
 */
export function uncommitted(ws, files = [], { pages } = {}) {
  if (git(ws, "rev-parse", "--is-inside-work-tree").status !== 0) return null
  const graph = pages?.length ? pages.map((page) => relative(ws.root, resolve(ws.graphDir, page)) || ".") : [graphPath(ws)]
  const paths = [...graph, ...files.filter((file) => existsSync(join(ws.root, file)) || git(ws, "ls-files", "--error-unmatch", file).status === 0)]
  // Files a scheduled run holds (`EXCUDO_HOLD`) are someone else's edits in progress, not the skill's to save.
  return git(ws, "status", "--porcelain", "--", ...paths, ...holdSpecs(heldFiles(ws))).stdout.split("\n").filter(Boolean)
}

/** Whether `rev` names a commit of the workspace's repository. */
export const revisionExists = (ws, rev) => git(ws, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`).status === 0

/** The lines added since `rev` (committed or not) in `paths` (default: the graph), as { file, text }. */
export function addedLines(ws, rev, paths = [graphPath(ws)]) {
  const result = git(ws, "diff", "--unified=0", "--no-color", "--no-ext-diff", rev, "--", ...paths)
  if (result.status !== 0) throw new Error(result.stderr.trim())
  const lines = []
  let file
  for (const line of result.stdout.split("\n")) {
    // A path with a space ends its header with a tab.
    if (line.startsWith("+++ ")) file = line.slice(4).replace(/\t$/, "").replace(/^b\//, "")
    else if (line.startsWith("+") && file && file !== "/dev/null") lines.push({ file, text: line.slice(1) })
  }
  return lines
}

/** The Markdown files of the graph at `rev`, as { file, text }. */
export function graphAt(ws, rev) {
  const listed = git(ws, "ls-tree", "-r", "-z", "--name-only", rev, "--", graphPath(ws))
  if (listed.status !== 0) throw new Error(listed.stderr.trim())
  // ls-tree names files from the workspace folder, which need not be the repository's top.
  return listed.stdout.split("\0").filter((file) => file.endsWith(".md")).map((file) => ({ file, text: git(ws, "show", `${rev}:./${file}`).stdout }))
}

/** The Markdown files of the graph now, as { file, text } with NFC paths from the workspace root, like `graphAt`; each is read through its on-disk path. */
export function graphNow(ws) {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.name.startsWith(".") || entry.name === "logseq") return []
    return statSync(path).isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : []
  })
  return existsSync(ws.graphDir) ? walk(ws.graphDir).map((path) => ({ file: relative(ws.root, path).normalize("NFC"), text: readFileSync(path, "utf8") })) : []
}

const TASK = /^\s*- (TODO|DOING|WAITING|LATER|NOW|DONE|CANCELED|CANCELLED)\s+(.*)$/
/** Task lines: { marker, text, file }, the text without the marker and with spaces collapsed. */
export function tasksOf(files) {
  return files.flatMap(({ file, text }) => text.split("\n").map((line) => line.match(TASK)).filter(Boolean)
    .map((match) => ({ file, marker: match[1], text: match[2].replace(/\s+/g, " ").trim().normalize("NFC") })))
}
export const OPEN = new Set(["TODO", "DOING", "WAITING", "LATER", "NOW"])
export const CLOSED = new Set(["DONE", "CANCELED", "CANCELLED"])

/** A task's words without its tags, so a task only tagged since (deferred, shelved) is the same task. */
export const untagged = (text) => text.replace(/(?:^|\s)#(?:\[\[[^\]\n]+\]\]|[^\s#[\],;:!?()]+)/gu, " ").replace(/\s+/g, " ").trim().normalize("NFC")

/**
 * The tasks open in `before` and closed (DONE or canceled) in `now`, both lists of { file, text } such
 * as `graphAt(ws, rev)` and `graphNow(ws)`. A task is known by its words without tags, so one only
 * moved or tagged is the same task; identical tasks count one by one: as many close as the open ones
 * of those words fell and the closed ones rose. Returns { file, text } for each, from the pages where
 * the closed ones rose.
 */
export function closedSince(before, now) {
  const group = (tasks) => {
    const map = new Map()
    for (const task of tasks) {
      const key = untagged(task.text)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(task)
    }
    return map
  }
  const [then, current] = [tasksOf(before), tasksOf(now)]
  const openThen = group(then.filter((task) => OPEN.has(task.marker)))
  const openNow = group(current.filter((task) => OPEN.has(task.marker)))
  const closedThen = group(then.filter((task) => CLOSED.has(task.marker)))
  const closedNow = group(current.filter((task) => CLOSED.has(task.marker)))
  const found = []
  for (const [key, closed] of closedNow) {
    const n = Math.min((openThen.get(key)?.length ?? 0) - (openNow.get(key)?.length ?? 0), closed.length - (closedThen.get(key)?.length ?? 0))
    if (n <= 0) continue
    // The pages where more tasks of these words are closed than before come first.
    const earlier = new Map()
    for (const task of closedThen.get(key) ?? []) earlier.set(task.file, (earlier.get(task.file) ?? 0) + 1)
    const rose = [], rest = []
    for (const task of closed) {
      const left = earlier.get(task.file) ?? 0
      if (left) { earlier.set(task.file, left - 1); rest.push(task) } else rose.push(task)
    }
    found.push(...[...rose, ...rest].slice(0, n).map((task) => ({ file: task.file, text: task.text })))
  }
  return found
}

/**
 * Whether the owner's word covers a closed task: `allowed` holds the words of the tasks the owner said
 * are finished (a part of the task's words is enough), compared without tags, spacing or case.
 */
export function allowedDone(text, allowed = []) {
  const plain = (words) => untagged(words).toLowerCase()
  const task = plain(text)
  return allowed.some((words) => plain(words) && task.includes(plain(words)))
}

// Text compared as one line: line breaks and runs of spaces are one space.
const flat = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim()

/**
 * The rules of the engine's AGENTS.md template for this workspace (its names, such as `{home}`, filled
 * in): every top-level list item, as { lead, text }. `lead` is its bold lead, or its first sentence
 * when it has none; `text` is the whole item, its lines joined, without the list marker.
 */
export function templateRules(ws) {
  const names = { locale: ws.locale, graph: graphPath(ws), home: ws.labels.home, done: ws.labels.done }
  // Automatic sync adds one rule, and only a workspace that turned it on is asked to carry it.
  const rendered = ws.sync?.auto === true ? `${renderTemplate("AGENTS.md", names)}\n\n${renderTemplate("sync-rule.md", names)}` : renderTemplate("AGENTS.md", names)
  const items = []
  let current = null
  for (const line of rendered.split("\n")) {
    if (line.startsWith("- ")) items.push(current = [line.slice(2)])
    else if (current && /^\s+\S/.test(line)) current.push(line)
    else current = null
  }
  return items.map((lines) => {
    const text = flat(lines.join(" "))
    const lead = text.match(/^\*\*(.+?)\*\*/)?.[1] ?? text.match(/^(.+?[.。])(?:\s|$)/)?.[1] ?? text
    return { lead, text }
  })
}

/**
 * How the workspace's AGENTS.md (its text) carries the template's rules: `missing` lists the leads of
 * the rules it lacks, `differ` those whose lead is there but whose text is not, word for word (line
 * breaks aside). A workspace may add its own sentences after a rule.
 */
export function rulesAgainstTemplate(ws, text) {
  const own = flat(text)
  const missing = [], differ = []
  for (const rule of templateRules(ws)) {
    if (own.includes(rule.text)) continue
    ;(own.includes(flat(rule.lead)) ? differ : missing).push(rule.lead)
  }
  return { missing, differ }
}
