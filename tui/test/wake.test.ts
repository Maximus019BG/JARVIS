import { describe, expect, test } from "bun:test"
import {
  DEFAULT_WAKE,
  STREAMS,
  Window,
  detections,
  listenForWake,
  pcmToFloat,
  pickStream,
  scriptedWakeSource,
  type WakeScore,
} from "../src/voice/wake.ts"
import { DEFAULT_PHRASE, PHRASES, wakeModelPaths } from "../src/voice/wake-models.ts"

const only =
  (...installed: string[]) =>
  (bin: string) =>
    installed.includes(bin)

/** Collects an async generator, so the gate can be asserted against a list of numbers. */
async function drain(scores: readonly number[], settings = DEFAULT_WAKE): Promise<WakeScore[]> {
  const hits: WakeScore[] = []
  for await (const hit of detections(scriptedWakeSource(scores).scores(), settings)) hits.push(hit)
  return hits
}

describe("pickStream", () => {
  test("first on PATH wins, in the listed order", () => {
    expect(pickStream(only("ffmpeg", "sox"))?.[0]).toBe("sox")
    expect(pickStream(only("arecord", "sox"))?.[0]).toBe("arecord")
  })

  test("every command writes raw 16-bit mono PCM at 16 kHz to stdout", () => {
    for (const command of STREAMS) {
      expect(command.at(-1)).toBe("-")
      expect(command.join(" ")).toContain("16000")
    }
  })

  test("nothing installed is undefined rather than a throw", () => {
    expect(pickStream(() => false)).toBeUndefined()
    expect(pickStream(() => false, "  parec --rate=16000  ")).toEqual(["parec", "--rate=16000"])
  })
})

describe("detections", () => {
  // One chunk over the threshold happens for all sorts of things that are not the phrase.
  test("a single spike does not fire", async () => {
    expect(await drain([0.1, 0.9, 0.1, 0.2])).toEqual([])
  })

  test("two consecutive chunks over the threshold do", async () => {
    const hits = await drain([0.1, 0.9, 0.8, 0.1])
    expect(hits).toHaveLength(1)
    expect(hits[0]!.t).toBe(160)
  })

  test("the run has to be consecutive, not merely frequent", async () => {
    expect(await drain([0.9, 0.1, 0.9, 0.1, 0.9])).toEqual([])
  })

  // A real utterance scores high for most of a second. Without the refractory window this
  // fires ten times and starts ten recordings.
  test("one utterance wakes once", async () => {
    const hits = await drain(Array.from({ length: 20 }, () => 0.95))
    expect(hits).toHaveLength(1)
  })

  test("a second utterance after the window fires again", async () => {
    // 2000 ms of refractory is 25 chunks at 80 ms; 30 quiet ones clears it with room to spare.
    const hits = await drain([...Array(4).fill(0.95), ...Array(30).fill(0.01), ...Array(4).fill(0.95)])
    expect(hits).toHaveLength(2)
    expect(hits[1]!.t - hits[0]!.t).toBeGreaterThanOrEqual(DEFAULT_WAKE.refractoryMs)
  })

  // A score that stays high for over three seconds is not one "hey jarvis" — it is somebody
  // repeating themselves, or a detector stuck on. Re-arming once the window expires is what
  // the window means; suppressing forever would need a reason to ever listen again.
  // What must not happen is firing the *instant* it expires off a run counter that kept
  // climbing while suppressed: the run resets, so it costs `frames` fresh chunks either way.
  test("a continuously high stream re-arms after the window, and not before", async () => {
    const hits = await drain(Array.from({ length: 40 }, () => 0.95))
    expect(hits).toHaveLength(2)
    // The chunk that ends the window is itself the first of the new run, so it takes
    // `frames - 1` more after it — never a fire on the expiring chunk itself.
    const gap = hits[1]!.t - hits[0]!.t
    expect(gap).toBe(DEFAULT_WAKE.refractoryMs + (DEFAULT_WAKE.frames - 1) * 80)
  })

  test("the threshold is honoured", async () => {
    expect(await drain([0.6, 0.6], { ...DEFAULT_WAKE, threshold: 0.8 })).toEqual([])
    expect(await drain([0.6, 0.6], { ...DEFAULT_WAKE, threshold: 0.5 })).toHaveLength(1)
  })
})

