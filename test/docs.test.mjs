import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { anchors, brokenLinks, docPairs, headings, slug } from "../scripts/docs.mjs"

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const read = (file) => readFileSync(join(root, file), "utf8")
const files = docPairs(root).flatMap((pair) => [pair.en, pair.ko])

test("a heading's anchor follows GitHub: lower case, no punctuation, spaces as hyphens", () => {
  assert.equal(slug("Keep a file in your format"), "keep-a-file-in-your-format")
  assert.equal(slug("Change a task's state on the website"), "change-a-tasks-state-on-the-website")
  assert.equal(slug("`excudo start`: first steps, 1/2"), "excudo-start-first-steps-12")
  assert.equal(slug("요청에서 배우기"), "요청에서-배우기")
  assert.equal(slug("Tine과 휴대폰 동기화"), "tine과-휴대폰-동기화")
  assert.deepEqual([...anchors("# A\n\n## B\n\n## B\n\n```sh\n# not a heading\n```\n")], ["a", "b", "b-1"])
})

test("every English document has its Korean pair with the same headings", () => {
  for (const file of files) assert.ok(existsSync(join(root, file)), `${file} exists`)
  for (const { en, ko } of docPairs(root)) {
    assert.deepEqual(headings(read(en)).map((item) => item.level), headings(read(ko)).map((item) => item.level), `${en} and ${ko} keep the same outline`)
  }
})

test("every local link and anchor in the READMEs and docs points at a file and a heading", () => {
  for (const file of files) assert.deepEqual(brokenLinks(root, file), [], file)
})

test("docs pages link back to their README and to the other language, and hold no install range or machine-written symbol", () => {
  for (const { en, ko } of docPairs(root).slice(1)) {
    for (const [file, back, other] of [[en, "../README.md", ko], [ko, "../README.ko.md", en]]) {
      const text = read(file)
      const top = text.split("\n").slice(0, 6).join("\n")
      assert.ok(top.includes(`(${back})`), `${file} links ${back} near the top`)
      assert.ok(top.includes(`(${other.replace(/^docs\//, "")})`), `${file} links ${other} near the top`)
      assert.ok(!/excudo@\^\d/.test(text), `${file} names no install range; the READMEs carry it`)
    }
  }
  for (const file of files) assert.deepEqual(read(file).match(/[·・ㆍ•∙「-』①-⑳⑴-⒇—]/g) ?? [], [], file)
})

test("docs holds no agent instruction file and ships in the package", () => {
  const dir = join(root, "docs")
  if (existsSync(dir)) for (const name of readdirSync(dir)) assert.ok(!/^(?:AGENTS|CLAUDE)(?:\.\w+)?\.md$/.test(name), `${name} would stop the public export`)
  assert.ok(JSON.parse(read("package.json")).files.includes("docs"))
})
