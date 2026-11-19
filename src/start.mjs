// The first steps of a new owner, from nothing to a memo in use, in one place (`excudo start`). Each
// step says how to take it, from the command line (`run`) or by asking an agent (`ask`, in labels), and
// how to tell it is done on this computer. The README's start section is written from this list
// (`npm run start-docs`), and the setup skill takes the same steps.
//
// The list stays true as the engine grows: every command the help shows, every setting and every
// skill is classified below, by the step it belongs to or `false` when a first-time owner need not
// meet it. test/start.test.mjs fails on one left out, and on a README or setup skill that no longer
// matches, so a change that touches the first steps cannot land without them.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { prepare } from "./build.mjs"
import { conversationsOf } from "./requests.mjs"
import { ownedHome } from "./tree.mjs"
import { publishState } from "./publish.mjs"
import { pullScheduleState } from "./schedule.mjs"
import { siteIdOf } from "./site-runtime.mjs"
import { siteOf } from "./site.mjs"

/** The Node.js the engine needs. */
export const NODE_NEEDED = "22.16.0"
const atLeast = (version, needed) => {
  const [a, b] = [version, needed].map((text) => text.replace(/^v/, "").split(".").map(Number))
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}
const inGit = (dir) => spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" }).status === 0
const safely = (test) => { try { return Boolean(test()) } catch { return false } }
/**
 * Learning from requests runs when some tool's logs are read (not `false`, not both turned off) and the
 * `interests` setting names a node that exists, the lookup the reflect skill's check makes too.
 */
const learning = (ws) => {
  const where = conversationsOf(ws)
  return Boolean(where && (where.claude || where.codex) && ws.interests && prepare(ws).model.find(ws.interests))
}
/**
 * The inbox is ready once Vercel holds its token and something brings the changes in: the engine's
 * schedule, unless the settings leave that to a schedule of the owner's own (`schedule: false`).
 */
const inboxReady = (ws) => {
  const site = siteOf(ws, { defaults: true })
  if (!site.inbox || !publishState(ws).inbox?.tokenAt) return false
  return !site.inbox.schedule || pullScheduleState(siteIdOf(ws, site)) !== "missing"
}

/**
 * The steps, in order: `required` ones make a memo in use, the others add to it. `done(ws)` is true,
 * false, or null where this computer cannot tell (Tine on a phone). `needs` names a step that comes
 * first. `run` is the command, from the workspace unless it creates it; `setting` is what the settings
 * need first, unless `set(ws)` finds it there.
 */
export const START_STEPS = [
  { id: "node", required: true, run: null, link: "https://nodejs.org", done: () => atLeast(process.versions.node, NODE_NEEDED) },
  { id: "workspace", required: true, run: "npx -y excudo init my-memo", done: (ws) => ws.hasConfig },
  { id: "install", required: true, run: "npm install", done: (ws) => ws.hasConfig && existsSync(join(ws.root, "node_modules", "excudo", "package.json")) },
  { id: "git", required: true, run: "git init", done: (ws) => ws.hasConfig && inGit(ws.root) },
  { id: "skills", required: true, run: "npx --no-install excudo skills", done: (ws) => ws.hasConfig && existsSync(join(ws.root, ".agents", "skills", "excudo-setup", "SKILL.md")) },
  { id: "agents", required: false, run: "npx --no-install excudo agents", done: (ws) => ws.hasConfig && Boolean(ws.agents?.worker && Array.isArray(ws.agents?.reviewers)) },
  { id: "learn", required: false, run: null, setting: 'conversations: true, interests: "Interests"', probe: (ws) => ws.hasConfig && safely(() => learning(ws)),
    set: (ws, known = safely(() => learning(ws))) => known, done: (ws, known = ws.hasConfig && safely(() => learning(ws))) => known },
  { id: "tine", required: false, run: null, link: "https://tine.page", done: () => null },
  { id: "phone", required: false, run: null, link: "https://syncthing.net", done: () => null },
  { id: "home", required: false, run: "npx --no-install excudo home --own", done: (ws) => ws.hasConfig && safely(() => ownedHome(ws)) },
  { id: "sources", required: false, run: "npx --no-install excudo sources", done: (ws) => ws.hasConfig && (ws.sources ?? []).length > 0 },
  { id: "site", required: false, run: "npx --no-install excudo site setup", done: (ws) => ws.hasConfig && safely(() => publishState(ws).url) },
  { id: "inbox", required: false, needs: "site", run: "npx --no-install excudo site setup", setting: "site: { inbox: true }", set: (ws) => ws.hasConfig && safely(() => siteOf(ws)?.inbox),
    done: (ws) => ws.hasConfig && safely(() => inboxReady(ws)) },
]
const STEP_IDS = new Set(START_STEPS.map((step) => step.id))

/**
 * Every command the help shows, by the first step it belongs to, or false for the memo's daily use.
 * A new command is added here; the test reads the help and finds one left out.
 */
