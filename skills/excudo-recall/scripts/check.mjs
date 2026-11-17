#!/usr/bin/env node
// Usage: node scripts/check.mjs [--source <name>]... [--only <page>]... [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after bringing knowledge up to date. Checks what that must leave behind: no
// repository source (of those named, or of all turned-on ones) still has changes its knowledge node
// was not brought up to date with, each named page source was marked today, the node rules hold and
// the update is saved (with --only, the pages given, as `save --only` takes them). Exit 0 when all
// hold, 1 when one does not, 2 on a usage error.
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)
const DAY = 86400000

async function gather(ws, options) {
  const { engine } = kit
  const names = options.source ?? []
  const listed = names.length ? names.flatMap((name) => engine.changes(ws, { name })) : engine.changes(ws)
  const { issues } = await engine.check(ws)
  return {
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved: kit.uncommitted(ws, ["sources.json"], { pages: options.only }),
    sources: listed.map((item) => ({ name: item.name, kind: item.kind, status: item.status, markedAt: item.markedAt, named: names.includes(item.name),
      busy: Boolean(item.detail?.busy), commits: item.detail?.range ? item.detail.commits ?? 1 : 0 })),
    now: new Date().toISOString(),
  }
}

// A repository someone is working in right now (uncommitted files edited minutes ago) is a draft:
// its knowledge waits for the work to settle, unless it also has commits that were never brought in,
// however recently it was marked.
const inProgress = (item) => item.status === "changed" && item.busy && !item.commits

function evaluate(facts) {
  const behind = facts.sources.filter((item) => (item.status === "changed" || item.status === "new") && !inProgress(item))
  const working = facts.sources.filter((item) => inProgress(item)).map((item) => item.name)
  const pages = facts.sources.filter((item) => item.named && item.status === "browser"
    && !(item.markedAt && new Date(facts.now).getTime() - new Date(item.markedAt).getTime() < DAY))
  const missing = facts.sources.filter((item) => item.status === "missing").map((item) => item.name)
  return [
    { id: "knowledge-current", ok: !behind.length,
      message: behind.length ? { en: `Still behind their sources: ${behind.map((item) => `${item.name} (${item.status})`).join(", ")}. Update the nodes and mark them, or say they remain.`, ko: `출처보다 뒤처진 지식 노드가 남았습니다: ${behind.map((item) => `${item.name}(${item.status})`).join(", ")}. 노드를 갱신하고 표시하거나, 남은 것으로 알릴 것.` }
        : { en: `The knowledge is current${working.length ? `; still being worked on, left for a later run: ${working.join(", ")}` : ""}${missing.length ? `; missing folders: ${missing.join(", ")}` : ""}.`,
          ko: `지식이 최신입니다${working.length ? `. 지금 작업 중이라 다음 실행으로 넘긴 출처: ${working.join(", ")}` : ""}${missing.length ? `. 폴더가 없는 출처: ${missing.join(", ")}` : ""}.` } },
    { id: "pages-marked", ok: !pages.length,
      message: pages.length ? { en: `Page sources not marked today: ${pages.map((item) => item.name).join(", ")}. Mark them with --input after reading.`, ko: `오늘 표시하지 않은 페이지 출처가 있습니다: ${pages.map((item) => item.name).join(", ")}. 읽은 뒤 --input으로 표시할 것.` }
        : { en: "Every page source named was read and marked.", ko: "지정한 페이지 출처를 모두 읽고 표시했습니다." } },
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행할 것.` }
        : { en: "The update is saved.", ko: "갱신을 저장했습니다." } },
  ]
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--source <name>]... [--only <page>]... [--json] | --facts <file> | --self-test",
  options: { source: { type: "string", multiple: true }, only: { type: "string", multiple: true } },
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
