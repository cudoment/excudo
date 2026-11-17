import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs, { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { check, errorsOf, instructions, instructionsSize } from "../src/index.mjs"
import { renderTemplate } from "../src/init.mjs"
import { instructionsPreservation, moveInstructions, pinnedInstructions } from "../src/instructions.mjs"
import { workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
const script = resolve("skills/excudo-skills/scripts/check.mjs")
const write = (ws, file, text) => {
  mkdirSync(dirname(join(ws.root, file)), { recursive: true })
  writeFileSync(join(ws.root, file), text)
}
const skill = (ws, name, dir = "skills") => write(ws, `${dir}/${name}/SKILL.md`, `# ${name}\n`)
const template = (ws) => renderTemplate("AGENTS.md", { locale: ws.locale, graph: "notes", home: ws.labels.home, done: ws.labels.done })
const words = "Keep the procedure and its evidence together for the next run. ".repeat(12)
const section = (name, body) => `## ${name}\n\n${body}\n\n`
const run = (ws, args) => spawnSync(process.execPath, [cli, ...args], { cwd: ws.root, encoding: "utf8" })
const git = (ws, ...args) => {
  const result = spawnSync("git", ["-C", ws.root, ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

test("fixtures select workspace procedures, protect rules and pins, and ignore code headings", async () => {
  const ws = await workspace({ "Topic.md": "# Topic\nA topic.\n" })
  skill(ws, "release-notes")
  skill(ws, "link-check")
  const text = template(ws) + "\n" + [
    section("Release routine", `Use \`release-notes\` and \`skills/release-notes/references/release.md\`, then \`link-check\`.\n${words}`),
    section("Engine routine", `Use \`excudo-recall\`.\n1. Read the report.\n2. Run the local procedure.\n${words}`),
    `<!-- excudo: keep -->\n${section("Pinned", `Use \`release-notes\`.\n${words}`)}`,
    section("Always", `Use \`release-notes\`.\n${words}`),
    section("Short", "Always keep evidence."),
    section("Every session", words),
    section("Engine reference", `Use \`excudo-recall\`. ${words}`),
    section("Fenced routine", `Run these steps.\n\`\`\`sh\n## Fake heading\n- fake item\nnode scripts/verify.mjs\n${words}\n\`\`\``),
  ].join("")
  write(ws, "AGENTS.md", text)
  const report = instructions({ ...ws, instructions: { keep: ["Always"] } })
  assert.deepEqual(report.candidates.map((item) => item.headingPath.at(-1)).sort(), ["Engine routine", "Fenced routine", "Release routine"])
  assert.equal(report.threshold, 512)
  assert.equal(report.bytes, Buffer.byteLength(text))
  const release = report.candidates.find((item) => item.headingPath.at(-1) === "Release routine")
  assert.deepEqual(release.target, { name: "release-notes", exists: true })
  const engine = report.candidates.find((item) => item.headingPath.at(-1) === "Engine routine")
  assert.deepEqual(engine.target, { name: "engine-routine", exists: false })
  assert.deepEqual(engine.engineSkills, ["excudo-recall"])
  assert.match(engine.reason, /general behavior stays in the engine/)
  const fenced = report.candidates.find((item) => item.headingPath.at(-1) === "Fenced routine")
  assert.deepEqual(fenced.target, { name: "fenced-routine", exists: false })
  assert.ok(report.candidates.every((item, i, all) => !i || all[i - 1].bytes >= item.bytes))
  for (const item of report.candidates) {
    const block = text.split(/(?<=\n)/).slice(item.startLine - 1, item.endLine).join("")
    assert.equal(item.bytes, Buffer.byteLength(block))
    assert.equal(typeof item.reason, "string")
    assert.equal("text" in item, false)
  }
})

test("top-level items keep nested lines, and template items stay protected even with added commands", async () => {
  const ws = await workspace({})
  skill(ws, "release-notes")
  const own = `- Use \`release-notes\`.\n  ${words}\n  - Review the result.\n\n`
  const modifiedTemplate = template(ws).replace("- **Write each thing once.**", `- **Write each thing once.** Use \`release-notes\`.\n  ${words}\n  node check.mjs\n `)
  write(ws, "AGENTS.md", modifiedTemplate + "\n" + own + "- Short rule.\n")
  const { candidates } = instructions(ws)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "item")
  assert.equal(candidates[0].bytes, Buffer.byteLength(own))
  assert.deepEqual(candidates[0].headingPath, ["Excudo personal project", "The engine and this project"])
})

test("pins protect descendants and parents, and full heading paths match", async () => {
  const ws = await workspace({})
  skill(ws, "release-notes")
  const text = `# Memo\n## Work\nUse \`release-notes\`. ${words}\n\n### Safe\nUse \`release-notes\`. ${words}\n\n<!-- excudo: keep -->\n### Guard\n${words}\n#### Child\n1. Keep it.\n${words}\n\n## Other\n### Safe\nUse \`release-notes\`. ${words}\n`
  write(ws, "AGENTS.md", text)
  const own = { ...ws, instructions: { keep: ["Memo > Other > Safe"] } }
  const result = instructions(own)
  assert.deepEqual(result.candidates.map((item) => item.headingPath), [["Memo", "Work", "Safe"]])
  const pins = pinnedInstructions(own, text)
  assert.equal(pins.length, 2)
  assert.ok(pins[0].startsWith("<!-- excudo: keep -->\n### Guard"))
  assert.ok(pins[0].includes("#### Child"))
  write(ws, "AGENTS.md", section("고정".normalize("NFD"), `Use \`release-notes\`. ${words}`))
  assert.deepEqual(instructions({ ...ws, instructions: { keep: ["고정"] } }).candidates, [])
})

test("configured and installed skills, path mentions, ties and collision-free new names", async () => {
  const ws = await workspace({}, { skills: { dir: "procedures" } })
  skill(ws, "release-notes", "procedures")
  skill(ws, "link-check", ".agents/skills")
  skill(ws, "fresh")
  const text = [
    section("Paths", `Use procedures/release-notes/scripts/run.mjs and .agents/skills/link-check/SKILL.md.\n${words}`),
    section("Fresh", `1. Run the check.\n${words}`),
    section("excudo-recall", `\`\`\`sh\nnode check.mjs\n\`\`\`\n${words}`),
    section("문서 절차", `1. Read the steps.\n${words}`),
  ].join("")
  // A configured source directory is authoritative; an unrelated skills/ folder is not a target.
  skill(ws, "fresh", "procedures")
  write(ws, "AGENTS.md", text)
  const { candidates } = instructions(ws)
  assert.deepEqual(candidates.find((item) => item.headingPath[0] === "Paths").target, { name: "link-check", exists: true })
  assert.deepEqual(candidates.find((item) => item.headingPath[0] === "Fresh").target, { name: "fresh-2", exists: false })
  assert.equal(candidates.find((item) => item.headingPath[0] === "excudo-recall").target.name, "excudo-recall-2")
  assert.match(candidates.find((item) => item.headingPath[0] === "문서 절차").target.name, /^workspace-procedure-\d+$/)
})

test("CRLF byte counts, comment boundaries, exact threshold and nonoverlapping whole sections", async () => {
  const ws = await workspace({})
  skill(ws, "release-notes")
  const header = "## Exact\r\nUse `release-notes`.\r\n"
  const exact = header + "x".repeat(512 - Buffer.byteLength(header))
  write(ws, "AGENTS.md", exact)
  assert.equal(instructions(ws).candidates[0].bytes, 512)
  write(ws, "AGENTS.md", exact.slice(0, -1))
  assert.equal(instructions(ws).candidates.length, 0)
  const text = `## Parent\nUse \`release-notes\`.\n\n### Child\n- Use \`release-notes\`.\n  ${words}\n\n<!--\n## Not a heading\n- Not an item\n-->\n`
  write(ws, "AGENTS.md", text)
  const result = instructions(ws)
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.candidates[0].headingPath, ["Parent"])
})

