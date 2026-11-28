import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { DEFAULTS, LOCALES, skillNames } from "../src/index.mjs"
import { PUBLISH_KEYS } from "../src/publish.mjs"
import { installPullSchedule } from "../src/schedule.mjs"
import { siteIdOf } from "../src/site-runtime.mjs"
import { INBOX_KEYS, SITE_KEYS, siteOf } from "../src/site.mjs"
import { COMMAND_STEPS, SETTING_STEPS, SKILL_STEPS, START_STEPS, startStatus, unknownSteps } from "../src/start.mjs"
import { READMES, withStartSection } from "../scripts/start-docs.mjs"
import { tempDir, workspace } from "./helpers.mjs"

/*
 * The first steps of a new owner stay true as the engine grows. What the engine offers (the commands
 * its help shows, its settings, its skills) is classified in src/start.mjs, by the first step it
 * belongs to or false; the README's start section and the setup skill follow the same list. A change
 * that adds or renames one of them fails here until the first steps say how a new owner meets it.
 */
const cli = resolve("bin/excudo.mjs")
const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout
/** The commands and subcommands the help lists, as `site setup`, `review keep` or `init`. */
const helpEntries = () => [...new Set(help.split("\n").map((line) => line.match(/^ {2}([a-z][a-z-]*)(?: ([a-z][a-z-]*)(?= |$))?/)).filter(Boolean)
  .map(([, command, sub]) => (sub ? `${command} ${sub}` : command)))].sort()

test("every command the help shows is placed in the first steps, or marked as daily use", () => {
  const missing = helpEntries().filter((entry) => !(entry in COMMAND_STEPS))
  const gone = Object.keys(COMMAND_STEPS).filter((entry) => !helpEntries().includes(entry))
  assert.deepEqual(missing, [], "a new command: say in COMMAND_STEPS (src/start.mjs) which first step it belongs to, or false")
  assert.deepEqual(gone, [], "a command the help no longer shows: take it out of COMMAND_STEPS and the first steps")
})

test("every setting is placed in the first steps, or marked as one the defaults serve", () => {
  const settings = [...Object.keys(DEFAULTS), "skills.keep", ...Object.keys(DEFAULTS.instructions).map((key) => `instructions.${key}`), ...SITE_KEYS.map((key) => `site.${key}`), ...PUBLISH_KEYS.map((key) => `site.publish.${key}`),
    ...INBOX_KEYS.map((key) => `site.inbox.${key}`)].sort()
  assert.deepEqual(Object.keys(SETTING_STEPS).sort(), settings, "a new or renamed setting: say in SETTING_STEPS (src/start.mjs) which first step sets it, or false")
})

test("every skill is placed in the first steps, and every step's request reaches a skill", () => {
  assert.deepEqual(Object.keys(SKILL_STEPS).sort(), skillNames().sort(), "a new skill: say in SKILL_STEPS (src/start.mjs) which first step uses it, or false")
  assert.deepEqual(unknownSteps(), [], "a classification names a step that does not exist")
  const descriptions = skillNames().map((name) => readFileSync(resolve("skills", name, "SKILL.md"), "utf8").match(/^description: (.*)$/m)[1]).join("\n")
  for (const locale of ["en", "ko"]) {
    for (const step of START_STEPS) {
      const ask = LOCALES[locale].start.steps[step.id].ask
      if (ask) assert.ok(descriptions.includes(ask), `${locale}: the request for ${step.id}, “${ask}”, is in no skill's description, so an agent would not find the skill`)
    }
  }
})

test("each step has its words in both languages, and the setup skill takes every step's command", () => {
  const setup = readFileSync(resolve("skills/excudo-setup/SKILL.md"), "utf8")
  assert.match(setup, /excudo start/, "the setup skill starts from excudo start")
  const commands = Object.keys(COMMAND_STEPS).sort((a, b) => b.length - a.length)
  for (const step of START_STEPS) {
    for (const locale of ["en", "ko"]) {
      const words = LOCALES[locale].start.steps[step.id]
      assert.ok(words?.title && words?.how, `${locale}: the words of ${step.id}`)
    }
    if (!step.run) continue
    const rest = step.run.replace(/^npx (?:-y|--no-install) excudo /, "")
    const named = rest === step.run ? step.run : `excudo ${commands.find((command) => rest === command || rest.startsWith(`${command} `))}`
    assert.ok(setup.includes(named), `the setup skill does not say ${named} (step ${step.id})`)
  }
})

test("the READMEs' start sections are the first steps as the engine keeps them", () => {
  for (const [locale, url] of Object.entries(READMES)) {
    const text = readFileSync(url, "utf8")
    assert.equal(withStartSection(text, locale), text, `${locale}: run npm run start-docs`)
  }
})

