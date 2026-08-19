import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { Config } from "../config/config.ts"
import { loadExtensions } from "../extend/extensions.ts"
import { loadKeymap } from "../config/keybinds.ts"
import { startMcp } from "../extend/mcp.ts"
import { hostedGuidance } from "../agent/hosted.ts"
import { listModels } from "../agent/provider.ts"
import { isPaired } from "../blueprint/credentials.ts"
import { openSession } from "../agent/session.ts"
import { pushSessions } from "../agent/session-sync.ts"
import { loadTheme } from "../config/theme.ts"
import { killBackground } from "../tools/background.ts"
import { App } from "./app.tsx"
import { resolveMotion } from "./motion.ts"

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

  // Fire-and-forget, and on startup rather than exit: ctrl-c twice never runs a clean
  // shutdown, so an exit hook would be the one path that drops the session it was meant to
  // save. Every finished session is therefore at most one launch behind. Skips the live one,
  // which is still growing. No-op unless `syncSessions` is on.
  void pushSessions(options.config, { skip: session.id }).catch(() => {
    // A failed mirror must never delay or break starting up.
  })

  const notes = [...extensions.errors, ...mcp.status.filter((s) => s.error).map((s) => `mcp ${s.server}: ${s.error}`)]
  // A fresh install has no providers yet. Say so in the transcript rather than refusing to
  // start — and the flow opens over the top of it, so this is the explanation behind the form
  // rather than a set of instructions to go and carry out somewhere else.
  const needsProvider = listModels(options.config).length === 0
  if (needsProvider) notes.unshift(hostedGuidance(options.config) ?? "")
  // Pairing before keys, when the machine has neither. Being paired unlocks the hosted model,
  // so asking for an API key first is asking for something pairing might make unnecessary.
  const autoPair = needsProvider && !isPaired()

  // Ctrl-C is handled in the app so it can interrupt a running turn first.
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  // Covers every exit path, so a backgrounded dev server never outlives the session.
  process.on("exit", () => {
    killBackground()
    void mcp.close()
  })

  createRoot(renderer).render(
    <App
      config={options.config}
      cwd={cwd}
      session={session}
      mcp={mcp}
      extensions={extensions}
      notes={notes}
      theme={loadTheme(options.config.theme, cwd)}
      motion={resolveMotion(options.config.animations)}
      keymap={loadKeymap(options.config.keybinds)}
      model={options.model}
      agent={options.agent}
      autoSetup={needsProvider}
      autoPair={autoPair}
    />,
  )
}
