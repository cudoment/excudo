---
name: excudo-follow
description: Follow a note the owner keeps up to date in another app (a phone notes app, a shared document) and bring the part between its marker lines into an Excudo memo, merging each thought into the node that already holds it, giving new ones a place, and settling the ones the owner removed; it keeps `note` sources only. Use for "bring in my notes app", "sync my thinking note", "follow my Keep note", "Keep 메모 반영해 줘", "내 생각 메모 연동해 줘", "메모 앱에 적은 걸 반영해 줘", or "노트 동기화해 줘".
---

# Follow a note kept elsewhere

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.
This skill's scripts are in its folder: `.agents/skills/excudo-follow/scripts/` from the
workspace root (`~/.agents/skills/…` for skills installed with `--global`).

Some owners keep their current thinking about a few areas in one note in another app and change it
there, while the memo stays the place where it is sorted. A `note` source follows such a note: only
the part between two marker lines (`between`, `---` unless set) is read, and a blank line ends a
block whose first line is its heading. The note may hold other things too, such as accounts and
codes: the engine cuts the marked part and drops lines that look private inside the page, so the
rest never leaves the browser, and checks again what the page returned.

## Set it up

When the owner asks to follow a note, add the source to `excudo.config.mjs` (`sources`):

```js
{
  name: "thoughts", kind: "note", label: "My thinking note", url: "https://…",
  between: "---",      // the owner's marker line
  removed: "settle",   // "ask" (default): ask about removed thoughts; "settle": the owner said removal means finished or dropped
  node: "Ideas",       // optional: where a thought goes when nothing else fits
  script: async () => "the note's text, one line per line",
}
```

The script runs in the logged-in page and returns the note's text with its real line breaks (read
the app's paragraphs; `innerText` of a whole editor often doubles them). Say in the workspace
`AGENTS.md` how the browser is opened and logged in for it. Tell the owner to put the marker line
above and below what to follow. Ask which nodes the areas belong to only when `where.mjs` cannot
tell. The owner's choices for this source (marker, `removed`) live in its settings alone, and git
keeps when they changed; `AGENTS.md` need not repeat them.

## Bring it in

1. Read the note as the sources skill's "Read a source in the browser" says
   (`excudo-sources/SKILL.md` next to this skill's folder): the login check the workspace
   `AGENTS.md` names, the source's script in its page, the result in a temporary file outside the
   workspace. Then keep what changed, also outside it:

   ```sh
   npx --no-install excudo changes <name> --input <file> --json > <changes-file>
   git rev-parse HEAD
   ```

   `unmarked`: the note has no pair of markers. Tell the owner to put them around the part to
   follow and stop; never read a missing part as thoughts removed. `same`: nothing to do. `new`:
   the first reading; every block is new to the memo, and much of it may be there already.
   `changed`: blocks added, changed (lines added and removed) and removed since the last mark.
2. See where each block belongs:

   ```sh
   node .agents/skills/excudo-follow/scripts/where.mjs --source <name> --input <file>
   ```

   It lists the memo lines that already hold each heading and line, best first.
3. Merge or create. A block or line the memo holds goes into that place: merge it, enrich the node
   with what is new, keep one place for one thing, and update the summaries up to the top. A thought
   nothing holds gets a place: a line in the closest node, or a child node with a title and summary
   when it has several lines. Never make a new top node without asking; in a scheduled run put it
   in today's journal, or under `node` when the source sets one. Keep the owner's words; a thought
   that names work to do is written as a task the way the workspace writes tasks, and nothing is
   marked done because it is new. A block whose lines moved under another heading is a move.
4. Removed thoughts. With `removed: "ask"`, ask about each (a scheduled run lists them in the
   report). With `removed: "settle"`, the owner has said a removed thought is finished or dropped:
   look where `where.mjs` points, and in the memo, journals, records and the repositories the
   memo names. Finished: mark its task `DONE` and archive as the workspace does. Otherwise dropped:
   take its lines out (git keeps them; `find --history` finds them). Say which was which.
5. Never write a line the engine dropped or anything else that looks private, even if the page
   showed it; mention only that something was left out. Never type into the source.
6. Mark, save and check:

   ```sh
   npx --no-install excudo changes mark <name> --input <file> --expect <token>
   npx --no-install excudo save "<what the note brought in>"
   node .agents/skills/excudo-follow/scripts/check.mjs --source <name> --input <file> --changes <changes-file> --since <commit>
   ```

   If marking says the note changed again, read it again first. Fix what the check reports, save
   and rerun it until it passes. Remove the temporary files.

## Scheduled run

Nobody can answer. The run hands over the file it collected; read nothing else. Do steps 2–6:
merge, create (new places as above), and settle removed thoughts only when the source says
`removed: "settle"`. Report what went where, what was settled as finished or dropped, how many
private lines were left out, and what waits for the owner.
