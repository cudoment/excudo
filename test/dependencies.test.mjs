import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { localDependencies, registrySpec } from "../scripts/dependencies.mjs"
import { tempDir } from "./helpers.mjs"

const script = fileURLToPath(new URL("../scripts/dependencies.mjs", import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })

test("a dependency counts as from the registry only for a version, a range, a tag or an npm: alias of one", () => {
  for (const spec of ["^1.1.0", "~1.2.3", "1.x || 2.x", ">=1.0.0 <2.0.0", "1.1.0", "*", "latest", "", "npm:@scope/pkg@^1.0.0", "npm:pkg@1.0.0", "npm:pkg"]) {
    assert.equal(registrySpec(spec), true, spec)
  }
  for (const spec of ["file:../cudoc/packages/cudoc", "link:../cudoc", "portal:../cudoc", "../cudoc/packages/cudoc", "./cudoc", ".",
    "/Users/someone/cudoc", "~/cudoc", "C:\\cudoc", "cudoc-1.1.0.tgz", "./excudo-0.6.0.tgz", "owner/repo", "github:owner/repo",
    "git+https://example.com/owner/repo.git", "https://example.com/cudoc.tgz", "workspace:*", "npm:../cudoc"]) {
    assert.equal(registrySpec(spec), false, spec)
  }
})

test("the dependency check names each dependency not from the registry in every field and fails, and passes otherwise", () => {
  const manifest = {
    dependencies: { "@cudoment/cudoc": "file:../cudoc/packages/cudoc", yaml: "^2.9.1" },
    devDependencies: { "cudoc-export": "../cudoc/packages/cudoc-export" },
    peerDependencies: { "cudoc-export": "^1.1.0" },
    optionalDependencies: { tool: "./tool-1.0.0.tgz" },
  }
  assert.deepEqual(localDependencies(manifest), [
    { field: "dependencies", name: "@cudoment/cudoc", spec: "file:../cudoc/packages/cudoc" },
    { field: "devDependencies", name: "cudoc-export", spec: "../cudoc/packages/cudoc-export" },
    { field: "optionalDependencies", name: "tool", spec: "./tool-1.0.0.tgz" },
  ])
  const dir = tempDir("excudo-deps-")
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest))
  const failed = run("--root", dir)
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /devDependencies cudoc-export is \.\.\/cudoc\/packages\/cudoc-export/)
  assert.equal(JSON.parse(run("--root", dir, "--json").stdout).local.length, 3)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { yaml: "^2.9.1" }, devDependencies: { "cudoc-export": "^1.1.0" } }))
  const passed = run("--root", dir)
  assert.equal(passed.status, 0, passed.stdout)
  assert.equal(run("--root", join(dir, "missing")).status, 2)
  assert.equal(run("--unknown").status, 2)
})
