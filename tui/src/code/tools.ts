import { tool } from "ai"
import { z } from "zod"
import type { ToolContext } from "../tools/context.ts"
import { createProject, initProject, resolveProject } from "./project.ts"
import { clone, list, pull, push, status, type Target } from "./sync.ts"

export const CODE_ACTIONS = ["new", "init", "list", "status", "push", "pull", "clone"] as const
export type CodeAction = (typeof CODE_ACTIONS)[number]

export type CodeRequest = { action: CodeAction; name?: string; target?: Target; message?: string }

/** One implementation behind both `/code` and the `code_project` tool. */
export async function codeAction(cwd: string, { action, name, target, message }: CodeRequest): Promise<string> {
  switch (action) {
    case "new": {
      if (!name) throw new Error("name the project: /code new <name>")
      const project = createProject(cwd, name)
      return `created ${project.name} in ${project.dir}`
    }
    case "init": {
      const project = initProject(cwd, name)
      return `${project.name} is a code project (${project.dir})`
    }
    case "list":
      return list(cwd)
    case "clone":
      if (!name) throw new Error("which cloud project? /code clone <name>")
      return clone(cwd, name)
    case "status":
      return status(resolveProject(cwd, name))
    case "push":
      return push(resolveProject(cwd, name), target, message)
    case "pull":
      return pull(resolveProject(cwd, name), target)
  }
}

export const codeProjectTool = (ctx: ToolContext) =>
  tool({
    description: [
      "Create and sync code projects — git repos inside the workspace that show up in the JARVIS web app.",
      "`new` makes `<name>/` as its own repo, `init` makes the workspace itself a project, `list` and `status` only read.",
      "`push`/`pull` commit any changes and sync: `target` \"cloud\" (default) is the JARVIS cloud; any other value is a",
      "git remote the user set up, such as `origin` on GitHub. Diverged histories are merged with git and conflicts are",
      "reported, never resolved silently. `clone` brings a cloud project down into `<name>/`.",
    ].join(" "),
    inputSchema: z.object({
      action: z.enum(CODE_ACTIONS),
      name: z.string().optional().describe("Project name; optional when the workspace has exactly one"),
      target: z.string().optional().describe('"cloud" (default) or a git remote name such as "origin"'),
      message: z.string().optional().describe("Commit message for uncommitted changes, on push"),
    }),
    execute: async (request) => {
      if (request.action !== "list" && request.action !== "status") {
        const where = request.target && request.target !== "cloud" ? `git remote ${request.target}` : "the jarvis cloud"
        await ctx.gate.check({
          tool: "code_project",
          title: `${request.action} code project ${request.name ?? ""}`.trim(),
          detail: ["push", "pull", "clone"].includes(request.action) ? `${request.action} with ${where}` : request.action,
          subject: request.action,
        })
      }
      return codeAction(ctx.cwd, request as CodeRequest)
    },
  })
