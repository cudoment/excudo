#!/usr/bin/env node
// Usage: node scripts/check.mjs [--source <name>]... [--since <commit>] [--allow-done <words>]... [--only <page>]... [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after bringing items in; <commit> is HEAD before the work began. Checks what a
// collection must leave behind: each named source's items were taken in today, no outside item is
// open on two lines of the memo, with --since no open task was closed (DONE or canceled) since except
// those the engine settled for a source set to `finished: "settle"` and those the owner said are
// finished (--allow-done with their words), the node rules hold and the memo (with --only, the pages
// given, as `save --only` takes them) and sources.json are saved. Exit 0 when all hold, 1 when one does not, 2 on a usage error.
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)
const DAY = 86400000

async function gather(ws, options) {
  const { engine } = kit
  const listed = engine.listSources(ws)
  for (const name of options.source ?? []) if (!listed.some((source) => source.name === name)) throw new kit.UsageError(`No source named ${name}.`)
  // Each outside item's links, then the open task lines that name any of them.
  const state = kit.readSourceState(ws)
  const items = Object.entries(state).flatMap(([source, value]) => Object.entries(value?.items ?? {})
    .map(([id, item]) => ({ source, id, urls: [item.url, ...(item.urls ?? [])].filter(Boolean) })))
  const open = kit.tasksOf(kit.graphNow(ws)).filter((task) => kit.OPEN.has(task.marker)).map((task) => ({ ...task, urls: new Set(kit.urlsIn(task.text)) }))
  const twice = items.map((item) => ({ ...item, lines: open.filter((task) => item.urls.some((url) => task.urls.has(url))) }))
    .filter((item) => item.lines.length > 1).map((item) => `${item.source} ${item.id}: ${item.lines.map((task) => task.file).join(", ")}`)
  const { issues } = await engine.check(ws)
  return {
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved: kit.uncommitted(ws, ["sources.json"], { pages: options.only }),
    twice,
    named: (options.source ?? []).map((name) => ({ name, fetchedAt: listed.find((source) => source.name === name).fetchedAt ?? null })),
    ...(options.since ? { done: closed(ws, options.since) } : {}),
    now: new Date().toISOString(),
  }
}

// The open tasks closed since <commit>, each with whether the engine settles it: its outside items are
// all finished at sources the owner set to settle what they finish.
function closed(ws, since) {
  if (!kit.revisionExists(ws, since)) throw new kit.UsageError(`${since} is no commit of this workspace.`)
  const before = kit.graphAt(ws, since)
  const settled = new Set(kit.engine.settledOn(ws, before).map((item) => kit.untagged(item.text.replace(/^\s*[-*+]\s+\S+\s*/, ""))))
  return kit.closedSince(before, kit.graphNow(ws)).map((task) => ({ ...task, settled: settled.has(kit.untagged(task.text)) }))
}

function evaluate(facts, options) {
  const stale = facts.named.filter((source) => !source.fetchedAt || new Date(facts.now).getTime() - new Date(source.fetchedAt).getTime() > DAY).map((source) => source.name)
  return [
    { id: "collected", ok: !stale.length,
      message: stale.length ? { en: `Not taken in today: ${stale.join(", ")}. Run ingest without --dry-run once the owner agrees.`, ko: `오늘 가져오지 않은 출처가 있습니다: ${stale.join(", ")}. 사용자가 동의하면 --dry-run 없이 ingest를 실행할 것.` }
        : { en: facts.named.length ? "Every named source was taken in today." : "No source named; nothing to compare.", ko: facts.named.length ? "지정한 출처를 오늘 모두 가져왔습니다." : "지정한 출처가 없어서 비교할 것이 없습니다." } },
    { id: "once", ok: !facts.twice.length,
      message: facts.twice.length ? { en: `Outside items open on more than one line: ${facts.twice.slice(0, 5).join("; ")}. Keep one line per item.`, ko: `열린 줄이 둘 이상인 외부 항목이 있습니다: ${facts.twice.slice(0, 5).join("; ")}. 항목마다 한 줄만 둘 것.` }
        : { en: "Each outside item is open on one line at most.", ko: "외부 항목마다 열린 줄이 하나 이하입니다." } },
    doneCheck(facts.done, options["allow-done"] ?? []),
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행할 것.` }
        : { en: "The memo and sources.json are saved.", ko: "메모와 sources.json을 저장했습니다." } },
  ]
}

// Only the owner decides what is done; the engine settling for a source set to settle is their standing mark.
function doneCheck(done, allowed) {
  if (!done) return { id: "done-by-owner", ok: true,
    message: { en: "Without --since, tasks closed during the work were not compared.", ko: "--since가 없어서 작업 중에 닫은 할 일은 비교하지 않았습니다." } }
  const byHand = done.filter((task) => !task.settled && !kit.allowedDone(task.text, allowed)).map((task) => `${task.file}: ${task.text}`)
  const settled = done.filter((task) => task.settled).length
  return { id: "done-by-owner", ok: !byHand.length,
    message: byHand.length ? { en: `Tasks closed that the engine did not settle and the owner did not call finished: ${byHand.slice(0, 5).join("; ")}. Reopen them; a finished item at a source is a question for the owner.`, ko: `엔진이 정리하지 않았고 사용자가 끝났다고 하지도 않은 할 일을 닫았습니다: ${byHand.slice(0, 5).join("; ")}. 다시 열 것. 출처에서 끝났다는 표시는 사용자에게 물을 거리입니다.` }
      : { en: `No task was closed without the owner's word${settled ? `; the engine settled ${settled}` : ""}.`, ko: `사용자가 끝났다고 하지 않은 할 일을 닫지 않았습니다${settled ? `. 엔진이 정리한 할 일은 ${settled}개입니다` : ""}.` } }
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--source <name>]... [--since <commit>] [--allow-done <words>]... [--only <page>]... [--json] | --facts <file> | --self-test",
  options: { source: { type: "string", multiple: true }, since: { type: "string" }, "allow-done": { type: "string", multiple: true }, only: { type: "string", multiple: true } },
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
