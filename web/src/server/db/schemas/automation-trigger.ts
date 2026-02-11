import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { automation } from "./automation";
import { workstation } from "./workstation";

// Defines how an automation is invoked.
// Minimal support: webhook trigger.
export const automationTrigger = pgTable("automation_trigger", {
  id: text("id").primaryKey(),

  automationId: text("automation_id")
    .notNull()
    .references(() => automation.id),

  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id),

  // webhook
  type: text("type").notNull(),

  // For webhook trigger: a stable public key/slug in the URL.
  key: text("key").notNull(),

  config: jsonb("config"),

  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
});
