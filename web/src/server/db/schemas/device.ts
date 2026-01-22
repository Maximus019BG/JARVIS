import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { user } from './user';
import { workstation } from './workstation';

export const device = pgTable("device", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workstationId: text("workstation_id").notNull().references(() => workstation.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  deviceToken: text("device_token").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").default(true),
});