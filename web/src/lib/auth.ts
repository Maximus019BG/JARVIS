import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "~/server/db";
import { env } from "~/env";
import { sendResetPasswordEmail } from "~/server/email/utils/send-password-reset-email";
import { sendVerificationEmail } from "~/server/email/utils/send-verification-email";
import { lastLoginMethod, twoFactor } from "better-auth/plugins";

export const auth = betterAuth({
  trustedOrigins: ["*"],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  /**
   * The DB lives in Neon us-east-1, so every query is a ~230ms round trip and
   * `getSession` runs on all 35 of its call sites. The cookie cache serves the
   * session from a signed cookie instead, taking the common path to zero queries.
   *
   * Tradeoff: a revoked session stays valid for up to `maxAge`. Lower it if that matters.
   */
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // NOTE: do not enable `experimental: { joins: true }` here. It would collapse the
  // session+user lookup into one query, but this schema is passed to the adapter as a
  // flat table map with no Drizzle `relations()`, so the adapter's join path throws
  // `Cannot read properties of undefined (reading 'referencedTable')` on every request.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Changed to false - users can sign in immediately
    sendResetPassword: sendResetPasswordEmail,
    resetPasswordTokenExpiresIn: Number(
      env.BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN,
    ),
  },
  emailVerification: {
    sendOnSignUp: true, // Still sends verification email, but doesn't block sign-in
    autoSignInAfterVerification: true,
    sendVerificationEmail: sendVerificationEmail,
    expiresIn: Number(env.BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN),
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [
    lastLoginMethod(),
    // Enable (TOTP) two-factor authentication
    twoFactor({
      issuer: "JARVIS",
      // digits: 6, // default
      // period: 30, // default
    }),
  ],
});
