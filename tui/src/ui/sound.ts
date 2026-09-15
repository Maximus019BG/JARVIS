import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Config } from "../config/config.ts"
import { encodeWav, floatToPcm } from "../voice/wav.ts"

/**
 * Three sounds, and deliberately only three: acknowledged, you-are-needed, failed. A
 * vocabulary you can learn without being told is one you never have to look up, and a
 * fourth sound is the point at which nobody can tell them apart any more.
 */
export type Earcon = "ack" | "attention" | "fail"

/**
 * Playback commands, best first, each taking the wav path as its last argument — the same
 * contract as `RECORDERS` in voice.ts, and for the same reason: capturing or emitting audio
 * from JS means a native module, which means a build step on a Raspberry Pi, to do what one
 * of these is already doing on every machine that has a working sound card.
 *
 * POSIX only, like `install.sh`. On a machine where none of these exist, `sound.player` is
 * the escape hatch and silence is the fallback — a missing beep is not worth an error.
 */
export const PLAYERS: readonly (readonly string[])[] = [
  ["afplay"],
  ["paplay"],
  ["aplay", "-q"],
  ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"],
  // sox's playback alias, and last on purpose: `play` is a common enough name that finding
  // one on PATH is weaker evidence of a working audio path than finding any of the above.
  ["play", "-q"],
]

/**
 * The playback command to run, or `undefined` when nothing usable is installed. The probe is
 * injected so the choice stays a pure function — which of these wins is the only part of
 * this file worth a test, and it is not worth a test that needs a speaker.
 */
export function pickPlayer(has: (bin: string) => boolean, override?: string): readonly string[] | undefined {
  if (override?.trim()) return override.trim().split(/\s+/)
  return PLAYERS.find((command) => has(command[0]!))
}

const SAMPLE_RATE = 22_050

/** A tone, as `[hz, milliseconds]` pairs played back to back. */
const SHAPES: Record<Earcon, readonly (readonly [number, number])[]> = {
  // One clipped blip. Short enough to read as punctuation rather than as an announcement.
  ack: [[880, 70]],
  // Rising, because a question rises. This is the only one that asks for a human.
  attention: [
    [660, 90],
    [990, 110],
  ],
  // Falling, and slower. Nothing else here needs to sound like bad news.
  fail: [
    [660, 110],
    [440, 150],
  ],
}

/**
 * A 16-bit mono PCM wav of the given tones, built in memory.
 *
 * Generated rather than shipped: three checked-in wav files would be three binary blobs in a
 * repository of text, needing a licence note and a way to regenerate them, to encode less
 * information than the table above.
 */
export function synth(shape: readonly (readonly [number, number])[], amplitude = 0.22): Uint8Array {
  const samples: number[] = []
  for (const [hz, ms] of shape) {
    const count = Math.round((SAMPLE_RATE * ms) / 1000)
    // A 4 ms attack and release. Starting or stopping a sine at full amplitude puts a step
    // in the waveform, and a step is a click — which is louder than the tone it bookends.
    const ramp = Math.min(Math.round(SAMPLE_RATE * 0.004), Math.floor(count / 2))
    for (let i = 0; i < count; i++) {
      const envelope = ramp === 0 ? 1 : Math.min(1, i / ramp, (count - i) / ramp)
      samples.push(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amplitude * envelope)
    }
  }
  return encodeWav(floatToPcm(samples), SAMPLE_RATE)
}

/**
 * Written once per process — the same three files, played over and over.
 *
 * Synchronous, unlike voice.ts's temp file, because the only place these can be cleaned up
 * is a `process.on("exit")` handler and an exit handler cannot await. Five kilobytes of
 * generated PCM is not worth an async path that leaves files behind.
 */
const cache = new Map<Earcon, string>()

function wavPath(earcon: Earcon): string {
  const existing = cache.get(earcon)
  if (existing) return existing
  const file = join(tmpdir(), `jarvis-earcon-${process.pid}-${earcon}.wav`)
  writeFileSync(file, synth(SHAPES[earcon]))
  cache.set(earcon, file)
  return file
}

/** Removes the generated wavs. Registered by the caller on exit; safe to call twice. */
export function cleanupSounds(): void {
  for (const file of cache.values()) rmSync(file, { force: true })
  cache.clear()
}

/**
 * Plays an earcon, if sound is on and something can play it. Fire and forget by design:
 * nothing in a turn should ever wait on a beep, and a machine with no audio device should
 * not learn about it through an error in the transcript.
 */
export function play(config: Config, earcon: Earcon): void {
  if (!config.sound?.earcons) return
  try {
    const command = pickPlayer((bin) => Bun.which(bin) !== null, config.sound?.player)
    if (!command) return
    Bun.spawn([...command, wavPath(earcon)], { stdout: "ignore", stderr: "ignore" })
  } catch {
    // Silence is the correct failure mode for a sound.
  }
}
