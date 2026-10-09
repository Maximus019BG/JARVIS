import { useEffect, useRef, useState } from "react"
import { readCredentials } from "../blueprint/credentials.ts"
import { GestureCommands, type Command, type CommandConfig } from "../pi/gestures.ts"
import { remoteSource, type RemoteStats } from "../pi/hand-source.ts"

export type Gestures = {
  stats?: RemoteStats
  /** What the model sees right now, for the status line: "palm 0.9", "hand", "no hand". */
  seen?: string
  error?: string
  /** Hands are arriving without labels: the server has landmarks but no gesture model. */
  unlabelled?: boolean
}

/** How each label reads in a toast. A label with none reads as its name. */
export const GLYPHS: Record<string, string> = {
  thumbs_up: "👍",
  thumbs_down: "👎",
  palm: "✋",
  fist: "✊",
  point: "☝",
  peace: "✌",
  ok: "👌",
  call: "🤙",
  rock: "🤘",
  swipe_up: "↑",
  swipe_down: "↓",
  swipe_left: "←",
  swipe_right: "→",
  wave: "👋",
}

/** Hands this long with not one label means no gesture model, not a slow one. */
const UNLABELLED_MS = 2000
/** The app re-renders on every state change here, and it is a big component: stats once a second. */
const STATS_MS = 1000

/**
 * Hand gestures as commands, for as long as `enabled`. The camera and model are the same
 * ones the freehand pen uses (`remoteSource`); only the reading differs — learned labels
 * through `GestureCommands` instead of pinch geometry. `onCommand` is read through a ref, so
 * a re-render never restarts the camera.
 */
export function useGestures(options: { enabled: boolean; config: CommandConfig; onCommand: (command: Command) => void }): Gestures {
  const [state, setState] = useState<Gestures>({})
  const onCommand = useRef(options.onCommand)
  onCommand.current = options.onCommand
  const config = useRef(options.config)
  config.current = options.config

  useEffect(() => {
    if (!options.enabled) {
      setState({})
      return
    }
    let credentials: ReturnType<typeof readCredentials>
    try {
      credentials = readCredentials()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (!credentials) {
      setState({ error: "pair first (/pair) — gestures run on your cloud" })
      return
    }

    let stopped = false
    let shown = 0
    const source = remoteSource({
      baseUrl: credentials.baseUrl,
      token: credentials.token,
      onStats: (stats) => {
        const now = performance.now()
        if (stopped || (now - shown < STATS_MS && stats.state === "live")) return
        shown = now
        setState((current) => ({ ...current, stats }))
      },
    })
    const commands = new GestureCommands(config.current)
    let handSince: number | undefined
    let labelled = false
    let seen = ""
    let seenAt = 0

    void (async () => {
      try {
        for await (const frame of source.frames()) {
          if (stopped) return
          for (const command of commands.push(frame)) onCommand.current(command)
          // One decimal and a quarter-second floor, so the readout changes when the answer
          // does and the app is not re-rendered at the camera's frame rate.
          const hand = frame.hands[0]
          const now = hand?.gesture ? `${hand.gesture.name} ${hand.gesture.score.toFixed(1)}` : hand ? "hand" : "no hand"
          if (now !== seen && performance.now() - seenAt > 250) {
            seen = now
            seenAt = performance.now()
            setState((current) => ({ ...current, seen: now }))
          }
          if (labelled) continue
          if (frame.hands.some((hand) => hand.gesture)) labelled = true
          else if (frame.hands.length > 0) {
            handSince ??= frame.t
            if (frame.t - handSince > UNLABELLED_MS) {
              labelled = true // say it once
              setState((current) => ({ ...current, unlabelled: true }))
            }
          }
        }
      } catch (error) {
        if (!stopped) setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
      }
    })()

    return () => {
      stopped = true
      source.close()
    }
  }, [options.enabled])

  return state
}
