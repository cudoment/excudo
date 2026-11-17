import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { applyWorkspaces, build, check, fixBlocks, planWorkspaces, review, workspaces } from "../src/index.mjs"
import { put, read, tempDir, workspace } from "./helpers.mjs"

const git = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function repository(branch) {
  const dir = tempDir("excudo-work-")
  git(dir, "init", "-q", "-b", "main")
  writeFileSync(join(dir, "a.md"), "a\n")
  git(dir, "add", ".")
  git(dir, "commit", "-qm", "Start")
  if (branch) git(dir, "checkout", "-q", "-b", branch)
  return dir
}

test("workspaces keeps branches from git and window names from an app, and asks about missing folders", async () => {
  const site = repository("feature/search")
  const docs = repository()
  const ws = await workspace({
    "projects/Site.md": `# Site\nThe website.\n\n- \`${site}\` · \`main\`\n- TODO ship it\n`,
    "projects/Docs.md": `# Docs\nThe docs.\n\n## Workspace\n\`${docs}\` · \`main\` · windows: old name\n`,
    "projects/Gone.md": "# Gone\nAn old experiment.\n\n- `/no/such/folder-excudo` · `main`\n",
    "projects/Code.md": "# Code\nAn example.\n\n```\n`/no/such/folder-in-code` · `main`\n```\n",
  })
  assert.equal(build(ws).blocked.length, 0)
  const input = JSON.stringify({ workspaces: [{ path: `${docs}/`, labels: ["review, then merge", "notes"] }, { path: "/work/new", name: "new" }] })
  const before = read(ws, "projects/Site.md")
  const plan = workspaces(ws, { input, dryRun: true })
  assert.deepEqual([plan.lines, plan.updated.length, plan.gone.map((item) => item.path), plan.unplaced.map((item) => item.path)], [3, 2, ["/no/such/folder-excudo"], ["/work/new"]])
  assert.equal(read(ws, "projects/Site.md"), before)

  workspaces(ws, { input })
  assert.match(read(ws, "projects/Site.md"), new RegExp(`\\n- \`${site}\` · \`feature/search\`\\n- TODO ship it\\n`))
  assert.match(read(ws, "projects/Docs.md"), new RegExp(`\\n\`${docs}\` · \`main\` · windows: review · then merge, notes\\n`))
  // Without window names from an app, the ones written stay.
  workspaces(ws)
  assert.match(read(ws, "projects/Docs.md"), /windows: review · then merge, notes\n/)
  assert.equal(build(ws).blocked.length, 0)

  const gone = (await review(ws)).candidates.filter((candidate) => candidate.reasons.some((reason) => reason.kind === "workspace-gone"))
  assert.deepEqual(gone.map((candidate) => [candidate.path, candidate.line, candidate.reasons[0].folder]), [["projects/Gone.md", 4, "/no/such/folder-excudo"]])
  assert.match(gone[0].evidence, /no longer exists/)
})

test("one folder on nodes in different top nodes is reported, and Korean workspaces name windows 창", async () => {
  const site = repository()
  const ws = await workspace({
    "projects/사이트.md": `# 사이트\n웹사이트입니다.\n\n- \`${site}\` · \`main\` · 창: 배포\n`,
    "projects/문서.md": `# 문서\n문서입니다.\n\n- \`${site}\`\n`,
  }, { locale: "ko" })
  assert.equal(build(ws).blocked.length, 0)
  // A shared folder's lines keep only their own windows; a new window is the owner's to place.
  const result = workspaces(ws, { input: [{ path: site, name: "site", labels: ["배포", "검토"] }] })
  assert.deepEqual(result.updated.map((item) => item.text), [`- \`${site}\` · \`main\``])
  assert.deepEqual(result.unassigned.map((item) => [item.path, item.labels, item.nodes.toSorted()]), [[site, ["검토"], ["문서", "사이트"]]])
  assert.deepEqual(result.names.map((item) => [item.status, item.expected]), [["unnamed", null]])
  const { issues } = await check(ws)
  assert.deepEqual(issues.filter((issue) => issue.code === "path-duplicate").map((issue) => issue.severity), ["warning"])
  assert.throws(() => workspaces(ws, { input: [{ path: "relative/path" }] }), /절대 경로/)
})

