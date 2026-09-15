import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import { z } from "zod"
import { ancestors } from "./discover.ts"
import { configDir, configNames } from "./paths.ts"
import { readSecrets } from "./secrets.ts"

export const PermissionSchema = z.enum(["ask", "allow", "deny"])

export const ModelConfigSchema = z
  .object({
    name: z.string().optional(),
    /** Provider-specific per-request options, merged into providerOptions. */
    options: z.record(z.string(), z.unknown()).optional(),
    reasoning: z.boolean().optional(),
    contextLimit: z.number().optional(),
    outputLimit: z.number().optional(),
    cost: z
      .object({ input: z.number(), output: z.number() })
      .optional()
      .describe("USD per million tokens, used for the status line estimate"),
  })
  .strict()

export const ProviderConfigSchema = z
  .object({
    name: z.string().optional(),
    /** npm package exporting an AI SDK provider factory, e.g. "@ai-sdk/anthropic". */
    npm: z.string(),
    /** Named export to use as the factory. Defaults to a sensible guess. */
    export: z.string().optional(),
    /** Passed to the provider factory (apiKey, baseURL, headers, ...). */
    options: z.record(z.string(), z.unknown()).default({}),
    models: z.record(z.string(), ModelConfigSchema).default({}),
    enabled: z.boolean().default(true),
  })
  .strict()

