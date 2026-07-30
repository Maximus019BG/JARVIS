#!/usr/bin/env bun
import { loadCommands } from "./extend/command.ts"
import { ConfigError, loadConfig, configFiles } from "./config/config.ts"
import { ProviderError, defaultModelID, listModels } from "./agent/provider.ts"
import { listThemes } from "./config/theme.ts"

/** Hardcoded because a compiled binary has no package.json to read. */
export const VERSION = "0.1.0"

const HELP = `jarvis — terminal coding agent

usage:
  jarvis                       start the interactive TUI
  jarvis run <prompt...>       run one prompt headlessly and print the result
  jarvis init                  scaffold a .jarvis directory in this project
  jarvis models                list configured models
  jarvis config                show config files, agents, tools, skills and plugins

options:
  -m, --model <provider/model> override the model
  -a, --agent <name>           override the agent
  -c, --continue               resume the most recent session in this directory
  -s, --session <id>           resume a specific session
  -y, --yes                    auto-approve tool permissions (headless)
  -h, --help                   show this help
  -v, --version                show the version
`

type Flags = {
  model?: string
  agent?: string
  session?: string
  continue: boolean
  yes: boolean
  help: boolean
  version: boolean
  rest: string[]
}

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { continue: false, yes: false, help: false, version: false, rest: [] }
  const takesValue: Record<string, "model" | "agent" | "session"> = {
    "-m": "model",
    "--model": "model",
    "-a": "agent",
    "--agent": "agent",
    "-s": "session",
    "--session": "session",
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const key = takesValue[arg]
    if (key) {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      flags[key] = value
    } else if (arg === "-c" || arg === "--continue") flags.continue = true
    else if (arg === "-y" || arg === "--yes") flags.yes = true
    else if (arg === "-h" || arg === "--help") flags.help = true
    else if (arg === "-v" || arg === "--version") flags.version = true
    else flags.rest.push(arg)
  }
  return flags
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.version) {
    process.stdout.write(`jarvis ${VERSION}\n`)
    return
  }
  if (flags.help) {
    process.stdout.write(HELP)
    return
  }
  const [command, ...args] = flags.rest
  const config = loadConfig()

  switch (command) {
    case "init": {
      const { init } = await import("./cli/init.ts")
      const { created, skipped } = init()
      for (const name of created) process.stdout.write(`created .jarvis/${name}\n`)
      for (const name of skipped) process.stdout.write(`kept    .jarvis/${name}\n`)
      process.stdout.write(
        created.length > 0
          ? "\nedit the examples or delete them. `cd .jarvis && bun install` if your tools need dependencies.\n"
          : "\nnothing to do — .jarvis is already set up.\n",
      )
      return
    }
    case "config": {
      const { loadExtensions } = await import("./extend/extensions.ts")
      const { loadAgents } = await import("./agent/agent-def.ts")
      const cwd = process.cwd()
      const files = configFiles(cwd)
      process.stdout.write(files.length ? `config files:\n${files.map((f) => `  ${f}`).join("\n")}\n` : "no config files found\n")

      const extensions = await loadExtensions(config, cwd)
      const lines = [
        `agents:   ${Object.keys(loadAgents(config, cwd)).join(", ")}`,
        `commands: ${loadCommands(cwd).map((c) => `/${c.name}`).join(" ")}`,
        `tools:    ${Object.keys(extensions.tools).join(", ") || "none"}`,
        `skills:   ${extensions.skills.map((s) => s.name).join(", ") || "none"}`,
        `plugins:  ${extensions.plugins.hooks.length}`,
        `themes:   ${listThemes(cwd).join(", ")}`,
      ]
      process.stdout.write(`\n${lines.join("\n")}\n`)
      for (const error of extensions.errors) process.stderr.write(`\nwarning: ${error}\n`)
      return
    }
    case "models": {
      const models = listModels(config)
      if (models.length === 0) {
        process.stdout.write("no models configured — add a `provider` entry to jarvis.jsonc\n")
        return
      }
      const active = flags.model ?? defaultModelID(config)
      for (const model of models) {
        process.stdout.write(`${model.id === active ? "*" : " "} ${model.id}\n`)
      }
      return
    }
    case "run": {
      const { runHeadless } = await import("./cli/headless.ts")
      await runHeadless({
        config,
        prompt: args.join(" "),
        model: flags.model,
        agent: flags.agent,
        yes: flags.yes,
        session: flags.session,
        resume: flags.continue,
      })
      return
    }
    case undefined: {
      const { startTui } = await import("./ui/start.tsx")
      await startTui({ config, model: flags.model, agent: flags.agent, session: flags.session, resume: flags.continue })
      return
    }
    default:
      throw new Error(`unknown command "${command}" — try jarvis --help`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const known = error instanceof ConfigError || error instanceof ProviderError
    process.stderr.write(`jarvis: ${known || error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
