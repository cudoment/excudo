---
name: excudo-export
description: Keep a file outside the memo, such as a todo list, written from the memo's current work in a format the owner shows by example and rewritten whenever the memo is saved; give tasks still titled by their outside source a short title of their work. Use for "keep a todo file like this", "export my tasks to a file in this format", "이 형식으로 할 일 파일을 만들어 줘", "작업 목록을 파일로 계속 최신화해 줘", or "요청 제목을 요약해서 목록에 보여 줘".
---

# Keep a file in the owner's format

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.
This skill's scripts are in its folder: `.agents/skills/excudo-export/scripts/` from the
workspace root (`~/.agents/skills/…` for skills installed with `--global`).

The memo is the one place where work changes; an export is a file the engine writes from it. Every
`build` and `save` rewrites each export, so the file follows every saved change. Start with what
is set and where it stands:

```sh
npx --no-install excudo export --dry-run --json
npx --no-install excudo sources
```

## Set up an export from the owner's example

Read the example for its shape only, never copying its content into the settings or the memo:
which work it lists (in progress, below some nodes, with an issue key, with a tag) and what it
leaves out, how one entry reads, what stands below an entry, headings, and blank lines between
entries. Then write `exports` in `excudo.config.mjs`:

```js
exports: [{
  name: "todo",                 // lowercase letters, digits, - and _
  file: "todo.md",              // from the workspace, or ~/…; never inside the graph
  retitle: ["<items source>"],  // its tasks get a short title of their work in the memo
  sections: [
    { heading: "- Now", states: ["DOING"], line: "{title}" },
    { nodes: ["<node>"], keyed: true, without: ["<tag or node>"],
      line: "- [{key}] {title} {links}", child: "  - {title} {links}", gap: 1 },
  ],
}],
```

- A section takes the open tasks that match any of `states`, `nodes` (the node or below it),
  `keyed` (a link labelled with an items source's `key`) and `tags` (`#tag` or `[[page]]`), every
  open task when none is given, and leaves out a task that names a `without` entry or sits below a
  node of that name. Journals are read; knowledge nodes and the engine's own nodes are not.
- `line` writes each task: `{title}` (its words without marker, links and tags), `{key}` (empty
  when it has none), `{keys}`, `{link}`, `{links}`, `{state}`, `{node}`. `child` writes the notes
  and open items below it; a picked task below another is written there, not again. `gap` blank
  lines go between entries, one blank line between sections; an empty section keeps its heading.
- When the owner ranks the entries in the file (puts what matters first), give the section
  `order: "file"` and a heading: rewrites keep the order the file has, new tasks join at the end, and
  moving entries alone is no edit by hand. Where the example shows a due date below an entry, add
  `deadline` with `{date}`, `{year}`, `{month}` or `{day}` (`"  - due {month}/{day}"`): it writes the
  task's `DEADLINE:` after its notes.
- Where a part above the list already follows some tasks (a report another tool writes, an earlier
  section) and the owner wants each task in one place, give the list `once: true`: it leaves out a
  task whose key or link the file shows above it, and takes the task back when that part drops it.
- Where the example has a part the owner writes freely (notes between the lists), give it a kept
  part, `{ heading: "<heading>", keep: "<name>" }`: every rewrite carries over what stands between
  its two comment lines; tell the owner to leave both lines in place, since a file without them reads
  as edited by hand and is left alone. Add `pad: 1` (up to 3) when the owner types there often: that
  many blank lines stay inside each comment line. The heading may be left out. Where a part comes from another tool of the workspace (a script of its
  scheduled run), include that tool's file, `{ heading: "<heading>", include: "<file>" }`. Neither
  takes any other field, save `pad` on a kept part.
- Choose a file name nothing else uses (`ls`). A file inside a git working tree goes into that
  tree's `.gitignore`: it changes with every build, and the memo is what git keeps.

```sh
npx --no-install excudo export
```

Compare the file with the example. Where the example shows work the memo lacks or holds otherwise
(a task not open, a link or key missing, an item that belongs below another, a state), list each
with the memo change that would give it, and ask before changing the memo. Never change a task's
state or mark work done on your own.

## Give tasks a title of their work

`export` lists the tasks of its `retitle` sources whose line still carries the title the source
gave. Read each item at its source (in the browser, as the sources skill reads one, or with a
helper the workspace's `AGENTS.md` names), and replace that title in the memo line with a short
title of the work in your own words, in the memo's language. Keep the marker, the link and the
tags; leave out what is not the work (a board name, the requester). Then save:

```sh
npx --no-install excudo save "<titles given>"
```

## Keep it current

A file reported as changed by hand is left as it is: ask the owner to move the change into the
memo, then run `npx --no-install excudo export <name> --force`. Never replace a file the engine
did not write without the owner's word. After the owner edits the memo in the outliner, `export`
(or the next `save`) brings the file up to date.

In a scheduled run nobody can answer: give titles to the listed tasks whose source can be read,
and leave everything else (an item that cannot be read, a file changed by hand, a memo change the
example asks for) for the report.

## Check

```sh
node .agents/skills/excudo-export/scripts/check.mjs
```

Fix what it reports, save and rerun it until it passes (`--name <export>` checks one). Report the
file, how many tasks it holds, the titles given, and what waits for the owner.
