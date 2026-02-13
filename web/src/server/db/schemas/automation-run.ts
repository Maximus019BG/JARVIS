import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";
import { automation } from "./automation";
import { automationVersion } from "./automation-version";
import { workstation } from "./workstation";

// A single execution instance of a specific published automation version.
// Note: migrations are intentionally deferred.
export const automationRun = pgTable("automation_run", {
  id: text("id").primaryKey(),

  automationId: text("automation_id")
    .notNull()
    .references(() => automation.id),

  automationVersionId: text("automation_version_id")
    .notNull()
    .references(() => automationVersion.id),

  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id),

  // queued | running | succeeded | failed | canceled
  status: text("status").notNull().default("queued"),

  triggerId: text("trigger_id"),

  // request/trigger payload; runner context
  input: jsonb("input"),

  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),

  // Optional lightweight counters/summary
  stepCount: integer("step_count").notNull().default(0),

  createdAt: timestamp("created_at").notNull(),
});
