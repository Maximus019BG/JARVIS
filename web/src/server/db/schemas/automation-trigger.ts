import { index, pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { automation } from "./automation";
import { workstation } from "./workstation";

// Defines how an automation is invoked.
// Supported: `webhook` and `cron`.
export const automationTrigger = pgTable(
  "automation_trigger",
  {
    id: text("id").primaryKey(),

    automationId: text("automation_id")
      .notNull()
      .references(() => automation.id),

    workstationId: text("workstation_id")
      .notNull()
      .references(() => workstation.id),

    // webhook | cron
    type: text("type").notNull(),

    // For webhook trigger: a stable public key/slug in the URL. Cron triggers get one too
    // rather than making the column nullable — it is never used, and an unused id is
    // cheaper than a nullable column every read has to reason about.
    key: text("key").notNull(),

    // For cron: `{ expression, tz }`, both validated before the row is written.
    config: jsonb("config"),

    /**
     * The minute a cron trigger last fired, and the whole concurrency control: the sweep
     * updates this conditionally on it being older than the current minute, so several
     * workstations polling at once still start exactly one run.
     *
     * NULL for a webhook trigger, and for a cron trigger that has never fired.
     */
    lastFiredAt: timestamp("last_fired_at"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at"),
  },
  // The sweep runs on every device poll and looks up by workstation and type, which without
  // this is a sequential scan on the hottest path in the app.
  (table) => [index("automation_trigger_workstation_type_idx").on(table.workstationId, table.type)],
);
