import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { automation } from "./automation";
import { user } from "./user";

// Versioned automation artifacts.
//
// Note: migrations are intentionally deferred per project direction.
// These schemas establish the target model used by new APIs and code paths.
export const automationVersion = pgTable("automation_version", {
  id: text("id").primaryKey(),

  automationId: text("automation_id")
    .notNull()
    .references(() => automation.id),

  version: integer("version").notNull(),

  // Raw editor graph (ReactFlow nodes/edges + UI state)
  editorGraph: jsonb("editor_graph").notNull(),

  // Normalized, stable workflow definition (DSL)
  definition: jsonb("definition"),

  // Runner-oriented compiled representation (DAG, step ids)
  compiledPlan: jsonb("compiled_plan"),

  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),

  createdAt: timestamp("created_at").notNull(),
});
