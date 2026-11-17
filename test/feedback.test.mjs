import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, mkdirSync, symlinkSync, realpathSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { feedbackDraft, issueLink, privateValues, sanitizeDiagnostic } from "../src/feedback.mjs"
import { putSession, recordRun, withRecords } from "../src/records.mjs"
import { tempDir, workspace } from "./helpers.mjs"

test("feedback redacts home paths, account names, email and unapproved URL hosts", () => {
  const result = sanitizeDiagnostic([
    "/home/reader/notes", "reader", "reader@example.invalid", "홍길동@예시.한국", "reader@localhost", "https://private.example/a?token=x",
    "https://github.com/cudoment/excudo", "https://npmjs.com/package/excudo", "https://github.com.evil.invalid/a",
    "https://token:secret@github.com/cudoment/excudo?token=secret", "ssh://private.example/repo", "a-private-token",
  ].join("\n"), { home: "/home/reader", username: "reader", private: ["a-private-token"] })
  assert.doesNotMatch(result, /reader|홍길동|예시|localhost|example\.invalid|private\.example|evil\.invalid|a-private-token|token|secret/)
  assert.match(result, /https:\/\/github\.com\/cudoment\/excudo/)
  assert.match(result, /https:\/\/npmjs\.com\/package\/excudo/)
  const windows = sanitizeDiagnostic("C:\\Users\\reader\\notes C:/Users/reader/notes", { home: "C:\\Users\\reader", username: "reader" })
  assert.doesNotMatch(windows, /Users|reader/)
})

test("feedback takes private values from lists and marked configuration objects", () => {
  const config = { private: ["secret-one"], sources: [{ private: true, name: "secret-two", token: "secret-three" }], nested: { private: { token: "secret-four" } } }
  assert.deepEqual(privateValues(config).sort(), ["secret-four", "secret-one", "secret-three", "secret-two"])
})

test("allowed public URLs still redact user names, email addresses and IPs in their paths", () => {
  const text = ["https://github.com/reader/project", "https://github.com/project/10.1.2.3", "https://github.com/project/person@example.invalid"].join("\n")
  const clean = sanitizeDiagnostic(text, { username: "reader", home: "/home/reader" })
  assert.doesNotMatch(clean, /reader|10\.1\.2\.3|person@example\.invalid/)
  assert.match(clean, /https:\/\/github\.com/)
})

test("feedback puts the message first and writes only sanitized diagnostics with the latest failures", async () => {
  const ws = await workspace({}, { private: ["secret-token"], sources: [{ private: true, name: "private-board" }] })
  withRecords(ws, (db) => putSession(db, "one", { tool: "test", id: "one", spans: [], checks: [
    { skill: "old-fixed-check", ok: false, at: "2026-01-01" }, { skill: "old-fixed-check", ok: true, at: "2026-01-02" },
    { skill: "failing-check", ok: false, at: "2026-01-03" },
  ] }), { write: true })
  recordRun(ws, { step: "build", status: "failed", detail: "line one\nprivate-board secret-token https://private.example/error" })
  const before = readFileSync(join(ws.cacheDir, "records.db"))
  const result = feedbackDraft(ws, { title: "Bug from reader", message: "Cannot build: secret-token reader@example.invalid", out: "draft.md",
    identity: { username: "reader", home: "/home/reader" } })
  assert.match(result.body, /^Cannot build:/)
  assert.match(result.body, /skill-check/)
  assert.doesNotMatch(result.body, /failing-check|line one/)
  assert.doesNotMatch(result.draft, /old-fixed-check|reader|secret-token|private-board|private\.example/)
  assert.match(result.draft, /Node: v\d/)
  assert.match(result.draft, /workspace: done/)
  assert.equal(readFileSync(join(ws.root, "draft.md"), "utf8"), result.draft)
  assert.deepEqual(readFileSync(join(ws.cacheDir, "records.db")), before)
  const url = new URL(result.url)
  assert.equal(url.searchParams.get("title"), result.title)
  assert.equal(url.searchParams.get("body"), result.body)
})

test("a feedback draft without records creates no cache and never reads memo text", async () => {
  const ws = await workspace({ "Private.md": "Do not include this personal note.\n" })
  const before = readdirSync(ws.root).sort()
  const result = feedbackDraft(ws, { message: "A usability problem" })
  assert.match(result.draft, /None recorded/)
  assert.doesNotMatch(result.draft, /personal note/)
  assert.deepEqual(readdirSync(ws.root).sort(), before)
  assert.equal(existsSync(ws.cacheDir), false)
})

