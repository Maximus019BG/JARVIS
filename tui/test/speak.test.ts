import { describe, expect, test } from "bun:test"
import { ConfigSchema } from "../src/config/config.ts"
import { SYNTHS, canSpeak, nextUtterances, pickSynth, speakable, speaking } from "../src/ui/speak.ts"
import { describeVoice, speakAction } from "../src/ui/speak-command.ts"

const only =
  (...installed: string[]) =>
  (bin: string) =>
    installed.includes(bin)

describe("pickSynth", () => {
  test("first on PATH wins, in the listed order", () => {
    expect(pickSynth(only("espeak", "espeak-ng"))).toEqual(SYNTHS.find((command) => command[0] === "espeak-ng")!)
  })

  test("nothing installed is undefined — silence is a valid outcome", () => {
    expect(pickSynth(() => false)).toBeUndefined()
  })

  // Piper is unprobeable: it needs a voice model chosen, so `voice.synth` is the only way in.
  test("an override is taken at its word, and split into argv", () => {
    expect(pickSynth(() => false, "  piper --model v.onnx --output_file ")).toEqual([
      "piper",
      "--model",
      "v.onnx",
      "--output_file",
    ])
  })
})

describe("canSpeak", () => {
  test("a hosted model is enough on its own, with nothing installed", () => {
    expect(canSpeak(ConfigSchema.parse({ voice: { speakModel: "openai/gpt-4o-mini-tts" } }), () => false)).toBe(true)
  })

  test("so is a synthesiser on PATH, with no model configured", () => {
    expect(canSpeak(ConfigSchema.parse({}), only("espeak-ng"))).toBe(true)
    expect(canSpeak(ConfigSchema.parse({}), () => false)).toBe(false)
  })
})