test("default and configured limits, explicit override, disabled budget and missing file", async () => {
  const ws = await workspace({}, { instructions: { limit: 700 } })
  assert.deepEqual(ws.instructions, { limit: 700, target: null, auto: false, keep: [] })
  write(ws, "AGENTS.md", section("Routine", `1. Run.\n${words}`))
  const report = instructions(ws)
  assert.equal(report.limit, 700)
  assert.equal(report.over, true)
  assert.equal(instructions(ws, { limit: "5000" }).over, false)
  assert.equal(instructions({ ...ws, instructions: undefined }).limit, 32768)
  assert.equal(instructions(ws, { limit: report.bytes }).over, false)
  for (const setting of [false, { limit: false }]) {
    const off = { ...ws, instructions: setting }
    assert.deepEqual(instructions(off), { file: "AGENTS.md", exists: true, enabled: false, bytes: report.bytes, limit: false, target: false, auto: false, pinned: 0, movable: report.bytes, pinnedBlocks: [], targetBlocked: false, aboveTarget: false, over: false, lastTrim: null, growth: null, threshold: 512, candidates: [] })
    assert.equal(instructions(off, { limit: 1 }).over, true)
  }
  const empty = await workspace({})
  assert.deepEqual(instructions(empty), { file: "AGENTS.md", exists: false, enabled: true, bytes: 0, limit: 32768, target: 27852, auto: false, pinned: 0, movable: 0, pinnedBlocks: [], targetBlocked: false, aboveTarget: false, over: false, lastTrim: null, growth: null, threshold: 512, candidates: [] })
  for (const setting of [null, "small", [], { limit: -1 }, { limit: "100" }, { keep: "Always" }, { keep: [""] }])
    assert.throws(() => instructions({ ...ws, instructions: setting }), /instructions must be/)
  for (const limit of [0, -1, "1.1", "no", "", "Infinity", "1e3"])
    assert.throws(() => instructions(ws, { limit }), /positive integer/)
})

test("check warns without an error, works in both languages, and respects false", async () => {
  for (const locale of ["en", "ko"]) {
    const ws = await workspace({ "Topic.md": "# Topic\nA topic.\n" }, { locale, instructions: { limit: 10 } })
    write(ws, "AGENTS.md", "Always read the rules.\n")
    const result = await check(ws)
    const warning = result.issues.find((item) => item.code === "instructions-size")
    assert.equal(warning.severity, "warning")
    assert.equal(warning.file, "AGENTS.md")
    assert.match(warning.message, /npx --no-install excudo instructions/)
    assert.equal(errorsOf(result.issues).length, 0)
    assert.ok(!(await check({ ...ws, instructions: false })).issues.some((item) => item.code === "instructions-size"))
    const cliResult = run(ws, ["check", "--json"])
    assert.equal(cliResult.status, 0, cliResult.stderr)
    assert.ok(JSON.parse(cliResult.stdout).issues.some((item) => item.code === "instructions-size"))
  }
})

test("--limit keeps an explicit target below the override and otherwise uses 85 percent", async () => {
  const ws = await workspace({}, { instructions: { limit: 100000, target: 70000 } })
  for (const [limit, target] of [[65536, 55705], [70000, 59500], [80000, 70000]]) {
    const result = run(ws, ["instructions", "--json", "--limit", String(limit)])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).limit, limit)
    assert.equal(JSON.parse(result.stdout).target, target)
  }
  assert.equal(instructions(ws).target, 70000)
})

test("CLI JSON shape and --limit, text explanations and no workspace changes", async () => {
  const ws = await workspace({}, { instructions: { limit: 600 } })
  skill(ws, "release-notes")
  write(ws, "AGENTS.md", section("Release", `Use \`release-notes\`. ${words}`))
  const before = readFileSync(join(ws.root, "AGENTS.md")), files = readdirSync(ws.root)
  const result = run(ws, ["instructions", "--json"])
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), instructions(ws))
  assert.equal(JSON.parse(run(ws, ["instructions", "--json", "--limit", "2000"]).stdout).over, false)
  const text = run(ws, ["instructions"])
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, /AGENTS.md: \d+ bytes \/ 600 bytes \(over limit\)/)
  assert.match(text.stdout, /existing workspace skill release-notes/)
  assert.equal(run(ws, ["instructions", "--limit", "bad"]).status, 1)
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)).sort(), ["aboveTarget", "auto", "bytes", "candidates", "enabled", "exists", "file", "growth", "lastTrim", "limit", "movable", "over", "pinned", "pinnedBlocks", "target", "targetBlocked", "threshold"])
  assert.deepEqual(Object.keys(JSON.parse(result.stdout).candidates[0]).sort(), ["bytes", "endLine", "engineSkills", "headingPath", "kind", "reason", "startLine", "target"])
  assert.deepEqual(readFileSync(join(ws.root, "AGENTS.md")), before)
  assert.deepEqual(readdirSync(ws.root), files)
})

test("disabled settings load from config and CLI --limit can opt into a single report", async () => {
  for (const instructions of [false, { limit: false }]) {
    const ws = await workspace({}, { instructions })
    write(ws, "AGENTS.md", section("Routine", `1. Run.\n${words}`))
    const off = JSON.parse(run(ws, ["instructions", "--json"]).stdout)
    assert.equal(off.enabled, false)
    assert.deepEqual(off.candidates, [])
    const override = JSON.parse(run(ws, ["instructions", "--json", "--limit", "100"]).stdout)
    assert.equal(override.over, true)
    assert.equal(override.candidates.length, 1)
  }
})

