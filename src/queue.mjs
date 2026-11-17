// Work the owner hands to agents. An open task anywhere in the memo that carries the queue tag
// (`#agent`, `#에이전트` in Korean, or the `queue.tag` setting) is queued. A run takes each ready task
// to an agent that reads and reports; the report comes back as a waiting line at the end of the task
// (`WAITING Review: …`, with a link to the report), and the owner decides what happens next. A line
// the owner writes below the report makes the task ready again, so the next run follows it up.
// Nothing in the queue is marked done by an agent: done stays the owner's to say.
//
// Each task carries what an agent needs to choose as the owner would: the node it is in and the
// node's summary, the work folder named by the node's path line or the nearest one above, the
// decisions (`Decision:` lines) of that node and those above it, and the lines already below it.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { prepare } from "./build.mjs"
import { walkGraph } from "./check.mjs"
import { authoredText, blocksOf, DECISION, taskLines } from "./dialects/logseq.mjs"
import { writeAtomic } from "./files.mjs"
import { heldPath } from "./git.mjs"
import { format, LOCALES } from "./labels.mjs"
import { privateLine } from "./notes.mjs"
import { pageOf, plain, ROOT } from "./tree.mjs"
import { pathLines } from "./workspaces.mjs"

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// A report line in any language: the owner may have switched the locale since it was written.
const REVIEW = new RegExp(`^WAITING\\s+(?:${[...new Set(Object.values(LOCALES).map((labels) => labels.queue.review))].map(escape).join("|")})\\s*:`)
const QUEUED = /^(TODO|DOING|NOW|LATER)(\s|$)/
const MARKER = /^(TODO|DOING|NOW|LATER|WAITING)(\s|$)/
const CLOSED = /^(DONE|CANCELED|CANCELLED)(\s|$)/
const DECISIONS = 12
const NOTES = 20
const SUMMARY = 200

/** The queue setting with its defaults: the tag that queues a task, and how many tasks one run takes. */
export function queueSettings(ws) {
  const given = ws.queue ?? {}
  const tag = given.tag ?? ws.labels.queue.tag
  const limit = given.limit ?? 2
  if (typeof given !== "object" || typeof tag !== "string" || !/^[^\s#[\]]+$/u.test(tag) || !Number.isInteger(limit) || limit < 1)
    throw new Error(ws.labels.messages["queue-invalid"])
  return { tag, limit }
}

const bullet = (line) => line.replace(/^\s*-\s+/, "").trim()
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 10)
const keyOf = (file, title) => `q-${digest(`${file}\n${title}`)}`
// How many open tasks in the file share the words of the task a stamp was made for.
const twinsOf = (stamp) => Number(String(stamp).split("-")[0]) || 1

/**
 * The queued tasks, in the order of the memo's files: `{ key, status, file, line, task, title, node,
 * summary, folder, decisions, notes, report, stamp }`. `status` is "ready" (nothing reported yet, or
 * the owner wrote below the last report) or "waiting" (a report waits for the owner). Tasks with the
 * same words are separate tasks: the second open one in a file gets a key of its own, and `stamp`
 * tells whether the task under a key is still the one that was taken. `notes` are the newest lines
 * below the task, so the last report and the answers after it are always there; a task nested in it
 * keeps its own lines and reports. `report` is the file the last report links to.
 */
export function queueItems(ws, { prepared } = {}) {
  const { tag } = queueSettings(ws)
  const tagged = new RegExp(`(?:^|\\s)#(?:\\[\\[${escape(tag)}\\]\\]|${escape(tag)})(?=\\s|$|[.,!?])|\\[\\[${escape(tag)}\\]\\]`, "u")
  const { model } = prepared ?? prepare(ws)
  const docs = new Map([...model.docs.values()].map((doc) => [doc.sourcePath.normalize("NFC"), doc]))
  const folders = new Map()
  for (const line of pathLines(ws, { model })) if (!folders.has(line.node)) folders.set(line.node, line.path)
  const above = (id) => { const chain = []; for (let at = id; at && at !== ROOT; at = model.parentOf(at)) chain.push(at); return chain }
  const items = []
  for (const page of walkGraph(ws).pages) {
    const seen = new Map()
    const text = readFileSync(page.path, "utf8")
    const lines = text.split("\n")
    const tasks = taskLines(text, ws.labels.region)
    const authored = authoredText(text, ws.labels.region).split("\n")
    // Closed tasks too: a nested task the owner finished keeps its report to itself.
    const nests = [...tasks, ...blocksOf(authored, 0, authored.length).filter((block) => CLOSED.test(block.text)).map((block) => ({ line: block.start + 1, end: block.end }))]
    // Every open task counts, tagged or not, so a twin left alone or untagged does not shift the others.
    const titles = tasks.map((task) => task.text.replace(MARKER, "").replace(tagged, " ").replace(/\s+/g, " ").trim())
    const twins = new Map()
    for (const title of titles) twins.set(title, (twins.get(title) ?? 0) + 1)
    for (const [index, task] of tasks.entries()) {
      const title = titles[index]
      const repeat = (seen.get(title) ?? 0) + 1
      seen.set(title, repeat)
      if (!QUEUED.test(task.text) || !tagged.test(task.text)) continue
      const own = new Set(task.ownLines)
      // The lines below a task nested in this one are that task's: its notes, reports and answers.
      const inner = new Set(nests.filter((other) => other.line > task.line && other.end <= task.end)
        .flatMap((other) => Array.from({ length: other.end - other.line }, (_, i) => other.line + i)))
      const children = lines.slice(task.line, task.end).map((line, i) => ({ line, at: task.line + i }))
        .filter((child) => !own.has(child.at) && !inner.has(child.at) && child.line.trim())
      // A report waits for the owner until they write below it; a property line the outliner adds is no answer.
      const last = children.findLastIndex((child) => REVIEW.test(bullet(child.line)))
      const status = last >= 0 && children.slice(last + 1).every((child) => /^\s*[a-z-]+::/.test(child.line)) ? "waiting" : "ready"
      const link = last >= 0 ? bullet(children[last].line).match(/\]\((file:\/\/[^)\s]+)\)/)?.[1] : undefined
      let report = null
      if (link) try { report = fileURLToPath(link) } catch {}
      const doc = docs.get(page.rel)
      const chain = doc ? above(doc.id) : []
      const folder = chain.map((id) => folders.get(id)).find(Boolean) ?? null
      const decisions = chain.flatMap((id) => authoredText(model.docs.get(id).source.text, ws.labels.region).split("\n")
        .filter((line) => DECISION.test(line)).map(bullet)).slice(0, DECISIONS)
      const paragraph = doc?.tree.children[1]
      items.push({ key: keyOf(page.rel, repeat > 1 ? `${title}\n${repeat}` : title), status, file: page.rel, line: task.line, task: task.text, title,
        node: doc ? pageOf(doc.id) : null, summary: paragraph?.type === "paragraph" ? plain(paragraph) : null, folder, decisions,
        notes: children.slice(-NOTES).map((child) => bullet(child.line)), report,
        stamp: `${twins.get(title)}-${digest([task.text, ...children.map((child) => child.line)].join("\n"))}` })
    }
  }
  return items
}

