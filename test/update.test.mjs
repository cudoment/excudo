import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"
import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { changelogBetween, compareVersions, runNpm, updatePackage } from "../src/update.mjs"
import { LOCALES } from "../src/labels.mjs"
import { tempDir, withEnv } from "./helpers.mjs"

const ws = () => ({ root: tempDir(), hasConfig: true, labels: LOCALES.en })
const stub = (responses) => {
  const calls = []
  const npm = (args, options) => { calls.push({ args, options }); return responses.shift() ?? { status: 99 } }
  return { calls, npm }
}
const view = (value) => ({ status: 0, stdout: JSON.stringify(value) })
const notes = "# Changelog\n\n## 0.8.0\n\nFuture\n\n## 0.7.0\n\nNew commands\n\n## 0.6.1\n\nFixes\n\n## 0.6.0\n\nOld\n"

test("registry checks always invoke npm when another package manager supplied npm_execpath", async (t) => {
  const root = tempDir()
  const other = join(root, "yarn.cjs")
  writeFileSync(other, "throw new Error('Must not run another package manager')\n")
  const calls = []
  t.mock.method(childProcess, "spawnSync", (...args) => { calls.push(args); return { status: 0, stdout: "" } })
  syncBuiltinESMExports()
  try {
    await withEnv({ npm_execpath: other }, () => runNpm(["view", "excudo@latest", "version", "--json"], { cwd: root }))
    assert.equal(calls[0][0], process.platform === "win32" ? "npm.cmd" : "npm")
    assert.equal(calls[0][1][0], "view")
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
})

test("semantic comparison orders prereleases and ignores build metadata", () => {
  for (const [a, b] of [["0.7.0", "0.6.9"], ["0.7.0", "0.7.0-beta.2"], ["0.7.0-beta.10", "0.7.0-beta.2"], ["0.7.0-beta", "0.7.0-2"], ["0.7.0-beta.2", "0.7.0-beta"]]) {
    assert.equal(compareVersions(a, b), 1); assert.equal(compareVersions(b, a), -1)
  }
  assert.equal(compareVersions("0.7.0+build.2", "0.7.0+build.1"), 0)
  assert.throws(() => compareVersions("bad", "0.7.0"))
})

test("release notes include only intervening versions", () => {
  const result = changelogBetween(notes, "0.6.0", "0.7.0")
  assert.match(result, /New commands[\s\S]*Fixes/)
  assert.doesNotMatch(result, /Future|Old/)
  assert.match(changelogBetween(notes, "0.6.1", "0.8.0"), /Future[\s\S]*New commands/)
})

test("update checks latest or next without installing, and uses installed release notes", async () => {
  const fake = stub([view("0.7.0")])
  const result = await updatePackage(ws(), { npm: fake.npm, installed: "0.6.0", changelog: notes })
  assert.equal(result.newer, true)
  assert.match(result.changelog, /New commands/)
  assert.deepEqual(result.commands, ["npm install excudo@^0.7.0", "npx --no-install excudo skills --force"])
  assert.deepEqual(fake.calls.map(({ args }) => args), [["view", "excudo@latest", "version", "--json"], ["view", "excudo@0.7.0", "--json"], ["view", "excudo", "versions", "--json"]])
  const next = stub([view("0.8.0-beta.1"), view("0.7.0"), view({ changelog: "## 0.8.0-beta.1\n\nBeta notes\n" })])
  const beta = await updatePackage(ws(), { channel: "next", npm: next.npm, installed: "0.7.0", changelog: "" })
  assert.match(beta.changelog, /Beta notes/)
  assert.equal(next.calls[0].args[1], "excudo@next")
  const partial = stub([view("0.8.0"), view({ changelog: "## 0.8.0\n\nNewest\n\n## 0.7.0\n\nRevised notes\n" })])
  const combined = await updatePackage(ws(), { npm: partial.npm, installed: "0.6.0", changelog: "## 0.7.0\n\nOld notes\n\n## 0.6.1\n\nFixes\n" })
  assert.match(combined.changelog, /Newest[\s\S]*Revised notes[\s\S]*Fixes/)
  assert.equal((combined.changelog.match(/## 0\.7\.0/g) ?? []).length, 1)
})

test("offline, malformed metadata and registry failures exit successfully", async () => {
  for (const response of [{ status: 1 }, { error: new Error("offline") }, { status: 0, stdout: "not json" }, view("bad")]) {
    const result = await updatePackage(ws(), { npm: stub([response]).npm })
    assert.equal(result.state, "unavailable"); assert.equal(result.code, 0)
    assert.deepEqual(result.commands, [])
  }
  const current = await updatePackage(ws(), { npm: stub([view("0.7.0")]).npm, installed: "0.8.0" })
  assert.equal(current.newer, false)
  assert.equal(current.state, "current")
  await assert.rejects(updatePackage(ws(), { channel: "bad" }), /channel/)
})

test("apply runs exactly the displayed commands in the workspace and stops on failure", async () => {
  const workspace = ws()
  const fake = stub([view("0.7.0"), view({}), view([]), { status: 0 }, { status: 0 }])
  const result = await updatePackage(workspace, { npm: fake.npm, installed: "0.6.0", changelog: notes, apply: true })
  assert.equal(result.applied, true)
  assert.deepEqual(fake.calls.slice(3).map(({ args, options }) => [options.binary, args]), [
    ["npm", ["install", "excudo@^0.7.0"]], ["npx", ["--no-install", "excudo", "skills", "--force"]],
  ])
  assert.ok(fake.calls.every(({ options }) => options.cwd === workspace.root))
  const failed = stub([view("0.7.0"), view({}), view([]), { status: 1, stderr: "npm error code E403\nAccess denied" }])
  assert.equal((await updatePackage(workspace, { npm: failed.npm, installed: "0.6.0", changelog: notes, apply: true })).code, 1)
  assert.equal(failed.calls.length, 4)
})

test("update CLI emits JSON with a real offline npm view stub", () => {
  const root = tempDir()
  const npm = join(root, "npm-cli.cjs")
  writeFileSync(npm, 'if (process.argv[2] !== "view") process.exit(99); console.log(JSON.stringify(process.argv[4] === "version" ? "0.8.0" : { changelog: "## 0.8.0\\n\\nNew release notes\\n" }))\n')
  const result = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "update", "--root", root, "--json"],
    { encoding: "utf8", env: { ...process.env, npm_execpath: npm } })
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(data.state, "available")
  assert.match(data.changelog, /New release notes/)
  const text = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "update", "--root", root],
    { encoding: "utf8", env: { ...process.env, npm_execpath: npm } })
  assert.equal(text.status, 0, text.stderr)
  assert.match(text.stdout, /Excudo 0\.8\.0 is available/)
  assert.match(text.stdout, /New release notes[\s\S]*npm install excudo@\^0\.8\.0\nnpx --no-install excudo skills --force/)
})