export const AgentConfigSchema = z
  .object({
    description: z.string().optional(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    /** Path to a markdown file used as the system prompt. */
    promptFile: z.string().optional(),
    temperature: z.number().optional(),
    /** Tool name -> enabled. Unlisted tools follow `defaultTools`. */
    tools: z.record(z.string(), z.boolean()).default({}),
    defaultTools: z.boolean().default(true),
    permission: z.record(z.string(), PermissionSchema).default({}),
    /** Available via the `task` tool to other agents. */
    spawnable: z.boolean().default(true),
    enabled: z.boolean().default(true),
  })
  .strict()

export const McpConfigSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local"),
      command: z.array(z.string()).nonempty(),
      environment: z.record(z.string(), z.string()).default({}),
      cwd: z.string().optional(),
      enabled: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("remote"),
      url: z.string(),
      headers: z.record(z.string(), z.string()).default({}),
      enabled: z.boolean().default(true),
    })
    .strict(),
])

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    /** "provider/model" used when nothing else is specified. */
    model: z.string().optional(),
    /** Cheaper model for titles and other side work. Falls back to `model`. */
    smallModel: z.string().optional(),
    agent: z.record(z.string(), AgentConfigSchema).default({}),
    provider: z.record(z.string(), ProviderConfigSchema).default({}),
    mcp: z.record(z.string(), McpConfigSchema).default({}),
    /** Tool name (or "bash:<prefix>") -> ask | allow | deny. */
    permission: z.record(z.string(), PermissionSchema).default({}),
    keybinds: z.record(z.string(), z.string()).default({}),
    /**
     * Which JARVIS deployment this machine pairs with, as a prefill for `/pair`.
     *
     * Only a default for the wizard's first question — the address that actually matters is
     * the one written into `credentials.json` at pairing time, so changing this afterwards
     * does not move an already-paired device. `JARVIS_CLOUD_URL` wins over it.
     */
    cloud: z.string().optional(),
    theme: z.string().default("jarvis"),
    /** UI motion. `reduced` keeps the spinner only; `JARVIS_MOTION` overrides this. */
    animations: z.enum(["full", "reduced", "off"]).default("full"),
    /** Modal editing in the prompt box. Starts in insert; escape for normal. */
    vim: z.boolean().default(false),
    /** Extra instruction files appended to the system prompt. Globs allowed. */
    instructions: z.array(z.string()).default([]),
    /**
     * The voice the agent answers in: `"jarvis"`, `"plain"`, or a path to a markdown file
     * holding one. Tone only — a persona never grants a capability or relaxes a rule, so
     * `plain` is a safe way to turn the character off without weakening anything.
     */
    persona: z.string().default("jarvis"),
    /**
     * Who the agent is talking to. Entirely optional, and absent by default: guessing at a
     * name from the git config would put someone's real name into every system prompt on
     * the strength of a commit they made three years ago.
     */
    operator: z
      .object({
        name: z.string().optional(),
        /** How to address them — "sir", "Maximus", "boss". Left alone if unset. */
        address: z.string().optional(),
        /** One line of standing context: role, what they are building, what they care about. */
        about: z.string().optional(),
      })
      .optional(),
    /**
     * Glob -> commands run after a matching file is written, with `$FILE` substituted.
     * Failures come back to the model. This is how formatting and diagnostics reach the
     * agent: `{ "**\/*.ts": ["bunx prettier --write $FILE", "bunx tsc --noEmit"] }`.
     */
    check: z.record(z.string(), z.array(z.string())).default({}),
    /**
     * Where blueprints live and how they are versioned. The store is its own git repo,
     * kept outside the project so it never nests a `.git` inside the user's own.
     */
    blueprint: z
      .object({
        /** Overrides the store root. Defaults to `<data dir>/blueprints/<workspace>`. */
        dir: z.string().optional(),
        /** Maps to a workstation in the web app. */
        workspace: z.string().default("default"),
        /**
         * Hand-drawing on a Pi. Every one of these is a physical tuning knob: a projector's
         * angle, a camera's exposure and how firmly a particular person pinches all shift
         * the right values, and none of them can be derived. Defaults are a starting point,
         * not an answer.
         */
        pi: z
          .object({
            port: z.number().default(7331),
            /** Blueprint drawn into when none is named. */
            sketch: z.string().default("sketch"),
            camera: z
              .object({
                width: z.number().default(640),
                height: z.number().default(480),
                fps: z.number().default(30),
              })
              .default({ width: 640, height: 480, fps: 30 }),
            gestures: z
              .object({
                /** Thumb-to-index gap, in hand spans, that closes the pen. */
                pinchEnter: z.number().default(0.32),
                /** The looser gap that opens it again — must exceed `pinchEnter`. */
                pinchExit: z.number().default(0.45),
                debounce: z.number().int().positive().default(3),
                pointHoldMs: z.number().default(400),
                minScore: z.number().default(0.6),
                zoomDeadZone: z.number().default(0.08),
              })
              .default({
                pinchEnter: 0.32,
                pinchExit: 0.45,
                debounce: 3,
                pointHoldMs: 400,
                minScore: 0.6,
                zoomDeadZone: 0.08,
              }),
            fit: z
              .object({
                /** Simplification epsilon in drawing units; bigger discards more wobble. */
                tolerance: z.number().default(1.2),
                smoothing: z.number().default(0.35),
                snapGrid: z.number().default(0),
                snapRadius: z.number().default(3),
              })
              .default({ tolerance: 1.2, smoothing: 0.35, snapGrid: 0, snapRadius: 3 }),
          })
          .default({
            port: 7331,
            sketch: "sketch",
            camera: { width: 640, height: 480, fps: 30 },
            gestures: {
              pinchEnter: 0.32,
              pinchExit: 0.45,
              debounce: 3,
              pointHoldMs: 400,
              minScore: 0.6,
              zoomDeadZone: 0.08,
            },
            fit: { tolerance: 1.2, smoothing: 0.35, snapGrid: 0, snapRadius: 3 },
          }),
      })
      .default({
        workspace: "default",
        pi: {
          port: 7331,
          sketch: "sketch",
          camera: { width: 640, height: 480, fps: 30 },
          gestures: {
            pinchEnter: 0.32,
            pinchExit: 0.45,
            debounce: 3,
            pointHoldMs: 400,
            minScore: 0.6,
            zoomDeadZone: 0.08,
          },
          fit: { tolerance: 1.2, smoothing: 0.35, snapGrid: 0, snapRadius: 3 },
        },
      }),
    /**
     * Push-to-talk voice input. Absent means off: recording needs a binary on PATH and
     * transcription needs a provider that has an audio endpoint, and neither is worth
     * probing for on every launch of a terminal nobody will speak into.
     */
    voice: z
      .object({
        /** `"provider/model"`, e.g. `"openai/whisper-1"`. Required for voice to do anything. */
        model: z.string().optional(),
        /**
         * Recording command, with the output wav path appended as the last argument.
         * Overrides the PATH probe — set it when the probe picks the wrong input device.
         */
        recorder: z.string().optional(),
        /**
         * Capture command writing raw 16 kHz mono signed 16-bit PCM to **stdout**, for the
         * wake word and for streaming dictation. A different question from `recorder`, which
         * names a command that writes a wav file and stops — handing one to the other
         * produces a command that runs and returns nothing usable.
         */
        capture: z.string().optional(),
        /**
         * Transcribe while you talk, when the model can — text appears as you speak instead of
         * after you stop. On by default, because a provider that cannot stream falls back to
         * the push-to-talk path on its own; set it false to stay on that path deliberately,
         * which is worth doing on a metered connection where an open socket costs more than a
         * single upload.
         */
        stream: z.boolean().default(true),
        /**
         * Read answers out loud. Off by default and separate from `model`: listening and
         * speaking are independent wants, and someone who dictates prompts in an open-plan
         * office is exactly the person who does not want the replies broadcast back.
         */
        speak: z.boolean().default(false),
        /**
         * `"provider/model"` for hosted speech, e.g. `"openai/gpt-4o-mini-tts"`. Unset means
         * the local synthesiser is used instead, which is what keeps a Pi talking off-network.
         */
        speakModel: z.string().optional(),
        /** Voice id for the hosted model — `"onyx"`, an ElevenLabs voice id, and so on. */
        speakVoice: z.string().optional(),
        /**
         * Local synthesiser command: reads the text on stdin, writes a wav to the path
         * appended as its last argument. Overrides the PATH probe, and the way to reach
         * piper, which cannot be probed for because it needs a voice model chosen:
         * `"piper --model /path/en_GB-alan-medium.onnx --output_file"`.
         */
        synth: z.string().optional(),
        /**
         * Always-on wake word. Off by default, and not merely as a preference: this holds the
         * microphone open for as long as the session lasts. Nothing leaves the machine — the
         * scoring is three small ONNX models running locally, and audio only reaches a
         * transcription provider once the phrase has fired — but a terminal that opens your
         * microphone should be something you turned on.
         */
        wake: z
          .object({
            enabled: z.boolean().default(false),
            /**
             * A pretrained openWakeWord phrase (`hey_jarvis`, `alexa`, `hey_mycroft`) or a path
             * to an `.onnx` classifier you trained yourself.
             */
            phrase: z.string().default("hey_jarvis"),
            /** Score above which the phrase counts as heard. Higher is fewer false alarms. */
            threshold: z.number().default(0.5),
            /** Consecutive 80 ms chunks over the threshold before it fires. */
            frames: z.number().default(2),
            /** How long to ignore the microphone after firing, so one phrase wakes once. */
            refractoryMs: z.number().default(2000),
            /**
             * Keep listening while an answer is being read out, so saying the phrase cuts him
             * off mid-sentence. On by default: interrupting by name is most of the reason to
             * have a wake word at all.
             *
             * The cost is that there is no echo cancellation here, so an answer that contains
             * the phrase out loud can wake him into his own sentence. Turn this off and he
             * goes deaf while speaking, at the price of having to reach for the keyboard.
             */
            bargeIn: z.boolean().default(true),
          })
          .optional(),
        /**
         * Only act on voices you have enrolled.
         *
         * **This is a convenience gate, not authentication.** It compares a voice against
         * `voices.json` and refuses the ones it does not know, which keeps the person standing
         * next to you from talking to your workbench by accident. It is defeated by a
         * recording of you, and it does not replace the permission gate: it decides *whose*
         * words become a prompt, never what the agent may then do with them.
         */
        speaker: z
          .object({
            enabled: z.boolean().default(false),
            /**
             * Cosine similarity a voice must reach. 0.86 is what the model's authors publish;
             * `jarvis voice test` prints the real scores so it can be set from measurement
             * rather than from a guess.
             */
            threshold: z.number().default(0.86),
            /** Path to a different ONNX embedder. Must take a raw 16 kHz waveform. */
            model: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    /**
     * Short tones for "done", "you are needed" and "failed". Absent means off, and that is
     * the right default: a terminal that makes a noise nobody asked for is a terminal people
     * turn off, and the sounds only earn their keep for someone who walks away mid-turn.
     */
    sound: z
      .object({
        earcons: z.boolean().default(false),
        /** Playback command, with the wav path appended. Overrides the PATH probe. */
        player: z.string().optional(),
        /**
         * Only sound the "done" tone for turns longer than this many seconds. A beep after
         * every two-second answer is noise; a beep after the four-minute one is the point.
         */
        afterSeconds: z.number().default(20),
      })
      .optional(),
    /** Max tool-call steps in one turn before the loop stops. */
    maxSteps: z.number().default(200),
    /**
     * Send only the core tools up front and let the model load the rest with `tool_search`,
     * rather than carrying every schema in every request. Worth about half the per-turn
     * floor, and all of the cost of an MCP server nobody is using this session.
     *
     * Turn it off for a model that cannot manage a two-step load. Nothing else changes: the
     * request that goes out with this false is byte-identical to the one that went out
     * before the option existed.
     */
    lazyTools: z.boolean().default(true),
    /**
     * Stop and ask once a session has cost this much in USD, then again after every
     * further increment of it. `0` disables the check.
     */
    maxCost: z.number().default(0),
    /**
     * Write "always allow" answers into the project's `.jarvis/jarvis.jsonc` so they
     * outlive the process. Off by default: granting a permission should not silently
     * edit a file you may have committed.
     */
    persistGrants: z.boolean().default(false),
    /**
     * Mirror permission prompts to the paired cloud so they can be answered from a phone
     * or the web app. Off by default, and not merely a preference: a prompt's detail
     * carries the command about to run and unified diffs of private files, so turning
     * this on sends that off the machine.
     */
    remoteApproval: z.boolean().default(false),
    /**
     * Upload session transcripts to the paired cloud so they can be read in the browser.
     * Off by default: a transcript holds verbatim file contents, commands and tool output
     * from whatever you pointed the agent at, and pairing was consent to sync blueprints.
     */
    syncSessions: z.boolean().default(false),
    /**
     * Accept prompts typed into the paired web app and run them in this session, so a session
     * can be steered from a phone.
     *
     * Off by default, and the most consequential flag here: it lets anyone who can sign in as
     * you put words in front of an agent holding `bash` and `edit` on this machine. What
     * arrives is treated exactly like something typed at this keyboard — it goes through the
     * same permission gate, and is never auto-approved — but it does start a real turn.
     *
     * Only polls between turns, and only for the session in the foreground.
     */
    remoteSteering: z.boolean().default(false),
  })
  .strict()

export type Config = z.infer<typeof ConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type AgentConfig = z.infer<typeof AgentConfigSchema>
export type McpConfig = z.infer<typeof McpConfigSchema>
export type Permission = z.infer<typeof PermissionSchema>

export class ConfigError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Later sources win. Objects merge recursively; arrays and scalars replace. */
export function merge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? merge(base[key], value) : value
  }
  return out
}

