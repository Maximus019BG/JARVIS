#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

/** Minimal stdio MCP server so the client wiring can be tested without a network. */
const server = new McpServer({ name: "fixture", version: "0.0.1" })

server.registerTool(
  "shout",
  { description: "Uppercase a string", inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: "text", text: text.toUpperCase() }] }),
)

server.registerTool("explode", { description: "Always fails", inputSchema: {} }, async () => ({
  isError: true,
  content: [{ type: "text", text: "boom" }],
}))

await server.connect(new StdioServerTransport())
