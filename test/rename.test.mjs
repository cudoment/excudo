import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { build, homeStatus, rename } from "../src/index.mjs"
import { put, read, workspace } from "./helpers.mjs"

test("rename moves the node's file and children, rewrites links outside code, and reports Home and settings", async () => {
  const ws = await workspace({
    "Home.md": "- [[Search demo]]\n- [[Plans]]\n",
    "projects/Plans.md": "# Plans\nWhat comes next.\n\n- See [[search demo]] and #Tasks\n- {{embed [[Search demo]]}}\n- {{query (and (task TODO) [[Search demo]])}}\n\n```\n[[Search demo]] stays in code\n```\n",
    "projects/Plans/Search demo.md": "# Search demo\nA demo of the search.\n\n- TODO show it\n",
    "projects/Plans/Search demo/Data.md": "# Data\nThe test data for [[Search demo]].\n",
    "projects/Plans/Tasks.md": "# Tasks\nSmall tasks.\n",
  }, { knowledge: ["Search demo"] })
  assert.equal(build(ws).blocked.length, 0)

  const result = await rename(ws, "Search demo", "Search")
  assert.deepEqual([result.from, result.to, result.links, result.files, result.home, result.settings],
    ["projects/Plans/Search demo.md", "projects/Plans/Search.md", 4, 2, [1], ["knowledge"]])
  assert.ok(!existsSync(join(ws.graphDir, "projects/Plans/Search demo.md")) && !existsSync(join(ws.graphDir, "projects/Plans/Search demo")))
  assert.match(read(ws, "projects/Plans/Search.md"), /^# Search\nA demo of the search\.\n/)
  assert.match(read(ws, "projects/Plans/Search/Data.md"), /The test data for \[\[Search\]\]\./)
  const plans = read(ws, "projects/Plans.md")
  assert.match(plans, /- See \[\[Search\]\] and #Tasks\n- \{\{embed \[\[Search\]\]\}\}\n- \{\{query \(and \(task TODO\) \[\[Search\]\]\)\}\}\n/)
  assert.match(plans, /\[\[Search demo\]\] stays in code/)
  // Home is the owner's: it keeps the old link, which home reports as missing.
  assert.equal(read(ws, "Home.md"), "- [[Search demo]]\n- [[Plans]]\n")
  assert.deepEqual(homeStatus(ws).missing, ["Search demo"])
  // The build protection followed the node, so the next build rewrites its region without a fight.
  assert.deepEqual(build(ws).blocked, [])

  // When the owner's request covers Home, --home updates its links too.
  const again = await rename(ws, "Search", "Search demo 2", { home: true })
  assert.deepEqual(again.home, [])
  assert.equal(read(ws, "Home.md"), "- [[Search demo]]\n- [[Plans]]\n", "Home linked the old name, which is no longer this node")
  put(ws.root, "Home.md", "- [[Search demo 2]]\n- [[Plans]]\n")
  await rename(ws, "Search demo 2", "Search", { home: true })
  assert.equal(read(ws, "Home.md"), "- [[Search]]\n- [[Plans]]\n")

  // A tag of a name without spaces follows too, and a name in use is refused.
  const tasks = await rename(ws, "Tasks", "Chores")
  assert.equal(tasks.links, 1)
  assert.match(read(ws, "projects/Plans.md"), /and #Chores\n/)
  await assert.rejects(rename(ws, "Chores", "plans"), /already exists/)
  await assert.rejects(rename(ws, "Chores", "a/b"), /cannot/)
})

test("rename changes only the case of a node's name", async () => {
  const ws = await workspace({
    "projects/Site.md": "# Site\nThe website.\n\n- Next: [[docs]]\n",
    "projects/Site/docs.md": "# docs\nThe docs.\n",
  })
  assert.equal(build(ws).blocked.length, 0)
  const result = await rename(ws, "docs", "Docs")
  assert.equal(result.to, "projects/Site/Docs.md")
  assert.match(read(ws, "projects/Site/Docs.md"), /^# Docs\n/)
  assert.match(read(ws, "projects/Site.md"), /- Next: \[\[Docs\]\]\n/)
  put(ws.root, "projects/Site/Other.md", "# Other\nAnother page.\n")
  assert.deepEqual(build(ws).blocked, [])
})