export const COMMAND_STEPS = {
  init: "workspace", build: false, home: "home", check: false, tree: false, review: false, "review keep": false, move: false, rename: false,
  remove: false, find: false, inbox: false, archive: false, sources: "sources", "sources script": false, ingest: false, changes: false,
  "changes mark": false, requests: false, "requests mark": false, workspaces: false, "workspaces untrack": false, "workspaces track": false,
  fix: false, snapshot: false, save: false, idle: false, activity: false, "activity show": false, sessions: false, queue: false,
  "queue report": false, runs: false, "runs add": false, backup: false, export: false, site: false, "site setup": "site", "site publish": false,
  "site open": "site", "site status": "site", "site pull": "inbox", receive: false, skills: "skills", "skills lint": false, "skills status": false,
  "skills candidates": false, "skills adopt": false, "skills dismiss": false, "skills mistake": false, "skills retire": false, "skills upkeep": false,
  agents: "agents", "agents args": false, "agents suggest": false, "agents accept": false, "agents decline": false, "agents set": "agents",
  start: "workspace", update: false, feedback: false, instructions: false, "instructions move": false, mirror: false, "mirror mark": false, "mirror text": false,
}

/** Every setting, by the step that sets it, or false when the defaults serve a new owner. */
export const SETTING_STEPS = {
  graph: "workspace", locale: "workspace", private: false, summaryMax: false, topSummaryMax: false, widthMax: false, taskMax: false, doingMax: false, doneKeep: false,
  staleDays: false, keepDays: false, bodyMax: false, cache: false, sources: "sources", knowledge: false, interests: "learn", conversations: "learn",
  moved: false, skills: false, "skills.keep": false, instructions: false, "instructions.limit": false, "instructions.target": false, "instructions.auto": false, "instructions.keep": false, exports: false, mirrors: false, queue: false, agents: "agents", site: "site",
  "site.out": false, "site.title": false, "site.mode": false, "site.open": false, "site.journals": false, "site.css": false, "site.id": false,
  "site.onSave": false, "site.inbox": "inbox", "site.publish": "site", "site.inbox.github": false, "site.inbox.schedule": false,
  "site.publish.host": false, "site.publish.project": false, "site.publish.dir": false, "site.publish.open": false, "site.publish.close": false,
  "site.publish.copy": false, "site.dashboard": false,
}

/** Every skill the engine installs, by the step that uses it, or false for daily use. */
export const SKILL_STEPS = {
  "excudo-setup": "skills", "excudo-capture": false, "excudo-distill": false, "excudo-export": false, "excudo-follow": false,
  "excudo-queue": false, "excudo-recall": false, "excudo-reflect": "learn", "excudo-skills": "learn", "excudo-sources": "sources",
}

/** Whether every classification names a known step. */
export const unknownSteps = () => [COMMAND_STEPS, SETTING_STEPS, SKILL_STEPS].flatMap((map) => Object.entries(map))
  .filter(([, step]) => step !== false && !STEP_IDS.has(step)).map(([name, step]) => `${name}: ${step}`)

/**
 * Where a workspace stands: `{ steps: [{ id, required, done, title, how, run, ask, link }], next }`,
 * `next` being the first required step not done, else the first other step not done.
 */
export function startStatus(ws) {
  const words = ws.labels.start
  const steps = START_STEPS.map((step) => {
    // A step that is costly to judge says once (`probe`) what its done and set both use.
    let known
    try { known = step.probe?.(ws) } catch { known = false }
    let done
    try { done = step.done(ws, known) } catch { done = false }
    let set
    try { set = step.set?.(ws, known) } catch { set = false }
    return { id: step.id, required: step.required, needs: step.needs ?? null, done: done === null ? null : Boolean(done), run: step.run, link: words.steps[step.id].link ?? step.link ?? null,
      setting: step.setting && !set ? step.setting : null, title: words.steps[step.id].title, how: words.steps[step.id].how, ask: words.steps[step.id].ask ?? null }
  })
  const ready = (step) => !step.needs || steps.find((other) => other.id === step.needs)?.done
  const next = steps.find((step) => step.required && step.done === false) ?? steps.find((step) => !step.required && step.done === false && ready(step)) ?? null
  return { steps, next: next?.id ?? null }
}

/** Progress inferred from local checks, rather than a record of choices the owner made. */
export function startReport(ws) {
  const status = startStatus(ws)
  if (ws.configurationFailure) {
    const workspace = status.steps.find((step) => step.id === "workspace")
    workspace.done = false
    status.next = status.steps.find((step) => step.required && !step.done)?.id ?? "workspace"
  }
  return { ...status, ...(ws.configurationFailure ? { configurationError: { id: "configuration-load", code: ws.configurationFailure.code } } : {}), stoppedAt: status.next, basis: "local-checks", steps: status.steps.map((step) => ({ ...step,
    state: step.done === null ? "unknown" : step.done ? "done" : "not-done", stopped: step.id === status.next })) }
}

/** The README's start section, written from the steps in the workspace's language. */
export function startMarkdown(labels) {
  const words = labels.start
  const line = (step, n) => {
    const text = words.steps[step.id]
    const parts = [`**${text.title}**: ${text.how}`]
    if (step.setting) parts.push(`\`${step.setting}\``)
    if (step.run) parts.push(`\`${step.run}\``)
    if (text.ask) parts.push(`${words.askLabel} “${text.ask}”`)
    if (text.link ?? step.link) parts.push(text.link ?? step.link)
    return `${n}. ${parts.join("; ")}`
  }
  const required = START_STEPS.filter((step) => step.required)
  const optional = START_STEPS.filter((step) => !step.required)
  return [`${words.required}`, "", ...required.map((step, i) => line(step, i + 1)), "", `${words.optional}`, "",
    ...optional.map((step, i) => line(step, i + 1)), "", words.status, ""].join("\n")
}
