#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  activityOutline,
  agentSessions,
  archive,
  backupRecords,
  queueItems,
  queueReport,
  queueSettings,
  recordRun,
  runRecords,
  changes,
  collectActivity,
  fixBlocks,
  markChanges,
  markRequests,
  requests,
  review,
  workspaces,
  keepCandidates,
  listSources,
  move,
  remove,
  rename,
  find,
  idle,
  markMirror,
  mirrorText,
  mirror,
  idleSettled,
  commitSettled,
  withGraph,
  withGraphAsync,
  build,
  check,
  changedGraphFiles,
  commitGraph,
  errorsOf,
  format,
  homeStatus,
  inbox,
  ingest,
  init,
  installSkills,
  instructions,
  instructionsBlockedNotice,
  moveInstructions,
  loadWorkspace,
  LOCALES,
  trackFolders,
  ownHome,
  prepare,
  renderTree,
  sourceScript,
  adoptSkill,
  dismissCandidate,
  lintSkill,
  lintSkills,
  recordMistake,
  retireSkill,
  skillCandidates,
  skillNames,
  skillsStatus,
  upkeepSkills,
  writeExports,
  siteHome,
  writeSite,
  batchesOf,
  receive,
} from "../src/index.mjs"
import { openSite, publishSite, publishStatus, setupSite } from "../src/publish.mjs"
import { pullInbox } from "../src/pull.mjs"
import { saveGraph } from "../src/save.mjs"
import { startReport, startStatus } from "../src/start.mjs"
import { updatePackage } from "../src/update.mjs"
import { openLocalSite } from "../src/open.mjs"
import { feedbackDraft } from "../src/feedback.mjs"
import { agentsStatus, agentSuggestions, agentArgs, setAgent, decideAgentSuggestion } from "../src/agents.mjs"
import { SKILLS_DIR } from "../src/skills.mjs"

