import { generateSpeech } from "ai"
import { rmSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveSpeech } from "../agent/provider.ts"
import type { Config } from "../config/config.ts"
import { pickPlayer } from "./sound.ts"

export class SpeechError extends Error {}

/**
 * Local synthesisers, best first, each reading the text on **stdin** and writing a wav to the
 * path appended as its last argument. Same shape as `RECORDERS` in voice.ts and `PLAYERS` in
 * sound.ts, and for the same reason: a spawned binary beats a native npm module that has to
 * be built on a Raspberry Pi.
 *
 * Piper — the one worth having on a Pi — is deliberately absent. It cannot be probed for,
 * because it is useless without a voice model chosen, so it is reached through `voice.synth`:
 * `"piper --model /path/en_GB-alan-medium.onnx --output_file"`.
 */
export const SYNTHS: readonly (readonly string[])[] = [
  // macOS. `LEI16@22050` because the default output is AIFF, which several players will not
  // open, and the extension alone does not change the encoding.
  ["say", "--data-format=LEI16@22050", "-o"],
  ["espeak-ng", "-w"],
  ["espeak", "-w"],
]

/**
 * The synthesiser to run, or `undefined` when nothing usable is installed. Injected probe, so
 * the choice is a pure function — as with `pickRecorder`, which of these wins is the only part
 * worth testing and it is not worth a test that needs a sound card.
 */
export function pickSynth(has: (bin: string) => boolean, override?: string): readonly string[] | undefined {
  if (override?.trim()) return override.trim().split(/\s+/)
  return SYNTHS.find((command) => has(command[0]!))
}

/** Whether anything at all can speak, so a caller can say "voice is off" before it tries. */
export function canSpeak(config: Config, has: (bin: string) => boolean = (bin) => Bun.which(bin) !== null): boolean {
  return Boolean(config.voice?.speakModel) || pickSynth(has, config.voice?.synth) !== undefined
}

/**
 * Abbreviations whose full stop does not end a sentence. Short on purpose: every entry here is
 * a guess about English, and the cost of missing one is a pause in the wrong place, while the
 * cost of a long list is sentences that never flush at all.
 */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "fig", "no", "approx", "cf"])

/**
 * Markdown as something worth hearing.
 *
 * Everything removed here is removed because it is punctuation for the eye: a synthesiser
 * reading "star star important star star" or a forty-character URL is worse than one that
 * skipped them. Code fences go entirely — the terminal is already showing them, and a
 * paragraph of TypeScript read aloud is the fastest way to make somebody turn this off.
 */
