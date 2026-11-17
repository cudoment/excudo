import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { changes, markChanges, noteDiff, noteRegion, privateLine, sourceScript, sourcesOf } from "../src/index.mjs"
import { workspace } from "./helpers.mjs"
import { coverage, holds, memoLines, stillOpen } from "../skills/excudo-follow/scripts/lib/match.mjs"
import { keepsAsIs } from "../skills/excudo-distill/scripts/lib/raw-match.mjs"

const nodes = { "projects/Site.md": "# Site\nRebuild the site.\n", "projects/Music.md": "# Music\nSongs in progress.\n" }
// The note as an app holds it: notes outside the markers, and private lines inside them too.
const note = (body) => ["Shopping: eggs", "Door code 0000", "---", ...body, "---", "Wi-Fi passcode for the cabin", "Login: someone@example.com"].join("\n")
const first = note(["Site", "ㄴ move the blog first", "ㄴ password Hunter-22 for the CMS", "", "", "Music", "ㄴ test the stems", "4400 1234 5678 9012"])
const source = (extra = {}) => ({ name: "thoughts", kind: "note", url: "https://notes.example.com/n/1", node: "Site",
  script: "async () => document.body.innerText", ...extra })

test("only the part between the markers is followed, in blocks, without lines that look private", () => {
  const region = noteRegion(first)
  assert.equal(region.markers, 2)
  assert.deepEqual(region.blocks, [
    { heading: "Site", lines: ["ㄴ move the blog first"] },
    { heading: "Music", lines: ["ㄴ test the stems"] },
  ])
  assert.equal(region.skipped, 2)
  // No markers, or one without a partner: nothing is followed.
  assert.deepEqual(noteRegion("Site\nㄴ move the blog first"), { markers: 0, blocks: [], skipped: 0 })
  assert.equal(noteRegion("---\nSite\nㄴ open").blocks.length, 0)
  // Every pair adds a part; a marker of the owner's choice works the same way.
  assert.deepEqual(noteRegion("== \nA\n==\nskip me\n==\nB\n==", "==").blocks.map((block) => block.heading), ["A", "B"])
  // What the page returned is filtered again here.
  assert.deepEqual(noteRegion({ markers: 2, blocks: [{ heading: "Bank", lines: ["IBAN DE89 3704 0044 0532 0130 00", "ㄴ compare fees"] }] }).blocks,
    [{ heading: "Bank", lines: ["ㄴ compare fees"] }])
})

test("private lines: credentials, numbers and keys go; dates, versions, issue keys and links stay", () => {
  for (const line of ["pw: summer", "PIN 2468", "비밀번호 바꾸기", "someone@example.com", "010-0000-0000", "1234 5678 9012", "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
    "1357", "token " + "sk_" + "live_0123456789abcdefghijklmnopqrstuv", "https://x.example.com/?token=abc", "새암호7!x",
    "ab12c-de34f-gh56i-jk78l", "api key 5a43d403-ac9b-4ce3-8f7b-e45e2765af2f", "ghp_0123456789abcdefABCDEF0123456789abcd", "pass Wint3r!!"])
    assert.ok(privateLine(line), line)
  for (const line of ["2026-10-16 meeting", "ship 1.0.0", "SITE-18713 fix links", "upgrade react@18.3.1", "https://mqlang.org/", "v0.8.0-beta.2 notes", "암호화 방식 정리", "3 drafts",
    // What a work memo holds: markup, commits, package and file names, block ids, remotes and time stamps.
    "- 확정: 링크 검사를 **더했습니다**(`302e235d`, `SITE-18717`).", "prettier-plugin-markdown-compact-tables", "react-simple-code-editor",
    "id:: 5a43d403-ac9b-4ce3-8f7b-e45e2765af2f", "remote `git@git.example.com:team/site-docs.git`", "drafts/20260915-014900-ai-reads-documents.md", "logs/20260914-164039-feet-know-first",
    "PR #22148의 리뷰", "부하를 0.48%까지 내렸습니다", "`@scope/site-component-v2`가 3.7.0으로", "`conf/2018-2025/*/`도", "`#shipping-address-v1-*`로", "`<div style=\"line-height:0.7;\">&nbsp;</div>`로"])
    assert.ok(!privateLine(line), line)
})

test("the function that runs in the page is self-contained and the page script hands over only the followed part", async () => {
  const rebuilt = new Function(`return (${noteRegion})`)()
  assert.deepEqual(rebuilt(first), noteRegion(first))
  const ws = await workspace(nodes, { sources: [source({ script: `async () => ${JSON.stringify(first)}` })] })
  const expression = sourceScript(ws, "thoughts")
  const returned = JSON.parse(await new Function(`return ${expression}`)())
  assert.deepEqual(returned.blocks.map((block) => block.heading), ["Site", "Music"])
  for (const leaked of ["Shopping", "Door code", "Hunter-22", "4400", "someone@example.com", "passcode"]) assert.ok(!JSON.stringify(returned).includes(leaked), leaked)
})

test("a note source is checked: its marker is one line and removed lines are asked about or settled", async () => {
  const ws = await workspace(nodes, { sources: [source(), source({ name: "plain", between: "###", removed: "settle" })] })
  const [thoughts, plain] = sourcesOf(ws)
  assert.deepEqual([thoughts.between, thoughts.removed, plain.between, plain.removed], ["---", "ask", "###", "settle"])
  for (const bad of [{ between: "" }, { between: "a\nb" }, { removed: "delete" }]) {
    const broken = await workspace(nodes, { sources: [source(bad)] })
    assert.throws(() => sourcesOf(broken), /sources\[0\]/)
  }
})