const HELP = `excudo — Excudo, the engine of your personal projects: keeps your thoughts in
order under the list you write (Tine, Logseq)

Usage: excudo <command> [options]

Commands
  start             Where you stand: the first steps done and the next one, with its command   --json
                    --report         report every step and where to continue without changing files
  update            Check the registry and show release notes and update commands   --channel latest|next
                    (default: next while a prerelease is installed, else latest)
                    --apply          install the update and refresh workspace skills   --json
  feedback          Prepare an allowlisted diagnostic draft and link; nothing is sent
                    --title <words>  --message <words>  --out <file>   --json
                    --details        include redacted free-form data to review before sending
  init [dir]        Create a workspace (settings, agent skills, and a graph)
                    --locale en|ko   language of generated text (default: en)
                    --graph <name>   graph folder name (default: notes)
                    --example        start from the example memo
  build             Generate the views (Home or Archive) and every node's subtree section
                    --force          overwrite generated text that was edited
  home              Show who writes Home, and what an owner's Home misses   --json
                    --own            write Home yourself; the whole tree moves to the Archive view
  check             Check the node rules      --json  machine-readable output
  instructions      Read AGENTS.md's budget and skill candidates   --json  --limit <bytes>  --check
  instructions move Move a block verbatim into a workspace skill
                    --lines <start>-<end> --to <skill> --reference <name> --pointer <text> (up to twice)
                    --since <commit>  --dry-run  --json
  tree [node]       Print the whole tree, or the part below one node; --path <node>
  review            Suggest cleanup candidates   --json --limit N --node <node>
  review keep <id>  Remember the owner's decision to keep candidates
  move <node> <parent>  Move a node and its descendants
  rename <node> <name>  Rename a node and the links to it; Home's links only with --home
  remove <node>     Remove a node; --force permits open tasks or decisions
  find <term>       Search nodes   --history --json
  inbox             List journal items and pages/ pages that still need a node   --json
  archive [node]    Fold finished items or a finished node into monthly archives   --canceled (only CANCELED items)
  sources           List the outside sources (excudo.config.mjs) and what they delivered   --json
  sources script <name>  Print the JavaScript to run in the source's logged-in page
                    --action <name> --args <json>   one of the source's actions instead
  ingest <name> <file|->  Add the items collected from a source; finished ones are only reported
                    --dry-run        show where items would go; the memo stays unchanged   --json
  changes [name]    Which repo, page and note sources changed since the memo was brought up to date
                    --input <file|-> what a page or note source's script returned   --all   --json
  changes mark <name>...  Record that their nodes are up to date   --input <file|-> for a page or note
                    --expect <token> refuse when the source changed again since it was read
  requests          Requests typed to coding agents since the last mark (conversations setting)
                    --for cleanup|reflect   --candidates   --since <time>   --json
  requests mark     Mark them read   --for cleanup|reflect   --until <time>
  workspaces        Update the branch and window names on the nodes' path lines, and tell
                    the name each app workspace takes from the memo
                    --input <file|-> workspaces from an app   --dry-run   --json
  workspaces untrack <folder>...  Record that the owner does not track these folders in the memo
  workspaces track <folder>...    Track them again
  fix               Give blocks that share an id their own id, or embed the first   --dry-run
  mirror [name]     Keep one list the same in several places (a page's section, an export's kept part, a
                    board page, a note): merge the edits, write pages and files, print what a note should hold
                    --note <source>=<file> (repeatable): a note's marked part as read   --dry-run   --json
  mirror mark [name] --wrote <source>=<file> [--note <source>=<file>]  Record what the workspace wrote to a note
                    (--wrote: the lines it wrote, one per line; --note: the note read again)
  mirror text [name] [source]  Print what a note should hold, to paste between its markers   --copy   --json
  snapshot          Commit your graph edits and review decisions before a tidy-up
                    --only <file> (repeatable): commit those graph files; paths from the workspace or graph,
                    or absolute paths inside the graph; an unknown file is an error
                    --settle N: commit only the edits idle --settle N calls settled   --json
  save <message>    check, build, then commit the graph with <message>   --only <file> (repeatable): commit
                    those graph files and what the build wrote, but no file changed before by someone else
                    Paths may be from the workspace or graph, or absolute inside the graph; unknown files fail
                    --generated: commit only what the build wrote, the same way
  idle              Whether a scheduled run may change the memo now: exit 0 when free, 1 while a
                    command holds it or an uncommitted graph file changed in the last minutes,
                    3 when a page holds the pause line (automation:: paused)   --minutes N   --json
                    --settle N: an edit untouched for N minutes that passes the check is finished
                    (settled), not one in progress, whatever its age; an older one that fails is unsettled
  activity          Read the owner's sessions with coding agents and their commits into the cache
                    (conversations setting), for the views' activity fences   --days N   --json
  activity show     Print the activity a view would show   --days N
  sessions [<node>] Your sessions with coding agents on a node and below it, newest first, each with the
                    command that resumes it in its folder now (moved setting)   --path <folder>   --days N
                    --limit N   --json
  agents            Worker, independent reviewers, local models and recommendations   --json
  agents args <worker|reviewer>  Launch arguments   --index N (zero-based)   --for orca|cli
  agents suggest    Pending model suggestions   --json   --new (mark notified)
  agents accept <id>  Apply an approved suggestion to agents settings
  agents decline <id>  Remember a rejected suggestion
  agents set <worker|reviewer>  Set a role after the owner chooses   --index N (zero-based) --tool --model --effort
  queue             The open tasks tagged for agents (#agent, or the queue setting), each with its
                    node, work folder and decisions; ready or waiting for review   --json
  queue report <key> --summary <words> [--file <report>] [--stamp <stamp>]  Leave an agent's report
                    under the task; with the stamp the task was taken with, refused when a task
                    with the same words may have taken its key
  runs              Scheduled steps, newest first (default: 7 days)   --days N   --json
                    --step <name> (repeatable)   --failed   --deferred (both: either status)
                    Details stop at 160 characters; --full prints them whole
  runs add <step> --status ok|failed|deferred|paused [--since <time>] [--reason <words>]  Record one
  backup <folder>   Write a consistent copy of the cache (records, build protection, watched notes)
  export [name]     Write the files kept from the memo in your format (exports setting); build does too
                    --dry-run        say what would change   --force   replace a file edited by hand   --json
  site              Write the memo as a website with cudoc-export (site setting), outside the graph
                    --out <dir>  --mode site|standalone  --open  open its Home in the browser
                    --dry-run    build it in a temporary folder and say what it holds   --json
  site setup        Once: install what is missing, log in to Vercel, create and link a project, guard
                    every deployment with Vercel Authentication, publish and open   --project <name>
                    With site.inbox it also makes the inbox's private GitHub repository, waits while
                    you keep its token on Vercel (two pages open) and schedules site pull
  site publish      Write the website and put it on Vercel when the host is ready and it changed;
                    exits 75 when the owner has something to do first   --force   publish anyway
  site open         Open the published website, copy its address and print a code for a phone
  site status       Login, project, protection, address, the last publishing and the inbox   --json
  site pull         Bring in the task states chosen on the website (every five minutes; at once when
                    a page asks or with --now), commit the pages, close the issues, publish again
                    --now   --dry-run   --json
  receive --input <file|->  Bring in the task states chosen on the website: a batch, batches, or issues
                    from gh issue list --json number,body   --dry-run   --json
  skills            Install the agent skills into this workspace
                    --global         into ~/.agents/skills, linked from ~/.claude/skills and
                                     ~/.codex/skills for each agent whose folder is there
                    --force          refresh unmodified copies; copies that differ are kept and backed up
                    --replace <name> replace that copy even if it differs, after backing it up (repeatable)
                    --replace-all    the same for every skill
                    --link           link them to the installed engine instead of copying,
                                     so they change with it (a local clone through file:)
                    --copy           copy them again
  skills lint [name|dir]...  Check skills against the skill rule and score their fitness   --json
  skills status     How the learned skills stand (fitness, installation, requests for them)   --json
  skills candidates Recurring requests that could become a skill (conversations setting)   --json
  skills adopt <name>  Put a skill written below the skills folder into use when it fits
                    --from <candidate>   the requests it answers   --requested   the owner asked for it
                    --global         for every folder (~/.agents/skills)   --workspace   for this workspace only
                                     (default: where it is, or the install setting for a new skill)
                    --why <words>    why it belongs in every folder (unless the owner asked for it)
                    --force          replace an installed copy someone edited
  skills dismiss <candidate> --reason <words>  Do not offer this candidate again
  skills mistake <name> --case <case> --why <words>  Record that a known case of a learned skill's
                    check reproduces a mistake the owner pointed out; it must expect fail and the
                    check must fail on it, and lint then keeps it so   --json
  skills retire <name>  Take a learned skill out of use
  skills upkeep     Lint the learned skills again, refresh their installations, count their requests   --json

Options
  --root <dir>      workspace folder (default: nearest folder with excudo.config.mjs)
  --graph <dir>     graph folder, overriding the workspace setting
  -h, --help        show this help`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    index: { type: "string" },
    tool: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    new: { type: "boolean" },
    path: { type: "string" },
    node: { type: "string" },
    limit: { type: "string" },
    check: { type: "boolean" },
    lines: { type: "string" },
    to: { type: "string" },
    reference: { type: "string" },
    pointer: { type: "string", multiple: true },
    history: { type: "boolean" },
    root: { type: "string" },
    graph: { type: "string" },
    locale: { type: "string" },
    example: { type: "boolean" },
    force: { type: "boolean" },
    own: { type: "boolean" },
    home: { type: "boolean" },
    "dry-run": { type: "boolean" },
    action: { type: "string" },
    args: { type: "string" },
    input: { type: "string" },
    note: { type: "string", multiple: true },
    wrote: { type: "string", multiple: true },
    for: { type: "string" },
    candidates: { type: "boolean" },
    since: { type: "string" },
    until: { type: "string" },
    expect: { type: "string" },
    all: { type: "boolean" },
    global: { type: "boolean" },
    replace: { type: "string", multiple: true },
    "replace-all": { type: "boolean" },
    link: { type: "boolean" },
    copy: { type: "boolean" },
    from: { type: "string" },
    requested: { type: "boolean" },
    workspace: { type: "boolean" },
    why: { type: "string" },
    case: { type: "string" },
    reason: { type: "string" },
    minutes: { type: "string" },
    settle: { type: "string" },
    days: { type: "string" },
    step: { type: "string", multiple: true },
    failed: { type: "boolean" },
    deferred: { type: "boolean" },
    full: { type: "boolean" },
    summary: { type: "string" },
    file: { type: "string" },
    stamp: { type: "string" },
    only: { type: "string", multiple: true },
    generated: { type: "boolean" },
    status: { type: "string" },
    out: { type: "string" },
    mode: { type: "string" },
    channel: { type: "string" },
    apply: { type: "boolean" },
    report: { type: "boolean" },
    title: { type: "string" },
    message: { type: "string" },
    details: { type: "boolean" },
    project: { type: "string" },
    open: { type: "boolean" },
    now: { type: "boolean" },
    canceled: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
})
const [command, ...args] = positionals
const COMMANDS = new Set(["feedback", "update", "instructions", "agents", "start", "init", "build", "home", "check", "tree", "review", "move", "remove", "rename", "find", "inbox", "archive", "sources", "ingest",
  "changes", "requests", "workspaces", "fix", "mirror", "snapshot", "save", "export", "site", "skills", "idle", "activity", "sessions", "queue", "runs", "backup", "receive"])

if (!command || values.help) {
  console.log(HELP)
  process.exit(command || values.help ? 0 : 1)
}
if (!COMMANDS.has(command)) {
  console.error(`Unknown command: ${command}\n\n${HELP}`)
  process.exit(1)
}

const printIssues = (ws, issues) => {
  if (!issues.length) return console.log(ws.labels.messages.clean)
  for (const issue of issues) console.log(`${issue.severity === "error" ? "✗" : "!"} [${issue.code}] ${issue.message}`)
}

/** What became of each file written from the memo; a file left alone and tasks still titled by their source are said. */
const printExports = (ws, results, { all = false } = {}) => {
  const m = ws.labels.messages
  for (const item of results) {
    const values = { name: item.name, file: item.file, n: item.items }
    if (all || item.state !== "current") (["edited", "exists"].includes(item.state) ? console.error : console.log)(format(m[`export-${item.state}`], values))
    if (!item.retitle.length) continue
    console.log(format(m["export-retitle"], { name: item.name, n: item.retitle.length }))
    for (const task of item.retitle) console.log(`  ${task.page}:${task.line} ${task.title}`)
  }
}

