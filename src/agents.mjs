// Local role preferences only: no model discovery request or API credential is used here.
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { parse } from "acorn"
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { writeAtomic, withLock } from "./files.mjs"

// Keep this ordered catalog current by editing it, its tests and both READMEs together.
// Order estimates provider rank; it is not a measured comparison of model quality.
export const CLAUDE_MODELS = [
  ["claude-fable-5-2", "Fable 5.2"], ["claude-opus-5-5", "Opus 5.5"],
  ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"],
].map(([slug, display_name]) => ({ slug, display_name, efforts: ["low", "medium", "high", "xhigh", "max"], upgrade: null }))
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)
const readJson = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback
const present = (value) => typeof value === "string" && value.trim() !== ""
const object = (value) => value && typeof value === "object" && !Array.isArray(value)
const stateFile = (ws) => join(ws.cacheDir, "agents.json")
const words = (ws) => ws.labels.agents
const fail = (ws, key, detail = "") => new Error(`${words(ws)[key]}${detail ? `: ${detail}` : ""}`)
const installed = (tool) => (process.env.PATH ?? "").split(delimiter).some((dir) => {
  try { accessSync(join(dir, tool), constants.X_OK); return true } catch { return false }
})

/** Local catalogs and Codex root-level TOML defaults. A missing cache is an empty catalog. */
export function agentCatalogs({ home = homedir(), codexDir = process.env.CODEX_HOME || join(home, ".codex") } = {}) {
  const cache = readJson(join(codexDir, "models_cache.json"), {})
  const codex = (Array.isArray(cache.models) ? cache.models : []).filter((model) => model.visibility === "list" && present(model.slug))
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
    .map((model) => ({ slug: model.slug, display_name: model.display_name ?? model.slug,
      efforts: (model.supported_reasoning_levels ?? []).map((level) => level.effort), upgrade: model.upgrade ?? null }))
  let defaults = {}
  const file = join(codexDir, "config.toml")
  if (existsSync(file)) {
    // Only root keys count. Profile and provider tables do not override these defaults here.
    const root = readFileSync(file, "utf8").split(/^\s*\[/m)[0]
    for (const [key, field] of [["model", "model"], ["model_reasoning_effort", "effort"]]) {
      const match = root.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*(?:#.*)?$`, "m"))
      if (match) defaults[field] = match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1)
    }
  }
  return { codex: { models: codex, defaults, installed: installed("codex") },
    claude: { models: CLAUDE_MODELS, defaults: {}, installed: installed("claude") } }
}

/** Settings validation also feeds check and the setup skill. Missing models remain usable. */
export function validateAgents(ws, catalogs = agentCatalogs()) {
  const issues = []
  const report = (key, detail) => issues.push(fail(ws, key, detail).message)
  const settings = ws.agents
  if (settings === undefined) return issues
  if (!object(settings)) return [fail(ws, "invalid", "agents").message]
  if (settings.suggest !== undefined && typeof settings.suggest !== "boolean") report("invalid", "agents.suggest")
  if (settings.reviewers !== undefined && !Array.isArray(settings.reviewers)) report("invalid", "agents.reviewers")
  const roles = [["worker", settings.worker], ...(Array.isArray(settings.reviewers) ? settings.reviewers.map((role, i) => [`reviewers[${i}]`, role]) : [])]
  for (const [name, role] of roles) {
    if (role === undefined && name === "worker") continue
    if (!object(role)) { report("invalid", name); continue }
    if (!["codex", "claude"].includes(role.tool)) { report("toolInvalid", `${name}: ${role.tool}`); continue }
    for (const field of ["model", "effort"]) if (role[field] != null && typeof role[field] !== "string") report("invalid", `${name}.${field}`)
    const model = catalogs[role.tool].models.find((model) => model.slug === (present(role.model) ? role.model : catalogs[role.tool].defaults.model))
    const effort = present(role.effort) ? role.effort : catalogs[role.tool].defaults.effort
    const supported = model?.efforts ?? (role.tool === "claude" ? CLAUDE_MODELS[0].efforts : ["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    if (present(effort) && !supported.includes(effort)) report("effortInvalid", `${name}: ${role.model ?? ""} / ${effort} (${supported.join(", ")})`)
  }
  return issues
}

const entries = (ws) => [{ role: "worker", index: null, setting: ws.agents?.worker },
  ...(Array.isArray(ws.agents?.reviewers) ? ws.agents.reviewers.map((setting, index) => ({ role: "reviewer", index, setting })) : [{ role: "reviewer", index: 0, setting: undefined }])]
const roleKey = ({ role, index }) => role === "worker" ? "worker" : `reviewer:${index}`
function roleStatus(entry, catalogs) {
  const setting = entry.setting
  const provider = catalogs[setting?.tool]
  const resolve = (field) => present(setting?.[field]) ? { value: setting[field], source: "config" }
    : setting ? { value: provider?.defaults[field] ?? null, source: "tool-default" } : { value: null, source: "unset" }
  const model = resolve("model"), effort = resolve("effort")
  const rank = provider?.models.findIndex((item) => item.slug === model.value) ?? -1
  return { role: entry.role, index: entry.index, tool: { value: setting?.tool ?? null, source: setting ? "config" : "unset" },
    model, effort, rank: rank < 0 ? null : rank + 1, top: rank === 0, rankEstimated: true, userSelectedTop: rank === 0 && model.source === "config" }
}

/** Recommendations never fall back to the first model, including in a one-model catalog. */
export function agentRecommendations(catalogs, workerTool = "codex") {
  const recommend = (tool, effort) => {
    const model = catalogs[tool].models[1]
    return { tool, model: model?.slug ?? null, effort: model?.efforts.includes(effort) ? effort : null }
  }
  const tool = catalogs[workerTool] ? workerTool : "codex"
  return { worker: recommend(tool, "high"), reviewers: [recommend(tool === "codex" ? "claude" : "codex", "xhigh")] }
}

function observe(ws, catalogs) {
  const file = stateFile(ws)
  return withLock(file, () => {
    const state = readJson(file, { version: 1, suggestions: {}, roles: {} })
    const snapshot = Object.fromEntries(Object.entries(catalogs).map(([tool, catalog]) => [tool, catalog.models.map((model) => model.slug)]))
    if (!state.firstFingerprint) { state.firstFingerprint = hash(snapshot); state.firstModels = snapshot }
    state.roles ??= {}
    state.suggestions ??= {}
    for (const entry of entries(ws)) {
      const { setting } = entry
      if (!setting || !present(setting.model) || !catalogs[setting.tool]) continue
      const list = catalogs[setting.tool].models
      const current = list.findIndex((model) => model.slug === setting.model)
      const key = `${roleKey(entry)}:${setting.tool}:${setting.model}`
      state.roles[key] = { top: Boolean(state.roles[key]?.top || current === 0) }
      if (ws.agents?.suggest === false) continue
      const allowedTop = state.roles[key].top
      const eligible = list.filter((_, index) => allowedTop || index > 0)
      const upgrades = list[current]?.upgrade
      const upgrade = typeof upgrades === "string" ? upgrades : upgrades?.model ?? upgrades?.slug
      let candidate, reason
      if (current < 0) { candidate = eligible[0]; reason = "missing" }
      else if (upgrades) {
        candidate = eligible.find((model) => model.slug === upgrade && model.slug !== setting.model)
          ?? eligible.find((model) => list.indexOf(model) < current)
        reason = "upgrade"
      } else {
        candidate = eligible.find((model) => list.indexOf(model) < current && !(state.firstModels[setting.tool] ?? []).includes(model.slug))
        reason = "new"
      }
      if (!candidate) continue
      const id = hash([roleKey(entry), setting.tool, setting.model, candidate.slug])
      state.suggestions[id] ??= { id, role: entry.role, index: entry.index, tool: setting.tool, from: setting.model, model: candidate.slug,
        effort: candidate.efforts.includes(setting.effort) ? setting.effort : candidate.efforts.includes(entry.role === "worker" ? "high" : "xhigh") ? (entry.role === "worker" ? "high" : "xhigh") : "",
        reason, firstSeen: new Date().toISOString(), status: "pending", notifiedAt: null }
    }
    state.fingerprint = hash(snapshot)
    const active = Object.values(state.suggestions).filter((suggestion) => suggestion.status === "pending" && ws.agents?.suggest !== false
      && entries(ws).some((entry) => roleKey(entry) === roleKey(suggestion) && entry.setting?.tool === suggestion.tool && entry.setting?.model === suggestion.from)
      && catalogs[suggestion.tool].models.some((model, index) => model.slug === suggestion.model && (index > 0 || state.roles[`${roleKey(suggestion)}:${suggestion.tool}:${suggestion.from}`]?.top)))
    mkdirSync(ws.cacheDir, { recursive: true })
    writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
    return { state, active }
  }, words(ws).locked)
}

export function agentsStatus(ws, options) {
  const catalogs = agentCatalogs(options)
  const issues = validateAgents(ws, catalogs)
  if (issues.length) throw new Error(issues.join("\n"))
  const { active } = observe(ws, catalogs)
  return { roles: entries(ws).map((entry) => roleStatus(entry, catalogs)), catalogs,
    recommendations: agentRecommendations(catalogs, ws.agents?.worker?.tool), suggestions: active, rankEstimated: true }
}

export function agentSuggestions(ws, { fresh = false, ...options } = {}) {
  const status = agentsStatus(ws, options)
  if (!fresh) return status.suggestions
  const file = stateFile(ws)
  return withLock(file, () => {
    const state = readJson(file, {})
    const result = status.suggestions.filter((item) => !state.suggestions[item.id].notifiedAt)
    for (const item of result) state.suggestions[item.id].notifiedAt = item.notifiedAt = new Date().toISOString()
    writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
    return result
  }, words(ws).locked)
}

const indexOf = (ws, role, index = 0) => {
  if (!["worker", "reviewer"].includes(role) || !Number.isInteger(index) || index < 0 || (role === "worker" && index !== 0)) throw fail(ws, "roleInvalid")
  return role === "worker" ? null : index
}
const shell = (value) => /^[a-zA-Z0-9_.=:/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
export function agentArgs(ws, role, { index = 0, target = "orca", ...options } = {}) {
  const selected = indexOf(ws, role, index)
  if (!["orca", "cli"].includes(target)) throw fail(ws, "targetInvalid")
  const status = agentsStatus(ws, options)
  const entry = entries(ws).find((entry) => entry.role === role && entry.index === selected)
  if (!entry?.setting) throw fail(ws, "unset")
  const { tool, model, effort } = entry.setting
  // Emit only explicit values; an inherited value must continue following the tool's defaults.
  const args = target === "orca" ? ["--agent", tool] : []
  if (present(model)) args.push(target === "cli" && tool === "codex" ? "-m" : "--model", model)
  if (present(effort)) args.push(...(target === "cli" && tool === "codex" ? ["-c", `model_reasoning_effort=${effort}`] : ["--effort", effort]))
  return { args: args.map(shell).join(" "), suggestions: status.suggestions.filter((item) => item.role === role && item.index === selected) }
}

// A real JavaScript parser locates the exported object without interpreting other settings.
// Only literal agents data is migrated; later writes replace the managed comment region alone.
const AGENTS_START = "// excudo:agents start"
const AGENTS_END = "// excudo:agents end"
const propertyName = (property) => property.type === "Property" && (!property.computed || property.key.type === "Literal")
  ? property.key.type === "Identifier" ? property.key.name : property.key.value : undefined
function literalValue(node) {
  if (node.type === "Literal" && (node.value === null || ["string", "number", "boolean"].includes(typeof node.value))) return node.value
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number") return -node.argument.value
  if (node.type === "ArrayExpression") return node.elements.map((item) => {
    if (!item) throw new Error("literal value required")
    return literalValue(item)
  })
  if (node.type === "ObjectExpression") {
    const value = {}
    for (const property of node.properties) {
      const key = propertyName(property)
      if (typeof key !== "string" || property.computed || property.method || property.shorthand || property.kind !== "init" || key === "__proto__" || Object.hasOwn(value, key)) throw new Error("plain unique keys required")
      value[key] = literalValue(property.value)
    }
    return value
  }
  throw new Error("literal agents required")
}

function agentsRegion(text) {
  const declarations = [...text.matchAll(/^export[ \t]+default[ \t]+\{/gm)]
  if (declarations.length !== 1) throw new Error("one line-start export default object required")
  const tokens = [], comments = []
  const ast = parse(text, { ecmaVersion: "latest", sourceType: "module", onToken: tokens, onComment: comments })
  const exported = ast.body.find((node) => node.type === "ExportDefaultDeclaration")
  if (exported?.start !== declarations[0].index || exported.declaration.type !== "ObjectExpression") throw new Error("direct export required")
  const body = exported.declaration
  const fields = body.properties.filter((property) => propertyName(property) === "agents")
  if (fields.length > 1) throw new Error("duplicate agents keys")
  const field = fields[0]
  if (field && (field.method || field.kind !== "init" || field.shorthand)) throw new Error("literal agents required")
  const value = field ? literalValue(field.value) : {}
  if (!object(value)) throw new Error("literal agents object required")
  const start = [...text.matchAll(/^[ \t]*\/\/ excudo:agents start[ \t]*(?:\r?\n|$)/gm)]
  const end = [...text.matchAll(/^[ \t]*\/\/ excudo:agents end[ \t]*(?:\r?\n|$)/gm)]
  if (start.length || end.length) {
    if (start.length !== 1 || end.length !== 1 || start[0].index >= end[0].index) throw new Error("invalid agents markers")
    const first = start[0], last = end[0]
    const isComment = (match) => comments.some((comment) => comment.type === "Line" && comment.start === match.index + match[0].indexOf("//"))
    if (!isComment(first) || !isComment(last) || !/^\s*$/.test(text.slice(body.start + 1, first.index))
      || !field || field.start < first.index + first[0].length || field.end > last.index
      || body.properties.some((property) => property !== field && property.start < last.index)) throw new Error("agents markers must enclose only the first agents property")
    // Nothing except one literal property, its comma and comments may hide in the region.
    const inside = tokens.filter((token) => token.start >= first.index && token.end <= last.index && token.type.label !== "eof")
    if (inside[0]?.start !== field.start || inside.at(-1)?.type.label !== "," || inside.at(-2)?.end !== field.end) throw new Error("invalid managed agents property")
    return { value, start: first.index, end: last.index + last[0].length, insert: false }
  }
  let remove
  if (field) {
    const following = tokens.find((token) => token.start >= field.end)
    remove = { start: field.start, end: following?.type.label === "," ? following.end : field.end }
  }
  const afterBrace = body.start + 1
  const newline = text.slice(afterBrace).match(/^[ \t]*\r?\n/)
  return { value, start: afterBrace + (newline?.[0].length ?? 0), insert: true, needsNewline: !newline, remove }
}

const VERIFY_AGENTS = `
import { isDeepStrictEqual } from "node:util"
const settings = (await import(process.argv[1])).default
if (!isDeepStrictEqual(settings?.agents, JSON.parse(process.argv[2]))) process.exitCode = 1
`

/** Replace only managed agents data, then import the actual file and roll back a failed edit. */
export function editAgentsConfig(ws, update) {
  const file = join(ws.root, "excudo.config.mjs")
  return withLock(file, () => {
    const original = readFileSync(file)
    const text = original.toString("utf8")
    let value, replacement
    const unsafe = (error) => {
      let manual = value
      if (manual === undefined) try { manual = update(ws.agents ?? {}) } catch {}
      return fail(ws, "editUnsafe", `${error.message}\n${words(ws).manual}\n${JSON.stringify(manual ?? ws.agents ?? {}, null, 2)}`)
    }
    try {
      const region = agentsRegion(text)
      value = update(region.value)
      const errors = validateAgents({ ...ws, agents: value })
      if (errors.length) throw new Error(errors.join("\n"))
      const newline = text.includes("\r\n") ? "\r\n" : "\n"
      const encoded = JSON.stringify(value, null, 2).replaceAll("\n", `${newline}  `)
      const managed = `${region.needsNewline ? newline : ""}  ${AGENTS_START}${newline}  agents: ${encoded},${newline}  ${AGENTS_END}${newline}`
      replacement = text
      // Remove an old literal property first: it lies after the insertion point.
      if (region.remove) replacement = replacement.slice(0, region.remove.start) + replacement.slice(region.remove.end)
      replacement = replacement.slice(0, region.start) + managed + replacement.slice(region.insert ? region.start : region.end)
    } catch (error) { throw unsafe(error) }
    if (!readFileSync(file).equals(original)) throw fail(ws, "editUnsafe")
    writeAtomic(file, replacement)
    try {
      // A fresh process imports relative dependencies normally, without stale module-cache entries.
      const verified = spawnSync(process.execPath, ["--input-type=module", "-e", VERIFY_AGENTS, pathToFileURL(file).href, JSON.stringify(value)],
        { cwd: ws.root, encoding: "utf8", timeout: 30000 })
      if (verified.status !== 0) throw fail(ws, "verifyFailed")
      if (readFileSync(file, "utf8") !== replacement) throw fail(ws, "verifyFailed")
    } catch (error) {
      // Preserve an owner's concurrent edit; the lock coordinates engine writers only.
      if (readFileSync(file, "utf8") === replacement) writeAtomic(file, original)
      throw unsafe(error)
    }
    return replacement
  }, words(ws).locked)
}

export function setAgent(ws, role, setting, { index = 0 } = {}) {
  const selected = indexOf(ws, role, index)
  return editAgentsConfig(ws, (agents) => {
    if (role === "worker") return { ...agents, worker: setting }
    const reviewers = [...(agents.reviewers ?? [])]
    if (selected > reviewers.length) throw fail(ws, "roleInvalid")
    reviewers[selected] = setting
    return { ...agents, reviewers }
  })
}

export function decideAgentSuggestion(ws, id, decision, options) {
  if (!["accepted", "declined"].includes(decision)) throw fail(ws, "invalid", decision)
  const { suggestions } = agentsStatus(ws, options)
  const suggestion = suggestions.find((item) => item.id === id)
  if (!suggestion) throw fail(ws, "suggestionInvalid", id)
  const file = stateFile(ws)
  withLock(file, () => {
    const state = readJson(file, {})
    if (state.suggestions[id]?.status !== "pending") throw fail(ws, "suggestionInvalid", id)
    if (decision === "accepted") {
      // Check the source again under the config lock; the owner may have changed it already.
      editAgentsConfig(ws, (agents) => {
        const setting = suggestion.role === "worker" ? agents.worker : agents.reviewers?.[suggestion.index]
        if (setting?.tool !== suggestion.tool || setting?.model !== suggestion.from) throw fail(ws, "suggestionInvalid", id)
        const next = { ...setting, model: suggestion.model, effort: suggestion.effort }
        if (suggestion.role === "worker") return { ...agents, worker: next }
        const reviewers = [...agents.reviewers]; reviewers[suggestion.index] = next
        return { ...agents, reviewers }
      })
    }
    Object.assign(state.suggestions[id], { status: decision, decidedAt: new Date().toISOString() })
    writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
  }, words(ws).locked)
  return suggestion
}
