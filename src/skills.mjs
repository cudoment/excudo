// Agent skills ship with the package in skills/<name>/SKILL.md, in the Agent
// Skills format that Claude Code and Codex both read. Installing copies them to
// `.agents/skills/` (where Codex looks in a workspace) and links `.claude/skills/<name>`
// to that copy, so there is one copy and both agents see it; in the home folder each
// agent that keeps skills there gets a link (see agentLinkTools). A workspace that uses a local
// clone of the engine can link `.agents/skills/<name>` to the installed package
// instead, so the skills change together with the engine.
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { filesOf } from "./files.mjs"
import { checkCache } from "./records.mjs"
import { LOCALES } from "./labels.mjs"
import { compareVersions } from "./update.mjs"

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const SKILLS_DIR = join(PACKAGE_ROOT, "skills")

export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version
}

export function skillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
}

/** Whether every file of the packaged skill is already in place, unchanged. */
function upToDate(src, dest) {
  return filesOf(src).every((file) => {
    const target = join(dest, file)
    return existsSync(target) && readFileSync(target).equals(readFileSync(join(src, file)))
  })
}

/**
 * The agents' folders (`<base>/<tool>/skills`) that link to a skill in `<base>/.agents/skills`. In a
 * workspace Codex reads `.agents/skills` itself and Claude Code gets a link; in the home folder
 * (`global`) each agent that keeps its folder there gets one: Claude Code and Codex. The engine's
 * skills and the learned ones are linked the same way.
 */
export function agentLinkTools(base, { global = false } = {}) {
  return global ? [".claude", ".codex"].filter((tool) => existsSync(join(base, tool))) : [".claude"]
}

const isLink = (path) => { try { return lstatSync(path).isSymbolicLink() } catch { return false } }
const real = (path) => { try { return realpathSync(path) } catch { return path } }

/**
 * Where a linked skill points: through the workspace's node_modules when that is this package, so the
 * link follows whichever engine the workspace installs, or else at this package itself.
 */
function packageSkill(base, name, global) {
  const src = join(SKILLS_DIR, name)
  const installed = join(base, "node_modules", "excudo", "skills", name)
  return !global && existsSync(installed) && real(installed) === real(src) ? installed : src
}

function link(path, target, force) {
  let current
  try {
    current = lstatSync(path)
  } catch {}
  if (current) {
    if (current.isSymbolicLink() && readlinkSync(path) === target) return "linked"
    if (!force) return "exists"
    rmSync(path, { recursive: true, force: true })
  }
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
  return "linked"
}

// What the installer itself adds to a copy.
const INSTALLED = new Set(["version.json", "SOURCE.md"])

/** Digest copies without following an owner's links; extra files and empty directories count. */
export function engineSkillFingerprint(dir, { ignoreNote = false } = {}) {
  const hash = createHash("sha256")
  const walk = (path, rel = "") => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) hash.update(`L${rel}\0${readlinkSync(path)}\0`)
    else if (stat.isDirectory()) {
      hash.update(`D${rel}\0`)
      for (const name of readdirSync(path).sort()) if (rel || name !== "version.json" && !(ignoreNote && name === "SOURCE.md")) walk(join(path, name), `${rel}/${name}`)
    } else hash.update(`F${rel}\0`).update(readFileSync(path))
  }
  walk(dir)
  return hash.digest("hex")
}

function unmodifiedCopy(src, dest) {
  if (isLink(dest)) return real(src) === real(dest)
  let record
  try { record = JSON.parse(readFileSync(join(dest, "version.json"), "utf8")) } catch { return false }
  if (record.fingerprint && record.fingerprint === engineSkillFingerprint(dest)) return true
  // Legacy or manually merged copies can rejoin updates only when every byte matches the package.
  if (!record.version || engineSkillFingerprint(src, { ignoreNote: true }) !== engineSkillFingerprint(dest, { ignoreNote: true })) return false
  const note = join(dest, "SOURCE.md")
  return !existsSync(note) || readFileSync(note, "utf8") === sourceNote(dest.split(/[\\/]/).at(-1), record.version)
}

const sourceNote = (name, version) => `# ${name}\n\nInstalled by excudo ${version}. Update with \`excudo skills --global --force\`.\n`
const present = (path) => { try { lstatSync(path); return true } catch { return false } }
/** The backup folder that already holds exactly this content, if one was made before. */
function findBackup(cache, name, path) {
  const folder = join(cache, "skill-backups")
  let want
  try { want = engineSkillFingerprint(path) } catch { return null }
  let entries = []
  try { entries = readdirSync(folder) } catch { return null }
  for (const entry of entries.sort().reverse()) {
    if (!entry.startsWith(`${name}-`)) continue
    const candidate = join(folder, entry, "skill")
    try { if (engineSkillFingerprint(candidate) === want) return candidate } catch {}
  }
  return null
}

function backupSkill(path, cache, name, validate) {
  validate()
  const existing = findBackup(cache, name, path)
  if (existing) return { path, backup: existing, reused: true }
  const folder = join(cache, "skill-backups")
  mkdirSync(folder, { recursive: true })
  const backup = join(mkdtempSync(join(folder, `${name}-`)), "skill")
  if (isLink(path)) symlinkSync(readlinkSync(path), backup, "dir")
  else cpSync(path, backup, { recursive: true, dereference: false, verbatimSymlinks: true })
  return { path, backup }
}

