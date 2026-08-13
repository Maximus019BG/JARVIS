/**
 * Where gateway traffic goes.
 *
 * A checked-in TS module rather than env JSON or a database table: routing is code-shaped, not
 * secret-shaped. This way it is type-checked, reviewable in a diff, commentable, needs no
 * migration, and costs no database round-trip on the hot path — and `resolveChain` stays a pure
 * function over data, which is what makes it testable.
 *
 * The credentials do *not* live here. They live in src/env.js and are looked up by `keyFor`.
 */

/**
 * A closed union rather than a free string, so the compiler enforces that every upstream names a
 * variable that src/env.js actually validates. A `process.env[upstream.apiKeyEnv]` would be more
 * flexible and would quietly leave the t3-env guarantee behind. Adding a fourth key means one
 * edit here, one in env.js and one in keys.ts.
 */
export type GatewayKeyName = "GATEWAY_KEY_A" | "GATEWAY_KEY_B" | "GATEWAY_KEY_C";

export type Upstream = {
  /** Stable slug. Lands in gateway_usage.upstream_name and in the x-gateway-upstream header. */
  name: string;
  /** No trailing slash — "/chat/completions" is appended. */
  baseUrl: string;
  keyName: GatewayKeyName;
  /** Exact model ids this upstream serves. Checked before `prefixes`. */
  models: readonly string[];
  /** Families it also serves, e.g. "gpt-", "claude-". */
  prefixes: readonly string[];
  /** Lower runs first. Ties are broken by name, so the chain is deterministic. */
  priority: number;
  /** USD per million tokens. Absent means rows are written `estimated`, with cost 0. */
  cost?: { input: number; output: number };
  /** Wall clock for one call to this upstream. Must sit under LIMITS.totalDeadlineMs. */
  timeoutMs: number;
  /** Static non-secret headers, e.g. { "anthropic-version": "2023-06-01" }. */
  headers?: Readonly<Record<string, string>>;
  enabled: boolean;
};

/**
 * Edit this list to route traffic. Order does not matter — `priority` does.
 *
 * The entries below are examples with `enabled: false`: turning one on means setting its
 * `keyName` variable in .env. An upstream whose key is not configured is skipped at request
 * time rather than failing the request, so a half-configured list still works.
 */
export const UPSTREAMS: readonly Upstream[] = [
  {
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyName: "GATEWAY_KEY_A",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"],
    prefixes: ["gpt-", "o1-", "o3-", "o4-"],
    priority: 10,
    cost: { input: 1.25, output: 10 },
    timeoutMs: 120_000,
    enabled: false,
  },
  {
    name: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyName: "GATEWAY_KEY_B",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    prefixes: ["claude-"],
    priority: 10,
    cost: { input: 3, output: 15 },
    timeoutMs: 120_000,
    headers: { "anthropic-version": "2023-06-01" },
    enabled: false,
  },
  {
    // Last resort for anything the two above do not claim, and the natural fallback when one of
    // them is rate-limiting: a higher priority means it is only reached after they fail.
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyName: "GATEWAY_KEY_C",
    models: [],
    prefixes: [""],
    priority: 90,
    timeoutMs: 120_000,
    enabled: false,
  },
];

/**
 * Request-facing names clients can pin without knowing who serves them. This is what lets the
 * TUI ask for "jarvis-default" forever while the owner changes what that means.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  "jarvis-default": "gpt-4.1-mini",
  "jarvis-max": "claude-sonnet-4-5",
};

/**
 * Abuse and cost ceilings. Here rather than in env so that adding one is a single edit instead
 * of the three env.js requires.
 */
export const LIMITS = {
  rpmPerDevice: 60,
  /** $20 in integer micros, per user per calendar month. */
  monthlyCostMicrosPerUser: 20_000_000,
  maxOutputTokens: 8192,
  /** How many upstreams one request may try before giving up. */
  maxAttempts: 3,
  /** Shared wall clock, so a three-upstream chain of timeouts cannot add up. */
  totalDeadlineMs: 240_000,
} as const;
