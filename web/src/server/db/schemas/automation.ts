import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./user";
import { workstation } from "./workstation";

export const automation = pgTable("automation", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  metadata: text("metadata"),
  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id),
});
