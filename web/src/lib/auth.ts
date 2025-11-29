import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "~/server/db";
import { env } from "~/env";
import { sendResetPasswordEmail } from "~/server/email/utils/send-password-reset-email";
import { sendVerificationEmail } from "~/server/email/utils/send-verification-email";
import { lastLoginMethod, twoFactor } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
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
