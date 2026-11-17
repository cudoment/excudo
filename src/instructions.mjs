// Budget reports and verbatim moves from session rules into workspace skills.
// Byte counts and line ranges always refer to the original file, including its line endings.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { writeAtomic } from "./files.mjs"
import { DEFAULTS } from "./workspace.mjs"
import { format } from "./labels.mjs"
import { skillNames } from "./skills.mjs"
import { templateRules, rulesAgainstTemplate } from "./skillkit.mjs"

export const INSTRUCTIONS_THRESHOLD = 512
export const INSTRUCTIONS_KEEP = "<!-- excudo: keep -->"
const flat = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim()
const title = (text) => text.replace(/\s+#+\s*$/, "").replace(/[`*_]/g, "").trim().normalize("NFC")

function settingsOf(ws, override) {
  const given = ws.instructions === undefined ? DEFAULTS.instructions : ws.instructions
  const validLimit = (n) => Number.isSafeInteger(n) && n > 0
  if (given !== false && (!given || typeof given !== "object" || Array.isArray(given)))
    throw new Error(ws.labels.messages["instructions-setting-invalid"])
  const settings = { ...DEFAULTS.instructions, ...(given === false ? { limit: false } : given) }
  if ((settings.limit !== false && !validLimit(settings.limit)) || !Array.isArray(settings.keep)
    || settings.keep.some((heading) => typeof heading !== "string" || !heading.trim())
    || typeof settings.auto !== "boolean")
    throw new Error(ws.labels.messages["instructions-setting-invalid"])
  if (override !== undefined) {
    const n = typeof override === "string" && /^\d+$/.test(override) ? Number(override) : override
    if (!validLimit(n)) throw new Error(ws.labels.messages["limit-invalid"])
    settings.limit = n
    if (settings.target >= n) settings.target = null
  }
  settings.target = settings.limit === false ? false : settings.target ?? Math.floor(settings.limit * 0.85)
  if (settings.target !== false && (!Number.isSafeInteger(settings.target) || settings.target < 0 || settings.target >= settings.limit))
    throw new Error(ws.labels.messages["instructions-setting-invalid"])
  if (settings.limit !== false && settings.target === false) throw new Error(ws.labels.messages["instructions-setting-invalid"])
  return { ...settings, keep: settings.keep.map((heading) => heading.trim().normalize("NFC")) }
}

/** Size and protected bytes, without skill scanning or writes. --limit overrides a disabled budget. */
export function instructionsSize(ws, { limit } = {}) {
  const settings = settingsOf(ws, limit)
  const path = join(ws.root, "AGENTS.md")
  const exists = existsSync(path)
  const bytes = exists ? statSync(path).size : 0
  const protectedSize = protectedBudget(ws, exists ? readFileSync(path, "utf8") : "", settings)
  return { file: "AGENTS.md", exists, enabled: settings.limit !== false, bytes, limit: settings.limit, target: settings.target, auto: settings.auto,
    ...protectedSize, targetBlocked: exists && bytes > 0 && settings.target !== false && protectedSize.pinned >= settings.target,
    aboveTarget: settings.target !== false && bytes > settings.target, over: settings.limit !== false && bytes > settings.limit }
}

// Only actual Markdown headings and top-level items count: fences and comments hide their contents.
function structure(text, keep) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const visible = [], headings = [], stack = []
  let fence, comment = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r?\n$/, "")
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    visible[i] = !fence && !comment
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined
      continue
    }
    if (comment) { if (line.includes("-->")) comment = false; continue }
    if (mark) { fence = mark[1]; visible[i] = false; continue }
    if (line.includes("<!--")) {
      visible[i] = false
      comment = !line.slice(line.indexOf("<!--") + 4).includes("-->")
      continue
    }
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!match) continue
    const depth = match[1].length, name = title(match[2])
    while (stack.length && stack.at(-1).depth >= depth) stack.pop()
    const path = [...stack.map((heading) => heading.name), name]
    const marked = lines[i - 1]?.trim() === INSTRUCTIONS_KEEP
    const pinned = keep.includes(name) || keep.includes(path.join(" > ")) || marked
    const heading = { start: i, end: lines.length, depth, name, headingPath: path, pinned, pinStart: marked ? i - 1 : i }
    headings.push(heading)
    stack.push(heading)
  }
  for (let i = 0; i < headings.length; i++) {
    headings[i].end = headings.slice(i + 1).find((next) => next.depth <= headings[i].depth)?.pinStart ?? lines.length
  }
  const items = []
  for (let i = 0; i < lines.length; i++) {
    if (!visible[i] || !/^(?:[-+*]|\d+[.)])\s+\S/.test(lines[i])) continue
    let end = i + 1
    while (end < lines.length && (!lines[end].trim() || /^\s+\S/.test(lines[end]))) end++
    const parent = headings.findLast((heading) => heading.start < i && heading.end > i)
    const marked = lines[i - 1]?.trim() === INSTRUCTIONS_KEEP
    items.push({ kind: "item", start: i, end, headingPath: parent?.headingPath ?? [], pinned: marked, pinStart: marked ? i - 1 : i })
  }
  return { lines, visible, headings, items }
}

