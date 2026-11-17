---
name: excudo-skills
description: Turn recurring work into skills with scripts and checks, keep them fit, or trim AGENTS.md by moving procedures into workspace skills. Use for "make this a skill", "turn my recurring requests into skills", "manage my skills", "trim the instructions", "스킬로 만들어 줘", "반복되는 요청을 스킬로 만들어 줘", "스킬 정리해 줘", "지침 줄여 줘", or a scheduled skill upkeep.
---

# Learn skills from the owner's requests

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.
Candidates from recurring requests need `conversations` in `excudo.config.mjs`; trimming instructions does not.
This skill's scripts are in its folder: `.agents/skills/excudo-skills/scripts/` from the
workspace root (`~/.agents/skills/…` for skills installed with `--global`).

A skill embeds code that does part of its work the same way every time: at the least a check script
that tells whether the skill's requirements were met, with known cases lint feeds it to see that it
can fail, and scripts for the searches and changes that must come out the same. Instructions alone
are no skill. `skills lint` checks the required parts and scores the rest from 0 to 100; a learned
skill is installed only while it passes every required check and reaches `minScore` (the `skills`
setting, 80 unless set). Its source stays in the workspace's skills folder (`skills/` unless set)
and in git, and `save` refuses one that copies the owner's request text.

See how the learned skills stand, keep them in order, then see what waits:

```sh
npx --no-install excudo skills status
npx --no-install excudo skills upkeep
npx --no-install excudo skills candidates --json
```

`status` only reads: each learned skill's fitness, how and where it is installed, the requests for it
typed here and elsewhere, dormant skills and skill folders never adopted. When the owner only asks how
the skills stand, it is the whole answer. `upkeep` lints every learned skill again, takes one that no longer fits out of use (back to a draft),
holds one whose check only ran out of time on a known case (`held`: kept in use and installed until a run judges it; report it),
refreshes installed copies whose source changed, and adds the requests that called for each skill
since. Report what it changed and any skill it lists as `edited`: someone changed the installed copy,
and it is never overwritten. Ask the owner whether to move the change into the source (the copy then
matches it again) or to replace the copy with `skills adopt <name> --force`.

## Decide on each candidate