test("feedback sanitizes private strings before shortening run details", async () => {
  const secret = "private-value-" + "s".repeat(600)
  const ws = await workspace({}, { private: [secret] })
  recordRun(ws, { step: "build", status: "failed", detail: secret })
  const result = feedbackDraft(ws, { details: true })
  assert.doesNotMatch(result.draft, /s{20}/)
  assert.match(result.draft, /\[redacted\]/)
})

test("default feedback never includes free-form run or skill names, dates, or notes", async () => {
  const ws = await workspace({})
  const secret = "Personal treatment note for a client"
  withRecords(ws, (db) => putSession(db, "one", { tool: "test", id: "one", spans: [], checks: [
    { skill: secret, ok: false, at: "2020-01-01" },
  ] }), { write: true })
  recordRun(ws, { step: secret, status: "failed", detail: `${secret} git.internal.example:8443 /srv/client/person/notes/Treatment.md ECONNREFUSED 10.1.2.3:443` })
  const draft = feedbackDraft(ws)
  assert.doesNotMatch(JSON.stringify(draft), /Personal|treatment|internal|\/srv|10\.1\.2\.3|2020-01-01/)
  assert.deepEqual(draft.diagnostic.checks, ["skill-check"])
  assert.deepEqual(draft.diagnostic.runs, [{ step: "custom-step", status: "failed", codes: ["ECONNREFUSED"] }])
  assert.doesNotMatch(draft.draft, /review before sending/)
  const details = feedbackDraft(ws, { details: true })
  assert.match(details.draft, /review before sending/)
  assert.match(details.draft, /Personal treatment note/)
  assert.doesNotMatch(details.draft, /internal\.example|\/srv|10\.1\.2\.3/)
})

test("detail redaction covers bare hosts, IPv4, IPv6, Windows and home-outside paths", () => {
  for (const value of ["wiki.corp.example.com", "git.internal.example:8443", "10.1.2.3:443", "[2001:db8::1]:443",
    "2001:db8::1", "::1", "fe80::1%en0", "/Volumes/Work/Client Project/notes/private.md", "/srv/client/person/notes/Treatment.md",
    "D:\\Client\\memo", "D:/Client/memo"]) {
    const clean = sanitizeDiagnostic(`Failed: ${value}`, { toLineEnd: true })
    assert.ok(!clean.includes(value), value)
    assert.doesNotMatch(clean, /Client|Treatment|corp\.example|10\.1\.2\.3|db8|en0/)
  }
})

test("feedback removes workspace and graph aliases as well as their real paths", async () => {
  const actual = realpathSync(tempDir()), alias = join(realpathSync(tempDir()), "alias")
  mkdirSync(join(actual, "graph"))
  symlinkSync(actual, alias, "dir")
  const ws = await workspace({})
  ws.root = alias; ws.graphDir = join(alias, "graph")
  const text = [alias, actual, ws.graphDir, join(actual, "graph")].join("\n")
  const draft = feedbackDraft(ws, { message: text })
  for (const path of [alias, actual, ws.graphDir, join(actual, "graph")]) assert.ok(!draft.body.includes(path))
})

test("feedback and start report survive syntax and execution errors without leaking config text", () => {
  for (const content of ["export default {", 'throw new Error("Client private-host.example /srv/private/path")']) {
    const root = tempDir()
    writeFileSync(join(root, "excudo.config.mjs"), content)
    const before = readdirSync(root)
    for (const args of [["feedback"], ["start", "--report"]]) {
      const result = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), ...args, "--root", root, "--json"], { encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      const data = JSON.parse(result.stdout)
      assert.match(result.stdout, /configuration-load/)
      assert.doesNotMatch(result.stdout, /Client|private-host|\/srv|Unexpected/)
      if (args[0] === "start") assert.equal(data.stoppedAt, "workspace")
    }
    assert.deepEqual(readdirSync(root), before)
  }
})

