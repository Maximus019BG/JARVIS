import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { dynamicTool, jsonSchema } from "ai"
import type { Config, McpConfig } from "../config/config.ts"
import type { ToolSet } from "../tools/index.ts"

export type McpStatus = { server: string; tools: number; error?: string }

/** Tool names are namespaced so two servers exposing `search` do not collide. */
export const MCP_PREFIX = "mcp_"
export const toolName = (server: string, tool: string) => `${MCP_PREFIX}${server}_${tool}`

async function connect(server: string, config: McpConfig): Promise<Client> {
  const client = new Client({ name: "jarvis", version: "0.1.0" })
  const [command, ...args] = config.type === "local" ? config.command : [""]
  const transport =
    config.type === "local"
      ? new StdioClientTransport({
          command: command!,
          args,
          env: { ...(process.env as Record<string, string>), ...config.environment },
          cwd: config.cwd,
          stderr: "ignore",
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        })
  await client.connect(transport)
  return client
}

/** MCP content blocks come back as an array; the model wants one string. */
function flatten(result: unknown): string {
  const content = (result as { content?: unknown[] }).content
  if (!Array.isArray(content)) return JSON.stringify(result)
  return content
    .map((block) => {
      const part = block as { type?: string; text?: string; resource?: { text?: string } }
      if (part.type === "text") return part.text ?? ""
      if (part.type === "resource") return part.resource?.text ?? JSON.stringify(part)
      return `[${part.type ?? "unknown"} content]`
    })
    .join("\n")
    .trim()
}

async function serverTools(server: string, client: Client): Promise<ToolSet> {
  const { tools } = await client.listTools()
  return Object.fromEntries(
    tools.map((definition) => [
      toolName(server, definition.name),
      dynamicTool({
        description: definition.description ?? `${definition.name} (via the ${server} MCP server)`,
        inputSchema: jsonSchema(definition.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (input) => {
          const result = await client.callTool({ name: definition.name, arguments: input as Record<string, unknown> })
          const text = flatten(result)
          if (result.isError) throw new Error(text || `${definition.name} failed`)
          return text || "(no output)"
        },
      }),
    ]),
  )
}

export type McpSession = {
  tools: ToolSet
  status: McpStatus[]
  close: () => Promise<void>
}

/**
 * Connects to every enabled server and collects their tools. A server that fails
 * to start is reported in `status` and skipped — it never blocks startup.
 */
export async function startMcp(config: Config): Promise<McpSession> {
  const entries = Object.entries(config.mcp).filter(([, server]) => server.enabled)
  const clients: Client[] = []
  const tools: ToolSet = {}
  const status: McpStatus[] = []

  await Promise.all(
    entries.map(async ([name, server]) => {
      try {
        const client = await connect(name, server)
        clients.push(client)
        const found = await serverTools(name, client)
        Object.assign(tools, found)
        status.push({ server: name, tools: Object.keys(found).length })
      } catch (error) {
        status.push({ server: name, tools: 0, error: error instanceof Error ? error.message : String(error) })
      }
    }),
  )

  return {
    tools,
    status: status.sort((a, b) => a.server.localeCompare(b.server)),
    close: async () => {
      await Promise.all(clients.map((client) => client.close().catch(() => {})))
    },
  }
}
