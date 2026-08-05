import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { device } from './device';

/**
 * One in-flight pairing request (RFC 8628 device authorization grant).
 *
 * The device posts its name and fingerprint, gets back a short `user_code` to show a
 * human and a long `device_code` to poll with. It cannot be a `device` row yet: nobody
 * knows which user or workstation it belongs to until someone approves it.
 *
 * Rows are short-lived — `expires_at` is ten minutes out — and are consumed on the first
 * successful token poll, so a leaked device code cannot be replayed.
 */
export const deviceLink = pgTable("device_link", {
  /** Shown to the human: 8 characters, unambiguous alphabet, formatted XXXX-XXXX. */
  userCode: text("user_code").primaryKey(),
  /** sha256 of the device code. The device holds the only copy of the real one. */
  deviceCodeHash: text("device_code_hash").notNull().unique(),
  name: text("name").notNull(),
  fingerprint: text("fingerprint").notNull(),
  platform: text("platform"),
  expiresAt: timestamp("expires_at").notNull(),
  /** Last poll, so polling faster than the advertised interval gets `slow_down`. */
  lastPolledAt: timestamp("last_polled_at"),
  /**
   * Set at approval. Approval creates the `device` row but *no* token — the token is
   * minted on the next poll and only its hash is kept, so no readable secret is ever
   * stored, not even briefly.
   */
  approvedDeviceId: text("approved_device_id").references(() => device.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
