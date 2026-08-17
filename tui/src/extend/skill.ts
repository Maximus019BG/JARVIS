import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, join, relative } from "node:path"
import matter from "gray-matter"
import { resourceDirs } from "../config/discover.ts"

export type Skill = {
  name: string
  description: string
  /** The SKILL.md body, without frontmatter. */
  body: string
  /** Directory holding SKILL.md and any supporting files. */
  dir: string
}

export type Skills = { skills: Skill[]; errors: string[] }

/** opencode's rule: 1–64 chars, lowercase alphanumeric with single hyphens. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Every `<jarvis dir>/skills/<name>/SKILL.md`. The nearest definition of a name wins,
 * so a project skill can shadow a global one.
 */
export function loadSkills(cwd = process.cwd()): Skills {
  const found = new Map<string, Skill>()
  const errors: string[] = []

  for (const dir of resourceDirs(cwd, "skills")) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue
      const skillDir = join(dir, entry.name)
      const file = join(skillDir, "SKILL.md")
      if (!existsSync(file)) continue

      const parsed = matter(readFileSync(file, "utf8"))
      const data = parsed.data as { name?: unknown; description?: unknown }
      const name = typeof data.name === "string" ? data.name : entry.name
      if (name.length > 64 || !NAME.test(name)) {
        errors.push(`${file}: name "${name}" must be lowercase alphanumeric with single hyphens, 1-64 chars`)
        continue
      }
      if (name !== entry.name) {
        errors.push(`${file}: name "${name}" must match its directory "${entry.name}"`)
        continue
      }
      if (typeof data.description !== "string" || !data.description.trim()) {
        errors.push(`${file}: frontmatter needs a description`)
        continue
      }
      found.set(name, { name, description: data.description.trim(), body: parsed.content.trim(), dir: skillDir })
    }
  }
  return { skills: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), errors }
}

/** Supporting files next to SKILL.md, so the model knows what it can read. */
export function skillFiles(skill: Skill, limit = 40): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= limit || entry.name.startsWith(".")) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (basename(path) !== "SKILL.md") files.push(relative(skill.dir, path))
    }
  }
  walk(skill.dir)
  return files.sort()
}
