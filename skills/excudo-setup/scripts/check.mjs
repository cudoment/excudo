#!/usr/bin/env node
// Usage: node scripts/check.mjs [--json]
//        node scripts/check.mjs --update <update.json> --relay <message.txt> [--relay <after-apply.txt> --applied]
//                                                 (the owner actions an update carries were relayed)
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
  if (facts.update) checks.push(updateCheck(facts.update))
  return checks
}

// An update that carries owner actions tells the owner each version's items before the other notes, and
// again after --apply. `relays` are the messages the agent showed, in order; `changelog` the other notes.
function updateCheck(update) {
  const staleJson = Boolean(update?.expectApplied && !update?.applied)
  const stale = { id: "update-owner-actions", ok: false, message: { en: "--applied was given, but the update JSON is from before the apply: pass the output of update --apply --json.", ko: "--applied를 지정했는데 업데이트 JSON이 적용 전의 것입니다. update --apply --json의 출력을 넘길 것." } }
  if (staleJson) return stale
  const actions = (Array.isArray(update?.ownerActions) ? update.ownerActions : []).filter((entry) => entry && Array.isArray(entry.items) && entry.items.length)
    .sort((a, b) => versionOrder(b.version, a.version))
  const warning = typeof update?.missingNote === "string" && update.missingNote ? update.missingNote : ""
  if (!actions.length && !warning) return { id: "update-owner-actions", ok: true, message: { en: "The update has no owner action to relay.", ko: "이번 업데이트에는 직접 해야 할 일이 없습니다." } }
  const relays = Array.isArray(update.relays) ? update.relays.map(String) : []
  // The engine counts as updated after an apply, and also when a later step of a failed apply left it installed.
  const wanted = update.applied || update.expectApplied || update.engineChanged ? 2 : 1
  const shown = relays.slice(0, wanted)
  const url = warning.match(/https?:\/\/\S+/)?.[0]
  const unwarned = warning && (relays.length < wanted || shown.some((text) => !text.includes(warning) && !(url && text.includes(url))))
  if (!actions.length) return { id: "update-owner-actions", ok: !unwarned, message: unwarned
    ? { en: `Owner actions could not be confirmed: relay this warning to the owner in every message (${wanted} needed): ${warning}`, ko: `직접 해야 할 일을 확인하지 못했습니다. 이 경고를 모든 전달(${wanted}개 필요)에 포함할 것: ${warning}` }
    : { en: "The warning that owner actions could not be confirmed was relayed.", ko: "직접 해야 할 일을 확인하지 못했다는 경고를 전했습니다." } }
  // Every general note is a "- " line of the changelog.
  const notes = String(update.changelog ?? "").split("\n").map((line) => line.match(/^- (.+)$/)?.[1]).filter(Boolean)
  // A section starts at its version's position and ends at the next owner-action version's position.
  const sections = (text) => {
    const starts = actions.map((entry) => text.indexOf(entry.version))
    return actions.map((entry, index) => {
      const start = starts[index]
      const end = Math.min(text.length, ...starts.slice(index + 1).filter((at) => at > start))
      return { entry, start, body: start < 0 ? "" : text.slice(start, end), offset: start }
    })
  }
  const missing = relays.length < wanted ? "count" : shown.findIndex((text) => sections(text).some(({ entry, start, body }) => start < 0 || entry.items.some((item) => !body.includes(item))))
  // Other notes come after the items of the last section.
  const late = shown.findIndex((text) => {
    const parts = sections(text)
    const last = parts[parts.length - 1]
    const lastAt = Math.max(...last.entry.items.map((item) => last.offset + last.body.indexOf(item)))
    return notes.some((note) => { const at = text.indexOf(note); return at >= 0 && at < lastAt })
  })
  // Newest version first: the sections follow the versions' order.
  const unsorted = shown.findIndex((text) => sections(text).some(({ start }, index, parts) => index && start < parts[index - 1].start))
  const ok = missing === -1 && late === -1 && unsorted === -1 && !unwarned
  return { id: "update-owner-actions", ok, message: ok
    ? { en: `The owner actions of ${actions.map((entry) => entry.version).join(", ")} were relayed${update.applied ? " before the notes and again after --apply" : " before the notes"}.`, ko: `${actions.map((entry) => entry.version).join(", ")} 버전의 직접 해야 할 일을 전했습니다${update.applied ? "(노트보다 먼저, --apply 뒤에 다시)" : "(노트보다 먼저)"}.` }
    : missing === "count" ? { en: `The update has owner actions: relay them per version${update.applied ? " before the other notes and again after --apply" : " before the other notes"} (${wanted} message(s) needed, ${relays.length} given).`, ko: `업데이트에 직접 해야 할 일이 있습니다. 버전마다${update.applied ? " 다른 노트보다 먼저, --apply 뒤에 다시" : " 다른 노트보다 먼저"} 전하세요(메시지 ${wanted}개가 필요한데 ${relays.length}개입니다).` }
    : missing >= 0 ? { en: `Relay ${missing + 1} omits a version or an item of the owner actions: name every version and every item.`, ko: `${missing + 1}번째 전달에 직접 해야 할 일의 버전이나 항목이 빠졌습니다. 모든 버전과 항목을 적을 것.` }
    : late >= 0 ? { en: `Relay ${late + 1} shows other notes before the owner actions: put the owner actions first.`, ko: `${late + 1}번째 전달에서 다른 노트가 직접 해야 할 일보다 앞에 있습니다. 직접 해야 할 일을 먼저 적을 것.` }
    : unsorted >= 0 ? { en: `Relay ${unsorted + 1} lists the owner actions out of order: newest version first.`, ko: `${unsorted + 1}번째 전달에서 직접 해야 할 일의 버전 순서가 맞지 않습니다. 최신 버전부터 적을 것.` }
    : { en: `Owner actions could not be confirmed: relay this warning to the owner in every message (${wanted} needed): ${warning}`, ko: `직접 해야 할 일을 확인하지 못했습니다. 이 경고를 모든 전달(${wanted}개 필요)에 포함할 것: ${warning}` } }
}

