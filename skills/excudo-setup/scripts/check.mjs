#!/usr/bin/env node
// Usage: node scripts/check.mjs [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after setting it up or changing its settings. Checks what a working setup
// needs: the settings load, the graph exists, the local engine runs, every engine skill is installed
// for both agents and current, git ignores the cache and node_modules, AGENTS.md carries every rule
// of the engine's current template word for word (line breaks aside; the workspace may add sentences
// after a rule), the node rules hold, and an owner's Home keeps to its boundary:
// it repeats no task a node keeps and embeds no page that is missing. Exit 0 when all hold, 1 when
// one does not, 2 on a usage error.
import { spawnSync } from "node:child_process"
import { accessSync, constants, existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)

async function gather(ws, options) {
  const { engine } = kit
  // learnedSettings checks skill options too, including the names the owner keeps in skills.keep.
  const settings = []
  for (const read of [() => engine.sourcesOf(ws), () => engine.learnedSettings(ws), () => engine.instructionsSize(ws)]) try { read() } catch (error) { settings.push(error.message) }
  settings.push(...engine.validateAgents(ws))
  let executable = false
  try { accessSync(join(ws.root, "node_modules", ".bin", "excudo"), constants.X_OK); executable = true } catch {}
  const inGit = spawnSync("git", ["-C", ws.root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).status === 0
  const ignored = (path) => inGit ? spawnSync("git", ["-C", ws.root, "check-ignore", "-q", path]).status === 0 : null
  const agents = join(ws.root, "AGENTS.md")
  const text = existsSync(agents) ? readFileSync(agents, "utf8").normalize("NFC") : undefined
  const { issues } = await engine.check(ws)
  const home = engine.homeStatus(ws)
  return {
    settings,
    graph: existsSync(ws.graphDir),
    engine: executable,
    skills: engine.skillNames().map((name) => ({ name, agents: existsSync(join(ws.root, ".agents", "skills", name, "SKILL.md")),
      claude: existsSync(join(ws.root, ".claude", "skills", name, "SKILL.md")) })),
    outdated: issues.filter((issue) => issue.code === "skills-outdated").map((issue) => issue.key.split("|")[1]),
    git: inGit,
    ignored: { cache: ignored(join(ws.cacheDir, "x")), modules: ignored(join(ws.root, "node_modules", "x")) },
    ...rules(ws, text),
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    home: { owned: home.owned, copies: issues.filter((issue) => issue.code === "home-copy").map((issue) => `${issue.file}:${issue.line}`),
      broken: (home.embedded ?? []).filter((item) => !item.exists).map((item) => item.page) },
    site: siteFacts(ws),
  }
}

// The website, when the workspace keeps one: whether it has been written since the setting was made.
// A website set to be published has been published once (excudo site setup), so the owner has its address.
function siteFacts(ws) {
  if (ws.site === undefined) return { configured: false }
  try {
    const site = kit.engine.siteOf(ws)
    const facts = { configured: true, out: site.out, written: Boolean(kit.engine.siteState(ws)) }
    if (site.publish !== undefined) facts.publish = { project: kit.engine.publishOf(ws, site).project, url: kit.engine.publishState(ws).url ?? null }
    return facts
  }
  catch (error) { return { configured: true, error: error.message } }
}

// The template's rules the workspace's AGENTS.md lacks, and those it has in other words.
function rules(ws, text) {
  if (text === undefined) return { rulesMissing: null, rulesDiffer: [] }
  const { missing, differ } = kit.rulesAgainstTemplate(ws, text)
  return { rulesMissing: missing, rulesDiffer: differ }
}

const quoted = (rules) => rules.map((rule) => `“${rule.replace(/[.。]$/, "")}”`).join(", ")

function evaluate(facts, options = {}) {
  const absent = facts.skills.filter((skill) => !skill.agents || !skill.claude).map((skill) => skill.name)
  const unignored = Object.entries(facts.ignored).filter(([, value]) => value === false).map(([key]) => key === "cache" ? ".excudo/" : "node_modules/")
  const checks = [
    { id: "settings", ok: !facts.settings.length,
      message: facts.settings.length ? { en: `excudo.config.mjs: ${facts.settings.join(" ")}`, ko: `excudo.config.mjs에 문제가 있습니다: ${facts.settings.join(" ")}` } : { en: "The settings load.", ko: "설정을 읽을 수 있습니다." } },
    { id: "graph", ok: facts.graph, message: facts.graph ? { en: "The graph folder exists.", ko: "그래프 폴더가 있습니다." } : { en: "The graph folder is missing.", ko: "그래프 폴더가 없습니다." } },
    { id: "engine", ok: facts.engine,
      message: facts.engine ? { en: "The local engine runs.", ko: "로컬 엔진을 실행할 수 있습니다." } : { en: "node_modules/.bin/excudo is missing: run npm install here.", ko: "node_modules/.bin/excudo가 없습니다. 이 폴더에서 npm install을 실행할 것." } },
    { id: "skills", ok: !absent.length && !facts.outdated.length,
      message: absent.length ? { en: `Skills not installed for both agents: ${absent.join(", ")}. Run skills (--link for a local clone).`, ko: `두 에이전트에 모두 설치되지 않은 스킬이 있습니다: ${absent.join(", ")}. skills를 실행할 것(로컬 복제본이면 --link).` }
        : facts.outdated.length ? { en: `Outdated skills: ${facts.outdated.join(", ")}. Run skills --force.`, ko: `오래된 스킬이 있습니다: ${facts.outdated.join(", ")}. skills --force를 실행할 것.` }
        : { en: "Every engine skill is installed and current.", ko: "엔진의 스킬이 모두 설치되어 있고 최신입니다." } },
    { id: "ignored", ok: !unignored.length,
      message: facts.git === false ? { en: "Not in git; `git init` is recommended so batches can be reverted.", ko: "git 저장소가 아닙니다. 묶음을 되돌릴 수 있도록 `git init`을 권합니다." }
        : unignored.length ? { en: `.gitignore must list ${unignored.join(" and ")}: request text and installed code stay out of git.`, ko: `.gitignore에 ${unignored.join(", ")}를 적을 것. 요청 원문과 설치된 코드는 git에 넣지 않습니다.` }
        : { en: "git ignores the cache and node_modules.", ko: "git이 캐시와 node_modules를 무시합니다." } },
    { id: "agents-rules", ok: Array.isArray(facts.rulesMissing) && !facts.rulesMissing.length && !(facts.rulesDiffer ?? []).length,
      message: facts.rulesMissing === null ? { en: "AGENTS.md is missing.", ko: "AGENTS.md가 없습니다." }
        : facts.rulesMissing.length ? { en: `AGENTS.md lacks rules of the engine's current template: ${quoted(facts.rulesMissing)}. Add them; keep the workspace's own rules.`, ko: `AGENTS.md에 엔진의 현재 템플릿 규칙이 빠져 있습니다: ${quoted(facts.rulesMissing)}. 작업 공간의 규칙은 두고 빠진 규칙을 더할 것.` }
        : (facts.rulesDiffer ?? []).length ? { en: `AGENTS.md has rules of the engine's current template in other words: ${quoted(facts.rulesDiffer)}. Copy each rule's text from the template; the workspace's own sentences may follow it.`, ko: `AGENTS.md의 규칙이 엔진의 현재 템플릿과 다른 글로 적혀 있습니다: ${quoted(facts.rulesDiffer)}. 규칙마다 템플릿의 글을 그대로 옮기고, 작업 폴더의 문장은 그 뒤에 둘 것.` }
        : { en: "AGENTS.md carries every rule of the engine's template.", ko: "AGENTS.md에 엔진 템플릿의 규칙이 모두 있습니다." } },
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    homeCheck(facts.home ?? { owned: false, copies: [], broken: [] }),
    siteCheck(facts.site ?? { configured: false }),
  ]
  if (options.feedback || facts.feedback) checks.push(feedbackCheck(facts.feedback, options))
  return checks
}

// Judge the actual CLI draft the agent is about to show, rather than a derived always-true flag.
function feedbackCheck(draft, options) {
  const data = draft?.diagnostic
  const ids = new Set([...Object.keys(kit.engine.COMMAND_STEPS), "reflect", "cleanup", "site-pull", "skills-upkeep", "custom-step"])
  const only = (object, keys) => object && typeof object === "object" && Object.keys(object).every((key) => keys.includes(key))
  let valid = Boolean(data && typeof data.engine === "string" && typeof data.node === "string" && typeof data.platform === "string"
    && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.engine) && /^v\d+\.\d+\.\d+/.test(data.node)
    && (!data.configurationError || only(data.configurationError, ["id", "code"]) && data.configurationError.id === "configuration-load"
      && ["SyntaxError", "TypeError", "ReferenceError", "RangeError", "Error"].includes(data.configurationError.code)) && only(data, ["engine", "node", "platform", "start", "checks", "runs", "configurationError"])
    && Array.isArray(data.start) && data.start.every((step) => only(step, ["id", "state"]) && kit.engine.START_STEPS.some((known) => known.id === step.id) && ["done", "not-done", "unknown"].includes(step.state))
    && Array.isArray(data.checks) && data.checks.every((id) => id === "skill-check")
    && Array.isArray(data.runs) && data.runs.every((run) => only(run, ["step", "status", "codes"]) && ids.has(run.step)
      && ["ok", "failed", "deferred", "paused", "unknown"].includes(run.status) && Array.isArray(run.codes))
    && (!draft.details || options["allow-details"]))
  try { const url = new URL(draft.url); valid &&= url.hostname === "github.com" && url.pathname === "/cudoment/excudo/issues/new" } catch { valid = false }
  return { id: "feedback-draft", ok: valid, message: valid
    ? { en: "The issue draft contains allowed diagnostics and only requested details.", ko: "제보 초안은 허용한 진단 항목과 요청한 상세만 담습니다." }
    : { en: "The issue draft has unrequested details or fields outside the diagnostic allowlist.", ko: "제보 초안에 요청하지 않은 상세나 허용 목록 밖의 진단 항목이 있습니다." } }
}

