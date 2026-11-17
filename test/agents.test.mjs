import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { agentCatalogs, agentRecommendations, agentsStatus, agentSuggestions, agentArgs, setAgent, decideAgentSuggestion, validateAgents, CLAUDE_MODELS } from "../src/agents.mjs"
import { START_STEPS } from "../src/start.mjs"
import { check } from "../src/check.mjs"
import { tempDir, workspace } from "./helpers.mjs"

function catalog() {
  const codexDir = tempDir()
  const file = join(codexDir, "models_cache.json")
  writeFileSync(file, readFileSync(new URL("./fixtures/agents/models_cache.json", import.meta.url)))
  const data = JSON.parse(readFileSync(file, "utf8"))
  return { codexDir, data, write() { writeFileSync(file, JSON.stringify(data)) } }
}
const settings = (model = "codex-third", effort = "high") => ({ worker: { tool: "codex", model, effort }, reviewers: [{ tool: "claude", model: "claude-opus-5-5", effort: "xhigh" }] })
const model = (slug, priority) => ({ slug, priority, visibility: "list", supported_reasoning_levels: [{ effort: "high" }, { effort: "xhigh" }] })
const config = (ws) => readFileSync(join(ws.root, "excudo.config.mjs"), "utf8")
let configImport = 0
const importedConfig = async (ws) => (await import(`${pathToFileURL(join(ws.root, "excudo.config.mjs")).href}?test=${configImport++}`)).default
const withoutManaged = (text) => text.replace(/^  \/\/ excudo:agents start[\s\S]*?^  \/\/ excudo:agents end\r?\n/gm, "")
async function complexConfig() {
  const ws = await workspace({})
  writeFileSync(join(ws.root, "excudo.config.mjs"), readFileSync(new URL("./fixtures/agents/config.mjs", import.meta.url)))
  writeFileSync(join(ws.root, "config-helper.mjs"), readFileSync(new URL("./fixtures/agents/config-helper.mjs", import.meta.url)))
  return ws
}
const cli = (ws, ...args) => spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "agents", ...args, "--root", ws.root], { encoding: "utf8" })