/**
 * Writes an agent's report under the queued task `key`: a waiting line at the end of the task with
 * `summary` and, when given, a link to the report file `file`. Returns where it was written. Given the
 * `stamp` the task had when it was taken, a task whose file holds another with the same words (then
 * or now) must be unchanged, since its key may have passed to the other one.
 */
export function queueReport(ws, key, { summary, file, stamp } = {}) {
  const m = ws.labels.messages
  const item = queueItems(ws).find((each) => each.key === key)
  if (!item) throw new Error(format(m["queue-unknown"], { key }))
  if (stamp && stamp !== item.stamp && (twinsOf(stamp) > 1 || twinsOf(item.stamp) > 1)) throw new Error(format(m["queue-changed"], { key }))
  const words = String(summary ?? "").replace(/\s+/g, " ").trim()
  if (!words) throw new Error(m["queue-summary"])
  // The report stays outside the memo; the line in it must not carry what looks private.
  if (privateLine(words)) throw new Error(m["queue-private"])
  const short = [...words].length > SUMMARY ? `${[...words].slice(0, SUMMARY - 1).join("").trimEnd()}…` : words
  const path = join(ws.graphDir, item.file)
  // A page someone else is changing (held by a scheduled run) takes no report now; the next run writes it.
  if (heldPath(ws, path)) throw new Error(format(m["queue-held"], { key, file: item.file }))
  const lines = readFileSync(path, "utf8").split("\n")
  const task = taskLines(lines.join("\n"), ws.labels.region).find((each) => each.line === item.line)
  const indent = `${lines[item.line - 1].match(/^(\s*)-/)?.[1] ?? ""}\t`
  const link = file ? ` [${ws.labels.queue.report}](${pathToFileURL(file).href})` : ""
  lines.splice(task.end, 0, `${indent}- WAITING ${ws.labels.queue.review}: ${short}${link}`)
  writeAtomic(path, lines.join("\n"))
  return { key, file: item.file, line: task.end + 1 }
}
