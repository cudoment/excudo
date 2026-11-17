#!/usr/bin/env node
// Usage: node scripts/check.mjs [--json] [--trim-since <commit>]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after making or keeping learned skills. Checks what that must leave behind:
// skills.json reads, every skill in use still meets the skill rule at the workspace's minimum score
// and is installed as its source is, a skill installed for every folder says why or was asked for by
// the owner (unless the workspace installs every skill so), no skill kept in the workspace was asked for
// mostly in other folders (where it is never read) unless the owner asked for it, no skill for every
// folder was asked for only in this workspace without a reason (the workspace's own work stays here,
// even when the workspace installs every skill for every folder), every skill folder is
// adopted (in use or a draft), every case recorded for a mistake the owner pointed out
// (`skills mistake`) is still a case the skill's check must fail, and the skills, their links and
// their record are saved. Exit 0 when all hold, 1 when one does not, 2 on a usage error.
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { relative } from "node:path"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)
let trimRun

async function gather(ws, options) {
  if ((options.scheduled || options.uncommitted) && !options["trim-since"]) throw new kit.UsageError(ws.locale === "ko" ? "--scheduled와 --uncommitted에는 --trim-since가 필요합니다." : "--scheduled and --uncommitted need --trim-since.")
  const { engine } = kit
  const settings = engine.learnedSettings(ws)
  let record, broken
  try { record = engine.readLearned(ws) } catch (error) { broken = error.message }
  const status = broken ? { skills: [], unregistered: [] } : engine.skillsStatus(ws)
  const names = Object.keys(record?.skills ?? {})
  const facts = {
    broken: broken ?? null,
    statuses: Object.entries(record?.skills ?? {}).filter(([, entry]) => !["active", "draft", "retired"].includes(entry.status)).map(([name]) => name),
    skills: status.skills.map(({ name, status: state, fit, held, state: installed, install, typed, problems, mistakes, lost }) => {
      const requested = Boolean(record.skills[name]?.evidence?.requested)
      return { name, status: state, fit, held: Boolean(held), installed, install, asked: requested || Boolean(record.skills[name]?.why), requested, typed, problems, mistakes: mistakes ?? 0, lost: lost ?? [] }
    }),
    unregistered: status.unregistered,
    uncommitted: Boolean(options.uncommitted),
    trimPaths: ["AGENTS.md", "skills.json", relative(ws.root, settings.root), ".agents/skills", ".claude/skills"],
    unsaved: kit.uncommitted(ws, ["skills.json", settings.dir, ...(options["trim-since"] ? ["AGENTS.md"] : []), ...names.flatMap((name) => [`.agents/skills/${name}`, `.claude/skills/${name}`])]),
    minScore: settings.minScore,
    install: settings.install,
    trim: options["trim-since"] ? engine.instructionsPreservation(ws, options["trim-since"], { uncommitted: Boolean(options.uncommitted) }) : null,
    scheduled: options.scheduled ? scheduledFacts(ws, options) : null,
  }
  trimRun = { ws, options, facts, skillDir: relative(ws.root, settings.root) }
  return facts
}