test("a folder shared below one parent takes the parent's name, and each window belongs to one node", async () => {
  const main = repository("develop")
  const search = repository("feature/search")
  const one = repository()
  const two = repository()
  const ws = await workspace({
    "projects/Docs.md": `# Docs\nThe docs site.\n\n- \`${main}\` · \`develop\` · windows: build notes\n`,
    "projects/Docs/Search.md": `# Search\nBetter search.\n\n- \`${main}\` · \`develop\` · windows: test set\n- \`${search}\` · \`feature/search\`\n- TODO test the search API\n`,
    "projects/Docs/Data.md": `# Data\nTest data.\n\n- \`${main}\` · \`develop\`\n`,
    "projects/Plugins.md": `# Plugins\nTwo plugins.\n\n- \`${one}\` · \`main\`\n- \`${two}\` · \`main\`\n`,
  })
  assert.equal(build(ws).blocked.length, 0)
  assert.deepEqual((await check(ws)).issues.filter((issue) => /^path-/.test(issue.code)), [])
  const input = [
    { path: main, name: "Search", labels: ["build notes", "test set", "review"] },
    { path: search, name: "feature/search" },
    { path: one, name: "Plugins" },
    { path: two, name: "two" },
  ]
  const result = workspaces(ws, { input, dryRun: true })
  assert.deepEqual(result.updated, [])
  assert.deepEqual(result.unassigned.map((item) => [item.path, item.labels, item.nodes.toSorted()]), [[main, ["review"], ["Data", "Docs", "Search"]]])
  // The shared folder does not count as Search's own, so Search's feature folder takes its name alone.
  assert.deepEqual(result.names.map((item) => [posixName(item.path, { main, search, one, two }), item.expected, item.status, item.shared]), [
    ["main", "Docs", "rename", true],
    ["search", "Search", "rename", false],
    ["one", `Plugins · ${one.split("/").at(-1)}`, "rename", false],
    ["two", `Plugins · ${two.split("/").at(-1)}`, "rename", false],
  ])
  // A window closed in the app leaves the line; a window on two nodes' lines is reported.
  workspaces(ws, { input: [{ path: main, labels: ["build notes"] }] })
  assert.match(read(ws, "projects/Docs/Search.md"), new RegExp(`\n- \`${main}\` · \`develop\`\n`))
  assert.match(read(ws, "projects/Docs.md"), /windows: build notes\n/)
  put(ws.root, "projects/Docs/Data.md", `# Data\nTest data.\n\n- \`${main}\` · \`develop\` · windows: build notes\n`)
  assert.deepEqual((await check(ws)).issues.filter((issue) => /^path-/.test(issue.code)).map((issue) => issue.code), ["path-window-twice"])
})
test("a shared folder finds its parent when the files are spelled NFD, as a phone sync leaves them", async () => {
  const main = repository("develop")
  const nfd = (text) => text.normalize("NFD")
  const ws = await workspace({
    [nfd("projects/문서.md")]: `# 문서\n문서 사이트입니다.\n`,
    [nfd("projects/문서/검색 개선.md")]: `# 검색 개선\n검색을 고칩니다.\n\n- \`${main}\` · \`develop\` · 창: 테스트 셋\n`,
    [nfd("projects/문서/테스트 데이터.md")]: `# 테스트 데이터\n데이터를 만듭니다.\n\n- \`${main}\` · \`develop\`\n`,
  }, { locale: "ko" })
  assert.equal(build(ws).blocked.length, 0)
  assert.deepEqual((await check(ws)).issues.filter((issue) => /^path-/.test(issue.code)), [])
  const result = workspaces(ws, { input: [{ path: main, name: "develop", labels: ["테스트 셋"] }], dryRun: true })
  assert.deepEqual(result.names.map((item) => [item.expected, item.status]), [["문서", "rename"]])
})

const posixName = (path, named) => Object.entries(named).find(([, value]) => value === path)[0]

const A = "64f0c2a1-1111-4aaa-8bbb-000000000001"
const B = "64f0c2a1-2222-4aaa-8bbb-000000000002"
const C = "64f0c2a1-3333-4aaa-8bbb-000000000003"

