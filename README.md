# Excudo

English | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

**Electricity is not free, so AI should earn its power bill.**

Excudo (the `excudo` package) is an engine that keeps a personalized AI environment managed and
improving. Its name is Latin for "I hammer out": it holds the rules, checks and shared skills that
Claude Code and Codex both follow, and hammers your agents' work into shape against them. The folder
you run with it is your **personal project**: a place with your material, your judgment criteria,
skills and automation, where work, learning and creative results get made.

**Five-minute start**

Create a memo, install its engine and see the next step.

```sh
npx -y excudo@^0.9.1 init my-memo
cd my-memo
npm install
git init
npx --no-install excudo start
```

Open this folder with your coding agent and ask: "Add 'Read one chapter' to my memo."
Then build the local website to see your memo in a browser.

```sh
npm install --save-dev cudoc-export@^1.1.0
npx --no-install excudo site --open
```

Use any terminal and Markdown editor. Orca, Tine and a site host are optional.
The local website needs no hosting account.
See [updates](#update-the-engine), [feedback](#report-a-problem), the
[bug form](https://github.com/cudoment/excudo/issues/new?template=bug.yml) and
[usability form](https://github.com/cudoment/excudo/issues/new?template=usability.yml).

## Install with a coding agent

Paste this into a coding agent (Claude Code, Codex) opened in an empty place:

> Set up Excudo from https://github.com/cudoment/excudo in a new folder, following its README section "Install with a coding agent"

The agent follows these rules and runs only the commands of rule 4 and the report check, never the website block of the five-minute start:

1. Check that Node.js is 22.16 or later (`node --version`); if not, stop and point to https://nodejs.org.
2. Ask the folder name and the language of the files (`en` or `ko`) once, then use them without asking again. Choose `en` unless the owner reads Korean (`ko`). Whatever the file language is, keep talking to the owner in the owner's own language (Japanese, Chinese or any other).
3. Never install anything globally: no `npm install -g`, and no change outside the new folder apart from npm's own cache.
4. Run `npx -y excudo@^0.9.1 init <folder> --locale <language>`, then this one line: `cd <folder> && npm install && git init && npx --no-install excudo start --report --json`. Every command after `init` runs inside `<folder>`; `init` does not run git, so `git init` is part of the sequence.
5. Read the report (`--report --json`) to verify. The install succeeded when the steps `workspace`, `install`, `git` and `skills` are all `done`. For each of them that is not, show its `id` and `state` and ask the owner what to do; do not guess a cause or run anything else.
6. When a command fails, stop, show the last lines of its error output and ask the owner; never improvise a fix or another command.
7. Finish by handing the owner the next remaining step, the one named by `stoppedAt`: relay its `run`, `ask` and `setting` verbatim and do not run it yourself.

## Get started

Run `excudo start` to see completed steps, the next command and what to ask an agent.
The engine generates the list below.

<!-- excudo:start (written by npm run start-docs from src/start.mjs) -->
**To start** (in order):

1. **Node.js 22.16 or later**: install the current LTS (24); https://nodejs.org
2. **A workspace**: create the memo's folder with its settings, agent skills and graph; `npx -y excudo init my-memo`; or ask your agent “set up my memo”
3. **The engine in the workspace**: install it in the new folder; `npm install`
4. **A git repository**: the memo's history; save commits to it; `git init`
5. **The agent skills**: init installs them; reopen your agent in the workspace; `npx --no-install excudo skills`

**When you want them**:

1. **Worker and independent reviewers**: choose tools, models and reasoning effort; `npx --no-install excudo agents`; or ask your agent “choose my worker and reviewers”
2. **Learn from your requests**: let agents read the requests you type to coding agents here, turn lasting decisions into interests and recurring work into skills with their own checks; the interests setting names a node, so create that node first (docs/sources-and-learning.md: Learn from your requests; docs/skills.md: Skills carry their own code); `conversations: true, interests: "Interests"`; or ask your agent “let agents learn from my requests”; https://github.com/cudoment/excudo/blob/main/docs/sources-and-learning.md#learn-from-your-requests
3. **Tine**: open the graph folder (notes/) in Tine to read and write the memo; https://tine.page
4. **Your phone**: sync the graph folder with Syncthing and open it in Tine on the phone; or ask your agent “let me see my memo on my phone”; https://syncthing.net
5. **Your own Home**: write the first screen yourself; the tree moves to the Archive; `npx --no-install excudo home --own`; or ask your agent “let me write my Home”
6. **Outside work**: bring in an issue tracker or team board through your logged-in browser; `npx --no-install excudo sources`; or ask your agent “pull my issues into my memo”
7. **The memo as a website**: publish it on Vercel where only your login opens it, on a computer or a phone; `npx --no-install excudo site setup`; or ask your agent “set up the website”
8. **Task states from the website**: bring website task states into the memo; `site: { inbox: true }`; `npx --no-install excudo site setup`; or ask your agent “let me change task states on the website”
9. **Use it on several computers**: keep the workspace in step across computers through GitHub or Google Drive; or ask your agent “sync my memo across my computers”

Run `npx -y excudo start` (`npx --no-install excudo start` in a workspace) to see progress. Use `excudo start --report` for every step and where to continue.
<!-- /excudo:start -->

## How it works

A personal project centers on its memo: a folder of Markdown nodes that reads as an infinite outline in
[Tine](https://tine.page), on your computer and your phone. You write the top list and make the
decisions; agents do the filing. The engine holds what any personal project can use (commands, checks
and skills); each project keeps its own material, settings and credentials.

Name a personal project for its purpose, as Excudo plus a word: **Excudo Works** for work automation,
**Excudo Lab** for study, and so on. The engine is only ever "Excudo" or "the engine"; a personal
project goes by its full name or "this project". Its agents read "the engine" that way, and before
changing anything outside the memo they ask whether you mean the engine or the project.

- **[A first screen that stays short](docs/memo.md#keep-the-first-list-short).** Agents file what you capture
  below the right node, keep every summary above a change current, and fold details away instead of
  deleting them.
- **[Nothing moves before you answer](docs/memo.md#a-cleanup-interview).** A cleanup interview brings evidence
  and a recommendation, four questions at a time, and saves each answered batch as a commit you can
  revert. Only you mark work done.
- **[Outside work](docs/sources-and-learning.md#bring-in-outside-work) and [current knowledge](docs/sources-and-learning.md#keep-knowledge-current).**
  Issues, requests and mentions come in once each through your signed-in browser; knowledge nodes
  follow the repositories and pages you watch.
- **[Only skills that prove their work](docs/skills.md#skills-carry-their-own-code).** Every skill carries code:
  at least a check, with known cases it must pass and must fail. `skills lint` runs those cases and
  scores the skill, so a prompt shortcut or a check that cannot fail is no skill. Work you keep asking
  agents for becomes a new skill only when it clears that bar, and leaves use when it no longer does.
- **[Learns from what you ask](docs/sources-and-learning.md#learn-from-your-requests).** It reads the requests you typed to your
  agents, keeping their words out of git, and turns lasting decisions into notes and recurring work
  into skills, written in its own words.

## Built on cudoc

Excudo depends on [cudoc](https://www.npmjs.com/package/@cudoment/cudoc) (`@cudoment/cudoc`),
which npm installs with it. cudoc is a separate dependency of the engine: it supplies the tree (ancestry,
order, summaries) and the embeds the generated views are made of, and Excudo adds the
outliner format, checks, review questions and skills. Neither the engine nor a personal project is part
of the cudoc product family: report engine problems here and problems of the cudoc library upstream in cudoc. The files follow Logseq format; they are
verified in Tine, not yet in Logseq.

## Also included

- [Make Home your page](docs/memo.md#make-home-your-page): you check off work there and decide its layout, and the whole tree stays in the Archive view.
- [Find the details](docs/memo.md#find-the-details), even lines removed long ago (`find --history`).
- Finished work folded into monthly archives, dated from git history (`archive`).
- [Work folders on nodes](docs/memo.md#work-folders-on-nodes): path, branch and window lines kept current.
- [A file in your format](docs/mirrors-and-exports.md#keep-a-file-in-your-format), such as a todo list, rewritten from the memo at every save.
- Block ids, references and embeds checked and repaired (`fix`).
- Scheduled runs of reflection, skill upkeep and outside sources, with questions left for you.
- [Phone sync through Tine](docs/sync.md#tine-and-phone-sync), and every message in English and Korean.
- Add-ons: [`excudo-works`](https://github.com/cudoment/excudo-works) (npm `excudo-works`) adds a daily routine kit on top of an Excudo workspace.

## Update the engine

Check for a newer release before choosing whether to install it.

```sh
npx --no-install excudo update
npx --no-install excudo update --channel next --json
npx --no-install excudo update --apply
```

The default channel is `latest` for stable releases.
`--channel next` compares beta and stable tags and chooses the higher version. Without `--channel`, an installed prerelease follows `next` and any other version follows `latest`.
The command prints the installed and registry versions, available release notes and the exact install commands.
It installs only with `--apply`, from your workspace, then refreshes its skills.

Each installed engine skill copy records a fingerprint; only unmodified copies are replaced.
Owner edits, extra files and foreign links stay in place.
Backups go under the cache folder's `skill-backups` directory.
Printed paths let you compare and merge preserved copies before retrying.

Network, authentication and missing-tag lookup failures print distinct notes and exit successfully.
An installation failure exits with the npm error tail.
After `--apply`, run `excudo start --report` and the printed setup check to find missing template rules.
The command also prints versioned GitHub release and CHANGELOG links; npm metadata carries the newest section.

## Report a problem

Prepare a report locally, review it, then open its GitHub issue link when you want to share it.

```sh
npx --no-install excudo feedback --title "Cannot build" --message "What happened and what I expected"
npx --no-install excudo feedback --out feedback.md --json
```

The draft puts your message first and adds only versions, platform, onboarding states and fixed diagnostic identifiers.
Run steps outside the engine's known identifiers appear as `custom-step`; failed skill checks appear as `skill-check`.
Free-form run details and skill names require `--details` and carry a "review before sending" notice.

It redacts home, workspace and graph paths and their real paths.
It also redacts Windows drive paths, absolute paths of two or more levels, emails, IP addresses and private hosts; in `--details`, any other path is cut to the end of its line.
Only `github.com` and `npmjs.com` URLs remain.

Mark additional strings with `private: ["secret value"]` in `excudo.config.mjs`.
Strings inside an object marked `private: true` are also removed.
Broken configuration does not block `feedback` or `start --report`; their default output omits the private error text.

The command never sends a report or opens a browser; `--out` writes only the sanitized draft.

## Start with a skill

Requires Node.js 22.16+ (the current LTS, 24, is recommended) and an agent that reads Agent Skills. Once this repository is public:

```sh
npx skills add cudoment/excudo --skill excudo-setup
# All ten, if preferred:
npx skills add cudoment/excudo
```

Say “set up my memo”. The setup skill asks the location and language, installs the npm engine,
runs `init`, then runs `npm install` in the new workspace. `init` installs all ten skills into
`.agents/skills/` and links `.claude/skills/` to that copy. Reopen your agent in the workspace.
Repository-root discovery should find `skills/`; use the explicit `--skill` option for setup alone.
The registry and remote installation paths will be verified after the first publication.

| Action | Claude Code | Codex |
| --- | --- | --- |
| Capture | `/excudo-capture renew my passport` | `$excudo-capture renew my passport` |
| Cleanup interview | `/excudo-distill` | `$excudo-distill` |
| Setup | `/excudo-setup` | `$excudo-setup` |
| Outside sources | `/excudo-sources pull my issues` | `$excudo-sources pull my issues` |
| Recall | `/excudo-recall what changed in the site?` | `$excudo-recall what changed in the site?` |
| Reflect | `/excudo-reflect` | `$excudo-reflect` |
| Learn skills | `/excudo-skills` | `$excudo-skills` |
| Keep a todo file | `/excudo-export` | `$excudo-export` |
| Follow a note kept elsewhere | `/excudo-follow` | `$excudo-follow` |
| Work on tasks handed to agents | `/excudo-queue` | `$excudo-queue` |

You can also just ask in English or Korean. Each skill pairs Markdown instructions with scripts: at
the least a check that tells whether the skill's work met its requirements (see “Skills carry their
own code”). The engine handles generation, checking, movement, archives and commits; skills handle
placement, summaries and decisions. Network is needed during installation only. All later calls use the local
engine via `npx --no-install excudo`. If it is absent, run `npm install` in the workspace.
`skills --force` updates outdated skills (a copy that differs from the package is kept and backed up once; `skills --replace <name>` or `--replace-all` replaces it after the backup); `skills --global` installs in `~/.agents/skills/` and links
it from `~/.claude/skills/` and `~/.codex/skills/`, for each agent whose folder is in your home, as
learned skills are. Use `EXCUDO_ROOT` when calling global skills from another folder. A
workspace that installs a local clone of the engine (`file:`) can link the skills to it instead of
copying them, so they change with the clone: `skills --link --force` (`skills --copy` copies again).

### Command-line setup

After the npm package is published:

```sh
npx -y excudo@^0.9.1 init my-memo --locale en
cd my-memo
npm install
git init
npx --no-install excudo check
```

Before publication, from a local clone:

```sh
npm install
node bin/excudo.mjs init ../my-memo --locale en
```

Then enter the new workspace and run `npm install`. The dependency points to the clone.
`EXCUDO_PACKAGE` overrides the package with a local folder or tarball for the same
setup flow. `init --example` creates the English [dummy example](example/notes) and refuses another
locale; `--graph` changes the folder.

## Documentation

The reference pages hold the sections that used to follow here; the Korean pages end in `.ko.md`.

- [Your memo](docs/memo.md): the first list, the cleanup interview, nodes and generated boundaries, finding details, Home, work folders
- [Sources and learning](docs/sources-and-learning.md): outside work, current knowledge, followed notes, learning from your requests, recording what you did
- [Mirrors and exports](docs/mirrors-and-exports.md): one list kept the same in several places, files kept in your format
- [Automation](docs/automation.md): scheduled runs, handing work to agents, seeing how it stands
- [Agents and instructions](docs/agents.md): choosing a worker and independent reviewers, keeping session instructions small
- [Skills](docs/skills.md): skills that carry their own code
- [Website](docs/website.md): the memo as a website, publishing, changing a task's state, the dashboard on Home
- [Sync](docs/sync.md): Tine and phone sync, using it on several computers
- [Reference](docs/reference.md): every command and setting
- [Development](docs/development.md): testing, releasing and the repository layout

## Learn from your requests

Agents read the requests you type to coding agents here and turn lasting decisions into interests and recurring work into skills.
Read more in [Sources and learning](docs/sources-and-learning.md#learn-from-your-requests).

## Skills carry their own code

Every skill carries a script and a check that must pass.
Read more in [Skills](docs/skills.md#skills-carry-their-own-code).

## A dashboard on Home

The website's Home can show a dashboard at its top.
Read more in [Website](docs/website.md#a-dashboard-on-home).

## Use it on several computers

A workspace can stay in step across computers through a private GitHub remote or a folder the Google Drive app syncs.
Read more in [Sync](docs/sync.md#use-it-on-several-computers).

## License

MIT
