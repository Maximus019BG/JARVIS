import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as session from "~/server/db/schemas/session";
import * as user from "~/server/db/schemas/user";
import * as account from "~/server/db/schemas/account";
import * as workstation from "~/server/db/schemas/workstation";
import * as verification from "~/server/db/schemas/verification";
import * as twoFactor from "~/server/db/schemas/two-factor";
import * as blueprint from "~/server/db/schemas/blueprint";
import * as automation from "~/server/db/schemas/automation";
import * as automationVersion from "~/server/db/schemas/automation-version";
import * as automationRun from "~/server/db/schemas/automation-run";
import * as automationRunStep from "~/server/db/schemas/automation-run-step";
import * as automationJob from "~/server/db/schemas/automation-job";
import * as automationTrigger from "~/server/db/schemas/automation-trigger";
import * as device from "~/server/db/schemas/device";
import * as nonce from "~/server/db/schemas/nonce";
import * as syncLog from "~/server/db/schemas/sync_log";
import * as idempotencyKey from "~/server/db/schemas/idempotency_key";
import * as scriptFile from "~/server/db/schemas/script_file";

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(env.DATABASE_URL);
if (env.NODE_ENV !== "production") globalForDb.conn = conn;

export const schema = {
  ...session,
  ...user,
  ...account,
  ...verification,
  ...workstation,
  ...twoFactor,
  ...blueprint,
  ...automation,
  ...automationVersion,
  ...automationRun,
  ...automationRunStep,
  ...automationJob,
  ...automationTrigger,
  ...device,
  ...nonce,
  ...syncLog,
  ...idempotencyKey,
  ...scriptFile,
};

export const db = drizzle(conn, {
  schema,
});
