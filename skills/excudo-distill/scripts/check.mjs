#!/usr/bin/env node
// Usage: node scripts/check.mjs --since <commit> [--requests] [--allow-removed] [--allow-done <words>]... [--raw <file>] [--only <page>]... [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after a cleanup interview. <commit> is HEAD right after the snapshot that
// started it. Checks what the interview must leave behind: the node rules hold, every batch is
// saved (with --only, the pages given, as `save --only` takes them), no question was put off with a #check tag (a line only moved is no new question), no open
// task from before vanished without the owner's answer (--allow-removed once they approved removing
// or rewriting some; a task only moved or tagged is still there), no open task from before was closed
// (DONE or canceled) unless the owner said it is finished (--allow-done with its words, once per task),
// no link still points to a node renamed or removed since (the owner's Home is
// only reported), and with --requests, the requests that were read are marked. With --raw (the
// JSON raw.mjs wrote for a pasted memo, the owner's answers in each entry's `answer`), every new or
// only similar line was asked about, and the memo gained or moved a line for a pasted one only where
// the owner answered something other than keep or skip. Exit 0 when all hold, 1 when one does not,
// 2 on a usage error.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { relative } from "node:path"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)
const { closeness, compact, keepsAsIs, memoLines } = await import(new URL("./lib/raw-match.mjs", import.meta.url).href)
const CHECK_TAG = /#(?:\[\[)?(?:check|확인)(?:\]\])?(?![\p{L}\p{N}_-])/iu
// A line compared without its indentation and list marker, so a line moved deeper is the same line.
const plain = (line) => line.replace(/^\s*(?:- )?/, "").trim().normalize("NFC")

async function gather(ws, options) {
  const { engine } = kit
  if (!options.since) throw new kit.UsageError("--since <commit> is required: HEAD right after the snapshot that started the interview.")
  if (!kit.revisionExists(ws, options.since)) throw new kit.UsageError(`${options.since} is no commit of this workspace.`)
  const { issues } = await engine.check(ws)
  const files = kit.graphNow(ws)
  const before = kit.graphAt(ws, options.since)
  const present = new Set(kit.tasksOf(files).map((task) => kit.untagged(task.text)))
  const earlier = new Set(before.flatMap(({ text }) => text.split("\n").map(plain)))
  const pages = (list) => new Set(list.map(({ file }) => file.normalize("NFC").split("/").at(-1).replace(/\.md$/, "").normalize("NFC").toLowerCase()))
  const [then, now] = [pages(before), pages(files)]
  const home = engine.ownedHome(ws)
  const dangling = files.flatMap(({ file, text }) => kit.linkTargets(text).filter(({ target }) => then.has(target.toLowerCase()) && !now.has(target.toLowerCase()))
    .map(({ line, target }) => ({ file, line: line + 1, target })))
  const isHome = (item) => home && item.file === relative(ws.root, home.path).normalize("NFC")
  const facts = {
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved: kit.uncommitted(ws, ["review.json"], { pages: options.only }),
    tags: kit.addedLines(ws, options.since).filter((line) => CHECK_TAG.test(line.text) && !earlier.has(plain(line.text))).map((line) => `${line.file}: ${line.text.trim()}`),
    lost: kit.tasksOf(before).filter((task) => kit.OPEN.has(task.marker) && !present.has(kit.untagged(task.text))).map((task) => `${task.file}: ${task.text}`),
    done: kit.closedSince(before, files),
    dangling: dangling.filter((item) => !isHome(item)).map((item) => `${item.file}:${item.line}: [[${item.target}]]`),
    home: dangling.filter(isHome).map((item) => `[[${item.target}]]`),
  }
  if (options.raw) {
    let pasted
    try { pasted = JSON.parse(readFileSync(options.raw, "utf8")).lines } catch (error) { throw new kit.UsageError(`--raw: ${error.message}`) }
    if (!Array.isArray(pasted)) throw new kit.UsageError("--raw takes the JSON that raw.mjs --json wrote.")
    const needs = (entry) => entry.kind === "new" || entry.how === "similar"
    const answered = (entry) => typeof entry.answer === "string" && entry.answer.trim() !== ""
    const holds = (entry) => answered(entry) && !keepsAsIs(entry.answer)
    // A line the memo gained, or that moved to another page, since the interview began.
    const was = new Set(memoLines(before, ws.labels).map((line) => `${line.file}\n${line.key}`))
    const gained = memoLines(files, ws.labels).filter((line) => !was.has(`${line.file}\n${line.key}`))
    facts.raw = {
      lines: pasted.length,
      unasked: pasted.filter((entry) => needs(entry) && !answered(entry)).map((entry) => `${entry.n}: ${entry.text}`),
      unanswered: gained.filter((line) => pasted.some((entry) => !holds(entry) && closeness(compact(entry.text), line.key) >= 0.8))
        .map((line) => `${line.file}:${line.line}: ${line.text}`),
    }
  }
  if (options.requests) {
    const state = kit.requestState(ws)
    facts.requests = { shown: state.shown.cleanup ?? null, mark: state.marks.cleanup ?? null }
  }
  return facts
}

