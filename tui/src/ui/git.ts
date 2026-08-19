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

/**
 * The committer's email, used only to prefill the pairing wizard.
 *
 * A guess, not an assumption: the reader sees it in the field and can type over it. Empty
 * when git is absent or unconfigured, which the wizard treats as "no prefill" rather than
 * as an error — plenty of machines have no git identity and pairing does not need one.
 */
export function gitEmail(cwd: string): string | undefined {
  const result = Bun.spawnSync(["git", "config", "--get", "user.email"], { cwd, stderr: "ignore" })
  const email = result.success ? result.stdout.toString().trim() : ""
  return email || undefined
}
