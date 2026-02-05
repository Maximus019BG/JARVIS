import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { workstation } from "~/server/db/schemas/workstation";
import { user } from "./user";
import { device } from "./device";
import { syncLog } from "./sync_log";

export const blueprint = pgTable("blueprint", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  metadata: text("metadata"),
  workstationId: text("workstation_id")
    .notNull()
    .references(() => workstation.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  hash: text("hash"),
  syncStatus: text("sync_status").default("synced"),
  lastSyncedAt: timestamp("last_synced_at"),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
});

// Backwards-compatible export: some API routes import `syncLog` from this module.
export { syncLog };
