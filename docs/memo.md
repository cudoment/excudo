# Your memo

[README](../README.md) | English | [한국어](memo.ko.md)

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
