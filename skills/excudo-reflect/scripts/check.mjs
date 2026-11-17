#!/usr/bin/env node
// Usage: node scripts/check.mjs [--since <commit>] [--requests] [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after a reflection. <commit> is HEAD before it started. Checks what a
// reflection must leave behind: reflect.json has the agreed shape, nothing written since <commit>
// (notes, reflect.json, commit messages) copies the owner's request text (without --since: all of
// reflect.json and the interest nodes), every hit added since <commit> that corrects a skill's work
// (`skill` and `case` on the hit: the skill and the case of its check that reproduces the mistake) is
// recorded as that case among the skill's mistakes in skills.json (`skills mistake`, on or after the
// hit's date) or waits as a question naming the same skill and case, the interests node exists, the
// node rules hold, the work is saved, and with --requests the requests read are marked. Exit 0 when
// all hold, 1 when one does not, 2 on a usage error.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)
const GRADES = new Set(["confirmed", "observed", "assumed", "proposed", "superseded"])
const DATE = /^\d{4}-\d{2}-\d{2}/
const SKILL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const named = (value) => value === undefined || typeof value === "string" && SKILL.test(value)
const text = (value) => typeof value === "string" && value.trim() !== ""
// A correction of a skill names the case that reproduces its mistake; a case belongs to a skill.
const linked = (item) => !named(item.skill) ? "skill must be a skill's name"
  : item.skill !== undefined && !text(item.case) ? "a correction of a skill needs case, the case that reproduces the mistake"
  : item.case !== undefined && (item.skill === undefined || !text(item.case)) ? "case needs skill, and is the name of a case" : null

/** What is wrong with reflect.json's shape, if anything. */
function shapeProblems(record) {
  if (record === undefined) return []
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["not an object"]
  const problems = []
  for (const [key, candidate] of Object.entries(record.candidates ?? {})) {
    if (typeof candidate?.node !== "string" || !candidate.node) problems.push(`${key}: no node`)
    for (const [i, hit] of (Array.isArray(candidate?.hits) ? candidate.hits : [null]).entries()) {
      if (!hit || !DATE.test(hit.date ?? "") || !GRADES.has(hit.grade) || typeof hit.note !== "string" || !hit.note.trim())
        problems.push(`${key}.hits[${i}]: needs date, grade (${[...GRADES].join("|")}) and note`)
      else if (linked(hit)) problems.push(`${key}.hits[${i}]: ${linked(hit)}`)
    }
  }
  if (record.questions !== undefined && !Array.isArray(record.questions)) problems.push("questions: not a list")
  for (const [i, question] of (Array.isArray(record.questions) ? record.questions : []).entries())
    if (!DATE.test(question?.date ?? "") || typeof question?.note !== "string" || !question.note.trim()) problems.push(`questions[${i}]: needs date and note`)
    else if (linked(question)) problems.push(`questions[${i}]: ${linked(question)}`)
  return problems
}

/**
 * The hits added to reflect.json since `since` that correct a skill's work, each with whether
 * skills.json records its case among that skill's mistakes on or after the hit's date (`recorded`)
 * and whether a question names the same skill and case (`asked`). Another mistake of the same skill
 * answers for no hit but its own. A hit counts as added when the same hit was not there before.
 */
