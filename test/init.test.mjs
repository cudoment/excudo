import assert from "node:assert/strict"
import { cpSync, existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { build, check, init, loadWorkspace, skillNames } from "../src/index.mjs"
import { tempDir } from "./helpers.mjs"

const fresh = () => join(tempDir("excudo-init-"), "memo")

test("init creates a workspace that builds and holds the skills for both agents", async () => {
  const root = fresh()
  const result = await init(root)
  assert.equal(result.built.blocked.length, 0)
  for (const rel of ["excudo.config.mjs", "package.json", "AGENTS.md", "CLAUDE.md", "notes/views/Home.mdx", "notes/Done.md", "notes/Home.md", "notes/logseq/config.edn"]) {
    assert.ok(existsSync(join(root, rel)), rel)
  }
  for (const name of skillNames()) {
    assert.ok(existsSync(join(root, ".agents/skills", name, "SKILL.md")), name)
    const link = join(root, ".claude/skills", name)
    assert.ok(lstatSync(link).isSymbolicLink())
    assert.equal(readlinkSync(link), join("..", "..", ".agents", "skills", name))
    assert.ok(existsSync(join(link, "SKILL.md")))
  }
  const ws = await loadWorkspace({ root })
  assert.deepEqual((await check(ws)).issues, [])
  assert.match(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies["excudo"], /^file:/)

  const again = await init(root)
  assert.equal(again.created.length, 0)
  assert.ok(again.skills.every((skill) => skill.state === "current"))
})

test("init --locale ko writes Korean pages", async () => {
  const root = fresh()
  await init(root, { locale: "ko" })
  assert.match(readFileSync(join(root, "notes/홈.md"), "utf8"), /^생성:: views\/홈\.mdx/)
  assert.ok(existsSync(join(root, "notes/완료.md")))
  assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /하위 문서/)
})

test("Home puts thinking above work, and its sections are queries with their own title and fold, which a phone shows", async () => {
  for (const [locale, home, areas] of [["en", "notes/Home.md", ["Thinking and plans", "Work and automation"]], ["ko", "notes/홈.md", ["생각과 계획", "업무와 자동화"]]]) {
    const root = fresh()
    await init(root, { locale })
    const page = readFileSync(join(root, home), "utf8")
    assert.deepEqual(page.match(/^## .*$/gm), areas.map((area) => `## ${area}`), locale)
    // A folded label hides its query on a phone: its arrow sits faintly at the row's end.
    assert.doesNotMatch(page, /\{\{query[^\n]*\n\s+collapsed::/, locale)
    const queries = page.match(/^- \{\{query .*$/gm)
    assert.equal(queries.length, 7, locale)
    // Tine reads the options map only after a parenthesized query.
    for (const line of queries) assert.match(line, /^- \{\{query \(.*\) \{:title "[^"]+"(?: :collapsed\? true)?\}\}\}$/, line)
  }
})

test("init --example starts from the example memo", async () => {
  const root = fresh()
  const result = await init(root, { example: true })
  assert.ok(existsSync(join(root, "notes/projects/Website/Blog migration/Image cleanup.md")))
  assert.equal(result.built.written.length, 0)
})

test("the committed example is clean and already built", async () => {
  const copy = join(tempDir("excudo-example-"), "example")
  cpSync(new URL("../example", import.meta.url), copy, { recursive: true })
  const ws = await loadWorkspace({ root: copy })
  assert.deepEqual((await check(ws)).issues, [])
  assert.deepEqual(build(ws).written, [])
})
