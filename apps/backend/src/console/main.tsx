import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { kotori } from "../cli/kotori.ts"
import { App } from "./App.tsx"
import { commandSpecs } from "./model/commands.ts"
import { databaseTarget } from "./model/environment.ts"
import { makeConsoleRuntime } from "./runtime.ts"
import { color } from "./ui/theme.ts"

/** Opens the console on this terminal and resolves once it's closed and its connections are released. */
export const runConsole = async () => {
  const runtime = makeConsoleRuntime()
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    targetFps: 30,
    backgroundColor: color.background
  })
  createRoot(renderer).render(
    <App
      runtime={runtime}
      target={databaseTarget(process.env)}
      branch={process.env["NEON_BRANCH"]?.trim() || undefined}
      specs={commandSpecs(kotori)}
    />
  )
  await renderer.closed
  // Running jobs get a moment to stop and connections to close; quitting doesn't wait on a stuck one.
  await Promise.race([runtime.dispose(), new Promise((resolve) => setTimeout(resolve, 3000))])
}