test("changes compares a note block by block with what it kept when the note was last marked", async () => {
  const ws = await workspace(nodes, { sources: [source()] })
  const read = (text) => JSON.stringify(noteRegion(text))
  assert.equal(changes(ws)[0].status, "browser")
  const fresh = changes(ws, { name: "thoughts", input: read(first) })[0]
  assert.equal(fresh.status, "new")
  assert.deepEqual(fresh.detail.added.map((block) => block.heading), ["Site", "Music"])
  assert.equal(fresh.detail.skipped, 2)
  markChanges(ws, ["thoughts"], { input: read(first), expect: fresh.token })
  // The record in git holds no text of the note; the blocks stay in the cache outside git.
  const state = readFileSync(join(ws.root, "sources.json"), "utf8")
  assert.ok(!state.includes("move the blog"))
  assert.ok(JSON.parse(readFileSync(join(ws.cacheDir, "watch", "thoughts.json"), "utf8")).blocks.length === 2)
  assert.equal(changes(ws, { name: "thoughts", input: read(first) })[0].status, "same")

  const second = note(["Site", "ㄴ move the blog first", "ㄴ then the shop", "", "Reading", "ㄴ finish the novel"])
  const moved = changes(ws, { name: "thoughts", input: read(second) })[0]
  assert.equal(moved.status, "changed")
  assert.deepEqual(moved.detail.added, [{ heading: "Reading", lines: ["ㄴ finish the novel"] }])
  assert.deepEqual(moved.detail.removed, [{ heading: "Music", lines: ["ㄴ test the stems"] }])
  assert.deepEqual(moved.detail.changed, [{ heading: "Site", added: ["ㄴ then the shop"], removed: [] }])
  assert.equal(moved.detail.baseline, true)

  // Lost markers are no change and cannot be marked: the thoughts were not all removed.
  const lost = changes(ws, { name: "thoughts", input: read("Site\nㄴ move the blog first") })[0]
  assert.equal(lost.status, "unmarked")
  assert.throws(() => markChanges(ws, ["thoughts"], { input: read("Site") }), /---/)

  // Without the kept blocks (a cleared cache) every block is new to the memo again.
  rmSync(join(ws.cacheDir, "watch"), { recursive: true })
  const cleared = changes(ws, { name: "thoughts", input: read(second) })[0]
  assert.equal(cleared.detail.baseline, false)
  assert.equal(cleared.detail.added.length, 2)
  assert.ok(!existsSync(join(ws.cacheDir, "watch", "thoughts.json")))
})

test("a heading respelled keeps its block, a repeated heading is a block of its own, a new heading is new", () => {
  const diff = noteDiff([{ heading: "Video", lines: ["a"] }, { heading: "Video", lines: ["b"] }, { heading: "Old", lines: [] }],
    [{ heading: "ㅡ video", lines: ["a"] }, { heading: "Video", lines: ["c"] }, { heading: "New", lines: [] }])
  assert.deepEqual(diff, { added: [{ heading: "New", lines: [] }], removed: [{ heading: "Old", lines: [] }], changed: [
    { heading: "ㅡ video", was: "Video", added: [], removed: [] },
    { heading: "Video", added: ["c"], removed: ["b"] },
  ] })
})

test("the follow skill finds a thought in the memo through rewording, links and task markers", () => {
  const memo = memoLines([{ file: "notes/projects/Site.md", text: "# Site\nRebuild the site.\n\n- TODO 블로그를 먼저 옮기기 #중기\n- 참고: [중고차 목록](https://cars.example.com/list?page=2)\n\n## Subpages\n- 사이트 옮기기 계획\n" }], { region: "Subpages", generated: "generated" })
  assert.deepEqual(memo.map((place) => place.line), [1, 2, 4, 5])
  assert.ok(coverage("ㄴ 블로그 먼저 옮기기", memo[2].text) >= 0.6)
  assert.equal(coverage("https://cars.example.com/list?page=2", memo[3].text), 1)
  assert.equal(coverage("https://cars.example.com/other", memo[3].text), 0)
  assert.ok(holds({ heading: "Site", lines: ["ㄴ 블로그 먼저 옮기기", "ㄴ 상점은 나중에"] }, memo))
  assert.ok(!holds({ heading: "Site", lines: ["ㄴ 상점은 나중에", "ㄴ 결제 붙이기"] }, memo))
  // Only the generated part repeats a node's lines; it does not count as holding them.
  assert.ok(!holds({ heading: "계획", lines: ["사이트 옮기기 계획"] }, memo))
  assert.deepEqual(stillOpen("블로그를 먼저 옮기기", memo).map((place) => place.line), [4])
  // A task the note still backs stays, however much of a removed heading it holds.
  assert.deepEqual(stillOpen("블로그", memo, ["블로그를 먼저 옮기기"]), [])
  assert.deepEqual(stillOpen("블로그", memo, ["블로그"]).map((place) => place.line), [4])
})

test("a raw memo answer keeps a line as it is in English and Korean, and other answers change it", () => {
  for (const answer of ["keep", "Skip", "남김", "건너뜀", "그대로", "그대로 둠", "남김.", " keep "]) assert.equal(keepsAsIs(answer), true, answer)
  for (const answer of ["add Site", "move Music", "shelve", "done", "merge", "남김없이 옮김", "keeper", "", undefined]) assert.equal(keepsAsIs(answer), false, String(answer))
})