describe("speakable", () => {
  test("code fences are dropped whole, and the prose around them survives", () => {
    const spoken = speakable("Try this:\n\n```ts\nconst x = 1\n```\n\nThat should do it.")
    expect(spoken).toBe("Try this: That should do it.")
  })

  test("markdown punctuation goes; the words it decorated stay", () => {
    expect(speakable("## The **plan**\n\n- fix `app.tsx`\n- ship it")).toBe("The plan fix app.tsx ship it")
  })

  test("a link is read as its text, and a bare url is not read at all", () => {
    expect(speakable("See [the docs](https://example.com/a/b) first.")).toBe("See the docs first.")
    expect(speakable("It is at https://example.com/very/long/path now.")).toBe("It is at a link now.")
  })

  test("a table loses its rules and keeps its cells", () => {
    expect(speakable("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(", a , b , , 1 , 2 ,")
  })
})

describe("nextUtterances", () => {
  test("holds a sentence until it is finished", () => {
    expect(nextUtterances("The build is")).toEqual({ utterances: [], rest: "The build is" })
    const done = nextUtterances("The build is red. And ")
    expect(done.utterances).toEqual(["The build is red."])
    expect(done.rest).toBe("And ")
  })

  test("splits several sentences at once", () => {
    expect(nextUtterances("One. Two! Three? ").utterances).toEqual(["One.", "Two!", "Three?"])
  })

  // A pause in the middle of "e.g." is the tell that a machine is reading, not a person.
  test("an abbreviation, an initial and a list marker do not end a sentence", () => {
    expect(nextUtterances("Use a fast model, e.g. haiku, for this. ").utterances).toEqual([
      "Use a fast model, e.g. haiku, for this.",
    ])
    expect(nextUtterances("Ask J. Stark about it. ").utterances).toEqual(["Ask J. Stark about it."])
    expect(nextUtterances("1. First thing here\n\n").utterances).toEqual(["First thing here"])
  })

  test("a decimal and a filename are not sentence endings", () => {
    expect(nextUtterances("It costs 3.50 and lives in app.tsx today. ").utterances).toEqual([
      "It costs 3.50 and lives in app.tsx today.",
    ])
  })

  // The whole reason the fence check exists: by the time the closing fence arrives, an
  // unheld buffer would already have read the code out loud.
  test("nothing after an unclosed code fence is spoken", () => {
    const streaming = nextUtterances("Here it is.\n\n```ts\nconst secret = 1. Or is it.\n")
    expect(streaming.utterances).toEqual(["Here it is."])
    expect(streaming.rest.startsWith("```ts")).toBe(true)
  })

  test("once the fence closes, the code is dropped and the prose after it flows", () => {
    const closed = nextUtterances("```ts\nconst x = 1\n```\n\nThat compiles. ")
    expect(closed.utterances).toEqual(["That compiles."])
  })

  test("a blank line flushes text that never got punctuated", () => {
    expect(nextUtterances("# Findings\n\n").utterances).toEqual(["Findings"])
  })

  test("chunks left as pure punctuation by the stripping are dropped, not synthesized", () => {
    expect(nextUtterances("```\ncode\n```\n\n").utterances).toEqual([])
  })
})

describe("streaming", () => {
  /** Feeds text in the ragged chunks a model actually produces. */
  function stream(chunks: string[]): { spoken: string[]; rest: string } {
    let buffer = ""
    const spoken: string[] = []
    for (const chunk of chunks) {
      buffer += chunk
      const { utterances, rest } = nextUtterances(buffer)
      spoken.push(...utterances)
      buffer = rest
    }
    return { spoken, rest: buffer }
  }

  test("a sentence split across deltas is spoken once, whole", () => {
    const { spoken, rest } = stream(["The bui", "ld is re", "d on ", "dev. Nothing ships."])
    expect(spoken).toEqual(["The build is red on dev."])
    // The last sentence has no trailing whitespace yet, so it waits for `flush`.
    expect(rest).toBe("Nothing ships.")
  })

  test("a fence opened and closed across deltas never leaks its contents", () => {
    const { spoken } = stream(["Run this.\n\n", "```sh\n", "rm -rf /. Really.\n", "```\n\n", "Then reboot. "])
    expect(spoken).toEqual(["Run this.", "Then reboot."])
  })
})

describe("speaking", () => {
  // A synthesiser that cannot start is one problem, not one per sentence. Without this, a
  // missing API key produces a wall of identical red notes over a perfectly good answer.
  test("a broken synthesiser is reported once for the whole turn", async () => {
    const errors: string[] = []
    const session = speaking(
      ConfigSchema.parse({ voice: { speak: true, synth: "jarvis-no-such-synthesiser" } }),
      (message) => errors.push(message),
    )
    session.push("One. Two. Three. Four. ")
    await session.flush()
    expect(errors).toHaveLength(1)
  })

  test("stopping before anything is said reports nothing at all", async () => {
    const errors: string[] = []
    const session = speaking(
      ConfigSchema.parse({ voice: { speak: true, synth: "jarvis-no-such-synthesiser" } }),
      (message) => errors.push(message),
    )
    session.push("One. Two. ")
    session.stop()
    await session.flush()
    expect(errors).toEqual([])
  })
})

describe("speakAction", () => {
  const off = ConfigSchema.parse({})
  const on = ConfigSchema.parse({ voice: { speak: true, speakModel: "openai/gpt-4o-mini-tts" } })

  test("a bare /speak toggles", () => {
    expect(speakAction("", off, true)).toEqual({ kind: "toggle", on: true })
    expect(speakAction("", on, true)).toEqual({ kind: "toggle", on: false })
  })

  test("on and off are explicit, and saying it twice is a note rather than a write", () => {
    expect(speakAction("on", on, true)).toEqual({ kind: "note", text: "speech is already on" })
    expect(speakAction("off", off, true)).toEqual({ kind: "note", text: "speech is already off" })
  })

  // The same trick the microphone key plays: the reader has just said what they want, and a
  // message pointing at a config file is not the answer to it.
  test("turning it on with nothing to speak with opens the setup", () => {
    expect(speakAction("on", off, false)).toEqual({ kind: "setup" })
    expect(speakAction("test", off, false)).toEqual({ kind: "setup" })
  })

  test("turning it off never needs a provider", () => {
    expect(speakAction("off", on, false)).toEqual({ kind: "toggle", on: false })
  })

  test("an unknown argument says what the real ones are", () => {
    expect(speakAction("louder", off, true)).toMatchObject({ kind: "note", level: "error" })
  })
})

describe("describeVoice", () => {
  test("names the hosted model, with the voice when one is set", () => {
    expect(describeVoice(ConfigSchema.parse({ voice: { speakModel: "openai/tts" } }))).toBe("openai/tts")
    expect(describeVoice(ConfigSchema.parse({ voice: { speakModel: "openai/tts", speakVoice: "onyx" } }))).toBe(
      "openai/tts (onyx)",
    )
  })

  test("names the local binary rather than the whole command line", () => {
    expect(describeVoice(ConfigSchema.parse({ voice: { synth: "piper --model v.onnx --output_file" } }))).toBe("piper")
  })
})
