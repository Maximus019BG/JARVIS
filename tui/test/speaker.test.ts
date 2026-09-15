import { describe, expect, test } from "bun:test"
import { mkdtempSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigSchema } from "../src/config/config.ts"
import { capPcm, embedder } from "../src/voice/embedder.ts"
import { EMBEDDING_DIMS } from "../src/voice/speaker-models.ts"
import {
  MAX_VERIFY_SAMPLES,
  NO_VOICES,
  SpeakerError,
  centroid,
  cosine,
  enroll,
  forget,
  identify,
  loadVoices,
  pcmToUnit,
  saveVoices,
  score,
  trimForVerify,
  type Voices,
} from "../src/voice/speaker.ts"

const scratch = () => mkdtempSync(join(tmpdir(), "jarvis-speaker-"))
const vector = (fill: number) => new Array<number>(EMBEDDING_DIMS).fill(fill)

describe("pcmToUnit", () => {
  // The one number in this file that matters. openWakeWord wants raw int16 values and this
  // model wants amplitude; feeding it the wrong one scores 0.974 against the right answer,
  // which is close enough to look like it works and far enough to move a borderline voice
  // across the threshold.
  test("scales int16 to amplitude, unlike the wake word's conversion", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x40, 0x00, 0xc0])
    expect(Array.from(pcmToUnit(bytes))).toEqual([0, 0.5, -0.5])
  })

  test("an odd trailing byte is dropped rather than read past the end", () => {
    expect(pcmToUnit(new Uint8Array([0x10, 0x27, 0x05])).length).toBe(1)
  })
})