// Compare release versions with the engine's SemVer rules (compareVersions in src/update.mjs): a
// prerelease sorts below its release, numeric identifiers compare as numbers and sort below named ones.
function versionOrder(left, right) {
  const parse = (version) => String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+.+)?$/) ?? []
  const [a, b] = [parse(left), parse(right)]
  for (let i = 1; i <= 3; i++) if (BigInt(a[i] ?? 0) !== BigInt(b[i] ?? 0)) return BigInt(a[i] ?? 0) > BigInt(b[i] ?? 0) ? 1 : -1
  if (a[4] === b[4]) return 0
  if (!a[4] || !b[4]) return a[4] ? -1 : 1
  const parts = [a[4].split("."), b[4].split(".")]
  for (let i = 0; i < Math.max(...parts.map((value) => value.length)); i++) {
    const [x, y] = parts.map((value) => value[i])
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const numeric = [x, y].map((value) => /^\d+$/.test(value))
    if (numeric.every(Boolean)) return BigInt(x) > BigInt(y) ? 1 : -1
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
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

if (process.argv.includes("--update") && !process.argv.includes("--facts") && !process.argv.includes("--self-test")) {
  try {
    const { values } = parseArgs({ options: { update: { type: "string" }, relay: { type: "string", multiple: true }, applied: { type: "boolean" }, json: { type: "boolean" } } })
    const update = { ...JSON.parse(readFileSync(values.update, "utf8")), relays: (values.relay ?? []).map((file) => readFileSync(file, "utf8")), expectApplied: Boolean(values.applied) }
    const result = updateCheck(update)
    const locale = (process.env.LC_ALL || process.env.LANG || "").startsWith("ko") ? "ko" : "en"
    const check = { ...result, message: result.message[locale] }
    console.log(values.json ? JSON.stringify({ ok: check.ok, checks: [check] }) : `${check.ok ? "✓" : "✗"} ${check.id}: ${check.message}`)
    process.exitCode = check.ok ? 0 : 1
  } catch (error) { console.error(error.message); process.exitCode = 2 }
} else if (process.argv.includes("--feedback") && !process.argv.includes("--facts") && !process.argv.includes("--self-test")) {
  try {
    const { values } = parseArgs({ options: { feedback: { type: "string" }, "allow-details": { type: "boolean" }, json: { type: "boolean" } } })
    const result = feedbackCheck(JSON.parse(readFileSync(values.feedback, "utf8")), values)
    const locale = (process.env.LC_ALL || process.env.LANG || "").startsWith("ko") ? "ko" : "en"
    const check = { ...result, message: result.message[locale] }
    console.log(values.json ? JSON.stringify({ ok: check.ok, checks: [check] }) : `${check.ok ? "✓" : "✗"} ${check.id}: ${check.message}`)
    process.exitCode = check.ok ? 0 : 1
  } catch (error) { console.error(error.message); process.exitCode = 2 }
} else await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--json] [--feedback <draft.json>] [--allow-details] | --update <update.json> --relay <message.txt>... [--applied] | --facts <file> | --self-test",
  options: { feedback: { type: "string" }, "allow-details": { type: "boolean" }, update: { type: "string" }, relay: { type: "string", multiple: true }, applied: { type: "boolean" } },
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
