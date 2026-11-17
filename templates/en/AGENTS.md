# Excudo personal project

This folder is a personal project: a workspace run with Excudo. The notes live in
`{graph}/`, an outliner graph that the owner opens in Tine (the files follow Logseq format) on a computer and a phone.
Agents keep it tidy with the skills in `.agents/skills/`; Claude Code reads the same skills through
`.claude/skills/`.

## Skills

| Skill | Use it when the owner asks to |
| --- | --- |
| `excudo-capture` | note, add, or remember something |
| `excudo-distill` | tidy up, sort the inbox, update the memo |
| `excudo-setup` | set up the memo, open it on a phone, or change settings |
| `excudo-sources` | pull issues, requests or mentions into the memo, or create an issue |
| `excudo-recall` | answer from what the memo knows, or update the knowledge of changed sources |
| `excudo-reflect` | turn lasting decisions from the owner's agent requests into interest nodes |
| `excudo-skills` | turn work they keep asking for into skills, or keep the learned skills fit |
| `excudo-export` | keep a file such as a todo list written from the memo in their format |
| `excudo-follow` | bring in the note they keep in another app, follow their thinking note |
| `excudo-queue` | work on the tasks they handed to agents (open tasks tagged `#agent`) |

## Rules

- **Change the memo only when the owner asks.** Answering a question about it changes nothing.
- **One file is one node.** The first line is `# Title`, the same as the file name. The summary
  starts on the very next line: one or two sentences, what matters now. The body follows. The nodes
  below `X.md` go in the folder `X/`. Page names must be unique across the whole graph.
- **No blank line under a heading; one above it.** Tine shows a blank line under a heading as a gap.
  Keep one paragraph under a heading (the summary under the title); put further text in list items.
- **Write each thing once.** Refer to it elsewhere with `[[Page]]`.
- **Never edit generated text.** View pages (first line `generated::`) and the `## Subpages` section
  at the end of a node are written by `npx --no-install excudo build`.
- **A Home without `generated::` is the owner's page, changed only when they ask.** After `home --own`
  the owner checks off work on `{home}.md` and decides its layout. Never change it on your own or in a
  scheduled run; suggest links instead. When the owner asks for a change to Home, rework it to that
  request and keep the rest as it is (order, folded sections). The whole tree is on the Archive page.
- **Tasks are `- TODO`, `- DOING`, `- WAITING`, `- DONE`.** Outliners do not turn `- [ ]` into a
  checkbox.
- **Only a heading may follow a list.** Put paragraphs and tables before the list in a section;
  Tine absorbs unindented text that follows a list into its last item.
- **Only the owner decides what is done.** Mark an item done only when the owner said so. An outside
  source showing an item as finished is a question for the owner, not a decision.
- **Read outside sources in the owner's signed-in browser.** Create or change something at a source
  only when the owner asked for it and confirmed its content. Never type or store credentials.
- **Browser work never takes the owner's focus.** Work in background tabs and never bring a window or
  tab to the front. Only a step that truly needs focus may take it; say why first, then return the
  owner's screen to where it was.
- **Agents keep knowledge nodes current, from their sources only.** The nodes of `repo` and `page`
  sources and those below `knowledge` follow what `changes` reports; a watched repository or page is
  only read. Lines carry evidence grades (`Confirmed:`, `Observed:`, `Assumed:`, `Proposed:`,
  `Superseded:`), and only `Confirmed:` is the owner's decision.
- **The owner's requests to agents stay private.** Summarize them; never copy their text into a
  node, `reflect.json` or a commit.
- **Finish a skill's work with its check.** Every skill carries `scripts/check.mjs`, which says
  whether the skill's requirements were met; fix what it reports and run it again until it passes.
- **Make a skill's check catch the mistakes the owner points out.** When the owner points out a
  mistake in work a skill did, fix it so that the skill's `check.mjs` fails on that mistake. Add a
  known case that reproduces it (`expect: "fail"`) to `check.cases.json`. Then record it with
  `npx --no-install excudo skills mistake <skill> --case "<case name>" --why "<summary>"`, and lint
  keeps that case from then on. For one of the engine's skills, report it to the engine as something
  to fix.
- **Finish with `npx --no-install excudo save "<what changed>"`.** It checks, builds and commits in one step
  and refuses to commit while there are errors.

- **Keep the first list and summaries short and current.** Check summaries up to the top after
  capture with `tree --path`. Ask before adding a top node.
- **Fold useful detail below instead of discarding it.** Finished work lives under Done's year
  and month nodes. Remove only what will never be useful again.
- **Ask about clutter when editing.** Use the cleanup interview: evidence and a recommendation,
  at most four questions, starting with the top list. Do not delete or move content before answers.
  Remember "keep" decisions with `review keep`; do not postpone uncertainty with `#check`.
  Ask once per review candidate, combining its reasons. No open tasks does not make a reference
  useless or finished; ask the owner how it is used. Identical tasks remain separate items.
- **For lookup, answer only.** Run `tree` to guess the location, read the node body, use `find`,
  then `find --history` if absent. Do not change the memo during lookup, except the knowledge nodes
  of sources that `changes` reports as changed.
- Use the local engine with `npx --no-install excudo`. If missing, run `npm install`
  in this workspace first. Refresh outdated skills with `skills --force`; skills linked to a local
  clone of the engine (`skills --link`) change with it and need no refresh.

## The engine and this project

Name a personal project for its purpose, as Excudo plus a word: Excudo Works for work automation, Excudo
Lab for study.

- **"The engine" means Excudo.** When the owner says "the engine" or just "Excudo", they mean Excudo, the
  engine this project runs on. This project goes by its full name (such as Excudo Works) or "this
  project"; a name that contains Excudo does not make it the engine. cudoc is a separate dependency of
  the engine, not the engine.
- **Before changing anything outside the memo, ask whether the engine or this project is meant.** When
  a request to change a skill, a check, a command, a script, a setting or these instructions does not
  say which, ask the owner before changing either. When it names one but the change belongs in the
  other, ask again and give the reason. The memo is always this project's, so changing it needs no
  such question.
- **The engine takes what any personal project uses; this project keeps what is the owner's.**
  Commands, checks and skills are changed in the engine's repository, under its own `AGENTS.md`;
  material, settings, credentials and this file are changed here.
