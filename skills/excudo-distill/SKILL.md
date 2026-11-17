---
name: excudo-distill
description: Keep an Excudo memo short at the top through a cleanup interview that asks what to move, archive, remove, merge or keep; arrange part of it as an outline the owner gives; sort a raw memo the owner pastes and ask before placing any of it. Use for "tidy my memo", "my memo is cluttered", "arrange this project like this", "organize this raw memo", "메모 정리해 줘", "메모 업데이트해 줘", "저널 분류해 줘", "메모 줄여 줘", "물어보면서 정리해 줘", "이 프로젝트 내용을 아래로 정리해 줘", or "이 메모 정리해 줘".
---

# Distill through a cleanup interview

Assess whether the first screen is readable and folded details can still be found. Keep summaries
current without assuming references are clutter. Locate `excudo.config.mjs` in the current
folder or its ancestors, then `EXCUDO_ROOT`, and enter that workspace. If there is neither,
stop: say this folder is not in an Excudo workspace and ask which one to use. Use only the
local engine. First verify `node_modules/.bin/excudo` exists and is executable; if it
is missing, tell the owner to run `npm install` there and stop before invoking npx.

Start in this order, before editing any file:

```sh
npx --no-install excudo snapshot
npx --no-install excudo review --json
npx --no-install excudo inbox
npx --no-install excudo check
git rev-parse HEAD
```

Keep that commit (the snapshot or what was already committed): the check at the end compares with
it. When the workspace reads agent requests (`conversations` in `excudo.config.mjs`), also read
what the owner asked agents for since the last tidy-up, and the nodes' workspace lines:

```sh
npx --no-install excudo requests --for cleanup --json
npx --no-install excudo workspaces --dry-run
```

