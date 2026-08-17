import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { device } from "./device";
import { user } from "./user";
import { workstation } from "./workstation";

/**
 * One row per AI gateway request. This is both the bill and the rate-limit counter.
 *
 * The row is written *before* the upstream call, with `status: "pending"`, and settled after.
 * That ordering is deliberate: a stream the client abandons never reaches its flush handler, so
 * a post-hoc insert would bill nothing *and count nothing* — a client that always aborts would
 * face no rate limit at all.
 *
 * Deliberately holds no prompt, no completion and no headers. A gateway that logs bodies is a
 * gateway that leaks them; if you are tempted to add a `request` column, don't.
 */
export const gatewayUsage = pgTable(
  "gateway_usage",
  {
    /** `gwu_${nanoid(16)}`, app-generated like every other id here. */
    id: text("id").primaryKey(),
    deviceId: text("device_id").references(() => device.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workstationId: text("workstation_id")
      .notNull()
      .references(() => workstation.id, { onDelete: "cascade" }),
    /** What the client asked for, before aliasing. A "jarvis-default" bill stays attributable. */
    requestedModel: text("requested_model").notNull(),
    /** Empty until an upstream is chosen — a request rejected by quota never had one. */
    upstreamName: text("upstream_name").notNull().default(""),
    upstreamModel: text("upstream_model").notNull().default(""),
    /** pending | ok | upstream_error | upstream_timeout | client_abort | rejected */
    status: text("status").notNull(),
    streamed: boolean("streamed").notNull().default(false),
    /** True when the tokens did not come from the upstream's own `usage` block. */
    estimated: boolean("estimated").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Integer micros. Money in a float is how you end up with $0.30000000000000004. */
    costMicros: integer("cost_micros").notNull().default(0),
    /** Upstream HTTP status, for triage. Null when the call never connected. */
    upstreamStatus: integer("upstream_status"),
    latencyMs: integer("latency_ms"),
    /** How many upstreams the fallback chain burned through. */
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // The only indexed table in this directory, and worth explaining: unlike sync_log, which
    // takes a row per push, this takes a row per completion and is read before every single one
    // to check the rate limit and the monthly spend. Without these that read is a sequential
    // scan that gets slower exactly as traffic grows.
    index("gateway_usage_device_created_idx").on(table.deviceId, table.createdAt),
    index("gateway_usage_user_created_idx").on(table.userId, table.createdAt),
  ],
);
