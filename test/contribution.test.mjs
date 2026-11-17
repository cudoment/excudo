import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { parse } from "yaml"

test("published contribution files keep a six-way CI matrix and diagnostics in both issue forms", () => {
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8")
  const ci = parse(read(".github/workflows/test.yml"))
  assert.deepEqual(ci.jobs.test.strategy.matrix.os, ["ubuntu-latest", "macos-latest", "windows-latest"])
  assert.deepEqual(ci.jobs.test.strategy.matrix.node, [22, 24])
  for (const run of ["npm ci", "npm test", "npm run release:check -- --quick"])
    assert.ok(ci.jobs.test.steps.some((step) => step.run === run), run)
  for (const name of ["bug", "usability"]) {
    const template = parse(read(`.github/ISSUE_TEMPLATE/${name}.yml`))
    assert.ok(template.body.some((item) => item.id === "feedback" && item.attributes.description.includes("excudo feedback")))
  }
  assert.equal(parse(read(".github/ISSUE_TEMPLATE/config.yml")).blank_issues_enabled, true)
  assert.match(read("CONTRIBUTING.md"), /npm publish --tag next/)
  assert.match(read("CONTRIBUTING.md"), /npm publish --tag latest/)
})
