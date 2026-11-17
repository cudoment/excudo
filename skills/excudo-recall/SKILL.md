---
name: excudo-recall
description: Answer a question or do a task from what an Excudo memo and its knowledge nodes say, after bringing the knowledge of changed repositories and pages up to date; outside work items belong to excudo-sources, a note followed from another app to excudo-follow. Use for "what is going on in <project>?", "did I decide anything about…", "draft this from what you know", "update my knowledge", "bring my knowledge up to date", "지금 진행 중인 게 뭐야", "내가 전에 정한 게 있어?", "알고 있는 걸 근거로 써 줘", "지식 갱신해 줘", or "지식을 최신 상태로 맞춰 줘".
---

# Recall from the memo

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.

Knowledge nodes are the nodes of `repo` and `page` sources and everything below the nodes named in
the `knowledge` setting. Agents keep them up to date from their sources; the owner's other notes
change only when the owner asks. This skill keeps `repo` and `page` sources; `items` sources belong to
the sources skill, and `note` sources (a note the owner keeps in another app) to the follow skill,
even when `changes` lists them.

## Bring the knowledge up to date

Check first, every time; an answer from outdated knowledge is what this skill prevents:

```sh
npx --no-install excudo changes
```

Only the `repo` and `page` sources listed as changed, never marked, or to read in a browser need
work here; leave a `note` source to the follow skill. When the
owner is waiting and many unrelated sources changed, update the ones the request touches first and
say at the end which remain. Each line ends with the source's state in brackets, its token; keep it
for marking. For each source:

- A repository with new commits: read `git -C <path> log --oneline <range>` and
  `git -C <path> diff --stat <range>`, then only the files that change what the node says. Skip
  lock files, build output and bulk edits after a look at the statistics. Uncommitted changes are
  work in progress: mention them as such, never as settled facts.
- A folder: look at the files listed as changed.
- A page: read it as the sources skill's "Read a source in the browser" says (`excudo-sources/SKILL.md`
  next to this skill's folder), then compare with `changes <name> --input <file>`. Read new entries
  in full when they matter.
- Never marked: read the source once in full.

Never write to a source: no checkout, stash, edit or commit in a watched repository, and nothing
typed into a watched page. Update the source's node: change only the parts the change affects,
keep its `[[links]]`, and state facts with where they come from. A node and its source disagree:
the source is right; fix the node. When a fact spans several sources, put it in a knowledge node
about the topic and link to it. If nothing the node says changed (a typo, a dependency bump),
edit nothing. Then check the summaries up to the top, mark and save. If marking says the source
changed again since you read it, read the new changes first:

```sh
npx --no-install excudo tree --path <node>
npx --no-install excudo changes mark <name> --expect <token>
npx --no-install excudo changes mark <name> --input <file>   # a page source
npx --no-install excudo save "<what changed in the knowledge>"
```

Then run the skill's check for the sources you updated (without `--source`, every turned-on source
must be current). Fix what it reports and rerun it until it passes; when the owner chose to leave
some sources for later, name them instead. When you saved only your own pages (`save --only <page>`, as a scheduled run does while someone
writes elsewhere in the memo), give the check the same pages with `--only <page>`. This skill's scripts are in its folder: `.agents/skills/excudo-recall/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-recall/scripts/check.mjs --source <name> --source <name>
```

## Scheduled run

Nobody is waiting for an answer and nobody can be asked. Bring every source `changes` lists as
changed or never marked up to date, and the pages the run collected for you (files named in its
prompt), as above. When the run says how to read repositories, read them that way only. A change
whose meaning is unclear goes into its node as `Observed:` (`관찰:`) or `Assumed:` (`추정:`) with
where it comes from, instead of a question; never touch the owner's other notes. Mark, save and run
the check; name the sources you could not finish in the report. A repository whose uncommitted files
were edited minutes ago (`busy` in `changes --json`) is someone's work in progress: bring in its new
commits if it has any, and leave the drafts for a later run; the check allows that.

## Answer

Find where the answer lives with `tree`, read those nodes, then `find <words>` and
`find <words> --history`. Read the node named by the `interests` setting first when the request
touches something the owner may have decided before. Lines carry evidence grades:

| Grade | 한국어 | Use |
| --- | --- | --- |
| `Confirmed:` | `확정:` | The owner said it. Apply it. |
| `Observed:` | `관찰:` | Repeated in requests, not confirmed. Consider it. |
| `Assumed:` | `추정:` | An unverified reading. Never apply it by itself. |
| `Proposed:` | `제안:` | An agent's proposal the owner has not accepted. Never apply it by itself. |
| `Superseded:` | `대체됨:` | An earlier decision, with when and what replaced it. Never apply it. |

Before writing something that has gone out before (a notice, an announcement, a recurring
message), read what went out last time in its source, not only the node. Make the result in the
form the owner asked for: a briefing leads with the conclusion; a draft follows the target's
conventions in its knowledge node; a plan names the repository and files to start with.

End with the nodes (and source files) the answer rests on, and mark what is a guess. If a source
showed a fact the node lacks, offer to add it; fix a plain error in a knowledge node right away and
say so. Do not edit the owner's other notes while answering; a decision the owner states now is
left for the reflect skill, unless they ask to record it.
