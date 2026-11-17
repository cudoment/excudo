#!/usr/bin/env node
// Usage: node scripts/check.mjs [--name <export>] [--json]
//        node scripts/check.mjs --self-test       (or --facts <file>: judge given facts)
// Run in the workspace after setting up or keeping an export. Checks what that must leave behind: the
// exports setting reads and names at least one file, each file is as the memo would write it now (not
// missing, behind, changed by hand or someone else's), no task of a retitle source still carries the
// title its source gave, a file inside a git working tree is ignored there, and the memo and settings
// are saved. Exit 0 when all hold, 1 when one does not, 2 on a usage error.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname } from "node:path"
import { pathToFileURL } from "node:url"

const kit = await import(pathToFileURL(kitPath()).href)

/** Whether git ignores a file: null outside a git working tree. */
function ignored(path) {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  const git = (...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })
  if (git("rev-parse", "--is-inside-work-tree").stdout.trim() !== "true") return null
  return git("check-ignore", "-q", path).status === 0
}

async function gather(ws, options) {
  let results = [], error = null
  try { results = kit.engine.exportStatus(ws, { only: options.name }) } catch (caught) { error = caught.message }
  return {
    error,
    exports: results.map((item) => ({ name: item.name, file: item.file, state: item.state,
      retitle: item.retitle.map((task) => `${task.page}:${task.line} ${task.title}`), ignored: ignored(item.path) })),
    unsaved: kit.uncommitted(ws, ["excudo.config.mjs", ".gitignore"]),
  }
}

const WHY = {
  missing: { en: "not written yet", ko: "아직 쓰지 않음" },
  outdated: { en: "behind the memo", ko: "메모보다 뒤처짐" },
  edited: { en: "changed by hand since it was written", ko: "쓴 뒤 누가 직접 고침" },
  exists: { en: "not written by excudo", ko: "excudo가 쓴 파일이 아님" },
}

function evaluate(facts) {
  const list = facts.exports ?? []
  const off = list.filter((item) => item.state !== "current")
  const titled = list.flatMap((item) => item.retitle.map((task) => `${item.name}: ${task}`))
  const tracked = list.filter((item) => item.ignored === false)
  const named = (items, lang) => items.map((item) => `${item.file} (${WHY[item.state]?.[lang] ?? item.state})`).join(", ")
  return [
    { id: "configured", ok: !facts.error && list.length > 0,
      message: facts.error ? { en: `The exports setting does not read: ${facts.error}`, ko: `exports 설정을 읽지 못했습니다: ${facts.error}` }
        : !list.length ? { en: "No export is set: add one to exports in excudo.config.mjs.", ko: "설정한 내보내기가 없습니다. excudo.config.mjs의 exports에 추가할 것." }
        : { en: `Exports set: ${list.map((item) => item.name).join(", ")}.`, ko: `설정한 내보내기: ${list.map((item) => item.name).join(", ")}` } },
    { id: "current", ok: !off.length,
      message: off.length ? { en: `Not as the memo would write them: ${named(off, "en")}. Run export; move a hand edit into the memo first, then export --force.`, ko: `메모대로 쓰이지 않은 파일이 있습니다: ${named(off, "ko")}. export를 실행하고, 직접 고친 파일은 그 내용을 메모로 옮긴 뒤 export --force를 실행할 것.` }
        : { en: "Every export is as the memo writes it now.", ko: "모든 내보내기 파일이 지금 메모대로 쓰여 있습니다." } },
    { id: "retitled", ok: !titled.length,
      message: titled.length ? { en: `Tasks still titled by their source: ${titled.join("; ")}. Give each a short title of its work in the memo.`, ko: `출처가 준 제목을 그대로 쓰는 할 일이 있습니다: ${titled.join("; ")}. 메모에서 각각 그 일을 나타내는 짧은 제목으로 바꿀 것.` }
        : { en: "No task is left with the title its source gave.", ko: "출처가 준 제목을 그대로 쓰는 할 일이 없습니다." } },
    { id: "ignored", ok: !tracked.length,
      message: tracked.length ? { en: `Inside a git working tree but not ignored: ${tracked.map((item) => item.file).join(", ")}. Add them to its .gitignore.`, ko: `git 작업 트리 안에 있지만 무시하지 않는 파일이 있습니다: ${tracked.map((item) => item.file).join(", ")}. 그 .gitignore에 추가할 것.` }
        : { en: "No export file is kept by git.", ko: "git이 관리하는 내보내기 파일이 없습니다." } },
    { id: "saved", ok: facts.unsaved === null || !facts.unsaved?.length,
      message: facts.unsaved?.length ? { en: `Not saved: ${facts.unsaved.join(", ")}. Run save, and commit the settings.`, ko: `저장하지 않은 변경이 있습니다: ${facts.unsaved.join(", ")}. save를 실행하고 설정도 커밋할 것.` }
        : { en: "The memo and the settings are saved.", ko: "메모와 설정을 저장했습니다." } },
  ]
}

await kit.runCheck({
  usage: "Usage: node scripts/check.mjs [--name <export>] [--json] | --facts <file> | --self-test",
  options: { name: { type: "string" } },
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