test("fresh templates in both languages stay well below the default budget and yield no candidates", async () => {
  for (const locale of ["en", "ko"]) {
    const ws = await workspace({}, { locale })
    write(ws, "AGENTS.md", template(ws))
    const result = instructions(ws)
    assert.ok(result.bytes < 9000)
    assert.ok(result.bytes < result.limit / 3)
    assert.equal(result.over, false)
    assert.deepEqual(result.candidates, [])
    assert.equal(instructionsSize(ws).bytes, result.bytes)
  }
})

test("trim check reads a real before/after diff and rejects lost decisions and changed pins", async () => {
  const ws = await workspace({ "Topic.md": "# Topic\nA topic.\n" })
  const dated = "- 2026-01-05: Keep the release evidence unchanged."
  const pin = section("Always", "Keep all evidence private.")
  const old = template(ws) + `\n<!-- excudo: keep -->\n${pin}` + section("Release procedure", dated)
  write(ws, "AGENTS.md", old)
  git(ws, "init")
  git(ws, "config", "user.name", "Test Owner")
  git(ws, "config", "user.email", "owner@example.com")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: baseline")
  const revision = git(ws, "rev-parse", "HEAD")
  write(ws, "skills/release-notes/SKILL.md", section("Release procedure", dated))
  // Drafts are enough: the skill's existing checks still reject unregistered folders.
  write(ws, "skills.json", JSON.stringify({ skills: { "release-notes": { status: "draft", install: "workspace" } } }))
  write(ws, "AGENTS.md", template(ws) + `\n<!-- excudo: keep -->\n${pin}` + "## Release\nUse `release-notes` for the release procedure.\n")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: move instructions")
  const checkTrim = (...args) => spawnSync(process.execPath, [script, "--json", "--trim-since", revision, ...args], { cwd: ws.root, encoding: "utf8" })
  const good = checkTrim()
  assert.equal(good.status, 0, good.stdout + good.stderr)
  assert.equal(JSON.parse(good.stdout).checks.find((item) => item.id === "instructions-trim").ok, true)
  write(ws, "skills/release-notes/SKILL.md", "## Release procedure\nLost the dated record.\n")
  const lost = checkTrim("--uncommitted")
  assert.equal(lost.status, 1, lost.stdout + lost.stderr)
  assert.match(JSON.parse(lost.stdout).checks.find((item) => item.id === "instructions-trim").message, /4 removed lines/)
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8").replace("Keep all evidence private.", "Changed the pinned rule."))
  const changed = checkTrim("--uncommitted")
  assert.match(JSON.parse(changed.stdout).checks.find((item) => item.id === "instructions-trim").message, /1 pinned sections changed/)
  const invalid = spawnSync(process.execPath, [script, "--trim-since", "not-a-revision"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /existing commit/)
})

test("target defaults, explicit thresholds, note severity and the verification gate", async () => {
  const ws = await workspace({}, { instructions: { limit: 100, auto: true } })
  for (const [bytes, aboveTarget, over, status] of [[85, false, false, 0], [86, true, false, 0], [100, true, false, 0], [101, true, true, 1]]) {
    write(ws, "AGENTS.md", "x".repeat(bytes))
    const report = instructions(ws)
    assert.equal(report.target, 85)
    assert.equal(report.auto, true)
    assert.equal(report.aboveTarget, aboveTarget)
    assert.equal(report.over, over)
    if (aboveTarget && !over) assert.match(run(ws, ["instructions"]).stdout, /above target/)
    const result = run(ws, ["instructions", "--check"])
    assert.equal(result.status, status, result.stderr)
    assert.equal(result.stdout.trim().split("\n").filter(Boolean).length, aboveTarget ? 1 : 0)
    const json = run(ws, ["instructions", "--check", "--json"])
    assert.equal(json.status, status)
    assert.equal(JSON.parse(json.stdout).over, over)
    const issues = (await check(ws)).issues
    assert.equal(issues.find((issue) => issue.code === "instructions-target")?.severity, aboveTarget && !over ? "note" : undefined)
  }
  assert.equal(instructions({ ...ws, instructions: { limit: 100, target: 60 } }).target, 60)
  assert.equal(instructions({ ...ws, instructions: { limit: 1 } }).target, 0)
  for (const setting of [{ limit: 100, target: 100 }, { limit: 100, target: 101 }, { target: -1 }, { target: 2.5 }, { target: "40" }, { target: false }, { auto: "true" }])
    assert.throws(() => instructions({ ...ws, instructions: setting }), /instructions must be/)
})

test("item pins protect nested lines but leave sibling items eligible", async () => {
  const ws = await workspace({})
  skill(ws, "release-notes")
  const pin = `<!-- excudo: keep -->\n- Keep this every session.\n  Use \`release-notes\`. ${words}\n\n`
  const sibling = `- Use \`release-notes\`.\n  ${words}\n`
  write(ws, "AGENTS.md", `## Release\n\n${pin}${sibling}`)
  assert.deepEqual(pinnedInstructions(ws, readFileSync(join(ws.root, "AGENTS.md"), "utf8")), [pin])
  const candidates = instructions(ws).candidates
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].kind, "item")
  assert.equal(candidates[0].startLine, 7)
  assert.equal(candidates[0].bytes, Buffer.byteLength(sibling))
})

async function movable(config = {}, text) {
  const ws = await workspace({ "Topic.md": "# Topic\nA topic.\n" }, config)
  skill(ws, "release-notes")
  write(ws, "AGENTS.md", text ?? template(ws) + section("Release", `Use \`release-notes\`.\n${words}`))
  write(ws, ".gitignore", ".excudo/\n")
  write(ws, "skills.json", JSON.stringify({ skills: { "release-notes": { status: "draft", install: "workspace" } } }))
  git(ws, "init")
  git(ws, "config", "user.name", "Test Owner")
  git(ws, "config", "user.email", "owner@example.com")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: baseline")
  return ws
}
const moveOptions = (ws) => {
  const block = instructions(ws).candidates[0]
  return { lines: `${block.startLine}-${block.endLine}`, to: "release-notes", reference: "release", pointer: ["Keep the evidence together."] }
}

test("preservation rejects swapped nested steps even when every removed line survives", async () => {
  const first = "- First procedure.\n  1. Read the first input.\n  2. Check the first result.\n"
  const second = "- Second procedure.\n  1. Read the second input.\n  2. Check the second result.\n"
  const ws = await movable()
  write(ws, "AGENTS.md", template(ws) + "\n" + first + second)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: nested procedures")
  const before = git(ws, "rev-parse", "HEAD")
  const original = readFileSync(join(ws.root, "AGENTS.md"), "utf8")
  write(ws, "AGENTS.md", original.replace(first + second, "Read `release-notes` for details.\n"))
  write(ws, "skills/release-notes/references/procedures.md", first.split("\n")[0] + "\n" + second.split("\n").slice(1).join("\n")
    + second.split("\n")[0] + "\n" + first.split("\n").slice(1).join("\n"))
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 6)
})