test("local catalogs filter visibility, sort priority and read root TOML defaults", () => {
  const local = catalog()
  writeFileSync(join(local.codexDir, "config.toml"), 'model = "codex-second" # selected\nmodel_reasoning_effort = \'xhigh\'\n[profiles.other]\nmodel = "ignored"\n')
  const result = agentCatalogs(local)
  assert.deepEqual(result.codex.models.map((item) => item.slug), ["codex-top", "codex-second", "codex-third"])
  assert.deepEqual(result.codex.defaults, { model: "codex-second", effort: "xhigh" })
  assert.deepEqual(CLAUDE_MODELS.map((item) => item.slug), ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"])
  assert.deepEqual(agentCatalogs({ codexDir: tempDir() }).codex.models, [])
})

test("recommendations exclude top models, include another provider and never fall back to top", () => {
  const catalogs = agentCatalogs(catalog())
  const rec = agentRecommendations(catalogs)
  assert.deepEqual(rec.worker, { tool: "codex", model: "codex-second", effort: "high" })
  assert.deepEqual(rec.reviewers[0], { tool: "claude", model: "claude-opus-5-5", effort: "xhigh" })
  assert.equal(agentRecommendations(catalogs, "claude").reviewers[0].tool, "codex")
  catalogs.codex.models.length = 1
  assert.equal(agentRecommendations(catalogs).worker.model, null)
})

test("explicit top choices are allowed; values identify their source and the optional step is done", async () => {
  const local = catalog(), ws = await workspace({}, { agents: settings("codex-top") })
  const status = agentsStatus(ws, local)
  assert.equal(status.roles[0].userSelectedTop, true)
  assert.equal(status.roles[0].model.source, "config")
  assert.deepEqual(validateAgents(ws, agentCatalogs(local)), [])
  assert.equal(START_STEPS.find((step) => step.id === "agents").done(ws), true)
  const empty = agentsStatus({ ...ws, agents: undefined }, local)
  assert.equal(empty.roles[0].model.source, "unset")
  assert.equal(empty.roles[0].tool.value, null)
  writeFileSync(join(local.codexDir, "config.toml"), 'model="codex-second"\nmodel_reasoning_effort="high"')
  const inherited = agentsStatus({ ...ws, agents: { worker: { tool: "codex" } } }, local).roles[0]
  assert.deepEqual(inherited.model, { value: "codex-second", source: "tool-default" })
  assert.equal(agentArgs({ ...ws, agents: { worker: { tool: "codex", model: "", effort: "" } } }, "worker", local).args, "--agent codex")
})

test("higher new models suggest once; notification and decline persist independently", async () => {
  const local = catalog(), ws = await workspace({}, { agents: settings() })
  assert.deepEqual(agentSuggestions(ws, local), [])
  local.data.models.push(model("codex-new-top", 0), model("codex-new-second", 2)); local.write()
  const suggestions = agentSuggestions(ws, local)
  assert.equal(suggestions[0].model, "codex-new-second")
  assert.equal(suggestions[0].reason, "new")
  assert.equal(agentSuggestions(ws, { ...local, fresh: true }).length, 1)
  assert.equal(agentSuggestions(ws, { ...local, fresh: true }).length, 0)
  assert.equal(agentArgs(ws, "worker", local).suggestions.length, 1)
  decideAgentSuggestion(ws, suggestions[0].id, "declined", local)
  assert.deepEqual(agentSuggestions(ws, local), [])
  const state = JSON.parse(readFileSync(join(ws.cacheDir, "agents.json")))
  assert.ok(state.firstFingerprint && state.fingerprint && state.suggestions[suggestions[0].id].notifiedAt)
  assert.equal(state.suggestions[suggestions[0].id].status, "declined")
})

test("a previous explicit top choice may be offered a new top", async () => {
  const local = catalog(), ws = await workspace({}, { agents: settings("codex-top") })
  agentsStatus(ws, local)
  local.data.models.push(model("codex-new-top", 0)); local.write()
  assert.equal(agentSuggestions(ws, local)[0].model, "codex-new-top")
})

test("a missing catalog can later establish an explicit top choice", async () => {
  const local = catalog(), ws = await workspace({}, { agents: settings("codex-top") })
  const models = local.data.models
  local.data.models = []; local.write()
  agentsStatus(ws, local)
  local.data.models = models; local.write()
  assert.equal(agentsStatus(ws, local).roles[0].userSelectedTop, true)
  local.data.models.push(model("codex-new-top", 0)); local.write()
  assert.equal(agentSuggestions(ws, local)[0].model, "codex-new-top")
})

test("upgrade fields and missing models propose allowed replacements and accept edits only agents", async () => {
  const local = catalog(), ws = await workspace({}, { agents: settings() })
  local.data.models.find((item) => item.slug === "codex-third").upgrade = { model: "codex-second" }; local.write()
  const suggestion = agentSuggestions(ws, local)[0]
  assert.equal(suggestion.reason, "upgrade")
  decideAgentSuggestion(ws, suggestion.id, "accepted", local)
  assert.equal((await importedConfig(ws)).agents.worker.model, "codex-second")
  assert.equal(JSON.parse(readFileSync(join(ws.cacheDir, "agents.json"))).suggestions[suggestion.id].status, "accepted")
  const missing = await workspace({}, { agents: settings("codex-retired") })
  assert.equal(agentSuggestions(missing, local)[0].reason, "missing")
  assert.equal(agentSuggestions(missing, local)[0].model, "codex-second")
  local.data.models.find((item) => item.slug === "codex-third").upgrade = "codex-top"; local.write()
  const blocked = await workspace({}, { agents: settings("codex-second") })
  assert.deepEqual(agentSuggestions(blocked, local), [])
  local.data.models.find((item) => item.slug === "codex-third").upgrade = true; local.write()
  const flagged = await workspace({}, { agents: settings() })
  assert.equal(agentSuggestions(flagged, local)[0].model, "codex-second")

  assert.deepEqual(agentSuggestions({ ...missing, agents: { ...missing.agents, suggest: false } }, local), [])
})

test("args use explicit values for orca and either CLI, omit defaults, and reject invalid selectors", async () => {
  const ws = await workspace({}, { agents: settings() }), local = catalog()
  assert.equal(agentArgs(ws, "worker", local).args, "--agent codex --model codex-third --effort high")
  assert.equal(agentArgs(ws, "worker", { ...local, target: "cli" }).args, "-m codex-third -c model_reasoning_effort=high")
  assert.equal(agentArgs(ws, "reviewer", { ...local, target: "cli" }).args, "--model claude-opus-5-5 --effort xhigh")
  const defaults = { ...ws, agents: { worker: { tool: "claude", model: "", effort: "" } } }
  assert.equal(agentArgs(defaults, "worker", { ...local, target: "cli" }).args, "")
  assert.throws(() => agentArgs(ws, "worker", { index: -1 }), /index/)
  assert.throws(() => agentArgs(ws, "reviewer", { index: 5 }), /unset/)
  assert.throws(() => agentArgs(ws, "worker", { target: "shell" }), /--for/)
  const ko = await workspace({}, { locale: "ko", agents: { worker: { tool: "claude", model: "retired", effort: "high" } } })
  const run = cli(ko, "args", "worker", "--for", "orca")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /--agent claude --model retired --effort high/)
  assert.match(run.stderr, /사용자에게 먼저.*excudo agents accept/)
})