test("excudo start says where a new owner stands, with or without a workspace", () => {
  const empty = tempDir()
  const before = JSON.parse(spawnSync(process.execPath, [cli, "start", "--json"], { cwd: empty, encoding: "utf8", env: { ...process.env, EXCUDO_ROOT: "" } }).stdout)
  assert.equal(before.next, "workspace")
  assert.equal(before.steps.find((step) => step.id === "workspace").run, "npx -y excudo init my-memo")
  const koEnv = { ...process.env, EXCUDO_ROOT: "", LANG: "ko_KR.UTF-8", LC_ALL: "ko_KR.UTF-8" }
  delete koEnv.LC_MESSAGES
  const words = spawnSync(process.execPath, [cli, "start"], { cwd: empty, encoding: "utf8", env: koEnv }).stdout
  assert.match(words, /다음: 작업 폴더[\s\S]*실행: npx -y excudo init my-memo[\s\S]*메모를 새로 만들어 줘/)
  spawnSync(process.execPath, [cli, "init", "memo", "--locale", "en"], { cwd: empty, encoding: "utf8", env: { ...process.env, EXCUDO_PACKAGE: resolve(".") } })
  const made = JSON.parse(spawnSync(process.execPath, [cli, "start", "--json"], { cwd: resolve(empty, "memo"), encoding: "utf8" }).stdout)
  assert.deepEqual(made.steps.filter((step) => step.done).map((step) => step.id), ["node", "workspace", "skills"])
  assert.equal(made.next, "install", "npm install comes next")
  assert.ok(readdirSync(resolve(empty, "memo")).includes("excudo.config.mjs"))
})

test("the learning step is done only when a tool's logs are read and the interests node exists", async () => {
  const learn = START_STEPS.find((step) => step.id === "learn")
  assert.equal(learn.required, false)
  const done = async (settings) => learn.done(await workspace({}, settings))
  const make = async (settings, nodes = {}) => workspace(nodes, settings)
  assert.equal(await done({ conversations: false, interests: "Interests" }), false, "reading requests is off")
  assert.equal(await done({ conversations: true }), false, "no interests setting")
  assert.equal(await done({ conversations: true, interests: "Interests" }), false, "the node does not exist")
  const withNode = async (settings) => learn.done(await make(settings, { "Interests.md": "- Lasting decisions\n" }))
  assert.equal(await withNode({ conversations: true, interests: "Interests" }), true)
  assert.equal(await withNode({ conversations: { claude: "~/logs" }, interests: "Interests" }), true)
  assert.equal(await withNode({ conversations: { codex: "~/logs" }, interests: "Interests" }), true)
  assert.equal(await withNode({ conversations: { claude: false, codex: false }, interests: "Interests" }), false, "both tools turned off")
  // A setting of the wrong shape neither throws nor stops the report.
  for (const conversations of [{ claude: true, codex: false }, { exclude: "~/work" }]) {
    const ws = await make({ conversations, interests: "Interests" }, { "Interests.md": "- Lasting decisions\n" })
    assert.equal(learn.done(ws), false)
    assert.doesNotThrow(() => learn.set(ws))
    assert.equal(startStatus(ws).steps.find((step) => step.id === "learn").done, false)
    assert.ok(startStatus(ws).steps.find((step) => step.id === "learn").setting, "the settings are shown again")
  }
  assert.match(learn.setting, /conversations: true.*interests/, "the step shows both settings")
  assert.equal(SETTING_STEPS.conversations, "learn")
  assert.equal(SETTING_STEPS.interests, "learn")
  assert.deepEqual(["excudo-reflect", "excudo-skills"].map((name) => SKILL_STEPS[name]), ["learn", "learn"])
  for (const locale of ["en", "ko"]) assert.match(LOCALES[locale].start.steps.learn.how, /docs\//)
})

test("the inbox step is done once Vercel holds the token and something brings the changes in", async () => {
  const inbox = START_STEPS.find((step) => step.id === "inbox")
  const ws = await workspace({}, { site: { onSave: false, inbox: { github: { repo: "me/inbox" } } } })
  assert.equal(inbox.done(ws), false, "no token yet")
  mkdirSync(ws.cacheDir, { recursive: true })
  writeFileSync(join(ws.cacheDir, "publish.json"), JSON.stringify({ inbox: { repo: "me/inbox", tokenAt: 1 } }))
  assert.equal(inbox.done(ws), false, "the engine's schedule is not installed: setup failed after publishing")
  installPullSchedule(ws, { siteId: siteIdOf(ws, siteOf(ws, { defaults: true })), gh: null })
  assert.equal(inbox.done(ws), true)
  const own = await workspace({}, { site: { onSave: false, inbox: { github: { repo: "me/inbox" }, schedule: false } } })
  mkdirSync(own.cacheDir, { recursive: true })
  writeFileSync(join(own.cacheDir, "publish.json"), JSON.stringify({ inbox: { repo: "me/inbox", tokenAt: 1 } }))
  assert.equal(inbox.done(own), true, "the owner's own schedule brings them in")
})

test("start --report reports every step and where to continue without creating state", async () => {
  const ws = await workspace({})
  const before = readdirSync(ws.root).sort()
  const run = (...args) => spawnSync(process.execPath, [cli, "start", "--report", "--root", ws.root, ...args], { encoding: "utf8" })
  const json = run("--json")
  assert.equal(json.status, 0, json.stderr)
  const report = JSON.parse(json.stdout)
  assert.equal(report.basis, "local-checks")
  assert.equal(report.stoppedAt, "install")
  assert.equal(report.steps.length, START_STEPS.length)
  assert.equal(report.steps.find((step) => step.id === "workspace").state, "done")
  assert.equal(report.steps.find((step) => step.id === "install").stopped, true)
  assert.equal(report.steps.find((step) => step.id === "tine").state, "unknown")
  assert.match(run().stdout, /workspace: done[\s\S]*install: not done \(continue here\)/)
  assert.deepEqual(readdirSync(ws.root).sort(), before)
  assert.equal(existsSync(ws.cacheDir), false)
})