describe("cosine", () => {
  test("identical, orthogonal and opposite", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  test("magnitude does not matter, direction does", () => {
    expect(cosine([3, 4], [30, 40])).toBeCloseTo(1)
  })

  // Two zero vectors are not "identical", they are "nothing was said" — and returning 1 here
  // would let silence match an enrolled speaker perfectly.
  test("a zero vector scores zero, never one", () => {
    expect(cosine([0, 0], [0, 0])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })

  test("mismatched lengths are an error, not a silent truncation", () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(SpeakerError)
  })
})

describe("centroid", () => {
  test("averages component-wise", () => {
    expect(centroid([[1, 5], [3, 7]])).toEqual([2, 6])
  })

  test("refuses an empty set or ragged lengths", () => {
    expect(() => centroid([])).toThrow(SpeakerError)
    expect(() => centroid([[1, 2], [1]])).toThrow(SpeakerError)
  })
})

describe("the voice store", () => {
  test("enrolling, re-enrolling and forgetting", () => {
    let voices: Voices = NO_VOICES
    voices = enroll(voices, "Maximus", [vector(1), vector(3)])
    expect(voices.speakers).toHaveLength(1)
    expect(voices.speakers[0]!.samples).toBe(2)
    expect(voices.speakers[0]!.embedding[0]).toBe(2)

    // Re-enrolling replaces rather than appends: two entries for one person would both be
    // scored, and the stale one would keep matching after a deliberate re-enrolment.
    voices = enroll(voices, "Maximus", [vector(5)])
    expect(voices.speakers).toHaveLength(1)
    expect(voices.speakers[0]!.embedding[0]).toBe(5)

    voices = enroll(voices, "Ada", [vector(-1)])
    expect(forget(voices, "nobody").removed).toBe(false)
    const gone = forget(voices, "Maximus")
    expect(gone.removed).toBe(true)
    expect(gone.voices.speakers.map((speaker) => speaker.name)).toEqual(["Ada"])
  })

  test("an embedding of the wrong width is refused at enrolment, not at the gate", () => {
    expect(() => enroll(NO_VOICES, "Maximus", [[1, 2, 3]])).toThrow(/512-value embedding/)
  })

  test("round-trips through disk, and the file is not world-readable", () => {
    const path = join(scratch(), "voices.json")
    saveVoices(enroll(NO_VOICES, "Maximus", [vector(1)]), path)
    expect(loadVoices(path).speakers[0]!.name).toBe("Maximus")
    // A voice embedding is derived from somebody's body and is stable for life. 0600, like
    // the device token. (Windows does not implement POSIX modes, so only assert where it can.)
    if (process.platform !== "win32") expect(statSync(path).mode & 0o077).toBe(0)
  })

  test("a missing store is empty; a corrupt one is an error rather than an empty one", () => {
    const dir = scratch()
    expect(loadVoices(join(dir, "absent.json")).speakers).toEqual([])
    const broken = join(dir, "broken.json")
    writeFileSync(broken, '{"version":1,"speakers":"nope"}')
    expect(() => loadVoices(broken)).toThrow(/not a valid voice store/)
  })
})

describe("identify", () => {
  // Built directly rather than through `enroll`, which rightly refuses anything that is not
  // 512 wide. What is under test here is the scoring, and three dimensions are easier to read.
  const speaker = (name: string, embedding: number[]) => ({ name, embedding, samples: 1, enrolledAt: 0 })
  const voices: Voices = {
    version: 1,
    speakers: [speaker("Maximus", [1, 0, 0]), speaker("Ada", [0, 1, 0])],
  }

  test("scores everyone, best first", () => {
    expect(score([1, 0.2, 0], voices).map((match) => match.name)).toEqual(["Maximus", "Ada"])
  })

  test("clearing the threshold is a match; missing it is a best guess and no match", () => {
    expect(identify([1, 0, 0], voices, 0.86).match?.name).toBe("Maximus")
    const near = identify([1, 0.9, 0], voices, 0.86)
    expect(near.match).toBeUndefined()
    // The best guess still comes back, so the refusal can name the score and the bar — a
    // threshold set too high is otherwise indistinguishable from a broken microphone.
    expect(near.best?.name).toBe("Maximus")
    expect(near.best!.score).toBeLessThan(0.86)
  })

  test("nobody enrolled matches nobody, rather than matching everybody", () => {
    expect(identify([1, 0, 0], NO_VOICES, 0).match).toBeUndefined()
    expect(identify([1, 0, 0], NO_VOICES, 0).best).toBeUndefined()
  })
})

describe("trimming", () => {
  test("short clips pass through untouched", () => {
    const short = new Float32Array(1000)
    expect(trimForVerify(short)).toBe(short)
    const bytes = new Uint8Array(2000)
    expect(capPcm(bytes)).toBe(bytes)
  })

  test("long clips are cut from the middle, where the speech is", () => {
    const long = new Float32Array(MAX_VERIFY_SAMPLES * 3)
    expect(trimForVerify(long).length).toBe(MAX_VERIFY_SAMPLES)
    expect(capPcm(new Uint8Array(MAX_VERIFY_SAMPLES * 6)).length).toBe(MAX_VERIFY_SAMPLES * 2)
  })

  // An odd offset splits a sample in half and shifts every value after it, which sounds like
  // white noise to the model and scores like a stranger.
  test("the byte cut always lands on a sample boundary", () => {
    for (const extra of [1, 2, 3, 7]) {
      const pcm = new Uint8Array(MAX_VERIFY_SAMPLES * 2 + extra)
      pcm.forEach((_, i) => (pcm[i] = i % 251))
      const capped = capPcm(pcm)
      expect(capped.length % 2).toBe(0)
      expect(capped.byteOffset % 2).toBe(0)
    }
  })
})

describe("the embedder protocol", () => {
  /** A worker that answers the real protocol without the real model. */
  function stub(body: string): string {
    const path = join(scratch(), "stub-worker.ts")
    writeFileSync(
      path,
      `const emit = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\\n")
       emit({ ready: true })
       let buffer = ""
       for await (const chunk of process.stdin) {
         buffer += new TextDecoder().decode(chunk as Uint8Array)
         let nl = buffer.indexOf("\\n")
         while (nl >= 0) {
           const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); nl = buffer.indexOf("\\n")
           if (!line.trim()) continue
           const request = JSON.parse(line) as { id: number; pcm: string }
           ${body}
         }
       }`,
    )
    return path
  }

  const config = ConfigSchema.parse({ voice: { speaker: { enabled: true, model: "stub.onnx" } } })
  /** `speakerModelMissing` guards the constructor, so the stub needs a file to point at. */
  function withModel(): typeof config {
    const dir = scratch()
    const model = join(dir, "stub.onnx")
    writeFileSync(model, "not really a model")
    return ConfigSchema.parse({ voice: { speaker: { enabled: true, model } } })
  }

  test("requests and replies are matched by id, not by arrival order", async () => {
    // Answers the second request first, which is exactly what a real worker under load does.
    const worker = embedder(withModel(), {
      script: stub(`
        if (request.id === 1) setTimeout(() => emit({ id: 1, embedding: [1, 1] }), 40)
        else emit({ id: request.id, embedding: [2, 2] })
      `),
    })
    try {
      const [first, second] = await Promise.all([worker.embed(pcm(2)), worker.embed(pcm(2))])
      expect(first).toEqual([1, 1])
      expect(second).toEqual([2, 2])
    } finally {
      worker.close()
    }
  })

  test("a per-request error rejects only that request", async () => {
    const worker = embedder(withModel(), {
      script: stub(`emit({ id: request.id, error: "the model fell over" })`),
    })
    try {
      await expect(worker.embed(pcm(2))).rejects.toThrow(/the model fell over/)
    } finally {
      worker.close()
    }
  })

  // A failure with no id is the worker refusing to start — a missing runtime, a missing
  // model. Everyone waiting is waiting for something that will never come.
  test("a startup failure rejects every request in flight", async () => {
    const path = join(scratch(), "dead-worker.ts")
    writeFileSync(path, `process.stdout.write(JSON.stringify({ error: "onnxruntime-node is not installed" }) + "\\n")`)
    const worker = embedder(withModel(), { script: path })
    try {
      await expect(worker.embed(pcm(2))).rejects.toThrow(/onnxruntime-node is not installed/)
    } finally {
      worker.close()
    }
  })

  // The gate's whole job is refusing when it does not know. A cough is not an utterance.
  test("a clip too short to score is refused before it reaches the worker", async () => {
    const worker = embedder(withModel(), { script: stub(`emit({ id: request.id, embedding: [1] })`) })
    try {
      await expect(worker.embed(pcm(0.2))).rejects.toThrow(/too short/)
    } finally {
      worker.close()
    }
  })

  test("the constructor refuses when the model has not been downloaded", () => {
    expect(() => embedder(ConfigSchema.parse({ voice: { speaker: { enabled: true, model: "absent.onnx" } } }))).toThrow(
      /not downloaded/,
    )
  })
})

/** `seconds` of silent 16 kHz PCM, enough to clear the minimum-length check. */
function pcm(seconds: number): Uint8Array {
  return new Uint8Array(Math.round(16_000 * seconds) * 2)
}
