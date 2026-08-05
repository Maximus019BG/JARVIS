// Bun-only, like store.ts — the web never imports this.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { dataDir } from "../config/paths.ts"
import { BlueprintError } from "./schema.ts"

/**
 * Deliberately not `jarvis.jsonc`: that file gets committed, and a device token in a
 * repository is a device token on the internet. Written 0600 under the data dir instead.
 */
export const credentialsPath = join(dataDir, "credentials.json")

const CredentialsSchema = z.object({
  baseUrl: z.string(),
  deviceId: z.string(),
  token: z.string(),
  workstationId: z.string(),
  name: z.string().optional(),
})

export type Credentials = z.infer<typeof CredentialsSchema>

export function readCredentials(path = credentialsPath): Credentials | undefined {
  if (!existsSync(path)) return undefined
  const parsed = CredentialsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
  if (!parsed.success) throw new BlueprintError(`${path} is not valid credentials — delete it and pair again`)
  return parsed.data
}

export function writeCredentials(credentials: Credentials, path = credentialsPath): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  // Explicit chmod as well: writeFileSync's mode is masked by the process umask, and an
  // existing file keeps its old permissions entirely.
  chmodSync(path, 0o600)
}

export function requireCredentials(path = credentialsPath): Credentials {
  const found = readCredentials(path)
  if (!found) throw new BlueprintError("this device is not paired — run `jarvis pair` first")
  return found
}