const printBuild = (ws, result) => {
  for (const issue of result.references.issues) console.log(`${issue.severity === "error" ? "✗" : "!"} ${issue.sourcePath}: ${issue.message}`)
  for (const item of result.repaired ?? []) console.log(item.message)
  for (const file of result.written) console.log(`  ${relative(ws.graphDir, file)}`)
  for (const item of result.blocked) console.error(item.message)
  if (!result.errors.length) {
    console.log(format(ws.labels.messages.built, { nodes: result.nodes, open: result.open, written: result.written.length }))
  }
  printExports(ws, result.exports ?? [])
  if (result.exportError) console.error(format(ws.labels.messages["exports-failed"], { error: result.exportError }))
  if (result.site) printSite(ws, result.site)
  if (result.siteError) console.error(format(ws.labels.messages["site-failed"], { error: result.siteError }))
  return result.errors.length ? 1 : result.blocked.length ? 2 : 0
}

const printSite = (ws, summary, { dryRun = false } = {}) => {
  const m = ws.labels.messages
  console.log(format(m[dryRun ? "site-dry-run" : "site-written"], { pages: summary.pages, out: relative(process.cwd(), summary.out) || "." }))
  for (const item of summary.diagnostics ?? []) console.log(`! ${item.message}`)
  if (summary.omitted?.length) console.log(format(m["site-omitted"], { n: summary.omitted.length, names: summary.omitted.map((item) => item.document ?? item.id ?? item.sourcePath).join(", ") }))
}

