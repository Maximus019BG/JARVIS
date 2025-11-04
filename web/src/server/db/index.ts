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
};

export const db = drizzle(conn, {
  schema,
});