function protectedBudget(ws, text, settings) {
  const { lines, headings, items } = structure(text, settings.keep)
  const rules = templateRules(ws)
  const blocks = [...headings.filter((block) => block.pinned).map((block) => ({ ...block, kind: "section", start: block.pinStart })),
    ...items.filter((block) => block.pinned || containsRule(lines.slice(block.start, block.end).join(""), rules))
      .map((block) => ({ ...block, start: block.pinned ? block.pinStart : block.start }))]
  // Template rules written as paragraphs remain protected too, even without their list marker.
  for (let start = 0; start < lines.length; start++) {
    if (!lines[start].trim() || /^#|^(?:[-+*]|\d+[.)])\s/.test(lines[start])) continue
    let end = start + 1
    while (end < lines.length && lines[end].trim() && !/^#|^(?:[-+*]|\d+[.)])\s/.test(lines[end])) end++
    if (containsRule(lines.slice(start, end).join(""), rules)) blocks.push({ start, end, kind: "template", headingPath: [] })
    start = end - 1
  }
  const picked = [], covered = new Set()
  for (const block of blocks.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (Array.from({ length: block.end - block.start }, (_, i) => block.start + i).every((i) => covered.has(i))) continue
    for (let i = block.start; i < block.end; i++) covered.add(i)
    const first = lines[block.start + (lines[block.start]?.trim() === INSTRUCTIONS_KEEP ? 1 : 0)] ?? ""
    picked.push({ kind: block.kind, name: block.name ?? title(first.replace(/^(?:[-+*]|\d+[.)])\s+/, "")).slice(0, 100),
      headingPath: block.headingPath, startLine: block.start + 1, endLine: block.end, bytes: Buffer.byteLength(lines.slice(block.start, block.end).join("")) })
  }
  const pinned = [...covered].reduce((sum, i) => sum + Buffer.byteLength(lines[i]), 0)
  return { pinned, movable: Buffer.byteLength(text) - pinned, pinnedBlocks: picked.sort((a, b) => b.bytes - a.bytes || a.startLine - b.startLine) }
}

/** The warning is shared by reports, verification and scheduled checks. */
export function instructionsBlockedNotice(ws, report) {
  if (!report.targetBlocked) return ""
  const blocks = report.pinnedBlocks.slice(0, 3).map((block) => format(ws.labels.messages["instructions-pinned-block"], block)).join(", ")
  return format(ws.labels.messages["instructions-unreachable"], { ...report, blocks })
}

/** Pinned heading sections and list items, including nested lines, for preservation checks. */
export function pinnedInstructions(ws, text) {
  const { lines, headings, items } = structure(text, settingsOf(ws).keep)
  return [...headings, ...items].filter((heading) => heading.pinned).map((heading) => lines.slice(heading.pinStart, heading.end).join(""))
}

function inventory(ws) {
  const engine = new Set(skillNames()), own = new Set()
  const roots = [...new Set([resolve(ws.root, ws.skills?.dir ?? "skills"), join(ws.root, ".agents/skills")])]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!engine.has(entry) && existsSync(join(root, entry, "SKILL.md"))) own.add(entry)
    }
  }
  return { engine, own, dirs: [...new Set(["skills", ".agents/skills", ".claude/skills", ws.skills?.dir ?? "skills"])].map((dir) => dir.replaceAll("\\", "/").replace(/\/$/, "")) }
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function mentions(text, { engine, own, dirs }) {
  const counts = new Map(), engines = new Set()
  const count = (name) => {
    if (own.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1)
    else if (engine.has(name)) engines.add(name)
  }
  // Count a path once even when it is also inside backticks; plain backticked skill names count too.
  const paths = new RegExp(`(?:${dirs.map(escape).join("|")})/([a-z0-9]+(?:-[a-z0-9]+)*)(?=/|[\\s\x60]|$)`, "g")
  const remaining = text.replace(paths, (_, name) => { count(name); return " " })
  for (const match of remaining.matchAll(/`([^`\n]+)`/g)) count(match[1])
  return { counts, engines }
}

function proposedName(heading, used, line) {
  const base = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).replace(/-$/, "") || `workspace-procedure-${line}`
  let name = base, n = 1
  while (used.has(name)) name = `${base}-${++n}`
  return name
}

/** A read-only report, with nonoverlapping candidates largest first, never the instructions' text. */
export function instructions(ws, options = {}) {
  const size = instructionsSize(ws, options)
  const lastTrim = readTrim(ws)
  const report = { ...size, lastTrim, growth: lastTrim ? size.bytes - lastTrim.bytes : null, threshold: INSTRUCTIONS_THRESHOLD, candidates: [] }
  if (!size.enabled || !size.exists) return report
  const text = readFileSync(join(ws.root, size.file), "utf8")
  const { lines, headings, items } = structure(text, settingsOf(ws, options.limit).keep)
  const pinned = [...headings, ...items].filter((heading) => heading.pinned).map((heading) => ({ ...heading, start: heading.pinStart }))
  const overlap = (a, b) => a.start < b.end && b.start < a.end
  const blocks = headings.filter((heading) => [2, 3].includes(heading.depth)).map((heading) => ({ ...heading, kind: "section" }))
  blocks.push(...items)
  const skills = inventory(ws), rules = templateRules(ws)
  const candidates = []
  for (const block of blocks) {
    const body = lines.slice(block.start, block.end).join("")
    const bytes = Buffer.byteLength(body)
    if (bytes < INSTRUCTIONS_THRESHOLD || pinned.some((pin) => overlap(block, pin))) continue
    const normalized = flat(body)
    if (rules.some((rule) => normalized.includes(flat(rule.lead)) || normalized.includes(rule.text))) continue
    const { counts, engines } = mentions(body, skills)
    const procedure = /(?:^|\n)\s*(?:`{3,}|~{3,}|\d+[.)]\s|(?:\$\s+)?(?:npx|npm|node|git|bash|sh|python3?|excudo)\s)/.test(body)
      || (body.match(/^\s{2,}(?:[-+*]|\d+[.)])\s/gm)?.length ?? 0) >= 3
    if (!counts.size && !engines.size && !procedure) continue
    // A named engine skill alone is a reference, not evidence of a workspace procedure.
    if (!counts.size && !procedure) continue
    const target = [...counts].sort(([a, n], [b, m]) => m - n || a.localeCompare(b))[0]?.[0]
    const name = target ?? proposedName(block.name ?? block.headingPath.at(-1) ?? "", new Set([...skills.own, ...skills.engine]), block.start + 1)
    const reasons = [target ? "instructions-target-existing" : "instructions-target-new"]
    if (!target && engines.size) reasons.push("instructions-engine-only")
    if (procedure) reasons.push("instructions-procedure")
    candidates.push({ ...block, bytes, target: { name, exists: Boolean(target) }, engineSkills: [...engines].sort(),
      reason: reasons.map((code) => format(ws.labels.messages[code], { name })).join(" ") })
  }
  // Whole sections take precedence over their items, and no byte is proposed for moving twice.
  const picked = []
  for (const block of candidates.sort((a, b) => b.bytes - a.bytes || a.start - b.start)) {
    if (picked.some((other) => overlap(block, other))) continue
    picked.push(block)
  }
  report.candidates = picked.map(({ kind, headingPath, start, end, bytes, target, engineSkills, reason }) =>
    ({ kind, headingPath, startLine: start + 1, endLine: end, bytes, target, engineSkills, reason }))
  return report
}