test("preservation rejects dropping one of two identical items", async () => {
  const item = "- Keep the evidence.\n  Check the original input.\n"
  const ws = await movable()
  write(ws, "AGENTS.md", template(ws) + "\n" + item + item)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: duplicate items")
  const before = git(ws, "rev-parse", "HEAD")
  write(ws, "AGENTS.md", template(ws) + "\n" + item)
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 2)
})

test("three adjacent top-level items move to separate references before and after one commit", async () => {
  const ws = await movable()
  const blocks = ["activity", "queue", "status"].map((name) =>
    `- Use \`release-notes\` for ${name}.\n  ${words}\n  node scripts/${name}.mjs\n`)
  write(ws, "AGENTS.md", template(ws) + "\n" + blocks.join(""))
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: adjacent procedures")
  const before = git(ws, "rev-parse", "HEAD")
  for (const [index, reference] of ["activity", "queue", "status"].entries()) {
    const block = instructions(ws).candidates.filter((item) => item.kind === "item").sort((a, b) => a.startLine - b.startLine)[0]
    const moved = run(ws, ["instructions", "move", "--lines", `${block.startLine}-${block.endLine}`, "--to", "release-notes",
      "--reference", reference, "--pointer", "Read `release-notes` for details.", "--since", before, "--json"])
    assert.equal(moved.status, 0, moved.stdout + moved.stderr)
    assert.ok(readFileSync(join(ws.root, `skills/release-notes/references/${reference}.md`), "utf8").endsWith(blocks[index]))
  }
  const verify = (...args) => spawnSync(process.execPath, [script, "--trim-since", before, "--json", ...args], { cwd: ws.root, encoding: "utf8" })
  const pending = verify("--uncommitted")
  assert.equal(pending.status, 0, pending.stdout + pending.stderr)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Instructions: Move adjacent procedures")
  const committed = verify()
  assert.equal(committed.status, 0, committed.stdout + committed.stderr)
})

test("preservation splits adjacent level-two and level-three sections but keeps deeper headings together", async () => {
  for (const depth of [2, 3]) {
    const ws = await movable()
    const blocks = ["First", "Second"].map((name) => `${"#".repeat(depth)} ${name}\n\nRun ${name.toLowerCase()}.\n\n#### Nested\n\nKeep ${name.toLowerCase()} evidence.\n\n`)
    write(ws, "AGENTS.md", template(ws) + "\n" + blocks.join(""))
    git(ws, "add", ".")
    git(ws, "commit", "-m", "Test: adjacent sections")
    const before = git(ws, "rev-parse", "HEAD")
    write(ws, "AGENTS.md", template(ws) + "\nRead `release-notes` for details.\n")
    for (const [index, block] of blocks.entries()) write(ws, `skills/release-notes/references/section-${index}.md`, block)
    assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 0)
    // A depth-four heading is still part of its parent section, not an independent piece.
    const [lead, nested] = blocks[0].split("#### Nested")
    write(ws, "skills/release-notes/references/section-0.md", lead)
    write(ws, "skills/release-notes/references/nested.md", "#### Nested" + nested)
    assert.ok(instructionsPreservation(ws, before, { uncommitted: true }).lost > 0)
  }
})

