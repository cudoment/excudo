// The owner's review decisions, kept in review.json next to the graph so they travel with it in git:
// candidates they chose to keep (for `keepDays`) and folders they do not track in the memo.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { authoredText, meaningfulText } from "./dialects/logseq.mjs"
import { writeAtomic } from "./files.mjs"
import { plain } from "./tree.mjs"

export const REVIEW_FILE = "review.json"
export const hash = (value) => createHash("sha256").update(value.normalize("NFC")).digest("hex").slice(0, 16)

export function readDecisions(ws) {
  const path = join(ws.root, REVIEW_FILE)
  const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  return { ...record, kept: record.kept ?? {} }
}
export const writeDecisions = (ws, record) => writeAtomic(join(ws.root, REVIEW_FILE), `${JSON.stringify(record, null, 2)}\n`)

/** Whether a keep decision recorded under `id` still holds at `now`. */
export function keptAt(ws, record, now) {
  return (id) => Boolean(record.kept[id]) && now.getTime() - new Date(record.kept[id].at).getTime() < ws.keepDays * 86400000
}

// A node question is identified by the node's own text; a summary question also by its children's
// text, so a keep holds until the summary or the subtree changes. Knowledge nodes below (`isKnowledge`)
// are left out: agents update them from their sources, and they never make a summary outdated
// (behindSummaries), so their updates must not reopen a summary the owner kept. Review and check
// share these.
export const nodeSubject = (ws, doc) => meaningfulText(doc.source?.text ?? "", ws.labels.region)
export const subtreeFingerprint = (ws, model, doc, isKnowledge = () => false) =>
  JSON.stringify(model.nodes.filter((child) => child.id.startsWith(doc.id + "/") && !isKnowledge(child.id))
    .map((child) => meaningfulText(child.source.text, ws.labels.region)))
export const reasonId = (node, kind, subject, text, fingerprint = "") => `${node}:${kind}:${hash(`${subject}\n${text}\n${fingerprint}`)}`
export const questionId = (node, scope, key, fingerprints = "") => `${node}:${scope}:${hash(key + fingerprints)}`
/** The id an earlier version gave a reason; a keep recorded under it still holds when it names one question. */
export const legacyReasonId = (ws, doc, kind, text, fingerprint = "", line = false) =>
  `${doc.id.normalize("NFC")}:${kind}:${hash(`${text}\n${fingerprint}\n${line ? "" : authoredText(doc.source?.text ?? "", ws.labels.region)}`)}`

/**
 * Whether the owner kept a node's outdated summary: its review question, or that reason, is kept.
 * A keep recorded while knowledge nodes still counted in the fingerprint holds as well.
 */
export function summaryKept(ws, model, record, now, isKnowledge = () => false) {
  const kept = keptAt(ws, record, now)
  return (id) => {
    const doc = model.docs.get(id)
    if (!doc) return false
    const node = doc.id.normalize("NFC")
    const subject = nodeSubject(ws, doc)
    const text = plain(doc.tree.children[1] ?? { children: [] })
    const fingerprints = new Set([subtreeFingerprint(ws, model, doc, isKnowledge), subtreeFingerprint(ws, model, doc)])
    return [...fingerprints].some((fingerprint) => kept(questionId(node, "node", `${node}|node|${subject}`, fingerprint))
      || kept(reasonId(node, "summary-behind", subject, text, fingerprint))
      || kept(legacyReasonId(ws, doc, "summary-behind", text, fingerprint)))
  }
}
