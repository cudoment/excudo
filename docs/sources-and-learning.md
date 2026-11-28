# Sources and learning

[README](../README.md) | English | [한국어](sources-and-learning.ko.md)

## Bring in outside work

An issue tracker, a team board, requests or mentions can feed the memo. The engine never goes
online: an agent opens each source in a browser where you are signed in (a browser automation tool
or an app's built-in browser) and collects the items, and the engine places them, skips what the
memo has already had, and keeps track. Describe each source in `excudo.config.mjs`:

```js
sources: [
  {
    name: "jira",                                // the id the commands use
    label: "Jira",                               // link text when an item has no key
    url: "https://jira.example.com/issues/?jql=assignee%3DcurrentUser()",
    collect: "Unresolved issues assigned to me", // what the agent collects, in words
    key: "[A-Z][A-Z0-9]+-\\d+",                  // an item goes to the node that names its key
    node: "Work",                                // otherwise here; without a node, today's journal
    complete: true,                              // the page lists every open item
    finished: "ask",                             // or "settle": a task whose items are all finished becomes DONE
    script: async ({ since, url }) => { /* runs in the page and returns the items as JSON */ },
    actions: { create: { script: async (fields) => { /* … */ }, notes: "What to fill in" } },
  },
],
```

Ask the agent to bring your issues into the memo. The `excudo-sources` skill first checks that
every source it needs is signed in and, when one is not, tells you and waits for you to sign in
before doing anything. It then runs the source's script in its page (`sources script <name>`) or reads the page, previews with
`ingest <name> <file> --dry-run`, and after your OK adds each new open item once as
`- TODO <title> [<key>](<url>)`, in the lead of its node above the first section heading. A key
that only a knowledge node names does not draw an item there. An item is `{ id, title, url }` with optional `done`, `state`,
`marker` (`""` for a plain line), `node` (where it goes), `skip` (never add it) and `covers` (other
pages its work stands for, such as the requests an issue's description links). An item the
memo has had, linked anywhere in the graph or added before, never comes back, even after you remove
or archive its line, and finished items are never added. `sources.json` beside `review.json`
remembers what each source delivered; `snapshot` and `save` commit it with the graph. An item the
source has not listed for 180 days shrinks there once no open task links to it: one the memo never
had is forgotten, and one it had keeps only its id and links, so it never comes back.

Completion stays yours. An item finished at its source but open in the memo, or one that a complete
source no longer lists, becomes a `source-closed` or `source-gone` question in `review`. When you
mark work done at the source yourself, set `finished: "settle"` on it: every ingest then turns an
open task into `DONE` once every item its own text links is finished at a settling source, and
lists it as `settled`. A link to part of a page (`…#comment-3`) speaks for that part, and an item's
`covers` count as its links. An item still open, or one from a source left to ask, keeps the task
open, and so does a link that looks like a source's item but that no source has collected (work
someone else holds, or an issue before its source's first collection: the same host and path as the
source's items, numbers aside, or the source's `key` on its host). A waiting task and a task with an
open task below it stay open too. Other links, such as a guide, take no part, nor do items of a source
that brings plain lines (an empty `marker`, such as mentions): such a source seeing a link tells nothing
about that work, so it frees no link that looks like a source's item; only an item you skipped does. The
checks of the sources and cleanup skills hold agents to this: given the commit the work began from
(`--since`), they fail when a task was closed since that the engine did not settle and that you did
not call finished (`--allow-done <its words>`). An agent
creates or changes something at a source only when you ask for that change and confirm its content,
through the source's `actions` or the site's own form. A script is a self-contained function, or its
text, that runs in the page with the page's own session; never put credentials in it. Make it throw
when the page is not signed in, since an empty list from a complete source means every item is gone.

The skill can also run on a schedule (an agent's non-interactive mode from cron or a similar
timer), with the items collected beforehand. Nobody is there to answer, so the run counts as your
request to bring the items in: it appends an item's key to an open task that already describes the
same work instead of adding a second line, leaves other items where the engine places them, keeps
finished and dropped items as questions and skips a source that needs signing in.

## Keep knowledge current

The memo can also hold what you know about your projects and the pages you follow, and agents keep
it current. Give a repository, a folder or a web page a knowledge node:

```js
sources: [
  { name: "site", kind: "repo", path: "~/work/site", node: "Site repository", aliases: ["~/old/site"] },
  { name: "notices", kind: "page", url: "https://forum.example.com/c/notices", node: "Notices",
    script: async () => (await (await fetch("/c/notices.json")).json()).topics.map((t) => ({ id: t.id, title: t.title })) },
  { name: "docs", kind: "repo", path: "~/work/docs", node: "Docs repository", watch: "commits" },
  { name: "archive", kind: "repo", path: "~/old/prototype", node: "Old projects", enabled: false },
],
knowledge: ["Knowledge"], // nodes that hold only reference knowledge, such as topics
```

`changes` reads each repository itself (its commit and uncommitted changes, or a folder's files
without dependencies and builds) and says which ones changed since their node was last brought up
to date. A repository that always has work in progress can be watched by its commits alone
(`watch: "commits"`). One whose uncommitted files were edited in the last fifteen minutes is marked
`busy` in `changes --json`: someone is working there, so the skill brings in its new commits and
leaves the drafts for a later run, and its check allows that. A page is read the way outside work is, in your signed-in browser: the agent runs its
script there and passes the result with `changes <name> --input <file>`; only the returned ids decide
whether it changed. Ask the agent what is going on, or to write something from what it knows: the
`excudo-recall` skill updates the nodes of changed sources first, marks them with
`changes mark <name>`, and then answers from the memo, naming the nodes it used. A watched source
is only read. Knowledge lines carry an evidence grade (`Confirmed:`, `Observed:`, `Assumed:`,
`Proposed:`, `Superseded:`), and only `Confirmed:` is your decision. Review leaves out the length,
age and repeats of knowledge nodes, since agents keep them, not you. On a schedule the skill brings
every changed source up to date without asking, writing what it cannot settle as `Observed:` or
`Assumed:` with its source.

## Follow a note you keep elsewhere

Some people keep their current thinking about a few areas in one note in another app, a phone notes
app or a shared document, and change it there. A `note` source follows such a note, and the
`excudo-follow` skill brings it into the memo:

```js
sources: [
  { name: "thoughts", kind: "note", label: "Thinking note", url: "https://notes.example.com/n/1",
    between: "---", removed: "settle", script: async () => readTheNoteLineByLine() },
],
```

Only the part between two lines that hold just the marker (`between`, `---` unless set) is followed;
more pairs add more parts. A blank line ends a block, and its first line is the block's heading. The
note may hold other things, such as accounts and codes: `sources script` wraps the script so that the
page itself cuts the marked part and drops lines that look private (a password or code, an account,
card, phone or ID number, a license key, a token, an e-mail address, a line of bare digits), and only
that leaves the browser. The engine filters again what it gets. `changes <name> --input <file>`
compares the part block by block with what it kept at the last mark, in the cache outside git, and
reports added, changed and removed blocks; `sources.json` keeps only a fingerprint. A note without a
pair of markers is `unmarked`, not a note whose thoughts were all removed, and cannot be marked.

The skill's `where.mjs` lists, for each block, the memo lines that already hold its heading and lines.
A thought the memo holds is merged into that place and enriched; one nothing holds gets a line in the
closest node, or a child node. A removed thought is asked about, or with `removed: "settle"` (the owner
said removal means finished or dropped) marked done or taken out, depending on what the memo and its
records show. Its check confirms the note was marked, the memo holds every block, no open task still
holds a removed line, and no line that looks private was added.

## Learn from your requests

With `conversations: true`, `requests` reads the requests you typed to Claude Code and Codex on this
machine (from `~/.claude/projects` and `~/.codex/sessions`; set `{ claude, codex, exclude }` for
other folders) and drops what tools or other agents inserted, and shell commands you ran through the
agent (`! command`) with their output. From a Codex voice session it keeps only what you said, not
the talk sent along with it, and the tail sent when the session ends is no request. Text you pasted is kept apart: it shows as `[pasted N]` in the
request, and the listing gives each paste's length and start, so a pasted review or specification is
never read as your decision. Each request names the node of the folder it was typed in. When the
extraction changes, requests are read again from the logs, and those whose log is gone are cleaned
again from the cache. The text stays in the workspace's records (`.excudo/records.db`, one SQLite
file through Node's built-in `node:sqlite`), outside the graph and git; `requests` refuses a cache
inside the graph or one that git does not ignore. The JSON files of earlier versions are read into it
once and renamed `*.imported`. A tidy-up
reads the requests since the last tidy-up for work you handed out and decisions you made
(`requests --for cleanup`). The `excudo-reflect` skill reads them for lasting decisions,
working preferences and corrections (`requests --for reflect --candidates`), gathers candidates in
`reflect.json` and turns the ones that last into nodes below the `interests` node. A correction of a
skill's work names that skill and the case that reproduces the mistake. Its check fails until the
skill records that case ([`skills mistake`](skills.md#skills-carry-their-own-code)) or a question about it
waits for you. Each purpose
keeps its own mark (`requests mark --for <purpose> --until <time>`). It can run on a schedule; then
it records what needs your judgment as questions instead of deciding. What a scheduled run
(`claude -p`) types is its own prompt, not a request of yours, and is left out.

## Record what you did

`activity` reads, from the same logs, what each session did and keeps it in the same records
(outside the graph and git): its folders and times by day, the name
you gave it or the title the tool made, the skills it ran, whether their checks passed, the pull
requests it opened and its cost. Nothing typed is kept, neither your requests nor an agent's
answers. It also reads your commits, by the author each repository is set to use, from the
workspace's repository, the watched ones, the folders the nodes' path lines name and those the
sessions worked in. A scheduled run (`claude -p`, `codex exec`) is marked as one, and a commit made
while it worked in the repository is counted as its own; a session you typed nothing into that day,
one in a temporary folder and one in a folder you do not track are left out. Logs that did not
change are not opened again.

A view shows it with an `activity` fence:

````md
```activity
days: 14
```
````

The build turns the fence into the last days, newest first, each day's nodes with their sessions,
commits and pull requests, at most five of each and then how many more, and the day's scheduled
runs; only today stays open. A skill's check counts once per session, by its last result, since a
check is run again once what it reported is fixed.
Every line is the engine's own words: a title that looks private shows as hidden, a long commit
message shows its gist, and link, tag and property syntax in titles is neutralized. The journals are
not written. `activity show` prints what a view would show.

`sessions [<node>]` finds the sessions to pick up again: the ones that worked on that node or below
it (or in a folder, `--path`, by its old path or its new one), newest first, each with the command
that resumes it where its folder is now, `cd '<folder>' && claude --resume '<id>'` or
`codex resume '<id>'`. Scheduled runs are left out. A session from a folder renamed since (`moved`)
resumes in the new folder, and the listing says so; it also says when the folder is gone, and when
Claude Code still keeps the transcript in the old folder's store, where it will not look from the new
folder (`~/.claude/projects/` and the folder's path with every character but letters and digits
turned into `-`).
