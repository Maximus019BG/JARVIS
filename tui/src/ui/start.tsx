import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { Config } from "../config/config.ts"
import { loadExtensions } from "../extend/extensions.ts"
import { loadKeymap } from "../config/keybinds.ts"
import { startMcp } from "../extend/mcp.ts"
import { configDir } from "../config/paths.ts"
import { listModels } from "../agent/provider.ts"
import { openSession } from "../agent/session.ts"
import { loadTheme } from "../config/theme.ts"
import { App } from "./app.tsx"

export type StartOptions = {
  config: Config
  model?: string
  agent?: string
  session?: string
  resume?: boolean
  cwd?: string
}

export async function startTui(options: StartOptions) {
  const cwd = options.cwd ?? process.cwd()
  const session = openSession(cwd, { id: options.session, resume: options.resume })
  const [mcp, extensions] = await Promise.all([startMcp(options.config), loadExtensions(options.config, cwd)])

  const notes = [...extensions.errors, ...mcp.status.filter((s) => s.error).map((s) => `mcp ${s.server}: ${s.error}`)]
  // A fresh install has no providers yet. Say so in the transcript rather than
  // refusing to start — the user needs the UI to read the instructions.
  if (listModels(options.config).length === 0) {
    notes.unshift(
      [
        "No models configured yet.",
        `Create ${configDir}/jarvis.jsonc with a \`provider\` entry, then restart.`,
        "See the README for an example, or run `jarvis config` to check what is loaded.",
      ].join("\n"),
    )
  }

  // Ctrl-C is handled in the app so it can interrupt a running turn first.
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  process.on("exit", () => void mcp.close())

  createRoot(renderer).render(
    <App
      config={options.config}
      cwd={cwd}
      session={session}
      mcp={mcp}
      extensions={extensions}
      notes={notes}
      theme={loadTheme(options.config.theme, cwd)}
      keymap={loadKeymap(options.config.keybinds)}
      model={options.model}
      agent={options.agent}
    />,
  )
}
