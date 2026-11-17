#!/usr/bin/env node
// Usage: node scripts/linked-build.mjs [--root <package>] [--check] [--json]
// Builds a dependency taken from a local clone (file:, link: or a bare path) before it is used, so
// tests run against the clone's current sources: npm test runs this first (pretest). For each such
// dependency, and each package of the same repository that it depends on, it compares the newest
// source (the files git sees under src/, the package's tsconfig*.json and the configs they extend)
// with the newest build output (the folders holding the built files that package.json names in
// exports, main, module, types and bin, and *.tsbuildinfo). When a source is newer or a built file
// is missing, it runs the build: the repository's `npm run build` when the package is one of its
// workspaces, else the package's. With --check it only reports. A package without a build
// script, or with every dependency from the registry, leaves nothing to do. Exit 0 when every one
// is built, 1 when one is out of date (--check) or its build failed, 2 when it cannot run.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { FIELDS, registrySpec } from "./dependencies.mjs"

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const git = (cwd, args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : null
}
const lines = (text) => (text ?? "").split("\n").filter(Boolean)
// NUL-separated, so git never quotes a path that holds non-ASCII characters.
const paths = (text) => (text ?? "").split("\0").filter(Boolean)

/** The real folder of a package as Node finds it from `from`, or null. */
function packageDir(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", name, "package.json")
    if (existsSync(manifest)) return realpathSync(dirname(manifest))
    if (dirname(dir) === dir) return null
  }
}

/** The packages to build: each dependency from a local clone and the same repository's packages it uses. */
export function linkedPackages(root) {
  const manifest = readJson(join(root, "package.json"))
  const found = new Map()
  const visit = (from, name, repo) => {
    const dir = packageDir(from, name)
    if (!dir || found.has(dir)) return
    const top = repo ?? git(dir, ["rev-parse", "--show-toplevel"])?.trim() ?? null
    if (repo && (!dir.startsWith(repo + sep) || relative(repo, dir).split(sep).includes("node_modules"))) return
    found.set(dir, { name, dir, repo: top ? realpathSync(top) : null })
    const own = readJson(join(dir, "package.json"))
    if (!top) return
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const dependency of Object.keys(own[field] ?? {})) visit(dir, dependency, realpathSync(top))
    }
  }
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) if (!registrySpec(spec)) visit(root, name, null)
  }
  return [...found.values()]
}

const newest = (files) => files.reduce((best, file) => {
  try { const time = statSync(file).mtimeMs; return !best || time > best.time ? { file, time } : best } catch { return best }
}, null)
const walk = (path) => {
  let stat
  try { stat = statSync(path) } catch { return [] }
  return stat.isDirectory() ? readdirSync(path).flatMap((entry) => walk(join(path, entry))) : [path]
}

