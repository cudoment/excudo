---
name: excudo-setup
description: Set up an Excudo memo from nothing, install its engine, open it in Tine, sync it to a phone, put it on a website and let task states be changed there, hand Home over to the owner or arrange its layout, connect an outside source, keep knowledge of a repository or page, let agents learn from the owner's requests, update the engine, prepare a problem report, or change settings. Use for "update the engine", "report a problem", "엔진 업데이트해 줘", "문제 제보해 줘", "choose my worker and reviewers", "작업자와 검토자 정해 줘", "set up my memo", "where do I start", "let me see my memo on my phone", "set up the website", "let me change task states on the website", "watch this repository", "let me write my Home", "arrange my Home", "let agents learn from my requests", "메모를 새로 만들어 줘", "어디서부터 시작해", "휴대폰에서도 보고 싶어", "사이트 설정해 줘", "사이트에서 할 일 상태를 바꾸게 해 줘", "홈 구성 바꿔 줘", "내 요청에서 배우게 해 줘", "외부 할 일 가져와 줘", or "메모 설정 바꿔 줘".
---

# Set up an Excudo memo

Keep the first list short. Put useful detail below it, folded until needed.
The npm engine writes files and installs the other skills; this skill guides setup.

Start with `npx --no-install excudo start --report` in a workspace.
Before one exists, use `npx -y excudo start --report`.
The report reads local checks without changing files and names the first incomplete step.
Run `excudo start` for its next command and take the steps below in order.
Run the report again after each step to confirm progress.

Node.js, the workspace, its engine, Git and the skills come first.
Worker roles, Tine, phone sync, Home, outside work and the website are optional.
Orca and a website host are optional too; any terminal and Markdown editor can open the memo.

## Updates and problem reports

Use the local engine for maintenance requests before the setup steps below.

For "update the engine", run `npx --no-install excudo update --json` to inspect the version and release links.
Use `--channel next` when the owner chooses beta releases.
If the request authorizes installation, run `npx --no-install excudo update --apply --json`.
It preserves edited skills and reports backups; review those copies with the owner.
When the JSON has `ownerActions` (what the owner must do after updating: a setting, a migration, a manual step),
tell the owner each version's items first, newest version first and before every other note, and tell them
again after `--apply`, since the owner may act only then. Quote each item verbatim, as the JSON gives it;
add a translation after it when the owner reads another language, never in its place.
Do not do these steps unasked.
Keep the JSON of `update --json` and of `update --apply --json` and the messages you showed in temporary
files outside the memo, then check them. After an apply pass the apply JSON (`applied: true`) and `--applied`:

```sh
node .agents/skills/excudo-setup/scripts/check.mjs --update <update.json> --relay <message.txt>
node .agents/skills/excudo-setup/scripts/check.mjs --update <apply.json> --applied --relay <message.txt> --relay <after-apply.txt>
```

Pass one `--relay` when nothing was applied, two when it was.
If the apply fails, its JSON has `engineChanged: true` when the engine was installed before the failing step.
Keep that JSON's `ownerActions`, tell the owner they are pending, and relay them again after the rerun finishes;
the check wants the second relay for such a JSON too.

Then run `npx --no-install excudo start --report` and this skill's `scripts/check.mjs`.
Report missing template rules instead of overwriting the owner's instructions.

For "report a problem", run `npx --no-install excudo feedback --title <title> --message <owner-description> --json`.
Keep its JSON in a temporary file outside the memo and check it before showing the draft:

```sh
node .agents/skills/excudo-setup/scripts/check.mjs --feedback <temporary-draft.json>
```

Use this skill's installed script path when no workspace exists.
The draft check reads the JSON file even when the workspace configuration is broken.

Include `--details` only when the owner explicitly asks for free-form diagnostic details.
In that case pass `--allow-details` to the check and ask the owner to review the redacted text before sending.
Show the draft and issue URL; never submit it or open a browser automatically.
A broken configuration still permits the diagnostic draft and `start --report`.

## Setup steps

