import { ConfigSchema, ProviderConfigSchema, type Config, type ProviderConfig } from "./config.ts"
import { persistConfig } from "./persist.ts"
import { writeSecret } from "./secrets.ts"

/**
 * One durable change. Kept as data rather than performed inline so the whole plan can be
 * checked, shown, and ordered before anything touches the disk.
 */
export type Write =
  | { kind: "secret"; name: string; value: string }
  | { kind: "config"; path: (string | number)[]; value: unknown }

export type Check = { ok: true } | { ok: false; problems: string[] }

const issues = (error: { issues: { path: PropertyKey[]; message: string }[] }): string[] =>
  error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)

/**
 * The entry on its own. `ProviderConfigSchema` is `.strict()`, so this is what catches a stray
 * key — which matters because `persistConfig` will write literally anything, and the failure
 * would otherwise surface as an unstartable jarvis on the *next* launch.
 */
export function checkEntry(entry: unknown): { ok: true; entry: ProviderConfig } | { ok: false; problems: string[] } {
  const parsed = ProviderConfigSchema.safeParse(entry)
  return parsed.success ? { ok: true, entry: parsed.data } : { ok: false, problems: issues(parsed.error) }
}

/**
 * The whole config with the entry merged in. Catches what `checkEntry` cannot see: a top-level
 * `model` pointing at a provider/model pair that will not resolve, and any cross-field rule
 * `ConfigSchema` adds later.
 */
export function checkMerged(config: Config, id: string, entry: ProviderConfig, model?: string): Check {
  const merged = {
    ...config,
    provider: { ...config.provider, [id]: entry },
    ...(model ? { model } : {}),
  }
  const parsed = ConfigSchema.safeParse(merged)
  if (!parsed.success) return { ok: false, problems: issues(parsed.error) }
  if (model) {
    const [providerID, ...rest] = model.split("/")
    const modelID = rest.join("/")
    if (!providerID || !modelID) return { ok: false, problems: [`model: "${model}" is not provider/model`] }
    const target = providerID === id ? entry : config.provider[providerID]
    if (!target) return { ok: false, problems: [`model: no provider "${providerID}"`] }
    if (!target.models[modelID]) return { ok: false, problems: [`model: "${providerID}" declares no "${modelID}"`] }
  }
  return { ok: true }
}

/**
 * Applies an already-checked plan. Secrets first: a reload happens the moment the config write
 * lands, and a `{secret:…}` whose value is not there yet would resolve to nothing and read as a
 * broken provider for no reason.
 */
export function applyWrites(writes: Write[], file: string): { files: string[] } {
  const files = new Set<string>()
  for (const write of [...writes].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "secret" ? -1 : 1))) {
    if (write.kind === "secret") files.add(writeSecret(write.name, write.value))
    else files.add(persistConfig(file, write.path, write.value))
  }
  return { files: [...files] }
}