function evaluate(facts, options) {
  const list = (items) => items.slice(0, 5).join("; ") + (items.length > 5 ? ` (+${items.length - 5})` : "")
  const checks = [
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${list(facts.errors)}`, ko: `노드 규칙을 어겼습니다: ${list(facts.errors)}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${list(facts.unsaved)}. Save the batch.`, ko: `저장하지 않은 변경이 있습니다: ${list(facts.unsaved)}. 묶음을 save할 것.` }
        : { en: "Every batch is saved.", ko: "모든 묶음을 저장했습니다." } },
    { id: "asked-now", ok: !facts.tags.length,
      message: facts.tags.length ? { en: `Questions put off with #check: ${list(facts.tags)}. Ask the owner now.`, ko: `#확인으로 미룬 질문이 있습니다: ${list(facts.tags)}. 지금 사용자에게 물을 것.` }
        : { en: "No question was put off with #check.", ko: "#확인으로 미룬 질문이 없습니다." } },
    { id: "open-tasks", ok: !facts.lost.length || Boolean(options["allow-removed"]),
      message: !facts.lost.length ? { en: "Every open task from before is still in the memo.", ko: "정리 전의 열린 할 일이 모두 메모에 있습니다." }
        : options["allow-removed"] ? { en: `Removed or rewritten with the owner's answer: ${list(facts.lost)}`, ko: `사용자의 답에 따라 지우거나 고쳐 쓴 할 일: ${list(facts.lost)}` }
        : { en: `Open tasks are gone: ${list(facts.lost)}. Restore them, or rerun with --allow-removed if the owner approved.`, ko: `열린 할 일이 사라졌습니다: ${list(facts.lost)}. 되살리거나, 사용자가 승인했다면 --allow-removed로 다시 실행할 것.` } },
    doneCheck(facts.done ?? [], options["allow-done"] ?? [], list),
    { id: "links-follow", ok: !(facts.dangling ?? []).length,
      message: (facts.dangling ?? []).length ? { en: `Links still point to nodes renamed or removed since: ${list(facts.dangling)}. Point them to the new name (rename does) or turn them into text.`, ko: `이름을 바꾸거나 지운 노드를 아직 가리키는 링크가 있습니다: ${list(facts.dangling)}. 새 이름으로 고치거나(rename이 고칩니다) 글로 바꿀 것.` }
        : (facts.home ?? []).length ? { en: `No link points to a node renamed or removed since, but Home (the owner's) still links ${list(facts.home)}: tell the owner.`, ko: `이름을 바꾸거나 지운 노드를 가리키는 링크가 없습니다. 다만 사용자의 홈에 예전 이름의 링크가 남아 있으므로 사용자에게 알릴 것: ${list(facts.home)}` }
        : { en: "No link points to a node renamed or removed since.", ko: "이름을 바꾸거나 지운 노드를 가리키는 링크가 없습니다." } },
  ]
  if (options.raw) {
    const { unasked, unanswered } = facts.raw
    checks.push({ id: "raw-asked", ok: !unasked.length,
      message: unasked.length ? { en: `Pasted lines nobody asked about (new or only similar): ${list(unasked)}. Ask the owner and write the answer into the entry.`, ko: `묻지 않은 붙여 넣은 줄(새 줄이나 비슷하기만 한 줄)이 있습니다: ${list(unasked)}. 사용자에게 묻고 그 항목에 답을 적을 것.` }
        : { en: "Every new or only similar pasted line was asked about.", ko: "새 줄과 비슷하기만 한 줄을 모두 물었습니다." } })
    checks.push({ id: "raw-answered-only", ok: !unanswered.length,
      message: unanswered.length ? { en: `The memo gained or moved lines for pasted ones the owner did not ask to change: ${list(unanswered)}. Undo them or ask first.`, ko: `사용자가 바꾸라고 답하지 않은 붙여 넣은 줄이 메모에 더해지거나 옮겨졌습니다: ${list(unanswered)}. 되돌리거나 먼저 물을 것.` }
        : { en: "Only lines the owner answered for were added or moved.", ko: "사용자가 답한 줄만 더하거나 옮겼습니다." } })
  }
  if (options.requests) {
    const { shown, mark } = facts.requests
    const ok = Boolean(shown && mark && mark >= shown)
    checks.push({ id: "requests-marked", ok,
      message: ok ? { en: `Requests are marked read up to ${mark}.`, ko: `${mark}까지의 요청을 읽었다고 표시했습니다.` }
        : { en: `The requests read (up to ${shown ?? "?"}) are not marked: requests mark --for cleanup --until ${shown ?? "<until>"}.`, ko: `읽은 요청(${shown ?? "?"}까지)을 표시하지 않았습니다: requests mark --for cleanup --until ${shown ?? "<until>"}` } })
  }
  return checks
}

// Only the owner decides what is done: an open task closed since needs their word (--allow-done).
function doneCheck(done, allowed, list) {
  const unasked = done.filter((task) => !kit.allowedDone(task.text, allowed)).map((task) => `${task.file}: ${task.text}`)
  return { id: "done-by-owner", ok: !unasked.length,
    message: unasked.length ? { en: `Tasks closed without the owner's word: ${list(unasked)}. Only the owner decides what is done: reopen them, or rerun with --allow-done "<task words>" for each one the owner said is finished.`, ko: `사용자가 끝났다고 하지 않은 할 일을 닫았습니다: ${list(unasked)}. 완료는 사용자만 정하므로 다시 열거나, 사용자가 끝났다고 답한 할 일마다 --allow-done "<할 일 글>"을 붙여 다시 실행할 것.` }
      : done.length ? { en: `Tasks closed with the owner's word: ${list(done.map((task) => task.text))}.`, ko: `사용자가 끝났다고 답한 할 일만 닫았습니다: ${list(done.map((task) => task.text))}.` }
      : { en: "No open task was closed.", ko: "닫은 열린 할 일이 없습니다." } }
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs --since <commit> [--requests] [--allow-removed] [--allow-done <words>]... [--raw <file>] [--only <page>]... [--json] | --facts <file> | --self-test",
  options: { since: { type: "string" }, requests: { type: "boolean" }, "allow-removed": { type: "boolean" }, "allow-done": { type: "string", multiple: true }, raw: { type: "string" }, only: { type: "string", multiple: true } },
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
