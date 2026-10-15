#!/usr/bin/env bun
/**
 * Checks for the AGENTS.md rules that a script can see. One file, no dependencies.
 *
 *   bun tools/check-rules.ts env canon-paths no-skip       # local + CI
 *   bun tools/check-rules.ts docs-touched --range A..B     # CI, over a PR's commits
 *   bun tools/check-rules.ts docs-touched --worktree       # Stop hook, uncommitted changes
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")
const git = (...args: string[]) => {
  const out = Bun.spawnSync(["git", ...args], { cwd: ROOT })
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`)
  return out.stdout.toString()
}

/** `a/{b,c}/d` → `a/b/d`, `a/c/d`. Handles several groups, not nested ones. */
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (!match) return [pattern]
  const [head, tail] = [pattern.slice(0, match.index), pattern.slice(match.index + match[0].length)]
  return match[1]!.split(",").flatMap((part) => expandBraces(head + part + tail))
}

export type ModuleRow = { doc: string; patterns: string[] }

/**
 * Rows of the tui/web tables in docs/modules/README.md: backticked code paths → doc.
 * Web paths are relative to web/src, except a few that live in web/ itself, so both are tried.
 */
export function parseModuleIndex(markdown: string): ModuleRow[] {
  const rows: ModuleRow[] = []
  let section = ""
  for (const line of markdown.split("\n")) {
    const heading = /^### (\w+)/.exec(line)
    if (heading) section = heading[1]!
    const cells = line.split("|").map((cell) => cell.trim())
    const link = /\]\(([^)]+\.md)\)/.exec(cells[3] ?? "")
    if (cells.length < 5 || !link || (section !== "tui" && section !== "web")) continue
    const patterns = [...cells[2]!.matchAll(/`([^`]+)`/g)]
      .flatMap((m) => expandBraces(m[1]!.replace(/\.tsx\?$/, ".{ts,tsx}")))
      .flatMap((p) => (section === "web" && !p.startsWith("web/") ? [`web/src/${p}`, `web/${p}`] : [p]))
    rows.push({ doc: `docs/modules/${link[1]}`, patterns })
  }
  return rows
}

/** The doc owning `file`: the most specific (longest) matching pattern wins, so "except" rows work. */
export function docFor(rows: ModuleRow[], file: string): string | undefined {
  let best: { doc: string; length: number } | undefined
  for (const { doc, patterns } of rows) {
    for (const pattern of patterns) {
      const hit = pattern.includes("*")
        ? new Bun.Glob(pattern).match(file)
        : pattern.endsWith("/")
          ? file.startsWith(pattern)
          : file === pattern
      if (hit && (!best || pattern.length > best.length)) best = { doc, length: pattern.length }
    }
  }
  return best?.doc
}

/** Docs whose code changed while nothing in the doc's folder did. */
export function untouchedDocs(rows: ModuleRow[], changed: string[]): Map<string, string[]> {
  const missing = new Map<string, string[]>()
  for (const file of changed) {
    const doc = docFor(rows, file)
    if (!doc) continue
    const folder = doc.slice(0, doc.lastIndexOf("/") + 1)
    if (changed.some((other) => other.startsWith(folder))) continue
    missing.set(doc, [...(missing.get(doc) ?? []), file])
  }
  return missing
}

/** Names in env.js's `runtimeEnv` vs `KEY=` lines (commented ones count) in .env.example. */
export function envDrift(envJs: string, example: string): { notInExample: string[]; notInEnvJs: string[] } {
  const declared = new Set([...envJs.matchAll(/^\s*([A-Z][A-Z0-9_]*):\s*process\.env\./gm)].map((m) => m[1]!))
  const listed = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!))
  return {
    notInExample: [...declared].filter((key) => !listed.has(key)),
    notInEnvJs: [...listed].filter((key) => !declared.has(key)),
  }
}

const TOP_LEVEL = /^(tui|web|mobile|models|k8s|docs|\.github|\.githooks|\.claude)\//

/** Backticked repo paths (`tui/src/x.ts`, `web/src/x.ts:12`) a doc names. Globs and placeholders are skipped. */
export function pathTokens(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1]!.replace(/:\d+(-\d+)?$/, "").replace(/\/$/, ""))
    .filter((token) => TOP_LEVEL.test(token) && !/[*{}<>$…]|\.\.\./.test(token))
}

/** `.only(` / `.skip(` / `.todo(` on a test, which silently narrows what CI runs. */
export const SKIP_MARKER = /\b(?:it|test|describe)\.(?:only|skip|todo)\(/

function changedInRange(range: string): { files: string[]; skipped: boolean } {
  return {
    files: git("diff", "--name-only", range).split("\n").filter(Boolean),
    skipped: /^Docs-Skip: \S/m.test(git("log", "--format=%B", range)),
  }
}

function changedInWorktree(): string[] {
  return git("status", "--porcelain=v1", "-uall")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop()!)
}

const checks: Record<string, (args: string[]) => string[]> = {
  env() {
    const { notInExample, notInEnvJs } = envDrift(read("web/src/env.js"), read("web/.env.example"))
    return [
      ...notInExample.map((key) => `${key} is in web/src/env.js but not web/.env.example (rule 2)`),
      ...notInEnvJs.map((key) => `${key} is in web/.env.example but not web/src/env.js (rule 2)`),
    ]
  },

  "canon-paths"() {
    const docs = ["AGENTS.md", "REVIEW.md", ...git("ls-files", "docs/modules", "docs/use-cases").split("\n").filter((f) => f.endsWith(".md"))]
    return docs.flatMap((doc) =>
      [...new Set(pathTokens(read(doc)))]
        .filter((path) => !existsSync(join(ROOT, path)))
        .map((path) => `${doc}: \`${path}\` does not exist`),
    )
  },

  "no-skip"() {
    const tests = git("ls-files", "tui/test", "web/src/__tests__").split("\n").filter(Boolean)
    return tests.flatMap((file) =>
      read(file)
        .split("\n")
        .flatMap((line, i) => (SKIP_MARKER.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
    )
  },

  "docs-touched"(args) {
    const rangeAt = args.indexOf("--range")
    const { files, skipped } =
      rangeAt === -1 ? { files: changedInWorktree(), skipped: false } : changedInRange(args[rangeAt + 1]!)
    if (skipped) return []
    const rows = parseModuleIndex(read("docs/modules/README.md"))
    return [...untouchedDocs(rows, files)].map(
      ([doc, code]) => `${doc} not updated, but its code changed: ${code.join(", ")} (rule 10)`,
    )
  },
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  // As a Stop hook: block once, then let the session end (stop_hook_active is set on the retry).
  const hook = argv.includes("--hook")
  if (hook && JSON.parse((await Bun.stdin.text()) || "{}").stop_hook_active) process.exit(0)

  const names = argv.filter((arg, i) => !arg.startsWith("--") && !argv[i - 1]?.startsWith("--range"))
  const unknown = names.filter((name) => !(name in checks))
  if (names.length === 0 || unknown.length > 0) {
    console.error(`usage: check-rules.ts <${Object.keys(checks).join("|")}>... [--range A..B | --worktree] [--hook]`)
    process.exit(1)
  }
  let failed = false
  for (const name of names) {
    const problems = checks[name]!(argv)
    failed ||= problems.length > 0
    for (const problem of problems) console.error(`${name}: ${problem}`)
    if (problems.length === 0 && !hook) console.log(`${name}: ok`)
  }
  if (failed && hook) console.error("Update the module doc and bump its Verified: line; if behaviour changed, update its docs/use-cases/ page too (AGENTS.md rule 10).")
  process.exit(failed ? (hook ? 2 : 1) : 0)
}
