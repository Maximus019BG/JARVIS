import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "~/lib/auth";

/**
 * Request-scoped `getSession`.
 *
 * Protected routes resolve the session twice per render — once in the layout to
 * gate access, once in the page to read `user.id`. `React.cache` dedupes those
 * within a single render pass, which matters because the DB is in Neon us-east-1
 * and a cookie-cache miss costs a round trip.
 *
 * Server components only — `cache()` has no effect outside a render pass, so API
 * route handlers should keep calling `auth.api.getSession` directly.
 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
