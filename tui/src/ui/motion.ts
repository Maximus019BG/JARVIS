import { createTimeline, engine } from "@opentui/core"
import { useEffect, useRef, useState, type RefObject } from "react"

/** How much the UI is allowed to move. `reduced` keeps the spinner and drops the rest. */
export type MotionLevel = "full" | "reduced" | "off"

const LEVELS = new Set<string>(["full", "reduced", "off"])

/** Long enough that a looping timeline never reaches its end during a session. */
const FOREVER = 1e9

/**
 * The environment wins over config, and a pipe or a dumb terminal turns everything off —
 * animation there is invisible at best and a stream of escape codes at worst.
 */
export function resolveMotion(
  configured: MotionLevel,
  env: Record<string, string | undefined> = process.env,
  tty = process.stdout.isTTY,
): MotionLevel {
  const override = env.JARVIS_MOTION
  if (override && LEVELS.has(override)) return override as MotionLevel
  if (!tty || env.TERM === "dumb") return "off"
  return configured
}

/** Mixes two `#rrggbb` colors. Anything else falls back to the destination color. */
export function lerpHex(from: string, to: string, t: number): string {
  if (from.length !== 7 || to.length !== 7) return to
  const start = Number.parseInt(from.slice(1), 16)
  const end = Number.parseInt(to.slice(1), 16)
  if (Number.isNaN(start) || Number.isNaN(end)) return to
  const channel = (shift: number) => {
    const a = (start >> shift) & 0xff
    return Math.round(a + (((end >> shift) & 0xff) - a) * t)
  }
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`
}

const FRAMES = [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"]
const FRAME_MS = 80

/**
 * Spinner frame and whole seconds elapsed, restarting whenever `active` flips on. A plain
 * interval rather than a Timeline: this is the one animation whose output has to pass
 * through React anyway. At `off` it ticks once a second, because the elapsed count is
 * information rather than decoration.
 */
export function useTicker(active: boolean, motion: MotionLevel): { frame: string; seconds: number } {
  const period = motion === "off" ? 1000 : FRAME_MS
  const [ticks, setTicks] = useState(0)

  useEffect(() => {
    if (!active) return
    setTicks(0)
    const id = setInterval(() => setTicks((n) => n + 1), period)
    return () => clearInterval(id)
  }, [active, period])

  return {
    frame: motion === "off" ? "●" : FRAMES[ticks % FRAMES.length]!,
    seconds: Math.floor((ticks * period) / 1000),
  }
}

type Enterable = { opacity: number; height: number }

/**
 * Entrance animation: fade in, optionally growing to `height` at the same time. Fires once
 * per mount — a later height change is layout, not an entrance.
 */
export function useEnter(
  ref: RefObject<Enterable | null>,
  motion: MotionLevel,
  options: { ms?: number; height?: number } = {},
) {
  const { ms = 120, height } = options

  useEffect(() => {
    const target = ref.current
    if (!target || motion !== "full") return
    const properties: Record<string, number> = { opacity: 1 }
    target.opacity = 0
    if (height !== undefined) {
      properties.height = height
      target.height = 1
    }
    const timeline = createTimeline({ duration: ms })
    timeline.add(target, { ...properties, duration: ms, ease: "outQuad" })
    return () => {
      timeline.pause()
      engine.unregister(timeline)
      target.opacity = 1
      if (height !== undefined) target.height = height
    }
  }, [])
}

/**
 * Sweeps `t` from 0 to 1 and back for as long as `active`, one sweep per `ms`. The caller
 * mutates the renderable directly in `apply`, so nothing here goes through React.
 */
export function useOscillator(active: boolean, ms: number, motion: MotionLevel, apply: (t: number) => void) {
  const latest = useRef(apply)
  latest.current = apply

  useEffect(() => {
    if (!active || motion !== "full") return
    const value = { t: 0 }
    const timeline = createTimeline({ duration: FOREVER })
    timeline.add(value, {
      t: 1,
      duration: ms,
      ease: "inOutSine",
      loop: true,
      alternate: true,
      onUpdate: () => latest.current(value.t),
    })
    return () => {
      timeline.pause()
      engine.unregister(timeline)
      latest.current(0)
    }
  }, [active, ms, motion])
}

/**
 * One sweep of `t` from 0 to 1 the first time `trigger` turns true. Something that mounts
 * already true does not flash, so a restored transcript stays still.
 */
export function useFlash(trigger: boolean, ms: number, motion: MotionLevel, apply: (t: number) => void) {
  const latest = useRef(apply)
  latest.current = apply
  const previous = useRef(trigger)

  useEffect(() => {
    const fire = trigger && !previous.current
    previous.current = trigger
    if (!fire || motion !== "full") return
    const value = { t: 0 }
    const timeline = createTimeline({ duration: ms })
    timeline.add(value, { t: 1, duration: ms, ease: "outQuad", onUpdate: () => latest.current(value.t) })
    return () => {
      timeline.pause()
      engine.unregister(timeline)
      latest.current(1)
    }
  }, [trigger, ms, motion])
}