const git = (ws, ...args) => spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
const cachePath = (ws) => join(ws.cacheDir ?? join(ws.root, ".excudo"), "instructions.json")
function readTrim(ws) {
  try {
    const value = JSON.parse(readFileSync(cachePath(ws), "utf8"))
    return Number.isSafeInteger(value.bytes) && value.bytes >= 0 && /^[a-f0-9]{40,64}$/.test(value.commit) ? value : null
  } catch { return null }
}

function trimRecord(ws) {
  const commit = git(ws, "rev-parse", "HEAD")
  if (commit.status !== 0) throw new Error(ws.labels.messages["instructions-git"])
  return { bytes: instructionsSize(ws).bytes, commit: commit.stdout.trim() }
}

/** A successful move records its base commit; the saved preservation check refreshes it to HEAD. */
export function recordInstructionsTrim(ws) {
  const record = trimRecord(ws)
  mkdirSync(dirname(cachePath(ws)), { recursive: true })
  writeAtomic(cachePath(ws), JSON.stringify(record, null, 2) + "\n")
  return record
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end
const containsRule = (body, rules) => rules.some((rule) => flat(body).includes(flat(rule.lead)) || flat(body).includes(rule.text))

function cleanFile(ws, file) {
  const tracked = git(ws, "ls-files", "--error-unmatch", "--", file)
  const status = git(ws, "status", "--porcelain", "--", file)
  if (tracked.status !== 0 || status.status !== 0 || status.stdout.trim())
    throw new Error(format(ws.labels.messages["instructions-dirty"], { file }))
}

function within(root, file) {
  const rel = relative(realpathSync(root), realpathSync(file))
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)
}

