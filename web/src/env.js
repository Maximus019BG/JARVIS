import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    BETTER_AUTH_SECRET: z.string().min(32).max(248),
    BETTER_AUTH_ORGANIZATION_LIMIT: z.coerce.number().default(5),
    BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN: z
      .string()
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) {
          throw new Error(`Invalid number for BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN: ${val}`);
        }
        return parsed;
      })
      .default("60"), // in minutes
    BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: z
      .string()
      .transform((val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) {
          throw new Error(`Invalid number for BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: ${val}`);
        }
        return parsed;
      })
      .default("1440"), // in minutes (1 day)
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    BETTER_AUTH_ORGANIZATION_LIMIT: process.env.BETTER_AUTH_ORGANIZATION_LIMIT,
    BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN: process.env.BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN,
    BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: process.env.BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,

    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