// A workspace that keeps a website has written it at least once, so the folder is there to open.
function siteCheck(site) {
  const unpublished = site.publish && !site.publish.url
  return { id: "site", ok: !site.configured || (!site.error && site.written && !unpublished),
    message: !site.configured ? { en: "No website is set; add site to excudo.config.mjs to write one.", ko: "웹 사이트 설정이 없습니다. 쓰려면 excudo.config.mjs에 site를 더할 것." }
      : site.error ? { en: `The site setting fails: ${site.error}`, ko: `site 설정에 문제가 있습니다: ${site.error}` }
      : !site.written ? { en: `The website (${site.out}) has not been written yet: run excudo site.`, ko: `웹 사이트(${site.out})를 아직 쓰지 않았습니다. excudo site를 실행할 것.` }
      : unpublished ? { en: `The website is set to be published (${site.publish.project}) but never was: run excudo site setup.`, ko: `웹 사이트를 올리도록 했지만(${site.publish.project}) 아직 올리지 않았습니다. excudo site setup을 실행할 것.` }
      : site.publish ? { en: `The website is written to ${site.out} and published at ${site.publish.url}.`, ko: `웹 사이트를 ${site.out}에 쓰고 ${site.publish.url}에 올립니다.` }
      : { en: `The website is written to ${site.out}.`, ko: `웹 사이트를 ${site.out}에 씁니다.` } }
}