function addReference(skillText, reference, locale) {
  const link = `[${reference}](references/${reference}.md)`
  const parsed = structure(skillText, [])
  if (parsed.lines.some((line, index) => parsed.visible[index] && line.includes(`](references/${reference}.md)`))) return skillText
  const heading = parsed.headings.find((item) => item.depth === 2 && ["References", "참고"].includes(item.name))
  if (!heading) return skillText + `${skillText.endsWith("\n") ? "\n" : "\n\n"}## ${locale === "ko" ? "참고" : "References"}\n\n- ${link}\n`
  const last = parsed.items.findLast((item) => item.start > heading.start && item.start < heading.end)
  let insert = last?.end ?? heading.end
  while (insert > heading.start + 1 && !parsed.lines[insert - 1].trim()) insert--
  const before = parsed.lines.slice(0, insert).join("")
  const after = parsed.lines.slice(insert).join("").replace(/^\s*\n/, "")
  return before + `${before.endsWith("\n") ? "" : "\n"}${last ? "" : "\n"}- ${link}\n` + (after ? "\n" + after : "")
}

/** Moves one exact Markdown block, preserving every byte in its skill reference. */
export function moveInstructions(ws, { lines: range, to, reference, pointer = [], dryRun = false, since } = {}) {
  const fail = (code) => { throw new Error(ws.labels.messages[code]) }
  if (typeof range !== "string" || !/^[1-9]\d*-[1-9]\d*$/.test(range)
    || typeof to !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(to)
    || typeof reference !== "string" || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.md)?$/.test(reference)
    || !Array.isArray(pointer) || !pointer.length || pointer.length > 2
    || pointer.some((line) => typeof line !== "string" || !line.trim() || /[\r\n]/.test(line))) fail("instructions-move-usage")
  reference = reference.replace(/\.md$/, "")
  if (skillNames().includes(to)) fail("instructions-engine-target")
  const skillRoot = resolve(ws.root, ws.skills?.dir ?? "skills", to)
  const skillFile = join(skillRoot, "SKILL.md")
  if (!existsSync(skillFile)) fail("instructions-skill-missing")
  if (!within(ws.root, skillFile) || !within(skillRoot, skillFile)) fail("instructions-outside")
  const references = join(skillRoot, "references"), target = join(references, `${reference}.md`)
  if ((existsSync(references) && !within(skillRoot, references)) || (existsSync(target) && !within(skillRoot, target))) fail("instructions-outside")
  if (since !== undefined) {
    const preserved = instructionsPreservation(ws, since, { uncommitted: true })
    if (preserved.template || preserved.pinned || preserved.lost) fail("instructions-preservation")
  } else {
    cleanFile(ws, "AGENTS.md")
    cleanFile(ws, relative(ws.root, skillFile))
    if (existsSync(target)) cleanFile(ws, relative(ws.root, target))
  }
  const text = readFileSync(join(ws.root, "AGENTS.md"), "utf8")
  const parsed = structure(text, settingsOf(ws).keep)
  const [startLine, endLine] = range.split("-").map(Number)
  const block = [...parsed.headings, ...parsed.items].find((block) => block.start + 1 === startLine && block.end === endLine)
  if (!block) fail("instructions-block")
  const pinned = [...parsed.headings, ...parsed.items].filter((block) => block.pinned)
  if (pinned.some((pin) => overlaps(block, { start: pin.pinStart, end: pin.end }))) fail("instructions-protected")
  const body = parsed.lines.slice(block.start, block.end).join("")
  if (containsRule(body, templateRules(ws))) fail("instructions-protected")
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const pointers = [...pointer]
  if (!pointers.some((line) => line.includes(`\`${to}\``) && /details|자세한/i.test(line))) pointers[pointers.length - 1] += " " + format(ws.labels.messages["instructions-pointer"], { name: to })
  const after = parsed.lines.slice(0, block.start).join("") + pointers.join(eol) + eol + parsed.lines.slice(block.end).join("")
  const oldSkill = readFileSync(skillFile, "utf8"), oldRef = existsSync(target) ? readFileSync(target, "utf8") : null
  const refText = (oldRef === null ? `# ${reference}\n\n` : oldRef + (oldRef.endsWith("\n\n") ? "" : oldRef.endsWith("\n") ? "\n" : "\n\n")) + body
  const writes = [[target, refText, oldRef], [skillFile, addReference(oldSkill, reference, ws.locale), oldSkill], [join(ws.root, "AGENTS.md"), after, text]]
  const result = { dryRun, startLine, endLine, skill: to, reference: relative(ws.root, target), moved: Buffer.byteLength(body),
    before: Buffer.byteLength(text), bytes: Buffer.byteLength(after), changed: writes.filter(([, next, old]) => next !== old).map(([file]) => relative(ws.root, file)) }
  if (dryRun) return result
  const oldCache = existsSync(cachePath(ws)) ? readFileSync(cachePath(ws), "utf8") : null
  const written = []
  const write = (file, next, old) => {
    if (next === old) return
    const current = existsSync(file) ? readFileSync(file, "utf8") : null
    if (current !== old) throw new Error(format(ws.labels.messages["instructions-changed"], { file: relative(ws.root, file) }))
    writeAtomic(file, next)
    written.push([file, next, old])
  }
  let createdReferences = false
  try {
    createdReferences = mkdirSync(references, { recursive: true }) !== undefined
    for (const [file, next, old] of writes) write(file, next, old)
    const record = trimRecord(ws)
    mkdirSync(dirname(cachePath(ws)), { recursive: true })
    write(cachePath(ws), JSON.stringify(record, null, 2) + "\n", oldCache)
  } catch (error) {
    const left = []
    const notRestored = (file, reason) => left.push(`${relative(ws.root, file)} (${reason})`)
    for (const [file, next, old] of written.reverse()) {
      try {
        if (readFileSync(file, "utf8") !== next) {
          notRestored(file, ws.labels.messages["instructions-rollback-changed"])
          continue
        }
        if (old === null) rmSync(file)
        else writeAtomic(file, old)
      } catch (restoreError) { notRestored(file, restoreError.message) }
    }
    if (createdReferences) {
      try { rmdirSync(references) } catch (restoreError) {
        if (restoreError.code !== "ENOENT") notRestored(references, restoreError.message)
      }
    }
    if (left.length) throw new Error(format(ws.labels.messages["instructions-rollback"], { error: error.message, files: left.join(", ") }), { cause: error })
    throw error
  }
  return result
}

