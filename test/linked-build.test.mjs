import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test as nodeTest } from "node:test"
// These fixtures launch POSIX executables directly; Windows cannot execute their shebangs.
const test = process.platform === "win32" ? nodeTest.skip : nodeTest
import { fileURLToPath } from "node:url"
import { tempDir } from "./helpers.mjs"

const script = fileURLToPath(new URL("../scripts/linked-build.mjs", import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
const write = (file, text) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, text) }
const age = (file, seconds) => { const time = new Date(Date.now() + seconds * 1000); utimesSync(file, time, time) }

// A clone like cudoc: two workspace packages, one using the other, each built into dist/ by the root build.
function clone() {
  const base = tempDir("excudo-linked-")
  const repo = join(base, "lib")
  write(join(repo, ".gitignore"), "node_modules/\ndist/\n*.tsbuildinfo\n.DS_Store\n")
  write(join(repo, "tsconfig.base.json"), '{ "compilerOptions": { "target": "ES2022" } }\n')
  write(join(repo, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"], scripts: { build: "node build.mjs" } }))
  write(join(repo, "build.mjs"), [
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs"',
    'if (process.env.FAIL_BUILD) { console.error("type error in src/index.js"); process.exit(1) }',
    'for (const name of ["core", "export"]) {',
    '  mkdirSync(`packages/${name}/dist`, { recursive: true })',
    '  writeFileSync(`packages/${name}/dist/index.js`, readFileSync(`packages/${name}/src/index.js`))',
    '  writeFileSync(`packages/${name}/tsconfig.tsbuildinfo`, "{}")',
    '}',
  ].join("\n"))
  for (const [name, dependencies] of [["core", {}], ["export", { "lib-core": "^1.0.0" }]]) {
    write(join(repo, "packages", name, "package.json"), JSON.stringify({ name: `lib-${name}`, version: "1.0.0", exports: { ".": { default: "./dist/index.js" } }, files: ["dist", "styles.css"], scripts: { build: "node ../../build.mjs" }, dependencies }))
    write(join(repo, "packages", name, "tsconfig.json"), '{\n  // shared options\n  "extends": "../../tsconfig.base.json"\n}\n')
    write(join(repo, "packages", name, "src", "index.js"), `export const name = "${name}"\n`)
    write(join(repo, "packages", name, "README.md"), `# ${name}\n`)
  }
  mkdirSync(join(repo, "node_modules"), { recursive: true })
  symlinkSync("../packages/core", join(repo, "node_modules", "lib-core"))
  spawnSync("git", ["init", "-q", repo])
  const app = join(base, "app")
  write(join(app, "package.json"), JSON.stringify({ name: "app", dependencies: { "lib-export": "file:../lib/packages/export", yaml: "^2.0.0" } }))
  mkdirSync(join(app, "node_modules"), { recursive: true })
  symlinkSync("../../lib/packages/export", join(app, "node_modules", "lib-export"))
  return { repo, app }
}

test("a dependency from a local clone is built when it has no build or a source newer than it, with the clone's packages it uses", () => {
  const { repo, app } = clone()
  const unbuilt = run("--root", app, "--check")
  assert.equal(unbuilt.status, 1, unbuilt.stdout)
  assert.match(unbuilt.stdout, /lib-export/)
  assert.match(unbuilt.stdout, /lib-core/, "the clone's package that the dependency uses is checked too")
  const built = run("--root", app)
  assert.equal(built.status, 0, built.stdout + built.stderr)
  assert.match(built.stdout, /built .*lib/)
  assert.ok(existsSync(join(repo, "packages", "export", "dist", "index.js")))
  assert.equal(run("--root", app, "--check").status, 0, "built from the current sources")

  for (const file of ["src/index.js", "tsconfig.json"]) age(join(repo, "packages", "core", file), -120)
  age(join(repo, "tsconfig.base.json"), -120)
  for (const file of ["dist/index.js", "tsconfig.tsbuildinfo"]) age(join(repo, "packages", "core", file), -60)
  age(join(repo, "packages", "core", "README.md"), -10)
  assert.equal(run("--root", app, "--check").status, 0, "a file outside src/ does not call for a build")
  age(join(repo, "packages", "core", "src", "index.js"), -30)
  const stale = run("--root", app, "--check")
  assert.equal(stale.status, 1)
  assert.match(stale.stdout, /the build of lib-core is older than src\/index\.js/)
  assert.equal(run("--root", app).status, 0)
  assert.equal(run("--root", app, "--check").status, 0)

  // A file git ignores beside the build (a Finder record) says nothing about the build.
  const core = join(repo, "packages", "core")
  for (const file of ["dist/index.js", "tsconfig.tsbuildinfo"]) age(join(core, file), -60)
  age(join(core, "src", "index.js"), -30)
  write(join(core, ".DS_Store"), "finder\n")
  assert.equal(run("--root", app, "--check").status, 1, "the build is still older than its source")
  assert.equal(run("--root", app).status, 0)
  // A built file the package names is missing, though other output is there.
  rmSync(join(core, "dist", "index.js"))
  const missing = run("--root", app, "--check")
  assert.equal(missing.status, 1)
  assert.match(missing.stdout, /the build of lib-core lacks dist\/index\.js/)
  assert.equal(run("--root", app).status, 0)
  // The repository's shared config that a package's tsconfig extends is a source too.
  for (const file of ["dist/index.js", "tsconfig.tsbuildinfo"]) age(join(core, file), -60)
  age(join(core, "src", "index.js"), -120); age(join(core, "tsconfig.json"), -120)
  age(join(repo, "tsconfig.base.json"), -30)
  assert.match(run("--root", app, "--check").stdout, /lib-core is older than \.\.\/\.\.\/tsconfig\.base\.json/)
  assert.equal(run("--root", app).status, 0)
  assert.equal(run("--root", app, "--check").status, 0)
})

test("a failed build fails, and a package with every dependency from the registry has nothing to build", () => {
  const { app } = clone()
  const failed = spawnSync(process.execPath, [script, "--root", app], { encoding: "utf8", env: { ...process.env, FAIL_BUILD: "1" } })
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /failed[\s\S]*type error in src\/index\.js/)
  const plain = tempDir("excudo-linked-plain-")
  writeFileSync(join(plain, "package.json"), JSON.stringify({ dependencies: { yaml: "^2.0.0" } }))
  const nothing = run("--root", plain)
  assert.equal(nothing.status, 0)
  assert.match(nothing.stdout, /no dependency comes from a local clone/)
  assert.equal(run("--unknown").status, 2)
  // A workspace runs it through its node_modules link to the engine.
  const linked = join(tempDir("excudo-linked-path-"), "engine")
  symlinkSync(fileURLToPath(new URL("..", import.meta.url)), linked)
  const through = spawnSync(process.execPath, [join(linked, "scripts", "linked-build.mjs"), "--root", plain], { encoding: "utf8" })
  assert.match(through.stdout, /no dependency comes from a local clone/)
})