async function main() {
  if (command === "init") {
    const result = await init(args[0] ?? ".", { locale: values.locale, graph: values.graph, example: values.example })
    for (const rel of result.created) console.log(`+ ${rel}`)
    for (const rel of result.skipped) console.log(`= ${rel} (exists)`)
    for (const skill of result.skills) console.log(`skill ${skill.name}: ${skill.state}`)
    console.log(`\nNext: cd ${relative(process.cwd(), result.root) || "."} && npm install`)
    return printBuild(await loadWorkspace({ root: result.root }), result.built)
  }

  let ws
  try { ws = await loadWorkspace({ root: values.root, graph: values.graph }) } catch (error) {
    if (!(command === "feedback" || command === "start" && values.report)) throw error
    ws = await loadWorkspace({ root: values.root, graph: values.graph, ignoreConfig: true })
    const code = ["SyntaxError", "TypeError", "ReferenceError", "RangeError"].includes(error.name) ? error.name : "Error"
    ws.configurationFailure = { id: "configuration-load", code, detail: String(error.message) }
  }
  // Where a new owner stands needs no workspace: before one exists it says how to make it.
  if (command === "start") return startCommand(ws)
  if (command === "feedback") {
    const result = feedbackDraft(ws, { title: values.title, message: values.message, out: values.out, details: values.details })
    console.log(values.json ? JSON.stringify(result, null, 2) : `${result.draft}\n${result.url}`)
    return 0
  }
  if (command === "update") {
    const result = await updatePackage(ws, { channel: values.channel, apply: values.apply })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else {
      console.log(result.note)
      for (const warning of result.warnings ?? []) if (warning.note !== result.note) console.log(warning.note)
      if (result.stderr) console.error(result.stderr)
      if (result.skillRefreshOutput) console.log(result.skillRefreshOutput)
      if (result.changelog) console.log(`\n${result.changelog}`)
      else if (result.changelogNote) console.log(result.changelogNote)
      if (result.missingNote) console.log(result.missingNote)
      if (result.releaseUrl) console.log(result.releaseUrl)
      if (result.changelogUrl) console.log(result.changelogUrl)
      if (result.failedCommand) for (const command of [result.failedCommand, ...result.remainingCommands]) console.log(command)
      else if (!result.applied) for (const command of result.commands) console.log(command)
      if (result.followUp?.length) {
        console.log(ws.labels.update["update-checks"])
        for (const command of result.followUp) console.log(command)
      }
    }
    return result.code
  }
  // Without a workspace every command would fail on a missing graph; say what is missing instead.
  // Skills installed into the home folder, and linting skills, need none.
  if (!ws.hasConfig && !(command === "skills" && (values.global || args[0] === "lint"))) {
    const env = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").slice(0, 2)
    throw new Error(format((LOCALES[env] ?? LOCALES.en).messages["workspace-missing"], { dir: ws.root }))
  }

  const printTop = (top) => { if (top) console.log(format(ws.labels.messages["top-status"], top)) }
  switch (command) {
    case "instructions": {
      const m = ws.labels.messages
      if (args.length) {
        if (args[0] !== "move" || args.length !== 1 || values.check || values.limit !== undefined) throw new Error(m["instructions-move-usage"])
        const result = moveInstructions(ws, { lines: values.lines, to: values.to, reference: values.reference, pointer: values.pointer, since: values.since, dryRun: values["dry-run"] })
        if (values.json) console.log(JSON.stringify(result, null, 2))
        else console.log(format(m["instructions-moved"], { ...result, files: result.changed.join(", ") }), result.dryRun ? m["dry-run"] : "")
        return 0
      }
      if (values.lines || values.to || values.reference || values.pointer || values.since || values["dry-run"]) throw new Error(m["instructions-move-usage"])
      const result = instructions(ws, { limit: values.limit })
      if (values.check && !values.json) {
        const blocked = instructionsBlockedNotice(ws, result)
        if (result.aboveTarget) console.log(format(m[result.over ? "instructions-size" : "instructions-target"], { ...result, blocked: blocked ? " " + blocked : "" }))
        else if (blocked) console.log(blocked)
        return result.over ? 1 : 0
      }
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(format(m[result.enabled ? "instructions-status" : "instructions-off"], { ...result,
          state: m[result.over ? "instructions-over" : result.aboveTarget ? "instructions-above" : "instructions-within"] }))
        console.log(format(m["instructions-pinned-size"], result))
        if (result.targetBlocked) console.log(instructionsBlockedNotice(ws, result))
        if (result.lastTrim) console.log(format(m["instructions-growth"], { growth: result.growth, commit: result.lastTrim.commit }))
        if (!result.exists) console.log(m["instructions-missing"])
        for (const item of result.candidates) console.log(format(m["instructions-candidate"], { ...item,
          path: item.headingPath.join(" > ") || result.file, name: item.target.name, reason: item.reason }))
        if (result.enabled && !result.candidates.length) console.log(m["instructions-none"])
      }
      return values.check && result.over ? 1 : 0
    }
    case "agents":
      return agentsCommand(ws)
    case "build":
      return printBuild(ws, build(ws, { force: values.force }))
    case "check": {
      const { issues, top } = await check(ws)
      if (values.json) console.log(JSON.stringify({ issues, top }, null, 2))
      else { printTop(top); printIssues(ws, issues) }
      return errorsOf(issues).length ? 1 : 0
    }
    case "tree":
      console.log(renderTree(ws, { node: args[0], path: values.path }))
      return 0
    case "review": {
      if (args[0] === "keep") {
        if (args.length < 2) throw new Error(format(ws.labels.messages["needs-args"], { command: "review keep", args: "<id>..." }))
        console.log(format(ws.labels.messages["review-kept"], { n: await keepCandidates(ws, args.slice(1)) }))
        return 0
      }
      const limit = values.limit === undefined ? undefined : Number(values.limit)
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error(ws.labels.messages["limit-invalid"])
      const result = await review(ws, { limit, node: values.node })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else {
        console.log(format(ws.labels.messages["review-stats"], result.stats))
        printTop(result.top)
        if (result.notice) console.log(result.notice)
        for (const candidate of result.candidates) console.log(`${candidate.id}\n  ${candidate.path}:${candidate.line} ${candidate.text}\n  ${candidate.evidence}\n  ${candidate.recommendation}`)
      }
      return 0
    }
    case "move": {
      if (args.length !== 2) throw new Error(format(ws.labels.messages["needs-args"], { command: "move", args: "<node> <parent>" }))
      const result = await move(ws, args[0], args[1])
      console.log(`${result.from} → ${result.to}`)
      printTop(result.top)
      return 0
    }
    case "rename": {
      if (args.length !== 2) throw new Error(format(ws.labels.messages["needs-args"], { command: "rename", args: "<node> <name>" }))
      const result = await rename(ws, args[0], args[1], { home: values.home })
      const m = ws.labels.messages
      console.log(`${result.from} → ${result.to}`)
      if (result.links) console.log(format(m["rename-links"], { links: result.links, files: result.files, from: result.previous, to: result.name }))
      for (const line of result.home) console.log(format(m["rename-home"], { line, from: result.previous, to: result.name }))
      if (result.settings.length) console.log(format(m["rename-settings"], { where: result.settings.join(", "), from: result.previous, to: result.name }))
      printTop(result.top)
      return 0
    }
    case "remove": {
      if (!args[0]) throw new Error(format(ws.labels.messages["needs-args"], { command: "remove", args: "<node>" }))
      const result = remove(ws, args[0], { force: values.force })
      for (const link of result.links) console.log(`${link.path}:${link.line}  ${link.text}`)
      return 0
    }
    case "find": {
      const result = find(ws, args.join(" "), { history: values.history })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else for (const hit of [...result.matches, ...result.history]) console.log(`${hit.commit ? hit.commit + " " + hit.date + " " : ""}${hit.path}:${hit.line}  ${hit.text}`)
      return 0
    }
    case "inbox": {
      const items = inbox(ws)
      if (values.json) console.log(JSON.stringify(items, null, 2))
      else if (!items.length) console.log(ws.labels.messages["inbox-empty"])
      else for (const item of items) console.log(`${item.path ?? item.page}:${item.line}  ${item.text}${item.children.map((c) => `\n    - ${c}`).join("")}`)
      return 0
    }
    case "home": {
      if (values.own) {
        const result = ownHome(ws)
        const code = printBuild(ws, result.built)
        console.log(format(ws.labels.messages["home-owned"], { home: result.home, archive: ws.labels.archive }))
        return code
      }
      const status = homeStatus(ws)
      if (values.json) console.log(JSON.stringify(status, null, 2))
      else if (!status.owned) console.log(format(ws.labels.messages["home-status-view"], { view: status.view }))
      else {
        console.log(format(ws.labels.messages["home-status-owned"], { home: status.home, archive: status.archive ?? ws.labels.archive, linked: status.linked.length }))
        if (status.embedded.length) console.log(format(ws.labels.messages["home-status-embedded"], { names: status.embedded.map((item) => item.page).join(", "), n: status.embedded.reduce((sum, item) => sum + item.nodes, 0) }))
        if (status.missing.length) console.log(format(ws.labels.messages["home-status-missing"], { names: status.missing.join(", ") }))
        if (status.outside.length) console.log(format(ws.labels.messages["home-status-outside"], { names: status.outside.join(", ") }))
      }
      return 0
    }
    case "sources": {
      const m = ws.labels.messages
      if (args[0] === "script") {
        if (!args[1]) throw new Error(format(m["needs-args"], { command: "sources script", args: "<name>" }))
        console.log(sourceScript(ws, args[1], { action: values.action, args: values.args }))
        return 0
      }
      const list = listSources(ws)
      if (values.json) console.log(JSON.stringify(list, null, 2))
      else if (!list.length) console.log(m["sources-empty"])
      else for (const source of list) console.log(source.kind === "items"
        ? format(m["source-line"], { ...source, fetched: source.fetchedAt ?? m["source-never"] })
        : format(m["source-watch-line"], { ...source, where: source.path ?? source.url, node: source.node ?? "-", marked: source.markedAt ?? m["source-never"], off: source.enabled ? "" : m["source-off"] }))
      return 0
    }
    case "ingest": {
      const m = ws.labels.messages
      if (args.length !== 2) throw new Error(format(m["needs-args"], { command: "ingest", args: "<source> <file|->" }))
      const input = readFileSync(args[1] === "-" ? 0 : args[1], "utf8")
      const run = () => ingest(ws, args[0], input, { dryRun: values["dry-run"] })
      const result = values["dry-run"] ? run() : withGraph(ws, run)
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
      const where = (places) => places.map((place) => `${place.path}:${place.line}`).join(", ")
      for (const item of result.added) console.log(format(m["ingest-added"], item))
      for (const item of result.settled) console.log(format(m["ingest-settled"], { ...item, place: `${item.path}:${item.line}` }))
      for (const item of result.closed) console.log(format(m["ingest-closed"], { ...item, places: where(item.places) }))
      for (const item of result.gone) console.log(format(m["ingest-gone"], { ...item, places: where(item.places) }))
      console.log(format(m["ingest-summary"], { name: result.source, added: result.added.length, known: result.known, finished: result.finished,
        skipped: result.skipped.length, settled: result.settled.length, closed: result.closed.length, gone: result.gone.length }))
      if (result.dryRun) console.log(m["ingest-dry-run"])
      return 0
    }
    case "changes": {
      const m = ws.labels.messages
      const input = values.input === undefined ? undefined : readFileSync(values.input === "-" ? 0 : values.input, "utf8")
      if (args[0] === "mark") {
        console.log(format(m["changes-marked"], { names: markChanges(ws, args.slice(1), { input, expect: values.expect }).join(", ") }))
        return 0
      }
      const list = changes(ws, { name: args[0], input, all: values.all })
      if (values.json) { console.log(JSON.stringify(list, null, 2)); return 0 }
      const count = (status) => list.filter((item) => item.status === status).length
      for (const item of list) {
        const node = item.node ?? "-"
        const token = item.token ?? "-"
        const d = item.detail ?? {}
        if (item.status === "unmarked") console.log(format(m["changes-unmarked"], { ...item, node }))
        else if (item.kind === "note" && ["new", "changed"].includes(item.status)) console.log(format(m[item.status === "new" ? "changes-note-new" : "changes-note"], { ...item, node, token,
          added: d.added?.length ?? 0, changed: d.changed?.length ?? 0, removed: d.removed?.length ?? 0, skipped: d.skipped ?? 0,
          headings: [...(d.added ?? []).map((block) => `+${block.heading}`), ...(d.changed ?? []).map((block) => `~${block.heading}`), ...(d.removed ?? []).map((block) => `-${block.heading}`)].slice(0, 10).join(", ") || "-" }))
        else if (item.status === "new") console.log(format(m["changes-new"], { ...item, node, token }))
        else if (item.status === "missing") console.log(format(m["changes-missing"], item))
        else if (item.status === "browser") console.log(format(m["changes-browser"], { ...item, node }))
        else if (item.status !== "changed") continue
        else if (item.kind === "page") console.log(format(m["changes-page"], { ...item, node, token, added: d.added?.length ?? "?", removed: d.removed?.length ?? "?",
          titles: [...(d.added ?? []).map((entry) => `+${entry.title || entry.id}`), ...(d.removed ?? []).map((entry) => `-${entry.title || entry.id}`)].slice(0, 10).join(", ") || "-" }))
        else if (d.range !== undefined || d.dirty !== undefined) console.log(format(m[d.edited ? "changes-git-edited" : "changes-git"], { ...item, node, token, commits: d.commits ?? "?", range: d.range ?? "", dirty: d.dirty, branch: d.branch || "-" }))
        else if (d.added) console.log(format(m["changes-folder"], { ...item, node, token, since: item.markedAt ?? "-", added: d.added.count, modified: d.modified.count, removed: d.removed.count,
          files: [...d.added.shown.map((file) => `+${file}`), ...d.modified.shown.map((file) => `~${file}`), ...d.removed.shown.map((file) => `-${file}`)].slice(0, 8).join(", ") || "-" }))
        else console.log(format(m["changes-folder-time"], { ...item, node, token, newer: d.newer, files: d.files, before: d.before ?? "?", since: item.markedAt ?? "-", recent: d.recent.slice(0, 5).join(", ") || "-" }))
      }
      console.log(format(m["changes-summary"], { changed: count("changed"), same: count("same"), fresh: count("new"), browser: count("browser"), missing: count("missing") }))
      return 0
    }
    case "requests": {
      const m = ws.labels.messages
      const purpose = values.for ?? (args[0] === "mark" ? undefined : "cleanup")
      if (args[0] === "mark") {
        if (!purpose) throw new Error(m["requests-for"])
        const until = markRequests(ws, purpose, { until: values.until })
        console.log(format(m["requests-marked"], { until, purpose: ws.labels.purposes[purpose] ?? purpose }))
        return 0
      }
      const result = requests(ws, { purpose, candidates: values.candidates, since: values.since })
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
      console.log(format(m["requests-header"], { n: result.rows.length, since: result.since, purpose: ws.labels.purposes[purpose] ?? purpose, candidates: result.candidates ? m["requests-candidates"] : "" }))
      for (const row of result.rows) {
        const when = new Date(row.ts)
        const pad = (n) => String(n).padStart(2, "0")
        const text = row.text.replace(/\s+/g, " ")
        const short = (value, n) => [...value].length > n ? `${[...value].slice(0, n - 1).join("")}…` : value
        console.log(`${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}  [${row.where}] ${short(text, 200)}`)
        ;(row.pasted ?? []).forEach((paste, i) => console.log(`      [pasted ${i + 1}] ${format(m["requests-pasted"], { chars: paste.chars })}: ${paste.start.replace(/\s+/g, " ")}`))
      }
      if (result.until) console.log(format(m["requests-until"], { purpose, until: result.until }))
      return 0
    }
    case "workspaces": {
      const m = ws.labels.messages
      if (args[0] === "untrack" || args[0] === "track") {
        const folders = trackFolders(ws, args.slice(1), { track: args[0] === "track" })
        console.log(format(m[args[0] === "track" ? "workspaces-tracked" : "workspaces-untracked"], { folders: folders.join(", ") }))
        return 0
      }
      const input = values.input === undefined ? undefined : readFileSync(values.input === "-" ? 0 : values.input, "utf8")
      const result = workspaces(ws, { input, dryRun: values["dry-run"] })
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
      for (const item of result.updated) console.log(format(m["workspaces-updated"], item))
      for (const item of result.gone) console.log(format(m["workspaces-gone"], item))
      for (const item of result.unplaced) console.log(format(m["workspaces-unplaced"], { ...item, name: item.name ? ` (${item.name})` : "" }))
      for (const item of result.conflicts) console.log(format(m["workspaces-conflict"], item))
      for (const item of result.unassigned) console.log(format(m["workspaces-unassigned"], { path: item.path, labels: item.labels.join(", "), nodes: item.nodes.join(", ") }))
      const renames = result.names.filter((item) => item.status === "rename")
      for (const item of renames) console.log(format(m["workspaces-name"], { path: item.path, name: item.name ?? "-", expected: item.expected,
        shared: item.shared ? format(m["workspaces-name-shared"], { nodes: item.nodes.join(", ") }) : "" }))
      for (const item of result.names.filter((item) => item.status === "unnamed")) console.log(format(m["workspaces-unnamed"], { path: item.path, nodes: item.nodes.join(", ") }))
      console.log(format(m["workspaces-summary"], { lines: result.lines, updated: result.updated.length, gone: result.gone.length, unplaced: result.unplaced.length, untracked: result.untracked.length, renames: renames.length }))
      if (result.dryRun) console.log(m["dry-run"])
      return 0
    }
    case "fix": {
      const m = ws.labels.messages
      const result = fixBlocks(ws, { dryRun: values["dry-run"] })
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
      for (const item of result.fixed) console.log(format(m[item.action === "embedded" ? "fix-embedded" : "fix-new-id"], item))
      if (!result.fixed.length) console.log(m["fix-none"])
      if (result.dryRun) console.log(m["dry-run"])
      return 0
    }
    case "archive": {
      const result = await withGraphAsync(ws, () => archive(ws, { node: args[0], canceled: Boolean(values.canceled) }))
      for (const item of result.skipped) console.log(`  = ${item.page}: ${item.text}`)
      console.log(format(ws.labels.messages.archived, { ...result, skipped: result.skipped.length }))
      return 0
    }
    case "mirror": {
      const m = ws.labels.messages
      const notes = {}
      for (const given of values.note ?? []) {
        const at = given.indexOf("=")
        if (at < 1) throw new Error(m["mirror-needs-note"])
        notes[given.slice(0, at)] = JSON.parse(readFileSync(given.slice(at + 1), "utf8"))
      }
      if (args[0] === "text") {
        const result = mirrorText(ws, args[1], args[2], { copy: Boolean(values.copy) })
        if (values.json) console.log(JSON.stringify(result, null, 2))
        else {
          const count = result.lines.filter((line) => line.trim()).length
          if (!result.wanted) console.log(format(m["mirror-text-same"], result))
          if (result.copied) console.log(format(m["mirror-text-copied"], { ...result, count }))
          else {
            if (values.copy) console.log(m["mirror-text-uncopied"])
            console.log(result.lines.join("\n"))
          }
        }
        return 0
      }
      if (args[0] === "mark") {
        const wrote = {}
        for (const given of values.wrote ?? []) {
          const at = given.indexOf("=")
          if (at < 1) throw new Error(m["mirror-needs-note"])
          wrote[given.slice(0, at)] = readFileSync(given.slice(at + 1), "utf8").replace(/\n$/, "").split("\n")
        }
        if (!Object.keys(wrote).length) throw new Error(m["mirror-needs-note"])
        const result = markMirror(ws, args[1], { notes, wrote })
        if (values.json) console.log(JSON.stringify(result, null, 2))
        else console.log(format(m["mirror-marked"], { name: result.name, notes: result.marked.map((item) => item.note).join(", ") }))
        return 0
      }
      const result = mirror(ws, args[0], { notes, dryRun: values["dry-run"] })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else if (result.deferred) console.log(format(m["mirror-deferred"], { name: result.name, why: result.deferred }))
      else console.log(format(m["mirror-done"], { name: result.name, decision: result.decision, wrote: result.wrote?.length ? ` → ${result.wrote.join(", ")}` : "",
        notes: Object.entries(result.notes).filter(([, note]) => note.write).map(([note]) => ` · ${note}`).join("") }))
      return result.deferred ? 75 : 0
    }
    case "snapshot": {
      if (values.settle !== undefined) {
        const settle = Number(values.settle)
        if (!Number.isFinite(settle) || settle < 0) throw new Error(format(ws.labels.messages["needs-args"], { command: "snapshot", args: "--settle <n>" }))
        const result = await commitSettled(ws, { settle })
        if (values.json) console.log(JSON.stringify(result, null, 2))
        else console.log(result.committed.length ? format(ws.labels.messages.committed, { message: ws.labels.snapshot }) : ws.labels.messages["nothing-to-commit"])
        return 0
      }
      const only = values.only?.length ? values.only : undefined
      const state = withGraph(ws, () => commitGraph(ws, ws.labels.snapshot, { includeReview: !only, only }))
      console.log(state === "committed" ? format(ws.labels.messages.committed, { message: ws.labels.snapshot }) : state === "not-git" ? format(ws.labels.messages["not-git"], { dir: ws.graphDir }) : ws.labels.messages["nothing-to-commit"])
      return 0
    }
    case "save": {
      const message = args.join(" ").trim()
      if (!message) throw new Error(ws.labels.messages["save-message"])
      return withGraphAsync(ws, () => save(ws, message, { only: values.only ?? (values.generated ? [] : undefined) }))
    }
    case "receive": {
      const m = ws.labels.messages
      if (!values.input) throw new Error(m["receive-input"])
      let input
      try { input = JSON.parse(readFileSync(values.input === "-" ? 0 : values.input, "utf8")) } catch { throw new Error(m["receive-input"]) }
      const batches = batchesOf(input)
      const result = values["dry-run"] ? receive(ws, batches, { dryRun: true }) : withGraph(ws, () => receive(ws, batches))
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
      for (const batch of result.batches) if (batch.error) console.log(`! ${format(m["receive-batch-error"], batch)}`)
      const count = (status) => result.results.filter((item) => item.status === status).length
      console.log(result.results.length ? format(m["receive-done"], { applied: count("applied"), already: count("already"), uncertain: count("uncertain") }) : m["receive-none"])
      return 0
    }
    case "idle": {
      const m = ws.labels.messages
      const minutes = values.minutes === undefined ? 10 : Number(values.minutes)
      if (!Number.isFinite(minutes) || minutes < 0) throw new Error(format(m["needs-args"], { command: "idle", args: "--minutes <n>" }))
      const settle = values.settle === undefined ? undefined : Number(values.settle)
      if (settle !== undefined && (!Number.isFinite(settle) || settle < 0)) throw new Error(format(m["needs-args"], { command: "idle", args: "--settle <n>" }))
      const result = settle === undefined ? idle(ws, { minutes }) : await idleSettled(ws, { minutes, settle })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else if (result.state === "paused") console.log(format(m["idle-paused"], { line: `${ws.labels.pause.key}:: ${ws.labels.pause.value}`, pages: result.paused.join(", ") }))
      else if (result.state === "busy") console.log(format(m["idle-busy"], { why: [result.locked ? m["idle-locked"] : "",
        result.recent.length ? format(m["idle-recent"], { minutes, files: result.recent.slice(0, 5).map((item) => item.file).join(", ") }) : ""].filter(Boolean).join("; ") }))
      else console.log(m["idle-idle"])
      return { idle: 0, busy: 1, paused: 3 }[result.state]
    }
    case "activity": {
      const days = values.days === undefined ? undefined : Number(values.days)
      if (days !== undefined && (!Number.isInteger(days) || days < 1)) throw new Error(format(ws.labels.messages["needs-args"], { command: "activity", args: "--days <n>" }))
      if (args[0] === "show") { console.log(activityOutline(ws, undefined, `days: ${days ?? 14}`)); return 0 }
      const result = collectActivity(ws, { days })
      if (values.json) console.log(JSON.stringify(result, null, 2))
      else console.log(format(ws.labels.messages["activity-collected"], result))
      return 0
    }
    case "sessions": {
      const m = ws.labels.messages
      const number = (name) => { const value = values[name] === undefined ? undefined : Number(values[name]); if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(format(m["needs-args"], { command: "sessions", args: `--${name} <n>` })); return value }
      const found = agentSessions(ws, { node: args.join(" ") || undefined, path: values.path, days: number("days"), limit: number("limit") })
      if (values.json) { console.log(JSON.stringify(found, null, 2)); return 0 }
      if (!found.length) { console.log(m["sessions-none"]); return 0 }
      const stamp = (time) => new Date(time).toLocaleString("sv-SE").slice(0, 16)
      for (const session of found) {
        console.log([stamp(session.end), session.tool === "codex" ? "Codex" : "Claude", session.where, session.title].filter(Boolean).join(" · "))
        console.log(`  ${session.resume}`)
        const notes = [session.was && format(m["sessions-moved"], session), !session.exists && format(m["sessions-missing"], session), session.store && format(m["sessions-store"], session)].filter(Boolean)
        for (const note of notes) console.log(`  (${note})`)
      }
      return 0
    }
    case "queue": {
      const m = ws.labels.messages
      if (args[0] === "report") {
        if (!args[1]) throw new Error(format(m["needs-args"], { command: "queue report", args: "<key> --summary <words>" }))
        const result = withGraph(ws, () => queueReport(ws, args[1], { summary: values.summary, file: values.file && resolve(values.file), stamp: values.stamp }))
        console.log(format(m["queue-reported"], result))
        return 0
      }
      const items = queueItems(ws)
      if (values.json) { console.log(JSON.stringify({ ...queueSettings(ws), items }, null, 2)); return 0 }
      if (!items.length) console.log(format(m["queue-none"], queueSettings(ws)))
      for (const item of items) console.log(format(m["queue-line"], { ...item, status: ws.labels.status[item.status], folder: item.folder ? `  (${item.folder})` : "" }))
      return 0
    }
    case "runs": {
      const m = ws.labels.messages
      if (args[0] === "add") {
        const id = recordRun(ws, { step: args[1], status: values.status, started: values.since, detail: values.reason })
        console.log(format(m["runs-recorded"], { id, step: args[1], status: values.status }))
        return 0
      }
      const days = values.days === undefined ? 7 : Number(values.days)
      const runs = runRecords(ws, { days, steps: values.step, failed: values.failed, deferred: values.deferred })
      if (values.json) { console.log(JSON.stringify(runs, null, 2)); return 0 }
      if (!runs.length) console.log(format(m["runs-none"], { days }))
      for (const run of runs) {
        const detail = !values.full && [...(run.detail ?? "")].length > 160 ? `${[...run.detail].slice(0, 159).join("")}…` : run.detail
        console.log(`${run.started}  ${run.step}  ${run.status}${detail ? `  ${detail}` : ""}`)
      }
      return 0
    }
    case "backup": {
      if (!args[0]) throw new Error(format(ws.labels.messages["needs-args"], { command: "backup", args: "<folder>" }))
      const written = backupRecords(ws, resolve(args[0]))
      console.log(format(ws.labels.messages["backup-written"], { n: written.length, dir: resolve(args[0]) }))
      return 0
    }
    case "export": {
      const results = writeExports(ws, { only: args[0], dryRun: values["dry-run"], force: values.force })
      if (values.json) console.log(JSON.stringify(results, null, 2))
      else if (!results.length) console.log(ws.labels.messages["exports-none"])
      else printExports(ws, results, { all: true })
      return results.some((item) => ["edited", "exists"].includes(item.state)) ? 2 : 0
    }
    case "site": {
      if (["setup", "publish", "open", "status", "pull"].includes(args[0])) return publishCommand(ws, args[0])
      const summary = writeSite(ws, { out: values.out, mode: values.mode, dryRun: values["dry-run"] })
      if (values.json) console.log(JSON.stringify(summary, null, 2))
      else printSite(ws, summary, { dryRun: values["dry-run"] })
      if (values.open && !values["dry-run"]) openLocalSite(siteHome(ws, summary))
      return 0
    }
    case "skills": {
      if (["lint", "status", "candidates", "adopt", "dismiss", "mistake", "retire", "upkeep"].includes(args[0])) return learnedSkills(ws)
      const link = values.link ? true : values.copy ? false : undefined
      for (const skill of installSkills({ dir: ws.root, global: values.global, force: values.force, replace: values["replace-all"] ? true : values.replace ?? [], link, labels: ws.labels,
        cache: values.global ? undefined : ws.cacheDir, graph: values.global ? undefined : ws.graphDir })) {
        const links = skill.links.map((l) => `${l.tool}: ${l.state}`).join(", ")
        console.log(`${skill.name}: ${skill.state}${links ? ` (${links})` : ""}${skill.state === "exists" ? ` — ${ws.labels.messages["skills-differs"]}` : ""}${skill.reason === "unverified-older" ? ` — ${ws.labels.messages["skills-unverified"]}` : ""}`)
        for (const backup of skill.backups ?? []) console.log(format(ws.labels.messages["skills-backup"], { file: backup.path, backup: backup.backup }))
      }
      return 0
    }
  }
}

