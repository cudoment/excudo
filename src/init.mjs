// Creates a workspace: settings, agent instructions and skills at the top, and the
// outliner graph (the folder you open in Tine or Logseq) inside it. Existing files
// are never overwritten.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { build } from "./build.mjs"
import { configTemplate } from "./dialects/logseq.mjs"
import { filesOf } from "./files.mjs"
import { LOCALES, format } from "./labels.mjs"
import { PACKAGE_ROOT, installSkills, packageVersion } from "./skills.mjs"
import { loadWorkspace } from "./workspace.mjs"

const TEMPLATES = join(PACKAGE_ROOT, "templates")
const EXAMPLE = join(PACKAGE_ROOT, "example")

/** A template file of `locale`, with the workspace's graph and page names filled in. */
export function renderTemplate(name, { locale = "en", graph = "notes", home, done } = {}) {
  const labels = LOCALES[locale] ?? LOCALES.en
  return format(readFileSync(join(TEMPLATES, LOCALES[locale] ? locale : "en", name), "utf8"), { graph, home: home ?? labels.home, done: done ?? labels.done })
}

function dependencySpec(root) {
  const override = process.env.EXCUDO_PACKAGE
  if (override) {
    if (existsSync(resolve(override))) {
      const path = relative(realpathSync(root), realpathSync(resolve(override))).split(sep).join("/")
      return `file:${path.startsWith(".") ? path : `./${path}`}`
    }
    return override
  }
  // Installed from npm: depend on the release. Running from a clone: point at it.
  if (PACKAGE_ROOT.split(sep).includes("node_modules")) return `^${packageVersion()}`
  const path = relative(realpathSync(root), realpathSync(PACKAGE_ROOT)).split(sep).join("/")
  return `file:${path.startsWith(".") ? path : `./${path}`}`
}

export async function init(dir, { locale = "en", graph = "notes", example = false } = {}) {
  const labels = LOCALES[locale]
  if (!labels) throw new Error(`Unknown locale ${locale}. Use one of: ${Object.keys(LOCALES).join(", ")}.`)
  if (example && locale !== "en") throw new Error(labels.messages["example-locale"])
  const root = resolve(dir)
  const created = []
  const skipped = []
  const put = (rel, content) => {
    const path = join(root, rel)
    if (existsSync(path)) return skipped.push(rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    created.push(rel)
  }
  const template = (name) => renderTemplate(name, { locale, graph })

  put("excudo.config.mjs", `export default {\n  graph: ${JSON.stringify(graph)},\n  locale: ${JSON.stringify(locale)},\n  // ${labels.settingsComments.staleDays}\n  staleDays: 30,\n  // ${labels.settingsComments.keepDays}\n  keepDays: 90,\n  // ${labels.settingsComments.bodyMax}\n  bodyMax: 20,\n  // ${labels.settingsComments.sources}\n  sources: [],\n  // ${labels.settingsComments.knowledge}\n  knowledge: [],\n  // ${labels.settingsComments.conversations}\n  conversations: false,\n}\n`)
  put(
    "package.json",
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: { check: "excudo check", build: "excudo build", tree: "excudo tree" },
        devDependencies: { excudo: dependencySpec(root) },
      },
      null,
      2,
    )}\n`,
  )
  put(
    ".gitignore",
    [
      "node_modules/",
      ".excudo/",
      ".DS_Store",
      `${graph}/logseq/bak/`,
      `${graph}/logseq/.recycle/`,
      `${graph}/.stversions/`,
      `${graph}/.stfolder/`,
      "*.sync-conflict-*",
      "",
    ].join("\n"),
  )
  put("AGENTS.md", template("AGENTS.md"))
  put("CLAUDE.md", "@AGENTS.md\n")

  if (example) {
    const source = join(EXAMPLE, "notes")
    for (const file of filesOf(source)) {
      const rel = join(graph, file)
      if (existsSync(join(root, rel))) skipped.push(rel)
      else {
        mkdirSync(dirname(join(root, rel)), { recursive: true })
        cpSync(join(source, file), join(root, rel))
        created.push(rel)
      }
    }
  } else {
    put(
      `${graph}/logseq/config.edn`,
      configTemplate(labels.home),
    )
    put(`${graph}/.stignore`, template("stignore"))
    put(`${graph}/views/${labels.home}.mdx`, template("home.mdx"))
    put(`${graph}/${labels.done}.md`, `# ${labels.done}\n${labels.doneSummary}\n`)
    mkdirSync(join(root, graph, "journals"), { recursive: true })
  }

  const skills = installSkills({ dir: root })
  const ws = await loadWorkspace({ root })
  const built = build(ws)
  return { root, created, skipped, skills, built }
}
