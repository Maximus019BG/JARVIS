import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "~/server/db/schemas/user";

// This represents a workstation in the UI, but uses "organization" table name for Better-Auth compatibility
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
