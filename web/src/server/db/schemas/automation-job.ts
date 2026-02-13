import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { automationRun } from "./automation-run";

// DB-backed queue for automation runner.
export const automationJob = pgTable("automation_job", {
  id: text("id").primaryKey(),

  runId: text("run_id")
    .notNull()
    .references(() => automationRun.id),

  // step index within a run (minimal runner uses 0)
  stepIndex: integer("step_index").notNull().default(0),

  // pending | running | succeeded | failed
  status: text("status").notNull().default("pending"),

  attempts: integer("attempts").notNull().default(0),

  payload: jsonb("payload"),

  lockedAt: timestamp("locked_at"),
  lockedBy: text("locked_by"),

  availableAt: timestamp("available_at").notNull(),

  lastError: text("last_error"),

  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
});
