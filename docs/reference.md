# Reference

[README](../README.md) | English | [한국어](reference.ko.md)

## Commands

Run `npx --no-install excudo <command>` in the workspace. Root selection is explicit
`--root`, then the nearest ancestor `excudo.config.mjs`, then `EXCUDO_ROOT`. Without a
workspace, `start`, `feedback` and `update` (without `--apply`) still run; every other command but `init` and `skills --global` stops and says so.

| Command | Behavior |
| --- | --- |
| `--version`, `-v` | Print the installed version and exit; runs inside or outside a workspace |
| `start [--json]` | Where you stand: the first steps done on this computer and the next one, with its command; runs without a workspace too |
| `start --report [--json]` | List every first step as done or not done, and where to continue, without changing any file |
| `update [--channel latest\|next] [--apply] [--json]` | Check the registry (an installed prerelease follows `next`) and show release notes and commands; `--apply` installs the update and refreshes skills in a workspace |
| `feedback [--title <text>] [--message <text>] [--details] [--out <file>] [--json]` | Prepare a sanitized issue draft and link on this machine; nothing is sent; runs without a workspace |
| `init [folder]` | Create settings, instructions, the skills and a graph; preserve existing files |
| `build [--force]` | Generate views and subtree sections; force replaces edited generated text |
| `check [--json]` | Check nodes and references; JSON includes `top`; errors exit 1 |
| `instructions [--json] [--limit <bytes>] [--check]` | Read the AGENTS.md budget and candidates; gate verification over the limit |
| `instructions move --lines <start>-<end> --to <skill> --reference <name> --pointer <text> [--since <commit>]` | Move a block verbatim into an existing workspace skill |
| `tree [node]` / `tree --path <node>` | Print a subtree or ancestors and their summaries |
| `home [--own] [--json]` | Show who writes Home, what an owner's Home embeds and what it misses; `--own` hands Home over and moves the tree to Archive |
| `inbox [--json]` | Show unfiled journal items and pages waiting in `pages/` |
| `review [--json] [--limit N] [--node node]` | Suggest question groups with ids, locations, `reasons`, evidence and recommendations |
| `review keep <id>...` | Remember whole question groups in workspace-root `review.json`; reason ids also select their group |
| `move <node> <parent>` | Move file and descendants, or place a page waiting in `pages/`; a top category such as `projects/` promotes it |
| `rename <node> <name> [--home]` | Rename the node's file, children folder and title, and the links to it outside code; keep its build protection; report settings that name it, and links in an owner's Home unless `--home` (the owner's request covers Home) updates them too |
| `remove <node> [--force]` | Remove file/subtree and print remaining link locations; protect tasks, decisions and nodes an owner's Home links to |
| `archive [node]` | Fold DONE items or a finished node into monthly archives; reject open nodes. `--canceled` moves only the CANCELED items |
| `find <words> [--history] [--json]` | Search names and authored text, ignoring case; history finds deleted lines via git `-S` |
| `sources [--json]` | List outside sources: for items, when each was last collected, what it delivered and how much is still open in the memo; for repo and page sources, their node and last mark |
| `sources script <name> [--action a] [--args json]` | Print the JavaScript to evaluate in the source's page: its collecting script, or one of its actions |
| `ingest <name> <file> [--dry-run] [--json]` | Add the new open items collected from a source (`-` reads standard input); report finished or dropped items still open |
| `changes [name] [--input file] [--all] [--json]` | Report which repo and page sources changed since their node was last updated; `--all` includes turned-off ones |
| `changes mark <name>... [--input file] [--expect token]` | Record that their nodes are up to date; `--expect` refuses a source that changed again since it was read |
| `requests [--for cleanup\|reflect] [--candidates] [--since time] [--json]` | List the requests typed to coding agents after the purpose's mark, each with its node |
| `requests mark --for <purpose> [--until time]` | Mark requests read for a purpose; without `--until`, up to the newest one the last listing considered |
| `workspaces [--input file] [--dry-run] [--json]` | Update branches and window names on path lines; report missing folders, workspaces without a node, windows of a shared folder no line names, and the name each app workspace takes from the memo |
| `workspaces untrack\|track <folder>...` | Record that you do not track these folders in the memo, or track them again |
| `fix [--dry-run] [--json]` | Repair blocks that share an id: an identical copy embeds the first, another block gets a new id |
| `mirror [name] [--note <source>=<file>] [--dry-run] [--json]` | Keep one list the same in several places (`mirrors`): merge what changed, write pages and export parts, and print what each note should hold; exit 75 when a page is being written or held |
| `mirror mark [name] --wrote <source>=<file> [--note <source>=<file>]` | Record the lines the workspace wrote to a note as its base |
| `mirror text [name] [source] [--copy] [--json]` | Print what a note should hold, or put it on the clipboard (`--copy`) to paste between the note's markers |
| `snapshot [--only <file>] [--settle N] [--json]` | Commit user graph edits, review decisions and settings before cleanup; with `--only` (repeatable, relative to the workspace or graph, or absolute inside the graph) only those graph files, as an edit of their own; an unknown path exits 1 without committing; with `--settle N` only the edits `idle --settle N` calls settled |
| `save <message>` | Check, build, report first-list status, commit the graph, `review.json`, `sources.json`, `reflect.json`, `skills.json`, the learned skills and `excudo.config.mjs`; holds the graph lock and says the `private-line` and `sync-conflict` warnings. An unknown `--only` path exits 1 without committing. With `--only <file>` (repeatable, relative to the workspace or graph, or absolute inside the graph) it commits those files and what the build wrote, except a file someone else had changed before it, so a scheduled run leaves edits made meanwhile elsewhere in the memo to their own commit; `--generated` commits only what the build wrote, the same way |
| `idle [--minutes N] [--settle N] [--json]` | Whether a scheduled run may change the memo now: exit 0 when free, 1 while a command holds the graph lock or an uncommitted graph file changed in the last minutes (not a generated page, nor a file held in `EXCUDO_HOLD`), 3 when a page holds the pause line; `--settle N` counts an edit untouched for N minutes that passes the check as finished (`settled`), not in progress, and an older one that fails as `unsettled` |
| `activity [--days N] [--json]` | Read the sessions' activity and your commits into the cache, for the views' `activity` fences (`conversations` setting) |
| `activity show [--days N]` | Print the activity a view would show |
| `sessions [<node>] [--path <folder>] [--days N] [--limit N] [--json]` | Your sessions with coding agents on a node and below it, newest first, with the command that resumes each in its folder now |
| `queue [--json]` | List the open tasks tagged for agents, ready or waiting for review, with their node, work folder and decisions |
| `queue report <key> --summary <words> [--file <report>] [--stamp <stamp>]` | Leave an agent's report under the task as a waiting line; refuses a summary that looks private, and, given the stamp the task was taken with, a task changed meanwhile beside another with the same words |
| `runs [--days N] [--step <name>] [--failed] [--deferred] [--full] [--json]` / `runs add <step> --status <state>` | List or record scheduled steps; repeat `--step` to select steps, and combine status flags to select either status. Text details stop at 160 characters unless `--full`; JSON keeps them whole |
| `backup <folder>` | Write a consistent copy of the cache (records, build protection, watched notes, reports) |
| `export [name] [--dry-run] [--force] [--json]` | Write the files kept from the memo in your format (`exports`); `build` and `save` do too, and a file edited by hand is left as it is |
| `site [--out <dir>] [--mode site\|standalone] [--open] [--dry-run] [--json]` | Write the memo as a website with cudoc-export (`site`), outside the graph; `build` and `save` do too unless `onSave` is false |
| `site setup [--project <name>]` | Once: install what is missing, log in to Vercel, create and link a project, guard every deployment with Vercel Authentication, publish and open |
| `site publish [--force]` | Write the website and put it on Vercel when the host is ready and something changed; exit 75 when the owner has something to do first |
| `site open` | Open the published website, copy its address and print a code for a phone |
| `site status [--json]` | Show the login, the project, the protection, the address, the last publishing and the inbox |
| `site pull [--now] [--dry-run] [--json]` | Bring in the task states chosen on the website: every five minutes, at once when a page asks or with `--now`; commit the pages, close the issues, publish again |
| `sync [--pull] [--push] [--status] [--json]` | Keep the workspace in step across computers through the `sync` setting: pull, then push (`--pull` or `--push` for one of them). `--status` shows the method, remote or folder, last sync, ahead and behind and the other computers seen, without the network. Refuses to pull with uncommitted tracked files (`save` first, or `auto` saves), aborts a conflicting merge and names the files, never rebases or forces. Without the setting it says so: exit 0 for `--status`, else 1 |
| `sync setup github [--remote <name>] [--create <owner/repo>] [--auto]` | Write `sync: { github }` with a workspace id; `--create` makes a private repository with `gh` and adds the remote; `--auto` also adds the pull-first rule to `AGENTS.md` |
| `sync setup drive --folder <path> [--machine <name>] [--id <id> \| --new] [--auto]` | Write `sync: { drive }`; `--id` joins the memo another computer made (a fresh `init` folder takes over its history on the first pull); `--new` starts another memo in a folder that already holds one |
| `receive --input <file\|-> [--dry-run] [--json]` | Bring in the task states chosen on the website: a batch, a list of batches, or issues as `gh issue list --json number,body` prints them; a change it cannot place becomes a waiting task on today's journal, and an issue without a batch is passed over |
| `skills [--global] [--force] [--replace <name>\|--replace-all] [--link\|--copy]` | Install or refresh skills and record the engine version; `--link` links them to the installed engine |
| `skills lint [name\|dir]... [--json]` | Check skills against the skill rule and score them; without a workspace, the engine's skills |
| `skills status [--json]` | How the learned skills stand: fitness, installation, new requests, dormant ones, folders not adopted |
| `skills candidates [--json]` | Recurring requests that could become a skill, with the newest of their words for the agent |
| `skills adopt <name> (--from <candidate>\|--requested) [--force]` | Install a learned skill that fits, record one that does not as a draft; `--force` replaces a copy someone edited |
| `skills dismiss <candidate> --reason <words>` | Do not offer this candidate, or requests like it, again |
| `skills mistake <name> --case <case> --why <words> [--json]` | Record a case of a learned skill's check that reproduces a mistake you pointed out; lint keeps it a case that must fail |
| `skills retire <name>` | Take a learned skill out of use; its source and record stay |
| `skills upkeep [--json]` | Lint the learned skills again, demote the unfit, refresh copies and count their requests |

`review` finds top warnings/inactive nodes (top nodes outside an owner's Home instead), outdated summaries, idle/long/stale nodes, overdue/stale
tasks, unanswered check tags, old ideas, duplicates, old journal items and path lines whose folder is gone. Ages use git log/blame,
never file modification times. Short/missing history suppresses age-based candidates; relative
summary freshness still works. If history cannot be read completely, `review` and `check` say so
instead of guessing ages. Collapse choices, generated regions and moves do not count as body
changes; deleting authored content does. Done, Record and everything below them are not reviewed
as idle, stale or outdated. A date without a year, such as `1/5`, means its nearest occurrence. Separate-line `DEADLINE:` and `SCHEDULED:` belong to their task,
and identical task occurrences receive independent ids. Keep expires after `keepDays` or a content
change; the outdated summaries counted in `top` leave out the ones you kept. JSON stats include `questions`, `mergedReasons` and `suppressedQuestions`; `--limit` counts
question groups. Collection and git analysis are shared within one command, and digests of
committed versions and blame results are cached in `.excudo/history.json`.
Recommendations never move or delete content themselves.
Existing keep ids are honored when they identify one target. A formerly shared id for identical
tasks is ambiguous, so those items are offered separately for a fresh decision.

| Check | Level |
| --- | --- |
| `node-title`, `node-summary`, `duplicate-name`, `orphan-folder`, `list-trailing-text` | error |
| `block-id-duplicate`, `block-ref-missing`, `embed-cycle`, `reflect-invalid` | error |
| `summary-long`, `top-summary-long`, `list-wide`, `node-large`, `doing-wide` | warning |
| `dangling-link`, `bullet-heading`, `heading-spacing`, `paragraph-gap`, `skills-outdated`, `history-failed` | warning |
| `embed-page-missing`, `embed-twice`, `path-duplicate`, `path-window-twice`, `knowledge-missing` | warning |
| `sync-conflict`, `private-line` | warning |
| `instructions-size` | warning |
| `instructions-target` | note |

`sync-conflict` names a copy a sync app left after a conflict (`*.sync-conflict-*`, `(conflicted
copy)`), which the tree leaves out. `private-line` names, by file and line only, a line added since
the last commit that looks private by the rules a note source drops lines with; a line committed
stays quiet. `list-wide` excludes metadata at Home and date archive nodes. Keep summaries within 120 characters,
top summaries within 60, lists within 9, own open tasks within 12 and tasks in progress within 9 by default
(`doingMax` follows `widthMax`; `taskMax: false` or `doingMax: false` stops counting those tasks). An items source's
node is an inbox and may hold more.

## Settings

```js
export default {
  graph: "notes",
  locale: "en",       // en or ko
  private: [],       // Strings excluded from feedback diagnostics.
  summaryMax: 120,
  topSummaryMax: 60,
  widthMax: 9,
  taskMax: 12,       // false: no limit on a node's open tasks
  doingMax: undefined, // most tasks in progress; follows widthMax, false: no limit
  doneKeep: 5,
  metaNodes: ["Done", "Record"], // default uses the locale's labels
  staleDays: 30,
  keepDays: 90,
  bodyMax: 20,
  sources: [],        // outside sources; see "Bring in outside work", "Keep knowledge current" and "Follow a note you keep elsewhere"
  knowledge: [],      // nodes that hold only reference knowledge
  interests: undefined, // the node where the reflect skill keeps lasting decisions
  conversations: false, // read requests typed to coding agents: true or { claude, codex, exclude }
  moved: {},          // renamed folders, old path to new path, for path lines and requests
  skills: {},         // learned skills: { dir, install, keep, minScore, minRequests, minSessions, windowDays, dormantDays, similarity }
  instructions: { limit: 32768, target: null, auto: false, keep: [] }, // Target defaults to 85% of limit; auto opts into scheduled trimming
  exports: [],        // files written from the memo in your format; see "Keep a file in your format"
  agents: undefined, // optional worker and independent reviewer preferences
  queue: {},          // tasks handed to agents: { tag, limit }; see "Hand work to agents"
  site: undefined,    // the memo as a website: { out, title, mode, open, journals, css, onSave, inbox, publish }; see "See the memo as a website" (inbox: true, or { github: { repo }, schedule })
  sync: undefined,    // keep the workspace in step across computers: { github: { remote, branch } } or { drive: { folder } }, plus { id, auto }; written by sync setup, see "Use it on several computers"
  labels: {},         // override generated words
}
```

`excudo.config.mjs` remains outside the graph. Metadata comes last when order does not name it.
Label groups such as `messages`, `review` and `recommendations` merge entry by entry.
The note prefixes and the question tag (`markers`: `Idea:`, `Decision:`, `#check`) are recognized in
every language, whatever the locale.
The default Home queries show only DOING expanded. After changing locale or region labels,
review the existing generated boundaries before a forced rebuild.
