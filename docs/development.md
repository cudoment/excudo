# Development

[README](../README.md) | English | [한국어](development.ko.md)

## Develop

Test files run in parallel (about 75 seconds on 14 cores); every test uses its own temporary folders and stand-ins for GitHub, Vercel and npm, so none needs the network.

```sh
npm install
npm run example
npm test
npm pack --dry-run
npm run release:check
```

ESM JavaScript, no build step, node:test. Change a README or a docs page together with its pair in the other language, and add each message in both locales; a test
checks that both locales have the same messages. CI runs tests with Node 22 and 24 on Linux, macOS and Windows.
It also installs a packed tarball. Tests using macOS apps or POSIX fixtures skip elsewhere.

Library functions that read git history (`check`, `review`, `keepCandidates`, `move`, `archive`) return
promises; blame runs for several files at once.
The engine uses the registry package `@cudoment/cudoc@^1.1.0`.

The tests cover the committed example, depth 6, generated protection/collapse, NFD names, commands,
dated git reviews, code-example preservation, cache loss, moved protection baselines, grouped keeps,
the CLI interview through answer application, save and batch revert, archives, installation,
environment lookup, unreadable history, history caches, ages across moves and archive guards. Tine doctor and model-free Codex
skill discovery run when installed, otherwise skip with their prerequisites. Manual Claude Code
and Codex interview scenarios use a copy of `test/fixtures/messy/`, never personal notes.

When changing the engine version, update the setup skill's version range too; tests enforce this.
Before publishing, `npm run release:check` (which `npm publish` runs first) checks that the clone is
committed on `main`, the version is not tagged yet, the setup skill installs it, the tests pass, the
example is current, every skill scores 100 and the package holds what it should. A workspace that
uses a local clone (`file:`) keeps running the clone; to move it to a release, run
`npm install excudo@^<version>` there and its checks. Linked skills point through
`node_modules`, so they follow either way.
`src/dialects/logseq.mjs` contains outliner syntax; `skills/` is the sole skill source and the two
agent folders only link to it. Keep personal notes outside this clone or in ignored `private/`.
The package includes skills, templates and dummy example notes, and excludes caches.

List words that must never be published (your own names, hosts, issue keys) one per line in
`private/denylist.txt`. When a file git tracks or would add holds one in its text or path,
`node scripts/denylist.mjs`, a test and `release:check` fail. Without the list they compare nothing
and pass.

MIT