// The owner writes Home, the engine writes its views: Home shows nodes' tasks through queries and the
// tree through embedded views, never as copies, and an embed points at a page that is there.
function homeCheck(home) {
  const copies = home.owned ? home.copies : []
  const broken = home.owned ? home.broken : []
  return { id: "home-boundary", ok: !copies.length && !broken.length,
    message: copies.length ? { en: `Home repeats tasks that nodes keep (${copies.join(", ")}): show them with a query and take the copies out, on the owner's request.`, ko: `홈에 노드의 할 일을 그대로 적은 줄이 있습니다(${copies.join(", ")}). 사용자의 요청에 따라 쿼리로 보여 주고 베낀 줄은 뺄 것.` }
      : broken.length ? { en: `Home embeds pages that are missing: ${broken.join(", ")}. Build the view, or fix the embed.`, ko: `홈이 없는 페이지를 임베드합니다: ${broken.join(", ")}. 뷰를 생성하거나 임베드를 고칠 것.` }
      : !home.owned ? { en: "The engine writes Home.", ko: "엔진이 홈을 씁니다." }
      : { en: "Home copies no task and every page it embeds is there.", ko: "홈은 할 일을 베끼지 않았고 임베드한 페이지가 모두 있습니다." } }
}

if (process.argv.includes("--feedback") && !process.argv.includes("--facts") && !process.argv.includes("--self-test")) {
  try {
    const { values } = parseArgs({ options: { feedback: { type: "string" }, "allow-details": { type: "boolean" }, json: { type: "boolean" } } })
    const result = feedbackCheck(JSON.parse(readFileSync(values.feedback, "utf8")), values)
    const locale = (process.env.LC_ALL || process.env.LANG || "").startsWith("ko") ? "ko" : "en"
    const check = { ...result, message: result.message[locale] }
    console.log(values.json ? JSON.stringify({ ok: check.ok, checks: [check] }) : `${check.ok ? "✓" : "✗"} ${check.id}: ${check.message}`)
    process.exitCode = check.ok ? 0 : 1
  } catch (error) { console.error(error.message); process.exitCode = 2 }
} else await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--json] [--feedback <draft.json>] [--allow-details] | --facts <file> | --self-test",
  options: { feedback: { type: "string" }, "allow-details": { type: "boolean" } },
  gather,
  evaluate,
  cases: new URL("./check.cases.json", import.meta.url),
})

function kitPath() {
  for (const from of [import.meta.url, `${process.env.EXCUDO_ROOT || process.cwd()}/`, `${process.cwd()}/`])
    try { return createRequire(from).resolve("excudo/skill-kit") } catch {}
  console.error("The excudo engine is missing: run npm install in the workspace.")
  process.exit(2)
}