test("committed preservation refreshes the trim cache despite unrelated unsaved memo pages", async () => {
  const ws = await movable()
  const before = git(ws, "rev-parse", "HEAD")
  moveInstructions(ws, moveOptions(ws))
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Instructions: Move release procedure")
  write(ws, "notes/Topic.md", "# Topic\nAn unrelated unsaved edit.\n")
  const result = spawnSync(process.execPath, [script, "--trim-since", before, "--json"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const checks = JSON.parse(result.stdout).checks
  assert.equal(checks.find((item) => item.id === "instructions-trim").ok, true)
  assert.deepEqual(checks.filter((item) => !item.ok).map((item) => item.id), ["saved"])
  assert.deepEqual(instructions(ws).lastTrim, { bytes: instructionsSize(ws).bytes, commit: git(ws, "rev-parse", "HEAD") })
  assert.equal(instructions(ws).growth, 0)
})

test("committed preservation never refreshes the trim cache with uncommitted instructions or skills", async () => {
  for (const file of ["AGENTS.md", "skills/release-notes/references/release.md"]) {
    for (const staged of [false, true]) {
      const ws = await movable()
      const before = git(ws, "rev-parse", "HEAD")
      moveInstructions(ws, moveOptions(ws))
      git(ws, "add", ".")
      git(ws, "commit", "-m", "Instructions: Move release procedure")
      const cached = readFileSync(join(ws.cacheDir, "instructions.json"), "utf8")
      write(ws, file, readFileSync(join(ws.root, file), "utf8") + "New guidance.\n")
      if (staged) git(ws, "add", file)
      const result = spawnSync(process.execPath, [script, "--trim-since", before, "--json"], { cwd: ws.root, encoding: "utf8" })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.equal(JSON.parse(result.stdout).checks.find((item) => item.id === "instructions-trim").ok, true)
      assert.equal(readFileSync(join(ws.cacheDir, "instructions.json"), "utf8"), cached)
    }
  }
})

test("prospective facts and self-test checks never refresh the trim cache", async () => {
  const ws = await movable()
  const before = git(ws, "rev-parse", "HEAD")
  moveInstructions(ws, moveOptions(ws))
  const cached = readFileSync(join(ws.cacheDir, "instructions.json"), "utf8")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Instructions: Move release procedure")
  const facts = JSON.parse(readFileSync(resolve("skills/excudo-skills/scripts/check.cases.json"), "utf8"))
    .find((item) => item.name === "trimmed instructions keep rules and all moved lines").facts
  write(ws, ".excudo/trim-facts.json", JSON.stringify(facts))
  for (const args of [["--uncommitted"], ["--facts", ".excudo/trim-facts.json"], ["--self-test"]]) {
    const result = spawnSync(process.execPath, [script, "--trim-since", before, "--json", ...args], { cwd: ws.root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(readFileSync(join(ws.cacheDir, "instructions.json"), "utf8"), cached)
  }
})

test("preservation counts baseline skill Markdown and selects HEAD or the working tree", async () => {
  const ws = await movable({ skills: { dir: "procedures" } })
  const item = "- Keep the evidence.\n  Check the original input.\n"
  const original = template(ws) + "\n" + item
  write(ws, "AGENTS.md", original)
  write(ws, "procedures/release-notes/references/근거.md", item)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: existing skill copy")
  const before = git(ws, "rev-parse", "HEAD")
  write(ws, "AGENTS.md", template(ws) + "\n")
  assert.equal(instructionsPreservation(ws, before).lost, 0)
  // The surviving old copy cannot stand in for the removed occurrence.
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 2)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: missing occurrence")
  write(ws, "procedures/release-notes/references/second.md", item)
  assert.equal(instructionsPreservation(ws, before).lost, 2)
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 0)
  write(ws, "AGENTS.md", original)
  write(ws, "procedures/release-notes/references/근거.md", "Changed an old copy.\n")
  // HEAD must not borrow the repaired working tree's instructions either.
  assert.equal(instructionsPreservation(ws, before).lost, 2)
})

test("preservation ignores blank-only hunks and cannot join lines across files", async () => {
  const ws = await movable()
  const item = "- Keep the evidence.\n  Check the original input.\n"
  const original = template(ws) + "\n\n\n" + item
  write(ws, "AGENTS.md", original)
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: whitespace and a procedure")
  const before = git(ws, "rev-parse", "HEAD")
  write(ws, "AGENTS.md", template(ws) + "\n" + item)
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 0)
  write(ws, "AGENTS.md", original.replace(item, "Read the skill.\n"))
  write(ws, "skills/release-notes/references/first.md", item.split("\n")[0] + "\n")
  write(ws, "skills/release-notes/references/second.md", item.split("\n")[1] + "\n")
  assert.equal(instructionsPreservation(ws, before, { uncommitted: true }).lost, 2)
})

test("three moves keep consecutive reference links and a blank line before the next heading", async () => {
  const ws = await movable()
  write(ws, "AGENTS.md", template(ws) + ["First", "Second", "Third"].map((name) => section(name, `Use \`release-notes\`. ${words}`)).join(""))
  write(ws, "skills/release-notes/SKILL.md", "# release-notes\n\n## References\n\n## Other\n\nKeep this guidance.\n")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: three procedures")
  for (const reference of ["first", "second", "third"]) {
    moveInstructions(ws, { ...moveOptions(ws), reference })
    git(ws, "add", ".")
    git(ws, "commit", "-m", `Test: move ${reference}`)
  }
  const text = readFileSync(join(ws.root, "skills/release-notes/SKILL.md"), "utf8")
  assert.ok(text.includes("## References\n\n- [first](references/first.md)\n- [second](references/second.md)\n- [third](references/third.md)\n\n## Other\n"), text)
})

test("move preserves bytes, appends to existing references, links once and records growth", async () => {
  for (const existing of [false, true]) {
    const ws = await movable()
    if (existing) {
      write(ws, "skills/release-notes/references/release.md", "# Existing\r\n\r\nOld text without a final newline")
      git(ws, "add", ".")
      git(ws, "commit", "-m", "Test: existing reference")
    }
    const before = git(ws, "rev-parse", "HEAD")
    const options = moveOptions(ws)
    const original = readFileSync(join(ws.root, "AGENTS.md"), "utf8")
    const [start, end] = options.lines.split("-").map(Number)
    const block = original.match(/[^\n]*\n|[^\n]+$/g).slice(start - 1, end).join("")
    const cliResult = run(ws, ["instructions", "move", "--lines", options.lines, "--to", options.to, "--reference", options.reference, "--pointer", options.pointer[0], "--json"])
    assert.equal(cliResult.status, 0, cliResult.stderr)
    const moved = JSON.parse(cliResult.stdout)
    assert.equal(moved.moved, Buffer.byteLength(block))
    const ref = readFileSync(join(ws.root, moved.reference), "utf8")
    assert.ok(ref.endsWith(block))
    if (existing) assert.ok(ref.startsWith("# Existing\r\n\r\nOld text without a final newline\n\n"))
    else assert.ok(ref.startsWith("# release\n\n"))
    assert.match(readFileSync(join(ws.root, "AGENTS.md"), "utf8"), /Keep the evidence together. Details in the `release-notes` skill./)
    assert.equal(instructions(ws).growth, 0)
    assert.equal(instructions(ws).lastTrim.commit, before)
    const prospective = spawnSync(process.execPath, [script, "--trim-since", before, "--uncommitted", "--json"], { cwd: ws.root, encoding: "utf8" })
    assert.equal(prospective.status, 0, prospective.stdout + prospective.stderr)
    git(ws, "add", ".")
    git(ws, "commit", "-m", "Instructions: Move Release")
    const result = spawnSync(process.execPath, [script, "--trim-since", before, "--json"], { cwd: ws.root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(instructions(ws).lastTrim.commit, git(ws, "rev-parse", "HEAD"))
    write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8") + "New rule.\n")
    assert.equal(instructions(ws).growth, 10)
    assert.match(run(ws, ["instructions"]).stdout, /Growth since the last trim: 10 bytes/)
    git(ws, "add", ".")
    git(ws, "commit", "-m", "Test: new instructions")
    // A second, explicit section move uses the existing reference and keeps exactly one link.
    // Use a fresh unprotected section rather than the template-containing root.
    write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8") + section("Another", `Use \`release-notes\`. ${words}`))
    git(ws, "add", ".")
    git(ws, "commit", "-m", "Test: another procedure")
    moveInstructions(ws, moveOptions(ws))
    assert.equal((readFileSync(join(ws.root, "skills/release-notes/SKILL.md"), "utf8").match(/\]\(references\/release.md\)/g) ?? []).length, 1)
    assert.equal(git(ws, "ls-files", ".excudo/instructions.json"), "")
  }
})

function withFsMock(t, method, hook, run) {
  const original = fs[method]
  t.mock.method(fs, method, (...args) => hook(original, ...args))
  syncBuiltinESMExports()
  try { return run() } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
}

test("move stops before overwriting instructions edited after its first write and restores earlier writes", async (t) => {
  for (const existing of [false, true]) {
    const ws = await movable(), options = moveOptions(ws)
    const agents = join(ws.root, "AGENTS.md"), skillFile = join(ws.root, "skills/release-notes/SKILL.md")
    const reference = join(ws.root, "skills/release-notes/references/release.md")
    const edited = readFileSync(agents, "utf8") + "Another session's rule.\n"
    const oldSkill = readFileSync(skillFile, "utf8")
    if (existing) {
      write(ws, "skills/release-notes/references/release.md", "Existing reference\n")
      git(ws, "add", ".")
      git(ws, "commit", "-m", "Test: existing reference")
    }
    withFsMock(t, "renameSync", (rename, from, to) => {
      const result = rename(from, to)
      if (to === reference) writeFileSync(agents, edited)
      return result
    }, () => assert.throws(() => moveInstructions(ws, options), /AGENTS\.md changed during the instructions move/))
    assert.equal(readFileSync(agents, "utf8"), edited)
    assert.equal(readFileSync(skillFile, "utf8"), oldSkill)
    assert.equal(existsSync(dirname(reference)), existing)
    if (existing) assert.equal(readFileSync(reference, "utf8"), "Existing reference\n")
    assert.equal(existsSync(join(ws.cacheDir, "instructions.json")), false)
  }
})

test("move stops before overwriting a changed cache and undoes the move", async (t) => {
  for (const existing of [false, true]) {
    const ws = await movable(), options = moveOptions(ws)
    const agents = join(ws.root, "AGENTS.md"), skillFile = join(ws.root, "skills/release-notes/SKILL.md")
    const oldAgents = readFileSync(agents, "utf8"), oldSkill = readFileSync(skillFile, "utf8")
    const cache = join(ws.cacheDir, "instructions.json")
    if (existing) write(ws, ".excudo/instructions.json", "Old cache\n")
    withFsMock(t, "renameSync", (rename, from, to) => {
      const result = rename(from, to)
      if (to === agents) write(ws, ".excudo/instructions.json", "Another session's cache\n")
      return result
    }, () => assert.throws(() => moveInstructions(ws, options), /\.excudo\/instructions\.json changed during the instructions move/))
    assert.equal(readFileSync(agents, "utf8"), oldAgents)
    assert.equal(readFileSync(skillFile, "utf8"), oldSkill)
    assert.equal(readFileSync(cache, "utf8"), "Another session's cache\n")
    assert.equal(existsSync(join(ws.root, "skills/release-notes/references")), false)
  }
})

test("a failed second move write preserves later edits to unwritten instructions and cache", async (t) => {
  const ws = await movable(), options = moveOptions(ws)
  const agents = join(ws.root, "AGENTS.md"), skillFile = join(ws.root, "skills/release-notes/SKILL.md")
  const edited = readFileSync(agents, "utf8") + "Another session's rule.\n"
  const oldSkill = readFileSync(skillFile, "utf8")
  write(ws, ".excudo/instructions.json", "Old cache\n")
  let failed = false
  withFsMock(t, "renameSync", (rename, from, to) => {
    if (to === skillFile && !failed) {
      failed = true
      writeFileSync(agents, edited)
      write(ws, ".excudo/instructions.json", "Another session's cache\n")
      throw new Error("second write failed")
    }
    return rename(from, to)
  }, () => assert.throws(() => moveInstructions(ws, options), /second write failed/))
  assert.equal(readFileSync(agents, "utf8"), edited)
  assert.equal(readFileSync(skillFile, "utf8"), oldSkill)
  assert.equal(readFileSync(join(ws.cacheDir, "instructions.json"), "utf8"), "Another session's cache\n")
  assert.equal(existsSync(join(ws.root, "skills/release-notes/references")), false)
})

test("a failed restore continues the other move restores and reports the leftover file", async (t) => {
  const ws = await movable(), options = moveOptions(ws)
  const agents = join(ws.root, "AGENTS.md"), skillFile = join(ws.root, "skills/release-notes/SKILL.md")
  const oldAgents = readFileSync(agents, "utf8"), oldSkill = readFileSync(skillFile, "utf8")
  let skillWrites = 0, failed = false
  withFsMock(t, "renameSync", (rename, from, to) => {
    if (to === agents && !failed) { failed = true; throw new Error("third write failed") }
    if (to === skillFile && ++skillWrites === 2) throw new Error("skill restore failed")
    return rename(from, to)
  }, () => assert.throws(() => moveInstructions(ws, options), (error) => {
    assert.match(error.message, /third write failed/)
    assert.match(error.message, /Not restored:.*skills\/release-notes\/SKILL\.md.*skill restore failed/)
    assert.equal(error.cause.message, "third write failed")
    return true
  }))
  assert.equal(skillWrites, 2)
  assert.equal(readFileSync(agents, "utf8"), oldAgents)
  assert.notEqual(readFileSync(skillFile, "utf8"), oldSkill)
  assert.equal(existsSync(join(ws.root, "skills/release-notes/references")), false)
})

test("a failed first move write removes the references directory it created", async (t) => {
  for (const existing of [false, true]) {
    const ws = await movable(), options = moveOptions(ws)
    const references = join(ws.root, "skills/release-notes/references")
    if (existing) mkdirSync(references)
    const before = git(ws, "status", "--porcelain", "--untracked-files=all")
    withFsMock(t, "renameSync", () => { throw new Error("first write failed") },
      () => assert.throws(() => moveInstructions(ws, options), /first write failed/))
    assert.equal(existsSync(references), existing)
    assert.equal(git(ws, "status", "--porcelain", "--untracked-files=all"), before)
  }
})

test("move rollback preserves and reports concurrent edits to a file it wrote", async (t) => {
  const ws = await movable(), options = moveOptions(ws)
  const reference = join(ws.root, "skills/release-notes/references/release.md")
  const skillFile = join(ws.root, "skills/release-notes/SKILL.md")
  withFsMock(t, "renameSync", (rename, from, to) => {
    if (to === skillFile) {
      writeFileSync(reference, "Another session's reference\n")
      throw new Error("second write failed")
    }
    return rename(from, to)
  }, () => assert.throws(() => moveInstructions(ws, options), (error) => {
    assert.match(error.message, /second write failed/)
    assert.match(error.message, /Not restored:.*skills\/release-notes\/references\/release\.md.*changed since this move/)
    return true
  }))
  assert.equal(readFileSync(reference, "utf8"), "Another session's reference\n")
})

test("a failed cache write undoes the move without restoring an unwritten cache", async (t) => {
  for (const existing of [false, true]) {
    const ws = await movable(), options = moveOptions(ws)
    const agents = join(ws.root, "AGENTS.md"), skillFile = join(ws.root, "skills/release-notes/SKILL.md")
    const oldAgents = readFileSync(agents, "utf8"), oldSkill = readFileSync(skillFile, "utf8")
    const cache = join(ws.cacheDir, "instructions.json")
    const reference = join(ws.root, "skills/release-notes/references/release.md")
    if (existing) {
      write(ws, ".excudo/instructions.json", "Old cache\n")
      write(ws, "skills/release-notes/references/release.md", "Existing reference\n")
      git(ws, "add", ".")
      git(ws, "commit", "-m", "Test: existing reference")
    }
    let failed = false
    withFsMock(t, "renameSync", (rename, from, to) => {
      if (to === cache && !failed) {
        failed = true
        writeFileSync(cache, "Another session's cache\n")
        throw new Error("cache write failed")
      }
      return rename(from, to)
    }, () => assert.throws(() => moveInstructions(ws, options), /cache write failed/))
    assert.equal(readFileSync(agents, "utf8"), oldAgents)
    assert.equal(readFileSync(skillFile, "utf8"), oldSkill)
    assert.equal(readFileSync(cache, "utf8"), "Another session's cache\n")
    assert.equal(existsSync(dirname(reference)), existing)
    if (existing) assert.equal(readFileSync(reference, "utf8"), "Existing reference\n")
  }
})

test("move accepts a small exact item and CRLF blocks, dry-run leaves no files or cache", async () => {
  const body = "- Run this small procedure.\r\n  node scripts/verify.mjs\r\n"
  const ws = await movable({}, `## Work\r\n\r\n${body}`)
  const options = { lines: "3-4", to: "release-notes", reference: "small", pointer: ["Keep evidence.", "Use `release-notes` for details."] }
  const before = git(ws, "status", "--porcelain", "--untracked-files=all")
  const dry = moveInstructions(ws, { ...options, dryRun: true })
  assert.equal(dry.dryRun, true)
  assert.equal(existsSync(join(ws.root, "skills/release-notes/references")), false)
  assert.equal(existsSync(join(ws.cacheDir, "instructions.json")), false)
  assert.equal(git(ws, "status", "--porcelain", "--untracked-files=all"), before)
  const moved = moveInstructions(ws, options)
  const reference = readFileSync(join(ws.root, moved.reference))
  assert.ok(reference.subarray(reference.length - Buffer.byteLength(body)).equals(Buffer.from(body)))
  assert.equal(readFileSync(join(ws.root, "AGENTS.md"), "utf8"), "## Work\r\n\r\nKeep evidence.\r\nUse `release-notes` for details.\r\n")
})

test("move refuses protected blocks, invalid ranges, engine or missing targets and dirty files", async () => {
  const ws = await movable()
  const options = moveOptions(ws)
  const originalStatus = git(ws, "status", "--porcelain")
  for (const change of [{ lines: "2-4" }, { lines: "0-1" }, { lines: "1-9999" }, { to: "excudo-skills" }, { to: "missing" }, { reference: "../escape" }, { pointer: ["one", "two", "three"] }, { pointer: ["first\nsecond"] }])
    assert.throws(() => moveInstructions(ws, { ...options, ...change }))
  assert.equal(git(ws, "status", "--porcelain"), originalStatus)
  for (const file of ["AGENTS.md", "skills/release-notes/SKILL.md"]) {
    write(ws, file, readFileSync(join(ws.root, file), "utf8") + "Dirty\n")
    assert.throws(() => moveInstructions(ws, options), /Commit .* before moving/)
    git(ws, "add", file)
    assert.throws(() => moveInstructions(ws, options), /Commit .* before moving/)
    git(ws, "restore", "--staged", "--worktree", "--", file)
  }
  const protectedWs = await movable({}, "<!-- excudo: keep -->\n## Fixed\n\n- Always keep this.\n  Nested rule.\n")
  for (const lines of ["2-5", "4-5"]) assert.throws(() => moveInstructions(protectedWs, { ...options, lines }), /pinned text/)
  const itemWs = await movable({}, "## Fixed\n\n<!-- excudo: keep -->\n- Always keep this.\n  Nested rule.\n")
  for (const lines of ["1-5", "4-5"]) assert.throws(() => moveInstructions(itemWs, { ...options, lines }), /pinned text/)
  // The first actual template rule is a complete top-level item.
  const templateText = template(ws), lines = templateText.match(/[^\n]*\n|[^\n]+$/g)
  const start = lines.findIndex((line) => /^- /.test(line))
  let end = start + 1
  while (end < lines.length && (!lines[end].trim() || /^\s+\S/.test(lines[end]))) end++
  assert.throws(() => moveInstructions(ws, { ...options, lines: `${start + 1}-${end}` }), /engine template rule/)
})

test("move refuses workspace skill symlinks that lead outside the workspace", async () => {
  const ws = await movable(), outside = await movable()
  symlinkSync(join(outside.root, "skills/release-notes"), join(ws.root, "skills/external"), "dir")
  assert.throws(() => moveInstructions(ws, { ...moveOptions(ws), to: "external" }), /inside the workspace/)
})

test("the preservation check rejects a pinned item's changed nested text", async () => {
  const ws = await movable({}, "<!-- excudo: keep -->\n- Keep evidence.\n  Never change its wording.\n")
  const before = git(ws, "rev-parse", "HEAD")
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8").replace("Never", "Always"))
  const result = spawnSync(process.execPath, [script, "--trim-since", before, "--uncommitted", "--json"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(result.status, 1)
  assert.match(JSON.parse(result.stdout).checks.find((item) => item.id === "instructions-trim").message, /1 pinned/)
})

test("--since permits several preserved moves before one commit and refuses a broken baseline", async () => {
  const ws = await movable()
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8") + section("Second", `Use \`release-notes\`. ${words}`))
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: two procedures")
  const before = git(ws, "rev-parse", "HEAD")
  const first = moveOptions(ws)
  const result = run(ws, ["instructions", "move", "--since", before, "--lines", first.lines, "--to", first.to, "--reference", first.reference, "--pointer", first.pointer[0], "--json"])
  assert.equal(result.status, 0, result.stderr)
  const second = moveOptions(ws)
  assert.throws(() => moveInstructions(ws, second), /Commit AGENTS/)
  moveInstructions(ws, { ...second, since: before })
  assert.equal(git(ws, "rev-parse", "HEAD"), before)
  assert.equal(instructions(ws).candidates.length, 0)
  const verify = (...args) => spawnSync(process.execPath, [script, "--trim-since", before, "--json", ...args], { cwd: ws.root, encoding: "utf8" })
  assert.equal(verify().status, 1)
  const pending = verify("--uncommitted")
  assert.equal(pending.status, 0, pending.stdout + pending.stderr)
  assert.deepEqual(instructionsPreservation(ws, before, { uncommitted: true }), { template: 0, pinned: 0, lost: 0 })
  write(ws, "notes/Topic.md", "# Topic\nUnrelated unsaved change.\n")
  assert.equal(verify("--uncommitted").status, 1)
  git(ws, "restore", "--", "notes/Topic.md")
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8") + section("Third", `Use \`release-notes\`. ${words}`))
  const third = moveOptions(ws)
  assert.throws(() => moveInstructions(ws, { ...third, since: "not-a-commit" }), /existing commit/)
  write(ws, "skills/release-notes/references/release.md", "Lost the moved procedures.\n")
  assert.throws(() => moveInstructions(ws, { ...third, since: before }), /loses template rules/)
})

test("--since still refuses pins, template rules and protected target types", async () => {
  const ws = await movable()
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8") + "<!-- excudo: keep -->\n## Fixed\n\n- Preserve this.\n  Nested text.\n")
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: pinned baseline")
  const before = git(ws, "rev-parse", "HEAD")
  const options = { ...moveOptions(ws), since: before }
  for (const to of ["excudo-skills", "missing"]) assert.throws(() => moveInstructions(ws, { ...options, to }))
  const lines = readFileSync(join(ws.root, "AGENTS.md"), "utf8").match(/[^\n]*\n|[^\n]+$/g)
  const fixed = lines.findIndex((line) => line.startsWith("## Fixed"))
  assert.throws(() => moveInstructions(ws, { ...options, lines: `${fixed + 1}-${lines.length}` }), /pinned text/)
  write(ws, "AGENTS.md", readFileSync(join(ws.root, "AGENTS.md"), "utf8").replace("Nested text.", "Changed text."))
  assert.throws(() => moveInstructions(ws, options), /loses template rules/)
  const noBefore = spawnSync(process.execPath, [script, "--uncommitted"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(noBefore.status, 2)
})

test("scheduled automatic trim checks its target or a reported reason against the working tree", async () => {
  const ws = await movable({ instructions: { limit: 100, target: 80, auto: true } })
  const before = git(ws, "rev-parse", "HEAD")
  const verify = (...args) => spawnSync(process.execPath, [script, "--trim-since", before, "--scheduled", "--uncommitted", "--json", ...args], { cwd: ws.root, encoding: "utf8" })
  const result = verify()
  assert.equal(result.status, 1)
  assert.equal(JSON.parse(result.stdout).checks.find((item) => item.id === "instructions-auto").ok, false)
  const reason = verify("--trim-reason", "Protected template rules alone exceed the target.")
  assert.equal(reason.status, 0, reason.stdout + reason.stderr)
})

test("move links under a real references heading and ignores examples in fences", async () => {
  for (const heading of ["", "## References\n\nExisting guidance.\n\n## Other\n\nOther guidance.\n"]) {
    const ws = await movable()
    const example = "```md\n## References\n\n- [release](references/release.md)\n```\n\n"
    write(ws, "skills/release-notes/SKILL.md", "# release-notes\n\n" + example + heading)
    git(ws, "add", ".")
    git(ws, "commit", "-m", "Test: reference examples")
    moveInstructions(ws, moveOptions(ws))
    const text = readFileSync(join(ws.root, "skills/release-notes/SKILL.md"), "utf8")
    assert.ok(text.includes(example))
    const actual = text.replace(example, "")
    assert.equal((actual.match(/^## References$/gm) ?? []).length, 1)
    assert.equal((actual.match(/\]\(references\/release.md\)/g) ?? []).length, 1)
    if (heading) assert.ok(actual.indexOf("](references/release.md)") < actual.indexOf("## Other"))
  }
})

test("protected bytes count overlapping pins and template rules only once", async () => {
  const ws = await workspace({})
  const fixed = "<!-- excudo: keep -->\n## Fixed\n\n<!-- excudo: keep -->\n- Keep this item.\n  Keep its child too.\n\n"
  const free = section("Free", words)
  write(ws, "AGENTS.md", fixed + free)
  const report = instructions(ws)
  assert.equal(report.pinned, Buffer.byteLength(fixed))
  assert.equal(report.movable, Buffer.byteLength(free))
  assert.equal(report.pinnedBlocks.length, 1)
  assert.equal(report.pinnedBlocks[0].name, "Fixed")
  write(ws, "AGENTS.md", template(ws))
  const base = instructions(ws)
  assert.ok(base.pinned > 4000)
  assert.ok(base.movable > 0)
  assert.equal(base.pinned + base.movable, base.bytes)
  // A pin around a template section must not count its template items twice.
  write(ws, "AGENTS.md", template(ws).replace("## Rules", "<!-- excudo: keep -->\n## Rules"))
  const marked = instructions(ws)
  assert.ok(marked.pinned > base.pinned)
  assert.equal(marked.pinned + marked.movable, marked.bytes)
})

test("unreachable targets name large pinned blocks in reports, the gate and size warnings", async () => {
  const ws = await workspace({ "Topic.md": "# Topic\nA topic.\n" }, { instructions: { limit: 1000, target: 50 } })
  write(ws, "AGENTS.md", "<!-- excudo: keep -->\n" + section("Always", "Keep this rule unchanged. ".repeat(5)))
  const report = instructions(ws)
  assert.equal(report.targetBlocked, true)
  assert.match(run(ws, ["instructions"]).stdout, /moving cannot reach the target.*Always/)
  const gate = run(ws, ["instructions", "--check"])
  assert.equal(gate.status, 0)
  assert.match(gate.stdout, /Largest protected blocks: Always/)
  assert.equal(gate.stdout.trim().split("\n").length, 1)
  assert.equal(JSON.parse(run(ws, ["instructions", "--json"]).stdout).pinned, report.bytes)
  const equal = instructions({ ...ws, instructions: { limit: 1000, target: report.pinned } })
  assert.equal(equal.targetBlocked, true)
  assert.equal(equal.aboveTarget, false)
  const over = { ...ws, instructions: { limit: 100, target: 50 } }
  const issue = (await check(over)).issues.find((issue) => issue.code === "instructions-size")
  assert.match(issue.message, /moving cannot reach the target.*Always/)
  write(ws, "excudo.config.mjs", 'export default { graph: "notes", instructions: { limit: 100, target: 50 } }\n')
  assert.equal(run(ws, ["instructions", "--check"]).status, 1)
})

test("scheduled trims report an unreachable target once safely within the limit", async () => {
  const ws = await movable({ instructions: { limit: 10000, target: 1, auto: true } })
  const base = readFileSync(join(ws.root, "AGENTS.md"), "utf8")
  write(ws, "AGENTS.md", base + section("Large", `Use \`release-notes\`. ${words.repeat(12)}`))
  git(ws, "add", ".")
  git(ws, "commit", "-m", "Test: over the maximum with protected rules")
  const before = git(ws, "rev-parse", "HEAD")
  const verify = () => spawnSync(process.execPath, [script, "--trim-since", before, "--scheduled", "--uncommitted", "--json"], { cwd: ws.root, encoding: "utf8" })
  assert.equal(instructions(ws).targetBlocked, true)
  assert.equal(verify().status, 1, "an unreachable target still requires reducing an over-limit file")
  moveInstructions(ws, { ...moveOptions(ws), since: before })
  assert.equal(instructions(ws).over, false)
  assert.equal(instructions(ws).aboveTarget, true)
  const result = verify()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(JSON.parse(result.stdout).checks.find((item) => item.id === "instructions-auto").message, /moving cannot reach the target/)
})
