# Website

[README](../README.md) | English | [한국어](website.ko.md)

## See the memo as a website

The engine can write the memo as a website, with cudoc-export, to read it where Tine is not: a
browser on the computer, a phone, a static host. Every node is a page that ends with a folding tree
of the nodes below it; Home and the generated views are pages too, with each `{{query}}` replaced by
the result it had when the site was built; the journals join when asked. A `[[page]]` is a link, a
task is a checkbox with its state, a `DEADLINE:` a date beside its task, and the outliner's own
properties (`collapsed::`, `id::`) are left out. The website keeps every page's address in the memo
(`data-excudo-page`, `data-excudo-line`), so a tool can lead from a line on a page back to its file.

```js
site: {
  out: ".excudo/site",   // from the workspace, or ~/…; outside the graph, replaced whole
  title: "My memo",      // the workspace folder's name unless set
  mode: "site",          // or "standalone": Home as one page carrying everything it shows
  open: 0,               // levels of a node's tree unfolded at first; folded unless set
  journals: false,       // publish the journals under a Journals page
  css: [],               // stylesheets loaded after the engine's
  onSave: true,          // build and save write the website too; false leaves it to site
},
```

Install the exporter once (`CUDOC_SKIP_BROWSER_DOWNLOAD=1 npm install cudoc-export@^1.0.0`; the
engine loads it only when a website is written) and run `excudo site`, with `--open` to open its
Home. A page's sections (query results, the tree below a node) start folded, so a page reads as
its titles first. A small runtime on every page searches the nodes and shows on Home where you left
off. On a wide screen the list of documents on the side is open only along the way to the page; on a
narrow one it leaves the page, and a floating button opens it as a panel over the page, folded, which
closes again by a tap beside it, Escape or a link. Its own buttons fold or unfold it all. The device
remembers what you opened. The runtime needs no server, and the page's policy allows none but the
website's own inbox, when it has one (see below). `check` names a query the website cannot show (`query-unsupported`): it reads
`and`, `or`, `not`, `task`, `[[page]]`, `"text"` and `(page "name")`. Where the folder goes from there
is yours, or the engine publishes it under your own login, as the next section shows.

### Publish it under your own login

One command puts the website on Vercel, where only your Vercel login opens it, and prints a code
to open it on a phone:

```sh
npx --no-install excudo site setup
```