/** `start`: the first steps of a new owner, which are done, and the next one (start.mjs). */
function startCommand(ws) {
  // Before a workspace exists its language is the system's.
  const env = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").slice(0, 2)
  const labels = ws.hasConfig ? ws.labels : LOCALES[env] ?? LOCALES.en
  const status = (values.report ? startReport : startStatus)({ ...ws, labels })
  if (values.json) { console.log(JSON.stringify(status, null, 2)); return 0 }
  const words = labels.start
  if (values.report) {
    console.log(words.report)
    if (status.configurationError) console.log(`${labels.feedback.configFailed}: ${status.configurationError.code}`)
    for (const step of status.steps) console.log(`${step.id}: ${step.done === null ? words.unknown : step.done ? words.reportDone : words.reportNotDone}${step.stopped ? ` (${words.reportStopped})` : ""} - ${step.title}`)
    return 0
  }
  const mark = (step) => (step.id === status.next ? "→" : step.done ? "✓" : step.done === null ? "?" : "-")
  console.log(words.heading)
  for (const step of status.steps.filter((item) => item.required)) console.log(`  ${mark(step)} ${step.title}`)
  console.log(words.optionalHead)
  for (const step of status.steps.filter((item) => !item.required)) console.log(`  ${mark(step)} ${step.title}${step.done === null ? ` ${words.unknown}` : ""}`)
  const next = status.steps.find((step) => step.id === status.next)
  if (!next) { console.log(`\n${words.allDone}`); return 0 }
  console.log(`\n${format(words.next, next)} (${next.how})`)
  if (next.setting) console.log(format(words.nextSetting, next))
  if (next.run) console.log(format(words.nextRun, next))
  if (next.ask) console.log(format(words.nextAsk, next))
  if (next.link) console.log(format(words.nextLink, next))
  return 0
}