test("configuration editing preserves comments, unrelated expressions and suggest, and rejects unsafe syntax", async () => {
  const ws = await workspace({})
  const file = join(ws.root, "excudo.config.mjs")
  writeFileSync(file, '// settings\nexport default {\n graph: "notes", // keep me\n site: { out: "web", onSave: false } // no comma\n}\n')
  setAgent(ws, "worker", { tool: "claude", model: "claude-fable-5-2", effort: "max" })
  assert.match(config(ws), /\/\/ keep me/)
  assert.match(config(ws), /site: \{ out: "web", onSave: false \} \/\/ no comma/)
  assert.match(config(ws), /claude-fable-5-2/)
  setAgent(ws, "reviewer", { tool: "claude", model: "", effort: "" })
  assert.match(config(ws), /"reviewers"/)
  const strings = "export default { agents: { worker: { tool: 'claude', model: 'claude-opus-5-5', effort: 'high' }, suggest: false, label: 'keep me' } }"
  writeFileSync(file, strings)
  setAgent(ws, "reviewer", { tool: "claude", model: "", effort: "" })
  assert.match(config(ws), /"suggest": false/)
  assert.match(config(ws), /"label": "keep me"/)
  const before = config(ws)
  assert.throws(() => setAgent(ws, "worker", { tool: "unknown" }), /Unknown agent tool/)
  assert.equal(config(ws), before)
  for (const unsafe of ['const settings = {}; export default settings', 'export default { ...other }', 'export default { agents: makeAgents() }', 'export default { agents: {}, agents: {} }', 'export default { agents: {} }; mutate()']) {
    writeFileSync(file, unsafe)
    assert.throws(() => setAgent(ws, "worker", { tool: "claude", model: "claude-opus-5-5", effort: "high" }), /Cannot safely edit[\s\S]*Set only agents/)
    assert.equal(config(ws), unsafe)
  }
})

