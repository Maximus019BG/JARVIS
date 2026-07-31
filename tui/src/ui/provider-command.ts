import { bar, readRecords, rollup, type ProviderRoll } from "../agent/metrics.ts"
import { defaultModelID, forgetProvider, parseModelID } from "../agent/provider.ts"
import type { Config } from "../config/config.ts"
import type { Theme } from "../config/theme.ts"
import { globalConfigFile, persistConfig } from "../config/persist.ts"
import { envName, reachability, SECRET_KEY, type Reach } from "../config/provider-status.ts"
import { clip } from "./components/dialog.tsx"
import type { Line, PanelContent } from "./components/panel.tsx"

/** Enough of an SDK to talk to most OpenAI-shaped endpoints, which most custom ones are. */
const DEFAULT_NPM = "@ai-sdk/openai-compatible"

type Deps = { config: Config; cwd: string; width: number }

const blank: Line = { text: "" }
const head = (text: string): Line => ({ text, tone: "accent" })
const body = (text: string): Line => ({ text })
const bad = (text: string): Line => ({ text, tone: "error" })

const panel = (title: string, lines: Line[]): PanelContent => ({ title, lines })
/** A refusal or a usage error. The first line carries the tone; the rest is what to do. */
const fail = (title: string, lines: string[]): PanelContent =>
  panel(title, [bad(lines[0]!), ...lines.slice(1).map(body)])

const thousands = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`)
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`
const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
/** `07-23 13:15` — an outage range has to fit on one line to be worth printing at all. */
const short = (at: number) => `${new Date(at).toLocaleDateString("en-CA").slice(5)} ${time(at)}`

/** Whether the credential is usable right now, and the tone that says so at a glance. */
function keyLine(reach: Reach | undefined): { text: string; tone: keyof Theme } {
  if (!reach || reach.state === "absent") return { text: "no key configured", tone: "dim" }
  if (reach.state === "ok") return { text: `key ✓${reach.env ? ` ${reach.env}` : ""}`, tone: "success" }
  return { text: `key ✗ ${reach.env ? `${reach.env} unset` : "configured but empty"}`, tone: "warning" }
}

/** `name    key ✓ …   3 models   default` as two runs, so the key state keeps its color. */
function providerHeading(id: string, reach: Reach | undefined, tail: string[]): Line[] {
  const key = keyLine(reach)
  return [
    { text: `${id.padEnd(16)}  ${key.text}`, tone: key.tone },
    ...(tail.length > 0 ? [body(`${" ".repeat(18)}${tail.join("  ")}`)] : []),
  ]
}

function view({ config, cwd }: Deps, id?: string): PanelContent {
  if (id && !config.provider[id]) return fail(`provider ${id}`, [`no provider "${id}"`, "", "/provider to list them"])
  const reach = reachability(config, cwd)
  const ids = id ? [id] : Object.keys(config.provider)
  if (ids.length === 0) {
    return panel("providers", [body("none configured yet"), blank, head("/provider add <id>"), body("to start one")])
  }

  let defaultProvider: string | undefined
  try {
    defaultProvider = parseModelID(defaultModelID(config)).providerID
  } catch {
    // No models configured at all is a valid first-run state, not something to report here.
  }

  const lines: Line[] = [
    { text: "key ✓ means a credential resolved — not that the provider answered", tone: "dim" },
    blank,
  ]

  for (const each of ids) {
    const provider = config.provider[each]!
    const models = Object.keys(provider.models)
    lines.push(
      ...providerHeading(each, reach[each], [
        `${models.length} model${models.length === 1 ? "" : "s"}`,
        provider.enabled ? "" : "disabled",
        each === defaultProvider ? "default" : "",
      ].filter(Boolean)),
    )
    if (id) {
      // Detail: enough to debug a provider, with every credential shown as its state and
      // never its value — a panel is still text a screenshot can carry off.
      lines.push(
        body(`  npm     ${provider.npm}`),
        ...(provider.export ? [body(`  export  ${provider.export}`)] : []),
        body(`  file    ${reach[each]?.file ?? "not found"}`),
        ...Object.entries(provider.options).map(([key, value]) =>
          SECRET_KEY.test(key)
            ? { text: `  ${key.padEnd(7)} ${keyLine(reach[each]).text}`, tone: keyLine(reach[each]).tone }
            : body(`  ${key.padEnd(7)} ${JSON.stringify(value)}`),
        ),
        ...models.map((model) => body(`  model   ${model}`)),
      )
    }
    lines.push(blank)
  }

  lines.push(head("add · change · delete · stats"), body("  /provider <action> — esc to close"))
  return panel(id ? `provider ${id}` : "providers", lines)
}

