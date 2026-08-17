import { pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { blueprint } from "./blueprint";
import { user } from "./user";
import { device } from "./device";

/**
 * Immutable snapshot of a blueprint at one commit.
 *
 * The device's local git repo is the source of truth; this table mirrors it so the web
 * can show history without a checkout. Rows are append-only — "restore" adds a new
 * version equal to an old one, it never rewrites what happened.
 */
export const blueprintVersion = pgTable(
  "blueprint_version",
  {
    id: text("id").primaryKey(),

    blueprintId: text("blueprint_id")
      .notNull()
      .references(() => blueprint.id, { onDelete: "cascade" }),

    version: integer("version").notNull(),

    /** The serialised BlueprintDoc at this commit. */
    metadata: text("metadata").notNull(),

    hash: text("hash"),

    /** Short sha of the local git commit this mirrors. */
    commitSha: text("commit_sha"),
    /** The commit this one built on — what makes a push fast-forward-only. */
    parentSha: text("parent_sha"),
    message: text("message"),

    /** Device that pushed this version (nullable – may be a web save). */
    deviceId: text("device_id").references(() => device.id, {
      onDelete: "set null",
    }),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // Re-pushing a commit must be a no-op, not a duplicate row. This is what lets the push
  // endpoint be retried safely when a reply is lost in flight.
  (table) => [uniqueIndex("blueprint_version_commit_unique").on(table.blueprintId, table.commitSha)],
);
