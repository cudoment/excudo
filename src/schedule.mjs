// The schedule that brings the website's changes into the memo on this computer: `excudo site pull`
// every minute. On macOS it is a LaunchAgent in the owner's own session, written and loaded by `site
// setup`; elsewhere setup prints the command for the owner's scheduler. A workspace whose own
// schedule runs `site pull` turns it off (`site.inbox.schedule: false`).
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeAtomic } from "./files.mjs"

const ENGINE_BIN = fileURLToPath(new URL("../bin/excudo.mjs", import.meta.url))
/** How often the schedule looks at the inbox, in seconds; `site pull` itself brings changes in every five minutes. */
export const PULL_INTERVAL = 60

const agentsDir = () => process.env.EXCUDO_LAUNCH_AGENTS ?? join(homedir(), "Library", "LaunchAgents")
const supported = () => Boolean(process.env.EXCUDO_LAUNCH_AGENTS) || process.platform === "darwin"
const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** The LaunchAgent of a website: its label and file. */
export function pullAgent(siteId) {
  const label = `excudo.${siteId}.pull`
  return { label, plist: join(agentsDir(), `${label}.plist`) }
}

/** The command a scheduler runs every minute. */
export const pullCommand = (ws) => `cd ${JSON.stringify(ws.root)} && npx --no-install excudo site pull`

/** Whether the schedule is in place: `installed`, `missing`, or `unsupported` where setup cannot write one. */
export function pullScheduleState(siteId) {
  if (!supported()) return "unsupported"
  return existsSync(pullAgent(siteId).plist) ? "installed" : "missing"
}

/**
 * Writes and loads the LaunchAgent that runs `site pull` every minute with this engine and this Node,
 * finding gh where it lies. Returns `{ state, label, plist }`, or `{ state: "unsupported", command }`.
 */
export function installPullSchedule(ws, { siteId, gh }) {
  if (!supported()) return { state: "unsupported", command: pullCommand(ws) }
  const { label, plist } = pullAgent(siteId)
  const log = join(ws.cacheDir, "logs", "site-pull.log")
  mkdirSync(dirname(log), { recursive: true })
  mkdirSync(dirname(plist), { recursive: true })
  const path = [...new Set([dirname(process.execPath), gh ? dirname(gh) : null, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean))].join(":")
  const args = [process.execPath, ENGINE_BIN, "site", "pull", "--root", ws.root].map((arg) => `<string>${xml(arg)}</string>`).join("")
  writeAtomic(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>WorkingDirectory</key><string>${xml(ws.root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>StartInterval</key><integer>${PULL_INTERVAL}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`)
  const launchctl = process.env.EXCUDO_LAUNCHCTL ?? "launchctl"
  const domain = `gui/${process.getuid?.() ?? 0}`
  spawnSync(launchctl, ["bootout", `${domain}/${label}`], { stdio: "ignore" })
  const loaded = spawnSync(launchctl, ["bootstrap", domain, plist], { encoding: "utf8" })
  return { state: loaded.status === 0 ? "installed" : "failed", label, plist, error: loaded.status === 0 ? undefined : `${loaded.stderr ?? ""}`.trim() }
}

/** Unloads and removes the LaunchAgent. */
export function removePullSchedule(siteId) {
  const { label, plist } = pullAgent(siteId)
  spawnSync(process.env.EXCUDO_LAUNCHCTL ?? "launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}/${label}`], { stdio: "ignore" })
  rmSync(plist, { force: true })
}
