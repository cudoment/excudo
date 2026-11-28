# Sync

[README](../README.md) | English | [한국어](sync.ko.md)

## Tine and phone sync

Open the graph folder (default `notes/`) in Tine. To switch a running macOS app to another graph,
fully quit it first, then run:

```sh
TINE_GRAPH=<graph-folder> /Applications/Tine.app/Contents/MacOS/tine <graph-folder>
/Applications/Tine.app/Contents/MacOS/tine doctor <graph-folder>
```

Passing a graph to a running app through `open -a` or `tine open` does not switch it.
`tine export` failed on 0.6.986 at “Rebuilding the query index…”; it works on 0.7.1, but use
`tine doctor`, not an export, to validate a graph.
Install Tine from [tine.page](https://tine.page) if absent.

Share only the graph folder with Syncthing, enable file watching and 30-day trash-can versioning,
and connect it on Android with Syncthing-Fork. Open the synced folder in Tine. `.stignore` keeps
views, outliner backups and the engine's temporary files on the computer. Capture urgent notes in journals; distill files them
into nodes. Keep the workspace's engine, skills, caches and review decisions outside phone sync.

## Use it on several computers

Keep one workspace in step on several computers through git. Pick a private GitHub repository or a Google Drive folder. Ask your agent, “sync my memo across my computers”, or run the commands below. A workspace that does not set `sync` runs no sync code: no check, no warning, no network. `excudo start` only lists one more optional step, "Use it on several computers", as unknown.

**Pick a method.**

- **GitHub**: a private repository is the remote. Pick it when you have a GitHub account. It is the simplest and the fastest, and the repository keeps the full history.
- **Google Drive**: every computer writes its own git bundle into a folder the Google Drive desktop app syncs, and merges the bundles the others wrote. Pick it when you have no GitHub account. The `.git` folder never goes into Drive, because a sync app copying a live repository file by file corrupts it. A bundle is one file written in one step, and each computer writes only its own.

**Set it up on the first computer.** The workspace needs a git repository with a commit (`git init`, then `excudo save`).

```sh
# GitHub: makes a private repository with gh and adds it as the remote
npx --no-install excudo sync setup github --create <owner/repo>
# Google Drive: a folder inside the folder the Drive app syncs
npx --no-install excudo sync setup drive --folder "~/Google Drive/My Drive/excudo"
npx --no-install excudo save "Set up sync"
npx --no-install excudo sync
```

The setup writes the `sync` setting once, with a workspace id (so two workspaces can share one Drive folder, under `<folder>/<id>/`). If `gh` is missing or logged out, the command prints what you run (`brew install gh`, `gh auth login --web`) and stops; Excudo never enters or stores a credential. Without `--create`, `sync setup github` uses a remote you added (`--remote <name>`, default `origin`).

**Set it up on the second computer.**

- GitHub: `git clone <url> my-memo`, `cd my-memo`, `npm install`. The settings come with the clone. Run `npx --no-install excudo sync --pull` before the first build or save, so the clone is marked as new, then check with `npx --no-install excudo sync --status`.
- Google Drive: make an empty workspace and join the memo by its id. `excudo sync --status` on the first computer shows the id, which is also the name of the folder inside your Drive folder.

  ```sh
  npx -y excudo init my-memo --locale <en or ko, as on the first computer> && cd my-memo && git init && npm install
  npx --no-install excudo sync setup drive --folder "<this computer's Drive folder>" --id <id>
  npx --no-install excudo sync --pull
  ```

  The setup reads the memo's language and graph folder from its bundle and stops when this folder was made differently (pass the same `--locale` and `--graph` to `init`). The first pull takes over the other computer's history and does not rebuild. Everything in the graph folder that `init` wrote, and every other file the history also has, moves to `.excudo/sync-before/`, so nothing is lost. The setup stops while the folder holds no readable bundle of that memo (a wrong id, or Drive has not finished syncing): wait and run it again. Do not run `excudo save` before the first pull, or the folder makes a history of its own that never joins the memo; a joining folder whose pull takes nothing over fails and says so, while a first computer that has no commit yet is told to run `excudo save`. On a computer with history, a bundle on another branch is skipped with a warning, and so is a bundle of another memo as long as one related bundle exists; when every bundle found is another memo's, the sync fails before it pushes.

**Use it.**

- `excudo sync` pulls, then pushes. `--pull` only brings changes in, `--push` only sends, `--status` shows the method, the remote or folder, the last sync, ahead and behind, and the other computers seen (no network), and `--json` works on all of them.
- Pull stops while a tracked file has uncommitted changes: run `excudo save "<message>"` first. Merges are fast-forwards or plain merges. Nothing is rebased or forced.
- After a clean merge the engine runs the build that `save` runs and commits what it wrote, so generated regions match. Two kinds of generated text count as the other computer's engine output and not as hand edits: a view that shows one computer's records (an `activity` or `status` fence) whose text the merge itself changed, and, on a computer that has not built yet (a fresh clone or a takeover; the first `sync` marks it), the history's generated pages and regions as they are. Every other incoming change to a generated region or page, a deleted `.excudo/build.json` outside a fresh clone included, stays protected like a hand edit: the build stops and names the file.
- A merge conflict aborts the merge, leaves the folder as it was, exits 1 and names the files. Resolve it with plain git, or ask your agent, and read both sides; never auto-resolve.
- Drive skips a bundle that is not whole (Drive may still be syncing it) or whose name this engine did not write (a Drive conflict copy such as `name (1).bundle`), and says so. Run `excudo sync` again a moment later.
- The Drive folder and the workspace must not contain one another, and the workspace must stay out of Google Drive: setup refuses the first and warns about the second.
- Each computer's name for its bundle comes from its hostname and lives in `.excudo/sync.json`, which git ignores. Set it with `--machine <name>` at setup. A name whose bundle this computer never wrote is refused, even when you choose it, so one computer never overwrites another. If the branch names differ (`master` against `main`), a new computer takes the memo's branch on its first pull; two computers that both have history on different branches fail with both names.

**Automatic sync for an owner new to git.** Add `--auto` to the setup (or `auto: true`). Then `excudo save` also pushes after its commit, and also when it commits nothing but an earlier offline commit is still unsent (a failed push is a warning and the commit stays, so scheduled runs push too), and `sync` saves your changes before it pulls. Setup adds a rule to `AGENTS.md`, which the setup check asks for only in a workspace with `auto: true`: at the start of every request the agent runs `npx --no-install excudo sync --pull` before reading or changing the memo, and it finishes with `excudo save`. You never run git yourself. Only `sync` and `save` with `auto` pull or push.

**What is synced.** The git history: the graph, the records `save` commits and `excudo.config.mjs`. `save` commits only those, so `sync setup` and the first push also commit what `init` wrote beside them and git does not track yet, and show the list: `package.json`, `package-lock.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md` and the skills folders. A clone needs them to run `npm install`. Ignored files and your other untracked files are never added. **What is not.** `node_modules/` and `.excudo/` (the caches, the requests read from agent logs, the machine-local state): each computer installs with `npm install`, and each reads its own agent logs.

Run the schedule on one computer only; two schedules would write the same pages at once. Phone sync with Syncthing is separate: it shares the graph folder, not git (see "Tine and phone sync"). The check named `sync-conflict` is about copies a sync app such as Syncthing leaves, not about this command.
