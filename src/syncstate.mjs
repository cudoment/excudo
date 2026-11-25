// The machine-local sync state (`.excudo/sync.json`), shared by sync and the build: this computer's name, its Drive
// folder, the last sync and the marks that say this computer has not built the history it holds yet.
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeAtomic } from "./files.mjs"

const stateFile = (ws) => join(ws.cacheDir, "sync.json")

export function readState(ws) {
  try { return JSON.parse(readFileSync(stateFile(ws), "utf8")) ?? {} } catch { return {} }
}

export function writeState(ws, change) {
  mkdirSync(ws.cacheDir, { recursive: true })
  writeAtomic(stateFile(ws), `${JSON.stringify({ ...readState(ws), ...change }, null, 2)}\n`)
}
