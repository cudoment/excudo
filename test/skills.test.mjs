import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, mkdirSync, readFileSync, realpathSync, writeFileSync, lstatSync, rmSync, symlinkSync, readlinkSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { parse } from "yaml"
import { check, init, loadWorkspace, skillNames, installSkills } from "../src/index.mjs"
import { rulesAgainstTemplate, templateRules } from "../src/skillkit.mjs"
import { packageVersion } from "../src/skills.mjs"
import { tempDir, workspace } from "./helpers.mjs"

const cli = resolve("bin/excudo.mjs")
test("skill names, frontmatter, local commands and setup version agree with the shipped CLI", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout
  for (const name of skillNames()) {
    const body = readFileSync(`skills/${name}/SKILL.md`, "utf8")
    const yaml = parse(body.match(/^---\n([\s\S]*?)\n---/)[1])
    assert.deepEqual(Object.keys(yaml).sort(), ["description", "name"])
    assert.equal(yaml.name, name)
    assert.ok(yaml.description)
    for (const [, command] of body.matchAll(/excudo (init|[a-z]+)(?=\s|`)/g)) assert.match(help, new RegExp(`\\b${command}\\b`))
    for (const line of body.split("\n").filter((line) => /^\s*npx /.test(line)))
      assert.ok(line.includes("--no-install") || name === "excudo-setup" && line.includes("init"), line)
    if (name === "excudo-setup") assert.ok(body.includes(`excudo@^${packageVersion()}`))
  }
})

test("skills installation records versions, keeps modified skills, and outdated versions warn", async () => {
  const root = tempDir(); await init(root)
  const ws = await loadWorkspace({ root })
  for (const name of skillNames()) {
    const dir = join(root, ".agents/skills", name)
    assert.equal(JSON.parse(readFileSync(join(dir, "version.json"))).version, packageVersion())
    assert.ok(lstatSync(join(root, ".claude/skills", name)).isSymbolicLink())
  }
  const first = skillNames()[0]
  const dir = join(root, ".agents/skills", first)
  writeFileSync(join(dir, "version.json"), '{"version":"0.1.0"}\n')
  assert.ok((await check(ws)).issues.some((issue) => issue.code === "skills-outdated"))
  writeFileSync(join(dir, "SKILL.md"), "Owner customization\n")
  assert.equal(installSkills({ dir: root }).find((item) => item.name === first).state, "exists")
  assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), "Owner customization\n")
  const preserved = installSkills({ dir: root, force: true }).find((item) => item.name === first)
  assert.equal(preserved.state, "preserved")
  assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), "Owner customization\n")
  assert.equal(readFileSync(join(preserved.backups[0].backup, "SKILL.md"), "utf8"), "Owner customization\n")
  assert.ok((await check(ws)).issues.some((issue) => issue.code === "skills-outdated"))
  writeFileSync(join(dir, "SKILL.md"), readFileSync(join("skills", first, "SKILL.md")))
  const merged = installSkills({ dir: root, force: true }).find((item) => item.name === first)
  assert.equal(merged.state, "current")
  assert.deepEqual(merged.backups, [])
  assert.ok(!(await check(ws)).issues.some((issue) => issue.code === "skills-outdated"))
})

test("forced engine skill refresh preserves edits, extra files and foreign links with backups", async () => {
  const root = tempDir(); await init(root)
  const names = skillNames().slice(0, 4)
  const place = (name) => join(root, ".agents", "skills", name)
  writeFileSync(join(place(names[0]), "SKILL.md"), "Owner instructions\n")
  writeFileSync(join(place(names[1]), "owner.txt"), "Owner attachment\n")
  const foreign = tempDir(); writeFileSync(join(foreign, "SKILL.md"), "Foreign skill\n")
  rmSync(place(names[2]), { recursive: true }); symlinkSync(foreign, place(names[2]), "dir")
  const alias = join(root, ".claude", "skills", names[3])
  rmSync(alias); mkdirSync(alias); writeFileSync(join(alias, "SKILL.md"), "Tool-specific owner copy\n")
  const result = installSkills({ dir: root, force: true })
  for (const name of names.slice(0, 3)) {
    const entry = result.find((item) => item.name === name)
    assert.equal(entry.state, "preserved")
    assert.ok(entry.backups[0].backup.startsWith(join(root, ".excudo", "skill-backups")))
  }
  const linkBackup = result.find((item) => item.name === names[2]).backups[0].backup
  assert.equal(readlinkSync(linkBackup), foreign)
  assert.equal(readFileSync(join(foreign, "SKILL.md"), "utf8"), "Foreign skill\n")
  assert.equal(readFileSync(join(alias, "SKILL.md"), "utf8"), "Tool-specific owner copy\n")
  assert.equal(result.find((item) => item.name === names[3]).links[0].state, "preserved")
})

test("an unmodified recorded copy can refresh after the packaged skill changes", async () => {
  const root = tempDir(); await init(root)
  const name = skillNames()[0], dir = join(root, ".agents", "skills", name)
  const record = JSON.parse(readFileSync(join(dir, "version.json"), "utf8"))
  assert.match(record.fingerprint, /^[a-f\d]{64}$/)
  // Simulate a clean older copy and its installation record without mutating package sources.
  writeFileSync(join(dir, "SKILL.md"), "An older packaged skill\n")
  const { engineSkillFingerprint } = await import("../src/skills.mjs")
  writeFileSync(join(dir, "version.json"), JSON.stringify({ version: "0.1.0", fingerprint: engineSkillFingerprint(dir) }))
  const entry = installSkills({ dir: root, force: true }).find((item) => item.name === name)
  assert.equal(entry.state, "installed")
  assert.deepEqual(entry.backups, [])
  assert.notEqual(readFileSync(join(dir, "SKILL.md"), "utf8"), "An older packaged skill\n")
})

test("the skill CLI reports backup paths without changing an owner edit", async () => {
  const root = tempDir(); await init(root)
  const first = skillNames()[0], skill = join(root, ".agents", "skills", first, "SKILL.md")
  writeFileSync(skill, "Owner edits to preserve\n")
  const child = spawnSync(process.execPath, [cli, "skills", "--force", "--root", root], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /preserved/)
  assert.match(child.stdout, /skill-backups/)
  assert.equal(readFileSync(skill, "utf8"), "Owner edits to preserve\n")
})

test("skills --global links each skill for every agent that keeps its folder in the home folder, as learned skills are", () => {
  const home = tempDir("excudo-home-")
  mkdirSync(join(home, ".claude"))
  mkdirSync(join(home, ".codex"))
  const installed = installSkills({ global: true, home })
  for (const { name, links } of installed) {
    assert.deepEqual(links.map((item) => [item.tool, item.state]), [[".claude", "linked"], [".codex", "linked"]], name)
    for (const tool of [".claude", ".codex"]) assert.equal(realpathSync(join(home, tool, "skills", name)), realpathSync(join(home, ".agents", "skills", name)))
    assert.ok(existsSync(join(home, ".agents", "skills", name, "SOURCE.md")))
  }
  const only = tempDir("excudo-home-")
  mkdirSync(join(only, ".claude"))
  assert.deepEqual(installSkills({ global: true, home: only })[0].links.map((item) => item.tool), [".claude"], "an agent without its folder gets no link")
})

test("workspace lookup prioritizes explicit root, then ancestors, then EXCUDO_ROOT", async () => {
  const local = await workspace({ "A.md": "# A\n\nA.\n" })
  const env = await workspace({ "B.md": "# B\n\nB.\n" })
  const previous = process.env.EXCUDO_ROOT
  process.env.EXCUDO_ROOT = env.root
  try {
    assert.equal((await loadWorkspace({ root: local.root, cwd: tempDir() })).root, local.root)
    assert.equal((await loadWorkspace({ cwd: join(local.root, "notes") })).root, local.root)
    assert.equal((await loadWorkspace({ cwd: tempDir() })).root, env.root)
  } finally {
    if (previous === undefined) delete process.env.EXCUDO_ROOT
    else process.env.EXCUDO_ROOT = previous
  }
})

test("local setup package override creates a relative dependency", async () => {
  const previous = process.env.EXCUDO_PACKAGE
  process.env.EXCUDO_PACKAGE = process.cwd()
  try {
    const root = tempDir(); await init(root)
    const pkg = JSON.parse(readFileSync(join(root, "package.json")))
    assert.match(pkg.devDependencies["excudo"], /^file:/)
    assert.equal(resolve((await import("node:fs")).realpathSync(root), pkg.devDependencies["excudo"].slice(5)), process.cwd())
  } finally {
    if (previous === undefined) delete process.env.EXCUDO_PACKAGE
    else process.env.EXCUDO_PACKAGE = previous
  }
})

test("the setup check compares each template rule word for word, line breaks aside, with the workspace's names filled in", async () => {
  for (const locale of ["en", "ko"]) {
    const root = tempDir(); await init(root, { locale })
    const ws = await loadWorkspace({ root })
    const text = readFileSync(join(root, "AGENTS.md"), "utf8")
    assert.deepEqual(rulesAgainstTemplate(ws, text), { missing: [], differ: [] }, locale)
    const rules = templateRules(ws)
    assert.ok(rules.some((rule) => rule.text.includes(`${ws.labels.home}.md`)) && !rules.some((rule) => rule.text.includes("{home}")), "names are filled in")
    assert.ok(rules.some((rule) => !rule.text.startsWith("**")), "a rule without a bold lead counts too")
    const rule = rules.find((item) => item.text.startsWith("**") && item.text.length > 120)
    // Wrapped at other places, with a sentence of the workspace's own after it: still the template's rule.
    const flat = text.replace(/\s+/g, " ")
    assert.ok(flat.includes(rule.text))
    assert.deepEqual(rulesAgainstTemplate(ws, flat.replace(rule.text, `${rule.text.replace(/ /g, "\n  ")} Our own note.`)), { missing: [], differ: [] }, locale)
    assert.deepEqual(rulesAgainstTemplate(ws, flat.replace(rule.text, `${rule.text.slice(0, -12)} otherwise.`)), { missing: [], differ: [rule.lead] }, locale)
    assert.deepEqual(rulesAgainstTemplate(ws, flat.replace(rule.text, "")), { missing: [rule.lead], differ: [] }, locale)
  }
})

test("templates give the interview guardrails and the lookup sequence in both languages", async () => {
  for (const locale of ["en", "ko"]) {
    const root = tempDir(); await init(root, { locale })
    const instructions = readFileSync(join(root, "AGENTS.md"), "utf8")
    assert.match(instructions, /tree.*find[\s\S]*find --history/)
    assert.match(instructions, /review keep/)
    assert.match(instructions, locale === "en" ? /Do not delete or move content before answers/ : /답을 받기 전에 내용을 지우거나 옮기지/)
  }
})

test("Tine doctor validates the example graph when installed", { skip: process.platform !== "darwin" && "macOS app integration" }, (t) => {
  const tine = "/Applications/Tine.app/Contents/MacOS/tine"
  if (!existsSync(tine)) return t.skip("Install Tine from https://tine.page to run doctor")
  const result = spawnSync(tine, ["doctor", resolve("example/notes")], { encoding: "utf8", timeout: 30000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /OK:/)
})

test("Codex discovers the installed workspace skills without a model call", async (t) => {
  if (spawnSync("which", ["codex"]).status !== 0) return t.skip("codex CLI is not installed")
  const root = tempDir(); await init(root)
  const result = spawnSync("codex", ["debug", "prompt-input", "List available skills"], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  for (const name of skillNames()) assert.ok(result.stdout.includes(name), name)
})

test("npm installation from a symlinked temporary path exposes the executable local engine", { skip: process.platform === "win32" && "POSIX npm executable fixture" }, async () => {
  const root = tempDir(); await init(root)
  const install = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(install.status, 0, install.stderr)
  assert.ok(existsSync(join(root, "node_modules/.bin/excudo")))
  const result = spawnSync("npx", ["--no-install", "excudo", "check"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /First list/)
})

test("a fingerprint-less older copy that differs is reported as unverified, backed up once, and replaced on request", async () => {
  const root = tempDir(); await init(root)
  const ws = await loadWorkspace({ root })
  const name = skillNames()[0], dir = join(root, ".agents", "skills", name)
  writeFileSync(join(dir, "SKILL.md"), "A copy made by an older release\n")
  writeFileSync(join(dir, "version.json"), '{"version":"0.1.0"}\n')
  const first = installSkills({ dir: root, force: true }).find((item) => item.name === name)
  assert.equal(first.state, "preserved")
  assert.equal(first.reason, "unverified-older")
  const again = installSkills({ dir: root, force: true }).find((item) => item.name === name)
  assert.equal(again.backups[0].backup, first.backups[0].backup, "an identical backup is reused")
  assert.equal(readdirSync(join(root, ".excudo", "skill-backups")).filter((entry) => entry.startsWith(`${name}-`)).length, 1)
  const warning = (await check(ws)).issues.find((issue) => issue.code === "skills-outdated" && issue.message.includes(name))
  assert.ok(warning.message.includes(first.backups[0].backup) && warning.message.includes("--replace"))
  const replaced = installSkills({ dir: root, replace: [name] }).find((item) => item.name === name)
  assert.equal(replaced.state, "installed")
  assert.equal(readFileSync(join(replaced.backups[0].backup, "SKILL.md"), "utf8"), "A copy made by an older release\n")
  assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), readFileSync(join("skills", name, "SKILL.md"), "utf8"))
  assert.ok(!(await check(ws)).issues.some((issue) => issue.code === "skills-outdated" && issue.message.includes(name)))
})

test("--replace-all and --replace on the CLI replace differing copies after backing them up", async () => {
  const root = tempDir(); await init(root)
  const [a, b] = skillNames()
  for (const name of [a, b]) writeFileSync(join(root, ".agents", "skills", name, "SKILL.md"), `Edited ${name}\n`)
  const one = spawnSync(process.execPath, [cli, "skills", "--replace", a, "--root", root], { encoding: "utf8" })
  assert.equal(one.status, 0, one.stderr)
  assert.equal(readFileSync(join(root, ".agents", "skills", a, "SKILL.md"), "utf8"), readFileSync(join("skills", a, "SKILL.md"), "utf8"))
  assert.equal(readFileSync(join(root, ".agents", "skills", b, "SKILL.md"), "utf8"), `Edited ${b}\n`)
  const all = spawnSync(process.execPath, [cli, "skills", "--replace-all", "--root", root], { encoding: "utf8" })
  assert.equal(all.status, 0, all.stderr)
  assert.equal(readFileSync(join(root, ".agents", "skills", b, "SKILL.md"), "utf8"), readFileSync(join("skills", b, "SKILL.md"), "utf8"))
})

test("prerelease skill copies compare as older than the matching or later engine", async () => {
  const root = tempDir(); await init(root)
  const ws = await loadWorkspace({ root })
  const name = skillNames()[0], dir = join(root, ".agents", "skills", name)
  const [major, minor, patch] = packageVersion().split("-")[0].split(".").map(Number)
  writeFileSync(join(dir, "version.json"), JSON.stringify({ version: `${major}.${minor}.${patch}-beta.1` }))
  assert.ok((await check(ws)).issues.some((issue) => issue.code === "skills-outdated"), "a beta copy is older than its release")
  writeFileSync(join(dir, "version.json"), JSON.stringify({ version: `${major}.${minor}.${patch + 1}-beta.1` }))
  assert.ok(!(await check(ws)).issues.some((issue) => issue.code === "skills-outdated"), "a later beta is not older")
})
