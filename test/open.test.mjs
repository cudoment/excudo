import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { openLocalSite } from "../src/open.mjs"
import { homeEnv, tempDir } from "./helpers.mjs"

test("local site open hands the path to explorer.exe on Windows, so cmd never reads & or ^ in it", () => {
  for (const target of ["C:\\Memo Folder\\index.html", "C:\\R&D\\100%^memo\\index.html"]) {
    let called
    const child = new EventEmitter(); child.unref = () => {}
    openLocalSite(target, { platform: "win32", launch: (...args) => { called = args; return child } })
    assert.deepEqual(called.slice(0, 2), ["explorer.exe", [target]])
  }
})

test("opening failures keep the generated site and print its path without an uncaught error", () => {
  const output = [], child = new EventEmitter(); child.unref = () => {}
  openLocalSite("/memo/index.html", { launch: () => child, onError: (path) => output.push(path) })
  child.emit("error", new Error("ENOENT"))
  assert.deepEqual(output, ["/memo/index.html"])
  openLocalSite("/memo/other.html", { launch: () => { throw new Error("Cannot spawn") }, onError: (path) => output.push(path) })
  assert.deepEqual(output, ["/memo/index.html", "/memo/other.html"])
})

test("test homes configure both platform home variables and the actual subprocess home", () => {
  const home = tempDir()
  const env = homeEnv(home)
  assert.equal(env.HOME, home); assert.equal(env.USERPROFILE, home)
  const child = spawnSync(process.execPath, ["-p", 'require("node:os").homedir()'], { env, encoding: "utf8" })
  assert.equal(child.status, 0)
  assert.equal(child.stdout.trim(), home)
})
