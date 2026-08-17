import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { blueprint } from './blueprint';
import { device } from './device';
import { user } from './user';

/**
 * What a device is allowed to reach. Checked server-side on every push and pull — the UI
 * showing a narrower list is a convenience, this table is the rule.
 *
 * `blueprintId` NULL means every blueprint in the device's workstation, including ones
 * created later. That is the "all blueprints" switch in the access sheet.
 */
export const deviceGrant = pgTable(
  "device_grant",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
    blueprintId: text("blueprint_id").references(() => blueprint.id, { onDelete: "cascade" }),
    /** `read` | `write`. A push against a read grant is a 403. */
    mode: text("mode").notNull().default("write"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Two partial indexes rather than one on (device_id, blueprint_id): Postgres treats
    // NULLs as distinct in a unique index, so a plain one would happily allow a device
    // twenty "all blueprints" grants — and revoking one would leave the rest in force.
    uniqueIndex("device_grant_blueprint_unique")
      .on(table.deviceId, table.blueprintId)
      .where(sql`${table.blueprintId} is not null`),
    uniqueIndex("device_grant_all_unique").on(table.deviceId).where(sql`${table.blueprintId} is null`),
  ],
);
