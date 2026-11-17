#!/usr/bin/env node
// Usage: node scripts/check.mjs [--text <words of the note>] [--node <node>] [--only <page>]... [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace. Checks what a capture must leave behind: the node rules hold, the note is in
// the memo once (in the given node), the summaries from that node up to the top are within their
// limits, and the change is saved (with --only, the pages given as `save --only` takes them: work
// saved on its own pages passes while someone writes elsewhere). Exit 0 when all hold, 1 when one
// does not, 2 on a usage error.
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)

async function gather(ws, options) {
  const { engine } = kit
  const { issues } = await engine.check(ws)
  const facts = { errors: engine.errorsOf(issues).map((issue) => issue.message), unsaved: kit.uncommitted(ws, [], { pages: options.only }) }
  if (options.text) facts.matches = engine.find(ws, options.text).matches.filter((hit) => hit.field === "text").map((hit) => hit.path.normalize("NFC"))
  if (options.node) {
    const { model } = engine.prepare(ws)
    const id = model.find(options.node)
    if (!id) throw new kit.UsageError(`No node named ${options.node}.`)
    const path = []
    for (let at = id; at && model.docs.get(at); at = model.parentOf(at)) path.push(model.docs.get(at).sourcePath.normalize("NFC"))
    facts.nodeFile = path[0]
    facts.long = issues.filter((issue) => /summary-long$/.test(issue.code) && path.includes(issue.file)).map((issue) => issue.message)
  }
  return facts
}

function evaluate(facts, options) {
  const checks = [
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행할 것.` }
        : { en: "The change is saved.", ko: "변경을 저장했습니다." } },
  ]
  if (options.text) {
    const n = facts.matches.length
    checks.push({ id: "once", ok: n === 1,
      message: n === 1 ? { en: "The note is in the memo once.", ko: "메모에 한 번만 들어 있습니다." }
        : n ? { en: `The words are in ${n} places (${facts.matches.join(", ")}); keep one, or ask whether they are different notes.`, ko: `같은 문구가 ${n}곳에 있습니다(${facts.matches.join(", ")}). 하나만 두거나 서로 다른 메모인지 물을 것.` }
        : { en: "The note is not in the memo.", ko: "메모에서 찾지 못했습니다." } })
  }
  if (options.node) {
    if (options.text) {
      const placed = facts.matches.length > 0 && facts.matches.every((file) => facts.nodeFile.endsWith(file))
      checks.push({ id: "in-node", ok: placed,
        message: placed ? { en: `The note is in ${options.node}.`, ko: `메모가 ${options.node}에 있습니다.` }
          : { en: `The note is not in ${options.node} (${facts.nodeFile}).`, ko: `메모가 ${options.node}(${facts.nodeFile})에 없습니다.` } })
    }
    checks.push({ id: "summaries", ok: !facts.long.length,
      message: facts.long.length ? { en: `Summaries on the way up are too long: ${facts.long.join(" ")}`, ko: `위쪽 요약이 너무 깁니다: ${facts.long.join(" ")}` }
        : { en: "The summaries up to the top are within their limits.", ko: "맨 위까지의 요약이 길이 제한 안에 있습니다." } })
  }
  return checks
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--text <words of the note>] [--node <node>] [--only <page>]... [--json] | --facts <file> | --self-test",
  options: { text: { type: "string" }, node: { type: "string" }, only: { type: "string", multiple: true } },
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
