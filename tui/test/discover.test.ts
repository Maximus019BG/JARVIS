import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAgents } from "../src/agent-def.ts"
import { loadCommands } from "../src/command.ts"
import { ConfigSchema, configFiles } from "../src/config.ts"
import { ancestors, projectRoot, resourceDirs, resourceFiles } from "../src/discover.ts"

import { listThemes, loadTheme } from "../src/theme.ts"

/** A repo with a `.git` marker, so the upward walk is bounded like a real project. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "jarvis-discover-"))
  mkdirSync(join(root, ".git"))
  return root
}

function put(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content)
  return path
}

describe("projectRoot", () => {
  test("stops at the nearest .git", () => {
    const root = repo()
    const nested = join(root, "a", "b")
    mkdirSync(nested, { recursive: true })
    expect(projectRoot(nested)).toBe(root)
  })

  test("falls back to the filesystem root outside a repo", () => {
    const bare = mkdtempSync(join(tmpdir(), "jarvis-bare-"))
    expect(projectRoot(bare)).toBe("/")
  })
})

describe("ancestors", () => {
  test("runs outermost to innermost, bounded by the project root", () => {
    const root = repo()
    const nested = join(root, "a", "b")
    mkdirSync(nested, { recursive: true })
    expect(ancestors(nested)).toEqual([root, join(root, "a"), nested])
  })
})

describe("resourceDirs", () => {
  test("accepts plural and singular names, and only returns directories that exist", () => {
    const root = repo()
    mkdirSync(join(root, ".jarvis", "agents"), { recursive: true })
    mkdirSync(join(root, ".jarvis", "agent"), { recursive: true })
    expect(resourceDirs(root, "agents").slice(-2)).toEqual([
      join(root, ".jarvis", "agent"),
      join(root, ".jarvis", "agents"),
    ])
    expect(resourceDirs(root, "skills").filter((dir) => dir.startsWith(root))).toEqual([])
  })

  test("nested .jarvis directories come after their parents so the nearest wins", () => {
    const root = repo()
    const nested = join(root, "pkg")
    mkdirSync(join(root, ".jarvis", "commands"), { recursive: true })
    mkdirSync(join(nested, ".jarvis", "commands"), { recursive: true })
    const dirs = resourceDirs(nested, "commands").filter((dir) => dir.startsWith(root))
    expect(dirs).toEqual([join(root, ".jarvis", "commands"), join(nested, ".jarvis", "commands")])
  })

  test("resourceFiles only returns the requested extension", () => {
    const root = repo()
    put(join(root, ".jarvis", "tools", "a.ts"), "")
    put(join(root, ".jarvis", "tools", "b.md"), "")
    expect(resourceFiles(root, "tools", ".ts")).toEqual([join(root, ".jarvis", "tools", "a.ts")])
  })
})

describe("agents and commands from .jarvis", () => {
  test("a nested definition overrides a shallower one of the same name", () => {
    const root = repo()
    const nested = join(root, "pkg")
    put(join(root, ".jarvis", "agents", "shared.md"), "---\ndescription: outer\n---\nouter prompt\n")
    put(join(nested, ".jarvis", "agents", "shared.md"), "---\ndescription: inner\n---\ninner prompt\n")
    const agents = loadAgents(ConfigSchema.parse({}), nested)
    expect(agents.shared).toMatchObject({ description: "inner", prompt: "inner prompt" })
  })

  test("plural and singular command directories are both read", () => {
    const root = repo()
    put(join(root, ".jarvis", "commands", "plural.md"), "---\ndescription: p\n---\ndo p\n")
    put(join(root, ".jarvis", "command", "singular.md"), "---\ndescription: s\n---\ndo s\n")
    const names = loadCommands(root).map((command) => command.name)
    expect(names).toContain("plural")
    expect(names).toContain("singular")
  })
})

describe("themes from .jarvis", () => {
  test("a project theme is listed and overrides only the tokens it sets", () => {
    const root = repo()
    put(join(root, ".jarvis", "themes", "midnight.json"), JSON.stringify({ accent: "#abcdef" }))
    expect(listThemes(root)).toContain("midnight")
    const theme = loadTheme("midnight", root)
    expect(theme.accent).toBe("#abcdef")
    expect(theme.fg).toBe("#c9d1d9")
  })

  test("a malformed theme file falls back instead of throwing", () => {
    const root = repo()
    put(join(root, ".jarvis", "themes", "broken.json"), "{ not json")
    expect(loadTheme("broken", root).accent).toBe("#58a6ff")
  })
})

describe("configFiles", () => {
  test("reads both jarvis.jsonc and .jarvis/jarvis.json, nearest last", () => {
    const root = repo()
    const nested = join(root, "pkg")
    put(join(root, "jarvis.jsonc"), "{}")
    put(join(root, ".jarvis", "jarvis.json"), "{}")
    put(join(nested, "jarvis.jsonc"), "{}")
    expect(configFiles(nested).filter((file) => file.startsWith(root))).toEqual([
      join(root, "jarvis.jsonc"),
      join(root, ".jarvis", "jarvis.json"),
      join(nested, "jarvis.jsonc"),
    ])
  })
})
