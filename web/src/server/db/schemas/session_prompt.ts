import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { agentSession } from "./agent_session";
import { user } from "./user";

/**
 * A prompt typed into the web app for a TUI session to pick up, so a session can be steered
 * from away from the terminal. The mirror image of `approval`: there the terminal asks and
 * the web answers, here the web asks and the terminal acts.
 *
 * No `userId` for ownership: the owner is the session's workstation's user, one join away,
 * with nothing to go stale. `createdBy` is who typed it, which is a different question and
 * matters for an audit trail.
 *
 * Delivery is at-most-once by construction — the claim is a conditional `UPDATE` off
 * `pending`, so a prompt cannot be handed to two terminals or replayed after a retry.
 */
export const sessionPrompt = pgTable(
  "session_prompt",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => agentSession.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    /**
     * `pending` until a workstation claims it, then `delivered`. `cancelled` is the author
     * changing their mind before it was picked up — never a state a device puts it in.
     */
    status: text("status").notNull().default("pending"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
  },
  (table) => [index("session_prompt_session_status_idx").on(table.sessionId, table.status)],
);
