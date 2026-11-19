# Changelog

## 0.8.0

### CLI

- Print the installed version with --version and -v

### Docs

- Add Japanese and Simplified Chinese install guides and check all four READMEs
- Limit the agent install to rule 4 and the report, ask on open steps and name README.ko.md in Korean
- Finish the agent install with git init, a report-based success rule and a README range check
- Add install-with-a-coding-agent section, an engine-only note in AGENTS.md and an add-ons pointer

### Release

- Raise the install ranges to 0.8.0
- Add a pre-publish install test that installs the packed tarball for en and ko
- Let the READMEs keep the last stable range while the version is a prerelease
- Keep every version's owner actions in package metadata and use them in update
- Group commits marked Area!: as owner actions in notes and update output

### Setup

- Check each version's owner action items inside its own relay section and require the unconfirmed warning
- Compare prerelease identifiers numerically and require every item of a newer version before the older one in the relay check
- Validate the applied JSON first, relay the unconfirmed owner actions warning and check note and version order of the relay
- Check the apply JSON and verbatim owner actions; warn about unlisted owner actions only without metadata
- Relay an update's owner actions first and again after apply, and check it

### Start

- Require the interests node for the learning step and keep wrong settings from stopping the report
- Mark the learning step done only when logs are read and interests is set
- Add a step for learning from requests, where conversations and skill learning are explained

### Test

- Use a far-future registry version in the CLI update tests so a release bump does not break them

### Update

- Warn that owner actions are unconfirmed when the registry metadata lists none and no skipped-version note applies
- Report engineChanged on a half-applied update and require the post-apply relay for it; tidy install rules and the learning probe

## 0.7.0

### Changelog

- Generate grouped release notes from commit subjects

### CI

- Test supported Node versions and guide public contributions

### CLI

- exercise command dispatch in isolated offline workspaces

### Dashboard

- a group puts several sections in one fold, and the list's fold-all buttons are icons

### Dependencies

- Take cudoc 1.1.0 from the registry

### Docs

- Lead with a five-minute start for new owners

### Feedback

- Redact drive and deep absolute paths in titles and keep versions, times and npm links
- Keep engine file names and sentences in titles and messages
- Allowlist diagnostics and survive broken configuration
- Prepare sanitized issue drafts and local diagnostics

### Git

- name an existing index lock and leave it in place

### Host

- retain the command pid to verify timed-out process groups
- bound queries and deployments and terminate their child groups

### Inbox

- bound website GitHub requests and retry failures after a deadline

### Instructions

- Preserve concurrent edits before move writes
- Roll back only completed move writes
- Preserve moved blocks and refresh verified trim cache
- Preserve moved hunks and handle report edges
- Maintain headroom and move procedures safely
- Report size budgets and skill candidates

### Mirror

- Strip configured item markers from export regions
- choose Korean particles from each place name
- ignore recent writes that still match the last run
- keep each note's text ready to paste, and know a pasted one
- find rows by their full place, and keep counts and history when edits meet
- keep repeated items, move rows with their topic, and retry commits of what was written
- take each edit once and keep what pages hold

### Other

