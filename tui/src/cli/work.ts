import { resolve, sep } from "node:path"
import { requireCredentials, type Credentials } from "../blueprint/credentials.ts"
import type { Config } from "../config/config.ts"
import { runHeadless } from "./headless.ts"

/**
 * Poll pace. Fast while work is flowing — that latency sits in the middle of somebody's
 * automation — and slow once nothing has come back for a while, so an always-on laptop is
 * not making a request every three seconds all night.
 */
const BUSY_MS = 3_000
const IDLE_MS = 15_000
const IDLE_AFTER_MS = 120_000

export type WorkOptions = {
  config: Config
  /**
   * The only directory this worker will run an agent in. Not optional in spirit: jobs run
   * with every permission auto-approved, so this is the one thing standing between a
   * mistyped `cwd` in a web editor and the rest of the filesystem.
   */
  root?: string
  intervalMs?: number
  /** Test seam: stop after this many polls instead of running forever. */
  maxPolls?: number
  /** Explicit only in tests; the default reaches the real paired device's token. */
  credentialsPath?: string
}

type Job = { id: string; prompt: string; cwd: string; model: string; timeoutSec: number }

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function call(credentials: Credentials, route: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`POST ${route} failed: ${response.status}`)
  return await response.json()
}

/** Whether `target` is `root` or lives underneath it. */
export function within(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep)
}

/**
 * Runs automation `agent` nodes on this machine.
 *
 * The workstation is behind NAT and the web app cannot call it, so the direction is
 * inverted: this polls for work, runs it, and posts the result back. Nothing listens on a
 * port, and it works the same on a laptop, a Pi, or a machine on hotel wifi.
 */
export async function work(options: WorkOptions): Promise<void> {
  const credentials = requireCredentials(options.credentialsPath)
  const root = resolve(options.root ?? process.cwd())
  const busy = options.intervalMs ?? BUSY_MS
  const idle = options.intervalMs ?? IDLE_MS

  process.stderr.write(`jarvis work: polling ${credentials.baseUrl} for jobs in ${root}\n`)
  process.stderr.write("every job runs with permissions auto-approved — ctrl+c to stop\n")

  let lastJobAt = Date.now()
  for (let poll = 0; options.maxPolls === undefined || poll < options.maxPolls; poll++) {
    let job: Job | undefined
    try {
      job = ((await call(credentials, "/api/device/automation/claim")) as { job?: Job }).job ?? undefined
    } catch (error) {
      process.stderr.write(`claim failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }

    if (!job) {
      await sleep(Date.now() - lastJobAt > IDLE_AFTER_MS ? idle : busy)
      continue
    }
    lastJobAt = Date.now()

    const cwd = resolve(root, job.cwd || ".")
    if (!within(root, cwd)) {
      process.stderr.write(`refused job ${job.id}: cwd ${cwd} is outside ${root}\n`)
      await call(credentials, "/api/device/automation/result", {
        jobId: job.id,
        ok: false,
        error: `cwd is outside the worker's --root (${root})`,
      }).catch(() => {})
      continue
    }

    process.stderr.write(`\n▶ job ${job.id} in ${cwd}\n`)
    try {
      const result = await runHeadless({
        config: options.config,
        prompt: job.prompt,
        model: job.model || undefined,
        yes: true,
        cwd,
        abort: AbortSignal.timeout(job.timeoutSec * 1000),
      })
      const failed = !!result.error || !!result.interrupted
      await call(credentials, "/api/device/automation/result", {
        jobId: job.id,
        ok: !failed,
        text: result.text,
        error: result.error ?? (result.interrupted ? `timed out after ${job.timeoutSec}s` : undefined),
        usage: result.usage,
      })
      process.stderr.write(`${failed ? "✗" : "✓"} job ${job.id}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`✗ job ${job.id}: ${message}\n`)
      // Reported rather than swallowed: otherwise the run sits until the server's sweep
      // times it out, and the person watching learns nothing about why.
      await call(credentials, "/api/device/automation/result", {
        jobId: job.id,
        ok: false,
        error: message,
      }).catch(() => {})
    }
  }
}