/** `site setup | publish | open | status | pull`: the website on a host, opened from there, and the changes chosen on it brought in (publish.mjs, pull.mjs). */
async function publishCommand(ws, action) {
  const say = (line) => console.log(line)
  // Each action takes its own options; another one (a --dry-run above all) stops it before anything runs.
  const allowed = { setup: ["project"], publish: ["force"], open: [], status: ["json"], pull: ["now", "dry-run", "json"] }[action]
  const given = Object.keys(values).filter((name) => values[name] !== undefined && !["root", "graph"].includes(name))
  const stray = given.find((name) => !allowed.includes(name))
  if (stray) {
    console.error(format(ws.labels.messages["site-option-invalid"], { option: `--${stray}`, action, allowed: allowed.map((name) => `--${name}`).join(", ") || "-" }))
    return 2
  }
  if (action === "setup") return (await setupSite(ws, { project: values.project, say })).code
  if (action === "publish") return publishSite(ws, { force: values.force, say }).code
  if (action === "open") return openSite(ws, { say }).code
  if (action === "pull") {
    const result = await pullInbox(ws, { now: values.now, dryRun: values["dry-run"], say: values.json ? () => {} : say })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    return result.code
  }
  if (values.json) { console.log(JSON.stringify(publishStatus(ws), null, 2)); return 0 }
  const words = ws.labels.publish.status
  publishStatus(ws, {
    onCached: (status) => {
      const rows = [
        [words.address, status.url ?? words.none],
        [words.last, status.at ? `${status.at.slice(0, 16).replace("T", " ")} ${status.deployment ?? ""}`.trim() : "-"],
      ]
      if (status.inbox) rows.push(
        [words.inbox, status.inbox.repo ?? `${words.none} (${words.setup})`],
        [words.tokenAt, status.inbox.tokenAt ? new Date(status.inbox.tokenAt).toISOString() : "-"],
        [words.schedule, words[status.inbox.schedule] ?? status.inbox.schedule])
      rows.push(
        [words.host, `${status.host}${status.cli ? "" : ` (${words.setup})`}`],
        [words.project, status.project ? `${status.project.name} (${status.project.id})` : `${words.none} (${words.setup})`],
        [words.dir, status.dir])
      for (const [label, value] of rows) console.log(`${label}: ${value}`)
    },
    onLive: (field, value, { reachable }) => {
      const shown = !reachable ? words.unreachable : field === "login" ? value ?? `${words.none} (${words.setup})`
        : field === "protection" ? value === "all" ? words.all : value ? `${value} (${words.setup})` : "-"
          : value === null ? "-" : value ? words.yes : `${words.no} (${words.setup})`
      console.log(`${words[field]}: ${shown}`)
    },
  })
  return 0
}

