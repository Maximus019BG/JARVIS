import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tool } from "ai"
import { z } from "zod"
import { dataDir } from "../config/paths.ts"
import { clip, ToolError, type ToolContext } from "./context.ts"

const MAX_OUTPUT = 30_000
const logDir = join(dataDir, "logs")

type Job = { id: string; command: string; log: string; proc: Bun.Subprocess }

const jobs = new Map<string, Job>()
let counter = 0

/**
 * Starts a command without waiting for it. For dev servers, watchers and builds — the
 * things that never exit, and that otherwise just burn the foreground timeout.
 */
export function startBackground(ctx: ToolContext, command: string): string {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  const id = `bg${++counter}`
  const log = join(logDir, `${ctx.sessionID}-${id}.log`)
  // A file descriptor rather than a pipe: nothing is reading the pipe between calls, and a
  // full pipe buffer would silently wedge the command.
  const fd = openSync(log, "a")
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: ctx.cwd,
    stdout: fd,
    stderr: fd,
    env: { ...process.env, JARVIS: "1" },
  })
  void proc.exited.then(() => closeSync(fd))
  jobs.set(id, { id, command, log, proc })
  return id
}

/**
 * A killed process keeps `exitCode === null` and reports a signal instead, so checking the
 * exit code alone would leave every stopped job looking like it was still running.
 */
const alive = (job: Job) => job.proc.exitCode === null && job.proc.signalCode === null

const state = (job: Job) =>
  alive(job) ? "running" : job.proc.signalCode ? `killed (${job.proc.signalCode})` : `exited ${job.proc.exitCode}`

/** Running jobs, for the status line. */
export function runningJobs(): number {
  let count = 0
  for (const job of jobs.values()) if (alive(job)) count++
  return count
}

/** Kills everything still running, so quitting jarvis does not orphan a dev server. */
export function killBackground() {
  for (const job of jobs.values()) if (alive(job)) job.proc.kill()
}

export const bashOutputTool = (ctx: ToolContext) =>
  tool({
    description: "Read what a background command has printed so far, and optionally stop it.",
    inputSchema: z.object({
      id: z.string().describe("The id returned when the command was started, e.g. bg1"),
      kill: z.boolean().optional().describe("Stop the command after reading its output"),
    }),
    execute: async ({ id, kill = false }) => {
      const job = jobs.get(id)
      if (!job) {
        const known = [...jobs.keys()].join(", ") || "none"
        throw new ToolError(`no background command ${id} (running: ${known})`)
      }
      // Awaited so the state reported below is the state after the kill, not before it.
      if (kill && alive(job)) {
        job.proc.kill()
        await job.proc.exited
      }

      // The log lives outside the workspace, so `read` cannot reach it by design.
      const output = existsSync(job.log) ? readFileSync(job.log, "utf8") : ""
      return [`${id} (${state(job)}): ${job.command}`, clip(output.trimEnd(), MAX_OUTPUT) || "(no output yet)"].join("\n")
    },
  })
