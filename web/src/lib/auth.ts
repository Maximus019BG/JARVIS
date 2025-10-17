import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "~/server/db";
import { env } from "~/env";
import { ac, owner } from "~/lib/permissions";
import { sendResetPasswordEmail } from "~/server/email/utils/send-password-reset-email";
import { sendVerificationEmail } from "~/server/email/utils/send-verification-email";
import { lastLoginMethod, organization } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: sendResetPasswordEmail,
    resetPasswordTokenExpiresIn: Number(env.BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN),
  },
    emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: sendVerificationEmail,
    expiresIn: Number(env.BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN),
  },
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!,
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    },
  },
    plugins: [
    lastLoginMethod(),
    organization({
      organizationLimit: env.BETTER_AUTH_ORGANIZATION_LIMIT!,
      ac,
      roles: {
        owner,
      },
    }),
  ],

});