Follow the first incomplete step from the report.

1. Look for `excudo.config.mjs` in the current folder and its ancestors, then at
   `EXCUDO_ROOT`. If it exists, enter that workspace. First check that `node_modules/.bin/excudo`
   exists and is executable; if absent, ask for `npm install` and stop before invoking npx.
   Then check the local engine:

   ```sh
   npx --no-install excudo check
   ```

   If the engine is missing, tell the owner to run `npm install` in the workspace and stop.
   For settings changes, edit `excudo.config.mjs`, then run the local `check` and `build`.
   For instructions, keep `target` below `limit`; unset means 85 percent of the limit.
   Enable `instructions.auto` only when the owner asks for scheduled trimming.
   Their verification may call `excudo instructions --check` to reject changes over the limit.

2. For a new workspace, ask its location and language (`en` or `ko`) if unknown. Install once:

   ```sh
   npx -y excudo@^0.8.0 init <folder> --locale <en|ko>
   ```

   If `EXCUDO_PACKAGE` is set, use its local folder or tarball instead:

   ```sh
   npx -y --package "$EXCUDO_PACKAGE" excudo init <folder> --locale <en|ko>
   ```

   These are installation commands. Report network or permission errors verbatim and stop;
   ask for the appropriate access. Do not change or bypass sandbox or proxy settings.

3. Enter the new folder and run `npm install`, then:

   ```sh
   npx --no-install excudo check
   ```

   Recommend `git init` so edits and cleanup batches can be recovered. `init` preserves existing
   files, creates a graph (default `notes/`), and installs every skill in `.agents/skills/`,
   linked from `.claude/skills/`. Reopen the agent in that folder to discover them.

4. Open the graph folder in Tine. The files follow Logseq's format; Tine is the tested reader.
   To switch graphs on macOS, fully quit the running app, then:

   ```sh
   TINE_GRAPH=<graph-folder> /Applications/Tine.app/Contents/MacOS/tine <graph-folder>
   /Applications/Tine.app/Contents/MacOS/tine doctor <graph-folder>
   ```

   Passing a path to an already running app does not switch its graph. If Tine is absent,
   direct the owner to https://tine.page. Let the owner handle system security dialogs.

5. For a phone, share only the graph folder with Syncthing (Syncthing-Fork on Android),
   enable file watching and 30-day trash-can versioning, and open the synced graph in Tine.
   Keep engine, agent skills, caches, `review.json`, `sources.json` and `reflect.json` outside the shared graph.

