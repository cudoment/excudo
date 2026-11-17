#!/usr/bin/env node
// Usage: node scripts/dependencies.mjs [--root <package>] [--json]
// Checks that every dependency in package.json comes from the registry: a version, a range, a tag or
// an npm: alias of one. A folder or tarball on this machine (file:, link:, portal: or a bare path), a
// git or web source, or a workspace: link would ship as a spec that other machines cannot install.
// The engine may take a sibling clone that way until the version it needs is published (AGENTS.md,
// Releasing); npm pack and npm publish run this first (prepack), and release:check runs it too.
// Exit 0 when every dependency comes from the registry, 1 when one does not, 2 when it cannot run.
import { readFileSync, realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

export const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

/** Whether npm resolves this spec from the registry: no path, protocol, host or tarball in it. */
export function registrySpec(spec) {
  let text = String(spec ?? "").trim()
  // An alias (npm:name@range) names a registry package; what follows the name is the range.
  if (text.startsWith("npm:")) text = text.slice(4).replace(/^(@[^/@]+\/)?[^/@]+@?/, "")
  return !/[/\\:]/.test(text) && !text.startsWith(".") && !/\.(tgz|tar|tar\.gz)$/i.test(text)
}

/** Each dependency of a package.json that does not come from the registry, as { field, name, spec }. */
export function localDependencies(manifest) {
  return FIELDS.flatMap((field) => Object.entries(manifest?.[field] ?? {})
    .filter(([, spec]) => !registrySpec(spec)).map(([name, spec]) => ({ field, name, spec })))
}

// Run as a command, also through a linked node_modules path (Node loads the module from its real path).
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  let values
  try {
    ({ values } = parseArgs({ options: { root: { type: "string" }, json: { type: "boolean" } } }))
  } catch (error) {
    console.error(`${error.message}\nUsage: node scripts/dependencies.mjs [--root <package>] [--json]`)
    process.exit(2)
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(resolve(values.root ?? "."), "package.json"), "utf8"))
  } catch (error) {
    console.error(`✗ dependencies: cannot read package.json: ${error.message}`)
    process.exit(2)
  }
  const local = localDependencies(manifest)
  if (values.json) console.log(JSON.stringify({ local }, null, 2))
  else if (!local.length) console.log("✓ dependencies: every dependency comes from the registry.")
  else for (const item of local) console.log(`✗ dependencies: ${item.field} ${item.name} is ${item.spec}; install the published version first`)
  process.exit(local.length ? 1 : 0)
}
