// The four READMEs (English, Korean, Japanese, Simplified Chinese; the last two are short guides).
export const READMES = ["README.md", "README.ko.md", "README.ja.md", "README.zh-CN.md"]

// The install ranges (`excudo@^x.y.z`) the setup skill and the READMEs carry, and which version each may name.
// The setup skill follows the package version, a prerelease too. The READMEs send new owners to what `latest`
// serves, so while the version is a prerelease they name an earlier stable release, never the prerelease
// and never the stable core it will become (it is not published yet).
export const RANGE = /excudo@\^(\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?)/g

const core = (version) => version.split("-")[0].split(".").map(Number)
const before = (a, b) => {
  const [x, y] = [core(a), core(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

/** Whether `range` is allowed in a file of this kind (`setup` or `readme`) at the package `version`. */
export function rangeAllowed(kind, range, version) {
  if (kind === "setup" || !version.includes("-")) return range === version
  return !range.includes("-") && before(range, version)
}

/** The names among `files` (`[name, text, kind]`) whose ranges are missing or not allowed at `version`. */
export function staleRanges(files, version) {
  return files.filter(([, text, kind]) => {
    const found = [...String(text).matchAll(RANGE)].map((match) => match[1])
    return !found.length || found.some((range) => !rangeAllowed(kind, range, version))
  }).map(([name]) => name)
}

/** What a file of this kind must name, for the message. */
export const expectedRange = (kind, version) => kind === "setup" || !version.includes("-") ? `excudo@^${version}` : `an earlier stable excudo@^x.y.z (not ${version}) in the READMEs`