/**
 * check, build, then commit; the caller holds the graph lock. With `only`, those graph files and what
 * the build wrote, except a file someone else had changed before it: that one waits for its own commit.
 */
async function save(ws, message, { only } = {}) {
  const result = await saveGraph(ws, message, { only, force: values.force })
  if (result.top) console.log(format(ws.labels.messages["top-status"], result.top))
  if (result.errors.length) {
    printIssues(ws, result.errors)
    console.error(ws.labels.messages["save-blocked"])
    return 1
  }
  // What should not reach git is said here too, where every change passes, without stopping it.
  if (result.loud.length) printIssues(ws, result.loud)
  const code = printBuild(ws, result.built)
  if (code) return code
  const state = result.state
  console.log(state === "committed" ? format(ws.labels.messages.committed, { message }) : state === "not-git" ? format(ws.labels.messages["not-git"], { dir: ws.graphDir }) : ws.labels.messages["nothing-to-commit"])
  return 0
}

function learnedSkills(ws) {
  const m = ws.labels.messages
  const [action, ...rest] = args
  const printLint = (results) => {
    for (const result of results) {
      console.log(format(m["skills-lint-result"], { ...result, verdict: m[result.ok ? "skills-lint-ok" : "skills-lint-fail"] }))
      for (const item of result.checks.filter((check) => !check.ok)) console.log(`  ✗ ${item.id}: ${item.message}`)
    }
  }
  if (action === "lint") {
    const results = ws.hasConfig ? lintSkills(ws, rest)
      : (rest.length ? rest : skillNames()).map((target) => lintSkill(skillNames().includes(target) ? join(SKILLS_DIR, target) : resolve(target), { labels: ws.labels }))
    if (values.json) console.log(JSON.stringify(results, null, 2))
    else printLint(results)
    return results.every((result) => result.ok) ? 0 : 1
  }
  if (action === "candidates") {
    const result = skillCandidates(ws)
    if (values.json) { console.log(JSON.stringify(result, null, 2)); return 0 }
    if (!result.candidates.length) console.log(m["skills-candidates-none"])
    for (const item of result.candidates) {
      console.log(format(m["skills-candidate-line"], { ...item, first: item.first.slice(0, 10), last: item.last.slice(0, 10), places: item.places.join(", "),
        covered: item.covered.length ? format(m["skills-candidate-covered"], { names: item.covered.join(", ") }) : "" }))
      for (const request of item.requests) console.log(`    ${request.ts.slice(0, 10)} [${request.where}] ${request.text.replace(/\s+/g, " ").slice(0, 160)}`)
    }
    return 0
  }
  if (action === "adopt") {
    if (!rest[0]) throw new Error(format(m["needs-args"], { command: "skills adopt", args: "<name>" }))
    if (values.global && values.workspace) throw new Error(m["skills-scope-both"])
    const scope = values.global ? "global" : values.workspace ? "workspace" : undefined
    const result = adoptSkill(ws, rest[0], { from: values.from, requested: values.requested, install: scope, why: values.why, force: values.force })
    if (values.json) { console.log(JSON.stringify(result, null, 2)); return result.status === "active" ? 0 : 1 }
    if (result.status === "active") console.log(format(m["skills-adopted"], { ...result, where: m[`skills-scope-${result.install}`] }))
    else { console.log(format(m["skills-drafted"], { ...result, min: result.minScore })); printLint([result.lint]) }
    if (result.reason) console.log(result.reason)
    else if (result.left) console.log(format(m["skills-left-edited"], result))
    return result.status === "active" ? 0 : 1
  }
  if (action === "dismiss") {
    if (!rest[0]) throw new Error(format(m["needs-args"], { command: "skills dismiss", args: "<candidate> --reason <words>" }))
    console.log(format(m["skills-dismissed"], dismissCandidate(ws, rest[0], { reason: values.reason })))
    return 0
  }
  if (action === "mistake") {
    if (!rest[0] || values.case === undefined) throw new Error(format(m["needs-args"], { command: "skills mistake", args: "<name> --case <case> --why <words>" }))
    const result = recordMistake(ws, rest[0], { case: values.case, why: values.why })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else console.log(format(m["skills-mistake-recorded"], result))
    return 0
  }
  if (action === "retire") {
    if (!rest[0]) throw new Error(format(m["needs-args"], { command: "skills retire", args: "<name>" }))
    const result = retireSkill(ws, rest[0])
    console.log(format(m[result.state === "edited" ? "skills-retired-kept" : "skills-retired"], result))
    if (result.reason) console.log(result.reason)
    return 0
  }
  const result = action === "upkeep" ? upkeepSkills(ws) : skillsStatus(ws)
  const code = action === "upkeep" && result.skills.some((item) => item.kept && item.state === "held" && !item.fit) ? 1 : 0
  if (values.json) { console.log(JSON.stringify(result, null, 2)); return code }
  if (!result.skills.length) console.log(m["skills-none"])
  for (const item of result.skills) {
    // A skill kept in the workspace is read only there; say so when its work is asked for elsewhere.
    const astray = item.install === "workspace" && item.typed && item.typed.elsewhere > item.typed.here
    console.log(format(m["skills-status-line"], { ...item, where: m[`skills-scope-${item.install}`], dormant: item.dormant ? m["skills-dormant"] : "", matched: item.matched ? format(m["skills-matched"], { n: item.matched }) : "",
      typed: astray ? format(m["skills-typed-elsewhere"], { elsewhere: item.typed.elsewhere, total: item.typed.here + item.typed.elsewhere }) : "",
      mistakes: item.mistakes ? format(m["skills-mistakes"], { n: item.mistakes }) : "",
      runs: item.runs?.sessions ? format(m["skills-runs"], item.runs) : "", failing: item.failing ? m["skills-failing"] : "" }))
    if (item.kept && item.state === "held" && !item.fit) console.log(`  ! ${m["skills-kept-held"]}`)
    if (item.reason) console.log(`  ! ${item.reason}`)
    for (const problem of item.problems) console.log(`  ✗ ${problem}`)
  }
  if (result.unregistered.length) console.log(format(m["skills-unregistered"], { names: result.unregistered.join(", ") }))
  if (result.candidates) console.log(format(m["skills-candidates-waiting"], { n: result.candidates }))
  return code
}

