# Excudo

English | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

**Electricity is not free, so AI should earn its power bill.**

Excudo (the `excudo` package) is an engine that keeps a personalized AI environment managed and
improving. Its name is Latin for "I hammer out": it holds the rules, checks and shared skills that
Claude Code and Codex both follow, and hammers your agents' work into shape against them. The folder
you run with it is your **personal project**: a place with your material, your judgment criteria,
skills and automation, where work, learning and creative results get made.

**Five-minute start**

Create a memo, install its engine and see the next step.

```sh
npx -y excudo@^0.8.0 init my-memo
cd my-memo
npm install
git init
npx --no-install excudo start
```

Open this folder with your coding agent and ask: "Add 'Read one chapter' to my memo."
Then build the local website to see your memo in a browser.

```sh
npm install --save-dev cudoc-export@^1.1.0
npx --no-install excudo site --open
```

Use any terminal and Markdown editor. Orca, Tine and a site host are optional.
The local website needs no hosting account.
See [updates](#update-the-engine), [feedback](#report-a-problem), the
[bug form](https://github.com/cudoment/excudo/issues/new?template=bug.yml) and
[usability form](https://github.com/cudoment/excudo/issues/new?template=usability.yml).

## Install with a coding agent

Paste this into a coding agent (Claude Code, Codex) opened in an empty place:

> Set up Excudo from https://github.com/cudoment/excudo in a new folder, following its README section "Install with a coding agent"

The agent follows these rules and runs only the commands of rule 4 and the report check, never the website block of the five-minute start:

1. Check that Node.js is 22.16 or later (`node --version`); if not, stop and point to https://nodejs.org.
2. Ask the folder name and the language of the files (`en` or `ko`) once, then use them without asking again. Choose `en` unless the owner reads Korean (`ko`). Whatever the file language is, keep talking to the owner in the owner's own language (Japanese, Chinese or any other).
3. Never install anything globally: no `npm install -g`, and no change outside the new folder apart from npm's own cache.
4. Run `npx -y excudo@^0.8.0 init <folder> --locale <language>`, then this one line: `cd <folder> && npm install && git init && npx --no-install excudo start --report --json`. Every command after `init` runs inside `<folder>`; `init` does not run git, so `git init` is part of the sequence.
5. Read the report (`--report --json`) to verify. The install succeeded when the steps `workspace`, `install`, `git` and `skills` are all `done`. For each of them that is not, show its `id` and `state` and ask the owner what to do; do not guess a cause or run anything else.
6. When a command fails, stop, show the last lines of its error output and ask the owner; never improvise a fix or another command.
7. Finish by handing the owner the next remaining step, the one named by `stoppedAt`: relay its `run`, `ask` and `setting` verbatim and do not run it yourself.

## Get started

Run `excudo start` to see completed steps, the next command and what to ask an agent.
The engine generates the list below.

<!-- excudo:start (written by npm run start-docs from src/start.mjs) -->
**To start** (in order):

1. **Node.js 22.16 or later**: install the current LTS (24); https://nodejs.org
2. **A workspace**: create the memo's folder with its settings, agent skills and graph; `npx -y excudo init my-memo`; or ask your agent “set up my memo”
3. **The engine in the workspace**: install it in the new folder; `npm install`
4. **A git repository**: the memo's history; save commits to it; `git init`
5. **The agent skills**: init installs them; reopen your agent in the workspace; `npx --no-install excudo skills`

**When you want them**:

1. **Worker and independent reviewers**: choose tools, models and reasoning effort; `npx --no-install excudo agents`; or ask your agent “choose my worker and reviewers”
2. **Learn from your requests**: let agents read the requests you type to coding agents here, turn lasting decisions into interests and recurring work into skills with their own checks; the interests setting names a node, so create that node first (README: Learn from your requests, Skills carry their own code); `conversations: true, interests: "Interests"`; or ask your agent “let agents learn from my requests”; https://github.com/cudoment/excudo#learn-from-your-requests
3. **Tine**: open the graph folder (notes/) in Tine to read and write the memo; https://tine.page
4. **Your phone**: sync the graph folder with Syncthing and open it in Tine on the phone; or ask your agent “let me see my memo on my phone”; https://syncthing.net
5. **Your own Home**: write the first screen yourself; the tree moves to the Archive; `npx --no-install excudo home --own`; or ask your agent “let me write my Home”
6. **Outside work**: bring in an issue tracker or team board through your logged-in browser; `npx --no-install excudo sources`; or ask your agent “pull my issues into my memo”
7. **The memo as a website**: publish it on Vercel where only your login opens it, on a computer or a phone; `npx --no-install excudo site setup`; or ask your agent “set up the website”
8. **Task states from the website**: bring website task states into the memo; `site: { inbox: true }`; `npx --no-install excudo site setup`; or ask your agent “let me change task states on the website”

Run `npx -y excudo start` (`npx --no-install excudo start` in a workspace) to see progress. Use `excudo start --report` for every step and where to continue.
<!-- /excudo:start -->

## How it works

A personal project centers on its memo: a folder of Markdown nodes that reads as an infinite outline in
[Tine](https://tine.page), on your computer and your phone. You write the top list and make the
decisions; agents do the filing. The engine holds what any personal project can use (commands, checks
and skills); each project keeps its own material, settings and credentials.

Name a personal project for its purpose, as Excudo plus a word: **Excudo Works** for work automation,
**Excudo Lab** for study, and so on. The engine is only ever "Excudo" or "the engine"; a personal
project goes by its full name or "this project". Its agents read "the engine" that way, and before
changing anything outside the memo they ask whether you mean the engine or the project.

- **[A first screen that stays short](#keep-the-first-list-short).** Agents file what you capture
  below the right node, keep every summary above a change current, and fold details away instead of
  deleting them.
- **[Nothing moves before you answer](#a-cleanup-interview).** A cleanup interview brings evidence
  and a recommendation, four questions at a time, and saves each answered batch as a commit you can
  revert. Only you mark work done.
- **[Outside work](#bring-in-outside-work) and [current knowledge](#keep-knowledge-current).**
  Issues, requests and mentions come in once each through your signed-in browser; knowledge nodes
  follow the repositories and pages you watch.
- **[Only skills that prove their work](#skills-carry-their-own-code).** Every skill carries code:
  at least a check, with known cases it must pass and must fail. `skills lint` runs those cases and
  scores the skill, so a prompt shortcut or a check that cannot fail is no skill. Work you keep asking
  agents for becomes a new skill only when it clears that bar, and leaves use when it no longer does.
- **[Learns from what you ask](#learn-from-your-requests).** It reads the requests you typed to your
  agents, keeping their words out of git, and turns lasting decisions into notes and recurring work
  into skills, written in its own words.

## Built on cudoc

Excudo depends on [cudoc](https://www.npmjs.com/package/@cudoment/cudoc) (`@cudoment/cudoc`),
which npm installs with it. cudoc is a separate dependency of the engine: it supplies the tree (ancestry,
order, summaries) and the embeds the generated views are made of, and Excudo adds the
outliner format, checks, review questions and skills. Neither the engine nor a personal project is part
of the cudoc product family: report engine problems here and problems of the cudoc library upstream in cudoc. The files follow Logseq format; they are
verified in Tine, not yet in Logseq.

## Also included

- [Make Home your page](#make-home-your-page): you check off work there and decide its layout, and the whole tree stays in the Archive view.
- [Find the details](#find-the-details), even lines removed long ago (`find --history`).
- Finished work folded into monthly archives, dated from git history (`archive`).
- [Work folders on nodes](#work-folders-on-nodes): path, branch and window lines kept current.
- [A file in your format](#keep-a-file-in-your-format), such as a todo list, rewritten from the memo at every save.
- Block ids, references and embeds checked and repaired (`fix`).
- Scheduled runs of reflection, skill upkeep and outside sources, with questions left for you.
- [Phone sync through Tine](#tine-and-phone-sync), and every message in English and Korean.
- Add-ons: [`excudo-works`](https://github.com/cudoment/excudo-works) (npm `excudo-works`) adds a daily routine kit on top of an Excudo workspace.

## Update the engine

Check for a newer release before choosing whether to install it.

```sh
npx --no-install excudo update
npx --no-install excudo update --channel next --json
npx --no-install excudo update --apply
```

The default channel is `latest` for stable releases.
`--channel next` compares beta and stable tags and chooses the higher version. Without `--channel`, an installed prerelease follows `next` and any other version follows `latest`.
The command prints the installed and registry versions, available release notes and the exact install commands.
It installs only with `--apply`, from your workspace, then refreshes its skills.

Each installed engine skill copy records a fingerprint; only unmodified copies are replaced.
Owner edits, extra files and foreign links stay in place.
Backups go under the cache folder's `skill-backups` directory.
Printed paths let you compare and merge preserved copies before retrying.

Network, authentication and missing-tag lookup failures print distinct notes and exit successfully.
An installation failure exits with the npm error tail.
After `--apply`, run `excudo start --report` and the printed setup check to find missing template rules.
The command also prints versioned GitHub release and CHANGELOG links; npm metadata carries the newest section.

## Report a problem

Prepare a report locally, review it, then open its GitHub issue link when you want to share it.

```sh
npx --no-install excudo feedback --title "Cannot build" --message "What happened and what I expected"
npx --no-install excudo feedback --out feedback.md --json
```

The draft puts your message first and adds only versions, platform, onboarding states and fixed diagnostic identifiers.
Run steps outside the engine's known identifiers appear as `custom-step`; failed skill checks appear as `skill-check`.
Free-form run details and skill names require `--details` and carry a "review before sending" notice.

It redacts home, workspace and graph paths and their real paths.
It also redacts Windows drive paths, absolute paths of two or more levels, emails, IP addresses and private hosts; in `--details`, any other path is cut to the end of its line.
Only `github.com` and `npmjs.com` URLs remain.

Mark additional strings with `private: ["secret value"]` in `excudo.config.mjs`.
Strings inside an object marked `private: true` are also removed.
Broken configuration does not block `feedback` or `start --report`; their default output omits the private error text.

The command never sends a report or opens a browser; `--out` writes only the sanitized draft.

## Start with a skill

Requires Node.js 22.16+ (the current LTS, 24, is recommended) and an agent that reads Agent Skills. Once this repository is public:

```sh
npx skills add cudoment/excudo --skill excudo-setup
# All ten, if preferred:
npx skills add cudoment/excudo
```

Say “set up my memo”. The setup skill asks the location and language, installs the npm engine,
runs `init`, then runs `npm install` in the new workspace. `init` installs all ten skills into
`.agents/skills/` and links `.claude/skills/` to that copy. Reopen your agent in the workspace.
Repository-root discovery should find `skills/`; use the explicit `--skill` option for setup alone.
The registry and remote installation paths will be verified after the first publication.

| Action | Claude Code | Codex |
| --- | --- | --- |
| Capture | `/excudo-capture renew my passport` | `$excudo-capture renew my passport` |
| Cleanup interview | `/excudo-distill` | `$excudo-distill` |
| Setup | `/excudo-setup` | `$excudo-setup` |
| Outside sources | `/excudo-sources pull my issues` | `$excudo-sources pull my issues` |
| Recall | `/excudo-recall what changed in the site?` | `$excudo-recall what changed in the site?` |
| Reflect | `/excudo-reflect` | `$excudo-reflect` |
| Learn skills | `/excudo-skills` | `$excudo-skills` |
| Keep a todo file | `/excudo-export` | `$excudo-export` |
| Follow a note kept elsewhere | `/excudo-follow` | `$excudo-follow` |
| Work on tasks handed to agents | `/excudo-queue` | `$excudo-queue` |

You can also just ask in English or Korean. Each skill pairs Markdown instructions with scripts: at
the least a check that tells whether the skill's work met its requirements (see “Skills carry their
own code”). The engine handles generation, checking, movement, archives and commits; skills handle
placement, summaries and decisions. Network is needed during installation only. All later calls use the local
engine via `npx --no-install excudo`. If it is absent, run `npm install` in the workspace.
`skills --force` updates outdated skills (a copy that differs from the package is kept and backed up once; `skills --replace <name>` or `--replace-all` replaces it after the backup); `skills --global` installs in `~/.agents/skills/` and links
it from `~/.claude/skills/` and `~/.codex/skills/`, for each agent whose folder is in your home, as
learned skills are. Use `EXCUDO_ROOT` when calling global skills from another folder. A
workspace that installs a local clone of the engine (`file:`) can link the skills to it instead of
copying them, so they change with the clone: `skills --link --force` (`skills --copy` copies again).

### Command-line setup

After the npm package is published:

```sh
npx -y excudo@^0.8.0 init my-memo --locale en
cd my-memo
npm install
git init
npx --no-install excudo check
```

Before publication, from a local clone:

```sh
npm install
node bin/excudo.mjs init ../my-memo --locale en
```

Then enter the new workspace and run `npm install`. The dependency points to the clone.
`EXCUDO_PACKAGE` overrides the package with a local folder or tarball for the same
setup flow. `init --example` creates the English [dummy example](example/notes) and refuses another
locale; `--graph` changes the folder.

## Keep the first list short

Home shows a name, open-task total and summary for each top node. Keep that list short every time
you capture or tidy. Useful details stay below, folded to any depth, ready to expand or search.
Each node page also ends with its location, Home down to the node, and its whole subtree. Summaries live once, in their nodes; cudoc's tree
API supplies ancestry, ordering and cells, and this engine writes the outliner blocks.

The default Home is one way to start; once Home is yours (see Make Home your page), lay it out as you
like.

The default Home has two areas. **Thinking and plans** holds the tree and, folded, the Decisions and Ideas
queries: where each area stands and what you decided. **Work and automation** below it expands
**In progress**, **Handed to agents** (open tasks tagged for the queue) and **Waiting for review** (the
`WAITING Review:` lines agents leave), and folds Waiting and To check. The split is between thinking
and doing, not between topics: an area's direction sits above, its next steps below, both stay in
their nodes, and Home shows them through the tree and queries instead of copying them. Each section
is one query that carries its own title and fold,
`{{query (task WAITING) {:title "Waiting" :collapsed? true}}}`, not a folded label over a query: on a
phone Tine draws a folded block's arrow faintly at the right end of its row and hides it in document
mode, so a folded label reads as plain text, while a query's title, result count and arrow show on
every device. Unfolding a query is kept on that device and does not rewrite the file. Tine reads
these options only after a parenthesized query, so a page reference or a text search goes inside
`(and …)`; `tine export static` (0.7.1) does not read them and prints such a query as text. A Home
made from an older template keeps its folded labels until you rewrite them the same way. `check` and `save` report the first list's width, long/outdated summaries and DOING count.
Done and Record are metadata, so they do not count toward its width. `top.visibleLines` counts
nonblank visible source rows in the resolved Home view, honoring current folds. Query results and
screen-width wrapping are excluded; DOING totals are reported separately. Judge cleanup by a readable
first screen and successful lookup of folded details.

## A cleanup interview

Notes accumulate. `excudo-distill` starts at the top, finds clutter, explains the evidence
and recommends suitable choices, then asks at most four questions at a time. Reasons for the same
node or individual item are combined into one question. Nothing is
moved or removed before your answer. Material useful later goes below a related node or into the
completed archive; only material you will never need again is removed. No open tasks does not prove
a reference is useless or finished: you decide its value. A keep decision covers the whole question.

> Agent: `projects/Reference.md:5` is a reusable method with no open tasks. Move it below Current
> if it supports that work, or keep it at the top? `projects/Old.md:6` is an overdue draft request.
> Reschedule it (recommended), confirm it is finished and archive it, or remove it?
>
> You: 1 move, 2 reschedule to November 3.

The agent applies that batch, updates affected summaries up to the top and saves a separate commit.
Moved material remains searchable; removed material remains in git and `find --history`.
The engine suggests candidates; the skill asks and applies your choices. Each saved batch includes
graph edits and `review.json`, so `git revert <batch-commit>` restores that batch's answers and content
while preserving the initial snapshot and earlier batches.

When you paste an unorganized memo (a list copied from another app, with `ㄴ` or dash nesting, lines
without a title, addresses) and ask to organize it, the skill places nothing at once. A script
(`scripts/raw.mjs`) first sorts each line against the memo: an open task or note that already says
it, a finished or archived line, a line that is only similar, or a new one. Then it asks, four at a
time, which areas you are working on now, which lines are everyday tasks, what to shelve and where
each new line goes, and applies only the lines you answered for. Its check (`--raw`) confirms that
every new or similar line was asked about and that no unanswered line was added or moved.

## Nodes and generated boundaries

```markdown
# Blog migration
Move old posts without breaking their links.

- DOING Export posts
- TODO Map old URLs
- Idea: write about the migration
```

One file is one node. Its first line matches the file name and its next paragraph is its current
summary. Names are unique across the graph. Children of `X.md` live in `X/`; top category folders
such as `projects/` add no level. Use `[[Page]]` links and `TODO`, `DOING`, `WAITING`, `DONE` task
markers. GFM checkboxes (`- [ ]`) are plain text in Tine. Only a heading may follow a list: Tine
absorbs unindented paragraphs or tables following a list into its last item when checked.
A heading's content starts on the very next line, and one blank line stands above each heading.
Text under a heading stays in the heading's block until the next bullet or heading, and Tine shows a
blank line inside that block as a gap: keep one paragraph under a heading (the summary under the
title) and put further text in list items. Generated pages follow this layout, and layout changes
(blank lines, a paragraph turned into a list item) do not count as body changes. Tine shows a heading
outside a list at the depth of the items around it, so to show items under a heading (a page you lay
out yourself, such as Home), write a heading block, `- ### Work`, and indent its items below it. A
bulleted heading with nothing indented under it reads as an outliner's edit (`bullet-heading`).

`views/Home.mdx` is the authored source. Its standard cudoc embed is reusable by a future SSG:

````markdown
```cudoc-embed
sources: [/]
render:
  type: tree
  open: 0
  columns: [link, { value: { extractor: openTasks } }, summary]
  order: [..., Done, Record]
```
````

An `outline` fence copies queries unchanged, and a `nodes` fence lists part of the tree by name
(see Make Home your page). Tine does not read `.mdx`. The generated `Home.md`
is identified by `generated:: views/Home.mdx`; each node's generated part starts at `## Subpages`
with a location line (`Location: [[Home]] › [[Parent]] › Node`), followed by the subtree if any.
Do not hand-edit either. Headings and task items are recognized through Markdown structure: fenced
and indented code examples, HTML and quoted examples are preserved. A build leaves authored text
intact and protects generated edits (exit 2), while retaining `collapsed::` choices. `init` also
refuses to overwrite an existing Home that does not belong to its view.
NFC comparison handles NFD names written by macOS Syncthing; rewrites retain on-disk names.
Caches live outside the graph in `.excudo/`. Protection baselines follow moved subtrees
and retain known generated versions for batch reverts. If a baseline is missing after deleting
caches, an existing region or owned view may be adopted only when it matches the current output.
Otherwise build blocks; preserve the content before explicitly replacing it with `build --force`.
Tine can save a node's `## Subpages` heading as a list item (`- ## Subpages`), with empty items above
it, when a node is edited on a phone. When the section holds nothing else, the build puts the heading
back and drops those empty items; when it does, it stops and says to move that text above the section.
cudoc's collected documents are not kept: each command collects into a temporary folder and removes
it, so a dry run writes nothing.

## Find the details

In Tine on a computer or phone, expand Home's top nodes, follow a node page's subtree, or search.
Tine lists pages by file name only, so the location line at the end of each node shows where it sits
and links back up. `init` pins Home in the sidebar favorites (`:favorites` in `logseq/config.edn`).
Finished work is folded under Done → Done 2026 → Done 2026-10. Done retains the newest `doneKeep`
items; older items are retained in month nodes, dated by arrival in Done through git blame (or
archive day if unknown); if the history cannot be read, archive stops instead. Whole finished nodes and their children can go there too.
`archive --canceled` moves only the work marked CANCELED, so a schedule can clear what the owner decided
not to do while finished work stays in place until the next cleanup.

For an agent lookup: `tree` to guess the location, read the body, `find`, then `find --history`
for removed lines. Lookup answers your question without changing the memo.

## Make Home your page

If you would rather choose the first screen by hand, hand Home over once:

```sh
npx --no-install excudo home --own
```

`views/Home.mdx` becomes `views/Archive.mdx`, which holds the whole tree, and `Home.md` becomes
your page: links to the nodes the tree listed first, a link to Archive, and the view's other
sections such as Work and automation, with your folds kept. Nothing in the tree moves or is removed. The handover
changes nothing and stops if the generated Home was edited by hand, if a page links to or embeds the
Home view, or if the graph has reference errors; a failed write puts every file back. From then on
the engine never writes Home: you check off work there and decide its layout. Agents never change
it on their own or in a scheduled run and suggest links instead; when you ask for a change, such as a
new section, a narrower query or a link, they rework Home to that request and leave the rest as it
is. The Archive page is generated
as Home was, and every location line starts at Archive. Link to a node at any depth and group the
links as you like; each linked node still ends with its own subtree.

Lay Home out as you like when you write it yourself; the default's two areas (thinking first, work
below) are one example.

Whatever the layout, copy nothing into Home. Show work through queries: in progress, next tasks, a source's items by its node page or address,
tasks handed to agents, the `WAITING Review:` lines and other waiting tasks. Show the areas of thought
through a generated view that Home embeds. A view's `nodes` fence lists part of the tree by node
name, each line with its open tasks and summary as in the tree, children folded:

````markdown
```nodes
depth: 2
except: [Paused]
```
````

`depth` sets the levels shown (2 unless set), `except` leaves nodes out with what is below them, and
`from: <node>` starts below that node instead of at the top; Done and Record always stay out. The
names follow a node wherever it moves; a `from` that names no node, or a setting the fence does not
know, stops the build. Write the fence
in a view such as `views/Thinking.mdx` and put `{{embed [[Thinking]]}}` on Home: the build keeps the
page current, and Home holds only the embed line, so what you write and what the engine writes stay
apart. A node an embedded view lists counts as reached from Home, as does a node page Home embeds; a
plain link to a view does not, or the Archive would reach every node. `check` warns when Home
repeats a task that a node keeps (`home-copy`): show it with a query instead.

`home` reports the nodes Home links to, the pages it embeds and how many nodes their views put on
Home, links without a page, and top nodes that Home reaches neither directly nor below. `review` asks where those top nodes belong (`home-outside`) instead of
judging Home's width or top summaries, and puts outdated summaries of linked nodes first. `check`
holds Home to no node rule, reports its line issues only as warnings, and counts Home's first list
in `top`. `remove` keeps a node that Home links to, or a node above one, unless forced.

A page you create in Tine by following a new link lands in `pages/`, Tine's default pages folder.
It stays off the tree and outside the node rules until it is placed: `inbox` lists it, and
`move <page> <parent>` puts it on the tree, where it needs a title and a summary like any node.

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
skill records that case ([`skills mistake`](#skills-carry-their-own-code)) or a question about it
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

## Keep one list in several places

Some lists live in more than one place: the plans at the top of Home, a part of a file you read
every week, a board the website edits, a note in a phone app. A mirror keeps them one list. Name its
places in `mirrors`, and `mirror` merges what changed in any of them and writes the result to all:

```js
mirrors: [{
  name: "plans",
  places: [
    { page: "Home", section: "Plans", tasks: true }, // `- ### Topic` blocks under `## Plans`, items as tasks
    { export: "weekly", region: "Plans" },            // a kept part of an export: `### Topic` and `- item`
    { board: "Board" },                               // a page the website's board edits: `- Topic`, `\t- item`
    { note: "keep", item: "ㄴ " },                    // a note source's marked part: a topic line, then its items
  ],
}]
```

An export place accepts an optional `item` marker, such as `{ export: "weekly", region: "Plans", item: "ㄴ" }`.
It must be a string that is not empty after trimming.
When reading items, the mirror removes the trimmed marker and any whitespace after it from both list lines and indented plain lines.
For example, `  ㄴchild` and `  ㄴ child` under `- parent` both become a child item named `child`.

Depth stays the same, and writing still uses `- text`. Without `item`, the marker stays in the text.

Every place shows the list in its own shape, a topic with its items below it. In a page with
`tasks`, an item is a task: a new one is written as `TODO`, a finished one leaves the list and stays
on the page, and a link at the end of a line stays the page's own. Each place remembers what it held
last time, so an edit is told apart from a place that is behind. Edits to different lines all stay;
where two places changed the same lines, the later edit wins and the earlier one's lines go to an
overlap item at the bottom for you to settle. The first run joins every place's list: a topic found
in two places (the same words) takes the items it lacks, an item counts as the same only under the
same parents (two items of the same words stay two), and a new topic goes to the end; a place added
later joins the same way. Each place is in its own file: two sections of one page, a page and a board
of the same name, or two exports of one file are refused. Moving a topic or a parent item keeps each
task's state and link with it, and items of the same words added in two places at once stay as many
as either place has.
When a topic is renamed or removed in another place, the finished items a page kept under it stay,
under the topic now in its place.

A page someone wrote in during the last minutes, or a page or file a run holds (`EXCUDO_HOLD`), is
left alone, and a paused memo (`automation:: paused`) takes nothing: the run waits for the next time.
A page's own uncommitted edits get a commit of their own before the mirror writes, and the pages it
writes get one commit; when that commit fails, the next run commits what it wrote, leaving a later
edit for its own commit. The engine never drives another app: give a
note as the workspace read it (`--note keep=<file>`, `{ markers, blocks }` as `changes` reads a note
source), and the result says what the note should hold (`notes.keep.lines`, `write`). Once the
workspace has written it, `mirror mark --wrote keep=<file> --note keep=<file>` records the lines it
wrote (one per line) as the note's base, and says whether the note read again holds them: whatever
the note holds beyond them is the next run's edit to merge. A note that could not be written keeps
what it had, or the edit the run took from it, as its own, so a run neither reads what it lacks as the
owner removing it nor takes the same edit twice. A note without exactly two markers is not read.

Writing another app from outside is often unsafe: it may need a real click, take your focus, or keep
other text in the same note. So each run also keeps the text a note should hold, and
`mirror text [name] [source] --copy` puts it on the clipboard for you to paste between the note's
markers (without `--copy` it prints the text). Pasting is the dependable way, and a runner that writes
the note itself can fall back to it whenever it cannot write safely. The next run knows a pasted text
as one it prepared, even an older one, so a late paste never undoes what changed elsewhere in between;
what you change after pasting is an edit as usual.

## Run on a schedule

A scheduled run (reflection, skill upkeep, collecting sources) should not change the memo while you
do. `save`, `snapshot`, `ingest` and `archive` hold one graph lock (`.excudo/graph.lock`), so two
of them never commit at once; another waits for up to a minute. Before a run starts, `idle` says
whether it may: exit 0 when the memo is free, 1 while a command holds the lock or a graph file left
uncommitted changed in the last minutes (`--minutes`, 10 by default; an edit synced from a phone
counts), and 3 when a page holds the pause line:

```md
- automation:: paused
```

Write it on any page, from any device, to stop every scheduled run; delete it to resume. Korean
workspaces write `자동 실행:: 멈춤`, and either works in any locale. `--json` tells which files and
pages held it back.

A generated page left uncommitted (a save that stopped halfway) is not counted as an edit. A run that
would rather go on than wait can hold the files someone else is changing: it lists them in
`EXCUDO_HOLD` (one path a line, from the workspace folder; a folder holds what is inside it). `idle`
then no longer waits for them, `save` and `snapshot` leave them out of every commit, and the skills'
checks do not ask to save them. The run records the memo as it was before those edits, and the edits
stay in place for their own commit. Commands that write the memo leave a held page alone and take up
its work at a later run: the build skips its generated section, a collection takes no item for it and
settles nothing on it, a queue report waits, `archive` leaves its finished items (and moves nothing
while the done node is held), a change from the website waits with its batch left open, and skill
upkeep leaves a held skill (any file in its folder) as it stands. Errors in a held page do not stop a
save of other pages. A page added, deleted or renamed a moment ago counts as an edit in progress, by its
folder's time, both names of a rename with it.

An edit can be left finished rather than in progress. `idle --settle N` sorts the uncommitted edits:
one nobody has touched for N minutes whose files pass the check is `settled` (whatever its age), and
the rest stay `recent`. A page left half written, such as a broken title, is not settled however quiet
it is: within `--minutes` it is recent, and past that `unsettled`, which a run holds without waiting for
it. A file changed while the check ran, or first changed then, counts as being written; an error the
check gives a folder (a child folder left without its page) keeps that page and the folder's files from
settling, and the two names of a rename settle together.
`snapshot --settle N` sorts and commits the settled edits on their own under the graph lock, as the
check read them (an editor writing meanwhile keeps its edit in the work tree), and commits nothing
while the memo is paused, so a run
then works on those pages as usual and holds the recent and unsettled ones.
So an edit that stopped a few minutes ago is taken up by this run instead of the next one, and an old
uncommitted edit gets a commit of its own instead of joining a run's commit. Pick N longer than an
edit from a phone takes to sync.

Each step can be recorded with `runs add <step> --status ok|failed|deferred|paused` (`--reason` for why).
`runs` lists the last 7 days newest first; `--days N` changes the range.
Repeat `--step <name>` to select steps, and use `--failed` or `--deferred` to select their status.

Both status flags together select either status. Text details stop at 160 characters unless `--full` is set.
`--json` keeps the complete details and the existing fields; the filters apply to it too.

`backup <folder>` writes a consistent
copy of the cache: the records, the build protection and the watched notes. The agents delete their
logs after a while, so the records may be the only copy of your requests; back them up with the run.
The copy holds your request text, so the folder must be one git ignores, outside the cache and the
graph and not reached through a link; another backup to the same folder replaces the records only
once it is complete.

## Hand work to agents

Tag an open task with `#agent` (`#에이전트` in Korean, or the `queue: { tag }` setting) and it is
queued for agents. `queue` lists the queued tasks, each with what an agent needs to choose as you
would: its node and the node's summary, the work folder of the node's path line or the nearest one
above, the `Decision:` lines of that node and those above it, and the lines already below the task.
The `excudo-queue` skill takes the ready ones (`queue: { limit }` per run, 2 unless set), works
each out by reading only, writes a report in the cache (`.excudo/reports/`) and leaves it under
the task:

```md
- TODO Check the links on the new guides #agent
	- WAITING Review: Two links point to removed pages; the fix is in the report [report](file:///…)
```

The task then waits for you. Write your answer below the report and it is ready again, so the next
run follows it up; close the task or take the tag off when it is done. An agent never marks a queued
task done, changes files in its work folder, or sends anything: it proposes those in the report.
The skill's check confirms each task taken has a report and a report file, and that nothing that
looks private reached the memo.

## See how it stands

A view with a `status` fence shows how the work around the memo stands: the scheduled steps of the
last days (`days: 7` unless set) with their last result, the tasks handed to agents, ready or waiting
for review, how each skill was used and how its checks went in the last 30 days (a skill whose checks
fail more often than they pass is marked), when each outside source was last read, and how many
questions a reflection left for you.

````md
```status
days: 7
```
````

`skills status` and `skills upkeep` show the same check results for the learned skills, and a skill
the agents ran lately counts as in use, whatever the requests that called for it said.

## Skills carry their own code

A skill here is more than a prompt: it embeds code that does part of its work the same way every
time. Each skill folder holds `SKILL.md` and `scripts/`, with at least `scripts/check.*`, which says
whether the skill's requirements were met (exit 0 or 1, `--json` for details), and
`scripts/check.cases.json`, known cases that must pass or fail. `skills lint` feeds the check each
case's facts itself (`--facts <file>`) and watches its exit code, so a check that cannot fail is
caught.

Cases run concurrently (`EXCUDO_CASE_JOBS`: CPU parallelism up to 8 by default, 1 for serial).
Unexpected results are retried alone; if the helper fails, lint runs every case serially.

Searches and changes that must come out the same live in further scripts that `SKILL.md` runs.
A skill must meet every required check; the quality criteria score it from 0 to 100:

| Criterion | Points | What it asks |
| --- | --- | --- |
| Required | - | `SKILL.md` with the folder's name and a description; a script; `scripts/check.*`; its cases judged as expected, at least one that must pass and one that must fail; every script run from `SKILL.md` and every script it names present; scripts that parse; no `FILL IN:` mark left; no tool calls that only one agent understands; no secret; for a learned skill, no passage copied from your requests, and every case recorded for a mistake you pointed out still a case that must fail |
| `runs-check` | 25 | `SKILL.md` runs the check in a command block |
| `triggers` | 20 | the description says when to use the skill |
| `usage` | 20 | each script starts with its usage |
| `portable` | 20 | no path into this machine's home folder |
| `size` | 15 | `SKILL.md` within 500 lines and long enough to follow |

A check that asks whether the work is saved looks at the whole graph, or with `--only <page>` at the
pages a run saved with `save --only`, so it passes while someone writes elsewhere.

A mistake you point out in a skill's work is caught from then on. The agent fixes the work, makes the
skill's check fail on that mistake and adds a case that reproduces it (`expect: "fail"`). For a
learned skill it then runs `skills mistake <name> --case "<case>" --why "<summary>"`. The command
records the case in `skills.json` only when it expects fail and the check fails on it now. It refuses
a summary that copies your request.

Lint keeps each recorded case: removing it or making it pass fails lint, and `upkeep` takes the skill
out of use until it is back. `skills status` shows how many mistakes each skill's check keeps. A
reflection that finds such a correction asks you about one not yet recorded. A mistake of an engine
skill goes to the engine, where it becomes a failing case of that skill's check. Every workspace's
`AGENTS.md` carries this rule.

The engine's skills all score 100, and a test keeps them there. With `conversations` on, a
workspace also learns skills from your requests. `skills candidates` groups requests with similar
words (compared by three-character pieces, so Korean works as well as English) that recur at least
`minRequests` times in `minSessions` sessions within `windowDays`. The `excudo-skills` skill
reads each candidate, dismisses conversation and one-offs (`skills dismiss <id> --reason …`), and
turns recurring work into a skill: its scaffold starts `skills/<name>/`, the agent writes the steps
and the check, `skills lint` scores it, and `skills adopt <name> --from <candidate>` installs it once
it meets the rule and `minScore` (80 unless set); one that does not fit stays a draft.

`skills upkeep` lints learned skills, refreshes installations, counts requests and lists dormant skills.
It holds a skill when a known case only times out or hits a network or authentication error.
An ordinary failing verdict or a score below `minScore` still takes the skill out of use.
An edited installation stays untouched and is reported.
`skills retire <name>` takes a skill out of use; `skills adopt <name> --force` replaces an edited installation.

Use `skills: { keep: ["release-notes"] }` for skills that scheduled steps depend on.
Upkeep never demotes or retires a listed skill.
When its checks fail, upkeep keeps it installed, reports `state: "held"` with the failing checks and exits 1.
This exit code applies to text and JSON output. Fix the checks, then run upkeep again.

Commands that change the record wait for each other. `skills.json` records the skills and dismissed candidates by request
keys, counts and dates, never by the requests' words, and `save` commits it with the skill sources,
refusing when a skill or `reflect.json` would bring words you typed to an agent into git.

A skill goes where its work is done. One for the workspace's own work is installed for the workspace: `.agents/skills/<name>` and
`.claude/skills/<name>` link to its source, and `save` commits the links. One for work in other
folders, even in a single other repository, goes to every folder with `--global --why <reason>` (or
`--requested` when you asked; without either, `adopt` keeps it in the workspace unless the setting is
`install: "global"`; the workspace's own work stays in the workspace even then, with `--workspace`): it
is copied to `~/.agents/skills/<name>` with a `SOURCE.md` naming its source
and linked from `~/.claude/skills` and `~/.codex/skills`.

A linked Git worktree can check these global copies against its own skill sources.
It reads the owning checkout's install record when its own record is absent.
Installing, refreshing or removing those copies requires the owning checkout; the linked worktree leaves them unchanged.

Memo work any workspace does is left to the
engine's skills, and work the agents' own commands already do gets no skill. `upkeep` reports where
each skill's requests were typed, and the skill's check flags one kept in the workspace but asked for
mostly elsewhere, where it is never read, and one for every folder asked for only in the workspace
with no reason other folders need it. Each skill stays where it was adopted, and `--workspace`
brings one back. Run the skill on a schedule to keep this going: a scheduled run makes
and adopts only what clearly fits and leaves the rest for you.

## Work folders on nodes

A node can name the folder where its work happens with a path line, as a list item or under a
heading: `` `/Users/me/work/site` ``. `workspaces` updates the branch
from git, and window names from what an agent passes in with `--input` (a JSON list of
`{ path, branch?, labels? }`, for example exported from a terminal app). A folder that no longer
exists becomes a `workspace-gone` question; it never finishes or removes anything. Requests typed
in a folder land on its node.

A folder several pieces of work happen in, such as a main checkout many tasks use, is shared: each
node whose work happens there has its own path line, naming only the windows of that work, and the
nodes sit below one parent. `workspaces` keeps each line's windows and reports windows no line names
(`unassigned`), and requests typed there land on the parent. `check` warns when nodes in different
top nodes name the same folder (`path-duplicate`) or two nodes' lines name the same window
(`path-window-twice`). With `--input` that carries each workspace's `name` in the app, `workspaces`
also tells the name the memo gives it (`names`): the node that names its folder, a shared folder's
nearest common parent, and for a node with several folders of its own, the node's name with the
folder's. The app renames them; the engine only reports.

When you rename or move a folder, map it in `moved` (`{ "~/old/site": "~/work/site" }`): requests
typed in the old folder land on the node of the new one, and `workspaces` rewrites path lines that
still name the old folder instead of asking about them. When the workspace itself moved, the global copies
of its learned skills installed from the old folder stay its own, and the next upkeep installs them again
naming the new one; the files its exports wrote stay its own too. A Claude Code store moved along with
its folder is not read again for requests already taken from it. A folder you do not track in the memo is
recorded with `workspaces untrack <folder>` (in `review.json`): workspaces in it are no longer asked
about and its requests are marked `untracked`. `workspaces track <folder>` undoes that.

## Keep a file in your format

An export is a file the engine writes from the memo, outside the graph, in a format you show by
example: a plain todo list beside the memo, for instance. Every `build` and `save` rewrites it, so it
follows each saved change, and `export` rewrites it after you edit the memo in the outliner. The
memo stays the one place to change the work: a file someone edited since it was written is left as
it is and reported (`export --force` replaces it), and so is a file the engine did not write.

```js
exports: [{
  name: "todo",
  file: "todo.md",            // from the workspace, or ~/…; never inside the graph
  retitle: ["board"],         // items sources whose tasks should carry a title of their work
  sections: [
    { heading: "- Now", states: ["DOING"], line: "{title}" },
    { nodes: ["Requests"], keyed: true, without: ["someday"],
      line: "- [{key}] {title} {links}", child: "  - {title} {links}", gap: 1 },
  ],
}],
```

A section takes the open tasks matching any of `states`, `nodes` (the node or below), `keyed` (a
link labelled with an items source's `key`) and `tags`, or every open task, and leaves out those
naming or below a `without` entry; journals are read, knowledge nodes are not. A line template names
`{title}`, `{key}`, `{keys}`, `{link}`, `{links}`, `{state}` and `{node}`; `child` writes the notes
and open items below a task. Titles collected from a source are often a form's name; `export` lists
the tasks of its `retitle` sources that still carry one, and the `excudo-export` skill reads
each item and gives it a short title of its work in the memo. The skill also sets up an export from
your example, and its check tells whether each file is current, titled, ignored by git and saved.

A section can keep the order you give its entries. With `order: "file"` (the section needs a heading,
where the engine finds it in the file), every rewrite writes the entries in the order the file has them:
a task the file does not show yet joins at the end, and one no longer picked drops out. Moving entries
alone is no edit by hand, so the next build keeps your order; changing an entry still is one. `deadline`
writes a line below a task that has a `DEADLINE:`, after its notes, naming `{date}` (`2026-10-27`),
`{year}`, `{month}` and `{day}` (`10`, `27`): `deadline: "  - due {month}/{day}"`.

A task can follow on in one place of a file. With `once: true`, a section leaves out a task whose key or
link the file already shows above it, in an earlier section or an included file: a report a tool writes
at the top takes the work under way, and the list below keeps only what the report does not show. When
the report stops showing a task, the next rewrite puts it back in the list.

Two kinds of section hold no tasks. A kept part (`{ heading: "## Notes", keep: "notes" }`) is yours to
write: the engine writes two comment lines around it (`<!-- notes -->` and `<!-- end of notes -->`), and
every rewrite carries over what stands between them, so only an edit outside the kept parts counts as an
edit by hand. Leave the two lines in place: a file without them reads as edited by hand and is left alone.
`pad` (0 to 3, `{ keep: "notes", pad: 1 }`) keeps that many blank lines inside each comment line, so typing
in the part stays clear of them; a rewrite trims the part's own blank edges and adds the pad again, and
changing the pad is no edit by hand. A kept part needs no heading. An included file
(`{ heading: "# This week", include: ".state/week.md" }`) is written as another tool of the workspace
left it (a script your scheduled run calls, say); a file not written yet leaves only its heading.

## See the memo as a website

The engine can write the memo as a website, with cudoc-export, to read it where Tine is not: a
browser on the computer, a phone, a static host. Every node is a page that ends with a folding tree
of the nodes below it; Home and the generated views are pages too, with each `{{query}}` replaced by
the result it had when the site was built; the journals join when asked. A `[[page]]` is a link, a
task is a checkbox with its state, a `DEADLINE:` a date beside its task, and the outliner's own
properties (`collapsed::`, `id::`) are left out. The website keeps every page's address in the memo
(`data-excudo-page`, `data-excudo-line`), so a tool can lead from a line on a page back to its file.

```js
site: {
  out: ".excudo/site",   // from the workspace, or ~/…; outside the graph, replaced whole
  title: "My memo",      // the workspace folder's name unless set
  mode: "site",          // or "standalone": Home as one page carrying everything it shows
  open: 0,               // levels of a node's tree unfolded at first; folded unless set
  journals: false,       // publish the journals under a Journals page
  css: [],               // stylesheets loaded after the engine's
  onSave: true,          // build and save write the website too; false leaves it to site
},
```

Install the exporter once (`CUDOC_SKIP_BROWSER_DOWNLOAD=1 npm install cudoc-export@^1.0.0`; the
engine loads it only when a website is written) and run `excudo site`, with `--open` to open its
Home. A page's sections (query results, the tree below a node) start folded, so a page reads as
its titles first. A small runtime on every page searches the nodes and shows on Home where you left
off. On a wide screen the list of documents on the side is open only along the way to the page; on a
narrow one it leaves the page, and a floating button opens it as a panel over the page, folded, which
closes again by a tap beside it, Escape or a link. Its own buttons fold or unfold it all. The device
remembers what you opened. The runtime needs no server, and the page's policy allows none but the
website's own inbox, when it has one (see below). `check` names a query the website cannot show (`query-unsupported`): it reads
`and`, `or`, `not`, `task`, `[[page]]`, `"text"` and `(page "name")`. Where the folder goes from there
is yours, or the engine publishes it under your own login, as the next section shows.

### Publish it under your own login

One command puts the website on Vercel, where only your Vercel login opens it, and prints a code
to open it on a phone:

```sh
npx --no-install excudo site setup
```

It installs what is missing (the exporter, the Vercel CLI) and writes the website. Then it opens
Vercel's device login in your browser and waits until you allow it there. It creates and links a
project (the folder's name plus `-memo`, or `--project <name>`), sets Vercel Authentication to guard
every deployment, the production address too, and publishes. Last, it opens the address, copies it
and prints the code. A free Vercel account serves it; Vercel's Hobby plan is for personal use. Run
it again and it passes over what is done.

Afterwards `excudo site publish` writes the website and publishes it when something changed. It
publishes nothing while the protection covers less than every deployment, and exits 75 when you
have something to do first, so a schedule can call it and try again later. `excudo site open`
opens the address again with its code; `excudo site status` shows the login, the project, the
protection and the last publishing. The CLI keeps its own login: the engine enters and stores no
credential, and keeps git from sending your last commit's message and author with a deployment.

Host queries stop after 60 seconds; deployments and setup's package installs stop after 10 minutes.
`EXCUDO_HOST_TIMEOUT` changes the query limit and `EXCUDO_DEPLOY_TIMEOUT` changes the deployment limit, both in seconds.
A network or proxy failure makes publishing and inbox reads or closes exit 75; the next run tries again.
It does not ask you to log in again for a connection failure.

An unchanged website makes no host calls when protection was confirmed within the last 24 hours.
After that, or with `--force`, publishing checks protection and the inbox token again before deploying.
Use `--force` after changing the token on Vercel to deploy it immediately.

`site status` prints the saved address, last publishing and inbox token time before its live queries.
Each status query stops after 10 seconds and reports an unreachable host; JSON includes `reachable: false`.
The website's own GitHub requests stop after 8 seconds, and its pages retry failed inbox reads later.

```js
site: {
  publish: {
    project: "my-memo",          // the Vercel project; the folder's name plus -memo unless set
    dir: ".excudo/publish",      // what Vercel receives: the website and its settings, nothing else
    open: ["node", "tab.mjs"],   // opens a link given last, with EXCUDO_LINK=login|site|dashboard; the browser by default
    close: ["node", "tab.mjs", "close"], // closes the login page by the first line open printed
    copy: true,                  // copy the address when opening it
  },
},
```

### Change a task's state on the website

With an inbox, a task's state on a page is a button: tap it to choose TODO, DOING, WAITING, DONE or
CANCELED (for work you decided not to do), or tick its checkbox for DONE. The choice shows at once and waits on the device, marked, until the
memo has it. Within half a second it goes to the website's own function (`api/edit`, which `site
publish` puts beside the pages), which keeps each batch as one issue in a private GitHub repository
of yours. The issue holds each line's address and the states, not the task's words (a save of
Home's board, below, is the one thing whose words it holds).

The pages also ask the function what the memo has not taken yet, when they open, when they come back
into view and every half minute while something waits. So a state chosen on the phone shows on the
computer too, and a change the memo took shows with a check until the next website shows it as
written. While changes wait, the status line offers Bring in now: it leaves a request issue
(`api/sync`), and a machine that looks for it often takes the changes at once instead of at its
usual interval.

Turn it on with one line and run setup again; it picks up where it stopped:

```js
site: {
  inbox: true,   // or { github: { repo: "me/memo-inbox" } } to name the repository, and schedule: false
                 // when a schedule of your own runs site pull
},
```

```sh
npx --no-install excudo site setup
```

Setup logs in to GitHub with its CLI (`gh`; Homebrew installs it on macOS), opening the login page
with the code copied, and makes a private repository for the inbox (`<account>/<project>-inbox`).
Then two pages open.

GitHub's page comes filled in: pick that repository under Repository access,
generate the token and copy it. On Vercel's, add `EXCUDO_INBOX_TOKEN` with the token as its value
for Production and save. Setup waits until the variable shows (it reads its name, never its value),
publishes, and on macOS schedules `site pull` every minute; elsewhere it prints the command for your
scheduler. A token you change later is noticed by the next publishing, which deploys again.

`excudo site pull` brings the changes in. It reads the inbox's open issues, takes them every five
minutes, or at once when a page asked or with `--now`, and commits your own edits of those pages
first. It commits the pages it wrote, then closes the issues (as completed, or as not planned when a
change was noted to settle) and publishes the website again. Only your computer writes the memo and
nothing writes the repository's files, so two changes never meet in a merge.

It takes only the issues of its own website, so two memos may share one inbox. Without git it waits,
since only a commit lets the issues be closed. A publish that has to wait (a login, the protection)
is kept and tried again every five minutes, or at once when asked.

A change is applied only when its line still holds the task the page showed, in the state the page
showed. A task that moved is found by its words when they are on one line of its page. Anything else
is not guessed: a waiting task on today's journal names the line and the state chosen. Each change is
recorded by its id (`.excudo/received.json`), so a batch read twice changes nothing twice. The next
website tells its pages which changes the memo has, and they stop waiting. Vercel Authentication
guards the functions as it guards the pages, and they take requests only from the website's own pages.

For a schedule of your own, `excudo receive --input <file|->` is the step below `site pull`: it takes a
batch, a list of batches, or issues as `gh issue list --json number,body` prints them. A dry run
(`--dry-run --json`) lists under `writes` the pages it would write, and each result names under
`file` the file its change wrote, also when it was received before.

### A dashboard on Home

`dashboard` puts a dashboard at the top of the website's Home, above your own Home. List the sections
you want, in the order you want them; each is a fold, open unless `open: false`, whose title line
carries its numbers, and the device remembers how you leave it. Without the setting Home is as it was.

```js
site: {
  dashboard: {
    sections: [
      { type: "links", title: "Work", items: [{ title: "Tracker", url: "https://…", icon: "T" }] },
      { type: "notes", page: "Board" }, // a board to edit in place: that node's body; needs the inbox
      { type: "tasks", except: ["Paused"] }, // open tasks by state, past deadlines, the top nodes
                                     // (nodes: 8); except leaves out those nodes and the ones below
      { type: "done", weeks: 8 },      // tasks finished week by week
      { type: "agents", days: 14 },    // the agents' sessions by day, their cost, the queue
      { type: "runs", days: 7 },       // each scheduled step's last result, failures first
    ],
  },
},
```

A `group` puts several sections in one fold, each under its own title inside it: `{ type: "group",
title: "Links", sections: [{ type: "links", title: "Work", items: […] }, …] }`. Its parts fold with
it, so they take no `open`; the notepad and another group stay outside. The group's title line adds up
the links of a group of links, and otherwise shows each part's first number.

Links open in a new tab and carry nothing about the page; an `icon` is one or two characters (the
first letter of the title otherwise), since the page fetches no picture from another site. The
numbers are worked out when the website is written, and the dashboard says as of when. A finished
task counts in the week of the commit that turned its open line into `DONE`; a finished task moved to
another page does not count again, and each commit's count is kept in `.excudo/dashboard-done.json`.

The notepad is a board: the body of the node `page` names (below its title and summary, above the
generated subpages), shown to read and edit in place, one item per line; Tab and Shift+Tab move a line
in or out. Save sends the whole body the way a task's state goes, through the website's inbox, with
the digest of the body it was edited from, so its issue holds your words; blank lines go and a line
that is not a list item becomes one. Until the memo has it, every device shows the saved board, marked
as waiting. An edit not saved stays on the device, and Undo edits puts back the saved board.

`site pull` puts a save in the node's body as it is when the node still holds the body it was edited
from. Otherwise it merges line by line with what changed meanwhile, in Tine or from another device:
each side's changes to different lines are kept, and lines both added at one place stay. Lines both
sides changed differently keep the node's version, and the website's lines go to the end of the board
under an item marked as an overlapping edit, for you to settle in Tine or on the board. When the body
a save started from cannot be found (in the node's last commits or the saves before it), a save that
only adds lines is taken, and any other goes whole under that item, since what it removed is unknown.

## Choose a worker and independent reviewers

Set one agent to implement improvements and a list of agents to review the result read-only.
The engine reports preferences and launch arguments; it does not run agents.
Only run `agents set`, `agents accept` or `agents decline` after the owner requests or approves the change.

```js
agents: {
  worker: { tool: "codex", model: "gpt-6.1-sol", effort: "high" },
  reviewers: [
    { tool: "codex", model: "gpt-6.1-sol", effort: "xhigh" },
    { tool: "claude", model: "claude-opus-5-5", effort: "xhigh" },
  ],
  suggest: true,
},
```

`agents` is optional in `excudo.config.mjs`; without it, roles are unset.
`agents --json` reports each value, its source, recommendations and pending suggestions.
An empty or omitted model or effort follows the tool's default.
Codex defaults come from the root `model` and `model_reasoning_effort` in `~/.codex/config.toml`.
Claude defaults remain delegated to its CLI.

Discovery uses no network or API keys.
Codex models come from `~/.codex/models_cache.json` (or the configured `CODEX_HOME`).
Only `visibility: "list"` entries count, ordered by ascending `priority`.
A missing cache means no local list, without an error.

Claude uses the ordered `CLAUDE_MODELS` list in `src/agents.mjs`.
It currently lists Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5.
Their IDs are `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.
Their effort levels are `low`, `medium`, `high`, `xhigh` and `max`.
Update that constant, its tests and both READMEs when the catalog changes.

The first provider entry is the estimated top model; rank is an inference from list order.
Recommendations use the second entry, with `high` for the worker and `xhigh` for a reviewer.
They include a reviewer from the other provider.
If no second entry or supported effort exists, that recommendation stays unset.
An explicit top choice is kept and labeled as the owner's choice, without a warning.

```sh
npx --no-install excudo agents
npx --no-install excudo agents set worker --tool codex --model gpt-6.1-sol --effort high
npx --no-install excudo agents set reviewer --index 0 --tool claude --model claude-opus-5-5 --effort xhigh
npx --no-install excudo agents args worker --for orca
npx --no-install excudo agents args reviewer --index 0 --for cli
npx --no-install excudo agents suggest --new --json
npx --no-install excudo agents accept <id>
npx --no-install excudo agents decline <id>
```

Reviewer numbers on screen start at one; the `--index` argument starts at zero.
`set` can append the next reviewer.
Pass `--model "" --effort ""` to retain tool defaults.

`args --for orca` prints flags for `orca orchestration worker-start`.
`args --for cli` prints flags for the selected tool, without its command name.
Empty values omit their flags.

Suggestions cover newly seen higher entries, Codex's `upgrade` field and missing configured models.
The first observed list is the baseline for detecting newly seen entries.
A top replacement is offered only to a role observed with an explicit top choice.
`args` warns on stderr about pending suggestions and prints the approval command; it still exits zero.
The caller asks the owner before using a suggested model.

`agents suggest --new` marks each emitted suggestion as notified once.
Notification, decisions and the first catalog fingerprint stay in `.excudo/agents.json`.
A declined proposal stays dismissed; `suggest: false` suppresses suggestions.

Settings edits use a managed region at the front of the default exported object.
The file must have exactly one line starting with `export default {`.
Imports, functions, regular expressions, templates and spreads elsewhere stay byte for byte unchanged.
An existing literal `agents` property moves into the region on its first edit.
A nonliteral property or ambiguous export requires a manual edit.

```js
export default {
  // excudo:agents start
  agents: { worker: { tool: "claude", model: "claude-opus-5-5", effort: "high" } },
  // excudo:agents end
  // Other settings stay here.
}
```

Later edits replace only the text between these markers, including the markers.
After each edit, a fresh Node process imports the actual configuration and checks `agents`.
An import failure or differing value restores the original file and reports the required manual value.
A concurrent edit by the owner is preserved.

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

## Keep session instructions small

`excudo instructions` reports procedures that can move from `AGENTS.md` into workspace skills.
Reports only read files, including when the budget is exceeded.
The default limit is 32,768 bytes including line endings; the target defaults to 85 percent of that limit.
Set `instructions: { limit: 65536, target: 49152, auto: false, keep: ["Always", "Project > Safety"] }` to choose both thresholds.
`target` must be a nonnegative integer below `limit`; `null` uses the default.

`excudo check` emits an `instructions-size` warning over the limit and an `instructions-target` note above the target within the limit.
Both allow scheduled saves to finish.
Use `instructions --check` in workspace verification to exit 1 over the limit and 0 otherwise.
It prints one line above the target, or nothing at or below it.

```sh
npx --no-install excudo instructions --json
npx --no-install excudo instructions --check
npx --no-install excudo instructions --limit 65536
```

`instructions: false` or `{ limit: false }` disables the budget and candidates.
`--limit <bytes>` overrides it for one report, including a disabled budget.
It keeps the configured target when below the override; otherwise the target becomes 85 percent of the override.
A missing file reports zero bytes and no candidates.

Pin a heading and its children with `instructions.keep`, using plain heading text or a path joined with ` > `.
Place `<!-- excudo: keep -->` immediately before a heading or a top-level list item to pin its exact text.
An item includes its nested lines; unpinned siblings can remain candidates.
Engine template rules always stay word for word.

`pinned` counts protected sections, items and template rules once, including overlaps.
`movable` is the rest of the file; it may include text that does not qualify as a candidate.
`pinnedBlocks` names the protected blocks with their line ranges and byte counts.
When `pinned` reaches or exceeds `target`, `targetBlocked` is true and a warning names the largest blocks.
The size warning and verification gate include that explanation; the gate still exits only on the limit.

Candidates are `##` or `###` sections or top-level list items of at least 512 bytes.
Headings and items inside fences or comments do not define blocks.
A candidate needs a named workspace skill or procedure evidence: commands, a code fence, numbered steps or three nested items.
Candidates are largest first without overlap; eligible whole sections take precedence over their items.

The most mentioned workspace skill is the suggested target, counting backticked names and skill paths.
Skills come from `skills.dir` and `.agents/skills/`; engine skills are excluded and ties use name order.
Without a named workspace skill, a new name comes from its heading, avoiding existing names.
A heading without Latin letters or digits uses `workspace-procedure-<line>`.
A named engine skill alone does not make a general rule into a workspace procedure.

Move a complete heading section or top-level list item without retyping its text:

```sh
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "Keep release evidence." --dry-run
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "Keep release evidence."
```

The target must already be a workspace skill, never an engine skill.
The command refuses pinned text, engine template rules and partial blocks.
Without `--since`, it also refuses untracked or changed `AGENTS.md`, target `SKILL.md` and existing reference files.
It appends the original bytes to `skills/<skill>/references/<name>.md`, creating a heading when needed.
It adds one reference link under a reusable references heading in `SKILL.md`.

It replaces the block with at most two `--pointer` lines.
It adds "Details in the `<skill>` skill" unless a details pointer is supplied.
It writes only those files and the instructions cache; `--dry-run` writes nothing and `--json` describes the result.
The command never creates a skill.

Use `--since <before>` to move several blocks before one commit, where `<before>` is the saved baseline commit.
It accepts uncommitted instructions and skills only when the baseline's template rules, pins and removed hunks remain preserved.
Refresh the report for each move's current line range.

Removed hunks split at baseline level-two/three heading sections and top-level list item boundaries.
Each piece must occur as contiguous lines within one file.
Its count across the corpus must be at least the baseline count.
Adjacent pieces can move to separate references.

Both corpora contain `AGENTS.md` and the skills' Markdown; blank-only pieces are ignored.
The check reads the baseline from git and compares HEAD, or the working tree with `--uncommitted`.

Run the skill check with `--trim-since <before> --uncommitted` before committing.
That permits pending instructions, skills, their record and links while still checking unrelated unsaved work.
Without `--uncommitted`, the check also requires the moves to be saved.

The `excudo-skills` skill trims on request and preserves rules every session needs in the pointer lines.
With `instructions.auto: true`, scheduled upkeep starts over `limit` and continues to `target`.
It uses the move command, largest first, only where an existing workspace skill's description covers the procedure.
A new workspace skill needs scripts already present, a check and known cases; otherwise the block remains in the report.

Preservation, `excudo check` and `skills lint` must pass before one commit saves instructions and skills together.
A failed check restores the run's changed files from the baseline and removes only files it created.
Without `auto`, scheduled upkeep only reports candidates.
If protected bytes make the target unreachable, automatic upkeep still moves material while over the limit.
Once within the limit, it reports the protected blocks and stops instead of pursuing an unreachable target.

JSON identifies the file with `file`, `exists` and `bytes`.
The budget has `enabled`, `limit`, `target` and `auto`.
It reports `aboveTarget` and `over`, plus the candidate `threshold`.

`candidates` identifies each block by `kind`, `headingPath` and inclusive `startLine`/`endLine`.
It adds `bytes` and `target`, plus `engineSkills` and `reason`.
Candidate text is never printed.

`lastTrim` holds its size and commit, or `null` before any trim; `growth` is the byte difference, or `null` without a baseline.
A successful move records this baseline in the ignored `.excudo/instructions.json` cache.

Committed preservation refreshes the cache when `AGENTS.md` and the skill files are saved.
Unrelated unsaved memo edits keep the failing exit code and do not block the refresh.
`--uncommitted`, `--facts` and `--self-test` never refresh the cache.
The text report also prints the growth when a baseline exists.

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
  labels: {},         // override generated words
}
```

`excudo.config.mjs` remains outside the graph. Metadata comes last when order does not name it.
Label groups such as `messages`, `review` and `recommendations` merge entry by entry.
The note prefixes and the question tag (`markers`: `Idea:`, `Decision:`, `#check`) are recognized in
every language, whatever the locale.
The default Home queries show only DOING expanded. After changing locale or region labels,
review the existing generated boundaries before a forced rebuild.

## Tine and phone sync

Open the graph folder (default `notes/`) in Tine. To switch a running macOS app to another graph,
fully quit it first, then run:

```sh
TINE_GRAPH=<graph-folder> /Applications/Tine.app/Contents/MacOS/tine <graph-folder>
/Applications/Tine.app/Contents/MacOS/tine doctor <graph-folder>
```

Passing a graph to a running app through `open -a` or `tine open` does not switch it.
`tine export` failed on 0.6.986 at “Rebuilding the query index…”; it works on 0.7.1, but use
`tine doctor`, not an export, to validate a graph.
Install Tine from [tine.page](https://tine.page) if absent.

Share only the graph folder with Syncthing, enable file watching and 30-day trash-can versioning,
and connect it on Android with Syncthing-Fork. Open the synced folder in Tine. `.stignore` keeps
views, outliner backups and the engine's temporary files on the computer. Capture urgent notes in journals; distill files them
into nodes. Keep the workspace's engine, skills, caches and review decisions outside phone sync.

## Develop

Test files run sequentially so CLI timeout checks stay reproducible.

```sh
npm install
npm run example
npm test
npm pack --dry-run
npm run release:check
```

ESM JavaScript, no build step, node:test. Update both READMEs and both locales together; a test
checks that both locales have the same messages. CI runs tests with Node 22 and 24 on Linux, macOS and Windows.
It also installs a packed tarball. Tests using macOS apps or POSIX fixtures skip elsewhere.

Library functions that read git history (`check`, `review`, `keepCandidates`, `move`, `archive`) return
promises; blame runs for several files at once.
The engine uses the registry package `@cudoment/cudoc@^1.1.0`.

The tests cover the committed example, depth 6, generated protection/collapse, NFD names, commands,
dated git reviews, code-example preservation, cache loss, moved protection baselines, grouped keeps,
the CLI interview through answer application, save and batch revert, archives, installation,
environment lookup, unreadable history, history caches, ages across moves and archive guards. Tine doctor and model-free Codex
skill discovery run when installed, otherwise skip with their prerequisites. Manual Claude Code
and Codex interview scenarios use a copy of `test/fixtures/messy/`, never personal notes.

When changing the engine version, update the setup skill's version range too; tests enforce this.
Before publishing, `npm run release:check` (which `npm publish` runs first) checks that the clone is
committed on `main`, the version is not tagged yet, the setup skill installs it, the tests pass, the
example is current, every skill scores 100 and the package holds what it should. A workspace that
uses a local clone (`file:`) keeps running the clone; to move it to a release, run
`npm install excudo@^<version>` there and its checks. Linked skills point through
`node_modules`, so they follow either way.
`src/dialects/logseq.mjs` contains outliner syntax; `skills/` is the sole skill source and the two
agent folders only link to it. Keep personal notes outside this clone or in ignored `private/`.
The package includes skills, templates and dummy example notes, and excludes caches.

List words that must never be published (your own names, hosts, issue keys) one per line in
`private/denylist.txt`. When a file git tracks or would add holds one in its text or path,
`node scripts/denylist.mjs`, a test and `release:check` fail. Without the list they compare nothing
and pass.

MIT