- Recognize skill lint helper execution through symbolic links
- Run skill lint cases concurrently with serial retries
- Fix agent settings edits and clarify role status
- Add configurable worker and independent reviewer roles
- Site status: print saved facts before bounded live host queries
- Add a workspace rule that browser work keeps the owner's focus
- Add mirrors: keep one list the same in several places
- Commit settled edits as the check read them, and not while the memo is paused
- Treat edits made during the check as in progress, and let a folder's error hold its page
- Sort and commit settled edits under the graph lock, and report unsettled ones
- Let idle tell settled edits from edits in progress, and snapshot commit only named files
- Hold the journal for a website change, and let site pull leave held pages uncommitted
- Hold pages against archive and website changes too, and a skill by any file in it
- Leave a held page alone when writing the memo, not only when committing
- Let a scheduled run hold the files someone else is changing instead of waiting
- Name the finished lines nested under a moved item too
- Name the items archive moved, so a caller acts on exactly those
- Keep archive from overwriting a page edited while it runs, and move a CANCELED item under a finished one
- Let archive move only the items marked CANCELED
- Make the dashboard's notepad a board to edit in place
- Add a dashboard to the top of the website's Home
- Let a task be marked CANCELED from the website
- Let an export section write a task once, leaving out what the file already shows above it
- Show a turning chevron on every fold of the website
- Hold the graph lock through site pull, take only this website's issues, and try a waiting publish again
- Set up the website's inbox in one command, bring its changes in with site pull, and keep a new owner's first steps true
- Keep asking until every change reached the inbox, and after a failed first question
- Ask for website changes to be taken only once they reached the inbox, and keep asking after a failure
- Show waiting website changes on every device and let a page ask for them to be taken now
- Keep website changes in order and across pages, and let a failed commit be retried
- List the files receive writes, in a dry run too
- Let the website change a task's state and bring the changes into the memo
- Name the fallback list button Menu, as cudoc-export 1.1 names its own
- Draw the fallback list button as a round icon at the bottom left
- Keep recorded mistakes when a skill is linted by path, and tie each correction to its own case
- Keep each mistake the owner points out as a failing case of the skill's check
- Judge a local build by the files its package names and the configs it extends, and a guard by the hook git runs
- Run the release scripts as commands through a linked node_modules path too
- Refuse to export a lock file that still links a folder on this machine
- Build a local cudoc clone before the tests, and publish the repository with its own agent instructions
- Refuse any dependency not from the registry when packing, not only file: specs
- Take cudoc and cudoc-export from the sibling cudoc clone until 1.1.0 is published
- Give the list's buttons the panel's background on a narrow screen
- Let cudoc-export 1.1 draw the narrow-screen list panel and add only what needs a script
- Write a page's sections folded, drop the page fold buttons, and open the narrow-screen list from a floating button
- Give the website's list of documents its own fold buttons, fold it on a narrow screen, and let wide screens hand scrolling on
- Let a long word in the phone sidebar wrap, as cudoc-export 1.1 does
- Send only the website to the host, refuse the cache as the publishing folder, and stop stray site options
- Publish the website under the owner's own login in one command, and let a phone scroll past the sidebar
- Know a page by its route from the site's root, and keep a query's own macro out of its results
- Read a query macro to its closing braces when it carries an option map
- Write the memo as a website with cudoc-export: the site command, a query evaluator and a page runtime
- Keep the new README passages in short paragraphs of their own
- Show the denylist result once in release:check
- Name every source file in the layout and skills status in the skills skill
- Keep a workspace's own skills in the workspace under install: global
- Present the two-area Home as a default, not a rule
- Give each source kind one skill and read sources in a browser one way
- Compare each template rule in a workspace's AGENTS.md word for word
- Link the engine's global skills for every agent, as learned skills are
- Call the owner 사용자 in every Korean check message
- Let the saved checks look only at the pages a run saved
- Fail the cleanup and sources checks when a task is closed without the owner's word
- Keep private words out of the repository with a local denylist
- Let an owner set or turn off the task count limits
- Let an export section keep the owner's order and write a task's deadline
- Let a heading block with items indented under it pass as an outline
- Let no mention free a link that looks like an uncollected item
- Read Korean keep answers in the raw memo check as keeping a line
- Keep a task open when it links an item no source has collected
- Let a kept part keep blank lines inside its comment lines
- Sort a pasted raw memo against the memo and ask before placing it
- State that the engine keeps only general skills
- Shorten the comment lines around a kept part to its name
- Let an owner settle tasks whose outside items are all finished
- Let an export keep a part the owner writes and include a file another tool writes
- Rename the engine to Excudo
- Keep only the owner's words from a Codex voice session's handover
- Keep a moved workspace's export files and request cursors its own
- Rename the engine to Electricity Is Not Free
- Find the sessions to resume by node or folder, resumed where the folder is now
- Split Home into thinking and work, and let an owner's Home embed part of the tree
- Keep scheduled runs from losing records, leaking them or mixing in the owner's edits
- Pin development to the current Node LTS, 24
- Name a check's skill only by a skill's name, and keep the status view short
- Hand work to agents through a queue, and show how the work stands
- Keep requests, activity and runs in one SQLite file in the cache
- Show only what an activity day had, and count a skill's check by its last result
- Record what the owner did, and let scheduled runs wait for the owner
- Keep tasks the followed note still backs when its other lines go
- Hold a note line of links alone by a memo line with the same links
- Follow a note the owner keeps in another app, between marker lines
- Write Home's sections as queries that carry their own title and fold
- Keep files in the owner's format written from the memo, with an export skill
- Let a skill run another skill's script without lint counting it as missing
- Let agents rework an owner's Home when the owner asks
- Keep Korean messages right whatever a skill or file is called
- Place learned skills where their work is done, and flag one kept in the workspace for work elsewhere
- Count a task that was only tagged since as the same task in the cleanup check
- Find a shared folder's parent when node files are spelled NFD
- Let several nodes share a work folder, name app workspaces after the memo, and rename nodes
- Let agents put a skill in every folder on their judgment, and lead the README with what it does
- Report an adopted skill once, not also as a draft
- Keep each learned skill where it was adopted, and run sources on a schedule
- Make every skill carry a check, and learn skills from recurring requests
- Place outside items in the owner's nodes and keep kept summaries stable
- Keep pasted text apart from requests and repair outliner-mangled sections
- Rename the engine to mindplanter and add outside sources, knowledge and reflection
- Rename memo engine and add cudoc trees and cleanup interviews
- Remove temporary test workspaces when a test file finishes
- Compare page names in NFC so files renamed to NFD by sync tools still build
- Add cudoc-memo: infinite-tree memos for Tine and Logseq built on cudoc embeds

### Publish

- skip host queries for unchanged sites with recent protection

### Release

- Regenerate 0.7.0 notes through the latest change
- Keep recent notes in the package, name skipped versions and check the newest commit is listed
- Refresh 0.7.0 notes and verify npm update commands
- Prepare version 0.7.0
- report checks as they finish and stop children on interruption

### Runs

- filter steps and statuses while keeping JSON details intact

### Save

- accept workspace paths and reject unknown selections

### Setup

- Tell the owner how to replace a kept skill copy
- Validate maintenance reports and isolate platform actions

### Site

- defer network failures without asking owners to log in again

### Skills

- Report unverified older copies, add explicit replace and reuse identical backups
- Preserve and back up edited engine installations
- Recognize global installations in linked worktrees
- keep owner-selected skills installed when checks fail
- hold checks interrupted by infrastructure failures
- a time-out never holds a skill below minScore, and a case with an empty name goes by its number
- hold a skill whose check only ran out of time on a known case instead of demoting it

### Start

- Report read-only onboarding progress and continuation steps

### Tests

- Assemble fake secret fixtures at run time
- Give the full skills lint more time under load
- pin the start command locale despite inherited overrides

### Update

- Name the failed apply command and refresh skills on a current install
- Publish release notes and distinguish registry failures
- Check release channels and apply explicit workspace upgrades