test("issue links truncate Unicode safely within the URL budget", () => {
  const body = "첫 줄 😀\n".repeat(5000)
  const url = issueLink("A report", body)
  assert.ok(url.length <= 7500)
  const decoded = new URL(url).searchParams.get("body")
  assert.ok(decoded.endsWith("[truncated]"))
  assert.doesNotMatch(decoded, /\uFFFD/)
  assert.ok(body.startsWith(decoded.replace(/\n\[truncated\]$/, "")))
})

test("feedback CLI works before a workspace exists and writes the same draft it prints as JSON", () => {
  const root = tempDir()
  const result = spawnSync(process.execPath, [resolve("bin/excudo.mjs"), "feedback", "--root", root, "--title", "First run", "--message", "I got stuck", "--out", "draft.md", "--json"],
    { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  const data = JSON.parse(result.stdout)
  assert.equal(readFileSync(join(root, "draft.md"), "utf8"), data.draft)
  assert.match(data.body, /^I got stuck/)
  assert.match(data.body, /workspace: not done/)
})

test("file names the engine uses and Node.js survive in titles and messages, and a slash keeps its sentence", async () => {
  const names = ["SKILL.md", "AGENTS.md", "excudo.config.mjs", "package.json", "Node.js", "app.yml", "a.yaml", "x.edn", "index.html", "site.css", "run.js", "page.mdx"]
  for (const name of names) assert.equal(sanitizeDiagnostic(`${name} private option ignored`), `${name} private option ignored`, name)
  assert.equal(sanitizeDiagnostic("404 on /index.html, then the page is blank"), "404 on /index.html, then the page is blank")
  assert.match(sanitizeDiagnostic("see https://github.com/cudoment/excudo/blob/v0.7.0/CHANGELOG.md"), /blob\/v0\.7\.0\/CHANGELOG\.md/)
  assert.equal(sanitizeDiagnostic("wiki.corp.example failed"), "[redacted-host] failed")
  const ws = await workspace({})
  const draft = feedbackDraft(ws, { title: "excudo.config.mjs private option ignored", message: "Node.js 22 fails on /index.html, then the page is blank" })
  assert.equal(draft.title, "excudo.config.mjs private option ignored")
  assert.match(draft.body, /Node\.js 22 fails on \/index\.html, then the page is blank/)
  // The to-end-of-line rule still cuts an unknown path in --details.
  assert.doesNotMatch(sanitizeDiagnostic("Failed: /srv/client/notes.md and more", { toLineEnd: true }), /srv|more/)
})

test("title and message lose drive paths and deep absolute paths but keep versions, times and npm links", async () => {
  const clean = (text) => sanitizeDiagnostic(text, { home: "/home/reader", username: "reader" })
  assert.doesNotMatch(clean("Build fails in D:\\Clients\\Kim\\memo now"), /Clients|Kim/)
  assert.match(clean("Build fails in D:\\Clients\\Kim\\memo now"), /\[redacted-path\] now/)
  assert.doesNotMatch(clean("Failed in /srv/client/person/notes today"), /srv|client|person/)
  assert.match(clean("Failed in /srv/client/person/notes today"), /today/)
  assert.equal(clean("and/or 404 on /index.html"), "and/or 404 on /index.html")
  assert.equal(clean("excudo@0.7.0 and cudoc-export@1.1.0 installed"), "excudo@0.7.0 and cudoc-export@1.1.0 installed")
  assert.equal(clean("excudo@0.8.0-beta.1 installed"), "excudo@0.8.0-beta.1 installed")
  assert.equal(clean("Scheduled run at 09:00:00 failed"), "Scheduled run at 09:00:00 failed")
  assert.equal(clean("see https://www.npmjs.com/package/excudo"), "see https://www.npmjs.com/package/excudo")
  assert.match(clean("reader@example.invalid reader@localhost"), /^\[redacted-email\] \[redacted-email\]$/)
  assert.match(clean("at 2001:db8::1 and fe80::1"), /^at \[redacted-ip\] and \[redacted-ip\]$/)
  assert.doesNotMatch(clean("https://evilnpmjs.com/x https://npmjs.com.evil.invalid/x"), /evil/)
  const ws = await workspace({})
  const draft = feedbackDraft(ws, { title: "Fails in C:\\Users\\Kim\\memo", message: "Open C:\\Clients\\Kim\\memo and /srv/client/notes at 09:00:00" })
  assert.doesNotMatch(draft.title + draft.body, /Kim|Clients|srv/)
  assert.match(draft.body, /09:00:00/)
})
