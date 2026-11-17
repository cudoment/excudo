---
name: excudo-reflect
description: Turn the lasting decisions, working preferences, judgment criteria, prohibitions and corrections in the requests the owner typed to coding agents into interest nodes of an Excudo memo. Use for "reflect on my requests", "learn from what I asked", "update my interests", "회고해 줘", "관심사 정리해 줘", "지금까지 요청한 것 반영해 줘", or a scheduled reflection.
---

# Reflect on the owner's requests

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.
Reflection needs `conversations` turned on and an `interests` node in `excudo.config.mjs`;
if either is missing, ask the owner (the setup skill describes them) and stop.

Most requests are used once. Reflection keeps the few that shape later work. Commit the owner's own
edits first, then read the requests since the last reflection:

```sh
npx --no-install excudo snapshot
git rev-parse HEAD
npx --no-install excudo requests --for reflect --candidates --json
```

Keep that commit: the check at the end compares what the reflection wrote with it.

Read each request's whole `text` in the JSON; the plain listing shortens long ones, and a decision
often comes at the end. Text the owner pasted shows as `[pasted N]`, with its length and start in
`pasted`: someone else's words (a review, a specification), never a hit of its own. Only what the
owner wrote around it counts. `--candidates` keeps requests with words of a lasting decision; read all of
them (without `--candidates`) only with a reason. With more than 30, work through them node by node.
Keep only these and drop one-off instructions:

| What | How to recognize it | Example |
| --- | --- | --- |
| Decision | It fixes a notation, a default or a rule | "Write 'A to B', not 'between A and B'." |
| Working style | It says how to work from now on | "From now on, answer remix requests in this format." |
| Judgment | It says what is good or bad | "The letter spacing is too tight to read." |
| Prohibition | It says what not to do | "No need to upgrade Prettier." |
| Correction | The owner corrected an agent's wrong assumption | The most valuable kind: it prevents the same mistake. Of a skill's work, it also belongs in that skill's check (below). |

Only the owner's own words are `Confirmed:` (`확정:`); a repeated pattern they never stated is
`Observed:` (`관찰:`), a reading of yours `Assumed:` (`추정:`). An agent's suggestion is never the
owner's decision. Never copy request text into notes or files: summarize in your own words and keep
the date and the related node. The requests themselves stay in the workspace cache.

Gather hits in `reflect.json` in the workspace root, next to `review.json`:

```json
{
  "candidates": {
    "docs-english-notation": {
      "node": "Docs",
      "hits": [{ "date": "2026-08-14", "grade": "confirmed", "note": "Use 'A to B' instead of 'between A and B'." }]
    },
    "release-notes-dates": {
      "node": "Site",
      "hits": [{ "date": "2026-10-13", "grade": "confirmed", "skill": "release-notes",
        "case": "notes leave out the merge dates", "note": "Each release note needs the date of its merge." }]
    }
  },
  "questions": [
    { "date": "2026-10-13", "note": "Two different defaults were stated for X; which holds now?" },
    { "date": "2026-10-13", "skill": "release-notes", "case": "notes leave out the merge dates",
      "note": "The release-notes check should fail on notes without merge dates; fix it now?" }
  ]
}
```

A correction of work a skill did must also be caught by that skill's check from then on. Give its
hit the skill's name (`"skill"`) and the name of the case that reproduces the mistake (`"case"`, the
one in the skill's `scripts/check.cases.json`, or the one you propose). Each correction has its own
case, so another mistake recorded for the same skill answers for no hit but its own. For a learned
skill (one in `skills.json`), look for that case among its `mistakes` there, recorded on or after the
hit's date by `skills mistake` (see the excudo-skills skill). When it is not there, add a question
with the same `skill` and `case`, as in the example. That happens in a scheduled run, where nobody
confirms a fix, and for one of the engine's skills, which only the engine changes.

With the owner present, a learned skill's check may be fixed and the mistake recorded at once
instead. The check at the end fails while a correction of a skill added since the commit is neither
recorded nor asked.

Promote a candidate to an interest node when the owner said to remember it or to work that way from
now on, when it came up in two or more sessions, or when it is a decision, prohibition, default or
criterion that changes later work. Otherwise keep it as a candidate; a topic that comes up once and
then again later qualifies then. Merge candidates that are one concern split in pieces.

An interest node sits below the `interests` node: `# Title`, a one-paragraph summary, then lines with
a grade and a date, and `[[links]]` to the nodes it is about. Do not restate what a knowledge node
says; record what the owner cares about when working on it. When a decision changes, turn the old
line into `Superseded:` (`대체됨:`) with when and what replaced it; never delete it. When a rule holds
across many nodes, move it to a knowledge node about the topic and leave the link and the reason.
Move an interest below an archived child only when the owner says it is over; inactivity is no
evidence. When the owner said conflicting things, do not pick the latest silently: record both
with their dates and add a question.

With the owner present, ask the waiting `questions` (at most four at a time) and apply the answers.
In a scheduled run nobody can answer: add hits, promote only what the owner explicitly asked to
remember or to do from now on, put everything that needs judgment into `questions`, and finish
without waiting.

Mark the requests read up to the `until` in that JSON (the newest request the listing considered),
and save:

```sh
npx --no-install excudo requests mark --for reflect --until <until>
npx --no-install excudo save "Reflect: <what changed>"
```

Then run the skill's check with the commit from the start. It fails when a note, `reflect.json` or a
commit message copies the owner's request text: rewrite that part as a summary, save and rerun it
until it passes. This skill's scripts are in its folder: `.agents/skills/excudo-reflect/scripts/` from the workspace root
(`~/.agents/skills/…` for skills installed with `--global`).

```sh
node .agents/skills/excudo-reflect/scripts/check.mjs --since <commit> --requests
```

Report how many requests you read, the interest nodes created or changed, the candidates added, the
questions waiting and the check's result.