function skillHits(ws, since, record) {
  const before = spawnSync("git", ["-C", ws.root, "show", `${since}:./reflect.json`], { encoding: "utf8" })
  let earlier
  if (before.status === 0) try { earlier = JSON.parse(before.stdout) } catch {}
  const hitsOf = (value) => Object.entries(value?.candidates ?? {}).flatMap(([key, candidate]) =>
    (Array.isArray(candidate?.hits) ? candidate.hits : []).map((hit) => ({ key, hit: hit ?? {} })))
  const id = ({ key, hit }) => JSON.stringify([key, hit.date, hit.note, hit.skill, hit.case])
  const seen = new Set(hitsOf(earlier).map(id))
  let learned = {}
  try { learned = kit.engine.readLearned(ws).skills } catch {}
  const pair = (skill, name) => JSON.stringify([skill, name])
  const asked = new Set((Array.isArray(record?.questions) ? record.questions : []).filter((question) => text(question?.skill) && text(question?.case))
    .map((question) => pair(question.skill, question.case)))
  return hitsOf(record).filter((item) => text(item.hit.skill) && !seen.has(id(item))).map(({ hit }) => {
    const day = String(hit.date).slice(0, 10)
    const name = text(hit.case) ? hit.case : null
    const mistakes = Array.isArray(learned[hit.skill]?.mistakes) ? learned[hit.skill].mistakes : []
    return { skill: hit.skill, case: name, date: day, learned: Boolean(learned[hit.skill]),
      recorded: name !== null && mistakes.some((item) => item?.case === name && typeof item?.date === "string" && item.date >= day),
      asked: name !== null && asked.has(pair(hit.skill, name)) }
  })
}

async function gather(ws, options) {
  const { engine } = kit
  if (options.since && !kit.revisionExists(ws, options.since)) throw new kit.UsageError(`${options.since} is no commit of this workspace.`)
  const file = join(ws.root, "reflect.json")
  let record, parseError
  if (existsSync(file)) try { record = JSON.parse(readFileSync(file, "utf8")) } catch (error) { parseError = error.message }
  const { issues } = await engine.check(ws)
  const { model } = engine.prepare(ws)
  const interests = ws.interests ? model.find(ws.interests) : undefined
  let written
  if (options.since) {
    const log = spawnSync("git", ["-C", ws.root, "log", "--format=%B", `${options.since}..HEAD`], { encoding: "utf8" }).stdout
    written = [...kit.addedLines(ws, options.since, [relative(ws.root, ws.graphDir) || ".", "reflect.json"]), { file: "commit messages", text: log }]
  } else {
    const below = interests ? model.nodes.filter((doc) => doc.id === interests || doc.id.startsWith(`${interests}/`)).map((doc) => join(ws.graphDir, doc.sourcePath)) : []
    written = [...(existsSync(file) ? [{ file: "reflect.json", text: readFileSync(file, "utf8") }] : []),
      ...below.filter(existsSync).map((path) => ({ file: path.slice(ws.root.length + 1), text: readFileSync(path, "utf8") }))]
  }
  // One passage per file shows what to rewrite; the words stay in this output, never in a file.
  const copied = kit.copiedPassages(ws, written.map((item) => ({ file: item.file, text: item.text })))
  const facts = {
    errors: engine.errorsOf(issues).map((issue) => issue.message),
    unsaved: kit.uncommitted(ws, ["reflect.json"]),
    shape: parseError ? [`invalid JSON: ${parseError}`] : shapeProblems(record),
    interests: ws.interests ? Boolean(interests) : null,
    copied: copied === null ? null : copied.map((item) => `${item.file}: “${item.passage}”`),
    skillHits: options.since && !parseError ? skillHits(ws, options.since, record) : null,
  }
  if (options.requests) {
    const state = kit.requestState(ws)
    facts.requests = { shown: state.shown.reflect ?? null, mark: state.marks.reflect ?? null }
  }
  return facts
}

