// How the work around the memo stands, for a view's ```status fence: the scheduled runs of the last
// days, the tasks handed to agents, how the skills' checks went, when each outside source was last
// read, and the questions a reflection left for the owner. Every line is the engine's own words.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { format } from "./labels.mjs"
import { queueItems } from "./queue.mjs"
import { failing, runRecords, skillRuns } from "./records.mjs"
import { listSources } from "./sources.mjs"

const pad = (n) => String(n).padStart(2, "0")
const when = (time) => { if (!time) return "-"; const d = new Date(time); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const safely = (fn, fallback) => { try { return fn() } catch { return fallback } }

/** The ```status fence of a view as outline text (`days: <n>` sets the window of runs, 7 unless set). */
export function statusOutline(ws, prepared, spec = "", { now = new Date() } = {}) {
  const words = ws.labels.status
  const days = Number(String(spec).match(/\bdays:\s*(\d+)/)?.[1] ?? 7)
  const lines = []

  const runs = safely(() => runRecords(ws, { days, now }), [])
  const steps = new Map()
  for (const run of runs) (steps.get(run.step) ?? steps.set(run.step, []).get(run.step)).push(run)
  lines.push(`- ${format(words.runs, { days })}`)
  if (!steps.size) lines.push(`\t- ${words.runsNone}`)
  for (const [step, list] of steps) {
    const count = (status) => list.filter((run) => run.status === status).length
    const last = list[0]
    lines.push(`\t- ${[step, format(words.last, { at: when(last.finished ?? last.started), status: words.states[last.status] ?? last.status }),
      ...["ok", "failed", "deferred", "paused"].filter((status) => count(status)).map((status) => `${words.states[status]} ${count(status)}`)].join(" · ")}`)
  }

  const items = safely(() => queueItems(ws, { prepared }), [])
  const ready = items.filter((item) => item.status === "ready")
  const waiting = items.filter((item) => item.status === "waiting")
  lines.push(`- ${format(words.queue, { ready: ready.length, waiting: waiting.length })}`)
  if (!items.length) lines.push(`\t- ${words.queueNone}`)
  for (const item of [...waiting, ...ready])
    lines.push(`\t- ${[words[item.status], item.node ? `[[${item.node}]]` : item.file, item.title.replace(/\[\[|\]\]/g, "")].join(" · ")}`)

  // The skills whose checks ran, the failing ones first; those only used are counted, folded below.
  const skills = [...safely(() => skillRuns(ws, { days: 30, now }), new Map())].sort(([a], [b]) => a.localeCompare(b))
  const checked = skills.filter(([, run]) => run.sessions).sort(([, a], [, b]) => failing(b) - failing(a))
  const used = skills.filter(([, run]) => !run.sessions && run.used)
  lines.push(`- ${words.skills}`)
  if (!checked.length && !used.length) lines.push(`\t- ${words.skillsNone}`)
  for (const [name, run] of checked)
    lines.push(`\t- ${[name, run.used ? format(words.used, { n: run.used }) : "", format(words.checks, run), failing(run) ? words.failing : ""].filter(Boolean).join(" · ")}`)
  if (used.length) {
    lines.push(`\t- ${format(words.unchecked, { n: used.length })}`, "\t  collapsed:: true")
    for (const [name, run] of used) lines.push(`\t\t- ${name} · ${format(words.used, { n: run.used })}`)
  }

  const sources = safely(() => listSources(ws), [])
  const on = sources.filter((source) => source.enabled !== false)
  if (sources.length) {
    lines.push(`- ${words.sources}${on.length < sources.length ? ` · ${format(words.off, { n: sources.length - on.length })}` : ""}`)
    for (const source of on) lines.push(`\t- ${[source.name, source.kind === "items"
      ? format(words.collected, { at: when(source.fetchedAt), open: source.open }) : format(words.marked, { at: when(source.markedAt) })].join(" · ")}`)
  }

  const reflect = join(ws.root, "reflect.json")
  const questions = existsSync(reflect) ? safely(() => JSON.parse(readFileSync(reflect, "utf8")).questions?.length ?? 0, 0) : 0
  if (questions) lines.push(`- ${format(words.questions, { n: questions })}`)
  return lines.join("\n")
}