/** The configs a tsconfig extends, by relative path, followed to the end of the chain. */
function extended(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return []
  seen.add(file)
  const text = readFileSync(file, "utf8")
  const field = /"extends"\s*:\s*(\[[^\]]*\]|"[^"]*")/.exec(text)?.[1] ?? ""
  return [...field.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((target) => /^\.{0,2}\//.test(target))
    .map((target) => resolve(dirname(file), existsSync(resolve(dirname(file), target)) ? target : `${target}.json`))
    .flatMap((target) => existsSync(target) ? [target, ...extended(target, seen)] : [])
}

/** The built files a package's consumers load: the targets of exports, main, module, types and bin that git does not track. */
function builtEntries(dir) {
  const own = readJson(join(dir, "package.json"))
  const targets = []
  const collect = (value) => {
    if (typeof value === "string") targets.push(value)
    else if (value && typeof value === "object") for (const item of Object.values(value)) collect(item)
  }
  for (const field of ["exports", "main", "module", "types", "typings", "bin"]) collect(own[field])
  const files = [...new Set(targets.filter((target) => !target.includes("*")).map((target) => relative(dir, join(dir, target))))]
    .filter((file) => file && !file.startsWith(".."))
  const tracked = new Set(paths(git(dir, ["ls-files", "-z", "--", ...files])))
  return files.filter((file) => !tracked.has(file))
}

/** Whether a package's build is older than its sources or lacks a built file: { source, output, missing, stale }. */
export function freshness(dir) {
  const own = paths(git(dir, ["ls-files", "-z", "-co", "--exclude-standard", "--", "src", "tsconfig*.json"])).map((file) => join(dir, file))
  const sources = [...own, ...own.filter((file) => /tsconfig[^/]*\.json$/.test(file)).flatMap((file) => extended(file))]
  const entries = builtEntries(dir)
  const folders = [...new Set(entries.filter((file) => file.includes("/")).map((file) => file.split("/")[0]))]
  const outputs = [...entries.filter((file) => !file.includes("/")), ...folders, ...readdirSync(dir).filter((name) => name.endsWith(".tsbuildinfo"))]
    .flatMap((entry) => walk(join(dir, entry))).filter((file) => !file.endsWith(".DS_Store"))
  const missing = entries.filter((file) => !existsSync(join(dir, file)))
  const source = newest(sources), output = newest(outputs)
  const stale = Boolean(entries.length) && (missing.length > 0 || (Boolean(source) && (!output || source.time > output.time)))
  return { source: source && relative(dir, source.file), output: output && relative(dir, output.file), missing, stale }
}

/** The command that builds a package: its repository's workspaces build, else its own. */
function buildOf(item) {
  const own = readJson(join(item.dir, "package.json"))
  if (!own.scripts?.build) return null
  const top = item.repo && existsSync(join(item.repo, "package.json")) ? readJson(join(item.repo, "package.json")) : null
  const workspaces = Array.isArray(top?.workspaces) ? top.workspaces : top?.workspaces?.packages
  const member = Boolean(top?.scripts?.build) && Array.isArray(workspaces) && workspaces.length > 0
  return { cwd: member ? item.repo : item.dir }
}

export function linkedBuild(root, { check = false } = {}) {
  const items = linkedPackages(root).map((item) => ({ ...item, ...freshness(item.dir), build: buildOf(item) }))
  const builds = new Map()
  for (const item of items) if (item.stale && item.build) builds.set(item.build.cwd, [...(builds.get(item.build.cwd) ?? []), item])
  const result = { root, packages: items.map(({ name, dir, stale, source, output, missing }) => ({ name, dir, stale, source, output, missing })), built: [], failed: [] }
  if (check) return result
  for (const [cwd, stale] of builds) {
    const run = spawnSync("npm", ["run", "build"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    if (run.status === 0) result.built.push({ cwd, packages: stale.map((item) => item.name) })
    else result.failed.push({ cwd, packages: stale.map((item) => item.name), output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n") })
  }
  if (result.built.length) for (const item of result.packages) Object.assign(item, freshness(item.dir))
  return result
}

// Run as a command, also through a linked node_modules path (Node loads the module from its real path).
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  let values
  try {
    ({ values } = parseArgs({ options: { root: { type: "string" }, check: { type: "boolean" }, json: { type: "boolean" } } }))
  } catch (error) {
    console.error(`${error.message}\nUsage: node scripts/linked-build.mjs [--root <package>] [--check] [--json]`)
    process.exit(2)
  }
  let result
  try {
    result = linkedBuild(resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), "..")), { check: values.check })
  } catch (error) {
    console.error(`✗ linked-build: ${error.message}`)
    process.exit(2)
  }
  const stale = result.packages.filter((item) => item.stale)
  if (values.json) console.log(JSON.stringify(result, null, 2))
  else if (!result.packages.length) console.log("✓ linked-build: no dependency comes from a local clone.")
  else {
    for (const build of result.built) console.log(`✓ linked-build: built ${build.cwd} (${build.packages.join(", ")} had sources newer than the build).`)
    for (const build of result.failed) console.log(`✗ linked-build: the build in ${build.cwd} failed (${build.packages.join(", ")}):\n${build.output}`)
    const why = (item) => item.missing.length ? `lacks ${item.missing.join(", ")}` : `is older than ${item.source}`
    if (values.check) for (const item of stale) console.log(`✗ linked-build: the build of ${item.name} ${why(item)}; run npm run build in ${item.dir}`)
    else for (const item of stale) if (!result.failed.some((build) => build.packages.includes(item.name))) console.log(`- linked-build: the build of ${item.name} still ${why(item)}.`)
    if (!stale.length && !result.built.length) console.log(`✓ linked-build: ${result.packages.map((item) => item.name).join(", ")} built from the current sources.`)
  }
  process.exit(result.failed.length || (values.check && stale.length) ? 1 : 0)
}
