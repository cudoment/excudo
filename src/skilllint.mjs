// What makes a folder a skill, and how fit it is. A skill embeds code that does part of its work the
// same way every time; a prompt that only abbreviates instructions is no skill. At the least it ships
// a check script that tells whether the skill's requirements were met, and that check must be able
// to fail: lint feeds it known cases itself and watches how it judges them.
//
// Folder layout:
//   SKILL.md                   frontmatter `name` (the folder's name) and `description` (when to use it)
//   scripts/check.*            exit 0 when every requirement holds, 1 when one does not, 2 on a usage
//                              error; `--json` prints { ok, checks: [{ id, ok, message }] }, and
//                              `--facts <file>` judges the facts in that JSON file instead of reading them
//   scripts/check.cases.json   [{ name, expect: "pass" | "fail", facts, args? }]: at least one of each
//   scripts/<other>            searches and changes the skill repeats, each run from SKILL.md
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { format, LOCALES } from "./labels.mjs"
import { CASE_MAX_BUFFER, caseJobs, caseResult } from "./skilllint-runner.mjs"

export const SCRIPT_TYPES = { ".mjs": "node", ".js": "node", ".cjs": "node", ".sh": "bash", ".py": "python3" }
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const CASES_FILE = "scripts/check.cases.json"
/** Points of the quality criteria; what a skill must have is required, not scored. */
export const POINTS = { "runs-check": 25, triggers: 20, usage: 20, portable: 20, size: 15 }
export const PLACEHOLDER = "FILL IN:"
// What an installer writes into a copy: the version it came from and where it came from.
const INSTALLED = new Set(["version.json", "SOURCE.md"])
// How long one known case may run (milliseconds); tests shorten it with EXCUDO_CASE_TIMEOUT_MS.
const CASE_TIMEOUT = () => Number(process.env.EXCUDO_CASE_TIMEOUT_MS ?? 30000)

// Calls that only one agent understands; a skill speaks in shell commands and plain words.
const TOOL_SPECIFIC = [
  /\b(?:Read|Write|Edit|MultiEdit|Bash|Grep|Glob|WebFetch|WebSearch|Task|Skill|Agent|TodoWrite|AskUserQuestion|NotebookEdit)\s+tool\b/,
  /\bmcp__\w+/,
  /\$ARGUMENTS\b/,
  /\$\{?CLAUDE_[A-Z_]+/,
  /\b(?:apply_patch|update_plan)\b/,
]
const SECRETS = [
  /\b(?:api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]
const TRIGGERS = /\b(?:use|used|run|invoke)\s+(?:it\s+|this\s+)?(?:for|when|to)\b|\bwhen\b|할 때|때 씁니다|때 사용|요청에 씁니다/i

const filesBelow = (dir, base = dir) => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  return statSync(path).isDirectory() ? filesBelow(path, base) : [relative(base, path)]
})

/** The frontmatter fields and body of a SKILL.md, or undefined when it has no frontmatter. */
export function readSkill(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return undefined
  let fields
  try { fields = parse(match[1]) ?? {} } catch { return undefined }
  return { fields, body: text.slice(match[0].length) }
}

function syntaxError(type, path) {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 })
    if (result.error?.code === "ENOENT") return undefined
    return result.status === 0 ? undefined : (result.stderr || result.stdout).trim().split("\n").slice(0, 3).join(" ")
  }
  if (type === "node") return run(process.execPath, ["--check", path])
  if (type === "bash") return run("bash", ["-n", path])
  return run("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", path])
}

/** The known cases in `casesPath`, or a problem when the file is missing or not a list of cases. */
function readCases(casesPath, m) {
  if (!existsSync(casesPath)) return m["skill-cases-missing"]
  let cases
  try { cases = JSON.parse(readFileSync(casesPath, "utf8")) } catch (error) { return format(m["skill-cases-invalid"], { error: error.message }) }
  if (!Array.isArray(cases)) return format(m["skill-cases-invalid"], { error: "not a list" })
  const bad = cases.findIndex((item) => !item || !["pass", "fail"].includes(item.expect) || item.facts === undefined || (item.args !== undefined && !Array.isArray(item.args)))
  if (bad >= 0) return format(m["skill-cases-shape"], { n: bad + 1 })
  return cases
}

/**
 * Feeds the check each of `cases`: its facts in a file (`--facts`), its arguments after them. The
 * check's exit code is its judgment: "pass" (0), "fail" (1), "timeout" when it ran past CASE_TIMEOUT
 * (a busy machine, not a judgment), "infrastructure: <cause>" when its environment failed, or how it ended otherwise, per case.
 */
