import { basename } from "node:path"
import { suffix } from "./config-helper.mjs"

const words = `notes${suffix}`
const extras = { widthMax: 9, details: { ...{ enabled: true } } }
function graphName() {
  return basename(words).replace(/(?:foo|bar){1,2}/g, "")
}

export default {
  graph: graphName(),
  labels: { sample: `text ${(() => "with interpolation")()}` },
  script: (text) => {
    const match = /agents:\s*\{[^}]+\}/.exec(text)
    return `${match?.[0] ?? "nothing"}:${`${graphName()}`}`
  },
  ...extras,
  // Keep this comment, spacing and every unrelated byte.
}

export const after = { pattern: /[{},`]/, value: `after ${words}` }