/** Compare removed pieces of baseline blocks and their counts to HEAD, or to the pending moves. */
export function instructionsPreservation(ws, since, { uncommitted = false } = {}) {
  const revision = typeof since === "string" ? git(ws, "rev-parse", "--verify", "--end-of-options", `${since}^{commit}`) : { status: 1 }
  if (revision.status !== 0) throw new Error(ws.labels.messages["instructions-revision"])
  const hash = revision.stdout.trim()
  const old = git(ws, "show", `${hash}:./AGENTS.md`)
  if (old.status !== 0) throw new Error(ws.labels.messages["instructions-revision"])
  const readAt = (revision, file) => {
    const result = git(ws, "show", `${revision}:./${file}`)
    if (result.status !== 0) throw new Error(ws.labels.messages["instructions-revision"])
    return result.stdout
  }
  const now = uncommitted ? readFileSync(join(ws.root, "AGENTS.md"), "utf8") : readAt("HEAD", "AGENTS.md")
  const rules = rulesAgainstTemplate(ws, now)
  const pinned = pinnedInstructions(ws, old.stdout).filter((block) => !now.includes(block))
  const markdown = (dir) => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? markdown(join(dir, entry.name)) : entry.isFile() && entry.name.endsWith(".md") ? [readFileSync(join(dir, entry.name), "utf8")] : [])
  const skillDir = relative(ws.root, resolve(ws.root, ws.skills?.dir ?? "skills")).split(sep).join("/")
  const markdownAt = (revision) => {
    const files = git(ws, "ls-tree", "-r", "--name-only", "-z", revision, "--", skillDir)
    if (files.status !== 0) throw new Error(ws.labels.messages["instructions-revision"])
    return files.stdout.split("\0").filter((file) => file.endsWith(".md")).map((file) => readAt(revision, file))
  }
  const linesOf = (text) => text.replace(/\r?\n$/, "").split(/\r?\n/)
  // Keep file boundaries: a block cannot start in one file and finish in another.
  const oldCorpus = [old.stdout, ...markdownAt(hash)].map(linesOf)
  const newCorpus = [now, ...(uncommitted ? markdown(resolve(ws.root, skillDir)) : markdownAt("HEAD"))].map(linesOf)
  const diff = git(ws, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=0", hash, ...(uncommitted ? [] : ["HEAD"]), "--", "AGENTS.md")
  if (diff.status !== 0) throw new Error(ws.labels.messages["instructions-revision"])
  const { headings, items } = structure(old.stdout, settingsOf(ws).keep)
  const boundaries = new Set([...headings.filter((heading) => [2, 3].includes(heading.depth)), ...items]
    .flatMap((block) => [block.start, block.end]))
  const hunks = []
  let removed = []
  const flush = () => {
    if (removed.some((line) => line.trim())) hunks.push(removed)
    removed = []
  }
  let inDiff = false, oldLine = 0
  for (const line of diff.stdout.split(/\r?\n/)) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/)
    if (header) { flush(); inDiff = true; oldLine = Number(header[1]) - 1 }
    else if (inDiff && line.startsWith("-")) {
      // Git may merge adjacent blocks into one deletion; each can move to its own file.
      if (boundaries.has(oldLine)) flush()
      removed.push(line.slice(1))
      oldLine++
    } else if (!line.startsWith("\\ No newline")) {
      flush()
      if (inDiff && line.startsWith(" ")) oldLine++
    }
  }
  flush()
  const occurrences = (corpus, hunk) => corpus.reduce((sum, lines) => sum + lines.reduce((count, line, start) =>
    count + Number(line === hunk[0] && hunk.every((value, offset) => lines[start + offset] === value)), 0), 0)
  const lost = hunks.reduce((sum, hunk) => sum + (occurrences(newCorpus, hunk) < occurrences(oldCorpus, hunk) ? hunk.length : 0), 0)
  return { template: rules.missing.length + rules.differ.length, pinned: pinned.length, lost }
}
