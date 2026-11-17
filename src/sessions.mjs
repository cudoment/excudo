// The owner's sessions with coding agents, found by node or folder, with the command that resumes each
// where it is now. Sessions come from the records `activity` keeps; a folder renamed since (the `moved`
// setting) is resumed at its new path. Scheduled runs are left out: no one resumes them.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { collectActivity, dayOf } from "./activity.mjs"
import { prepare } from "./build.mjs"
import { format } from "./labels.mjs"
import { sessionRecords, withRecords } from "./records.mjs"
import { claudeStore, conversationsOf, placer } from "./requests.mjs"
import { localPath } from "./sources.mjs"
import { ROOT } from "./tree.mjs"
import { movedFolders, movedPath, within } from "./workspaces.mjs"

export { claudeStore }

const quote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`
const RESUME = { claude: (id) => `claude --resume ${quote(id)}`, codex: (id) => `codex resume ${quote(id)}` }

/**
 * Sessions newest first, each at the last place it worked: `node` keeps the ones that worked on that
 * node or below it, `path` the ones that worked in that folder or inside it (its old path or its new
 * one), `days` the ones that worked in the last days. Each tells the folder it is resumed in now
 * (`folder`, and `was` when the folder moved), whether that folder is there, and, for Claude Code,
 * where its transcript is kept when that is not where Claude Code will look for it from the new folder
 * (`store`). `refresh` reads the agents' logs into the records first.
 * @param {any} ws
 * @param {{ node?: string, path?: string, days?: number, limit?: number, now?: Date, refresh?: boolean }} [options]
 */
export function agentSessions(ws, { node, path, days, limit, now = new Date(), refresh = true } = {}) {
  if (refresh && conversationsOf(ws)) collectActivity(ws, { now })
  const { model } = prepare(ws)
  const target = node ? model.find(node) : null
  if (node && !target) throw new Error(format(ws.labels.messages["node-missing"], { name: node }))
  const place = placer(ws, { model })
  const moves = movedFolders(ws)
  const claude = conversationsOf(ws)?.claude
  const wanted = path ? localPath(ws, path).replace(/\/+$/, "") : null
  const since = days ? dayOf(new Date(now.getTime() - (days - 1) * 86400000)) : null
  const under = (name) => {
    for (let id = name ? model.find(name) : null; id && id !== ROOT; id = model.parentOf(id)) if (id === target) return true
    return false
  }
  const found = []
  for (const session of withRecords(ws, (db) => sessionRecords(db))) {
    if (session.batch || !RESUME[session.tool]) continue
    const spans = session.spans.map((span) => ({ ...span, now: movedPath(moves, span.cwd), placed: place(span.cwd) }))
      .filter((span) => (!since || span.day >= since)
        && (!wanted || within(span.cwd, wanted) || within(span.now, movedPath(moves, wanted)))
        && (!target || under(span.placed.node)))
    if (!spans.length) continue
    const last = spans.reduce((a, b) => (b.end > a.end ? b : a))
    if (!target && last.placed.untracked) continue
    const folder = last.now
    const exists = existsSync(folder)
    const kept = session.tool === "claude" && claude && folder !== last.cwd
      && !existsSync(join(claude, claudeStore(folder), `${session.id}.jsonl`)) && existsSync(join(claude, claudeStore(last.cwd), `${session.id}.jsonl`))
    found.push({
      tool: session.tool, id: session.id, title: session.title ?? null, node: last.placed.node ?? null, where: last.placed.where,
      day: last.day, end: last.end, folder, ...(folder !== last.cwd ? { was: last.cwd } : {}), exists,
      ...(kept ? { store: join(claude, claudeStore(last.cwd)) } : {}),
      resume: `cd ${quote(folder)} && ${RESUME[session.tool](session.id)}`,
    })
  }
  found.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
  return limit ? found.slice(0, limit) : found
}