describe("listenForWake", () => {
  test("a paused listener hears nothing, and resumes where it left off", async () => {
    const woken: number[] = []
    const listener = listenForWake({
      source: scriptedWakeSource([0.9, 0.9, 0.01, 0.01, 0.01]),
      onWake: () => woken.push(1),
    })
    listener.pause()
    expect(listener.paused).toBe(true)
    // Let the generator drain while paused.
    await Bun.sleep(20)
    expect(woken).toEqual([])
    listener.resume()
    expect(listener.paused).toBe(false)
    listener.close()
  })

  test("a hit reaches onWake", async () => {
    let woken = 0
    const listener = listenForWake({ source: scriptedWakeSource([0.01, 0.9, 0.9]), onWake: () => (woken += 1) })
    await Bun.sleep(20)
    expect(woken).toBe(1)
    listener.close()
  })

  // This runs behind a terminal doing something else; a broken worker says so once.
  test("a failing source is reported rather than thrown", async () => {
    const errors: string[] = []
    const listener = listenForWake({
      source: {
        // eslint-disable-next-line require-yield
        async *scores() {
          throw new Error("onnxruntime-node is not installed")
        },
        close() {},
      },
      onWake: () => {},
      onError: (message) => errors.push(message),
    })
    await Bun.sleep(20)
    expect(errors).toEqual(["onnxruntime-node is not installed"])
    listener.close()
  })
})

describe("Window", () => {
  test("emits nothing until it is full", () => {
    const window = new Window<number>(4, 2)
    expect(window.push(1, 2, 3)).toEqual([])
    expect(window.push(4)).toEqual([[1, 2, 3, 4]])
  })

  test("then emits every stride, sliding by one each time", () => {
    const window = new Window<number>(3, 2)
    window.push(1, 2, 3)
    expect(window.push(4)).toEqual([])
    expect(window.push(5)).toEqual([[3, 4, 5]])
  })

  // Eight mel frames arrive at once and the embedding stride is eight, so the steady state
  // has to be exactly one embedding per audio chunk. Anything else changes the score rate.
  test("pushing a full stride at a time emits once per push", () => {
    const window = new Window<number>(76, 8)
    let emitted = 0
    for (let chunk = 0; chunk < 20; chunk++) {
      emitted += window.push(...Array.from({ length: 8 }, (_, i) => chunk * 8 + i)).length
    }
    // 160 frames: the first window completes at 76, then one per 8 thereafter.
    expect(emitted).toBe(1 + Math.floor((160 - 76) / 8))
  })

  test("reset drops the history, so a resumed listener does not score across the gap", () => {
    const window = new Window<number>(2, 1)
    window.push(1, 2)
    window.reset()
    expect(window.push(3)).toEqual([])
    expect(window.push(4)).toEqual([[3, 4]])
  })
})

describe("pcmToFloat", () => {
  // openWakeWord's front end takes raw sample values, not normalised ones. Scaling here is
  // silent: the model runs and simply never hears anything.
  test("widens 16-bit little-endian samples without scaling them", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x18, 0xfc])
    expect(Array.from(pcmToFloat(bytes))).toEqual([0, 32767, -32768, -1000])
  })

  test("an odd trailing byte is dropped rather than read past the end", () => {
    expect(pcmToFloat(new Uint8Array([0x10, 0x27, 0x05])).length).toBe(1)
  })

  test("writes into a supplied buffer, for the per-chunk reuse the worker depends on", () => {
    const into = new Float32Array(2)
    expect(pcmToFloat(new Uint8Array([0x10, 0x27, 0xf0, 0xd8]), into)).toBe(into)
    expect(Array.from(into)).toEqual([10000, -10000])
  })
})

describe("wakeModelPaths", () => {
  test("a pretrained phrase resolves to its release filename", () => {
    expect(wakeModelPaths(DEFAULT_PHRASE).phrase).toContain(PHRASES[DEFAULT_PHRASE]!.file)
  })

  // The classifier is ~100 KB and trains in an afternoon, so a model of your own voice has to
  // be a config change rather than a fork.
  test("an unknown phrase is treated as a path to your own classifier", () => {
    expect(wakeModelPaths("/models/hey-boss.onnx").phrase).toBe("/models/hey-boss.onnx")
    expect(wakeModelPaths("hey-boss.onnx").phrase).toContain("hey-boss.onnx")
  })

  test("the two shared stages never depend on the phrase", () => {
    const a = wakeModelPaths("hey_jarvis")
    const b = wakeModelPaths("alexa")
    expect(a.melspectrogram).toBe(b.melspectrogram)
    expect(a.embedding).toBe(b.embedding)
  })
})
