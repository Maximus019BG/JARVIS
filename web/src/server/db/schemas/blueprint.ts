import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workstation } from "~/server/db/schemas/workstation";
import { user } from "./user";

export const blueprint = pgTable("blueprint", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  metadata: text("metadata"),
  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id, { onDelete: "cascade" }),
});
