import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { device } from "./device";
import { user } from "./user";
import { workstation } from "./workstation";

/**
 * An item a device taught the workstation to find (`/api/vision/items`). No photos are
 * kept: `pos` is what the item looks like and `neg` what it was photographed against,
 * each up to 256 DINOv2 patch features packed by `packBank` in `~/server/vision`.
 */
export const visionItem = pgTable(
  "vision_item",
  {
    id: text("id").primaryKey(),
    workstationId: text("workstation_id")
      .notNull()
      .references(() => workstation.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => device.id, {
      onDelete: "set null",
    }),
    /** Unique per workstation: teaching the same name again replaces the item. */
    name: text("name").notNull(),
    /** How many photos it was taught from. */
    samples: integer("samples").notNull(),
    pos: text("pos").notNull(),
    neg: text("neg").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vision_item_name_unique").on(table.workstationId, table.name),
  ],
);
