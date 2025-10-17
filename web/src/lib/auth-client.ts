import { createAuthClient } from "better-auth/react";
import { lastLoginMethodClient, organizationClient } from "better-auth/client/plugins";
import { ac, owner } from "~/lib/permissions";

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  plugins: [
    lastLoginMethodClient(),
    organizationClient({
      ac,
      roles: {
        owner,
      },
    }),
  ],
});