test("a failed apply names the failed command and the ones left", async () => {
  const workspace = ws()
  const afterInstall = stub([view("0.7.0"), view({}), view([]), { status: 0 }, { status: 1, stderr: "skills failed" }])
  const skills = await updatePackage(workspace, { npm: afterInstall.npm, installed: "0.6.0", changelog: notes, apply: true })
  assert.equal(skills.state, "failed")
  assert.equal(skills.failedCommand, "npx --no-install excudo skills --force")
  assert.deepEqual(skills.remainingCommands, [])
  assert.match(skills.note, /npx --no-install excudo skills --force/)
  const atInstall = stub([view("0.7.0"), view({}), view([]), { status: 1, stderr: "install failed" }])
  const install = await updatePackage(workspace, { npm: atInstall.npm, installed: "0.6.0", changelog: notes, apply: true })
  assert.equal(install.failedCommand, "npm install excudo@^0.7.0")
  assert.deepEqual(install.remainingCommands, ["npx --no-install excudo skills --force"])
})

test("--apply on a current installation still refreshes the skills", async () => {
  const workspace = ws()
  const fake = stub([view("0.7.0"), { status: 0, stdout: "refreshed" }])
  const result = await updatePackage(workspace, { npm: fake.npm, installed: "0.7.0", changelog: notes, apply: true })
  assert.equal(result.state, "current")
  assert.equal(result.applied, true)
  assert.deepEqual(fake.calls.slice(1).map(({ args, options }) => [options.binary, args]), [["npx", ["--no-install", "excudo", "skills", "--force"]]])
  assert.equal(result.skillRefreshOutput, "refreshed")
  const plain = stub([view("0.7.0")])
  const check = await updatePackage(workspace, { npm: plain.npm, installed: "0.7.0", changelog: notes })
  assert.equal(check.applied, false)
  assert.equal(plain.calls.length, 1, "without --apply nothing runs")
})

test("an update across skipped versions says which releases the notes lack", async () => {
  const fake = stub([view("0.8.0"), view({ excudoReleaseNotes: { version: "0.8.0", markdown: "## 0.8.0\n\nNewest\n" } }), view(["0.6.0", "0.7.0", "0.7.1", "0.8.0-beta.1", "0.8.0"])])
  const result = await updatePackage(ws(), { npm: fake.npm, installed: "0.7.0", changelog: "" })
  assert.deepEqual(result.missingVersions, ["0.7.1"])
  assert.match(result.missingNote, /0\.7\.1/)
  assert.match(result.missingNote, /blob\/v0\.8\.0\/CHANGELOG\.md/)
  const full = stub([view("0.8.0"), view({}), view(["0.7.0", "0.7.1", "0.8.0"])])
  const complete = await updatePackage(ws(), { npm: full.npm, installed: "0.7.0", changelog: "## 0.8.0\n\nA\n\n## 0.7.1\n\nB\n" })
  assert.deepEqual(complete.missingVersions, [])
  assert.equal(complete.missingNote, undefined)
})

test("without --channel, only an installed prerelease follows next", async () => {
  const beta = stub([view("0.8.0-beta.2"), view("0.7.0"), view({})])
  const result = await updatePackage(ws(), { npm: beta.npm, installed: "0.8.0-beta.1", changelog: "" })
  assert.equal(result.channel, "next")
  assert.equal(beta.calls[0].args[1], "excudo@next")
  assert.equal(result.latest, "0.8.0-beta.2")
  const stable = stub([view("0.7.0")])
  const plain = await updatePackage(ws(), { npm: stable.npm, installed: "0.7.0", changelog: "" })
  assert.equal(plain.channel, "latest")
  assert.equal(stable.calls.length, 1)
  const explicit = stub([view("0.7.0")])
  assert.equal((await updatePackage(ws(), { channel: "latest", npm: explicit.npm, installed: "0.8.0-beta.1", changelog: "" })).channel, "latest")
})