// Set the exit code instead of exiting: output to a pipe is written asynchronously, and exiting at
// once would cut a long JSON answer short.
main().then(
  (code) => { process.exitCode = code },
  (error) => {
    console.error(error.message)
    process.exitCode = 1
  },
)

function agentsCommand(ws) {
  const m = ws.labels.agents
  const index = values.index === undefined ? 0 : Number(values.index)
  const sub = args[0]
  if (sub === "args") {
    const result = agentArgs(ws, args[1], { index, target: values.for ?? "orca" })
    console.log(result.args)
    for (const item of result.suggestions) console.error(`${m.pending} excudo agents accept ${item.id}`)
    return 0
  }
  if (sub === "set") {
    if (!values.tool || values.model === undefined || values.effort === undefined) throw new Error(`${m.invalid}: --tool --model --effort`)
    setAgent(ws, args[1], { tool: values.tool, model: values.model, effort: values.effort }, { index })
    console.log(m.saved)
    return 0
  }
  if (["accept", "decline"].includes(sub)) {
    decideAgentSuggestion(ws, args[1], sub === "accept" ? "accepted" : "declined")
    console.log(m[sub === "accept" ? "accepted" : "declined"])
    return 0
  }
  const printSuggestions = (items) => {
    console.log(m.suggestions)
    if (!items.length) console.log(`  ${m.none}`)
    for (const item of items) console.log(`  ${item.id} ${m[item.role]}${item.index === null ? "" : ` ${item.index + 1}`}: ${item.from} → ${item.model} (${m[item.reason]})`)
  }
  if (sub === "suggest") {
    const result = agentSuggestions(ws, { fresh: values.new })
    if (values.json) console.log(JSON.stringify(result, null, 2))
    else printSuggestions(result)
    return 0
  }
  if (sub) throw new Error(`${m.invalid}: ${sub}`)
  const status = agentsStatus(ws)
  if (values.json) { console.log(JSON.stringify(status, null, 2)); return 0 }
  console.log(`${m.heading}\n${m.estimated}\n${m.indexes}`)
  for (const role of status.roles) {
    const name = `${m[role.role]}${role.index === null ? "" : ` ${role.index + 1}`}`
    if (role.tool.value === null) {
      const command = `excudo agents set ${role.role}${role.index === null ? "" : ` --index ${role.index}`}`
      console.log(`${name}: ${m.unset} (${format(m.setRole, { command })})`)
      continue
    }
    const field = (key) => `${m[key]} ${role[key].value === null ? m[role[key].source] : `${role[key].value}(${m[role[key].source]})`}`
    console.log(`${name}: ${m.tool} ${role.tool.value} · ${field("model")} · ${field("effort")}${role.top ? ` · ${m[role.userSelectedTop ? "selectedTop" : "top"]}` : ""}`)
  }
  console.log(m.catalogs)
  for (const [tool, catalog] of Object.entries(status.catalogs)) {
    console.log(`  ${tool} (${m[catalog.installed ? "installed" : "absent"]}): ${catalog.models.map((item) => `${item.slug} [${item.efforts.join(", ")}]`).join("; ") || m.noModels}`)
  }
  console.log(m.recommendations)
  for (const [role, settings] of [["worker", status.recommendations.worker], ...status.recommendations.reviewers.map((item) => ["reviewer", item])]) console.log(`  ${m[role]}: ${settings.tool} ${settings.model ?? m.unset} ${settings.effort ?? m.unset}`)
  printSuggestions(status.suggestions)
  return 0
}
