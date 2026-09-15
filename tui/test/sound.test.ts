import { describe, expect, test } from "bun:test"
import { PLAYERS, pickPlayer, synth } from "../src/ui/sound.ts"

const only = (...installed: string[]) => (bin: string) => installed.includes(bin)

describe("pickPlayer", () => {
  test("first on PATH wins, in the listed order", () => {
    expect(pickPlayer(only("play", "aplay"))).toEqual(PLAYERS.find((command) => command[0] === "aplay")!)
  })

  test("nothing installed is undefined, not a throw — silence is a valid outcome", () => {
    expect(pickPlayer(() => false)).toBeUndefined()
  })

  // Same contract as `voice.recorder`: someone who set it knows something the probe does not.
  test("an override is taken at its word, and split into argv", () => {
    expect(pickPlayer(only("aplay"), "  mpv --no-video  ")).toEqual(["mpv", "--no-video"])
    expect(pickPlayer(() => false, "  ")).toBeUndefined()
  })
})

describe("synth", () => {
  const SAMPLE_RATE = 22_050
  const wav = synth([[880, 100]])
  const view = new DataView(wav.buffer)
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

  test("writes a 16-bit mono PCM header a player will accept", () => {
    expect(ascii(0, 4)).toBe("RIFF")
    expect(ascii(8, 8)).toBe("WAVEfmt ")
    expect(ascii(36, 4)).toBe("data")
    expect(view.getUint16(20, true)).toBe(1) // uncompressed
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
  })

  test("the declared data length matches the bytes actually written", () => {
    const samples = Math.round(SAMPLE_RATE * 0.1)
    expect(view.getUint32(40, true)).toBe(samples * 2)
    expect(wav.length).toBe(44 + samples * 2)
    expect(view.getUint32(4, true)).toBe(36 + samples * 2)
  })

  // The envelope is the whole reason this is not four lines: a sine that starts at full
  // amplitude puts a step in the waveform, and the click is louder than the tone.
  test("fades in and out, so neither edge starts at full amplitude", () => {
    const first = Math.abs(view.getInt16(44, true))
    const last = Math.abs(view.getInt16(wav.length - 2, true))
    const peak = Math.max(
      ...Array.from({ length: 200 }, (_, i) => Math.abs(view.getInt16(44 + (1000 + i) * 2, true))),
    )
    expect(first).toBe(0)
    expect(last).toBeLessThan(peak)
    expect(peak).toBeGreaterThan(0)
  })

  test("stays inside int16 even when asked for more amplitude than exists", () => {
    const loud = synth([[440, 20]], 4)
    const loudView = new DataView(loud.buffer)
    for (let i = 44; i < loud.length; i += 2) {
      expect(Math.abs(loudView.getInt16(i, true))).toBeLessThanOrEqual(0x7fff)
    }
  })
})
