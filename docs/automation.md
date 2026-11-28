# Automation

[README](../README.md) | English | [한국어](automation.ko.md)

## Run on a schedule

A scheduled run (reflection, skill upkeep, collecting sources) should not change the memo while you
do. `save`, `snapshot`, `ingest` and `archive` hold one graph lock (`.excudo/graph.lock`), so two
of them never commit at once; another waits for up to a minute. Before a run starts, `idle` says
whether it may: exit 0 when the memo is free, 1 while a command holds the lock or a graph file left
uncommitted changed in the last minutes (`--minutes`, 10 by default; an edit synced from a phone
counts), and 3 when a page holds the pause line:

```md
- automation:: paused
```

Write it on any page, from any device, to stop every scheduled run; delete it to resume. Korean
workspaces write `자동 실행:: 멈춤`, and either works in any locale. `--json` tells which files and
pages held it back.

A generated page left uncommitted (a save that stopped halfway) is not counted as an edit. A run that
would rather go on than wait can hold the files someone else is changing: it lists them in
`EXCUDO_HOLD` (one path a line, from the workspace folder; a folder holds what is inside it). `idle`
then no longer waits for them, `save` and `snapshot` leave them out of every commit, and the skills'
checks do not ask to save them. The run records the memo as it was before those edits, and the edits
stay in place for their own commit. Commands that write the memo leave a held page alone and take up
its work at a later run: the build skips its generated section, a collection takes no item for it and
settles nothing on it, a queue report waits, `archive` leaves its finished items (and moves nothing
while the done node is held), a change from the website waits with its batch left open, and skill
upkeep leaves a held skill (any file in its folder) as it stands. Errors in a held page do not stop a
save of other pages. A page added, deleted or renamed a moment ago counts as an edit in progress, by its
folder's time, both names of a rename with it.

An edit can be left finished rather than in progress. `idle --settle N` sorts the uncommitted edits:
one nobody has touched for N minutes whose files pass the check is `settled` (whatever its age), and
the rest stay `recent`. A page left half written, such as a broken title, is not settled however quiet
it is: within `--minutes` it is recent, and past that `unsettled`, which a run holds without waiting for
it. A file changed while the check ran, or first changed then, counts as being written; an error the
check gives a folder (a child folder left without its page) keeps that page and the folder's files from
settling, and the two names of a rename settle together.
`snapshot --settle N` sorts and commits the settled edits on their own under the graph lock, as the
check read them (an editor writing meanwhile keeps its edit in the work tree), and commits nothing
while the memo is paused, so a run
then works on those pages as usual and holds the recent and unsettled ones.
So an edit that stopped a few minutes ago is taken up by this run instead of the next one, and an old
uncommitted edit gets a commit of its own instead of joining a run's commit. Pick N longer than an
edit from a phone takes to sync.

Each step can be recorded with `runs add <step> --status ok|failed|deferred|paused` (`--reason` for why).
`runs` lists the last 7 days newest first; `--days N` changes the range.
Repeat `--step <name>` to select steps, and use `--failed` or `--deferred` to select their status.

Both status flags together select either status. Text details stop at 160 characters unless `--full` is set.
`--json` keeps the complete details and the existing fields; the filters apply to it too.

`backup <folder>` writes a consistent
copy of the cache: the records, the build protection and the watched notes. The agents delete their
logs after a while, so the records may be the only copy of your requests; back them up with the run.
The copy holds your request text, so the folder must be one git ignores, outside the cache and the
graph and not reached through a link; another backup to the same folder replaces the records only
once it is complete.

## Hand work to agents

Tag an open task with `#agent` (`#에이전트` in Korean, or the `queue: { tag }` setting) and it is
queued for agents. `queue` lists the queued tasks, each with what an agent needs to choose as you
would: its node and the node's summary, the work folder of the node's path line or the nearest one
above, the `Decision:` lines of that node and those above it, and the lines already below the task.
The `excudo-queue` skill takes the ready ones (`queue: { limit }` per run, 2 unless set), works
each out by reading only, writes a report in the cache (`.excudo/reports/`) and leaves it under
the task:

```md
- TODO Check the links on the new guides #agent
	- WAITING Review: Two links point to removed pages; the fix is in the report [report](file:///…)
```

The task then waits for you. Write your answer below the report and it is ready again, so the next
run follows it up; close the task or take the tag off when it is done. An agent never marks a queued
task done, changes files in its work folder, or sends anything: it proposes those in the report.
The skill's check confirms each task taken has a report and a report file, and that nothing that
looks private reached the memo.

## See how it stands

A view with a `status` fence shows how the work around the memo stands: the scheduled steps of the
last days (`days: 7` unless set) with their last result, the tasks handed to agents, ready or waiting
for review, how each skill was used and how its checks went in the last 30 days (a skill whose checks
fail more often than they pass is marked), when each outside source was last read, and how many
questions a reflection left for you.

````md
```status
days: 7
```
````

`skills status` and `skills upkeep` show the same check results for the learned skills, and a skill
the agents ran lately counts as in use, whatever the requests that called for it said.
