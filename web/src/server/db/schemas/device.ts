import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { user } from './user';
import { workstation } from './workstation';

/**
 * A paired machine — a laptop running the TUI, or a Pi. A row exists only once a human
 * has approved the pairing, which is why `workstationId` and `userId` can be NOT NULL
 * here while a pending request lives in `device_link` instead.
 */
export const device = pgTable("device", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  workstationId: text("workstation_id").notNull().references(() => workstation.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  /**
   * sha256 of the bearer token, never the token itself — a database dump must not hand
   * anyone write access. Nullable so revoking can clear it. The column keeps its original
   * name to avoid a rename migration on a table that already shipped.
   */
  tokenHash: text("device_token").unique(),
  /** First characters of the token, in clear, so the UI can identify it. */
  tokenPrefix: text("token_prefix"),
  /** sha256(machine-id + hostname), shown at approval so the user knows what they let in. */
  fingerprint: text("fingerprint"),
  platform: text("platform"),
  /** `active` | `revoked`. Checked on every authenticated request. */
  status: text("status").notNull().default("active"),
  approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").default(true),
});
