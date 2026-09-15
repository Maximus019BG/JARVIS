// Bun-only, like credentials.ts: the web never imports this.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { dataDir } from "../config/paths.ts"
import { SAMPLE_RATE } from "./wake.ts"
import { EMBEDDING_DIMS } from "./speaker-models.ts"

export class SpeakerError extends Error {}

/**
 * 16-bit little-endian PCM as amplitude in `[-1, 1]`.
 *
 * **Not** the same conversion as `pcmToFloat` in wake.ts, which deliberately does not scale
 * because openWakeWord's front end wants raw sample values. This model wants amplitude, and
 * the two are a factor of 32768 apart. Measured rather than assumed: feeding it int16-range
 * values instead scores 0.974 against the correct answer — close enough to look like it works
 * and far enough to move a borderline voice across the threshold, which is the worst kind of
 * wrong for a gate.
 */
export function pcmToUnit(bytes: Uint8Array): Float32Array {
  const count = Math.floor(bytes.length / 2)
  const out = new Float32Array(count)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

/** Cosine similarity. `1` is the same direction, `0` unrelated, `-1` opposite. */
export function cosine(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array): number {
  if (a.length !== b.length) throw new SpeakerError(`embedding length mismatch: ${a.length} vs ${b.length}`)
  let dot = 0
  let left = 0
  let right = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    left += a[i]! * a[i]!
    right += b[i]! * b[i]!
  }
  const scale = Math.sqrt(left) * Math.sqrt(right)
  // Two zero vectors are not "identical", they are "nothing was said".
  return scale === 0 ? 0 : dot / scale
}

/**
 * The centroid of several embeddings, which is what an enrollment is.
 *
 * Averaging a few utterances rather than trusting one: a single sample carries whatever the
 * room, the microphone position and that particular sentence contributed, and the mean of
 * three is measurably closer to the next thing the same person says.
 */
export function centroid(embeddings: readonly (readonly number[])[]): number[] {
  if (embeddings.length === 0) throw new SpeakerError("no embeddings to average")
  const dims = embeddings[0]!.length
  const sum = new Array<number>(dims).fill(0)
  for (const embedding of embeddings) {
    if (embedding.length !== dims) throw new SpeakerError("embeddings differ in length")
    for (let i = 0; i < dims; i++) sum[i]! += embedding[i]!
  }
  return sum.map((value) => value / embeddings.length)
}

const SpeakerSchema = z.object({
  name: z.string(),
  embedding: z.array(z.number()),
  /** How many utterances the centroid was averaged from. */
  samples: z.number(),
  enrolledAt: z.number(),
})

const VoicesSchema = z.object({ version: z.literal(1), speakers: z.array(SpeakerSchema) })

export type Speaker = z.infer<typeof SpeakerSchema>
export type Voices = z.infer<typeof VoicesSchema>

/**
 * Deliberately not in the config file, and 0600.
 *
 * A voice embedding is not a password — it cannot be reversed into audio — but it is derived
 * from a person's body, it is stable for life, and a config file is a thing people commit.
 * It lives beside `credentials.json` for the same reasons and under the same permissions.
 */
export const voicesPath = join(dataDir, "voices.json")

export const NO_VOICES: Voices = { version: 1, speakers: [] }

export function loadVoices(path = voicesPath): Voices {
  if (!existsSync(path)) return NO_VOICES
  const parsed = VoicesSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
  if (!parsed.success) throw new SpeakerError(`${path} is not a valid voice store — delete it and enrol again`)
  return parsed.data
}

export function saveVoices(voices: Voices, path = voicesPath): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(voices, null, 2)}\n`, { mode: 0o600 })
  // Explicit chmod as well: writeFileSync's mode is masked by the umask, and an existing file
  // keeps the permissions it already had.
  chmodSync(path, 0o600)
}

/** Adds or replaces one speaker. Re-enrolling under the same name overwrites, by design. */
export function enroll(voices: Voices, name: string, embeddings: readonly (readonly number[])[]): Voices {
  const embedding = centroid(embeddings)
  if (embedding.length !== EMBEDDING_DIMS) {
    throw new SpeakerError(`expected a ${EMBEDDING_DIMS}-value embedding, got ${embedding.length}`)
  }
  return {
    ...voices,
    speakers: [
      ...voices.speakers.filter((speaker) => speaker.name !== name),
      { name, embedding, samples: embeddings.length, enrolledAt: Date.now() },
    ],
  }
}

export function forget(voices: Voices, name: string): { voices: Voices; removed: boolean } {
  const speakers = voices.speakers.filter((speaker) => speaker.name !== name)
  return { voices: { ...voices, speakers }, removed: speakers.length !== voices.speakers.length }
}

export type Match = { name: string; score: number }

/** Every enrolled speaker, scored against one utterance, best first. */
export function score(embedding: readonly number[], voices: Voices): Match[] {
  return voices.speakers
    .map((speaker) => ({ name: speaker.name, score: cosine(embedding, speaker.embedding) }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Who said it, or nobody.
 *
 * Returns the best match and whether it cleared the threshold, rather than just a boolean, so
 * a caller can say "that sounded 0.71 like you, and the bar is 0.86" — which is the only
 * message that lets somebody fix a threshold they set too high.
 */
export function identify(
  embedding: readonly number[],
  voices: Voices,
  threshold: number,
): { match?: Match; best?: Match } {
  const best = score(embedding, voices)[0]
  return { best, match: best && best.score >= threshold ? best : undefined }
}

/**
 * Shortest utterance worth scoring, in samples.
 *
 * Under about a second there is not enough voiced audio for the embedding to be about the
 * speaker rather than about the noise floor — and a gate that accepts a cough is not a gate.
 */
export const MIN_VERIFY_SAMPLES = SAMPLE_RATE

/**
 * Longest stretch fed to the model, in samples.
 *
 * Accuracy stops improving well before this and inference time does not: measured at roughly
 * 700 ms of CPU per 3 s of audio on a desktop, so an uncapped 30-second dictation would keep
 * somebody waiting on a Pi for no gain. The middle is taken rather than the start, because
 * the start is where the room noise before somebody begins speaking lives.
 */
export const MAX_VERIFY_SAMPLES = SAMPLE_RATE * 4

export function trimForVerify(samples: Float32Array): Float32Array {
  if (samples.length <= MAX_VERIFY_SAMPLES) return samples
  const start = Math.floor((samples.length - MAX_VERIFY_SAMPLES) / 2)
  return samples.subarray(start, start + MAX_VERIFY_SAMPLES)
}
