# Working on Excudo

Excudo (`excudo`, Latin for "I hammer out") is the engine that keeps an owner's personalized AI
environment managed and improving: the shared rules, skills and procedures, and the commands behind them.
A workspace run with it is the owner's personal project, named for its purpose as Excudo plus a word
(Excudo Works for work automation, Excudo Lab for study). A project's memo keeps the owner's thoughts in
order under the list they write: a folder of Markdown nodes becomes an infinite tree for outliners (Tine,
Logseq), using cudoc embeds for the summaries. cudoc is a separate dependency, not part of the engine.
This file is for agents changing the engine; the skills in `skills/` are for agents working in a
personal project.

## Layout

- `bin/excudo.mjs` is the command line over `src/index.mjs`, the library it and the skills' scripts
  use. `src/workspace.mjs` finds and loads a workspace (`excudo.config.mjs`, its labels and
  folders); `src/init.mjs` creates one from `templates/` (settings, `AGENTS.md`, the Home view) and
  installs the skills with `src/skills.mjs`, which copies or links them into `.agents/skills` and
  links each agent's folder to them (`agentLinkTools`).
- `src/git.mjs` commits the graph and the files saved with it, alone or only some pages (`snapshot`,
  `save --only`), and lists the graph's uncommitted files. `src/inbox.mjs` lists what waits to be
  placed: journal items and pages in `pages/`. `src/sessions.mjs` finds the owner's agent sessions
  by node or folder, with the command that resumes each where it is now.
- `src/tree.mjs` collects with cudoc and reads `resolveTree` data. cudoc owns ancestry, order and
  summaries; the engine supplies the open-task extractor. `src/dialects/logseq.mjs` owns outliner
  syntax and Tine's structural rules.
- `src/build.mjs` writes standard cudoc tree views and generated regions (a location line, then the
  subtree), preserving collapse choices and protecting edits through `.excudo/build.json`.
- `src/check.mjs` reports node rules and first-list state. `src/history.mjs` reads git dates across
  renames and caches blob digests and blame in `.excudo/history.json`. It is async: load
  line `times` with `loadTimes` (blame runs in parallel) before reading them. `src/review.mjs`
  suggests candidates; `src/keeps.mjs` reads and writes the owner's decisions in `review.json` (kept
  questions, untracked folders) and holds the question and reason ids that review and check share.
  Changing those ids loses the keeps already recorded.
- `src/home.mjs` reports and hands over Home: without `views/Home.mdx` the owner writes `Home.md`, the
  Archive view holds the tree, and `pages/` (where Tine puts new pages) waits outside the tree.
- `src/sources.mjs` takes the items an agent collected from an outside source through a browser and
  places, deduplicates and tracks them in `sources.json`; the engine itself never goes online.
  `src/changes.mjs` tells which `repo`, `page` and `note` sources changed since the memo was
  brought up to date; `src/notes.mjs` cuts a followed note to the part between its markers, in the
  page and again in the engine, and drops lines that look private. `src/requests.mjs` reads the owner's requests from coding-agent logs into the cache,
  leaving out what scheduled runs typed; `src/activity.mjs` reads from the same logs what each session
  did (never what anyone wrote) and the owner's commits, for views' `activity` fences;
  `src/idle.mjs` holds the graph lock that commands changing the graph share, and tells a scheduled
  run whether it may start (the lock, recent uncommitted edits, the pause line);
  `src/records.mjs` keeps the requests, the activity and the scheduled runs in one SQLite file
  (`.excudo/records.db`, through the built-in `node:sqlite`), each write in one transaction;
  `src/queue.mjs` lists the tasks tagged for agents and leaves their reports under them, and
  `src/status.mjs` draws a view's `status` fence;
  `src/workspaces.mjs` keeps nodes' path lines current, and `src/blocks.mjs` checks and repairs
  block ids, references and embeds.
- `src/nodes.mjs`, `src/archive.mjs` and `src/find.mjs` move/rename/remove nodes, retain monthly completed
  work and find current or deleted content. `src/files.mjs` holds the shared path and atomic-write
  helpers. Messages live in `src/labels.mjs` in English and Korean.
- `src/exports.mjs` writes the files kept from the memo in the owner's format (`exports`), outside the
  graph, at every build; a file edited by hand is never overwritten (`.excudo/exports.json`).
- `src/site.mjs` writes the memo as a website with cudoc-export (`site`), outside the graph: it writes a
  copy of the graph in standard Markdown (`src/dialects/html.mjs` turns outliner syntax into links,
  checkboxes, dates and notes; `src/queries.mjs` evaluates `{{query}}` macros), lets cudoc render it,
  then adds the memo's index and the page runtime from `assets/` (`src/site-runtime.mjs`). The
  exporter is an optional peer dependency, loaded only when a website is written.
