#!/usr/bin/env bun
import { join } from "node:path"
import { z } from "zod"
import { ConfigSchema } from "../src/config/config.ts"

/** The zod schema is the source of truth; this makes editors aware of it too. */
const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "jarvis config",
  ...z.toJSONSchema(ConfigSchema, { io: "input", target: "draft-7" }),
}

const out = join(import.meta.dir, "..", "jarvis.schema.json")
await Bun.write(out, `${JSON.stringify(schema, null, 2)}\n`)
process.stdout.write(`wrote ${out}\n`)