function scheduledFacts(ws, options) {
  const size = kit.engine.instructionsSize(ws)
  const before = spawnSync("git", ["-C", ws.root, "show", `${options["trim-since"]}:./AGENTS.md`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  if (before.status !== 0) throw new kit.UsageError(ws.labels.messages["instructions-revision"])
  return { auto: size.auto, started: size.enabled && Buffer.byteLength(before.stdout) > size.limit,
    aboveTarget: size.aboveTarget, over: size.over, targetBlocked: size.targetBlocked,
    reason: options["trim-reason"]?.trim() || (size.targetBlocked && !size.over ? kit.engine.instructionsBlockedNotice(ws, size) : "") }
}

function evaluate(facts) {
  const unsaved = facts.uncommitted && facts.trim && facts.unsaved !== null ? facts.unsaved?.filter((line) => !line.slice(3).split(" -> ").every((file) =>
    facts.trimPaths?.some((path) => file === path || file.startsWith(path + "/")))) : facts.unsaved
  const active = facts.skills.filter((skill) => skill.status === "active")
  // A skill whose check ran out of time on a known case was not judged: upkeep holds it, and so does this check.
  const held = active.filter((skill) => !skill.fit && skill.held)
  const unfit = active.filter((skill) => !skill.fit && !skill.held)
  const off = active.filter((skill) => skill.fit && skill.installed !== "current")
  const heldNote = held.length ? { en: ` Held, as their checks ran out of time on a known case: ${held.map((skill) => skill.name).join(", ")}.`, ko: ` 검사가 알려진 경우에서 시간을 넘겨 판정을 보류한 스킬: ${held.map((skill) => skill.name).join(", ")}.` } : { en: "", ko: "" }
  // Where the workspace keeps skills to itself, one for every folder carries its reason or the owner's ask.
  const unasked = facts.install === "global" ? [] : active.filter((skill) => skill.install === "global" && !skill.asked)
  // A skill kept in the workspace is read only there; one asked for mostly elsewhere goes to every folder or out of use.
  const astray = active.filter((skill) => skill.install !== "global" && !skill.requested && (skill.typed?.elsewhere ?? 0) > (skill.typed?.here ?? 0))
  // The other way round: one for every folder whose requests all came from here, with no reason, is this workspace's own work.
  const homeOnly = active.filter((skill) => skill.install === "global" && !skill.asked && !unasked.includes(skill)
    && (skill.typed?.here ?? 0) > 0 && !(skill.typed?.elsewhere ?? 0))
  const counted = (skill) => `${skill.name} (${skill.typed.elsewhere}/${skill.typed.here + skill.typed.elsewhere})`
  // A skill in use or a draft keeps the cases recorded for the owner's corrections; a retired one is out of use.
  const lost = facts.skills.filter((skill) => skill.status !== "retired" && skill.lost?.length)
  const kept = facts.skills.reduce((sum, skill) => sum + (skill.mistakes ?? 0), 0)
  const named = (skill) => `${skill.name} (${skill.lost.map((name) => `“${name}”`).join(", ")})`
  return [
    ...(facts.scheduled ? [{ id: "instructions-auto", ok: !facts.scheduled.auto || !facts.scheduled.started || !facts.scheduled.aboveTarget || Boolean(facts.scheduled.reason?.trim()),
      message: { en: `A scheduled automatic trim reached its target or reported why material remains.${facts.scheduled.reason ? " " + facts.scheduled.reason : ""}`,
        ko: `예약 자동 정리가 목표 크기에 도달했거나 남긴 이유를 보고합니다.${facts.scheduled.reason ? " " + facts.scheduled.reason : ""}` } }] : []),
    ...(facts.trim ? [{ id: "instructions-trim", ok: !facts.trim.template && !facts.trim.pinned && !facts.trim.lost,
      message: { en: `Instructions preservation: ${facts.trim.template} template rules missing or changed, ${facts.trim.pinned} pinned sections changed, ${facts.trim.lost} removed lines not preserved as contiguous block pieces with their original counts.`,
        ko: `지침 보존: 템플릿 규칙 누락/변경 ${facts.trim.template}개, 고정 절 변경 ${facts.trim.pinned}개, 순서나 출현 횟수를 보존하지 못한 삭제 줄 ${facts.trim.lost}개입니다.` } }] : []),
    { id: "record", ok: !facts.broken && !facts.statuses.length,
      message: facts.broken ? { en: `skills.json does not read: ${facts.broken}`, ko: `skills.json을 읽지 못했습니다: ${facts.broken}` }
        : facts.statuses.length ? { en: `Unknown status for: ${facts.statuses.join(", ")}.`, ko: `상태가 올바르지 않은 스킬이 있습니다: ${facts.statuses.join(", ")}` }
        : { en: "skills.json reads.", ko: "skills.json을 읽을 수 있습니다." } },
    { id: "fit", ok: !unfit.length,
      message: unfit.length ? { en: `In use but below ${facts.minScore} or against the skill rule: ${unfit.map((skill) => `${skill.name} (${skill.problems.slice(0, 2).join("; ")})`).join(", ")}. Fix them or run skills upkeep.`, ko: `쓰고 있지만 ${facts.minScore}점 미만이거나 스킬 규칙을 어긴 스킬이 있습니다: ${unfit.map((skill) => `${skill.name} (${skill.problems.slice(0, 2).join("; ")})`).join(", ")}. 고치거나 skills upkeep을 실행할 것.` }
        : { en: `Every skill in use meets the skill rule at ${facts.minScore} or more.${heldNote.en}`, ko: `쓰고 있는 스킬이 모두 스킬 규칙을 지키고 ${facts.minScore}점 이상입니다.${heldNote.ko}` } },
    { id: "installed", ok: !off.length,
      message: off.length ? { en: `Not installed as their source is: ${off.map((skill) => `${skill.name} (${skill.installed})`).join(", ")}. Run skills upkeep; an edited copy goes back into the source first.`, ko: `원본과 다르게 설치된 스킬이 있습니다: ${off.map((skill) => `${skill.name}(${skill.installed})`).join(", ")}. skills upkeep을 실행하고, 설치본을 고쳤다면 먼저 원본에 옮길 것.` }
        : { en: "Every skill in use is installed as its source is.", ko: "쓰고 있는 스킬이 모두 원본대로 설치되어 있습니다." } },
    { id: "global-reason", ok: !unasked.length,
      message: unasked.length ? { en: `Installed for every folder with no reason and no ask from the owner: ${unasked.map((skill) => skill.name).join(", ")}. Adopt them again with --global --why <words>, or with --workspace.`, ko: `이유도 사용자의 요청도 없이 전역에 설치된 스킬이 있습니다: ${unasked.map((skill) => skill.name).join(", ")}. --global --why <이유>나 --workspace로 다시 채택할 것.` }
        : { en: "Every skill in every folder has its reason or the owner's ask.", ko: "전역에 둔 스킬마다 이유나 사용자의 요청이 있습니다." } },
    { id: "placed", ok: !astray.length,
      message: astray.length ? { en: `Kept in this workspace but asked for mostly in other folders, where it is never read (requests typed elsewhere/all): ${astray.map(counted).join(", ")}. Adopt it again with --global --why <words>, or ask the owner whether to retire it.`, ko: `작업 폴더에 있지만 요청이 대부분 다른 폴더에서 나와서, 정작 그 폴더에서는 읽히지 않는 스킬이 있습니다(다른 폴더의 요청/전체): ${astray.map(counted).join(", ")}. --global --why <이유>로 다시 채택하거나, 내릴지 사용자에게 물을 것.` }
        : { en: "No skill kept in this workspace was asked for mostly in other folders.", ko: "작업 폴더에 둔 스킬 가운데 요청이 대부분 다른 폴더에서 나온 스킬은 없습니다." } },
    { id: "placed-here", ok: !homeOnly.length,
      message: homeOnly.length ? { en: `Installed for every folder but asked for only in this workspace, with no reason for other folders: ${homeOnly.map((skill) => skill.name).join(", ")}. This workspace's own work stays here even with install: "global": adopt it again with --workspace, or with --global --why <words> when other folders need it.`, ko: `전역에 설치했지만 요청이 모두 이 작업 폴더에서 나왔고 다른 폴더에 둘 이유도 없는 스킬이 있습니다: ${homeOnly.map((skill) => skill.name).join(", ")}. 작업 폴더만의 일은 install: "global"이어도 작업 폴더에 둡니다. --workspace로 다시 채택하거나, 다른 폴더에도 필요하면 --global --why <이유>로 다시 채택할 것.` }
        : { en: "No skill for every folder was asked for only in this workspace without a reason.", ko: "전역에 둔 스킬 가운데 이유 없이 이 작업 폴더의 요청만 받은 스킬은 없습니다." } },
    { id: "mistakes", ok: !lost.length,
      message: lost.length ? { en: `Cases recorded for mistakes the owner pointed out are gone or no longer must fail: ${lost.map(named).join(", ")}. Put each back in scripts/check.cases.json with expect "fail", and make the check fail on it again.`, ko: `사용자가 지적한 실수로 기록한 경우가 없어졌거나 더는 실패해야 하는 경우가 아닙니다: ${lost.map(named).join(", ")}. scripts/check.cases.json에 expect "fail"로 되살리고 검사가 다시 그 경우를 실패로 판정하게 할 것.` }
        : { en: `Every case recorded for a mistake the owner pointed out (${kept}) still must fail.`, ko: `사용자가 지적한 실수로 기록한 경우(${kept}개)가 모두 실패해야 하는 경우로 남아 있습니다.` } },
    { id: "adopted", ok: !facts.unregistered.length,
      message: facts.unregistered.length ? { en: `Skill folders never adopted: ${facts.unregistered.join(", ")}. Run skills adopt (a skill that does not fit stays a draft) or remove the folder.`, ko: `채택하지 않은 스킬 폴더가 있습니다: ${facts.unregistered.join(", ")}. skills adopt를 실행하거나(맞지 않으면 초안으로 남습니다) 폴더를 지울 것.` }
        : { en: "Every skill folder is adopted or a draft.", ko: "모든 스킬 폴더가 채택되었거나 초안으로 기록되어 있습니다." } },
    { id: "saved", ok: unsaved === null || !unsaved.length,
      message: unsaved?.length ? { en: `Not saved: ${unsaved.join(", ")}. Run save.`, ko: `저장하지 않은 변경이 있습니다: ${unsaved.join(", ")}. save를 실행할 것.` }
        : facts.uncommitted ? { en: "Only instructions and skills await the trim commit; other checked files are saved.", ko: "지침과 스킬만 정리 커밋을 기다리며 다른 검사 대상은 저장했습니다." }
        : { en: "The skills and skills.json are saved.", ko: "스킬과 skills.json을 저장했습니다." } },
  ]
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--json] [--trim-since <commit>] [--scheduled] [--trim-reason <text>] [--uncommitted] | --facts <file> | --self-test",
  options: { "trim-since": { type: "string" }, scheduled: { type: "boolean" }, "trim-reason": { type: "string" }, uncommitted: { type: "boolean" } },
  gather,
  evaluate,
  cases: new URL("./check.cases.json", import.meta.url),
})

// A verified, committed trim refreshes the cache even when unrelated requirements fail.
// Gather never runs for facts or self-tests, and prospective checks never write.
if (trimRun?.options["trim-since"] && !trimRun.options.uncommitted
  && !trimRun.facts.trim.template && !trimRun.facts.trim.pinned && !trimRun.facts.trim.lost) {
  const saved = spawnSync("git", ["-C", trimRun.ws.root, "status", "--porcelain", "--untracked-files=all", "--", "AGENTS.md", trimRun.skillDir], { encoding: "utf8" })
  if (saved.status === 0 && !saved.stdout.trim()) kit.engine.recordInstructionsTrim(trimRun.ws)
}

function kitPath() {
  for (const from of [import.meta.url, `${process.env.EXCUDO_ROOT || process.cwd()}/`, `${process.cwd()}/`])
    try { return createRequire(from).resolve("excudo/skill-kit") } catch {}
  console.error("The excudo engine is missing: run npm install in the workspace.")
  process.exit(2)
}
