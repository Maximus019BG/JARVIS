import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "~/server/db";
import { env } from "~/env";
import { sendResetPasswordEmail } from "~/server/email/utils/send-password-reset-email";
import { sendVerificationEmail } from "~/server/email/utils/send-verification-email";
import { lastLoginMethod } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: sendResetPasswordEmail,
    resetPasswordTokenExpiresIn: Number(
      env.BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN,
    ),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: sendVerificationEmail,
    expiresIn: Number(env.BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN),
  },
  socialProviders: {
    // github: {
    //   clientId: env.GITHUB_CLIENT_ID!,
    //   clientSecret: env.GITHUB_CLIENT_SECRET!,
    // },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  plugins: [lastLoginMethod()],
});
