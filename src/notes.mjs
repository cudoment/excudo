// A note the owner keeps up to date in another app (a phone notes app, a shared document) can be
// followed as a `note` source. Only the part between marker lines is read; it is split into blocks,
// and lines that look like credentials or personal numbers are left out. The same function runs in
// the source's page, so the rest of the note never leaves the browser, and here again on what the
// page returned.

/** The default marker: the followed part lies between two lines that hold only this. */
export const NOTE_MARKER = "---"

/**
 * The followed part of a note as `{ markers, blocks: [{ heading, lines }], skipped }`.
 *
 * `input` is the note's text (or `{ text }`), or what this function returned, whose blocks are
 * filtered again. A part runs from a marker line to the next; further markers add a part for each
 * pair, and a marker without a partner opens nothing. A blank line ends a block, and a block's first
 * line is its heading. A line that looks private (a password or code, an account, card, phone or ID
 * number, a license key, a token, an e-mail address, a line of bare digits) is dropped and counted in
 * `skipped`. The function is serialized into the page, so it uses nothing from outside its body.
 */
export function noteRegion(input, marker = "---") {
  const clean = (line) => String(line ?? "").replace(/\u00a0/g, " ").replace(/\s+$/, "").normalize("NFC")
  const privateLine = (line) => {
    // An ssh remote (git@host:path) names a host, not someone's address.
    const text = line.normalize("NFKC").replace(/\b[\w.-]+@[\w.-]+:[\w./~-]+/g, " ")
    if (/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/.test(text)) return true
    if (/비밀\s?번호|비번|패스워드|암호\s*[:：]|인증\s?번호|보안\s?코드|password|passwd|passcode|\b(?:pw|pin|cvc|cvv)\b/i.test(text)) return true
    if (/[?&](?:token|key|secret|password|pw|auth|sig)=/i.test(text)) return true
    // Markdown emphasis and code marks are markup, not part of a word.
    const bare = text.replace(/https?:\/\/\S+/g, " ").replace(/\*\*|__|`/g, " ")
    const digits = bare.replace(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/g, " ").replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
      .replace(/\b(?:19|20)\d\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[-_T]?(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?)?\b/g, " ")
    if (/(?:\d[ -]?){8,}\d/.test(digits)) return true
    if (/^[\d\s.-]+$/.test(digits.trim()) && (digits.match(/\d/g) ?? []).length >= 4) return true
    // A license key: groups in capitals, or groups that carry digits; a name in kebab case is none.
    if ((bare.match(/\b[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){3,}\b/gi) ?? []).some((key) => key === key.toUpperCase() || key.split("-").filter((part) => /\d/.test(part)).length >= 2)) return true
    // A token: a long run of letters and digits; a name joined by hyphens has short parts. A UUID is
    // an id (an outliner's block id) unless the line calls it a key.
    if ((bare.match(/[A-Za-z0-9_-]{20,}/g) ?? []).some((run) => run.split(/[-_]/).some((part) => part.length >= 20 && /\d/.test(part) && /[A-Za-z]/.test(part)))) return true
    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(bare) && /\b(?:api|key|token|secret|license)\b|키|토큰|라이선스|라이센스/i.test(bare)) return true
    // A word that mixes letters, digits and a symbol reads as a password. A package name with a
    // version does not, nor do tags, issue numbers and anchors (#…), paths and code (/ < > = "),
    // entities and percentages.
    return bare.split(/\s+/).some((word) => {
      if (word.startsWith("#") || /[/<>="]/.test(word)) return false
      const plain = word.replace(/&\w+;|\d+(?:\.\d+)?%/g, "")
      return plain.length >= 6 && /\d/.test(plain) && /\p{L}/u.test(plain)
        && (/[!#$%^&*]/.test(plain) || (plain.includes("@") && !/^@?[\w.-]+@[\w.^~*-]+$/.test(plain)))
    })
  }
  let skipped = 0
  const keep = (line) => {
    if (!privateLine(line)) return true
    skipped++
    return false
  }
  if (input && typeof input === "object" && Array.isArray(input.blocks)) {
    skipped = Number(input.skipped) || 0
    const blocks = input.blocks
      .map((block) => [block?.heading, ...(Array.isArray(block?.lines) ? block.lines : [])].map(clean).filter((line) => line.trim()).filter(keep))
      .filter((lines) => lines.length).map(([heading, ...lines]) => ({ heading, lines }))
    return { markers: Number(input.markers) || 0, blocks, skipped }
  }
  const lines = (typeof input === "string" ? input : String(input?.text ?? "")).replace(/\r\n?/g, "\n").split("\n").map(clean)
  const at = lines.flatMap((line, index) => (line.trim() === marker ? [index] : []))
  const blocks = []
  for (let pair = 0; pair + 1 < at.length; pair += 2) {
    let block = null
    for (const line of lines.slice(at[pair] + 1, at[pair + 1])) {
      if (!line.trim()) { block = null; continue }
      if (!keep(line)) continue
      if (block) block.lines.push(line)
      else blocks.push((block = { heading: line, lines: [] }))
    }
  }
  return { markers: at.length, blocks, skipped }
}

/** Whether a line looks private by the rules `noteRegion` drops lines with. */
export function privateLine(line) {
  return noteRegion({ markers: 2, blocks: [{ heading: String(line ?? ""), lines: [] }] }).skipped > 0
}

/** The key a block is followed by: its heading without spacing, case or bullets, and a count for repeats. */
const headingKey = (heading) => heading.normalize("NFC").replace(/^[\s\-–—ㅡㄴ*•·>]+/, "").replace(/\s+/g, " ").trim().toLowerCase()
export function keyedBlocks(blocks) {
  const seen = new Map()
  return blocks.map((block) => {
    const base = headingKey(block.heading)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return [count > 1 ? `${base} #${count}` : base, block]
  })
}

/** What changed between two readings of a note: blocks added and removed, and lines within kept blocks. */
export function noteDiff(before, now) {
  const old = new Map(keyedBlocks(before))
  const current = new Map(keyedBlocks(now))
  const added = [...current].filter(([key]) => !old.has(key)).map(([, block]) => block)
  const removed = [...old].filter(([key]) => !current.has(key)).map(([, block]) => block)
  const changed = [...current].filter(([key, block]) => old.has(key) && JSON.stringify(old.get(key)) !== JSON.stringify(block)).map(([key, block]) => {
    const was = old.get(key)
    return { heading: block.heading, ...(was.heading !== block.heading ? { was: was.heading } : {}),
      added: block.lines.filter((line) => !was.lines.includes(line)), removed: was.lines.filter((line) => !block.lines.includes(line)) }
  })
  return { added, removed, changed }
}
