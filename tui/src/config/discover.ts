import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { configDir, configNames } from "./paths.ts"

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

const trustFile = join(configDir, "trusted.json")

/**
 * Directories the user trusted with `jarvis trust`. A repo's `jarvis.jsonc` can set permissions,
 * `baseURL` and `{secret:}`/`{file:}` values, and `.jarvis/{plugins,tools}` is code imported at
 * startup — so cloning a repo and running jarvis in it must not hand it any of that unasked.
 */
export function trustedDirs(): string[] {
  try {
    const list: unknown = JSON.parse(readFileSync(trustFile, "utf8"))
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

/** Whether `target` is `root` or lives underneath it. Both must already be resolved. */
export function within(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** True when `dir` is a trusted directory or inside one. */
export function isTrusted(dir: string, trusted = trustedDirs()): boolean {
  const target = resolve(dir)
  return trusted.some((root) => within(root, target))
}

/** Adds `dir` to the trusted list and returns it, resolved. */
export function trust(dir: string): string {
  const root = resolve(dir)
  const trusted = trustedDirs()
  if (!trusted.includes(root)) {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(trustFile, `${JSON.stringify([...trusted, root], null, 2)}\n`)
  }
  return root
}

/** `ancestors(cwd)` the user trusts: the only places project config and `.jarvis` load from. */
export function trustedAncestors(cwd = process.cwd()): string[] {
  const trusted = trustedDirs()
  return ancestors(cwd).filter((dir) => isTrusted(dir, trusted))
}

/** Project config files and `.jarvis` directories skipped because their directory isn't trusted. */
export function untrustedConfig(cwd = process.cwd()): string[] {
  const trusted = trustedDirs()
  return ancestors(cwd)
    .filter((dir) => !isTrusted(dir, trusted))
    .flatMap((dir) => [...configNames.map((name) => join(dir, name)), join(dir, ".jarvis")])
    .filter((path) => existsSync(path))
}

/** One line saying which project config was skipped and how to load it, or nothing. */
export function trustNotice(cwd = process.cwd()): string | undefined {
  const skipped = untrustedConfig(cwd)
  if (skipped.length === 0) return undefined
  return `ignoring ${skipped.join(", ")} — this directory isn't trusted. Run \`jarvis trust\` to load it.`
}

/**
 * The global config directory, then every trusted `<ancestor>/.jarvis`. Ordered so the
 * nearest directory comes last and therefore wins when definitions are merged.
 */
export function jarvisDirs(cwd = process.cwd()): string[] {
  return [configDir, ...trustedAncestors(cwd).map((dir) => join(dir, ".jarvis"))]
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
