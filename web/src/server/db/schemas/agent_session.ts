import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { device } from "./device";
import { user } from "./user";
import { workstation } from "./workstation";

/**
 * A mirror of one TUI session: its header, its metrics, and the raw JSONL transcript.
 *
 * Named `agent_session` because `session` is better-auth's. One text blob rather than a
 * row per message — the viewer parses it, and nothing needs SQL over message content.
 */
export const agentSession = pgTable("agent_session", {
  /** The TUI's own `ses_…` id, so re-pushing a grown session is an upsert, not a fork. */
  id: text("id").primaryKey(),
  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  cwd: text("cwd").notNull(),
  startedAt: timestamp("started_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  /**
   * JSONL line count, and the whole sync cursor: the client compares it to decide what to
   * re-send. Deliberately not a byte offset — `setTitle` rewrites the first line in place,
   * so offsets shift under a rename while the line count does not.
   */
  lines: integer("lines").notNull(),
  transcript: text("transcript").notNull(),
  turns: integer("turns").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  /** Integer micros. Money in a float is how you end up with $0.30000000000000004. */
  costMicros: integer("cost_micros").notNull().default(0),
});