function runCases(type, script, cases, cwd) {
  const command = type === "node" ? process.execPath : type
  const dir = mkdtempSync(join(tmpdir(), "excudo-case-"))
  try {
    const tasks = cases.map((item, i) => {
      const file = join(dir, `case-${i + 1}.json`)
      writeFileSync(file, JSON.stringify(item.facts))
      return { command, args: [script, "--facts", file, ...(item.args ?? []).map(String)],
        options: { cwd, encoding: "utf8", timeout: CASE_TIMEOUT(), maxBuffer: CASE_MAX_BUFFER, killSignal: "SIGKILL" } }
    })
    const serial = (task) => caseResult(spawnSync(task.command, task.args, task.options))
    const jobs = caseJobs()
    if (tasks.length > 1 && jobs > 1) {
      try {
        const helper = spawnSync(process.execPath, [fileURLToPath(new URL("./skilllint-runner.mjs", import.meta.url))], {
          input: JSON.stringify({ tasks, jobs }), encoding: "utf8", maxBuffer: CASE_MAX_BUFFER,
          timeout: tasks.length * (Math.max(0, CASE_TIMEOUT()) + 1000) + 10000,
        })
        if (!helper.error && helper.status === 0) {
          const got = JSON.parse(helper.stdout)
          if (Array.isArray(got) && got.length === cases.length && got.every((value) => typeof value === "string"
            && /^(?:pass$|fail$|timeout$|infrastructure: .+|exit .+)/.test(value))) {
            // Wait until the batch has ended before retrying: a check may share files or git locks
            // with its neighbors. Only an isolated run may replace an unexpected judgment.
            return got.map((value, i) => value === cases[i].expect ? value : serial(tasks[i]))
          }
        }
      } catch { /* An unavailable helper must never prevent lint from judging the cases. */ }
    }
    return tasks.map(serial)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Feeds the check each known case, so a check that cannot fail fails here. Returns a problem, { n }
 * when every case was judged as expected, or { n, timedOut, infrastructure } when the only cases not
 * judged as expected were interrupted: nothing was judged wrong, so lint holds its verdict (`held`).
 */
function judgeCases(type, script, casesPath, cwd, m) {
  const cases = readCases(casesPath, m)
  if (typeof cases === "string") return cases
  if (!cases.some((item) => item.expect === "pass") || !cases.some((item) => item.expect === "fail")) return m["skill-cases-both"]
  const got = runCases(type, script, cases, cwd)
  // A case with no name, or an empty one, goes by its number.
  const nameOf = (item, i) => item.name || String(i + 1)
  const label = (item, i) => `${nameOf(item, i)} (${item.expect} → ${got[i]})`
  const wrong = cases.map((item, i) => got[i] === item.expect ? null : label(item, i)).filter((one) => one !== null)
  const timedOut = cases.map((item, i) => got[i] === "timeout" ? nameOf(item, i) : null).filter((one) => one !== null)
  const infrastructure = cases.map((item, i) => got[i].startsWith("infrastructure: ") ? `${nameOf(item, i)} (${got[i].slice(16)})` : null).filter((one) => one !== null)
  if (timedOut.length + infrastructure.length && wrong.length === timedOut.length + infrastructure.length) return { n: cases.length, timedOut, infrastructure }
  return wrong.length ? format(m["skill-cases-wrong"], { names: wrong.join(", ") }) : { n: cases.length }
}

/** The skill's check script (`scripts/check.<ext>` of a known type), relative to its folder. */
function checkScriptOf(dir) {
  const scripts = filesBelow(join(dir, "scripts")).map((rel) => `scripts/${rel}`).filter((rel) => SCRIPT_TYPES[extname(rel)])
  return scripts.find((rel) => /^scripts\/check\.[a-z]+$/.test(rel))
}

/**
 * Judges the known case named `name` of the skill in `dir` the way lint does: { expect, got } with
 * the case's expectation and the check's judgment of its facts and arguments ("pass", "fail" or how
 * it ended); { problem } when there is no check or no readable cases file; null when no case has
 * that name.
 */
export function judgeCase(dir, name, { labels = LOCALES.en, cwd = dir } = {}) {
  const m = labels.messages
  const script = checkScriptOf(dir)
  if (!script) return { problem: m["skill-check-missing"] }
  const cases = readCases(join(dir, CASES_FILE), m)
  if (typeof cases === "string") return { problem: cases }
  const item = cases.find((one) => one.name === name)
  if (!item) return null
  const [got] = runCases(SCRIPT_TYPES[extname(script)], join(dir, script), [item], cwd)
  return { expect: item.expect, got }
}

/**
 * The names among `names` (cases recorded for the owner's corrections) that the skill in `dir` no
 * longer keeps as a case that must fail: gone from its cases file, or expected to pass.
 */
function lostCases(dir, names) {
  let cases
  try { cases = JSON.parse(readFileSync(join(dir, CASES_FILE), "utf8")) } catch { cases = [] }
  const failing = new Set((Array.isArray(cases) ? cases : []).filter((item) => item?.expect === "fail").map((item) => item.name))
  return names.filter((name) => !failing.has(name))
}

/**
 * Lints the skill in `dir`. Required checks decide `ok`; the quality criteria add up to `score`
 * (0–100). `copied` ({ file, text }[] → passages | null) is given for a skill made from the owner's
 * requests: no passage of theirs may be in it. `mistakes` names the cases recorded for mistakes the
 * owner pointed out (`skills mistake`): each must still be a case that must fail, so the check keeps
 * catching the mistake. `cwd` is where the check runs its cases. `held` is true when the skill is not
 * ok only because known cases ran out of time or their environment failed: no verdict is given.
 */
export function lintSkill(dir, { labels = LOCALES.en, copied, mistakes = [], cwd = dir } = {}) {
  const m = labels.messages
  const checks = []
  const add = (id, ok, message, { required = false } = {}) => checks.push({ id, ok, required, points: required ? 0 : ok ? POINTS[id] : 0, message })
  const name = basename(dir)
  const file = join(dir, "SKILL.md")
  const text = existsSync(file) ? readFileSync(file, "utf8") : ""
  const skill = text ? readSkill(text) : undefined
  const fields = skill?.fields ?? {}
  const description = typeof fields.description === "string" ? fields.description.trim() : ""
  const problems = []
  if (!text) problems.push(m["skill-md-missing"])
  else if (!skill) problems.push(m["skill-md-frontmatter"])
  else {
    if (fields.name !== name) problems.push(format(m["skill-md-name"], { name, given: fields.name ?? "-" }))
    if (!SKILL_NAME.test(name) || name.length > 64) problems.push(format(m["skill-md-name-form"], { name }))
    if (!description || [...description].length > 1024) problems.push(m["skill-md-description"])
  }
  add("skill-md", !problems.length, problems.join(" ") || m["skill-md-ok"], { required: true })

  const files = filesBelow(join(dir, "scripts")).map((rel) => `scripts/${rel}`)
  const scripts = files.filter((rel) => SCRIPT_TYPES[extname(rel)])
  add("scripts", scripts.length > 0, scripts.length ? format(m["skill-scripts-ok"], { n: scripts.length }) : m["skill-scripts-missing"], { required: true })
  const checkScript = scripts.find((rel) => /^scripts\/check\.[a-z]+$/.test(rel))
  add("check-script", Boolean(checkScript), checkScript ? format(m["skill-check-ok"], { file: checkScript }) : m["skill-check-missing"], { required: true })

  // The scripts SKILL.md runs are the ones directly in scripts/; deeper files are their helpers.
  const top = scripts.filter((rel) => rel.split("/").length === 2)
  const unmentioned = top.filter((rel) => !text.includes(rel))
  // A script under another skill's folder (`~/.agents/skills/<other>/scripts/…`) belongs to that skill.
  const mentioned = [...new Set([...text.matchAll(/(?:\bskills\/([\w.-]+)\/)?\bscripts\/[\w./-]*\w/g)]
    .filter((match) => !match[1] || match[1] === name).map((match) => match[0].replace(/^skills\/[\w.-]+\//, "")))]
  const absent = mentioned.filter((rel) => !files.includes(rel) && !existsSync(join(dir, rel)))
  add("scripts-referenced", !unmentioned.length && !absent.length,
    [unmentioned.length && format(m["skill-unmentioned"], { files: unmentioned.join(", ") }), absent.length && format(m["skill-absent"], { files: absent.join(", ") })].filter(Boolean).join(" ") || m["skill-referenced-ok"],
    { required: true })

  const broken = scripts.map((rel) => [rel, syntaxError(SCRIPT_TYPES[extname(rel)], join(dir, rel))]).filter(([, error]) => error)
  add("syntax", !broken.length, broken.map(([rel, error]) => `${rel}: ${error}`).join(" ") || m["skill-syntax-ok"], { required: true })

  const judged = checkScript && !broken.some(([rel]) => rel === checkScript)
    ? judgeCases(SCRIPT_TYPES[extname(checkScript)], join(dir, checkScript), join(dir, CASES_FILE), cwd, m) : m["skill-check-missing"]
  const timedOut = typeof judged === "object" ? judged.timedOut ?? [] : []
  const infrastructure = typeof judged === "object" ? judged.infrastructure ?? [] : []
  const heldCases = [timedOut.length ? format(m["skill-cases-timeout"], { names: timedOut.join(", "), seconds: CASE_TIMEOUT() / 1000 }) : null,
    infrastructure.length ? format(m["skill-cases-infrastructure"], { names: infrastructure.join(", ") }) : null].filter(Boolean)
  add("cases", typeof judged === "object" && !heldCases.length, heldCases.length
    ? heldCases.join(" ")
    : typeof judged === "object" ? format(m["skill-cases-ok"], judged) : judged, { required: true })
  if (timedOut.length) checks.at(-1).timedOut = timedOut
  if (infrastructure.length) checks.at(-1).infrastructure = infrastructure
  // A skill with no recorded mistake is linted as before: the check is not there at all.
  if (mistakes.length) {
    const lost = lostCases(dir, mistakes)
    add("mistakes", !lost.length, lost.length ? format(m["skill-mistakes-lost"], { names: lost.map((item) => `“${item}”`).join(", ") })
      : format(m["skill-mistakes-ok"], { n: mistakes.length }), { required: true })
    checks.at(-1).lost = lost
  }

  // Every text the skill carries, wherever it is in the folder; what an installer adds is not the skill's.
  const contents = [{ file: "SKILL.md", text }, ...filesBelow(dir).filter((rel) => rel !== "SKILL.md" && !INSTALLED.has(rel)
    && (SCRIPT_TYPES[extname(rel)] || /\.(?:md|txt|json|ya?ml)$/.test(rel))).map((rel) => ({ file: rel, text: readFileSync(join(dir, rel), "utf8") }))]
  const unfinished = contents.filter((item) => item.text.includes(PLACEHOLDER)).map((item) => item.file)
  add("filled", !unfinished.length, unfinished.length ? format(m["skill-unfilled"], { marker: PLACEHOLDER, files: unfinished.join(", ") }) : m["skill-filled-ok"], { required: true })
  const specific = contents.filter((item) => TOOL_SPECIFIC.some((rule) => rule.test(item.text))).map((item) => item.file)
  add("neutral", !specific.length, specific.length ? format(m["skill-specific"], { files: specific.join(", ") }) : m["skill-neutral-ok"], { required: true })
  const secret = contents.filter((item) => SECRETS.some((rule) => rule.test(item.text))).map((item) => item.file)
  add("secrets", !secret.length, secret.length ? format(m["skill-secret"], { files: secret.join(", ") }) : m["skill-secret-ok"], { required: true })
  if (copied) {
    const passages = copied(contents)
    if (passages) add("own-words", !passages.length, passages.length
      ? format(m["skill-copied"], { passages: passages.slice(0, 5).map((item) => `${item.file}: “${item.passage}”`).join("; ") })
      : m["skill-own-words-ok"], { required: true })
  }

  const blocks = [...(skill?.body ?? "").matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1])
  const runs = Boolean(checkScript) && blocks.some((block) => block.includes(checkScript))
  add("runs-check", runs, runs ? m["skill-runs-check-ok"] : m["skill-runs-check-missing"])
  add("triggers", TRIGGERS.test(description), TRIGGERS.test(description) ? m["skill-triggers-ok"] : m["skill-triggers-missing"])
  const silent = top.filter((rel) => !/^\s*(?:\/\/|#|\/\*|\*|""")\s*.*(?:\busage\b|사용법)/im.test(readFileSync(join(dir, rel), "utf8").split("\n").slice(0, 15).join("\n")))
  add("usage", !silent.length, silent.length ? format(m["skill-usage-missing"], { files: silent.join(", ") }) : m["skill-usage-ok"])
  const home = homedir()
  const local = contents.filter((item) => item.text.includes(`${home}/`)).map((item) => item.file)
  add("portable", !local.length, local.length ? format(m["skill-local"], { files: local.join(", ") }) : m["skill-portable-ok"])
  const lines = text.split("\n").length
  const body = (skill?.body ?? "").split("\n").filter((line) => line.trim()).length
  add("size", lines <= 500 && body >= 5, lines > 500 ? format(m["skill-size-long"], { n: lines }) : body < 5 ? m["skill-size-short"] : m["skill-size-ok"])

  const ok = checks.every((item) => !item.required || item.ok)
  const held = !ok && checks.some((item) => item.timedOut || item.infrastructure) && checks.every((item) => !item.required || item.ok || item.timedOut || item.infrastructure)
  return { name, path: dir, ok, held, score: checks.reduce((sum, item) => sum + item.points, 0), checks }
}
