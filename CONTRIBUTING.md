# Contributing

Use dummy notes to reproduce a problem and keep changes useful for any owner.
Read [AGENTS.md](AGENTS.md) for the engine layout and contributor rules.
Node.js 22.16 or later and Git are required; Orca, Tine and a website host are optional.

## Prepare a change

Install the locked dependencies, then run the tests before editing.

```sh
npm ci
npm test
```

Keep generated words in both English and Korean and update both READMEs together, and each page of `docs/` with its `.ko.md` pair; keep the short `README.ja.md` and `README.zh-CN.md` install guides in step with their install rules.
Register new commands and settings in `src/start.mjs`.
Keep skill procedures, their check scripts and their known cases in step.
Use `Area: Summary` for English commit subjects, such as `CLI: Explain offline updates`.
Write `Area!: Summary` when the owner must act after updating (a setting, a migration, a manual step), such as `Settings!: Rename the inbox setting`.
Set your Git identity for this repository with `git config user.name` and `git config user.email`.

## Verify a change

Regenerate the first steps and example, then check the complete result.

```sh
npm run start-docs
npm run example
node bin/excudo.mjs skills lint
npm test
npm run release:check -- --quick
```

Commit the verified changes before running the quick check.
It validates prerequisites on a contribution branch and exits zero when they pass.
It skips the full test, example and skill checks and never approves publication.
CI runs tests with Node 22 and 24 on Linux, macOS and Windows.
Tests requiring macOS apps or POSIX executable fixtures skip on unsupported systems.

## Describe a problem

Use the [bug form](https://github.com/cudoment/excudo/issues/new?template=bug.yml) or
[usability form](https://github.com/cudoment/excudo/issues/new?template=usability.yml).
Include a small reproduction and the output of `excudo feedback` after reviewing it.
`excudo start --report` shows local onboarding checks and the first incomplete step.
Never include personal notes, credentials or private source names.

## Prepare release notes

Generate the next section from commit subjects and review it before committing.

```sh
node scripts/changelog.mjs --since <previous-release-ref> --write <version>
```

The generator groups short capitalized areas and replaces an existing section of the same version.
Commits marked `Area!: Summary` appear first in each section under "Owner action", without the bang, and `excudo update` shows that group before the other notes.
It also stores the newest sections, and the owner actions of every version, in package metadata for registry-based update checks.
Keep the package version, lockfile and the install ranges (`excudo@^<version>`) in the setup skill and all four READMEs (`README.md`, `README.ko.md`, `README.ja.md`, `README.zh-CN.md`) aligned.
For a prerelease version only the setup skill names it; the four READMEs keep the last stable release, which is what `latest` serves.

Releases use semantic versions: publish betas with `npm publish --tag next` and stable versions with `npm publish --tag latest`.
To promote a published stable version tested on `next`, use `npm dist-tag add excudo@<version> latest`.
Verify tags with `npm view excudo dist-tags --json`.
Run `npm run test:install` before publishing; it installs the packed tarball in a temporary folder and needs the network.
Publication follows the full release checks on `main`; contributing a change does not publish it.
