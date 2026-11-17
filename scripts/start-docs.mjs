#!/usr/bin/env node
// Writes the README's start section from the first steps the engine keeps (src/start.mjs), in English
// and Korean, between the marker lines. With --check it writes nothing and fails when a README differs,
// which test/start.test.mjs does too: a change to the first steps updates the READMEs with it.
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { LOCALES } from "../src/labels.mjs"
import { startMarkdown } from "../src/start.mjs"

export const START_BEGIN = "<!-- excudo:start (written by npm run start-docs from src/start.mjs) -->"
export const START_END = "<!-- /excudo:start -->"
export const READMES = { en: new URL("../README.md", import.meta.url), ko: new URL("../README.ko.md", import.meta.url) }

/** A README with its start section written again; throws when the marker lines are missing. */
export function withStartSection(text, locale) {
  const begin = text.indexOf(START_BEGIN), end = text.indexOf(START_END)
  if (begin < 0 || end < begin) throw new Error(`the start section's marker lines are missing (${START_BEGIN} … ${START_END})`)
  return `${text.slice(0, begin + START_BEGIN.length)}\n${startMarkdown(LOCALES[locale])}${text.slice(end)}`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import("node:fs")).realpathSync(process.argv[1])) {
  const check = process.argv.includes("--check")
  let stale = 0
  for (const [locale, url] of Object.entries(READMES)) {
    const text = readFileSync(url, "utf8")
    const next = withStartSection(text, locale)
    if (next === text) continue
    stale++
    if (check) console.error(`${fileURLToPath(url)}: the start section differs from src/start.mjs; run npm run start-docs`)
    else { writeFileSync(url, next); console.log(`wrote the start section of ${fileURLToPath(url)}`) }
  }
  process.exit(check && stale ? 1 : 0)
}