test("block references: shared ids, missing targets, embeds that loop or repeat, and code that is only text", async () => {
  const ws = await workspace({
    "projects/One.md": `# One\nFirst node.\n\n- Plan the launch\n  id:: ${A}\n- Loop start {{embed ((${B}))}}\n  id:: ${C}\n- See ((64f0c2a1-9999-4aaa-8bbb-000000000009)) and {{embed [[Nowhere]]}}\n- \`((64f0c2a1-8888-4aaa-8bbb-000000000008))\` in code is text\n`,
    "projects/Two.md": `# Two\nSecond node.\n\n- Plan the launch\n  id:: ${A}\n- Loop back {{embed ((${C}))}}\n  id:: ${B}\n- Again {{embed ((${B}))}}\n`,
  })
  const codes = [...new Set((await check(ws)).issues.filter((issue) => /block|embed/.test(issue.code)).map((issue) => `${issue.severity}:${issue.code}`))].sort()
  assert.deepEqual(codes, ["error:block-id-duplicate", "error:block-ref-missing", "error:embed-cycle", "warning:embed-page-missing", "warning:embed-twice"])
})

test("fix keeps the first block's id, turns an identical copy into an embed and gives a different block a new id", async () => {
  const ws = await workspace({
    "projects/One.md": `# One\nFirst node.\n\n- Plan the launch\n  id:: ${A}\n- Write notes\n  id:: ${B}\n`,
    "projects/Two.md": `# Two\nSecond node.\n\n- Plan the launch\n  id:: ${A}\n- Something else entirely\n  id:: ${B}\n  - with a child\n- Points at ((${B}))\n`,
  })
  const plan = fixBlocks(ws, { dryRun: true })
  assert.deepEqual(plan.fixed.map((item) => [item.action, item.file, item.line]), [["embedded", "projects/Two.md", 4], ["new-id", "projects/Two.md", 6]])
  assert.match(read(ws, "projects/Two.md"), new RegExp(`- Plan the launch\\n  id:: ${A}`))
  fixBlocks(ws)
  const two = read(ws, "projects/Two.md")
  assert.match(two, new RegExp(`^# Two\\nSecond node\\.\\n\\n- \\{\\{embed \\(\\(${A}\\)\\)\\}\\}\\n- Something else entirely\\n  id:: (?!${B})[0-9a-f-]{36}\\n  - with a child\\n- Points at \\(\\(${B}\\)\\)\\n$`))
  assert.deepEqual((await check(ws)).issues.filter((issue) => /block|embed/.test(issue.code)), [])
  assert.deepEqual(fixBlocks(ws).fixed, [])
})

test("fix embeds only an exact copy: different numbers or code, or a copy inside its original, get a new id", async () => {
  const D = "64f0c2a1-4444-4aaa-8bbb-000000000004"
  const ws = await workspace({
    "projects/One.md": `# One\nFirst node.\n\n- Price 1.5\n  id:: ${A}\n- Run this\n  id:: ${B}\n  \`\`\`sh\n  npm test\n  \`\`\`\n- Parent note\n  id:: ${D}\n\t- Parent note\n\t  id:: ${D}\n`,
    "projects/Two.md": `# Two\nSecond node.\n\n- Price 15\n  id:: ${A}\n- Run this\n  id:: ${B}\n  \`\`\`sh\n  npm run build\n  \`\`\`\n`,
  })
  const { fixed } = fixBlocks(ws)
  assert.deepEqual(fixed.map((item) => [item.action, item.file, item.line]).sort(), [["new-id", "projects/One.md", 13], ["new-id", "projects/Two.md", 4], ["new-id", "projects/Two.md", 6]])
  assert.match(read(ws, "projects/Two.md"), /- Price 15\n {2}id:: (?!64f0c2a1-1111)/)
  assert.deepEqual((await check(ws)).issues.filter((issue) => /block|embed/.test(issue.code)), [])
})

test("fix compares code with its indentation, and embeds an exact copy at another depth", async () => {
  const code = (pad) => `${pad}- Run this\n${pad}  id:: ${A}\n${pad}  \`\`\`py\n${pad}  if ready:\n${pad}      finish()\n${pad}  \`\`\`\n`
  const ws = await workspace({
    "projects/One.md": `# One\nFirst node.\n\n${code("")}`,
    "projects/Three.md": `# Three\nThird node.\n\n- Parent\n${code("\t")}`,
    "projects/Two.md": `# Two\nSecond node.\n\n- Run this\n  id:: ${A}\n  \`\`\`py\n  if ready:\n  finish()\n  \`\`\`\n`,
  })
  const { fixed } = fixBlocks(ws)
  assert.deepEqual(fixed.map((item) => [item.action, item.file, item.line]).sort(), [["embedded", "projects/Three.md", 5], ["new-id", "projects/Two.md", 4]])
  assert.match(read(ws, "projects/Two.md"), /if ready:\n {2}finish\(\)/)
  assert.equal(read(ws, "projects/Three.md"), `# Three\nThird node.\n\n- Parent\n\t- {{embed ((${A}))}}\n`)
})

