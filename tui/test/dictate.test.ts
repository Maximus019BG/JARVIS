import { describe, expect, test } from "bun:test"
import type { TranscriptionStreamPart } from "ai"
import { DictationError, Transcript, canStream, dictate } from "../src/voice/dictate.ts"
import { ConfigSchema } from "../src/config/config.ts"
import { WAV_HEADER_BYTES, encodeWav, floatToPcm } from "../src/voice/wav.ts"
import { tail } from "../src/ui/components/dialog.tsx"

const delta = (text: string): TranscriptionStreamPart => ({ type: "transcript-delta", delta: text })
const partial = (text: string): TranscriptionStreamPart => ({ type: "transcript-partial", text })
const final = (text: string): TranscriptionStreamPart => ({ type: "transcript-final", text })

const say = (...parts: TranscriptionStreamPart[]) => {
  const transcript = new Transcript()
  for (const part of parts) transcript.apply(part)
  return transcript.text
}

describe("canStream", () => {
  // A capability question, not a configuration one — asked of the model so a provider that
  // gains streaming later gets it here without a list to update.
  test("is decided by the model, not by the provider's name", () => {
    expect(canStream({ doStream: () => {} } as never)).toBe(true)
    expect(canStream({ doGenerate: () => {} } as never)).toBe(false)
    expect(canStream("openai/whisper-1")).toBe(false)
  })
})

describe("Transcript", () => {
  test("deltas append", () => {
    expect(say(delta("turn on "), delta("the soldering "), delta("lamp"))).toBe("turn on the soldering lamp")
  })

  // The distinction the whole class exists for: a partial is a guess, and replacing the guess
  // must not touch the sentence already committed behind it.
  test("a partial replaces the guess and never what was finalized", () => {
    expect(say(final("Turn on the lamp."), partial("wat"), partial("what time"))).toBe(
      "Turn on the lamp. what time",
    )
  })

  test("a final commits the guess in front of it", () => {
    expect(say(delta("hello wor"), final("Hello, world."), delta(" And"))).toBe("Hello, world. And")
  })

  test("providers that mix all three still read as one sentence", () => {
    expect(say(delta("check the"), partial("check the build"), final("Check the build."), partial("is it"))).toBe(
      "Check the build. is it",
    )
  })

  test("segments are joined with exactly one space, however they are spaced", () => {
    expect(say(final("One. "), final("  Two."))).toBe("One. Two.")
    expect(say(final(""), final("Only this"))).toBe("Only this")
  })

  test("raw and error parts carry no text and change nothing", () => {
    expect(say(final("Steady."), { type: "raw", rawValue: {} }, { type: "error", error: new Error("x") })).toBe(
      "Steady.",
    )
  })

  test("nothing heard is an empty string, not whitespace", () => {
    expect(new Transcript().text).toBe("")
    expect(say(partial("   "))).toBe("")
  })
})

describe("dictate", () => {
  test("refuses before opening the microphone when nothing is configured", async () => {
    await expect(dictate(ConfigSchema.parse({}))).rejects.toThrow(/voice is off/)
  })

  // `pickStream` takes an override at its word, so a typo in `voice.capture` gets as far as
  // the spawn. It must arrive as ours, naming the command, rather than as a bare
  // "Executable not found in $PATH" from the runtime.
  test("a capture override that does not exist is reported by name", async () => {
    const config = ConfigSchema.parse({
      voice: { model: "fake/whisper-1", capture: "jarvis-no-such-recorder" },
      provider: { fake: { npm: "@ai-sdk/openai", models: { "whisper-1": {} } } },
    })
    await expect(dictate(config)).rejects.toThrow(DictationError)
    await expect(dictate(config)).rejects.toThrow(/could not start jarvis-no-such-recorder/)
  })

  // Worth pinning, because it decides which path every OpenAI user takes: the SDK's
  // transcription model implements `doStream` for every model id, including `whisper-1`,
  // whose API does not actually support it. Streaming is therefore attempted and the
  // buffered wav fallback is what catches it — not an edge case, the common case.
  test("the openai transcription model advertises streaming, whichever model id it is", async () => {
    const { resolveTranscription } = await import("../src/agent/provider.ts")
    const config = ConfigSchema.parse({ provider: { fake: { npm: "@ai-sdk/openai", models: { "whisper-1": {} } } } })
    expect(canStream(await resolveTranscription(config, "fake/whisper-1"))).toBe(true)
  })
})

describe("encodeWav", () => {
  const pcm = floatToPcm([0, 0.5, -0.5, 1])
  const wav = encodeWav(pcm, 16_000)
  const view = new DataView(wav.buffer)
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

  test("writes a header a player and a transcription endpoint will both accept", () => {
    expect(ascii(0, 4)).toBe("RIFF")
    expect(ascii(8, 8)).toBe("WAVEfmt ")
    expect(ascii(36, 4)).toBe("data")
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  test("the declared lengths match the bytes actually written", () => {
    expect(view.getUint32(40, true)).toBe(pcm.length)
    expect(view.getUint32(4, true)).toBe(36 + pcm.length)
    expect(wav.length).toBe(WAV_HEADER_BYTES + pcm.length)
  })

  test("the PCM survives the round trip, clamped rather than wrapped", () => {
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(0)
    expect(view.getInt16(WAV_HEADER_BYTES + 6, true)).toBe(0x7fff)
    // Wrapping instead of clamping is the difference between "too loud" and "broken".
    const loud = new DataView(encodeWav(floatToPcm([4, -4]), 16_000).buffer)
    expect(loud.getInt16(WAV_HEADER_BYTES, true)).toBe(0x7fff)
    expect(loud.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-0x7fff)
  })
})

describe("tail", () => {
  // A live transcript grows at the end, so clipping from the right would pin the opening
  // words on screen and hide every word as it arrived.
  test("keeps the end of text that is still being written", () => {
    expect(tail("turn on the soldering lamp", 12)).toBe("…dering lamp")
    expect(tail("short", 12)).toBe("short")
  })

  test("never exceeds the width it was given", () => {
    for (const max of [4, 8, 20]) expect(tail("a".repeat(60), max).length).toBe(max)
  })
})
