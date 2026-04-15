import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { blueprint } from "./blueprint";
import { user } from "./user";
import { device } from "./device";

/**
 * Immutable snapshot of a blueprint at each version.
 *
 * Every time the `push` route creates or updates a blueprint, the
 * previous content is written here so that users can browse history
 * and roll back to any past version.
 */
export const blueprintVersion = pgTable("blueprint_version", {
  id: text("id").primaryKey(),

  blueprintId: text("blueprint_id")
    .notNull()
    .references(() => blueprint.id, { onDelete: "cascade" }),

  version: integer("version").notNull(),

  /** Serialised JSON snapshot of the blueprint `data` at this version. */
  metadata: text("metadata").notNull(),

  hash: text("hash"),

  /** Device that pushed this version (nullable – may be a web save). */
  deviceId: text("device_id").references(() => device.id, {
    onDelete: "set null",
  }),

  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
});
