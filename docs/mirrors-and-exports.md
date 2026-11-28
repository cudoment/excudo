# Mirrors and exports

[README](../README.md) | English | [한국어](mirrors-and-exports.ko.md)

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
