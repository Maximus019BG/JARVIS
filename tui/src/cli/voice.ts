import { createInterface } from "node:readline/promises"
import type { Config } from "../config/config.ts"
import { embedder } from "../voice/embedder.ts"
import { fetchSpeakerModel, speakerModelMissing, speakerModelPath } from "../voice/speaker-models.ts"
import {
  MIN_VERIFY_SAMPLES,
  SpeakerError,
  cosine,
  enroll,
  forget,
  loadVoices,
  saveVoices,
  score,
  voicesPath,
} from "../voice/speaker.ts"
import { SAMPLE_RATE, pickStream } from "../voice/wake.ts"

const say = (line = ""): void => void process.stdout.write(`${line}\n`)

/** Samples taken per enrolment. Three is where averaging stops paying for itself. */
const ENROL_SAMPLES = 3
const CLIP_SECONDS = 4

async function press(question: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await rl.question(question)
  } finally {
    rl.close()
  }
}

/**
 * Records raw PCM for a fixed stretch.
 *
 * A wall-clock timer rather than counting bytes: a capture binary that is buffering, or a
 * sound card running slightly off nominal, would make a byte count wait forever for a sample
 * that is not coming.
 */
async function record(config: Config, seconds: number): Promise<Uint8Array> {
  const command = pickStream((bin) => Bun.which(bin) !== null, config.voice?.capture)
  if (!command) throw new SpeakerError("no audio capture binary on PATH — install alsa-utils (arecord), sox or ffmpeg")

  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "ignore" })
  const chunks: Uint8Array[] = []
  const reader = child.stdout.getReader()
  const deadline = Date.now() + seconds * 1000
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
    child.kill("SIGINT")
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const pcm = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  if (pcm.length / 2 < MIN_VERIFY_SAMPLES) {
    throw new SpeakerError(`heard only ${(pcm.length / 2 / SAMPLE_RATE).toFixed(1)}s — is the microphone working?`)
  }
  return pcm
}

/** `0.91  ✓ above the 0.86 threshold` — the line that makes a threshold tunable. */
const verdict = (value: number, threshold: number) =>
  `${value.toFixed(2)}  ${value >= threshold ? "✓" : " "}`

export type VoiceOptions = { config: Config; action?: string; name?: string }

export async function runVoice({ config, action, name }: VoiceOptions): Promise<void> {
  const threshold = config.voice?.speaker?.threshold ?? 0.86

  if (action === "models") {
    const { fetched, error } = await fetchSpeakerModel(say)
    if (error) {
      process.stderr.write(`error: ${error}\n`)
      process.exitCode = 1
      return
    }
    say(fetched ? "the speaker model is ready" : "the speaker model is already present")
    say(`  ${speakerModelPath()}`)
    return
  }

  if (action === "list") {
    const { speakers } = loadVoices()
    if (speakers.length === 0) return say("nobody is enrolled — `jarvis voice enrol <name>`")
    say(`enrolled voices (${voicesPath}):`)
    for (const speaker of speakers) {
      const when = new Date(speaker.enrolledAt).toISOString().slice(0, 10)
      say(`  ${speaker.name.padEnd(16)} ${speaker.samples} samples, ${when}`)
    }
    return
  }

  if (action === "forget") {
    if (!name) throw new SpeakerError("which voice? `jarvis voice forget <name>`")
    const { voices, removed } = forget(loadVoices(), name)
    if (!removed) return say(`nobody called "${name}" is enrolled`)
    saveVoices(voices)
    return say(`forgot "${name}"`)
  }

  if (action !== "enrol" && action !== "enroll" && action !== "test") {
    say("usage: jarvis voice <models|enrol NAME|test|list|forget NAME>")
    return
  }

  if (speakerModelMissing(config.voice?.speaker?.model)) {
    throw new SpeakerError("the speaker model is not downloaded — run `jarvis voice models` first")
  }
  const engine = embedder(config)

  try {
    if (action === "test") {
      const voices = loadVoices()
      if (voices.speakers.length === 0) return say("nobody is enrolled — `jarvis voice enrol <name>` first")
      await press(`Say something for ${CLIP_SECONDS} seconds. Press enter to start. `)
      const embedding = await engine.embed(await record(config, CLIP_SECONDS))
      say()
      for (const match of score(embedding, voices)) {
        say(`  ${match.name.padEnd(16)} ${verdict(match.score, threshold)}`)
      }
      say()
      say(`the threshold is ${threshold} — set voice.speaker.threshold to move it`)
      return
    }

    if (!name) throw new SpeakerError("who is this? `jarvis voice enrol <name>`")
    say(`Enrolling "${name}". ${ENROL_SAMPLES} clips of ${CLIP_SECONDS} seconds each.`)
    say("Say something different each time, in the voice and the room you will actually use.")
    say()
    const embeddings: number[][] = []
    for (let i = 1; i <= ENROL_SAMPLES; i++) {
      await press(`  ${i}/${ENROL_SAMPLES}  press enter, then speak… `)
      embeddings.push(await engine.embed(await record(config, CLIP_SECONDS)))
    }

    const voices = enroll(loadVoices(), name, embeddings)
    saveVoices(voices)
    say()
    say(`enrolled "${name}" from ${embeddings.length} samples → ${voicesPath}`)

    // The number that says whether enrolment actually worked. Samples of one person that do
    // not agree with each other will not agree with them tomorrow either, and finding that
    // out now beats finding it out when the gate stops opening.
    const pairs: number[] = []
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) pairs.push(cosine(embeddings[i]!, embeddings[j]!))
    }
    const agreement = pairs.reduce((sum, value) => sum + value, 0) / pairs.length
    say(`  your samples agree with each other at ${agreement.toFixed(2)}; the threshold is ${threshold}`)
    if (agreement < threshold) {
      say("  that is below the threshold, so this will reject you — re-enrol somewhere quieter,")
      say("  or lower voice.speaker.threshold to suit the room.")
    }
    say()
    say("set voice.speaker.enabled to true to start using it")
  } finally {
    engine.close()
  }
}