export function speakable(markdown: string): string {
  return (
    markdown
      // Fenced code, opener to closer. Non-greedy, so two blocks do not swallow the prose
      // between them.
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/~~~[\s\S]*?~~~/g, " ")
      // Images before links: the syntax differs by one character and the alt text is the only
      // part of an image anybody could hear.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // A spoken URL is a spoken URL. Nobody has ever wanted one.
      .replace(/\bhttps?:\/\/\S+/g, "a link")
      .replace(/^\s*\|?[\s:|-]*\|[\s:|-]*$/gm, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, " ")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/(\*\*|__|~~)(.*?)\1/g, "$2")
      .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1")
      .replace(/\|/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

/**
 * Whether the buffer ends inside an unclosed code fence, whose contents must not be spoken.
 *
 * `[ \t]` rather than `\s` for the indent: `\s` matches a newline, so a greedy match starting
 * at the end of the previous line swallows the line break and reports the fence one character
 * early — which puts that newline in the spoken half and the fence one column off.
 */
function openFenceAt(buffer: string): number | undefined {
  const fences = [...buffer.matchAll(/^[ \t]{0,3}(?:```|~~~)/gm)]
  return fences.length % 2 === 1 ? fences[fences.length - 1]!.index : undefined
}

/**
 * Closed code blocks blanked to whitespace, with every offset and every line break kept.
 *
 * Blanked rather than removed because the offsets below index back into the original buffer
 * to decide what has been consumed. And it has to happen before the sentence scan, not after:
 * `speakable` strips a fence by matching its two halves, so a slice that happens to contain
 * only the first half would hand the code straight to the synthesiser.
 */
function blankFences(text: string): string {
  return text.replace(/(```|~~~)[\s\S]*?\1/g, (block) => block.replace(/[^\n]/g, " "))
}

/**
 * Splits a streaming buffer into what can be said now and what has to wait.
 *
 * Pure, and the heart of this file: the model produces tokens, a synthesiser wants sentences,
 * and speaking a half-sentence is the difference between an assistant and a fault. Text after
 * an unclosed code fence is held back entirely — the closing fence is what tells us it was
 * code, and by then it would already have been read out.
 */
export function nextUtterances(buffer: string): { utterances: string[]; rest: string } {
  const fence = openFenceAt(buffer)
  const raw = fence === undefined ? buffer : buffer.slice(0, fence)
  const held = fence === undefined ? "" : buffer.slice(fence)
  // Every fence left in `raw` is closed — an unclosed one is what `held` is. Blanking them
  // keeps the offsets, so `rest` can still be sliced out of `raw` below.
  const safe = blankFences(raw)

  // Offsets in `safe` where one utterance ends and the next begins. Collected as we go rather
  // than re-split out of the cleaned text afterwards: the rules below are the whole reason
  // "e.g." does not end a sentence, and a second pass over the joined text would not know them.
  const bounds: number[] = []
  // A blank line ends a thought whether or not anybody punctuated it — which is what makes a
  // heading, a list item and a table row flush instead of waiting for a full stop that is
  // never coming.
  for (const match of safe.matchAll(/\n\s*\n/g)) bounds.push(match.index + match[0].length)
  for (const match of safe.matchAll(/([.!?])["')\]]*(\s)/g)) {
    const before = safe.slice(Math.max(0, match.index - 12), match.index)
    const word = /([\w.]+)$/.exec(before)?.[1]?.toLowerCase()
    if (match[1] === ".") {
      // "e.g. this" and "Dr. Smith" — a full stop that belongs to the word, not the sentence.
      if (word && ABBREVIATIONS.has(word)) continue
      // A single letter is an initial, as in "J. Stark".
      if (word && word.length === 1) continue
      // A numbered list marker: only digits between the line start and the dot.
      if (/(?:^|\n)\s*\d+$/.test(before)) continue
    }
    bounds.push(match.index + match[0].length)
  }
  bounds.sort((a, b) => a - b)

  const cut = bounds[bounds.length - 1] ?? 0
  if (cut === 0) return { utterances: [], rest: buffer }

  const utterances: string[] = []
  let start = 0
  for (const end of bounds) {
    if (end <= start) continue
    const text = speakable(safe.slice(start, end))
    // A chunk with no letter or digit in it is punctuation left over from something stripped,
    // and asking a synthesiser to pronounce ", ," costs a round trip to say nothing.
    if (/[\p{L}\p{N}]/u.test(text)) utterances.push(text)
    start = end
  }
  // Sliced out of `raw`, not `safe`: what has not been spoken yet goes back into the buffer
  // as the model wrote it, blanks and all removed.
  return { utterances, rest: raw.slice(cut) + held }
}

/** Hosted speech, as bytes. Format left to the provider; every player here reads mp3 and wav. */
async function hosted(config: Config, text: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const model = await resolveSpeech(config, config.voice!.speakModel!)
  const result = await generateSpeech({ model, text, voice: config.voice?.speakVoice })
  const ext = result.audio.mediaType?.includes("wav") ? "wav" : "mp3"
  return { bytes: result.audio.uint8Array, ext }
}

let counter = 0
/** Clips written but not yet deleted, so a killed process can still be tidied up after. */
const live = new Set<string>()

function tempFile(ext: string): string {
  const file = join(tmpdir(), `jarvis-speech-${process.pid}-${counter++}.${ext}`)
  live.add(file)
  return file
}

async function discard(file: string): Promise<void> {
  live.delete(file)
  await unlink(file).catch(() => {})
}

/**
 * A speaking session for one turn.
 *
 * Two chains rather than one queue: synthesis runs a sentence ahead of playback, so the next
 * clip is usually ready by the time the current one finishes, while playback stays strictly
 * ordered. Serializing both would stutter between every sentence; serializing neither would
 * have two sentences talking over each other.
 */
export type Speaking = {
  /** Feeds a streamed delta in. Speaks whole sentences as they complete. */
  push: (delta: string) => void
  /** Speaks whatever is left, then resolves once the last clip has finished playing. */
  flush: () => Promise<void>
  /** Stops now: drops the queue and kills the clip in progress. */
  stop: () => void
}

export function speaking(config: Config, onError: (message: string) => void): Speaking {
  let buffer = ""
  let stopped = false
  let reported = false
  let synthChain: Promise<unknown> = Promise.resolve()
  let playChain: Promise<void> = Promise.resolve()
  let current: { kill: () => void } | undefined

  // The same player the earcons use: which binary can put a sound through this machine's
  // speakers is a fact about the machine, not about what is being played.
  const player = pickPlayer((bin) => Bun.which(bin) !== null, config.sound?.player)

  /** Reported once per turn: a missing API key should not produce one note per sentence. */
  const fail = (error: unknown) => {
    if (stopped || reported) return
    reported = true
    onError(error instanceof Error ? error.message : String(error))
  }

  const synthesize = async (text: string): Promise<string | undefined> => {
    if (config.voice?.speakModel) {
      const { bytes, ext } = await hosted(config, text)
      const file = tempFile(ext)
      await Bun.write(file, bytes)
      return file
    }
    const command = pickSynth((bin) => Bun.which(bin) !== null, config.voice?.synth)
    if (!command) throw new SpeechError("nothing to speak with — set voice.speakModel, or install piper or espeak-ng")
    const file = tempFile("wav")
    const proc = Bun.spawn([...command, file], { stdin: new TextEncoder().encode(text), stdout: "ignore", stderr: "pipe" })
    const stderr = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) throw new SpeechError(`${command[0]} failed: ${stderr.trim().split("\n")[0] ?? ""}`)
    return file
  }

  const enqueue = (text: string) => {
    if (stopped) return
    // Held behind the previous synthesis rather than run immediately: a long answer would
    // otherwise fire thirty requests at a paid endpoint in the time it takes to say the first
    // sentence, and cancelling would have paid for all of them.
    const audio = synthChain.then(() => (stopped ? undefined : synthesize(text)))
    synthChain = audio.catch(() => undefined)
    playChain = playChain.then(async () => {
      let file: string | undefined
      try {
        file = await audio
      } catch (error) {
        fail(error)
        return
      }
      if (!file) return
      try {
        if (stopped || !player) return
        const proc = Bun.spawn([...player, file], { stdout: "ignore", stderr: "ignore" })
        current = proc
        await proc.exited
      } finally {
        current = undefined
        await discard(file)
      }
    })
  }

  return {
    push: (delta) => {
      if (stopped) return
      buffer += delta
      const { utterances, rest } = nextUtterances(buffer)
      buffer = rest
      for (const utterance of utterances) enqueue(utterance)
    },
    flush: async () => {
      const tail = speakable(buffer)
      buffer = ""
      if (tail && /[\p{L}\p{N}]/u.test(tail)) enqueue(tail)
      await playChain
    },
    stop: () => {
      stopped = true
      buffer = ""
      current?.kill()
    },
  }
}

/**
 * Says one line, outside any turn — a boot report, a warning, an answer to `/speak test`.
 * Resolves when it has finished speaking so a caller can sequence around it.
 */
export async function say(config: Config, text: string): Promise<void> {
  let failure: string | undefined
  const session = speaking(config, (message) => (failure = message))
  session.push(text)
  await session.flush()
  if (failure) throw new SpeechError(failure)
}

/**
 * Removes any clip that was written but never played — a turn interrupted mid-sentence, or a
 * synthesis that finished after `stop`. Synchronous because the only place it can run is a
 * `process.on("exit")` handler, which cannot await.
 */
export function cleanupSpeech(): void {
  for (const file of live) rmSync(file, { force: true })
  live.clear()
}
