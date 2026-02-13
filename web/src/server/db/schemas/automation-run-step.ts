import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { automationRun } from "./automation-run";

// Execution log of steps within a run.
export const automationRunStep = pgTable("automation_run_step", {
  id: text("id").primaryKey(),

  runId: text("run_id")
    .notNull()
    .references(() => automationRun.id),

  index: integer("index").notNull(),

  // queued | running | succeeded | failed | skipped
  status: text("status").notNull().default("queued"),

  type: text("type").notNull(),
  name: text("name"),

  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),

  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),

  createdAt: timestamp("created_at").notNull(),
});