Read each request's whole `text` in the JSON (the plain listing shortens long ones). From the
requests take only work the owner handed out, scope they changed and decisions they made;
an agent's proposal is not the owner's until they accepted it. Text the owner pasted shows as
`[pasted N]` in `text`, with its length and start in `pasted`: it is context someone else wrote (a
review, a specification, a log), never the owner's decision. Each request names the node its
folder belongs to. Offer them as one question in the first batch, each with the line you would add
and where; never copy a request verbatim. A request marked `untracked` comes from a folder the owner
does not track in the memo: offer nothing for it. If the workspace `AGENTS.md` names a way to read window
names (a terminal app's export), pass it to `workspaces --input`.

A folder no node names (a request's folder, or an unplaced workspace) is one question: which node
it belongs to, or whether the owner tracks it at all. Record "not tracked" so it is not asked again;
a renamed folder belongs in `moved` in `excudo.config.mjs` (old path to new path) instead:

```sh
npx --no-install excudo workspaces untrack <folder>
```

A folder several pieces of work happen in (a main checkout that many tasks use) is shared: each node
whose work happens there keeps its own path line naming only the windows of that work, and those
nodes sit below one parent. `workspaces --input` keeps each line's windows and reports the windows
no line names (`unassigned`); ask which work each belongs to. It also reports the name each app
workspace takes from the memo (`names`): the node that names its folder, the nearest common parent
for a shared folder, and the node's name with the folder's for a node that has several folders of
its own. The engine never renames them. When the workspace keeps its own skill for naming the app's
workspaces (its `AGENTS.md` or its skills name one), that skill does the renaming and this one only
reports the names that would change. Otherwise, when the owner asks to name the app's workspaces
after the memo, show the renames first, then make them with the app's own command.

Remember the first-list status including visible source rows, node count, line count and open-task
count. Also record questions, merged reasons and suppressed questions from review stats. Read nodes
from the top list downward. Each review candidate is one question with an id, location and `reasons`.
Read all reasons together; never ask separate questions for reasons attached to the same candidate. If git
history is too short for age-based candidates, use content and top-list candidates instead.

Routine changes may be made without questions: archive items the owner already marked `DONE`,
update workspace lines with `workspaces`, clean empty headings/blank lines, shorten a summary without changing its meaning, and fix
checker-reported formatting. Matching text alone does not establish duplication: repeated tasks
are separate items until the owner says otherwise. If no routine changes are
needed, leave the graph byte-for-byte unchanged until the first answer. `snapshot` only commits.

```sh
npx --no-install excudo archive
```

Everything that removes content, changes meaning, or relocates it needs an answer first. This
includes moving lines or nodes, archiving whole nodes, marking tasks done, merging/splitting nodes,
turning ideas into tasks, discarding journal items, or rewriting ambiguous statements. Never treat
agent completion, workspace activity or a status at an outside source as evidence that a task is
done: `source-closed`, `source-gone` and `workspace-gone` candidates are questions for the owner.
Knowledge nodes (the nodes of `repo` and `page` sources and those below the `knowledge` setting) are
kept by agents from their sources; review leaves out their length and age, and so does the interview
unless the owner asks about them. Ask about uncertainty now;
`#check` (`#확인`) is only for a fact the owner cannot answer yet.

The first question batch always concerns the top list. Consider every top node's current relevance
and summary, using `top-warning`, `top-inactive` and top-level `summary-behind` candidates. When the
owner keeps Home (`npx --no-install excudo home` says so), that list is theirs: never judge it
or change it on your own. Start with `home-outside` candidates (where a top node outside Home belongs)
and outdated summaries of the nodes Home links to, and offer Home links as text; add them, or rework
Home in any other way, only when the owner asks, to that request and no further. Also find
clutter the engine cannot recognize: already implemented plans, outdated scope, background/history,
ambiguous lines and paraphrased duplicates. Explain the combined evidence for each candidate.
No open tasks or children does not prove a reference is useless or finished. Ask how the owner uses
it and whether its current location helps lookup; offer keep before suggesting archival or removal.

Before the first batch, explain once: moved material is still available by expanding or searching;
removed material stays in git and can be found with:

```sh
npx --no-install excudo find <words> --history
```

Ask at most **four candidates per batch**, starting near the first list and with the greatest effect
on its length. For each, give its path and line, evidence, and 2–4 suitable choices from move down,
archive as finished, remove, merge, rewrite, keep, later. Put the recommendation first. Recommend
moving reusable methods, reasons, references and finished results down, and name a destination
parent. Recommend removal only with evidence the content will not be needed again. Prefer moving
before removing. If a multiple-choice question interface exists, use it; otherwise number the
questions so the owner can answer "1 move, 2 remove". Wait for answers. "Use your recommendations"
authorizes that batch's recommendations; incorporate any new facts in the answer.

Apply and save each answered batch:

```sh
npx --no-install excudo move <node> <parent>
npx --no-install excudo archive <finished-node>
npx --no-install excudo remove <node>
npx --no-install excudo review keep <candidate-id>
npx --no-install excudo tree --path <affected-node>
npx --no-install excudo save "<what this batch changed>"
```

A page waiting in `pages/` (listed by `inbox`) is placed with `move <page> <parent>`; then give it
a title and a summary. Use only commands that match the answer. `archive <node>` refuses open tasks. `remove` protects
open tasks and decisions; use `--force` only when the answer explicitly authorizes deleting those.
Follow up on the remaining link locations printed by `remove`: turn the reference into plain text,
or ask about removing the referencing line. For a line moved down, create a child with a title and
summary and move the detail there; leave no manual child link in the parent because `build` writes
the subtree. Never calculate or handwrite generated trees.

After the last batch, if you read requests, mark them read up to the `until` in that JSON, so the
next tidy-up starts after them and a request that arrived meanwhile is not skipped:

```sh
npx --no-install excudo requests mark --for cleanup --until <until>
```

Record "keep" with `review keep <candidate-id>` once for the whole question, including every reason,
so it is not asked again for `keepDays` or until content changes.
Record nothing for "later". After a move or removal, inspect summaries up to the top and revise
those now inaccurate. If a recording node exists, add one line about the answered batch.

When candidates remain, state their count and ask whether to continue. Stop when the owner stops
or no candidates remain. Report the first-list status before and after, changes in nodes/lines/open
tasks, counts moved/removed/kept, visible source rows and suppressed questions. Check that moved
details can still be found with `tree --path` and `find`. Source-row counts exclude query results and
screen-width wrapping; compare DOING totals separately. Mention the recording node in one line if
used. When the owner requests a revert, use `git revert <batch-commit>` for that saved batch.
This restores its graph changes together with the review decisions, source records, reflection
candidates, learned skills and settings saved with them, preserving earlier answers and user edits.
Rerun review, check and lookup after a requested revert.

## When the owner gives the structure

When the owner hands an outline for part of the memo ("put the project like this"), the outline is
their answer for everything it names. Run the start commands above, then:

1. **Match each line of the outline** to a node, an open task, or nothing yet. A node the outline
   names differently is renamed; a node missing between two levels of the outline is merged into the
   one that takes its place; a line that matches nothing becomes a task in the owner's words on the
   node above it. Nodes the outline does not mention stay as they are.
2. **Ask once about what the outline leaves out** below the nodes it names: open tasks, decisions,
   references. Offer keep as tasks, fold below as plain lines (a folded item such as "earlier tasks",
   so Home's task queries stop listing them), defer with the later tag, finished (only on the
   owner's word), or remove. Count open tasks from each node's own lines: the counts `tree` shows
   include a node's descendants.
3. **Apply with the engine's commands.** Renaming a file by hand leaves links and the build
   protection behind (the next build then refuses the node); `rename` carries both:

   ```sh
   npx --no-install excudo rename <node> <new name>
   npx --no-install excudo move <node> <parent>
   npx --no-install excudo remove <node>
   ```

   To merge, `move` the children to the node that stays, move the text there by hand, then `remove`
   the emptied node; it refuses while open tasks or decisions remain. `rename` reports a link in the
   owner's Home (pass `--home` to update it when the owner's request covers Home, otherwise tell
   them) and settings in `excudo.config.mjs` that name the node (change those in the same batch).
4. **Keep the path lines with the work** they describe (a folder shared by several nodes as above),
   then check summaries up to the top with `tree --path`, `save`, and report the app workspace
   names that now differ from the memo.

## When the owner pastes a raw memo

A raw memo is a list the owner copied from somewhere else: another notes app, a chat, a paper list,
with `ㄴ` or dashes for nesting, lines without a title, addresses. Most of it is often in the memo
already, some is finished, and the rest needs a place. Never place any of it before asking. Run the
start commands above, save the pasted text to a file outside the workspace, then sort it:

```sh
node .agents/skills/excudo-distill/scripts/raw.mjs <pasted-file> --json > <raw-file>
```

Each pasted line becomes one entry: `node` (it names a node), `open` (an open task already says it),
`done` (a finished task or the done node says it), `note` (a note says it) or `new`, with the memo
line it matched. A `similar` match (`how`) is only likely. Lines under another (`under`) belong to
that one; a line with lines below it (`group`) is a heading of the owner's list.

1. **Show the sorting first,** grouped: already in the memo (with the node), finished or archived,
   only similar, new. Say how many lines need nothing.
2. **Ask before changing anything,** at most four questions per batch, each with evidence and the
   recommendation first: which areas the owner is working on now; which lines are tasks of everyday
   life; what to shelve (the way the workspace shelves work, named in its `AGENTS.md`, or archive);
   where each new line goes; whether a similar line is the same as its match. A pasted line that
   reads as finished is a question too: only the owner decides that something is done.
3. **Write each answer into the entry's `answer`** in `<raw-file>` (`add <node>`, `move <node>`,
   `shelve`, `done`, `merge`, `keep`, `skip`), so the check can tell an answered change from an
   unasked one.
4. **Apply only what was answered,** with the engine's commands and the capture skill's way of adding
   a line (its node, the summaries up to the top), then save each batch. Change Home only as the
   owner's answer covers it.

Finish with the check below, adding `--raw <raw-file>`.

## Check

Before the report, run the skill's check with the commit from the start; add `--requests` when you
read requests, `--allow-removed` only when the owner approved removing or rewriting open tasks, and
`--allow-done "<task words>"` once for each open task the owner said is finished. Any other task
closed since (`DONE` or canceled) fails the check; archiving what was already `DONE` closes nothing.
When you saved only your own pages (`save --only <page>`, as a scheduled run does while someone
writes elsewhere in the memo), give the check the same pages with `--only <page>`.
Fix what it reports, save and rerun it until it passes, and report its result. This skill's scripts are in its folder: `.agents/skills/excudo-distill/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-distill/scripts/check.mjs --since <commit> --requests --allow-done "<task words>"
node .agents/skills/excudo-distill/scripts/check.mjs --since <commit> --raw <raw-file>
```
