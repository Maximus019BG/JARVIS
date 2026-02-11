import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { user } from "./user";
import { workstation } from "./workstation";

export const automation = pgTable("automation", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),

  // draft | active | paused | archived
  status: text("status").notNull().default("draft"),

  // currently published version number, if any
  publishedVersion: integer("published_version"),

  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),

  // Legacy: existing UI persists graph JSON here.
  // Will be superseded by `automation_version.editor_graph`.
  metadata: text("metadata"),

  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id),
});