- `src/publish.mjs` puts the website on a host under the owner's login (`site setup | publish | open |
  status`): Vercel through its CLI, which it finds or installs, with Vercel Authentication on every
  deployment checked before each publishing. A workspace sets how links open (`site.publish.open`);
  the engine never enters a credential and keeps git from sending commit details with a deployment.
  With `site.inbox` it also puts the inbox functions beside the pages (`assets/vercel/`: `edit.mjs`
  takes changes and says what the memo has not taken, `sync.mjs` asks the owner's machine to take
  them now, `_github.mjs` is what they share).
- `src/open.mjs` opens a generated site in the system's file handler (`site --open`); a failure leaves its path for the owner.
- `src/start.mjs` holds a new owner's first steps and classifies every command, setting and skill by
  them (`excudo start`; `scripts/start-docs.mjs` writes the READMEs' start sections from it).
- `src/update.mjs` checks npm release channels and updates only on request.
  `src/feedback.mjs` prepares sanitized issue drafts without sending them.
  `scripts/changelog.mjs` groups commit subjects into versioned release notes.
- `src/pull.mjs` brings the website's changes in (`site pull`): it reads the inbox's issues with the
  GitHub CLI (`src/github.mjs`), commits as `save` does (`src/save.mjs`), and `src/schedule.mjs`
  schedules it every minute on macOS.
- `src/edits.mjs` defines the changes a page sends back (a task's state chosen on the website), in one
  shape for the page runtime, the inbox function that keeps each batch as an issue, and
  `src/receive.mjs` (`receive`), which checks each change against its line before writing it, notes
  on today's journal what it cannot place, and records every change by its id.
- `src/skilllint.mjs` defines what a skill is and scores its fitness (`skills lint`);
  `src/skilllint-runner.mjs` runs its known cases concurrently behind the synchronous API;
  `src/learned.mjs` turns recurring requests into candidates and adopts, installs, keeps and retires
  the skills a workspace learns, recorded in its `skills.json` with the cases that reproduce mistakes
  the owner pointed out (`skills mistake`), which lint keeps failing; `src/skillkit.mjs` is what the
  skills' scripts share, exported as `excudo/skill-kit`.
- `skills/` is the source of the agent skills: each folder holds `SKILL.md` and `scripts/`.
  `.agents/skills/` and `.claude/skills/` only link to it.
- `scripts/release-check.mjs` tells whether the clone can be published; `scripts/denylist.mjs` keeps
  the words of a maintainer's private list out of every file git tracks; `scripts/dependencies.mjs`
  refuses a dependency not from the registry before packing; `scripts/linked-build.mjs` builds a
  dependency taken from a local clone before the tests; `scripts/public-tree.mjs` writes this
  repository from the maintainer's clone.

## Rules

- **A skill carries code; a prompt alone is no skill.** Every skill embeds at least one script that
  does part of its work the same way every time (a check, a search, a change), and at the least
  `scripts/check.mjs`, which tells whether the skill's requirements were met, with
  `scripts/check.cases.json`: known cases, at least one that must pass and one that must fail, which
  `skills lint` feeds to the check (`--facts`). `SKILL.md` runs each script. A test keeps every skill
  in `skills/` at 100 in `skills lint`; a change to a skill's procedure changes its check and cases
  with it.
- **A mistake pointed out in an engine skill's work becomes a failing case of its check.** Make that
  skill's `scripts/check.mjs` fail on the mistake, and add a case reproducing it to
  `scripts/check.cases.json` with `expect: "fail"`, named in general words (no workspace's names).
  Never remove such a case or make it pass, as lint keeps a workspace's cases (`skills mistake`).
- **Reach another app by pasting, not by driving it.** When text the engine prepares has to reach an
  app it cannot write through a plain interface (a phone notes app, a web editor), the engine keeps the
  text ready and lets the owner paste it (`mirror text --copy`), and the next run knows the pasted
  result. A workspace runner may drive the app as a shortcut, but it pastes the prepared text in one
  step, checks the result, and leaves the paste to the owner whenever it cannot write safely: a real
  click is blocked, the owner is typing, or other text in the same note could be touched.
- **Keep the skills agent-neutral.** Only shell commands, plain Markdown and scripts any agent can run
  (Node built-ins and `excudo/skill-kit`); no tool-specific calls. They must work in Claude Code
  and Codex alike.
- **Keep both languages in step.** A new message or generated word needs an `en` and a `ko` entry;
  a README change goes into `README.md` and `README.ko.md`.
- **Keep the first steps true for a new owner.** `src/start.mjs` holds the steps from nothing to a memo
  in use (`excudo start`, the README's start section, the setup skill). Every command the help shows,
  every setting and every skill is classified there, by the first step it belongs to or `false`. When
  you add or change one, place it, update the step it touches (its words, its command, how it is
  found done), run `npm run start-docs`, and make the setup skill take it; `test/start.test.mjs` fails
  until the list, the READMEs and the skill agree.
- **Never commit personal notes.** `example/` holds dummy content only; personal workspaces belong
  outside the clone or in `private/`. A maintainer lists the words that must never be published (their
  names, hosts, issue keys) in `private/denylist.txt`, which git ignores; `scripts/denylist.mjs`, a test
  and `release:check` fail when a tracked file holds one, and pass without the list.
- **Rebuild the example after engine changes** (`npm run example`). A test fails when the committed
  example is out of date.
- Run `npm test` before committing.

- Keep the setup skill version range aligned with the package version.
- Git history, not modification time, supplies review and archive dates. Never discard overflow.

## The engine and the workspaces that use it

The engine is a general tool; a workspace (a folder with `excudo.config.mjs`), the owner's personal
project, is one owner's use of it. One agent may change both in a task, but each change goes where its role
is. In a personal project, "the engine" (or "Excudo" alone) means this repository, and the project goes by
its own name (such as Excudo Works) or "this project". A request made there to change the engine is work
here, under these instructions, checked here and then in that project.

- **Be sure which one the owner means before changing anything.** When a request does not say whether
  the engine or a personal project is to change, or names one while the change belongs in the other, ask
  the owner which before changing either. The workspace templates give every personal project the same
  rule, and the recommended names (Excudo plus a purpose) stay the same in both READMEs and both
  templates.

- **The engine takes what any workspace could use:** commands, checks, review questions, source
  handling and the skills, with tests, both READMEs and the example. A problem found in a workspace is
  fixed at its general cause here, and the workspace adopts the fix through its settings.
- **The engine's skills are general skills only, without exception.** A skill here, and every step,
  check, known case and example it carries, must serve any owner in any workspace. A skill or a step
  that fits one owner's workspace, sites, names, layout or habits does not belong here: it is that
  workspace's own project skill. A request made in one workspace adds to the engine only its cause in
  general form (a setting, an option, a question the skill asks) that every workspace can use or leave
  off; what cannot be made general stays out of the engine. When unsure, keep it in the workspace and
  ask the owner before moving it here.
- **A workspace keeps what is its own:** its settings, source scripts for its sites, helper scripts for
  its machine, its notes and its `AGENTS.md`. Never copy a workspace's names, hosts, paths or issue
  keys into the engine, its tests or the example.
- **Commit each repository on its own,** in its own conventions. An engine change and a workspace's
  adoption of it are separate commits.
- **Linked workspaces run every engine change at once.** A workspace that depends on this clone
  (`file:` and `skills --link`) gets each edit immediately, so the files the engine keeps there
  (`review.json`, `sources.json`, `reflect.json`, `.excudo/`) must stay readable across versions,
  and records an earlier version wrote must keep their meaning (as `legacyReasonId` does for keeps).
- **After an engine change, try it in a linked workspace:** run `check`, `review` and the commands
  the change touches there, and do the workspace's follow-up (settings, its `AGENTS.md`) in the same
  task. Never edit a workspace's notes from engine work unless its owner asked for it.

## Releasing

Prepare the notes and validate the untagged version before publishing.

1. Raise the version in `package.json` and `package-lock.json`, and the setup skill's range with it.
   Run `node scripts/changelog.mjs --since <previous-release-ref> --write <version>` and review the section.
   This also puts the newest section in `package.json` for `npm view` to return after publishing.
2. Run `npm run release:check` on a clean `main` before tagging.
   It checks registry dependencies, the version's CHANGELOG section and private words.
   It also checks tests, example output, skills and package contents.

   Use `npm run release:check -- --quick` for preliminary checks.
   It skips tests, the example rebuild and skill lint; it never approves publishing.
   The publish hook repeats the full check.
3. Commit the release changes on `main` and run the full release check while the version is untagged.
   The maintainer publishes with `npm publish --tag next` for a beta or `npm publish --tag latest` for stable.
   After verifying publication, publish the corresponding `v<version>` tag for release-note links.

   To promote a published stable version tested on `next`, run `npm dist-tag add excudo@<version> latest`.
   Verify the tags with `npm view excudo dist-tags --json`.
   This repository comes from the maintainer's clone; merged changes return to that clone too.
4. Each linked workspace (`file:`) keeps running the clone.
   To use a release there, run `npm install excudo@^<version>` and the setup skill's check.
   Linked skills follow the installed engine through `node_modules`.

   Return to the clone with `npm install <path to the clone>`.
   A workspace may keep its own switch script; the engine keeps none.
