import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { configDir } from "./paths.ts"

/**
 * Keys typed into the TUI, one JSON object of name → value, written 0600.
 *
 * Deliberately not `jarvis.jsonc`: that file gets committed, and an API key in a repository is
 * an API key on the internet. The config stores only a `{secret:name}` reference.
 *
 * Deliberately not `{file:…}` either, which already exists and looks like it would do: it
 * inlines a whole file, so it can hold exactly one credential, and `substitute` *throws* when
 * the file is gone (config.ts) — which `index.tsx` turns into `exit 1`. A user who moved their
 * keys around would get an unstartable jarvis. `{secret:…}` resolves soft, like `{env:…}`.
 */
export const secretsPath = join(configDir, "secrets.json")

export type Secrets = Record<string, string>

/** `{}` when the file is absent, unreadable, or corrupt — never throws, by design. */
export function readSecrets(path = secretsPath): Secrets {
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Secrets = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(secrets: Secrets, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 })
  // Explicit chmod as well: writeFileSync's mode is masked by the umask, and an existing file
  // keeps its old permissions entirely. Same reasoning as blueprint/credentials.ts.
  chmodSync(path, 0o600)
}

export function writeSecret(name: string, value: string, path = secretsPath): string {
  writeAll({ ...readSecrets(path), [name]: value }, path)
  return path
}

export function deleteSecret(name: string, path = secretsPath): void {
  const remaining = readSecrets(path)
  if (!(name in remaining)) return
  delete remaining[name]
  // An empty file would resolve every `{secret:…}` to "" just as well, but leaving 0600 JSON
  // holding `{}` behind is untidy and invites someone to wonder what used to be in it.
  if (Object.keys(remaining).length === 0) unlinkSync(path)
  else writeAll(remaining, path)
}

/** The template a config file stores. */
export const secretRef = (name: string): string => `{secret:${name}}`

/** Set of names a `{secret:name}` template can name. Mirrors `envName`'s one-rule shape. */
export const secretName = (providerID: string): string =>
  `${providerID.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-api-key`

/** The name inside a `{secret:name}` template, or undefined if this is not one. */
export const secretRefName = (template: string): string | undefined =>
  /^\{secret:([^}]+)\}$/.exec(template)?.[1]
