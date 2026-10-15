import { index, pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { device } from './device';
import { blueprint } from './blueprint';

export const syncLog = pgTable("sync_log", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").references(() => blueprint.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  versionBefore: integer("version_before"),
  versionAfter: integer("version_after"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // The per-device push rate limit counts this device's rows from the last minute.
  index("sync_log_device_created_idx").on(table.deviceId, table.createdAt),
]);