#!/usr/bin/env node
// Usage: node scripts/check.mjs --key <key>... [--since <commit>] [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after taking queued tasks. <key> is each task taken (from `queue --json`),
// <commit> is HEAD before the work began. Checks what the work must leave behind: each task is still
// queued and waits for the owner's review (a report line is its last line), the report its line links
// to exists and is not empty, no line that looks private was added to the tasks' pages, the node rules
// hold and those pages are saved. Other pages are left out: someone may be writing there meanwhile, and
// a scheduled run commits only its own pages. Exit 0 when all hold, 1 when one does not, 2 on a usage error.
import { existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)

async function gather(ws, options) {
  const { engine } = kit
  const keys = options.key ?? []
  if (!keys.length) throw new kit.UsageError("--key is required")
  const items = engine.queueItems(ws)
  const { issues } = await engine.check(ws)
  const files = [...new Set(keys.map((key) => items.find((each) => each.key === key)?.file).filter(Boolean))]
  const pages = files.map((file) => relative(ws.root, join(ws.graphDir, file)))
  const mine = new Set(files.map((file) => join(ws.graphDir, file).normalize("NFC")))
  const unsaved = kit.uncommitted(ws) === null ? null
    : engine.changedGraphFiles(ws).filter((file) => mine.has(file.normalize("NFC"))).map((file) => relative(ws.root, file))
  return {
    tasks: keys.map((key) => {
      const item = items.find((each) => each.key === key)
      const report = item?.report ?? null
      return { key, found: Boolean(item), status: item?.status ?? null, report: Boolean(report && existsSync(report) && statSync(report).size > 0) }
    }),
    private: options.since && pages.length ? kit.addedLines(ws, options.since, pages).filter((line) => engine.privateLine(line.text)).map((line) => line.file) : [],
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved,
  }
}

function evaluate(facts) {
  const gone = facts.tasks.filter((task) => !task.found).map((task) => task.key)
  const open = facts.tasks.filter((task) => task.found && task.status !== "waiting").map((task) => task.key)
  const missing = facts.tasks.filter((task) => task.found && task.status === "waiting" && !task.report).map((task) => task.key)
  return [
    { id: "queued", ok: !gone.length,
      message: gone.length ? { en: `These tasks are no longer queued: ${gone.join(", ")}. Never close or untag a queued task; restore it.`, ko: `맡긴 할 일 목록에서 사라진 할 일이 있습니다: ${gone.join(", ")}. 맡긴 할 일은 닫거나 태그를 떼지 말고 되돌릴 것.` }
        : { en: `All ${facts.tasks.length} task(s) are still queued.`, ko: `할 일 ${facts.tasks.length}개가 모두 맡긴 그대로 있습니다.` } },
    { id: "reported", ok: !open.length,
      message: open.length ? { en: `No report waits for the owner under: ${open.join(", ")}. Run queue report for each.`, ko: `사용자의 검토를 기다리는 보고가 없는 할 일이 있습니다: ${open.join(", ")}. 각각 queue report를 실행할 것.` }
        : { en: "Each task has a report waiting for the owner.", ko: "할 일마다 사용자의 검토를 기다리는 보고가 있습니다." } },
    { id: "report-file", ok: !missing.length,
      message: missing.length ? { en: `The report file is missing or empty for: ${missing.join(", ")}. Write it in .excudo/reports/ and link it.`, ko: `보고 파일이 없거나 비어 있는 할 일이 있습니다: ${missing.join(", ")}. .excudo/reports/에 쓰고 링크할 것.` }
        : { en: "Every report file is there.", ko: "보고 파일이 모두 있습니다." } },
    { id: "no-private", ok: !facts.private.length,
      message: facts.private.length ? { en: `Lines that look private were added to: ${[...new Set(facts.private)].join(", ")}. Take them out of the memo.`, ko: `개인 정보로 보이는 줄이 들어갔습니다: ${[...new Set(facts.private)].join(", ")}. 메모에서 뺄 것.` }
        : { en: "No line that looks private was added.", ko: "개인 정보로 보이는 줄을 넣지 않았습니다." } },
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행할 것.` }
        : { en: "The work is saved.", ko: "작업을 저장했습니다." } },
  ]
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs --key <key>... [--since <commit>] [--json] | --facts <file> | --self-test",
  options: { key: { type: "string", multiple: true }, since: { type: "string" } },
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
