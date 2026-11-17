import { spawn } from "node:child_process"

/** Opening a generated site is optional: failures leave its path available to the owner. */
export function openLocalSite(target, { platform = process.platform, launch = spawn, onError = (path) => console.error(path) } = {}) {
  const [command, args] = platform === "win32" ? ["explorer.exe", [target]]
    : [platform === "darwin" ? "open" : "xdg-open", [target]]
  try {
    const child = launch(command, args, { stdio: "ignore", detached: true })
    child.once("error", () => onError(target))
    child.unref()
    return child
  } catch { onError(target); return null }
}
