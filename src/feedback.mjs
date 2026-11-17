// Prepare an issue on this machine; this module never opens a URL or sends a report.
import { homedir, userInfo } from "node:os"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { diagnosticRecords } from "./records.mjs"
import { COMMAND_STEPS, startReport } from "./start.mjs"
import { LOCALES } from "./labels.mjs"

const engineVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version
const strings = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []

/** private: [values] and nested { private: true, ...values } keep those strings out of reports. */
export function privateValues(config) {
  if (!config || typeof config !== "object") return []
  return [...new Set(Object.entries(config).flatMap(([key, value]) => key === "private" ? strings(value)
    : value && typeof value === "object" && value.private === true ? strings(value) : privateValues(value)))]
}

const PUBLIC_HOST = /^(?:github\.com|(?:[a-z\d-]+\.)*npmjs\.com)$/i

// File names the engine and its owners use, and Node.js, look like hosts but name nothing private.
const KEPT_NAME = /(?:\.(?:md|mdx|mjs|js|json|yml|yaml|edn|html|css)|^node\.js)$/i

export function sanitizeDiagnostic(text, { home = homedir(), username, paths: extraPaths = [], private: secrets = [], toLineEnd = false } = {}) {
  if (username === undefined) { try { username = userInfo().username } catch { username = basename(home) } }
  let clean = String(text)
  const paths = [home, ...extraPaths].filter(Boolean).flatMap((path) => {
    let real = path
    try { real = realpathSync(path) } catch {}
    return [path, real].flatMap((value) => [value, value.replaceAll("\\", "/"), value.replaceAll("/", "\\")])
  })
  const words = [...secrets, ...paths].filter((word) => typeof word === "string" && word).sort((a, b) => b.length - a.length)
  for (const word of words) clean = clean.split(word).join("[redacted]")
  // A domain needs an alphabetic top level (or be localhost), so package@0.7.0 stays readable.
  clean = clean.replace(/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@(?:(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}|localhost)(?![\p{L}\p{N}-])/giu, "[redacted-email]")
  if (username) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    clean = clean.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu"), "[redacted-user]")
  }
  const urls = []
  clean = clean.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi, (link) => {
    try {
      const url = new URL(link)
      if (!PUBLIC_HOST.test(url.hostname) || !["http:", "https:"].includes(url.protocol)) return "[redacted-url]"
      url.username = ""; url.password = ""; url.search = ""; url.hash = ""
      urls.push(url.href)
      return `\uE000${urls.length - 1}\uE001`
    } catch { return "[redacted-url]" }
  })
  // Any other path goes to the end of the line only in free-form details; a title or message keeps its sentence.
  if (toLineEnd) {
    clean = clean.replace(/\b[A-Za-z]:[\\/][^\r\n<>"`|]*/g, "[redacted-path]")
    clean = clean.replace(/(?<![\w])\/(?![\s/])[^\r\n<>"`|]*/g, "[redacted-path]")
  }
  // Every text loses drive paths and absolute paths of two or more levels, up to the next space.
  clean = clean.replace(/\b[A-Za-z]:[\\/][^\s<>"`|]*/g, "[redacted-path]")
  clean = clean.replace(/(?<![\w:/])\/[^\s/<>"`|]+(?:\/[^\s<>"`|]*)+/g, "[redacted-path]")
  clean = clean.replace(/\uE000(\d+)\uE001/g, (_, index) => urls[Number(index)] ?? "[redacted-url]")
  clean = clean.replace(/\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}(?::\d+)?/gi,
    (host) => PUBLIC_HOST.test(host) || KEPT_NAME.test(host.replace(/:\d+$/, "")) ? host : "[redacted-host]")
  clean = clean.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[redacted-ip]")
  clean = clean.replace(/\[[a-f\d:.%]+\](?::\d+)?/gi, "[redacted-ip]")
  // Times such as 09:00:00 have neither "::" nor a hex letter, so they stay.
  clean = clean.replace(/(?<![\w])(?:[a-f\d]{0,4}:){2,}[a-f\d:.]*(?:%[a-z\d]+)?/gi, (text) => /::|[a-f]/i.test(text) ? "[redacted-ip]" : text)
  // Avoid terminal escapes, hidden controls, and a log line closing the diagnostic's code fence.
  return clean.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replaceAll("```", "'''")
}

/** Limit the encoded URL, by Unicode code point, so truncation cannot split UTF-8 escapes. */
export function issueLink(title, body, { limit = 7500 } = {}) {
  const base = "https://github.com/cudoment/excudo/issues/new?"
  const make = (text) => base + new URLSearchParams({ title, body: text })
  if (make(body).length <= limit) return make(body)
  const points = [...body]
  let low = 0, high = points.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (make(points.slice(0, mid).join("") + "\n[truncated]").length <= limit) low = mid
    else high = mid - 1
  }
  return make(points.slice(0, low).join("") + "\n[truncated]")
}

// Only these engine identifiers and known error codes leave the machine by default.
const RUN_IDS = new Set([...Object.keys(COMMAND_STEPS), "reflect", "cleanup", "site-pull", "skills-upkeep"])
const ERROR_CODES = new Set(["ENOENT", "EACCES", "EPERM", "ENOSPC", "EIO", "EINVAL", "EEXIST", "ENOTFOUND", "ECONNREFUSED",
  "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "E401", "E403", "E404", "ETARGET", "EINTEGRITY",
  "ERR_MODULE_NOT_FOUND", "ERR_INVALID_ARG_TYPE", "ERR_UNKNOWN_FILE_EXTENSION"])
export const diagnosticErrorCodes = (text) => [...new Set(String(text ?? "").match(/\b(?:E[A-Z_\d]+|ERR_[A-Z_]+)\b/g) ?? [])].filter((code) => ERROR_CODES.has(code))

export function feedbackDraft(ws, { title, message = "", out, details = false, identity = {} } = {}) {
  const words = (LOCALES[ws.locale] ?? LOCALES.en).feedback
  const sanitize = (value, toLineEnd = false) => sanitizeDiagnostic(value, { ...identity, toLineEnd, paths: [ws.root, ws.graphDir, ...(identity.paths ?? [])], private: privateValues(ws) })
  const reportTitle = [...sanitize(title || words.defaultTitle).replace(/\s+/g, " ")].slice(0, 120).join("")
  const start = startReport(ws)
  let recorded
  try { recorded = diagnosticRecords(ws) } catch { recorded = { checks: [], runs: [], unavailable: true } }
  const diagnostic = {
    engine: engineVersion, node: process.version, platform: `${process.platform} ${process.arch}`,
    start: start.steps.map(({ id, state }) => ({ id, state })),
    checks: recorded.checks.length ? ["skill-check"] : [],
    runs: recorded.runs.map((run) => ({ step: RUN_IDS.has(run.step) ? run.step : "custom-step",
      status: ["ok", "failed", "deferred", "paused"].includes(run.status) ? run.status : "unknown", codes: diagnosticErrorCodes(run.detail) })),
    ...(start.configurationError ? { configurationError: start.configurationError } : {}),
  }
  const lines = [
    `Excudo: ${diagnostic.engine}`, `Node: ${diagnostic.node}`, `Platform: ${diagnostic.platform}`, "",
    `${words.start}:`, ...diagnostic.start.map((step) => `${step.id}: ${step.state === "unknown" ? words.unknown : step.state === "done" ? words.done : words.notDone}${step.id === start.next ? ` (${words.stopped})` : ""}`), "",
    `${words.checks}:`, ...(diagnostic.checks.length ? diagnostic.checks : [words.none]), "",
    `${words.runs}:`, ...(diagnostic.runs.length ? diagnostic.runs.map((run) => `${run.step} ${run.status}${run.codes.length ? `: ${run.codes.join(", ")}` : ""}`) : [words.none]),
    ...(start.configurationError ? [`${words.configFailed}: ${start.configurationError.code}`] : []),
    ...(recorded.unavailable ? [words.unavailable] : []),
  ]
  if (details) lines.push("", words.reviewDetails, ...recorded.checks.map((value) => sanitize(value, true)), ...recorded.runs.map((run) =>
    sanitize(`${run.step}: ${run.detail ?? ""}`, true).split("\n").slice(-3).join(" / ").slice(-480)),
    ...(ws.configurationFailure ? [sanitize(ws.configurationFailure.detail, true)] : []))
  const intro = sanitize(message).trim()
  const body = `${intro ? intro + "\n\n" : ""}## ${words.diagnostics}\n\n\`\`\`text\n${lines.join("\n")}\n\`\`\``
  const draft = `# ${reportTitle}\n\n${body}\n`
  if (out) writeFileSync(resolve(ws.root, out), draft)
  return { title: reportTitle, body, draft, url: issueLink(reportTitle, body), diagnostic, details: Boolean(details) }
}
