import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { device } from './device';

export const idempotencyKey = pgTable("idempotency_key", {
  key: text("key").primaryKey(),
  deviceId: text("device_id").notNull().references(() => device.id, { onDelete: "cascade" }),
  response: text("response").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});