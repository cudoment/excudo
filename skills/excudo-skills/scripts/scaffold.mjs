#!/usr/bin/env node
// Usage: node scripts/scaffold.mjs <name> --description "<what it does; Use for “…”>" [--global] [--json]
// Run in the workspace. Starts a learned skill in the workspace's skills folder (the `skills.dir`
// setting, default skills/): SKILL.md, a check script and the known cases lint feeds it, each place
// to write marked FILL IN; --global writes the check's path for a skill the owner wants in every
// folder. `skills lint <name>` fails until every mark is replaced. Exit 0 when created,
// 1 when the folder already exists, 2 on a usage error.
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"

// The mark of each place to write, built from parts so this script does not read as unfinished itself.
const FILL = ["FILL", "IN:"].join(" ")
const USAGE = "Usage: node scripts/scaffold.mjs <name> --description \"<what it does; Use for “…”>\" [--global] [--json]"
const kit = await import(pathToFileURL(kitPath()).href)
const { engine } = kit

let values, positionals
try {
  ({ values, positionals } = parseArgs({ allowPositionals: true, options: { description: { type: "string" }, global: { type: "boolean" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } }))
} catch (error) { fail(2, `${error.message}\n\n${USAGE}`) }
if (values.help) { console.log(USAGE); process.exit(0) }
const [name] = positionals
if (!name || !values.description?.trim()) fail(2, USAGE)
if (!engine.SKILL_NAME.test(name) || name.length > 64) fail(2, `${name}: lowercase letters and digits joined by hyphens, at most 64 characters.`)
if (engine.skillNames().includes(name)) fail(2, `${name} is one of the engine's skills; choose another name.`)
const ws = await engine.loadWorkspace()
if (!ws.hasConfig) fail(2, `No excudo workspace at ${ws.root}.`)
const settings = engine.learnedSettings(ws)
const dir = join(settings.root, name)
if (existsSync(dir)) fail(1, `${relative(ws.root, dir)} already exists: edit it instead.`)

const ko = ws.locale === "ko"
// Where agents will find the check once the skill is installed; the text names the other place too,
// since a skill can be moved later.
const global = values.global || settings.install === "global"
const checkPath = `${global ? "~/.agents" : ".agents"}/skills/${name}/scripts/check.mjs`
const yamlString = (text) => JSON.stringify(text.trim())
const skill = `---
name: ${name}
description: ${yamlString(values.description)}
---

# ${name}

${ko ? `${FILL} 이 스킬이 무엇을 어디에서(저장소나 폴더) 하는지 한 문단으로 씁니다. 사용자의 요청을 옮겨 적지 말고 자기 말로 요약합니다.`
  : `${FILL} one paragraph on what this skill does and where (which repository or folder). Summarize the owner's requests in your own words; never copy them.`}

## ${ko ? "절차" : "Steps"}

1. ${ko ? `${FILL} 되풀이되는 단계와 실행할 명령을 씁니다. 매번 같은 결과가 나와야 하는 작업(검색, 변환, 생성)은 scripts/에 스크립트로 두고 여기에서 실행합니다.`
  : `${FILL} the steps that repeat, with the commands to run. Work that must come out the same every time (a search, a conversion, a generated file) goes into a script in scripts/ and is run from here.`}

## ${ko ? "검사" : "Check"}

${ko ? `작업한 폴더에서 검사를 실행하고, 알린 문제를 고친 뒤 통과할 때까지 다시 실행합니다. 결과를 보고에 적습니다. 이 스킬의 스크립트는 작업 폴더의 \`.agents/skills/${name}/scripts/\`에 있습니다(전역에 설치했다면 \`~/.agents/skills/${name}/scripts/\`).`
  : `Run the check in the folder the work happened in, fix what it reports and run it again until it passes. Report its result. This skill's scripts are in \`.agents/skills/${name}/scripts/\` from the workspace root (\`~/.agents/skills/${name}/scripts/\` when it is installed for every folder).`}

\`\`\`sh
node ${checkPath}
\`\`\`
`
const check = `#!/usr/bin/env node
// Usage: node scripts/check.mjs [--json]
//        node scripts/check.mjs --facts <file>   judge the facts in a JSON file (how lint feeds the cases)
// ${FILL} what this check makes sure of, in one or two lines. Exit 0 when every requirement holds,
// 1 when one does not, 2 on a usage error. It only reads: it never changes a file.
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

/** Reads the facts the requirements are judged on (files, read-only commands), as plain data. */
function gather(options) {
  // ${FILL} read what the work must have left behind.
  return {}
}

/** The requirements, judged on the facts alone, so known cases (check.cases.json) can be fed to it. */
function evaluate(facts, options) {
  return [
    // ${FILL} { id: "short-id", ok: <condition on facts>, message: "what holds, or what to fix" },
  ]
}

let values
try {
  ({ values } = parseArgs({ allowPositionals: true, options: { json: { type: "boolean" }, facts: { type: "string" }, help: { type: "boolean", short: "h" } } }))
} catch (error) { console.error(error.message); process.exit(2) }
// A check that judged nothing has not shown that anything holds.
const passes = (checks) => checks.length > 0 && checks.every((item) => item.ok)
if (values.help) console.log("Usage: node scripts/check.mjs [--json] | --facts <file>")
else {
  let checks
  try { checks = evaluate(values.facts ? JSON.parse(readFileSync(values.facts, "utf8")) : gather(values), values) } catch (error) { console.error(error.message); process.exit(2) }
  if (values.json) console.log(JSON.stringify({ ok: passes(checks), checks }, null, 2))
  else for (const item of checks) console.log(\`\${item.ok ? "✓" : "✗"} \${item.id}: \${item.message}\`)
  process.exitCode = passes(checks) ? 0 : 1
}
`
// The known cases lint feeds the check: at least one that must pass and one that must fail.
const cases = `[
  { "name": "${FILL} the work done right", "expect": "pass", "facts": {} },
  { "name": "${FILL} a step left out", "expect": "fail", "facts": {} }
]
`
mkdirSync(join(dir, "scripts"), { recursive: true })
writeFileSync(join(dir, "SKILL.md"), skill)
writeFileSync(join(dir, "scripts", "check.mjs"), check, { mode: 0o755 })
writeFileSync(join(dir, "scripts", "check.cases.json"), cases)
const created = { name, dir: relative(ws.root, dir), files: ["SKILL.md", "scripts/check.mjs", "scripts/check.cases.json"] }
console.log(values.json ? JSON.stringify(created, null, 2) : `${created.dir}: ${created.files.join(", ")}`)

function fail(code, message) {
  console.error(message)
  process.exit(code)
}

function kitPath() {
  for (const from of [import.meta.url, `${process.env.EXCUDO_ROOT || process.cwd()}/`, `${process.cwd()}/`])
    try { return createRequire(from).resolve("excudo/skill-kit") } catch {}
  console.error("The excudo engine is missing: run npm install in the workspace.")
  process.exit(2)
}
