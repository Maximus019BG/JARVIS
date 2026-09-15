// Exported under the `experimental_` name only, and aliased here so the call sites read
// plainly. The SDK's own docs call it `streamTranscribe`; the export has not caught up.
import {
  transcribe,
  experimental_streamTranscribe as streamTranscribe,
  type TranscriptionModel,
  type TranscriptionStreamPart,
} from "ai"
import { resolveTranscription } from "../agent/provider.ts"
import type { Config } from "../config/config.ts"
import { SAMPLE_RATE, pickStream } from "./wake.ts"
import { encodeWav } from "./wav.ts"

export class DictationError extends Error {}

/** How long a stopped session waits for the provider to close its side before giving up. */
const FINISH_TIMEOUT_MS = 5000

/**
 * Whether a resolved transcription model can stream.
 *
 * `doStream` is optional on the provider interface — Deepgram and OpenAI's `gpt-4o-transcribe`
 * implement it, `whisper-1` does not — so this is a capability question, not a configuration
 * one. Asking the model rather than keeping a list of which providers can do what means a
 * provider that gains streaming next month gets it here for free.
 */
export function canStream(model: TranscriptionModel): boolean {
  return typeof model === "object" && model !== null && typeof (model as { doStream?: unknown }).doStream === "function"
}

/**
 * The text so far, assembled from the three kinds of part a provider may send.
 *
 * They disagree about how to say the same thing: some emit `transcript-delta` to append,
 * some `transcript-partial` to replace an unfinalized guess, and both then send
 * `transcript-final` to commit a segment. Keeping the committed and pending halves apart is
 * what lets all three coexist — a partial replaces only the guess, never the sentence you
 * already said.
 */
export class Transcript {
  private committed = ""
  private pending = ""

  apply(part: TranscriptionStreamPart): void {
    switch (part.type) {
      case "transcript-delta":
        this.pending += part.delta
        break
      case "transcript-partial":
        this.pending = part.text
        break
      case "transcript-final":
        this.committed = join(this.committed, part.text)
        this.pending = ""
        break
      default:
        // `raw` and `error` carry no text. Errors surface through the stream's own failure.
        break
    }
  }

  /** Everything heard so far, including the guess that has not been finalized yet. */
  get text(): string {
    return join(this.committed, this.pending).trim()
  }
}

/** Joins two fragments with exactly one space, and none at all when either is empty. */
function join(left: string, right: string): string {
  if (!left.trim()) return right
  if (!right.trim()) return left
  return `${left.replace(/\s+$/, "")} ${right.replace(/^\s+/, "")}`
}

/**
 * What a finished recording produced.
 *
 * `pcm` is present only on the streaming path, which is the only one that captures raw
 * 16 kHz mono audio. Speaker identification needs exactly that, and the wav-file path's rate
 * and channel count are whatever the recorder felt like — so its absence is meaningful, not
 * an omission, and the gate treats it as "cannot verify" rather than as "verified".
 */
export type Heard = { text: string; pcm?: Uint8Array }

export type Dictation = {
  /** Stops recording and resolves with everything that was said. */
  stop: () => Promise<Heard>
  /** Stops recording and throws the audio away. */
  cancel: () => Promise<void>
}

/**
 * Live dictation: text appears as you speak rather than after you stop.
 *
 * Capture is the same raw 16 kHz PCM tap the wake word uses, which is what makes this
 * possible at all — the push-to-talk path writes a wav file and cannot be read until the
 * recorder has closed it.
 *
 * Every chunk goes two places: into the provider's stream, and into a buffer. The buffer is
 * not belt and braces, it is the fallback path — a streaming transcription that fails
 * halfway through has still heard the whole sentence, and losing somebody's dictation
 * because a websocket dropped is worse than paying for one more request.
 */
export async function dictate(
  config: Config,
  options: { onText?: (text: string) => void } = {},
): Promise<Dictation> {
  const id = config.voice?.model
  if (!id) throw new DictationError('voice is off — set voice.model in the config, e.g. "openai/whisper-1"')

  // `voice.capture`, never `voice.recorder`: the two overrides answer different questions.
  // `recorder` names a command that writes a wav *file*, and handing that to a caller
  // expecting raw PCM on stdout produces a command that runs and returns nothing usable.
  const command = pickStream((bin) => Bun.which(bin) !== null, config.voice?.capture)
  if (!command) {
    throw new DictationError("no audio capture binary on PATH — install alsa-utils (arecord), sox or ffmpeg")
  }

  // Resolved before the first byte is recorded: a missing API key should say so instead of
  // letting someone talk for thirty seconds first.
  const model = await resolveTranscription(config, id)
  if (!canStream(model)) throw new DictationError(`${id} cannot stream — falling back to push-to-talk`)

  let child: Bun.Subprocess<"ignore", "pipe", "ignore">
  try {
    child = Bun.spawn([...command], { stdout: "pipe", stderr: "ignore" })
  } catch (error) {
    // An override is taken at its word by `pickStream`, so a typo in `voice.capture` reaches
    // this far and would otherwise surface as a bare "Executable not found in $PATH".
    throw new DictationError(`could not start ${command[0]}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const captured: Uint8Array[] = []
  const transcript = new Transcript()
  let streamFailed = false
  let stopped = false

  // Our own stream rather than handing over `child.stdout`, so that stopping is a matter of
  // closing it rather than of killing a process and hoping the reader notices.
  let close: () => void = () => {}
  const audio = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => {
        try {
          controller.close()
        } catch {
          // Already closed by the pump below; closing twice is not an error worth raising.
        }
      }
      void (async () => {
        const reader = child.stdout.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done || stopped) break
            captured.push(value)
            controller.enqueue(value)
          }
        } catch {
          // The recorder died. The captured buffer is still good, which is the point of it.
        } finally {
          reader.releaseLock()
          close()
        }
      })()
    },
  })

  const result = streamTranscribe({
    model,
    audio,
    inputAudioFormat: { type: "audio/pcm", rate: SAMPLE_RATE },
  })

  const consumed = (async () => {
    try {
      for await (const part of result.fullStream) {
        transcript.apply(part)
        if (part.type !== "raw" && part.type !== "error") options.onText?.(transcript.text)
      }
    } catch {
      // Reported by falling back below rather than thrown: the caller is a keypress handler
      // and the audio is still in hand.
      streamFailed = true
    }
  })()

  /** Stops the recorder and the stream, leaving the captured audio intact. */
  const finish = async (): Promise<void> => {
    stopped = true
    // SIGINT, not kill(): every recorder here treats it as "stop cleanly" rather than "die
    // where you stand", which matters for the ones that buffer.
    child.kill("SIGINT")
    close()
    // Closing our end should make the provider send its last transcript and close its own.
    // A provider that does not must never hang the keypress that stopped the recording —
    // whatever has arrived by then is what there is, and the buffer covers the rest.
    await Promise.race([consumed, Bun.sleep(FINISH_TIMEOUT_MS)])
  }

  return {
    stop: async () => {
      await finish()
      const pcm = concat(captured)
      if (!streamFailed && transcript.text) return { text: transcript.text, pcm }
      // Nothing usable came back live. A wav header alone is 44 bytes, so anything near it
      // is a stray keypress rather than a sentence, and not worth a paid round trip.
      if (pcm.length < 2048) return { text: transcript.text, pcm }
      const { text } = await transcribe({ model, audio: encodeWav(pcm, SAMPLE_RATE) })
      return { text: text.trim(), pcm }
    },
    cancel: async () => {
      await finish().catch(() => {})
    },
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
