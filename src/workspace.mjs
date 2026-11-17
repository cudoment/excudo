// A workspace is a folder with excudo.config.mjs. The outliner graph (the folder
// you open in Tine or Logseq) lives inside it, next to the agent files.
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { LOCALES } from "./labels.mjs"

export const CONFIG_FILE = "excudo.config.mjs"

export const DEFAULTS = {
  /** The outliner graph, relative to the workspace. */
  graph: "notes",
  /** Language of generated text and messages: "en" or "ko". */
  locale: "en",
  /** Strings that feedback must redact; nested objects can also carry private: true. */
  private: [],
  /** Longest summary, in characters. */
  summaryMax: 120,
  /** Longest summary of a top-level node; these make up the first list. */
  topSummaryMax: 60,
  /** Most nodes directly below one node (or Home) before it should be grouped. */
  widthMax: 9,
  /** Most open tasks in one node before it should be split; false counts none. */
  taskMax: 12,
  /** Most tasks in progress across the memo before the first screen is too busy; undefined follows widthMax, false counts none. */
  doingMax: undefined,
  /** How many finished items the Done page keeps. */
  doneKeep: 5,
  staleDays: 30,
  keepDays: 90,
  bodyMax: 20,
  /** Build cache, relative to the workspace. */
  cache: ".excudo",
  /** Outside sources: work to bring in (items) and repositories or pages to keep knowledge from. */
  sources: [],
  /** Nodes whose subtrees hold reference knowledge that agents keep up to date. */
  knowledge: [],
  /** The node below which the reflect skill keeps lasting interests and decisions. */
  interests: undefined,
  /** Read the requests typed to coding agents: false, true, or { claude, codex, exclude }. */
  conversations: false,
  /** Folders renamed or moved since: { "<old path>": "<new path>" }, for path lines and requests. */
  moved: {},
  /** Skills learned from recurring requests: { dir, install, minScore, … } (see learned.mjs). */
  skills: {},
  /** AGENTS.md budget and trim target in bytes, with opt-in scheduled trimming and pinned headings. */
  instructions: { limit: 32768, target: null, auto: false, keep: [] },
  /** Files written from the memo in the owner's format, outside the graph: [{ name, file, sections, retitle }] (see exports.mjs). */
  exports: [],
  /** One list kept the same in several places: [{ name, places: [{ page, section, tasks } | { export, region } | { board } | { note, item }] }] (see mirror.mjs). */
  mirrors: [],
  /** Tasks handed to agents: { tag, limit } (see queue.mjs); the tag defaults to the locale's word. */
  queue: {},
  /** Worker and independent reviewers: { worker, reviewers, suggest } (see agents.mjs). */
  agents: undefined,
  /** The memo as a website, written outside the graph: { out, title, mode, open, journals, css, id, onSave, inbox } (see site.mjs). */
  site: undefined,
}

/** The nearest folder at or above `from` that has excudo.config.mjs. */
export function findWorkspace(from) {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir
    const up = dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

/**
 * Loads the workspace settings. `root` picks the workspace (default: the nearest
 * one above the current folder); `graph` points at a different graph folder while
 * keeping the workspace's other settings.
 */
export async function loadWorkspace({ root, graph, cwd = process.cwd(), ignoreConfig = false } = {}) {
  const base = root ? resolve(root) : (findWorkspace(cwd) ?? resolve(process.env.EXCUDO_ROOT || cwd))
  const file = join(base, CONFIG_FILE)
  const user = !ignoreConfig && existsSync(file) ? ((await import(pathToFileURL(file).href)).default ?? {}) : {}
  const settings = { ...DEFAULTS, ...user }
  if (settings.instructions && typeof settings.instructions === "object" && !Array.isArray(settings.instructions))
    settings.instructions = { ...DEFAULTS.instructions, ...settings.instructions }
  const locale = LOCALES[settings.locale] ?? LOCALES.en
  const overrides = user.labels ?? {}
  return {
    ...settings,
    root: base,
    hasConfig: existsSync(file),
    graphDir: graph ? resolve(graph) : resolve(base, settings.graph),
    cacheDir: resolve(base, settings.cache),
    // Nested word lists merge entry by entry, so overriding one message keeps the rest.
    labels: { ...locale, ...overrides, ...Object.fromEntries(["messages", "review", "recommendations", "settingsComments"]
      .map((group) => [group, { ...locale[group], ...overrides[group] }])) },
    metaNodes: user.metaNodes ?? [overrides.done ?? locale.done, overrides.record ?? locale.record],
  }
}