test("managed agents edits preserve arbitrary surrounding JavaScript byte for byte", async () => {
  const ws = await complexConfig()
  const original = config(ws)
  setAgent(ws, "worker", { tool: "claude", model: "claude-opus-5-5", effort: "high" })
  assert.equal(withoutManaged(config(ws)), original)
  assert.match(config(ws), /export default \{\n  \/\/ excudo:agents start/)
  assert.equal((await importedConfig(ws)).agents.worker.model, "claude-opus-5-5")
  setAgent(ws, "reviewer", { tool: "claude", model: "claude-sonnet-5-5", effort: "xhigh" })
  assert.equal(withoutManaged(config(ws)), original)
  const actual = await importedConfig(ws)
  assert.equal(actual.agents.worker.model, "claude-opus-5-5")
  assert.equal(actual.agents.reviewers[0].effort, "xhigh")
  assert.equal(actual.graph, "notes")
  assert.equal(actual.script("agents: { demo }"), "agents: { demo }:notes")
  assert.equal((config(ws).match(/excudo:agents start/g) ?? []).length, 1)
})

test("literal agents migrate to a managed region without changing other source bytes", async () => {
  const ws = await complexConfig(), file = join(ws.root, "excudo.config.mjs")
  const untouched = config(ws)
  const old = 'agents: { worker: { tool: "claude", model: "claude-opus-5-5", effort: "high" }, suggest: false },'
  const original = untouched.replace("  // Keep this comment", `  ${old}\n  // Keep this comment`)
  writeFileSync(file, original)
  setAgent(ws, "reviewer", { tool: "claude", model: "claude-sonnet-5-5", effort: "xhigh" })
  assert.equal(withoutManaged(config(ws)), original.replace(old, ""))
  assert.equal((await importedConfig(ws)).agents.suggest, false)
})

test("accept works with complex settings and changes only the managed region", async () => {
  const ws = await complexConfig(), local = catalog()
  const untouched = config(ws)
  setAgent(ws, "worker", { tool: "codex", model: "codex-third", effort: "high" })
  local.data.models.find((item) => item.slug === "codex-third").upgrade = "codex-second"; local.write()
  const current = { ...ws, agents: (await importedConfig(ws)).agents }
  const suggestion = agentSuggestions(current, local)[0]
  decideAgentSuggestion(current, suggestion.id, "accepted", local)
  assert.equal((await importedConfig(ws)).agents.worker.model, "codex-second")
  assert.equal(withoutManaged(config(ws)), untouched)
})

test("an overriding spread or failed import rolls back the original bytes", async () => {
  const ws = await workspace({}), file = join(ws.root, "excudo.config.mjs")
  for (const original of [
    'const other = { agents: { worker: { tool: "claude", model: "old" } } }\nexport default {\n  ...other,\n}\n',
    'throw new Error("fixture import failure")\nexport default {\n  graph: "notes",\n}\n',
    'const key = ["ag", "ents"].join("")\nexport default {\n [key]: { worker: { tool: "claude", model: "old" } },\n}\n',
  ]) {
    writeFileSync(file, original)
    assert.throws(() => setAgent(ws, "worker", { tool: "claude", model: "claude-opus-5-5", effort: "high" }), /Import verification failed/)
    assert.deepEqual(readFileSync(file), Buffer.from(original))
  }
})

test("ambiguous exports, nonliteral roles and malformed managed regions require manual edits", async () => {
  const ws = await workspace({}), file = join(ws.root, "excudo.config.mjs")
  for (const original of [
    'const agents = {}\nexport default { agents }',
    'const agents = {}\nexport default { agents: agents }',
    'const sample = `\nexport default {\n`\nexport default { graph: "notes" }',
    'export default {\n // excudo:agents start\n agents: {},\n graph: "notes",\n // excudo:agents end\n}',
    'export default {\n agents: {},\n // excudo:agents end\n}',
  ]) {
    writeFileSync(file, original)
    assert.throws(() => setAgent(ws, "worker", { tool: "claude", model: "claude-opus-5-5", effort: "high" }), /Cannot safely edit[\s\S]*Set only agents/)
    assert.equal(config(ws), original)
  }
})

test("human status labels fields, simplifies unset roles and numbers reviewers from one", async () => {
  for (const locale of ["en", "ko"]) {
    const empty = await workspace({}, { locale })
    const unset = cli(empty).stdout
    if (locale === "ko") {
      assert.match(unset, /작업자: 미정 \(excudo agents set worker로 정합니다\)/)
      assert.match(unset, /독립 검토자 1: 미정 \(excudo agents set reviewer --index 0로 정합니다\)/)
      assert.match(unset, /검토자 번호는 1부터, --index는 0부터/)
    } else {
      assert.match(unset, /Worker: unset \(set with excudo agents set worker\)/)
      assert.match(unset, /Independent reviewer 1: unset/)
      assert.match(unset, /Reviewer numbers start at 1; --index starts at 0/)
    }
    const selected = await workspace({}, { locale, agents: { worker: { tool: "claude", model: "claude-fable-5-2", effort: "high" }, reviewers: [{ tool: "claude", model: "claude-opus-5-5", effort: "xhigh" }] } })
    const shown = cli(selected).stdout
    assert.match(shown, locale === "ko" ? /작업자: 도구 claude · 모델 claude-fable-5-2\(설정\) · 추론 high\(설정\) · 최상위\(추정\), 사용자 선택/
      : /Worker: tool claude · model claude-fable-5-2\(settings\) · effort high\(settings\) · top \(estimated\), user selected/)
    assert.doesNotMatch(shown, /(?:독립 검토자|Independent reviewer) 0:/)
  }
})

test("check reports unknown tools and model-specific efforts; setup checker covers invalid agents", async () => {
  const ws = await workspace({}, { agents: { worker: { tool: "unknown" } } })
  const result = await check(ws)
  assert.ok(result.issues.some((item) => item.code === "agents-setting" && /Unknown/.test(item.message)))
  const catalogs = agentCatalogs(catalog())
  assert.match(validateAgents({ ...ws, agents: { worker: { tool: "codex", model: "codex-top", effort: "max" } } }, catalogs)[0], /Unsupported/)
  assert.match(validateAgents({ ...ws, agents: { worker: { tool: "claude", effort: "minimal" } } }, catalogs)[0], /Unsupported/)
  const run = spawnSync(process.execPath, [resolve("skills/excudo-setup/scripts/check.mjs"), "--self-test"], { encoding: "utf8" })
  assert.equal(run.status, 0, run.stdout + run.stderr)
})

test("CLI set, JSON status and decline round trip without changing other configuration", async () => {
  const ws = await workspace({})
  const run = cli(ws, "set", "worker", "--tool", "claude", "--model", "retired", "--effort", "high")
  assert.equal(run.status, 0, run.stderr)
  const status = JSON.parse(cli(ws, "--json").stdout)
  assert.equal(status.roles[0].model.value, "retired")
  assert.equal(status.suggestions.length, 1)
  assert.equal(cli(ws, "decline", status.suggestions[0].id).status, 0)
  assert.equal(JSON.parse(cli(ws, "suggest", "--json").stdout).length, 0)
  assert.equal(cli(ws, "set", "reviewer", "--index", "2", "--tool", "claude", "--model", "", "--effort", "").status, 1)
})