function add({ config }: Deps, id?: string, npm?: string): PanelContent {
  if (!id) return fail("provider add", ["usage: /provider add <id> [npm-package]"])
  if (config.provider[id]) {
    return fail(`provider ${id}`, [`"${id}" already exists`, "", `/provider change ${id} <path> <value>`])
  }

  const env = envName(id)
  const file = persistConfig(globalConfigFile(), ["provider", id], {
    npm: npm ?? DEFAULT_NPM,
    // A template, never a literal: the key stays out of this file, out of the session
    // transcript, and out of anything /export produces.
    options: { apiKey: `{env:${env}}` },
    models: {},
  })

  // The session's own config has to learn about it too, or `change` and `delete` cannot see
  // what was just added and a second `add` would silently write over it.
  config.provider[id] = {
    npm: npm ?? DEFAULT_NPM,
    // The expanded value, not the template: whatever is in the environment right now, which
    // for a variable exported after launch is nothing. Storing the template would send the
    // literal string `{env:…}` as a credential.
    options: { apiKey: process.env[env] ?? "" },
    models: {},
    enabled: true,
  }

  return panel(`provider ${id}`, [
    { text: `added "${id}"`, tone: "success" },
    body(`  ${file}`),
    blank,
    head("1. put your key in the environment, not the config"),
    body(`     export ${env}=...`),
    blank,
    head("2. declare a model"),
    body(`     /provider change ${id} models.<model-id>.name <name>`),
    blank,
    head("3. restart jarvis"),
    // A process cannot see a variable exported after it started, so there is no version of
    // this that works without a restart. Say so rather than let it look broken.
    body("     a running process cannot see a newly exported variable"),
  ])
}

function change({ config }: Deps, id?: string, path?: string, rest: string[] = []): PanelContent {
  if (!id || !path || rest.length === 0) {
    return fail("provider change", [
      "usage: /provider change <id> <path> <value>",
      "",
      "  /provider change openai options.baseURL https://…",
      "  /provider change openai models.gpt-5.contextLimit 400000",
      "  /provider change openai enabled false",
    ])
  }
  if (!config.provider[id]) return fail(`provider ${id}`, [`no provider "${id}"`, "", `/provider add ${id} first`])

  const raw = rest.join(" ")
  const segments = path.split(".")
  const leaf = segments[segments.length - 1]!
  // The one hard rule: a secret may only ever be a reference. Enforced rather than
  // documented, so no future caller can quietly put a live key on disk.
  if (SECRET_KEY.test(leaf) && !/^\{(env|file):[^}]+\}$/.test(raw)) {
    return fail(`provider ${id}`, [
      `refusing to write a literal "${leaf}"`,
      "",
      "it would sit in plaintext in your config, and in this session's transcript.",
      "point it at the environment instead:",
      "",
      `  /provider change ${id} ${path} {env:${envName(id)}}`,
    ])
  }

  let value: unknown = raw
  try {
    value = JSON.parse(raw)
  } catch {
    // Not JSON, so it was meant as a plain string — the common case for names and URLs.
  }

  const file = persistConfig(globalConfigFile(), ["provider", id, ...segments], value)

  // Apply to the running session too. ponytail: mutates the shared Config in place, which the
  // model picker's useMemo will not notice until a restart — noted in the output rather than
  // fixed by lifting Config into state, which is a large refactor for a stale list.
  let target: Record<string, unknown> = config.provider[id] as unknown as Record<string, unknown>
  for (const segment of segments.slice(0, -1)) {
    const next = target[segment]
    if (typeof next !== "object" || next === null) {
      target = {}
      break
    }
    target = next as Record<string, unknown>
  }
  target[leaf] = value
  forgetProvider(id)

  return panel(`provider ${id}`, [
    { text: `set provider.${id}.${path}`, tone: "success" },
    body(`  ${file}`),
    blank,
    body("applies from the next turn."),
    body("the model picker's list refreshes on restart."),
    ...(leaf === "npm" ? [blank, body("the next turn may pause while the new package installs.")] : []),
  ])
}

function remove({ config, cwd }: Deps, id?: string, confirm?: string): PanelContent {
  if (!id) return fail("provider delete", ["usage: /provider delete <id>"])
  const provider = config.provider[id]
  if (!provider) return fail("provider delete", [`no provider "${id}"`])

  const file = reachability(config, cwd)[id]?.file
  const global = globalConfigFile()
  // Editing a file that is probably committed is not this command's business to do quietly.
  if (file && file !== global) {
    return fail(`provider ${id}`, [`"${id}" is declared outside your global config`, "", `  ${file}`, "", "edit that file directly"])
  }

  const models = Object.keys(provider.models).length
  const turns = readRecords().filter((entry) => entry.provider === id).length
  if (confirm !== "yes") {
    return panel(`provider ${id}`, [
      { text: `delete provider "${id}"?`, tone: "warning" },
      blank,
      body(`  ${models} model${models === 1 ? "" : "s"}`),
      body(`  ${turns} recorded turn${turns === 1 ? "" : "s"} of history, which is kept`),
      body("  only the config entry goes"),
      blank,
      head(`/provider delete ${id} yes`),
    ])
  }

  // jsonc-parser treats undefined as removal, so this needs no special case.
  persistConfig(global, ["provider", id], undefined)
  delete config.provider[id]
  forgetProvider(id)
  return panel(`provider ${id}`, [{ text: `deleted "${id}"`, tone: "success" }, body(`  ${global}`)])
}

