/** Where the agent is about to write: the branch, and whether there is uncommitted work. */
export type Git = { branch?: string; dirty: boolean }

/**
 * `git status --porcelain --branch` output. The `## ` header carries the branch, every line
 * after it is a changed file. Pure so the tests never have to spawn git.
 */
export function parseGit(porcelain: string): Git {
  const lines = porcelain.split("\n").filter((line) => line.length > 0)
  const header = lines[0]?.startsWith("## ") ? lines[0].slice(3) : undefined
  // `main...origin/main [ahead 1]`, or `HEAD (no branch)` when detached.
  const branch = header?.split(/\.\.\.| /)[0]
  return {
    branch: branch && branch !== "HEAD" ? branch : undefined,
    dirty: lines.length > 1,
  }
}

/** One spawn for both facts. Called at startup and after each turn, never per render. */
export function readGit(cwd: string): Git {
  const result = Bun.spawnSync(["git", "status", "--porcelain", "--branch"], { cwd, stderr: "ignore" })
  return result.success ? parseGit(result.stdout.toString()) : { dirty: false }
}