const SUBSTITUTION = /\{(env|file|secret):([^}]+)\}/g

/**
 * Expands `{env:NAME}`, `{secret:name}` and `{file:path}` inside every string in the tree.
 *
 * `env` and `secret` resolve soft — an unset one becomes `""`, and `provider-status.ts` is what
 * turns that back into a diagnosis. `file` throws, because a path someone typed and then moved
 * is more likely a mistake than an intentional blank. Do not "fix" that asymmetry: making
 * `secret` throw would mean a deleted secrets.json cannot be recovered from inside the app.
 */
export function substitute(value: unknown, dir: string): unknown {
  if (typeof value === "string") {
    return value.replace(SUBSTITUTION, (_, kind: string, arg: string) => {
      if (kind === "env") return process.env[arg] ?? ""
      if (kind === "secret") return readSecrets()[arg] ?? ""
      const path = isAbsolute(arg) ? arg : join(dir, arg)
      if (!existsSync(path)) throw new ConfigError(`{file:${arg}} not found (resolved to ${path})`)
      return readFileSync(path, "utf8").trim()
    })
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, dir))
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, dir)]))
  }
  return value
}

function readConfigFile(path: string): unknown {
  const errors: ParseError[] = []
  const parsed = parseJsonc(readFileSync(path, "utf8"), errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new ConfigError(`${path}: invalid JSONC at offset ${errors[0]!.offset}`)
  return substitute(parsed, dirname(path))
}

function findIn(dir: string): string | undefined {
  for (const name of configNames) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
}

/**
 * Config files that apply to `cwd`, outermost first: the global one, then for every
 * directory from the project root down to cwd its `jarvis.json[c]` and then its
 * `.jarvis/jarvis.json[c]`. Nearest wins.
 */
export function configFiles(cwd: string): string[] {
  const found: string[] = []
  const global = findIn(configDir)
  if (global) found.push(global)
  for (const dir of ancestors(cwd)) {
    for (const candidate of [findIn(dir), findIn(join(dir, ".jarvis"))]) {
      if (candidate) found.push(candidate)
    }
  }
  return found
}

export function loadConfig(cwd = process.cwd()): Config {
  let raw: unknown = {}
  for (const path of configFiles(cwd)) raw = merge(raw, readConfigFile(path))
  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`)
    throw new ConfigError(`invalid jarvis config:\n${issues.join("\n")}`)
  }
  return result.data
}
