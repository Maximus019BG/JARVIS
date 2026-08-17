import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, modify } from "jsonc-parser"
import type { Permission } from "./config.ts"
import { projectRoot } from "./discover.ts"
import { configDir, configNames, projectDir } from "./paths.ts"

/** The config file to write in `dir`: an existing one, else the first supported name. */
export function configFileIn(dir: string): string {
  // Prefer a config that already exists, so we never create a second one alongside it.
  return configNames.map((name) => join(dir, name)).find((path) => existsSync(path)) ?? join(dir, configNames[0]!)
}

/**
 * Writes one value into a config file. Uses jsonc-parser's surgical edit rather than a
 * re-serialize, so the user's comments and formatting survive having a key changed under
 * them. `undefined` removes the key, which is what `modify` already means by it.
 */
export function persistConfig(file: string, path: (string | number)[], value: unknown): string {
  const before = existsSync(file) ? readFileSync(file, "utf8") : "{}\n"
  // Without formatting options an inserted object lands as one unindented line in the middle
  // of a hand-formatted file, which is a diff nobody wants to read.
  const after = applyEdits(
    before,
    modify(before, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, after)
  return file
}

/**
 * Records a permission rule in the *project* config: a grant is scoped to the codebase that
 * earned it, so it belongs next to that code rather than in the user's global file.
 */
export function persistPermission(cwd: string, key: string, permission: Permission): string {
  return persistConfig(configFileIn(projectDir(projectRoot(cwd) ?? cwd)), ["permission", key], permission)
}

/**
 * Providers go in the *global* config, the opposite of permissions: a credential is a
 * property of the user, and a project config is likely committed — writing a provider block
 * into a repo is exactly the accident `persistGrants` defaults off to avoid.
 */
export const globalConfigFile = () => configFileIn(configDir)
