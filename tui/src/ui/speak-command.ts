import type { Config } from "../config/config.ts"
import { globalConfigFile, persistConfig } from "../config/persist.ts"
import { canSpeak, say } from "./speak.ts"

/** What `/speak` decided to do. Returned as data so the whole command can be tested. */
export type SpeakAction =
  | { kind: "note"; text: string; level?: "info" | "error" }
  /** Nothing on this machine can talk yet: open the provider flow instead of reporting it. */
  | { kind: "setup" }
  /** Persist `voice.speak` and reload, then say so. */
  | { kind: "toggle"; on: boolean }
  | { kind: "test" }

/**
 * `/speak`, as a pure decision.
 *
 * Turning it on when nothing can talk opens the setup rather than saying "voice is off" — the
 * same trick the microphone key plays, and for the same reason: the reader has just said what
 * they want, and a message pointing at a config file is not the answer to it.
 */
export function speakAction(args: string, config: Config, able: boolean): SpeakAction {
  const on = config.voice?.speak === true
  const argument = args.trim().toLowerCase()

  if (argument === "test") return able ? { kind: "test" } : { kind: "setup" }
  // The way to swap hosted speech for your own key, or back, once something can already talk.
  if (argument === "setup") return { kind: "setup" }
  if (argument && !["on", "off", "toggle"].includes(argument)) {
    return {
      kind: "note",
      text: `unknown argument "${argument}" — /speak on, /speak off, /speak test, /speak setup`,
      level: "error",
    }
  }

  const wanted = argument === "on" ? true : argument === "off" ? false : !on
  if (!wanted) return on ? { kind: "toggle", on: false } : { kind: "note", text: "speech is already off" }
  if (!able) return { kind: "setup" }
  return on ? { kind: "note", text: "speech is already on" } : { kind: "toggle", on: true }
}

/** How it will speak, for the confirmation. Which half is doing the work is worth knowing. */
export function describeVoice(config: Config): string {
  if (config.voice?.speakModel) {
    return config.voice.speakVoice ? `${config.voice.speakModel} (${config.voice.speakVoice})` : config.voice.speakModel
  }
  return config.voice?.synth?.split(/\s+/)[0] ?? "a local synthesiser"
}

export type SpeakDeps = {
  config: Config
  note: (text: string, level?: "info" | "error") => void
  openSetup: () => void
  reload: () => boolean
}

/** The effectful half: persists, reloads and speaks. */
export function runSpeak(args: string, deps: SpeakDeps): void {
  const { config, note, openSetup, reload } = deps
  const action = speakAction(args, config, canSpeak(config))
  switch (action.kind) {
    case "note":
      return note(action.text, action.level)
    case "setup":
      return openSetup()
    case "test":
      // Deliberately a line with a full stop and a clause in it: a one-word test says nothing
      // about whether the sentence splitting and the pacing are right.
      void say(config, "Systems nominal. This is how I will sound.").catch((error) =>
        note(`voice: ${error instanceof Error ? error.message : String(error)}`, "error"),
      )
      return note(`speaking through ${describeVoice(config)}`)
    case "toggle": {
      // Global, like a provider and unlike a permission: how you want to be answered is a
      // property of you, not of the repository you happen to be standing in.
      persistConfig(globalConfigFile(), ["voice", "speak"], action.on)
      if (!reload()) return
      return note(action.on ? `speech on — ${describeVoice(config)}` : "speech off")
    }
  }
}
