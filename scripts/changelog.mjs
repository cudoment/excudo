#!/usr/bin/env node
// Generate release notes from commit subjects; --since excludes the named commit.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

export function groupSubjects(subjects) {
  const groups = new Map()
  for (const subject of subjects) {
    const parsed = subject.match(/^([A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*){0,2}):\s+(.+)$/)
    const match = parsed && parsed[1].length <= 24 ? parsed : null
    const [area, summary] = match ? [match[1].trim(), match[2].trim()] : ["Other", subject.trim()]
    if (!summary) continue
    if (!groups.has(area)) groups.set(area, new Set())
    groups.get(area).add(summary)
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([area, summaries]) => ({ area, summaries: [...summaries] }))
}

export function releaseSection(version, subjects) {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) throw new Error("Use a semantic version for --write")
  const groups = groupSubjects(subjects)
  return [`## ${version}`, "", ...groups.flatMap(({ area, summaries }) => [`### ${area}`, "",
    ...summaries.map((summary) => `- ${summary}`), ""])].join("\n").trimEnd() + "\n"
}

/** Replace the version's section before prepending: retries never duplicate it. */
export function prependRelease(text, version, subjects) {
  const lines = text.split("\n")
  const begin = lines.findIndex((line) => line === `## ${version}`)
  if (begin >= 0) {
    const next = lines.findIndex((line, index) => index > begin && /^## /.test(line))
    lines.splice(begin, (next < 0 ? lines.length : next) - begin)
  }
  const rest = lines.join("\n").replace(/^# Changelog\s*/, "").trim()
  return `# Changelog\n\n${releaseSection(version, subjects)}${rest ? `\n${rest}\n` : ""}`
}

/** The newest `count` release sections, whole, for the notes a published package carries. */
export function recentSections(text, count = 10) {
  const lines = text.replace(/^# Changelog\s*/, "").split("\n")
  const starts = lines.flatMap((line, index) => /^## /.test(line) ? [index] : [])
  if (!starts.length) return ""
  return lines.slice(starts[0], starts[count] ?? lines.length).join("\n").trim() + "\n"
}

export function commitSubjects(root, since) {
  const result = spawnSync("git", ["log", "--format=%s", ...(since ? [`${since}..HEAD`] : ["HEAD"]), "--"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "Cannot read commit subjects")
  return result.stdout.trim().split("\n").filter(Boolean)
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { since: { type: "string" }, write: { type: "string" } } })
    const subjects = commitSubjects(process.cwd(), values.since)
    if (values.write) {
      const file = resolve("CHANGELOG.md")
      const before = existsSync(file) ? readFileSync(file, "utf8") : ""
      const after = prependRelease(before, values.write, subjects)
      if (before !== after) writeFileSync(file, after)
      const manifestFile = resolve("package.json")
      if (existsSync(manifestFile)) {
        const beforeManifest = readFileSync(manifestFile, "utf8")
        const manifest = JSON.parse(beforeManifest)
        manifest.excudoReleaseNotes = { version: values.write, markdown: recentSections(after) }
        const afterManifest = JSON.stringify(manifest, null, 2) + "\n"
        if (beforeManifest !== afterManifest) writeFileSync(manifestFile, afterManifest)
      }
      console.log(`CHANGELOG.md: ${values.write}`)
    } else console.log(releaseSection(JSON.parse(readFileSync(resolve("package.json"), "utf8")).version, subjects))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