function evaluate(facts, options) {
  // A record from before the corrections of skills were compared has no skillHits: nothing to judge.
  const open = (Array.isArray(facts.skillHits) ? facts.skillHits : []).filter((hit) => !hit.recorded && !hit.asked)
  const hitName = (hit, ko) => `${hit.skill} ${hit.case ? `“${hit.case}”` : ko ? "(경우 이름 없음)" : "(no case named)"} (${hit.date}${hit.learned ? "" : ko ? ", 학습 스킬 기록에 없음" : ", not a learned skill"})`
  const checks = [
    { id: "reflect-json", ok: !facts.shape.length,
      message: facts.shape.length ? { en: `reflect.json: ${facts.shape.slice(0, 5).join("; ")}`, ko: `reflect.json의 형식이 맞지 않습니다: ${facts.shape.slice(0, 5).join("; ")}` }
        : { en: "reflect.json has the agreed shape.", ko: "reflect.json의 형식이 맞습니다." } },
    { id: "own-words", ok: !facts.copied?.length,
      message: facts.copied === null ? { en: "This workspace does not read requests; nothing to compare.", ko: "이 작업 공간은 요청을 읽지 않아서 비교할 것이 없습니다." }
        : facts.copied.length ? { en: `Request text copied: ${facts.copied.slice(0, 5).join("; ")}. Summarize it in your own words.`, ko: `요청 원문을 옮겨 적었습니다: ${facts.copied.slice(0, 5).join("; ")}. 자기 말로 요약할 것.` }
        : { en: "Only summaries: no request text was copied.", ko: "요약만 적었고 요청 원문을 옮기지 않았습니다." } },
    { id: "skill-mistakes", ok: !open.length,
      message: !Array.isArray(facts.skillHits) ? { en: "Without --since, no new correction of a skill's work to compare.", ko: "--since가 없어서 비교할 새 스킬 교정이 없습니다." }
        : open.length ? { en: `Corrections of a skill's work, added since the commit, are neither recorded as that skill's mistake nor asked: ${open.map((hit) => hitName(hit)).join(", ")}. Name on each hit the case that reproduces the mistake ("case"). For a learned skill, make its check fail on it and run skills mistake with that case; otherwise add a question with the same "skill" and "case".`, ko: `이번에 더한 스킬 교정이 그 스킬의 실수로 기록되지도, 질문으로 남지도 않았습니다: ${open.map((hit) => hitName(hit, true)).join(", ")}. hit마다 그 실수를 재현한 경우의 이름("case")을 적을 것. 학습 스킬이면 검사가 그 경우를 실패로 판정하게 고친 뒤 그 경우로 skills mistake를 실행하고, 아니면 같은 "skill"과 "case"를 적은 질문을 남길 것.` }
        : { en: "Every correction of a skill's work added since the commit is recorded as its mistake or waits as a question.", ko: "이번에 더한 스킬 교정은 모두 그 스킬의 실수로 기록했거나 질문으로 남겼습니다." } },
    { id: "interests", ok: facts.interests !== false,
      message: facts.interests === false ? { en: "The `interests` node does not exist.", ko: "`interests`에 적힌 노드가 없습니다." }
        : facts.interests ? { en: "The interests node exists.", ko: "관심사 노드가 있습니다." } : { en: "No `interests` setting; reflection needs one.", ko: "`interests` 설정이 없습니다. 회고에는 이 설정이 필요합니다." } },
    { id: "node-rules", ok: !facts.errors.length,
      message: facts.errors.length ? { en: `The node rules fail: ${facts.errors.join(" ")}`, ko: `노드 규칙을 어겼습니다: ${facts.errors.join(" ")}` } : { en: "The node rules hold.", ko: "노드 규칙을 지킵니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행할 것.` }
        : { en: "The reflection is saved.", ko: "회고를 저장했습니다." } },
  ]
  if (facts.interests === null) checks.find((item) => item.id === "interests").ok = false
  if (options.requests) {
    const { shown, mark } = facts.requests
    const ok = Boolean(shown && mark && mark >= shown)
    checks.push({ id: "requests-marked", ok,
      message: ok ? { en: `Requests are marked read up to ${mark}.`, ko: `${mark}까지의 요청을 읽었다고 표시했습니다.` }
        : { en: `The requests read (up to ${shown ?? "?"}) are not marked: requests mark --for reflect --until ${shown ?? "<until>"}.`, ko: `읽은 요청(${shown ?? "?"}까지)을 표시하지 않았습니다: requests mark --for reflect --until ${shown ?? "<until>"}` } })
  }
  return checks
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--since <commit>] [--requests] [--json] | --facts <file> | --self-test",
  options: { since: { type: "string" }, requests: { type: "boolean" } },
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
