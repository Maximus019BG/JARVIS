import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, modify } from "jsonc-parser"
import type { Permission } from "./config.ts"
import { projectRoot } from "./discover.ts"
import { configNames, projectDir } from "./paths.ts"

/**
 * Records a permission rule in the project's `.jarvis` config. Uses jsonc-parser's
 * surgical edit rather than a re-serialize, so the user's comments and formatting survive
 * having a rule appended to them.
 */
export function persistPermission(cwd: string, key: string, permission: Permission): string {
  const dir = projectDir(projectRoot(cwd) ?? cwd)
  // Prefer a config that already exists, so we never create a second one alongside it.
  const existing = configNames.map((name) => join(dir, name)).find((path) => existsSync(path))
  const file = existing ?? join(dir, configNames[0]!)

  const before = existsSync(file) ? readFileSync(file, "utf8") : "{}\n"
  const after = applyEdits(before, modify(before, ["permission", key], permission, {}))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, after)
  return file
}
