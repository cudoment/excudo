import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { LOCALES } from "../src/labels.mjs"
import { updatePackage } from "../src/update.mjs"
import { tempDir } from "./helpers.mjs"

const ws = () => ({ root: tempDir(), hasConfig: true, labels: LOCALES.en })
const answer = (data) => ({ status: 0, stdout: JSON.stringify(data) })
const failure = (code) => ({ status: 1, stdout: JSON.stringify({ error: { code } }), stderr: `npm error code ${code}` })

test("next selects the higher of latest and next and tolerates a missing beta tag", async () => {
  for (const next of ["0.8.0-beta.1", null]) {
    const npm = (args) => args[2] !== "version" ? answer({}) : args[1] === "excudo@next" ? next ? answer(next) : failure("E404") : answer("0.8.0")
    const result = await updatePackage(ws(), { channel: "next", installed: "0.7.0", npm, changelog: "" })
    assert.equal(result.latest, "0.8.0")
    assert.equal(result.selectedChannel, "latest")
    assert.equal(result.newer, true)
    if (!next) assert.equal(result.warnings[0].kind, "missing")
  }
})

test("registry diagnostics distinguish network, authentication, missing tags and registry errors", async () => {
  for (const [code, kind] of [["ENOTFOUND", "network"], ["ETIMEDOUT", "network"], ["E401", "auth"], ["E403", "auth"], ["E404", "missing"], ["ETARGET", "missing"], ["E500", "registry"]]) {
    const result = await updatePackage(ws(), { npm: () => failure(code) })
    assert.equal(result.code, 0)
    assert.equal(result.warnings[0].kind, kind)
    assert.match(result.note, new RegExp(code))
    if (kind !== "network") assert.doesNotMatch(result.note, /when online/)
  }
  const legacy = await updatePackage(ws(), { npm: () => ({ status: 1, stdout: "", stderr: "npm ERR! code E401\nNetwork authentication denied" }) })
  assert.equal(legacy.warnings[0].kind, "auth")
  assert.equal(legacy.warnings[0].code, "E401")
})

test("apply exposes the npm stderr tail and successful follow-up checks", async () => {
  const npm = (args, options) => args[0] === "view" ? answer(args[2] === "version" ? "0.8.0" : {})
    : options.binary === "npm" ? { status: 1, stderr: "old context\n".repeat(20) + "npm error E403: access denied" } : { status: 0 }
  const failed = await updatePackage(ws(), { installed: "0.7.0", npm, apply: true })
  assert.equal(failed.code, 1)
  assert.match(failed.stderr, /E403: access denied/)
  assert.ok(failed.stderr.split("\n").length <= 8)
  assert.equal(failed.engineChanged, false, "the engine install itself failed")
  const half = await updatePackage(ws(), { installed: "0.7.0", apply: true,
    npm: (args, options) => args[0] === "view" ? answer(args[2] === "version" ? "0.8.0" : {}) : options.binary === "npx" ? { status: 1, stderr: "skills failed" } : { status: 0 } })
  assert.equal(half.state, "failed")
  assert.equal(half.engineChanged, true, "the engine was installed before the skills step failed")
  assert.equal(half.applied, false)
  const success = await updatePackage(ws(), { installed: "0.7.0", apply: true,
    npm: (args) => args[0] === "view" ? answer(args[2] === "version" ? "0.8.0" : {}) : { status: 0, stdout: "A skill: preserved; backup available" } })
  assert.deepEqual(success.followUp, ["npx --no-install excudo start --report", "node .agents/skills/excudo-setup/scripts/check.mjs"])
  assert.match(success.skillRefreshOutput, /preserved/)
  assert.equal(success.engineChanged, true)
})

test("apply CLI prints preserved-skill output, release links and setup follow-ups", () => {
  const root = tempDir(), npm = join(root, "npm-cli.cjs")
  writeFileSync(join(root, "excudo.config.mjs"), "export default { locale: 'en' }\n")
  writeFileSync(npm, 'if (process.argv[2] === "view") console.log(JSON.stringify(process.argv[4] === "version" ? "0.99.0" : {}))\n')
  writeFileSync(join(root, "npx-cli.js"), 'console.log("excudo-capture: preserved\\nKept owner copy; backup: skill-backups/example")\n')
  const child = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "update", "--apply", "--root", root],
    { encoding: "utf8", env: { ...process.env, npm_execpath: npm } })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /excudo-capture: preserved/)
  assert.match(child.stdout, /skill-backups\/example/)
  assert.match(child.stdout, /releases\/tag\/v0\.99\.0/)
  assert.match(child.stdout, /excudo start --report/)
  assert.match(child.stdout, /node \.agents\/skills\/excudo-setup\/scripts\/check\.mjs/)
})

test("update CLI prints the Owner action group before the other notes", () => {
  const root = tempDir(), npm = join(root, "npm-cli.cjs")
  writeFileSync(join(root, "excudo.config.mjs"), "export default { locale: 'en' }\n")
  const notes = "## 0.99.0\n\n### Owner action\n\n- Settings: Rename the inbox setting\n\n### Site\n\n- Open Home\n"
  writeFileSync(npm, `if (process.argv[2] === "view") console.log(JSON.stringify(process.argv[4] === "version" ? "0.99.0" : { excudoReleaseNotes: { version: "0.99.0", markdown: ${JSON.stringify(notes)} } }))\n`)
  const child = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "update", "--root", root],
    { encoding: "utf8", env: { ...process.env, npm_execpath: npm } })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /Owner action after updating:\n  0\.99\.0\n  - Settings: Rename the inbox setting\n[\s\S]*### Site\n\n- Open Home/)
  assert.doesNotMatch(child.stdout, /### Owner action/)
})

test("npm's real publication preparation retains generated release-note metadata", async (t) => {
  let PackageJson
  try {
    const cli = process.env.npm_execpath || spawnSync(process.platform === "win32" ? "where" : "which", ["npm"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/)[0]
    PackageJson = createRequire(realpathSync(cli))("@npmcli/package-json")
  } catch { return t.skip("npm publication metadata library is not available") }
  const root = tempDir()
  const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"))
  writeFileSync(join(root, "package.json"), JSON.stringify({ ...manifest, version: "0.8.0" }))
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
  }
  git("init", "-q"); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Update: Keep owner edits")
  const generated = spawnSync(process.execPath, [resolve("scripts/changelog.mjs"), "--write", "0.8.0"], { cwd: root, encoding: "utf8" })
  assert.equal(generated.status, 0, generated.stderr)
  const published = (await PackageJson.prepare(root)).content
  assert.equal(published.excudoReleaseNotes.version, "0.8.0")
  const result = await updatePackage(ws(), { installed: "0.7.0", changelog: "",
    npm: (args) => answer(args[2] === "version" ? published.version : published) })
  assert.match(result.changelog, /Keep owner edits/)
  assert.equal(result.releaseUrl, "https://github.com/cudoment/excudo/releases/tag/v0.8.0")
  assert.equal(result.changelogUrl, "https://github.com/cudoment/excudo/blob/v0.8.0/CHANGELOG.md")
})