/** Why a copy is kept: edits are the owner's, an older copy without a fingerprint cannot be told apart from edits. */
function keptReason(dest) {
  try {
    const record = JSON.parse(readFileSync(join(dest, "version.json"), "utf8"))
    if (!record.fingerprint && record.version && compareVersions(record.version, packageVersion()) < 0) return "unverified-older"
  } catch {}
  return "edited"
}

function linkSkill(src, dest, target, { linked, force }) {
  // The same link text can lead elsewhere when a folder above it is a link; only where it leads counts.
  if (linked && readlinkSync(dest) === target && real(dest) === real(src)) return "linked"
  // A link to somewhere else than this package's skill is the owner's.
  if (linked && !force && real(dest) !== real(src)) return "exists"
  // A copy with other content, or with files the package does not ship, may hold the owner's edits.
  const shipped = new Set(filesOf(src))
  if (existsSync(dest) && !linked && !force
    && (!upToDate(src, dest) || filesOf(dest).some((file) => !shipped.has(file) && !INSTALLED.has(file)))) return "exists"
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  symlinkSync(target, dest)
  return "linked"
}

function copySkill(src, dest, { force, global, name }) {
  let state
  if (existsSync(dest) && upToDate(src, dest)) state = "current"
  else if (existsSync(dest) && !force) return "exists"
  else {
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true, dereference: true })
    if (global) {
      writeFileSync(
        join(dest, "SOURCE.md"),
        sourceNote(name, packageVersion()),
      )
    }
    state = "installed"
  }
  writeFileSync(join(dest, "version.json"), `${JSON.stringify({ version: packageVersion(), fingerprint: engineSkillFingerprint(dest) })}\n`)
  return state
}

/**
 * Installs the skills into a workspace (`dir`) or, with `global`, into the home folder (`home`):
 * `~/.agents/skills/<name>` linked from `~/.claude/skills` and `~/.codex/skills` for the agents that
 * have their folder there. A skill that already exists with other content is left
 * alone unless `force` is set. `link: true` links each skill to the package instead of copying it,
 * `link: false` copies it again, and without `link` a skill keeps the form it has.
 */
export function installSkills({ dir, global = false, force: forceAll = false, replace = [], link: linking, home = homedir(), cache, graph, labels = LOCALES.en } = {}) {
  const base = global ? home : dir
  cache ??= join(base, ".excudo")
  const validate = () => checkCache({ root: base, graphDir: graph ?? join(base, "notes"), cacheDir: cache, labels })
  const tools = agentLinkTools(base, { global })
  return skillNames().map((name) => {
    const src = join(SKILLS_DIR, name)
    const dest = join(base, ".agents", "skills", name)
    const linked = isLink(dest)
    const backups = []
    const replacing = replace === true || (Array.isArray(replace) && replace.includes(name))
    const force = forceAll || replacing
    if (present(dest) && !unmodifiedCopy(src, dest)) {
      if (force) backups.push(backupSkill(dest, cache, name, validate))
      const links = force && !replacing ? tools.flatMap((tool) => {
        const path = join(base, tool, "skills", name), target = join("..", "..", ".agents", "skills", name)
        if (!present(path) || isLink(path) && readlinkSync(path) === target && real(path) === real(dest)) return []
        backups.push(backupSkill(path, cache, `${name}-${tool.slice(1)}`, validate))
        return [{ tool, state: "preserved" }]
      }) : []
      if (!replacing) return { name, dest, state: force ? "preserved" : "exists", reason: keptReason(dest), links, backups }
    }
    let state
    if (linking ?? linked) {
      const target = packageSkill(base, name, global)
      const withinBase = relative(base, target)
      const anchored = !withinBase.startsWith("..") ? join(real(base), withinBase) : real(target)
      state = linkSkill(src, dest, relative(real(dirname(dest)), anchored), { linked, force })
    }
    // A link to this package's skill is replaced by a copy without loss; one to elsewhere is the owner's.
    else if (linked && !force && real(dest) !== real(src)) state = "exists"
    else {
      if (linked) rmSync(dest, { force: true })
      state = copySkill(src, dest, { force, global, name })
    }
    const links =
      state === "exists"
        ? []
        : tools.map((tool) => {
          const path = join(base, tool, "skills", name), target = join("..", "..", ".agents", "skills", name)
          if (force && present(path) && !(isLink(path) && readlinkSync(path) === target && real(path) === real(dest))) {
            backups.push(backupSkill(path, cache, `${name}-${tool.slice(1)}`, validate))
            return { tool, state: "preserved" }
          }
          return { tool, state: link(path, target, force) }
        })
    return { name, dest, state, links, backups }
  })
}

/**
 * Copies older than the engine. `preserved` marks one that was kept because it differs from the
 * package (an edit, or an older copy without a fingerprint); `backup` is where its content is saved.
 */
export function outdatedSkillDetails(root, { cache = join(root, ".excudo") } = {}) {
  return skillNames().flatMap((name) => {
    const dest = join(root, ".agents", "skills", name), file = join(dest, "version.json")
    if (!existsSync(file)) return []
    let version
    try { version = JSON.parse(readFileSync(file, "utf8")).version } catch { return [] }
    if (typeof version !== "string") return []
    try { if (compareVersions(version, packageVersion()) >= 0) return [] } catch { return [] }
    const preserved = !unmodifiedCopy(join(SKILLS_DIR, name), dest)
    return [{ name, preserved, backup: preserved ? findBackup(cache, name, dest) : null }]
  })
}

export const outdatedSkills = (root, options) => outdatedSkillDetails(root, options).map((skill) => skill.name)
