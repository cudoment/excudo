---
name: excudo-sources
description: Bring outside work items (issue trackers, team boards, requests, mentions) into an Excudo memo through the owner's logged-in browser, and create an outside item when the owner asks; repositories and pages kept as knowledge belong to excudo-recall, a note followed from another app to excudo-follow. Use for "pull my issues into my memo", "check my requests and mentions", "bring in my tracker's work", "지라 가져와 줘", "팀 게시판 확인해서 메모에 반영해 줘", "외부 할 일 가져와 줘", or "지라 이슈 만들어 줘".
---

# Connect outside sources

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.

```sh
npx --no-install excudo sources --json
```

Each source gives the page to open (`url`), what to collect (`collect`), optional `notes` on how,
whether its listing is `complete`, its `actions`, and whether it has a collecting `script`. Each kind
of source has one skill: this one handles `items` sources and skips turned-off ones (`enabled:
false`); `repo` and `page` sources keep knowledge nodes up to date and belong to the recall skill;
`note` sources (a note the owner keeps in another app) belong to the follow skill. If no source fits
the request, offer to add one to `sources` in `excudo.config.mjs` (the setup skill describes the
fields) and stop.

## Read a source in the browser

Every skill that reads a source in a browser (`items`, `page` and `note` sources) does it this way;
the recall and follow skills point here.

1. Use the browser control this environment provides: a browser automation tool, an app's built-in
   browser, or a test browser. The workspace `AGENTS.md` may name the one to use, how to open it and
   how to check the login first; follow it. Work in the owner's logged-in session; never type, read
   or store passwords, tokens or cookies.
2. Reuse a tab that already shows the site; otherwise open the source's `url`.
3. If the source has a script, evaluate the expression this prints in that page; it returns the
   source's JSON:

   ```sh
   npx --no-install excudo sources script <name>
   ```

4. If a sign-in page appears or the script fails because the page is not signed in, stop and ask the
   owner to sign in, then continue. Never pass on an empty result from a page you could not read:
   from a complete source it reads as "all gone".
5. Save the result to a temporary file outside the workspace. An `items` source goes on to `ingest`
   below; a `page` or `note` source to `changes <name> --input <file>` in its own skill.
6. When you finish, close the tabs you opened, leave the owner's tabs open, and remove the temporary
   files.

## Collect

For each source the owner named (all of them when none was named), read it as above. Without a
script, read the page (an accessibility snapshot or its visible text) and build the items yourself.
An item is `{"id", "title", "url"}` plus, when known, `"done": true` (finished at the source),
`"state"` (the source's status word) and `"marker"` (`TODO`, `DOING`, `WAITING`, `LATER`, `NOW`, or
`""` for a plain line). Collect only what `collect` describes. Save the items to a temporary file
outside the workspace, keep the commit you start from (the check compares with it) and preview:

```sh
git rev-parse HEAD
npx --no-install excudo ingest <name> <file> --dry-run
```

Show the owner the new items and where each would go: `key` (an owner's node that already names the
item's key, such as a branch line; knowledge nodes do not count), `source` (the source's node) or `journal` (today's journal, placed
later like any journal item). Ask about destinations that look wrong. To change one, set `"node"` on
that item; to stop an item from ever being added, set `"skip": true`. When the owner asked to bring
the items in, or agrees now, apply and save:

```sh
npx --no-install excudo ingest <name> <file>
npx --no-install excudo save "<what was collected>"
```

The engine adds each new open item once, as `- TODO <title> [<key or label>](<url>)` in the lead of
its node (above the first section heading), and never adds
an item the memo has already had, even one the owner removed or archived. Finished items are never
added. `closed` lists items finished at the source but still open in the memo; `gone` lists items a
complete source no longer lists. Both are questions, not facts: ask whether each is finished and
change a line to `DONE` only when the owner says so. If the owner wants one kept as it is, record it
with `review keep <candidate-id>` (review shows them as `source-closed` and `source-gone`). A source
the owner set to `finished: "settle"` is their standing mark: the engine itself turns a task whose
linked items are all finished into `DONE` and lists it as `settled`. Report those; never close
another line on that account.

## Scheduled run

Nobody can answer, and the run itself is the owner's standing request to bring the sources in. The
run may hand you items it already collected (files named in its prompt): use them instead of opening
the browser. A source that needed signing in or failed is skipped and named in the report; never
ingest an empty list in its place. Apply each source without asking, with these limits: when an open
task in the memo already describes an item's work without its key, append the item's
`[<key>](<url>)` to that task's line instead of adding a new one; leave every other item where the
engine places it rather than guessing a node; leave `closed` and `gone` as questions for the owner;
never mark anything `DONE` yourself (what the engine `settled` stays as it did). Then save, run the
check and report as below.

## Create or change an outside item

Only when the owner asks for that specific change. Draft the content from the memo line, its node and
the summaries above it; when the source groups items (an epic, a project, a board), list the likely
parents with a reason each and recommend one. Show the draft and wait for the owner's confirmation.
Then run the source's action in its page, or fill its form in the browser when there is no action:

```sh
npx --no-install excudo sources script <name> --action <action> --args '<json>'
```

Append the new item's `[<key>](<url>)` to the memo line so the next collection recognizes it, and
save. Never comment, change a status or close anything at a source unless the owner asked for it.

After bringing items in, run the skill's check for the sources you took in, with the commit you
started from. It fails when a task was closed since that the engine did not settle; add
`--allow-done "<task words>"` once for each task the owner said is finished. When you saved only your own pages (`save --only <page>`, as a scheduled run does while someone
writes elsewhere in the memo), give the check the same pages with `--only <page>`. Fix
what it reports, save and rerun it until it passes. This skill's scripts are in its folder: `.agents/skills/excudo-sources/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-sources/scripts/check.mjs --source <name> --since <commit>
```

Report per source: how many items were new and where they went, how many were already in the memo,
the tasks the engine `settled`, the `closed` and `gone` questions with the owner's answers, and the
check's result. Mention the tabs you closed.
