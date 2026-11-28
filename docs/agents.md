# Agents and instructions

[README](../README.md) | English | [한국어](agents.ko.md)

## Choose a worker and independent reviewers

Set one agent to implement improvements and a list of agents to review the result read-only.
The engine reports preferences and launch arguments; it does not run agents.
Only run `agents set`, `agents accept` or `agents decline` after the owner requests or approves the change.

```js
agents: {
  worker: { tool: "codex", model: "gpt-6.1-sol", effort: "high" },
  reviewers: [
    { tool: "codex", model: "gpt-6.1-sol", effort: "xhigh" },
    { tool: "claude", model: "claude-opus-5-5", effort: "xhigh" },
  ],
  suggest: true,
},
```

`agents` is optional in `excudo.config.mjs`; without it, roles are unset.
`agents --json` reports each value, its source, recommendations and pending suggestions.
An empty or omitted model or effort follows the tool's default.
Codex defaults come from the root `model` and `model_reasoning_effort` in `~/.codex/config.toml`.
Claude defaults remain delegated to its CLI.

Discovery uses no network or API keys.
Codex models come from `~/.codex/models_cache.json` (or the configured `CODEX_HOME`).
Only `visibility: "list"` entries count, ordered by ascending `priority`.
A missing cache means no local list, without an error.

