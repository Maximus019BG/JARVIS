import { createAuthClient } from "better-auth/react";
import {
  lastLoginMethodClient,
  twoFactorClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  plugins: [
    lastLoginMethodClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        // Get current page params to preserve redirect_url
        const params = new URLSearchParams(window.location.search);
        const redirectUrl = params.get("redirect_url") ?? "/app";

        // Redirect to 2FA verification page
        window.location.href = `/auth/verify-2fa?redirect_url=${encodeURIComponent(redirectUrl)}`;
      },
    }),
  ],
});