function statsLines(roll: ProviderRoll, reach: Reach | undefined, width: number): Line[] {
  const rate = roll.turns > 0 ? ((roll.turns - roll.failures) / roll.turns) * 100 : 0
  const peak = Math.max(...roll.days.map((day) => day.turns))
  // Day label, counts and cost take 36, and a bad day adds "  N fail". Both have to come out
  // of the bar's budget: a row that overflows wraps, and a wrapped bar chart is unreadable.
  const field = Math.max(10, width - 46)
  // Days before the provider was ever used are padding, not information. Gaps *inside* the
  // used range stay, because a day that went quiet is the thing worth noticing.
  const days = roll.days.slice(roll.days.findIndex((day) => day.turns > 0))

  return [
    ...providerHeading(roll.provider, reach, []),
    body(
      `  ${roll.turns} turns  ${roll.failures} failed  ${rate.toFixed(1)}%      ` +
        `${thousands(roll.input)} in  ${thousands(roll.output)} out  $${roll.cost.toFixed(2)}   p50 ${seconds(roll.p50ms)}`,
    ),
    ...days.map((day) => ({
      text: (
        `  ${day.day}  ${bar(day.turns, peak, field).padEnd(field)}  ` +
        `${String(day.turns).padStart(4)} turns   ${day.turns > 0 ? `$${day.cost.toFixed(2)}` : ""}` +
        `${day.failures > 0 ? `  ${day.failures} fail` : ""}`
      ).trimEnd(),
      // A day that lost turns is the one row worth catching an eye.
      tone: day.failures > 0 ? ("warning" as const) : undefined,
    })),
    // Clipped, not wrapped: these sit under a column-aligned chart, and a second line would
    // read as another day's row.
    ...(roll.worstOutage && roll.worstOutage.failures > 1
      ? [
          {
            text: clip(
              `  worst outage  ${short(roll.worstOutage.from)} → ${time(roll.worstOutage.to)}  ` +
                `${roll.worstOutage.failures} failed turns, observed`,
              width,
            ),
            tone: "warning" as const,
          },
        ]
      : []),
    ...(roll.lastError
      ? [body(clip(`  last error    ${short(roll.lastError.at)}  ${roll.lastError.message.split("\n")[0]}`, width))]
      : []),
  ]
}

function stats({ config, cwd, width }: Deps, args: string[]): PanelContent {
  const days = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 14)
  const only = args.find((arg) => !/^\d+$/.test(arg))
  const rolls = rollup(readRecords(), days).filter((roll) => !only || roll.provider === only)
  const reach = reachability(config, cwd)

  // Providers that have never served a turn still matter — a misconfigured one is exactly
  // what someone runs this command to find, and it has no records by definition.
  const idle = Object.keys(config.provider).filter(
    (id) => !rolls.some((roll) => roll.provider === id) && (!only || id === only),
  )
  if (rolls.length === 0 && idle.length === 0) return panel("provider stats", [body("no providers configured")])

  const lines: Line[] = [{ text: `last ${days} days${only ? ` · ${only}` : ""}`, tone: "dim" }, blank]
  if (rolls.length === 0) {
    lines.push(body("no turns recorded yet — history starts accruing from the next message"), blank)
  }
  for (const roll of rolls) lines.push(...statsLines(roll, reach[roll.provider], width), blank)
  for (const id of idle) lines.push(...providerHeading(id, reach[id], []), body("  0 turns — never used"), blank)
  return panel("provider stats", lines)
}

/**
 * `/provider` — inspect, add, change, delete and account for providers without hand-editing
 * JSONC. Returns panel content rather than transcript text: the tables and charts are far
 * taller than a note reads comfortably, and a panel can color the key state.
 */
export function providerCommand(args: string, deps: Deps): PanelContent {
  const [sub = "view", ...rest] = args.split(/\s+/).filter(Boolean)

  switch (sub) {
    case "view":
    case "list":
      return view(deps, rest[0])
    case "add":
      return add(deps, rest[0], rest[1])
    case "change":
    case "set":
      return change(deps, rest[0], rest[1], rest.slice(2))
    case "delete":
    case "remove":
      return remove(deps, rest[0], rest[1])
    case "stats":
    case "viewstats":
      return stats(deps, rest)
    default:
      return fail("provider", [`unknown action "${sub}"`, "", "view · add · change · delete · stats"])
  }
}
