import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { device } from './device';

export const nonce = pgTable("nonce", {
  value: text("value").primaryKey(),
  deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});