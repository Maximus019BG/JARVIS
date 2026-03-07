import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { workstation } from "~/server/db/schemas/workstation";
import { user } from "~/server/db/schemas/user";
import { device } from "~/server/db/schemas/device";

export const scriptFile = pgTable("script_file", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  language: text("language").notNull().default("python"),
  source: text("source").notNull(),
  version: integer("version").notNull().default(1),
  hash: text("hash"),
  syncStatus: text("sync_status").default("synced"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
});
