import { transcribe } from "ai"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveTranscription } from "../agent/provider.ts"
import type { Config } from "../config/config.ts"

export class VoiceError extends Error {}

/**
 * Recording commands, best first, each taking the output path as its last argument.
 *
 * A spawned binary rather than an npm audio package: capturing a microphone from JS means a
 * native module, which means a build step on a Raspberry Pi, to do what one of these is
 * already doing on every machine that has a working mic.
 *
 * ponytail: first-on-PATH wins, which is not the same as "the one whose default device is
 * the mic you meant". `voice.recorder` in the config is the escape hatch; if picking the
 * device from inside jarvis is ever wanted, that is where it goes.
 */
export const RECORDERS: readonly (readonly string[])[] = [
  ["sox", "-d"],
  // sox's own recording alias, which is what a Homebrew install actually puts on PATH.
  ["rec"],
  ["arecord", "-f", "cd"],
  ["ffmpeg", "-loglevel", "quiet", "-f", "avfoundation", "-i", ":0"],
  ["ffmpeg", "-loglevel", "quiet", "-f", "alsa", "-i", "default"],
]

/**
 * The recording command to run, or `undefined` when nothing usable is installed.
 *
 * The probe is injected so this stays a pure function: which recorder wins is the only part
 * of voice input worth a test, and it is not worth a test that needs a microphone.
 */
export function pickRecorder(has: (bin: string) => boolean, override?: string): readonly string[] | undefined {
  // An override is taken at its word. Someone who set it knows something the probe does not,
  // and silently falling back to a different microphone is worse than failing to spawn.
  if (override?.trim()) return override.trim().split(/\s+/)
  return RECORDERS.find((command) => has(command[0]!))
}

/** Whether a binary is on PATH. `Bun.which` returns the resolved path, or null. */
const onPath = (bin: string) => Bun.which(bin) !== null

export type Recording = {
  /** Stops the recorder and resolves with what was said. */
  stop: () => Promise<string>
  /** Stops the recorder and throws the audio away. */
  cancel: () => Promise<void>
}

/**
 * Starts recording, and resolves once the recorder is running — so the caller can put
 * "recording" on screen and know it means it.
 *
 * Recording goes to a temp file rather than down a pipe: killed with SIGINT, every recorder
 * here finalizes the wav header on its way out, and a header written to a pipe has to claim
 * a length it cannot know yet.
 */
export async function listen(config: Config): Promise<Recording> {
  const id = config.voice?.model
  if (!id) {
    throw new VoiceError('voice is off — set voice.model in the config, e.g. "openai/whisper-1"')
  }
  const command = pickRecorder(onPath, config.voice?.recorder)
  if (!command) {
    throw new VoiceError(
      `no recorder found on PATH — install sox (\`brew install sox\`, \`apt install sox\`) or set voice.recorder`,
    )
  }

  // Resolved before the first byte is recorded: a missing API key should say so instead of
  // letting someone talk for thirty seconds first.
  const model = await resolveTranscription(config, id)

  const file = join(tmpdir(), `jarvis-voice-${process.pid}-${performance.now().toString(36)}.wav`)
  const proc = Bun.spawn([...command, file], { stdout: "ignore", stderr: "pipe" })

  /** Stops the recorder and hands back the wav, having cleaned up after itself either way. */
  const finish = async (): Promise<Uint8Array> => {
    // SIGINT, not kill(): this is the signal every one of these recorders treats as "stop
    // and close the file properly" rather than "die where you stand".
    proc.kill("SIGINT")
    const stderr = await new Response(proc.stderr).text()
    await proc.exited
    const audio = Bun.file(file)
    const bytes = (await audio.exists()) ? new Uint8Array(await audio.arrayBuffer()) : new Uint8Array()
    await unlink(file).catch(() => {
      // A temp file that will not delete is not worth interrupting anyone over.
    })
    if (bytes.length === 0) {
      const detail = stderr.trim().split("\n")[0]
      throw new VoiceError(`${command[0]} recorded nothing${detail ? `: ${detail}` : ""}`)
    }
    return bytes
  }

  return {
    stop: async () => {
      const bytes = await finish()
      // A wav header alone is 44 bytes, so anything near it is a stray keypress rather than
      // a sentence — and not worth a round trip to a paid endpoint to be told so.
      if (bytes.length < 1024) return ""
      return (await transcribe({ model, audio: bytes })).text.trim()
    },
    cancel: async () => {
      // No transcription: cancelling is the "throw this away" path, and it should not spend.
      await finish().catch(() => {})
    },
  }
}