Claude uses the ordered `CLAUDE_MODELS` list in `src/agents.mjs`.
It currently lists Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5.
Their IDs are `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.
Their effort levels are `low`, `medium`, `high`, `xhigh` and `max`.
Update that constant, its tests and both READMEs when the catalog changes.

The first provider entry is the estimated top model; rank is an inference from list order.
Recommendations use the second entry, with `high` for the worker and `xhigh` for a reviewer.
They include a reviewer from the other provider.
If no second entry or supported effort exists, that recommendation stays unset.
An explicit top choice is kept and labeled as the owner's choice, without a warning.

```sh
npx --no-install excudo agents
npx --no-install excudo agents set worker --tool codex --model gpt-6.1-sol --effort high
npx --no-install excudo agents set reviewer --index 0 --tool claude --model claude-opus-5-5 --effort xhigh
npx --no-install excudo agents args worker --for orca
npx --no-install excudo agents args reviewer --index 0 --for cli
npx --no-install excudo agents suggest --new --json
npx --no-install excudo agents accept <id>
npx --no-install excudo agents decline <id>
```

Reviewer numbers on screen start at one; the `--index` argument starts at zero.
`set` can append the next reviewer.
Pass `--model "" --effort ""` to retain tool defaults.

`args --for orca` prints flags for `orca orchestration worker-start`.
`args --for cli` prints flags for the selected tool, without its command name.
Empty values omit their flags.

Suggestions cover newly seen higher entries, Codex's `upgrade` field and missing configured models.
The first observed list is the baseline for detecting newly seen entries.
A top replacement is offered only to a role observed with an explicit top choice.
`args` warns on stderr about pending suggestions and prints the approval command; it still exits zero.
The caller asks the owner before using a suggested model.

`agents suggest --new` marks each emitted suggestion as notified once.
Notification, decisions and the first catalog fingerprint stay in `.excudo/agents.json`.
A declined proposal stays dismissed; `suggest: false` suppresses suggestions.

Settings edits use a managed region at the front of the default exported object.
The file must have exactly one line starting with `export default {`.
Imports, functions, regular expressions, templates and spreads elsewhere stay byte for byte unchanged.
An existing literal `agents` property moves into the region on its first edit.
A nonliteral property or ambiguous export requires a manual edit.

```js
export default {
  // excudo:agents start
  agents: { worker: { tool: "claude", model: "claude-opus-5-5", effort: "high" } },
  // excudo:agents end
  // Other settings stay here.
}
```

Later edits replace only the text between these markers, including the markers.
After each edit, a fresh Node process imports the actual configuration and checks `agents`.
An import failure or differing value restores the original file and reports the required manual value.
A concurrent edit by the owner is preserved.

## Keep session instructions small

`excudo instructions` reports procedures that can move from `AGENTS.md` into workspace skills.
Reports only read files, including when the budget is exceeded.
The default limit is 32,768 bytes including line endings; the target defaults to 85 percent of that limit.
Set `instructions: { limit: 65536, target: 49152, auto: false, keep: ["Always", "Project > Safety"] }` to choose both thresholds.
`target` must be a nonnegative integer below `limit`; `null` uses the default.

`excudo check` emits an `instructions-size` warning over the limit and an `instructions-target` note above the target within the limit.
Both allow scheduled saves to finish.
Use `instructions --check` in workspace verification to exit 1 over the limit and 0 otherwise.
It prints one line above the target, or nothing at or below it.

```sh
npx --no-install excudo instructions --json
npx --no-install excudo instructions --check
npx --no-install excudo instructions --limit 65536
```

`instructions: false` or `{ limit: false }` disables the budget and candidates.
`--limit <bytes>` overrides it for one report, including a disabled budget.
It keeps the configured target when below the override; otherwise the target becomes 85 percent of the override.
A missing file reports zero bytes and no candidates.

Pin a heading and its children with `instructions.keep`, using plain heading text or a path joined with ` > `.
Place `<!-- excudo: keep -->` immediately before a heading or a top-level list item to pin its exact text.
An item includes its nested lines; unpinned siblings can remain candidates.
Engine template rules always stay word for word.

`pinned` counts protected sections, items and template rules once, including overlaps.
`movable` is the rest of the file; it may include text that does not qualify as a candidate.
`pinnedBlocks` names the protected blocks with their line ranges and byte counts.
When `pinned` reaches or exceeds `target`, `targetBlocked` is true and a warning names the largest blocks.
The size warning and verification gate include that explanation; the gate still exits only on the limit.

Candidates are `##` or `###` sections or top-level list items of at least 512 bytes.
Headings and items inside fences or comments do not define blocks.
A candidate needs a named workspace skill or procedure evidence: commands, a code fence, numbered steps or three nested items.
Candidates are largest first without overlap; eligible whole sections take precedence over their items.

The most mentioned workspace skill is the suggested target, counting backticked names and skill paths.
Skills come from `skills.dir` and `.agents/skills/`; engine skills are excluded and ties use name order.
Without a named workspace skill, a new name comes from its heading, avoiding existing names.
A heading without Latin letters or digits uses `workspace-procedure-<line>`.
A named engine skill alone does not make a general rule into a workspace procedure.

Move a complete heading section or top-level list item without retyping its text:

```sh
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "Keep release evidence." --dry-run
npx --no-install excudo instructions move --lines 40-72 --to release-notes --reference release --pointer "Keep release evidence."
```

The target must already be a workspace skill, never an engine skill.
The command refuses pinned text, engine template rules and partial blocks.
Without `--since`, it also refuses untracked or changed `AGENTS.md`, target `SKILL.md` and existing reference files.
It appends the original bytes to `skills/<skill>/references/<name>.md`, creating a heading when needed.
It adds one reference link under a reusable references heading in `SKILL.md`.

It replaces the block with at most two `--pointer` lines.
It adds "Details in the `<skill>` skill" unless a details pointer is supplied.
It writes only those files and the instructions cache; `--dry-run` writes nothing and `--json` describes the result.
The command never creates a skill.

Use `--since <before>` to move several blocks before one commit, where `<before>` is the saved baseline commit.
It accepts uncommitted instructions and skills only when the baseline's template rules, pins and removed hunks remain preserved.
Refresh the report for each move's current line range.

Removed hunks split at baseline level-two/three heading sections and top-level list item boundaries.
Each piece must occur as contiguous lines within one file.
Its count across the corpus must be at least the baseline count.
Adjacent pieces can move to separate references.

Both corpora contain `AGENTS.md` and the skills' Markdown; blank-only pieces are ignored.
The check reads the baseline from git and compares HEAD, or the working tree with `--uncommitted`.

Run the skill check with `--trim-since <before> --uncommitted` before committing.
That permits pending instructions, skills, their record and links while still checking unrelated unsaved work.
Without `--uncommitted`, the check also requires the moves to be saved.

The `excudo-skills` skill trims on request and preserves rules every session needs in the pointer lines.
With `instructions.auto: true`, scheduled upkeep starts over `limit` and continues to `target`.
It uses the move command, largest first, only where an existing workspace skill's description covers the procedure.
A new workspace skill needs scripts already present, a check and known cases; otherwise the block remains in the report.

Preservation, `excudo check` and `skills lint` must pass before one commit saves instructions and skills together.
A failed check restores the run's changed files from the baseline and removes only files it created.
Without `auto`, scheduled upkeep only reports candidates.
If protected bytes make the target unreachable, automatic upkeep still moves material while over the limit.
Once within the limit, it reports the protected blocks and stops instead of pursuing an unreachable target.

JSON identifies the file with `file`, `exists` and `bytes`.
The budget has `enabled`, `limit`, `target` and `auto`.
It reports `aboveTarget` and `over`, plus the candidate `threshold`.

`candidates` identifies each block by `kind`, `headingPath` and inclusive `startLine`/`endLine`.
It adds `bytes` and `target`, plus `engineSkills` and `reason`.
Candidate text is never printed.

`lastTrim` holds its size and commit, or `null` before any trim; `growth` is the byte difference, or `null` without a baseline.
A successful move records this baseline in the ignored `.excudo/instructions.json` cache.

Committed preservation refreshes the cache when `AGENTS.md` and the skill files are saved.
Unrelated unsaved memo edits keep the failing exit code and do not block the refresh.
`--uncommitted`, `--facts` and `--self-test` never refresh the cache.
The text report also prints the growth when a baseline exists.
