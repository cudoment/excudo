---
name: excudo-capture
description: Add a task, idea, decision, or note to an Excudo memo in its proper node and update the summaries above it. Use for "add this to my memo", "remind me to", "메모해 줘", "메모에 추가해 줘", or "기억해 둬".
---

# Capture a note

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.

```sh
npx --no-install excudo tree
npx --no-install excudo find <words>
```

Read the likely node's authored body. Add the owner's task, idea or decision once, where it belongs.
Tasks use `- TODO`, `- DOING`, `- WAITING`, `- DONE`; ideas use `Idea:` (`생각:`),
decisions `Decision:` (`방침:`). Use `[[Page]]` for references. If a conflicting, duplicate or
past-dated line is already there, ask just one short question; capture should be quick.

Prefer an existing parent. A new child is a Markdown file with `# Title`, a short summary on the
very next line and the body, in the folder beside its parent's file (`X.md` → `X/`). Under any
heading, start its content on the next line and leave one blank line above the heading. A heading
takes one paragraph (the summary under the title); write further text as list items. Page names
must be unique across the graph. Ask before adding a new top node; if the first list is full,
propose a parent or grouping. Keep paragraphs and tables before lists; only headings follow lists.
Do not edit generated subtree sections, and do not mark tasks done without the owner's word. A Home
that does not start with `generated::` (`생성::`) is the owner's page, changed only when they ask: if
the note deserves a place there, suggest the `[[link]]`, and add it only when the owner asks.

After inserting the note, check the summaries from that node up to the first list:

```sh
npx --no-install excudo tree --path <node>
npx --no-install excudo check
npx --no-install excudo save "<what was added>"
```

Rewrite only summaries made inaccurate by this note; keep the top summary within 60 characters
and other summaries within 120 (or the workspace's limits). Then run the skill's check with a few
words of the note and its node; fix what it reports, save and rerun it until it passes. If the same
words are rightly in two places, say so instead. When you saved only your own pages (`save --only <page>`, as a scheduled run does while someone
writes elsewhere in the memo), give the check the same pages with `--only <page>`. This skill's scripts are in its folder: `.agents/skills/excudo-capture/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-capture/scripts/check.mjs --text "<words of the note>" --node <node>
```

Report the added note briefly.
Pass on the first-list status only if it has a problem. If that status, `node-large` or
`node-body-long` suggests clutter, add one invitation: "정리 인터뷰를 해 볼까요?"
("Would you like a cleanup interview?"). Use `review --node <node>` to check body-length candidates.
