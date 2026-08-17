import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { device } from "./device";
import { user } from "./user";

/**
 * One permission prompt a paired device is blocked on, so it can be answered away from
 * the terminal. The TUI creates a row, polls it, and unblocks on whatever lands in
 * `answer`.
 *
 * No `userId` column: the owner is `device.userId`. One join, and nothing to go stale
 * when a device is reassigned.
 */
export const approval = pgTable(
  "approval",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    /** Tool being gated — `bash`, `edit`, `mcp`, … */
    tool: text("tool").notNull(),
    title: text("title").notNull(),
    /** The command, or a unified diff. Capped by the route, not the column. */
    detail: text("detail"),
    /** `diff` | `text`, mirroring the TUI's `PermissionRequest.detailKind`. */
    detailKind: text("detail_kind"),
    subject: text("subject"),
    /**
     * NULL means pending, and is what makes the race safe: the answer write is
     * conditional on it, so the first writer wins and every later one gets a 409.
     * `once` | `reject` from a human, `cancelled` when the terminal answered first.
     */
    answer: text("answer"),
    answeredBy: text("answered_by").references(() => user.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("approval_device_idx").on(table.deviceId)],
);