A candidate is a group of similar requests from more than one session. Read its `requests` (the
owner's words, shown only to you) and `places`. Make a skill when the work has steps that repeat and
requirements that can be checked: a procedure in one repository, a review against fixed criteria, a
conversion, a release routine. Read the node named by the `interests` setting: the owner's
`Confirmed:` (`확정:`) criteria for that work belong in the skill's check. Dismiss a candidate that is
conversation ("continue", "apply option 2", "done"), a one-off, or already covered by a skill
(`covered` names the skills its requests mention):

```sh
npx --no-install excudo skills dismiss <candidate> --reason "<a few words of your own>"
```

When the owner asks for a skill directly, make it from the request and their answers and adopt it
with `--requested` instead of `--from`.

## Make a skill

Choose a short name (lowercase letters and digits, hyphens) that says what the skill does and that no
installed skill uses (`ls .agents/skills ~/.agents/skills`). On a clash with the owner's skills, ask
the owner, or in a scheduled run choose another name. Start the skill:

```sh
node .agents/skills/excudo-skills/scripts/scaffold.mjs <name> --description "<what it does>. Use for “<the owner's phrases>”."
```

Replace every FILL IN mark:

- `SKILL.md`: what the skill does and where, the steps with the commands to run, and the check at the
  end. Write in the workspace's language. Summarize the owner's requests; never copy them, since the
  skill goes into git. No secrets, no paths into the home folder (write `~`), only shell commands
  and plain words that any agent can follow.
- `scripts/check.mjs`: `gather` reads what the work must leave behind and changes nothing, and
  `evaluate` judges it; `--facts <file>` judges given facts instead of reading them.
- `scripts/check.cases.json`: facts for at least one case that must pass and one that must fail (the
  work done right, a step left out). Lint feeds them to the check and watches its exit code.
- Further scripts in `scripts/` for steps that must come out the same every time, each starting with
  a usage comment and run from `SKILL.md`.

Lint it until it meets the rule, then adopt it:

```sh
npx --no-install excudo skills lint <name>
npx --no-install excudo skills adopt <name> --from <candidate>
```

`adopt` installs a skill that fits and records one that does not as a draft; fix what lint reports
and adopt it again (the skill keeps the candidate it was adopted from). To improve a skill in use,
edit its source, lint and adopt it again; never edit the installed copy. For a skill `upkeep` reports
as dormant (no request for it in `dormantDays`), ask the owner whether to take it out of use with
`skills retire <name>`.

## A mistake the owner pointed out

When the owner points out a mistake in work a learned skill did, fix the work. Then make the skill's
check catch that mistake, so it cannot pass unnoticed again:

1. Change `scripts/check.mjs` so it fails on the mistake: `gather` reads what shows it, `evaluate`
   judges it.
2. Add a case to `scripts/check.cases.json` that reproduces the mistake, with `expect: "fail"` and a
   name that says what went wrong in your own words.
3. Lint the skill, record the case and adopt the skill again:

```sh
npx --no-install excudo skills lint <name>
npx --no-install excudo skills mistake <name> --case "<case name>" --why "<the mistake, in your own words>"
npx --no-install excudo skills adopt <name>
```

`mistake` records the case in `skills.json` only when the case is there, expects fail and the check
fails on its facts now. It refuses a summary that copies the owner's request. From then on lint keeps
the case: removing it or turning it into a passing case fails lint, and `upkeep` takes the skill out
of use until the case is back. `status` shows how many mistakes each skill's check keeps. A mistake in
an engine skill's work is no learned skill's: change nothing installed, and report what the engine
skill's check should catch as a proposal for the engine.

## Where a skill goes

Put a skill where its work is done. A skill installed for this workspace (`.agents/skills` and
`.claude/skills` link to its source) is read only here; one in every folder (`~/.agents/skills`, a
copy with `SOURCE.md`, linked for Claude Code and Codex) is read everywhere. Read the candidate's
`places` and the `where` of its requests, then decide:

- **Work done in other folders**, even in a single other repository: in every folder, since this
  workspace cannot put a skill into another repository. Give your reason in a few words of your own,
  or `--requested` when the owner asked for it, and write its commands with `~/.agents/skills/<name>/`
  (the scaffold's `--global`).
- **Work that is this workspace's own** (its sources, its helper scripts, its scheduled runs): in this
  workspace, even when the `skills` setting has `install: "global"` (then adopt it with
  `--workspace`). A rule every session here must follow belongs in the workspace's `AGENTS.md`
  instead: a skill is read only when a request matches its description.
- **Memo work any workspace does** (writing, tidying, sources, knowledge, reflection, skills): no
  learned skill. The engine's skills do it; dismiss the candidate and report what the engine's skill
  lacks as a proposal to improve it.
- **Work elsewhere that needs no skill in every folder** (the agents' own commands or a skill already
  there cover it): dismiss the candidate, and ask the owner whether to retire such a skill in use. A
  skill kept here for work done elsewhere is never read where it is needed; the check reports one.
- **Unsure where it goes:** adopt it nowhere yet and ask the owner.

```sh
npx --no-install excudo skills adopt <name> --global --why "<why every folder needs it>"
npx --no-install excudo skills adopt <name> --workspace   # back to this workspace only
```

A skill stays where it went; `upkeep` keeps it there and reports for each skill how many of its
requests were typed here and elsewhere (`typed`). The check flags both ways a skill can sit in the
wrong place: one kept here but asked for mostly elsewhere, and one for every folder asked for only
here with no reason for other folders.

## Trim the instructions

Move procedures verbatim into workspace skills and retain the rules every session needs.
An owner's trim request authorizes the moves within their rules.
A scheduled run does so only with `instructions.auto: true`, starting over `limit` and stopping at or below `target`.
The default target is 85 percent of the limit; aim for it unless protected text makes it unreachable.

1. Read the owner's rules and run `npx --no-install excudo instructions --json`.
   Respect `instructions.keep` and the `<!-- excudo: keep -->` marker before a heading or top-level item, including its nested lines.
   Read `pinned`, `movable` and the largest `pinnedBlocks`; never move pinned text or template rules, while unpinned siblings may move.
2. Start with saved instructions, skills, their links and `skills.json`.
   Keep `git rev-parse HEAD` as `<before>` and the previous cache; list existing, changed and created paths.
   Leave someone else's uncommitted work alone and report why trimming cannot start.
3. Read candidates largest first and verify each target skill's description covers the procedure; the most named skill is only a suggestion.
   Engine skills are never targets.
   When the owner's rules forbid a move, leave it and report; ask only in an interactive run.
4. Use the move command for each block with current ranges from a fresh report; `--dry-run` previews it.
   It copies the block unchanged to `references/<name>.md` and links it once from `SKILL.md`.
   Supply one or two lines with the rule every session needs; the command adds a details pointer when needed.
5. Create new skills by "Make a skill" above and adopt with `--requested --workspace`.
   In a scheduled run, use only scripts already in the workspace, with a check and passing and failing known cases.
   Otherwise leave the block and report why.
6. Refresh touched workspace skills with `skills adopt <name> --requested --workspace`, retaining this run's changed paths.
   Run preservation with `--uncommitted` and the commands below; review the diff and run changed skills' checks.
   On failure restore changed files from `<before>` and the previous cache; delete only files this run created.
7. Commit this run's instructions and skill files together with their records and links.
   Name the moved blocks, for example `Instructions: Move release and verification procedures`, then rerun saved preservation without `--uncommitted`.
   When preservation passes, committed instructions and skills refresh the ignored `.excudo/instructions.json` cache.

```sh
npx --no-install excudo instructions move --lines <start>-<end> --to <skill> --reference <name> --pointer "<always-on rule>" --since <before>
node .agents/skills/excudo-skills/scripts/check.mjs --trim-since <before> --uncommitted
npx --no-install excudo check
npx --no-install excudo skills lint
npx --no-install excudo instructions --json
node .agents/skills/excudo-skills/scripts/check.mjs --trim-since <before>
```

Unrelated unsaved memo edits still fail the check but do not prevent the committed trim's cache refresh.
`--uncommitted`, `--facts` and `--self-test` never refresh the cache.

Commit nothing when a check fails.
`--since` permits another move before the commit only when the working tree still preserves the baseline.
Without it, both `AGENTS.md` and the target `SKILL.md` must be tracked and unchanged.

The preservation check keeps template rules, pinned text and the original occurrence counts of contiguous removed block pieces.
It splits hunks at baseline level-two/three heading sections and top-level list items, allowing adjacent blocks to move to separate references.
It counts each piece in `AGENTS.md` and the skills' Markdown, both at the baseline and at HEAD.
With `--uncommitted`, it compares the working tree instead of HEAD; blank-only pieces do not count.
It cannot judge whether the remaining rules cover every session; review that yourself.

`--uncommitted` permits instructions, skills, their records and links awaiting the trim commit.
It still checks unrelated unsaved work and every other skill requirement.

Report before and after bytes, target and limit, moved blocks and targets, and remaining blocks with their reasons.
New skills always need scripts, a check and known cases; a prompt alone never qualifies.

## Scheduled run

Finish without waiting for an answer; leave uncertain work for the report.
Make and adopt only skills whose work is clear and that meet the rule and `minScore`.
Place workspace procedures with `--workspace`; use `--why` for a skill every folder needs.
Dismiss plain conversation and work the engine's skills or the agents' own commands already do.
Leave a retirement, name clash or uncertain placement for the owner.

Run `excudo instructions --json` on every scheduled skill upkeep.
Without `instructions.auto`, report candidates and wait for the owner's trim request.
With it, start above `limit` and move candidates largest first until bytes reach `target`.
Being above `target` alone does not start a trim.

When `targetBlocked` is true, report the protected bytes and largest pinned blocks.
Still move safe candidates while over `limit`; once within it, stop and report that `target` is unreachable.
Do not keep moving material merely to pursue an unreachable target.
If no safe move can bring it within the limit, pass `--trim-reason` with that blocker.

When no safe candidate remains, report each blocker and the remaining bytes.
After starting an automatic trim, include `--scheduled` in both preservation checks.
For other blockers above target, pass `--trim-reason "<why the remaining blocks cannot move>"`.
An unreachable target within the limit supplies its own reason to the scheduled check.

The check requires reaching the target or reporting the reason, while still requiring full preservation.
A failed check restores the whole run before any commit, as described above.

## Save and check

```sh
npx --no-install excudo save "Skills: <what changed>"
node .agents/skills/excudo-skills/scripts/check.mjs
```

Fix what the check reports, save again and rerun it until it passes. Report the skills made, adopted,
demoted or retired with their scores and where each is installed (and why, for every folder), the
mistakes recorded, the candidates dismissed and why, what the engine's skills lack, and what waits
for the owner.