6. To read the memo in a browser, on a phone or anywhere Tine is not, write it as a website. With
   the owner's go-ahead to put it on Vercel under their own login, one command does everything:

   ```sh
   npx --no-install excudo site setup
   ```

   It installs what is missing (the exporter, the Vercel CLI), writes the website, and opens Vercel's
   device login: tell the owner first that a page opens where they log in and allow the device. Then
   it creates and links a project, sets Vercel Authentication to guard every deployment, publishes,
   and opens the address with a code a phone can scan. It waits up to ten minutes for the approval;
   run it again to continue. Add `site` to `excudo.config.mjs` so `build` and `save` keep the website
   current (`site: {}`; `journals: true` adds the journals, `publish: { project: "…" }` names the
   project, `publish: { open: [command] }` opens links the owner's way), and have the owner's
   schedule run `npx --no-install excudo site publish`, which exits 75 while the owner has something
   to do first. Without a host, `npx --no-install excudo site --open` writes the website and opens it
   on this computer.

   The website folder lies outside the graph and is replaced whole, and `check` names a query the
   website cannot show (`query-unsupported`). Never enter a credential for the owner; the CLI keeps
   its own login.

   If the owner wants to change a task's state from the website, add `inbox: true` to `site` and run
   `npx --no-install excudo site setup` again; it goes on where it stopped. Tell the owner first what
   they will do, because the rest runs by itself:

   - When the GitHub CLI is not logged in, its login page opens with the code copied (`brew install
     gh` first on macOS when gh is missing).
   - Setup makes a private repository for the inbox (`<account>/<project>-inbox`, or the one named in
     `inbox: { github: { repo } }`).
   - Two pages open. On GitHub's, which comes filled in, the owner picks that repository under
     Repository access, generates the token and copies it. On Vercel's, the owner adds
     `EXCUDO_INBOX_TOKEN` with the token as its value for Production and saves. Setup waits up to 15
     minutes, then publishes so the inbox function has the token.
   - On macOS it schedules `npx --no-install excudo site pull` every minute (a LaunchAgent); elsewhere
     it prints the command for the owner's scheduler. A workspace whose own schedule runs `site pull`
     sets `inbox: { schedule: false }`.

   For a dashboard at the top of the website's Home (links that open in a new tab, a board that shows
   a node's body to edit and save, numbers on open tasks, finished tasks, agents and scheduled runs),
   add `dashboard: { sections: [...] }` to `site` with the sections the owner wants, in their order,
   as the engine README's "A dashboard on Home" shows. The board needs the inbox and a node of its
   own (`page`); ask the owner where it goes before making a new top node.

   The owner makes and pastes the token; never enter, copy or store it. `site pull` brings the changes
   in every five minutes, or at once when a page asks (Bring in now) or with `--now`; `site status`
   shows the inbox, its token and the schedule.

7. If the owner wants to choose the first screen by hand, hand Home over once:

   ```sh
   npx --no-install excudo home --own
   ```

   Home becomes links to the nodes it listed plus its other sections, and the whole tree moves to
   the generated Archive page. Nothing in the tree moves or is removed. From then on the engine never
   writes Home: the owner checks off work there and decides its layout, and agents change it only
   when the owner asks, to that request. `home` reports the pages Home embeds, links without a page
   and top nodes Home does not reach.

   When the owner asks to arrange Home, lay it out the way they ask. The default Home is one example
   to start from: thinking above (the tree, the decision and idea queries), work below (queries for
   work in progress, tasks handed to agents, the `WAITING Review:` lines and other waiting tasks).
   Whatever the layout, copy nothing into Home: show a node's tasks through queries (work in
   progress, the next tasks, each source's items by its node page or address), and parts of the tree
   through a generated view Home embeds (a view with a `nodes` fence, such as `views/Thinking.mdx`
   with `depth: 2` and `except: [<a paused node>]`, and `{{embed [[Thinking]]}}` on Home). One task
   shows in one section unless the owner wants it in two; say why when it does. Give each query its
   own title (`{:title "…"}` after a parenthesized query) and fold only what the owner rarely opens,
   since a phone hides a folded block's arrow. Keep the owner's folds, block ids and links. Ask
   before making a new top node or moving notes. Then build, and run `home` to see that every top
   node is reached or linked.

8. To connect an outside source (an issue tracker, a team board, requests or mentions), ask what
   to collect and where its items belong, then add an entry to `sources` in `excudo.config.mjs`:
   `name` (lowercase id), `url` (the page to open), `collect` (what to collect, in words), and
   when they apply `label` (link text), `key` (a pattern for item keys such as `[A-Z]+-\\d+`, so an
   item goes to the node that names its key), `node` (the default node; otherwise today's journal),
   `marker` (`TODO` by default, `""` for plain lines), `complete: true` (the page lists every open
   item, so a missing one is worth asking about), `notes`, a collecting `script` and `actions`.
   A script is a function, or its source text, run in the source's page with `{ since, url }`; it
   returns items `{ id, title, url, done?, state?, marker? }` as JSON. It must be self-contained, use
   only the page's own session, and throw when the page is not signed in: an empty list from a
   complete source reads as "everything is gone". An action is `{ script, notes }`, run with the JSON the owner
   approved. Name the browser to use in the workspace `AGENTS.md`. Then try it:

   ```sh
   npx --no-install excudo sources
   npx --no-install excudo sources script <name>
   ```

9. To keep knowledge about a project or a page, add a watched source with its knowledge node:
   `{ name, kind: "repo", path, node }` for a local repository or folder (`~` and paths relative
   to the workspace work; `aliases` lists its former paths; `watch: "commits"` ignores uncommitted
   work, for a repository that always has some), or `{ name, kind: "page", url, script,
   node }` for a web page whose script returns `[{ id, title, url? }]` (only the ids decide whether
   it changed). `enabled: false` keeps a source listed but unwatched. Create the node with the
   owner's agreement on where it goes; list nodes that hold only reference knowledge (for example
   a top node for topics) in `knowledge`. Then `npx --no-install excudo changes` shows what
   the recall skill should read.

10. To let agents learn from the owner's requests to coding agents on this machine (the
   "Learn from your requests" step of `excudo start`; ask first, as it reads local agent logs), set
   `conversations: true` (or `{ claude, codex, exclude }` for other log folders and folders to
   leave out) and `interests` to the node where the reflect skill keeps lasting decisions. That node
   must exist: tell the owner to create it (the start step stays open until it does), or create it
   with their agreement. The
   request text stays in the workspace cache, outside the graph and git. Nodes can name their work
   folder with a path line, `` `/path/to/folder` ``, kept current by `workspaces`; a
   folder several nodes work in gets a line on each, with only that work's windows. When
   a folder is renamed or moved, add `moved: { "<old path>": "<new path>" }`: requests typed in the
   old folder then belong to the node of the new one, and `workspaces` rewrites the path lines.

