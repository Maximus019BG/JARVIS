import type { Config } from "../config/config.ts"
import { SpeakerError, MAX_VERIFY_SAMPLES, MIN_VERIFY_SAMPLES } from "./speaker.ts"
import { speakerModelMissing } from "./speaker-models.ts"

/** How long to wait for one embedding before giving up on the worker. */
const REQUEST_TIMEOUT_MS = 30_000

type Reply = { id?: number; embedding?: number[]; error?: string; ready?: boolean }

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A running speaker-embedding worker.
 *
 * One process for the life of the session, not one per utterance: the model is a hundred
 * megabytes and takes a second or two to load, which is fine once and intolerable between
 * somebody speaking and being recognised.
 */
export type Embedder = {
  embed: (pcm: Uint8Array) => Promise<number[]>
  close: () => void
}

/**
 * Starts the worker. Cheap and synchronous — the model loads in the child, and the first
 * `embed` is the call that waits for it.
 */
export function embedder(config: Config, options: { runtime?: string; script?: string } = {}): Embedder {
  if (speakerModelMissing(config.voice?.speaker?.model)) {
    throw new SpeakerError("the speaker model is not downloaded — run `jarvis voice models`")
  }

  const script = options.script ?? new URL("./speaker-worker.ts", import.meta.url).pathname
  const model = config.voice?.speaker?.model
  const child = Bun.spawn([options.runtime ?? "bun", script, ...(model ? [`--model=${model}`] : [])], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  })

  const pending = new Map<number, { resolve: (embedding: number[]) => void; reject: (error: Error) => void }>()
  let next = 1
  let dead: string | undefined

  void (async () => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf("\n")
          if (!line) continue
          let reply: Reply
          try {
            reply = JSON.parse(line) as Reply
          } catch {
            continue
          }
          // A failure with no id is the worker refusing to start at all — a missing runtime or
          // a missing model. Everyone waiting is waiting for something that will never come.
          if (reply.id === undefined) {
            if (reply.error) {
              dead = reply.error
              for (const waiter of pending.values()) waiter.reject(new SpeakerError(reply.error))
              pending.clear()
            }
            continue
          }
          const waiter = pending.get(reply.id)
          if (!waiter) continue
          pending.delete(reply.id)
          if (reply.error) waiter.reject(new SpeakerError(reply.error))
          else if (reply.embedding) waiter.resolve(reply.embedding)
          else waiter.reject(new SpeakerError("the worker returned neither an embedding nor an error"))
        }
      }
    } finally {
      reader.releaseLock()
      dead ??= "the speaker worker stopped"
      for (const waiter of pending.values()) waiter.reject(new SpeakerError(dead))
      pending.clear()
    }
  })()

  return {
    embed: async (pcm) => {
      if (dead) throw new SpeakerError(dead)
      if (pcm.length / 2 < MIN_VERIFY_SAMPLES) {
        throw new SpeakerError("too short to identify a voice — say a little more")
      }
      // Trimmed on this side rather than in the worker so the cap is enforced by the code that
      // documents why it exists, and so the base64 crossing the pipe stays small.
      const capped = capPcm(pcm)
      const id = next++
      const reply = new Promise<number[]>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      // Handled the instant it exists. The reader loop can reject this while we are still
      // writing the request — that is precisely what a worker refusing to start does — and a
      // rejection with no handler yet is an unhandled rejection, however briefly. The race
      // below is what actually consumes the outcome.
      reply.catch(() => {})
      try {
        child.stdin.write(`${JSON.stringify({ id, pcm: Buffer.from(capped).toString("base64") })}\n`)
        // `flush` may hand back a promise, and on a worker that has already exited that promise
        // rejects. Unawaited it becomes an unhandled "EOF: end of file, write" with no stack
        // worth reading; the reader loop is what actually reports the death, so this only has
        // to stop the rejection escaping.
        await Promise.resolve(child.stdin.flush()).catch(() => {})
      } catch (error) {
        // The worker exited between the `dead` check above and this write — which is exactly
        // what a worker that refuses to start does. Unhandled, this surfaces as a bare
        // "EOF: end of file, write" from somewhere with no stack worth reading.
        pending.delete(id)
        throw new SpeakerError(dead ?? `the speaker worker is not accepting audio: ${errorText(error)}`)
      }
      return await Promise.race([
        reply,
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            pending.delete(id)
            reject(new SpeakerError("the speaker worker did not answer in time"))
          }, REQUEST_TIMEOUT_MS),
        ),
      ])
    },
    close: () => {
      child.kill()
    },
  }
}

/**
 * `MAX_VERIFY_SAMPLES` applied to bytes rather than samples, so the PCM is never widened into
 * floats twice — once to measure it and once in the worker.
 */
export function capPcm(pcm: Uint8Array): Uint8Array {
  const max = MAX_VERIFY_SAMPLES * 2
  if (pcm.length <= max) return pcm
  // Even offset: an odd one splits a sample in half and shifts every value after it, which
  // sounds like white noise to the model and scores like a stranger.
  const start = Math.floor((pcm.length - max) / 2) & ~1
  return pcm.subarray(start, start + max)
}
