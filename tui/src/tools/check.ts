import { clip, displayPath, markRead, type ToolContext } from "./context.ts"

/**
 * Formatters and diagnostics for a file that was just written, from config:
 *
 *   "check": { "**\/*.ts": ["bunx prettier --write $FILE", "bunx tsc --noEmit"] }
 *
 * This is the whole of what an LSP client and a formatter registry would buy an agent —
 * "did my edit break anything, and is it formatted" — for a fraction of the machinery,
 * and it works for any language the user can name a command for.
 *
 * ponytail: runs per write, so a whole-project typecheck repeats across a multi-edit turn.
 * If that gets slow, debounce to once per turn from agent.ts's finish-step handler.
 */
const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 4000

/** Only failures are worth the model's attention; a passing check says nothing useful. */
export async function runChecks(ctx: ToolContext, absolute: string): Promise<string> {
  const rel = displayPath(ctx, absolute)
  const commands = Object.entries(ctx.check ?? {})
    .filter(([pattern]) => new Bun.Glob(pattern).match(rel))
    .flatMap(([, list]) => list)
  if (commands.length === 0) return ""

  const failures: string[] = []
  for (const command of commands) {
    // Quoted so paths with spaces survive; $FILE is workspace-relative to match the
    // paths the tools report elsewhere.
    const script = command.replaceAll("$FILE", `'${rel.replaceAll("'", "'\\''")}'`)
    const proc = Bun.spawn(["bash", "-c", script], {
      cwd: ctx.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, JARVIS: "1" },
    })
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS)
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const exitCode = await proc.exited
    clearTimeout(timer)

    if (exitCode === 0) continue
    const output = clip([stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n"), MAX_OUTPUT)
    failures.push(`<check cmd=${JSON.stringify(command)} exit="${exitCode}">\n${output}\n</check>`)
  }

  // A formatter in the list rewrites the file, which would otherwise trip the stale-read
  // guard on the model's very next edit.
  await markRead(ctx, absolute)
  return failures.length > 0 ? `\n${failures.join("\n")}` : ""
}
