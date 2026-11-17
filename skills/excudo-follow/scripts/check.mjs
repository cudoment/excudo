#!/usr/bin/env node
// Usage: node scripts/check.mjs --source <name> --input <file> [--changes <file>] [--since <commit>] [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after bringing a followed note into the memo. `--input` is what the source's
// page script returned, `--changes` what `changes <name> --input <file> --json` printed before the
// work began, `--since` the commit the work started from. Checks what the work must leave behind: the
// note is marked as read at that input; the memo holds every block of its followed part; when the
// owner chose to settle removed thoughts, no open task still holds a line removed from the note; no
// line that looks private (a password, an account or card number, a key) was added to the memo; the
// node rules hold and the work is saved. Exit 0 when all hold, 1 when one does not, 2 on a usage error.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { holds, memoLines, stillOpen } from "./lib/match.mjs"

const kit = await import(pathToFileURL(kitPath()).href)

async function gather(ws, options) {
  const { engine } = kit
  if (!options.source || !options.input) throw new kit.UsageError("--source and --input are required")
  const input = readFileSync(options.input, "utf8")
  const [found] = engine.changes(ws, { name: options.source, input })
  if (found.kind !== "note") throw new kit.UsageError(`${options.source} is not a note source`)
  const memo = memoLines(kit.graphNow(ws), ws.labels)
  const current = engine.noteRegion(JSON.parse(input), found.between).blocks
  const now = new Set(current.flatMap((block) => [block.heading, ...block.lines]))
  // The lines removed from the note since the work began; a line that moved to another block is no removal.
  let removed = []
  if (options.changes) {
    const before = JSON.parse(readFileSync(options.changes, "utf8")).find((item) => item.name === options.source)?.detail ?? {}
    removed = [...(before.removed ?? []).flatMap((block) => [block.heading, ...block.lines]), ...(before.changed ?? []).flatMap((block) => block.removed)]
      .filter((line) => !now.has(line))
  }
  const { issues } = await engine.check(ws)
  return {
    status: found.status,
    between: found.between,
    removedMode: found.removed,
    blocks: current.map((block) => ({ heading: block.heading, held: holds(block, memo) })),
    stillOpen: removed.flatMap((line) => stillOpen(line, memo, [...now]).map((place) => ({ file: place.file, line: place.line }))),
    private: options.since ? kit.addedLines(ws, options.since).filter((line) => engine.privateLine(line.text)).map((line) => line.file) : [],
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved: kit.uncommitted(ws, ["sources.json"]),
  }
}

function evaluate(facts) {
  const unmarked = facts.status === "unmarked"
  const missing = facts.blocks.filter((block) => !block.held).map((block) => block.heading)
  const settle = facts.removedMode === "settle"
  return [
    { id: "marked", ok: ["same", "unmarked"].includes(facts.status),
      message: unmarked ? { en: `The note has no part between two “${facts.between}” lines yet; nothing to follow. Tell the owner to put them around what to follow.`, ko: `메모에 「${facts.between}」 줄 두 개 사이의 영역이 아직 없어서 따라갈 것이 없습니다. 따라갈 부분의 앞뒤에 표식 줄을 넣어 달라고 사용자에게 알릴 것.` }
        : facts.status === "same" ? { en: "The note is marked as read at this input.", ko: "이 입력으로 메모를 읽었다고 표시했습니다." }
        : { en: `The note is ${facts.status} against its mark. Bring it in, then run changes mark <name> --input <file> --expect <token>.`, ko: `메모가 표시한 때와 다릅니다(${facts.status}). 반영한 뒤 changes mark <이름> --input <파일> --expect <값>으로 표시할 것.` } },
    { id: "held", ok: !missing.length,
      message: missing.length ? { en: `The memo does not hold these blocks yet: ${missing.join(", ")}. Merge each into the place that has it, or give it a new place.`, ko: `메모에 아직 반영하지 않은 블록이 있습니다: ${missing.join(", ")}. 이미 다루는 곳에 합치거나 새 자리를 만들 것.` }
        : { en: `The memo holds all ${facts.blocks.length} block(s) of the followed part.`, ko: `따라가는 영역의 블록 ${facts.blocks.length}개를 메모가 모두 담고 있습니다.` } },
    { id: "settled", ok: !settle || !facts.stillOpen.length,
      message: !settle ? { en: "Removed thoughts are the owner's to settle (removed: \"ask\"); ask about them.", ko: "지운 생각은 사용자가 정합니다(removed: \"ask\"). 물어볼 것." }
        : facts.stillOpen.length ? { en: `Open tasks still hold lines removed from the note: ${facts.stillOpen.map((at) => `${at.file}:${at.line}`).join(", ")}. Mark them done if they were finished, or drop them.`, ko: `메모에서 지운 줄을 담은 열린 할 일이 남았습니다: ${facts.stillOpen.map((at) => `${at.file}:${at.line}`).join(", ")}. 끝났으면 DONE으로, 아니면 폐기한 것으로 정리할 것.` }
        : { en: "No open task holds a line removed from the note.", ko: "메모에서 지운 줄을 담은 열린 할 일이 없습니다." } },
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
  usage: "Usage: node scripts/check.mjs --source <name> --input <file> [--changes <file>] [--since <commit>] [--json] | --facts <file> | --self-test",
  options: { source: { type: "string" }, input: { type: "string" }, changes: { type: "string" }, since: { type: "string" } },
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
