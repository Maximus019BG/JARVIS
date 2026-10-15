# Sign up and sign in

Modules: [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md), [web/email](../modules/web/email/README.md), [mobile](../modules/mobile/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A person who wants to use JARVIS from a browser or the phone app. They get a user account, and
a session that every web page and session-authenticated `/api/*` route trusts. The account owns
workstations, and from there devices, blueprints and automations. Machines do not sign in this way.
They pair and get a device token, see [pair-a-device.md](pair-a-device.md).

## Flow
**Sign up (browser).**
1. The user opens `/auth?mode=sign-up`. A signed-in user who lands on `/auth` is sent on to
   `redirect_url` (default `/app`) by `web/src/components/auth/not-logged-in.tsx` → `NotLoggedIn`.
2. They pick GitHub, Google, or the email form (first name, last name, email, password twice).
   The form posts `sign-up/email` with `name = "<first> <last>"`.
3. better-auth creates `user` and `account` rows and signs them in at once. Email verification
   does not block anything (`requireEmailVerification: false` in `web/src/lib/auth.ts`).
4. In the same request better-auth sends the verification mail (`sendOnSignUp: true`) through
   `web/src/server/email/utils/send-verification-email.ts` → `sendVerificationEmail`. Clicking
   the link verifies the address and signs the user in (`autoSignInAfterVerification: true`).
   The account dialog then shows a "Verified" badge next to the email.

**Sign in (browser).**
1. Any protected page without a session redirects to `/auth?redirect_url=<current URL>`
   (`web/src/app/(protected)/layout.tsx`).
2. Email and password post `sign-in/email`. GitHub and Google go through `sign-in/social` and come back to
   `redirect_url`. The `lastLoginMethod` plugin marks the method used last time with a badge.
3. Without 2FA, better-auth sets the session cookie and the form pushes `redirect_url`.
4. With 2FA on, better-auth answers `twoFactorRedirect: true` instead of a session, and sets a
   short-lived two-factor cookie. The client plugin's `onTwoFactorRedirect`
   (`web/src/lib/auth-client.ts`) loads `/auth/verify-2fa?redirect_url=…`. The user types the
   6-digit TOTP code, `two-factor/verify-totp` creates the session, and the page goes to `redirect_url`.

**Password reset.**
1. "Forgot your password?" leads to `/auth/reset-password`. The user enters an email, and
   `request-password-reset` mails a link (`sendResetPasswordEmail`) pointing at `/auth/reset-password/token`.
2. That page takes the new password twice and posts `reset-password` with the `token` from the URL.
   On success it sends the user to `/auth` after 5 seconds to sign in again.

**Two-factor setup** (account dialog → Security, `web/src/components/account/account-two-factor-section.tsx`).
1. The user confirms their password. `two-factor/enable` returns a TOTP URI (shown as a QR) and backup codes.
2. They scan it and enter a code. `verify-totp` switches 2FA on, and backup codes are shown to copy.
   If none came back with `enable`, they are generated with `generate-backup-codes`.
3. Later they can regenerate backup codes or turn 2FA off. Both ask for the password again.

**Phone app** (`mobile/src/api.ts`, `mobile/app/index.tsx`).
1. The app asks for the server address. It must start with `http://` or `https://`. Trailing slashes are stripped.
2. Email and password post `sign-in/email`. If the answer says `twoFactorRedirect`, the app asks for the TOTP code and posts `two-factor/verify-totp`.
3. The `bearer` plugin returns the session token in a `set-auth-token` response header. The app
   keeps it in SecureStore (`jarvis.token`) and sends `Authorization: Bearer <token>` on every call.
   That is the same session a browser holds in its cookie.

**Account settings and sign-out.** The user menu opens the account dialog: profile (name, avatar),
email (read only), password, Security (2FA) and MCP tokens ([mcp-access.md](mcp-access.md)).
Sign-out calls `sign-out` and refreshes the page. The protected layout then sends the user to `/auth`.

## Business rules
- **Password policy:** 8–128 characters, with at least one lowercase letter, one uppercase letter, one digit and one other character
  (`web/src/lib/validation/auth/sign-up.ts` → `validatePassword`). Only the web forms check
  this. better-auth itself only enforces its default length limits, so an API client can set a simpler password.
- **Names:** first name 2–128 characters, last name 2–127 (`signUpSchema`, `updateUserSchema`).
- **Avatar:** PNG, JPEG or WebP, 10 MB or smaller, stored as a base64 data URL in `user.image`.
- **Password change** needs the current password. The new one must differ from it. "Sign out other
  sessions" is ticked by default (`web/src/components/account/account-update-password-card.tsx`).
- **2FA needs a password.** Enable, disable and backup-code calls all ask for it. A GitHub- or Google-only
  account has no password and no UI to set one, so it cannot turn 2FA on.
- **TOTP:** 6 digits, 30-second period, issuer `JARVIS` (better-auth defaults, `web/src/lib/auth.ts`).
  After the password step the user has 10 minutes to enter the code (the two-factor cookie's
  default `maxAge`, 600 s). Backup codes: 10 codes, each `xxxxx-xxxxx` (better-auth defaults).
- **Session lifetime:** 7 days (better-auth default, not set in `web/src/lib/auth.ts`).
- **Cookie cache:** `session.cookieCache.maxAge` is 5 minutes. A browser's session is read from a signed
  cookie, with no DB query, for up to 5 minutes. So a session revoked elsewhere (for example by a
  password change) keeps working in another browser for up to 5 minutes. The phone sends only the
  bearer token, so each phone call is checked against the `session` table.
- **Bearer tokens must be signed** (`bearer({ requireSignature: true })`). An unsigned token is refused.
- **Trusted origins:** `NEXT_PUBLIC_BASE_URL` and `jarvis://` only. A new client origin must be added there.
- **Link lifetimes:** reset links last `BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN` and verification links
  `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN`. Both values are **seconds** to better-auth, though `web/src/env.js`
  calls them minutes. Unset, they default to 60 (one minute) and 1440 (24 minutes).
- **Rate limit:** nginx limits `/api/auth/` to 30 requests a minute per IP, burst 15
  (`k8s/base/nginx.conf`). Above that it answers 429 `{"error":"slow_down"}`.
- **Mail** comes from `JARVIS <no-reply@jarvisweb.cloud>` through Resend (`web/src/server/email/index.ts`).

## When it fails
- **Wrong email or password:** a toast with better-auth's message. The user stays on the form.
- **Wrong or late TOTP code:** an error toast with better-auth's message. After 10 minutes the two-factor cookie is gone, so the user signs in again.
- **Backup code sign-in does not work.** `web/src/components/auth/verify-2fa-backup-form.tsx` posts to
  `/api/auth/2fa/verify`, which is not a better-auth route. Every attempt shows "Backup code invalid".
  A user who lost their authenticator cannot get in until this is fixed.
- **Mail never arrives:** send errors are only logged (`sendEmail`). Check `RESEND_API_KEY` and the
  sending domain. With default expiry settings, a reset link that arrives after a minute is already dead.
- **Expired or bad links:** the reset page shows "Invalid or expired token". The verify page shows
  "Verification token expired" for `?error=token_expired`. It reports success for any visit without `?error=`.
- **Google sign-in in a phone's browser:** `web/src/proxy.ts` sends the Google callback for a mobile user agent to `jarvis://`.
  The phone app does not handle OAuth, so on a phone the user should use email and password.
- **Phone gets 401:** the session expired or was revoked. The sessions screen deletes the stored token and goes back to sign-in.
  The phone's "Sign out" also only deletes the local token, so that server session stays valid until it expires.
- **429 `slow_down`:** too many auth requests from one IP. Wait a minute.

## Related
- [pair-a-device.md](pair-a-device.md): how machines get their own tokens.
- [mcp-access.md](mcp-access.md): MCP tokens, minted from the account dialog.
- [remote-approval-and-steering.md](remote-approval-and-steering.md): what the phone does once signed in.
- [install-and-setup.md](install-and-setup.md): the env vars a deployment needs.
- Module docs: [web/auth-and-accounts](../modules/web/auth-and-accounts/README.md),
  [web/email](../modules/web/email/README.md), [mobile](../modules/mobile/README.md).