11. Keep `conversations` on so excudo-skills can learn recurring work and maintain it on a schedule.
    Set `skills: { dir: "skills", install: "workspace" | "global", minScore: 80, keep: [] }` when the defaults do not fit.
    `global` copies new skills to `~/.agents/skills` for every folder, except skills for the workspace's own work.

List skill names in `keep` when scheduled steps depend on them.
Upkeep keeps a failing listed skill installed, reports its failing checks and exits 1.
The caller can notify the owner to fix the checks.

Optionally choose a worker and independent reviewers with the owner.
Run `npx --no-install excudo agents --json`.
Show installed tools, local models, effective defaults, estimated ranks and recommendations.

The worker implements improvements; reviewers inspect the result read-only.
Recommendations use each provider's second model, with high for work and xhigh for review.
Include a reviewer from the other provider and explain when a tool or model list is absent.
Never recommend a provider's first model as the default.

Let the owner choose the recommendation or another model, including the first model.
Ask before changing settings; only run a mutating agents command after an explicit request or approval.
For each choice run `npx --no-install excudo agents set worker --tool <tool> --model <model> --effort <effort>`
or `npx --no-install excudo agents set reviewer --index 0 --tool <tool> --model <model> --effort <effort>`.
Use the next zero-based index for another reviewer; empty model and effort strings use tool defaults.

Before dispatch, use `excudo agents args worker --for orca` and read stderr.
If a pending suggestion appears, ask whether to use it and show `excudo agents accept <id>`.
Only after approval run accept; use `excudo agents decline <id>` when the owner rejects it.

A scheduled run can report `excudo agents suggest --new --json` without accepting anything.
Finish by running the setup check below; it validates agents settings too.

After installation, all memo work uses the local engine with `npx --no-install`; routine use
needs no network. Refresh old skills with `npx --no-install excudo skills --force`; a copy that differs from the package is kept with a backup, and after the owner reviews it `skills --replace <name>` (or `--replace-all`) replaces it. A
workspace that installs a local clone of the engine (`file:` in `package.json`) can link the skills
to it instead, so they change with the clone: `npx --no-install excudo skills --link --force`.
`skills --global` installs them for use from other folders; set `EXCUDO_ROOT` there.

Finish every setup or settings change with the skill's check, and fix what it reports. When
`AGENTS.md` lacks rules of the engine's current template, or words one differently, copy the
template's text for it and keep the workspace's own rules (its own sentences may follow a rule). This skill's scripts are in its folder: `.agents/skills/excudo-setup/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-setup/scripts/check.mjs
```
