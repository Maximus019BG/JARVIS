import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { configDir } from "./paths.ts"

/** The kinds of thing a `.jarvis` directory can hold, by their plural directory name. */
export type ResourceKind = "agents" | "commands" | "tools" | "plugins" | "skills" | "themes"

/** Singular aliases are accepted so either naming works. */
const SINGULAR: Record<ResourceKind, string> = {
  agents: "agent",
  commands: "command",
  tools: "tool",
  plugins: "plugin",
  skills: "skill",
  themes: "theme",
}

/**
 * Nearest ancestor holding a `.git`, else the filesystem root. Bounds every upward
 * walk so a stray config in a parent of the repo cannot leak in.
 */
export function projectRoot(cwd = process.cwd()): string {
  let dir = resolve(cwd)
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dir
    dir = parent
  }
}

/** Every directory from the project root down to `cwd`, outermost first. */
export function ancestors(cwd = process.cwd()): string[] {
  const root = projectRoot(cwd)
  const chain: string[] = []
  let dir = resolve(cwd)
  while (true) {
    chain.unshift(dir)
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return chain
}

/**
 * The global config directory, then every `<ancestor>/.jarvis`. Ordered so the
 * nearest directory comes last and therefore wins when definitions are merged.
 */
export function jarvisDirs(cwd = process.cwd()): string[] {
  return [configDir, ...ancestors(cwd).map((dir) => join(dir, ".jarvis"))]
}

/** Existing `<jarvis dir>/<kind>` directories, plural name preferred over singular. */
export function resourceDirs(cwd: string, kind: ResourceKind): string[] {
  const found: string[] = []
  for (const base of jarvisDirs(cwd)) {
    for (const name of [SINGULAR[kind], kind]) {
      const dir = join(base, name)
      if (existsSync(dir)) found.push(dir)
    }
  }
  return found
}

/** Files of one extension across a resource kind, in discovery order. */
export function resourceFiles(cwd: string, kind: ResourceKind, extension: string): string[] {
  return resourceDirs(cwd, kind).flatMap((dir) =>
    [...new Bun.Glob(`*${extension}`).scanSync({ cwd: dir, onlyFiles: true })].sort().map((file) => join(dir, file)),
  )
}