test("a workspace edit leaves a path line that moved into a code example", async () => {
  const site = repository("feature/search")
  const ws = await workspace({ "projects/Site.md": `# Site\nThe website.\n\n- \`${site}\` · \`main\`\n` })
  const plan = planWorkspaces(ws)
  // Moved down into an example, or left on its line with a fence opened above it.
  for (const moved of [`# Site\nThe website.\n\nHow a path line looks:\n\n\`\`\`md\n- \`${site}\` · \`main\`\n\`\`\`\n`,
    `# Site\nThe website.\n\`\`\`md\n- \`${site}\` · \`main\`\n\`\`\`\n`]) {
    writeFileSync(join(ws.graphDir, "projects/Site.md"), moved)
    const result = applyWorkspaces(ws, plan.edits)
    assert.deepEqual([result.updated.length, result.conflicts.length], [0, 1])
    assert.equal(read(ws, "projects/Site.md"), moved)
  }
})

test("workspace edits find their line again after the file changed, and leave it when it is gone", async () => {
  const site = repository("feature/search")
  const ws = await workspace({ "projects/Site.md": `# Site\nThe website.\n\n- \`${site}\` · \`main\`\n` })
  const stale = JSON.stringify([{ path: site, branch: "main", labels: ["review"] }])
  const plan = planWorkspaces(ws, { input: stale })
  assert.deepEqual(plan.edits.map((edit) => edit.text), [`- \`${site}\` · \`feature/search\` · windows: review`], "git's branch wins over an app's")
  // A phone adds a task above the line before the edit is written.
  writeFileSync(join(ws.graphDir, "projects/Site.md"), `# Site\nThe website.\n\n- TODO from the phone\n- \`${site}\` · \`main\`\n`)
  assert.deepEqual(applyWorkspaces(ws, plan.edits).updated.map((item) => item.line), [5])
  assert.equal(read(ws, "projects/Site.md"), `# Site\nThe website.\n\n- TODO from the phone\n- \`${site}\` · \`feature/search\` · windows: review\n`)
  writeFileSync(join(ws.graphDir, "projects/Site.md"), "# Site\nThe website.\n\n- the line was rewritten on the phone\n")
  const result = applyWorkspaces(ws, plan.edits)
  assert.deepEqual([result.updated.length, result.conflicts.length], [0, 1])
  assert.equal(read(ws, "projects/Site.md"), "# Site\nThe website.\n\n- the line was rewritten on the phone\n")
})

test("updating a path line's branch or window names does not make the summaries above it outdated", async () => {
  const site = repository("feature/search")
  const ws = await workspace({
    "projects/Work.md": "# Work\nThe owner's summary.\n",
    "projects/Work/Site.md": `# Site\nThe website.\n\n- \`${site}\` · \`main\`\n- TODO ship it\n`,
  })
  const commit = (message, date) => {
    for (const args of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", message]])
      assert.equal(spawnSync("git", ["-C", ws.root, ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).status, 0)
  }
  spawnSync("git", ["-C", ws.root, "init", "-q"])
  assert.equal(build(ws).blocked.length, 0)
  commit("Start", "2026-09-01T12:00:00Z")
  workspaces(ws, { input: [{ path: site, labels: ["release"] }] })
  commit("Branch and windows", "2026-09-10T12:00:00Z")
  const behind = async () => (await review(ws, { now: new Date("2026-09-11T12:00:00Z") })).candidates.some((candidate) => candidate.node.endsWith("Work") && candidate.reasons.some((reason) => reason.kind === "summary-behind"))
  assert.equal(await behind(), false)
  writeFileSync(join(ws.graphDir, "projects/Work/Site.md"), `# Site\nThe website.\n\n- \`${site}\` · \`feature/search\` · windows: release\n- TODO ship it\n- TODO write the notes\n`)
  commit("A new task", "2026-09-10T13:00:00Z")
  assert.equal(await behind(), true)
})
