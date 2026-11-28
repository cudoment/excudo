# Skills

[README](../README.md) | English | [한국어](skills.ko.md)

## Skills carry their own code

A skill here is more than a prompt: it embeds code that does part of its work the same way every
time. Each skill folder holds `SKILL.md` and `scripts/`, with at least `scripts/check.*`, which says
whether the skill's requirements were met (exit 0 or 1, `--json` for details), and
`scripts/check.cases.json`, known cases that must pass or fail. `skills lint` feeds the check each
case's facts itself (`--facts <file>`) and watches its exit code, so a check that cannot fail is
caught.

Cases run concurrently (`EXCUDO_CASE_JOBS`: CPU parallelism up to 8 by default, 1 for serial).
Unexpected results are retried alone; if the helper fails, lint runs every case serially.

Searches and changes that must come out the same live in further scripts that `SKILL.md` runs.
A skill must meet every required check; the quality criteria score it from 0 to 100:

| Criterion | Points | What it asks |
| --- | --- | --- |
| Required | - | `SKILL.md` with the folder's name and a description; a script; `scripts/check.*`; its cases judged as expected, at least one that must pass and one that must fail; every script run from `SKILL.md` and every script it names present; scripts that parse; no `FILL IN:` mark left; no tool calls that only one agent understands; no secret; for a learned skill, no passage copied from your requests, and every case recorded for a mistake you pointed out still a case that must fail |
| `runs-check` | 25 | `SKILL.md` runs the check in a command block |
| `triggers` | 20 | the description says when to use the skill |
| `usage` | 20 | each script starts with its usage |
| `portable` | 20 | no path into this machine's home folder |
| `size` | 15 | `SKILL.md` within 500 lines and long enough to follow |

A check that asks whether the work is saved looks at the whole graph, or with `--only <page>` at the
pages a run saved with `save --only`, so it passes while someone writes elsewhere.

A mistake you point out in a skill's work is caught from then on. The agent fixes the work, makes the
skill's check fail on that mistake and adds a case that reproduces it (`expect: "fail"`). For a
learned skill it then runs `skills mistake <name> --case "<case>" --why "<summary>"`. The command
records the case in `skills.json` only when it expects fail and the check fails on it now. It refuses
a summary that copies your request.

Lint keeps each recorded case: removing it or making it pass fails lint, and `upkeep` takes the skill
out of use until it is back. `skills status` shows how many mistakes each skill's check keeps. A
reflection that finds such a correction asks you about one not yet recorded. A mistake of an engine
skill goes to the engine, where it becomes a failing case of that skill's check. Every workspace's
`AGENTS.md` carries this rule.

The engine's skills all score 100, and a test keeps them there. With `conversations` on, a
workspace also learns skills from your requests. `skills candidates` groups requests with similar
words (compared by three-character pieces, so Korean works as well as English) that recur at least
`minRequests` times in `minSessions` sessions within `windowDays`. The `excudo-skills` skill
reads each candidate, dismisses conversation and one-offs (`skills dismiss <id> --reason …`), and
turns recurring work into a skill: its scaffold starts `skills/<name>/`, the agent writes the steps
and the check, `skills lint` scores it, and `skills adopt <name> --from <candidate>` installs it once
it meets the rule and `minScore` (80 unless set); one that does not fit stays a draft.

`skills upkeep` lints learned skills, refreshes installations, counts requests and lists dormant skills.
It holds a skill when a known case only times out or hits a network or authentication error.
An ordinary failing verdict or a score below `minScore` still takes the skill out of use.
An edited installation stays untouched and is reported.
`skills retire <name>` takes a skill out of use; `skills adopt <name> --force` replaces an edited installation.

Use `skills: { keep: ["release-notes"] }` for skills that scheduled steps depend on.
Upkeep never demotes or retires a listed skill.
When its checks fail, upkeep keeps it installed, reports `state: "held"` with the failing checks and exits 1.
This exit code applies to text and JSON output. Fix the checks, then run upkeep again.

Commands that change the record wait for each other. `skills.json` records the skills and dismissed candidates by request
keys, counts and dates, never by the requests' words, and `save` commits it with the skill sources,
refusing when a skill or `reflect.json` would bring words you typed to an agent into git.

A skill goes where its work is done. One for the workspace's own work is installed for the workspace: `.agents/skills/<name>` and
`.claude/skills/<name>` link to its source, and `save` commits the links. One for work in other
folders, even in a single other repository, goes to every folder with `--global --why <reason>` (or
`--requested` when you asked; without either, `adopt` keeps it in the workspace unless the setting is
`install: "global"`; the workspace's own work stays in the workspace even then, with `--workspace`): it
is copied to `~/.agents/skills/<name>` with a `SOURCE.md` naming its source
and linked from `~/.claude/skills` and `~/.codex/skills`.

A linked Git worktree can check these global copies against its own skill sources.
It reads the owning checkout's install record when its own record is absent.
Installing, refreshing or removing those copies requires the owning checkout; the linked worktree leaves them unchanged.

Memo work any workspace does is left to the
engine's skills, and work the agents' own commands already do gets no skill. `upkeep` reports where
each skill's requests were typed, and the skill's check flags one kept in the workspace but asked for
mostly elsewhere, where it is never read, and one for every folder asked for only in the workspace
with no reason other folders need it. Each skill stays where it was adopted, and `--workspace`
brings one back. Run the skill on a schedule to keep this going: a scheduled run makes
and adopts only what clearly fits and leaves the rest for you.
