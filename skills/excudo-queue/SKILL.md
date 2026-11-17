---
name: excudo-queue
description: Take the tasks the owner handed to agents in the memo (open tasks carrying the queue tag, agent or 에이전트 in Korean), work out each one by reading only, write a report, and leave it under the task for the owner to review. Use for "handle the agent queue", "work on the tasks I tagged for you", "에이전트 큐 처리해 줘", "맡긴 할 일 처리해 줘", or a scheduled run that hands over queued tasks.
---

# Work through the tasks handed to agents

Locate the workspace by the nearest `excudo.config.mjs`, or `EXCUDO_ROOT`, and enter it.
If there is neither, stop: say this folder is not in an Excudo workspace and ask which one to use.
First verify `node_modules/.bin/excudo` exists and is executable. Use only its local
engine. If it is missing, tell the owner to run `npm install` there and stop before invoking npx.
This skill's scripts are in its folder: `.agents/skills/excudo-queue/scripts/` from the
workspace root (`~/.agents/skills/…` for skills installed with `--global`).

The owner hands a task to agents by tagging an open task in the memo with the queue tag (`#agent`,
`#에이전트` in Korean, or the `queue.tag` setting). An agent takes it, reads what it needs, and reports;
the report comes back as a waiting line at the end of the task (`WAITING Review: …`, `WAITING 검토: …`)
with a link to the report file. The owner decides what happens next: they write an answer below the
report (the task is then ready again, and the next run follows it up), close the task, or take the
tag off. An agent never marks a queued task done and never closes it.

## Take a task

1. List the queue and note the commit you start from:

   ```sh
   npx --no-install excudo queue --json
   git rev-parse HEAD
   ```

   Take the `ready` items, at most `limit` of them in one run. Each has its `task` and `title`, the
   `node` and its `summary`, the work `folder` (from the node's path line or the nearest above), the
   `decisions` of that node and those above it, the newest `notes` below it (earlier reports and the
   owner's answers, newest last) and the `report` file the last report links to.
2. Work it out by reading only: the folder, the memo, and what the notes point to. Choose as the
   owner would: follow their decisions, and say which one a choice rests on. Never change files in
   the work folder, never commit, push, open a pull request, comment or send anything; propose it in
   the report instead. When the task needs the owner's judgment, ask in the report.
3. Write the report as a Markdown file in the workspace cache, never in the graph:
   `.excudo/reports/<key>-<YYYY-MM-DD-HHMMSS>.md`, a new file each time, so an earlier report
   the memo links to stays as it was. Start with one line that says what you found or
   propose, then the evidence (files and lines, commands you ran to read), what you would do next,
   and the questions for the owner. Write in the workspace's language. Never copy the owner's request
   text or anything that looks private (passwords, account or card numbers, keys, addresses).
4. Leave it under the task and save:

   ```sh
   npx --no-install excudo queue report <key> --summary "<the first line>" --file <report> --stamp <stamp>
   npx --no-install excudo save "Queue: reported on <title>"
   ```

   Pass the task's `stamp` from the listing you took it from. The engine refuses a summary that looks
   private; say it without that. When the task's file holds another task with the same words and the
   task changed since you took it, the engine refuses the report, since its key may now name the other
   one: list the queue again and take the task anew.

## Scheduled run

Nobody can answer. The run hands over which tasks to take; take only those. When the run does not let
you write files, answer with the report itself (its first line `Summary:`, `요약:` in Korean) and the
run writes it and leaves it under the task. Finish without waiting; leave everything that needs the
owner as questions in the report.

## Check

```sh
node .agents/skills/excudo-queue/scripts/check.mjs --key <key>... --since <commit>
```

It confirms each task you took has a report waiting for the owner, the report file exists, no line
that looks private reached the memo, the node rules hold and the work is saved. Fix what it reports,
save and rerun it until it passes.