It installs what is missing (the exporter, the Vercel CLI) and writes the website. Then it opens
Vercel's device login in your browser and waits until you allow it there. It creates and links a
project (the folder's name plus `-memo`, or `--project <name>`), sets Vercel Authentication to guard
every deployment, the production address too, and publishes. Last, it opens the address, copies it
and prints the code. A free Vercel account serves it; Vercel's Hobby plan is for personal use. Run
it again and it passes over what is done.

Afterwards `excudo site publish` writes the website and publishes it when something changed. It
publishes nothing while the protection covers less than every deployment, and exits 75 when you
have something to do first, so a schedule can call it and try again later. `excudo site open`
opens the address again with its code; `excudo site status` shows the login, the project, the
protection and the last publishing. The CLI keeps its own login: the engine enters and stores no
credential, and keeps git from sending your last commit's message and author with a deployment.

Host queries stop after 60 seconds; deployments and setup's package installs stop after 10 minutes.
`EXCUDO_HOST_TIMEOUT` changes the query limit and `EXCUDO_DEPLOY_TIMEOUT` changes the deployment limit, both in seconds.
A network or proxy failure makes publishing and inbox reads or closes exit 75; the next run tries again.
It does not ask you to log in again for a connection failure.

An unchanged website makes no host calls when protection was confirmed within the last 24 hours.
After that, or with `--force`, publishing checks protection and the inbox token again before deploying.
Use `--force` after changing the token on Vercel to deploy it immediately.

`site status` prints the saved address, last publishing and inbox token time before its live queries.
Each status query stops after 10 seconds and reports an unreachable host; JSON includes `reachable: false`.
The website's own GitHub requests stop after 8 seconds, and its pages retry failed inbox reads later.

```js
site: {
  publish: {
    project: "my-memo",          // the Vercel project; the folder's name plus -memo unless set
    dir: ".excudo/publish",      // what Vercel receives: the website and its settings, nothing else
    open: ["node", "tab.mjs"],   // opens a link given last, with EXCUDO_LINK=login|site|dashboard; the browser by default
    close: ["node", "tab.mjs", "close"], // closes the login page by the first line open printed
    copy: true,                  // copy the address when opening it
  },
},
```

### Change a task's state on the website

With an inbox, a task's state on a page is a button: tap it to choose TODO, DOING, WAITING, DONE or
CANCELED (for work you decided not to do), or tick its checkbox for DONE. The choice shows at once and waits on the device, marked, until the
memo has it. Within half a second it goes to the website's own function (`api/edit`, which `site
publish` puts beside the pages), which keeps each batch as one issue in a private GitHub repository
of yours. The issue holds each line's address and the states, not the task's words (a save of
Home's board, below, is the one thing whose words it holds).

The pages also ask the function what the memo has not taken yet, when they open, when they come back
into view and every half minute while something waits. So a state chosen on the phone shows on the
computer too, and a change the memo took shows with a check until the next website shows it as
written. While changes wait, the status line offers Bring in now: it leaves a request issue
(`api/sync`), and a machine that looks for it often takes the changes at once instead of at its
usual interval.

Turn it on with one line and run setup again; it picks up where it stopped:

```js
site: {
  inbox: true,   // or { github: { repo: "me/memo-inbox" } } to name the repository, and schedule: false
                 // when a schedule of your own runs site pull
},
```

```sh
npx --no-install excudo site setup
```

Setup logs in to GitHub with its CLI (`gh`; Homebrew installs it on macOS), opening the login page
with the code copied, and makes a private repository for the inbox (`<account>/<project>-inbox`).
Then two pages open.

GitHub's page comes filled in: pick that repository under Repository access,
generate the token and copy it. On Vercel's, add `EXCUDO_INBOX_TOKEN` with the token as its value
for Production and save. Setup waits until the variable shows (it reads its name, never its value),
publishes, and on macOS schedules `site pull` every minute; elsewhere it prints the command for your
scheduler. A token you change later is noticed by the next publishing, which deploys again.

`excudo site pull` brings the changes in. It reads the inbox's open issues, takes them every five
minutes, or at once when a page asked or with `--now`, and commits your own edits of those pages
first. It commits the pages it wrote, then closes the issues (as completed, or as not planned when a
change was noted to settle) and publishes the website again. Only your computer writes the memo and
nothing writes the repository's files, so two changes never meet in a merge.

It takes only the issues of its own website, so two memos may share one inbox. Without git it waits,
since only a commit lets the issues be closed. A publish that has to wait (a login, the protection)
is kept and tried again every five minutes, or at once when asked.

A change is applied only when its line still holds the task the page showed, in the state the page
showed. A task that moved is found by its words when they are on one line of its page. Anything else
is not guessed: a waiting task on today's journal names the line and the state chosen. Each change is
recorded by its id (`.excudo/received.json`), so a batch read twice changes nothing twice. The next
website tells its pages which changes the memo has, and they stop waiting. Vercel Authentication
guards the functions as it guards the pages, and they take requests only from the website's own pages.

For a schedule of your own, `excudo receive --input <file|->` is the step below `site pull`: it takes a
batch, a list of batches, or issues as `gh issue list --json number,body` prints them. A dry run
(`--dry-run --json`) lists under `writes` the pages it would write, and each result names under
`file` the file its change wrote, also when it was received before.

### A dashboard on Home

`dashboard` puts a dashboard at the top of the website's Home, above your own Home. List the sections
you want, in the order you want them; each is a fold, open unless `open: false`, whose title line
carries its numbers, and the device remembers how you leave it. Without the setting Home is as it was.

```js
site: {
  dashboard: {
    sections: [
      { type: "links", title: "Work", items: [{ title: "Tracker", url: "https://…", icon: "T" }] },
      { type: "notes", page: "Board" }, // a board to edit in place: that node's body; needs the inbox
      { type: "tasks", except: ["Paused"] }, // open tasks by state, past deadlines, the top nodes
                                     // (nodes: 8); except leaves out those nodes and the ones below
      { type: "done", weeks: 8 },      // tasks finished week by week
      { type: "agents", days: 14 },    // the agents' sessions by day, their cost, the queue
      { type: "runs", days: 7 },       // each scheduled step's last result, failures first
    ],
  },
},
```

A `group` puts several sections in one fold, each under its own title inside it: `{ type: "group",
title: "Links", sections: [{ type: "links", title: "Work", items: […] }, …] }`. Its parts fold with
it, so they take no `open`; the notepad and another group stay outside. The group's title line adds up
the links of a group of links, and otherwise shows each part's first number.

Links open in a new tab and carry nothing about the page; an `icon` is one or two characters (the
first letter of the title otherwise), since the page fetches no picture from another site. The
numbers are worked out when the website is written, and the dashboard says as of when. A finished
task counts in the week of the commit that turned its open line into `DONE`; a finished task moved to
another page does not count again, and each commit's count is kept in `.excudo/dashboard-done.json`.

The notepad is a board: the body of the node `page` names (below its title and summary, above the
generated subpages), shown to read and edit in place, one item per line; Tab and Shift+Tab move a line
in or out. Save sends the whole body the way a task's state goes, through the website's inbox, with
the digest of the body it was edited from, so its issue holds your words; blank lines go and a line
that is not a list item becomes one. Until the memo has it, every device shows the saved board, marked
as waiting. An edit not saved stays on the device, and Undo edits puts back the saved board.

`site pull` puts a save in the node's body as it is when the node still holds the body it was edited
from. Otherwise it merges line by line with what changed meanwhile, in Tine or from another device:
each side's changes to different lines are kept, and lines both added at one place stay. Lines both
sides changed differently keep the node's version, and the website's lines go to the end of the board
under an item marked as an overlapping edit, for you to settle in Tine or on the board. When the body
a save started from cannot be found (in the node's last commits or the saves before it), a save that
only adds lines is taken, and any other goes whole under that item, since what it removed is unknown.
