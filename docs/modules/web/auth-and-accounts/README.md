# Auth and accounts

Code: `web/src/lib/auth*.ts`, `web/src/lib/validation/auth/`, `web/src/lib/permissions.ts`, `web/src/app/auth/`, `web/src/app/api/auth/`, `web/src/components/{auth,account,user}/`, `web/src/app/(protected)/app/settings/` · Verified: 2026-10-13 @ c292f2f

## Purpose
User identity for the web app and the mobile app: sign-up, sign-in (email/password, GitHub,
Google), email verification, password reset, TOTP two-factor, and the account dialog (profile,
password, 2FA, MCP tokens). Built on better-auth. Device identity (`jvd_` tokens) is a separate
system, see [devices-and-pairing](../devices-and-pairing/README.md). Also hosts the
`/app/settings` page, which assembles device, approval and MCP cards from other modules.

## How it works

**Server.** `web/src/lib/auth.ts` → `auth` is one `betterAuth(...)` instance on the Drizzle
adapter (`db`, `schema` from `~/server/db`). `web/src/app/api/auth/[...all]/route.ts` mounts it with
`toNextJsHandler(auth)`, so every better-auth endpoint lives under `/api/auth/*`. Every other
route and page gets the user with `auth.api.getSession({ headers })` (server components use the
cached `getSession` in `web/src/lib/session.ts`, owned by
[sessions-and-approvals](../sessions-and-approvals/README.md)).

Configured features:
- **Cookie cache** (`session.cookieCache`, 5 min): the DB is a ~230 ms round trip away, and the
  signed cookie lets the common `getSession` path skip it.
- **Email and password**, `requireEmailVerification: false` (sign-in works before verifying);
  reset mail via `sendResetPasswordEmail`, verification mail on sign-up via `sendVerificationEmail`
  (both in [email](../email/README.md)), `autoSignInAfterVerification: true`.
- **Social**: GitHub and Google.
- **Plugins**: `lastLoginMethod()` (drives the "last used" badge), `bearer({ requireSignature: true })`
  so the React Native app can send `Authorization: Bearer <session token>` instead of a cookie, and
  `twoFactor({ issuer: "JARVIS" })` (TOTP + backup codes).

**Client.** `web/src/lib/auth-client.ts` → `authClient` (`createAuthClient` from `better-auth/react`)
with `lastLoginMethodClient`, `twoFactorClient` (its `onTwoFactorRedirect` sends the browser to
`/auth/verify-2fa?redirect_url=…`) and `organizationClient` using `ac`/`owner` from
`web/src/lib/permissions.ts`.

**Sign-in / sign-up.** `/auth` (`web/src/app/auth/(protected)/page.tsx` → `AuthPage`) switches between
`SignInForm` and `SignUpForm` on `?mode=sign-up`. The `(protected)` layout here is inverted: it wraps
the page in `NotLoggedIn`, which redirects an already signed-in user to `redirect_url` (default
`/app`). The app's own protected layout redirects anonymous users to `/auth?redirect_url=…`.
- `sign-in-form.tsx` → `SignInForm`: `authClient.signIn.email`; on a 2FA error code it routes to
  `/auth/verify-2fa`, on `EMAIL_NOT_VERIFIED` to `/auth/verify-email`.
- `sign-up-form.tsx` → `SignUpForm`: `authClient.signUp.email` with `name = "<first> <last>"`.
- `continue-with-github-button.tsx` / `continue-with-google-button.tsx`: `authClient.signIn.social`.

**Two-factor.** `/auth/verify-2fa` is also intercepted as a modal by the `@modal` parallel route
(`web/src/app/auth/@modal/(.)verify-2fa/page.tsx`), so a redirect from the sign-in form opens a
dialog over `/auth`. TOTP goes through `authClient.twoFactor.verifyTotp`. Setup lives in
`account-two-factor-section.tsx` → `AccountTwoFactorSection`: `twoFactor.enable({ password })` →
QR → `verifyTotp` → `generateBackupCodes`; `twoFactor.disable({ password })` to turn it off.

**Email verification and reset.** `VerifyEmail` calls `authClient.sendVerificationEmail` with a
callback to `/auth/verify-email/token`; `VerifyEmailStatus` there shows the result.
`RequestPasswordResetForm` calls `authClient.requestPasswordReset` with `redirectTo`
`/auth/reset-password/token`; `PasswordResetForm` there calls `authClient.resetPassword` with the
`token` query param. All forms carry `redirect_url` through.

**Account dialog.** `user-dropdown-menu.tsx` → `UserDropdownMenu` (sidebar and header via `UserNav`)
opens `account-dialog.tsx` → `AccountDialog` with three tabs: Account (profile, email, password),
Security (2FA), MCP (`McpTokensManager`). Profile save is `authClient.updateUser`; password change is
`authClient.changePassword` with optional `revokeOtherSessions`. Sign-out is `authClient.signOut`.

**MCP tokens UI.** `mcp-tokens-manager.tsx` → `McpTokensManager` is a four-view state machine
(`list`, `create`, `reveal` the new token once, `access` via `DeviceAccessForm`) that swaps views in place, because it is rendered inside the account
dialog and inside `McpTokensDialog` on the settings page, and a sheet over a modal traps focus in the
wrong layer. Tokens are `device` rows with `platform === "mcp"`; every call goes through `devicesApi`
(`list`, `createMcpToken`, `rename`, `setGrants`/`setScopes` through `DeviceAccessForm`, `revoke`, `remove`).

**Settings page.** `web/src/app/(protected)/app/settings/page.tsx` shows an empty state with
`CreateWorkstationDialog` when no workstation is active; otherwise `PendingRequestsCard`,
`ApprovalsCard`, `DevicesCard` (with `?code=` passed as `defaultCode`) and an MCP tokens card.

## Files
| File | Responsibility |
|---|---|
| `web/src/lib/auth.ts` | `auth`: the better-auth server instance and its plugins |
| `web/src/lib/auth-client.ts` | `authClient`: browser client with 2FA redirect |
| `web/src/lib/permissions.ts` | `ac`, `owner` access-control role; `convertPermissionsToObject`, `convertCommaSeparatedPermissions` |
| `web/src/app/api/auth/[...all]/route.ts` | `GET`/`POST`: `toNextJsHandler(auth)` |
| `web/src/lib/validation/auth/sign-in.ts` | `signInSchema` |
| `web/src/lib/validation/auth/sign-up.ts` | `signUpSchema`, `validatePassword` (lower, upper, digit, special) |
| `web/src/lib/validation/auth/password.ts` | `resetPasswordRequestSchema`, `resetPasswordSchema`, `updatePasswordSchema` |
| `web/src/lib/validation/auth/user.ts` | `updateUserSchema` (names, image ≤10 MB png/jpeg/webp) |
| `web/src/lib/validation/auth/verify-2fa.ts` | `verify2faSchema` (6 digits) |
| `web/src/app/auth/layout.tsx` | Renders `children` and the `modal` parallel slot |
| `web/src/app/auth/(protected)/layout.tsx` | Wraps in `NotLoggedIn` (bounce signed-in users) |
| `web/src/app/auth/(protected)/page.tsx` | `/auth`: sign-in / sign-up with sliding panel and quotes |
| `web/src/app/auth/verify-email/layout.tsx` | Centered card layout |
| `web/src/app/auth/verify-email/page.tsx` | `/auth/verify-email`: `VerifyEmail` |
| `web/src/app/auth/verify-email/token/page.tsx` | `/auth/verify-email/token`: `VerifyEmailStatus` |
| `web/src/app/auth/reset-password/layout.tsx` | Centered card layout |
| `web/src/app/auth/reset-password/page.tsx` | `/auth/reset-password`: `RequestPasswordResetForm` |
| `web/src/app/auth/reset-password/token/page.tsx` | `/auth/reset-password/token`: `PasswordResetForm` |
| `web/src/app/auth/verify-2fa/page.tsx` | `/auth/verify-2fa`: `Verify2FAForm` |
| `web/src/app/auth/verify-2fa/backup/page.tsx` | `/auth/verify-2fa/backup`: `Verify2FABackupForm` |
| `web/src/app/auth/@modal/default.tsx` | Empty modal slot |
| `web/src/app/auth/@modal/(.)verify-2fa/page.tsx` | Intercepted 2FA modal (`Verify2FADialog`) |
| `web/src/app/auth/@modal/(.)verify-2fa/backup/page.tsx` | Intercepted backup-code modal |
| `web/src/components/auth/sign-in-form.tsx` | `SignInForm` |
| `web/src/components/auth/sign-up-form.tsx` | `SignUpForm` |
| `web/src/components/auth/continue-with-github-button.tsx` | `ContinueWithGitHubButton` |
| `web/src/components/auth/continue-with-google-button.tsx` | `ContinueWithGoogleButton` |
| `web/src/components/auth/continue-with-password-button.tsx` | `ContinueWithPasswordButton`, `ButtonContent` |
| `web/src/components/auth/another-method-separator.tsx` | `AnotherMethodSeparator` |
| `web/src/components/auth/last-login-badge.tsx` | `LastLoginBadge` |
| `web/src/components/auth/not-logged-in.tsx` | `NotLoggedIn`: redirect if a session exists |
| `web/src/components/auth/verify-email.tsx` | `VerifyEmail`: resend verification mail |
| `web/src/components/auth/verify-email-status.tsx` | `VerifyEmailStatus`: result of the verification link |
| `web/src/components/auth/request-password-reset-form.tsx` | `RequestPasswordResetForm` |
| `web/src/components/auth/password-reset-form.tsx` | `PasswordResetForm` |
| `web/src/components/auth/verify-2fa-form.tsx` | `Verify2FAForm` (TOTP) |
| `web/src/components/auth/verify-2fa-dialog.tsx` | `Verify2FADialog` (TOTP in a dialog) |
| `web/src/components/auth/verify-2fa-backup-form.tsx` | `Verify2FABackupForm` |
| `web/src/components/account/account-dialog.tsx` | `AccountDialog`: Account / Security / MCP tabs |
| `web/src/components/account/account-profile-section.tsx` | `AccountProfileSection` |
| `web/src/components/account/account-update-profile-card.tsx` | `AccountUpdateProfileCard`: `authClient.updateUser` |
| `web/src/components/account/account-email-section.tsx` | `AccountEmailSection`: email + verified badge |
| `web/src/components/account/account-password-section.tsx` | `AccountPasswordSection` |
| `web/src/components/account/account-update-password-card.tsx` | `AccountUpdatePasswordCard`: `authClient.changePassword` |
| `web/src/components/account/account-two-factor-section.tsx` | `AccountTwoFactorSection`: enable, verify, backup codes, disable |
| `web/src/components/account/account-mcp-section.tsx` | `AccountMcpSection`: card shell for `McpTokensManager` |
| `web/src/components/account/mcp-tokens-manager.tsx` | `McpTokensManager`: list, mint, rename, re-scope, revoke, delete MCP tokens |
| `web/src/components/user/user-nav.tsx` | `UserNav` |
| `web/src/components/user/user-dropdown-menu.tsx` | `UserDropdownMenu`: account dialog, sign-out |
| `web/src/app/(protected)/app/settings/page.tsx` | `/app/settings`: workstation, pending pairings, approvals, devices, MCP tokens |

## Interfaces
- **`/api/auth/*`** (`GET`/`POST`, `web/src/app/api/auth/[...all]/route.ts`): better-auth's own
  endpoints. Ones this repo calls: `sign-in/email`, `sign-up/email`, `sign-in/social`, `sign-out`,
  `get-session`, `send-verification-email`, `request-password-reset`, `reset-password`,
  `update-user`, `change-password`, `two-factor/enable`, `two-factor/disable`,
  `two-factor/verify-totp`, `two-factor/generate-backup-codes`. The mobile app uses
  `sign-in/email` and `two-factor/verify-totp` (`mobile/src/api.ts`).
- **Session auth for other routes**: cookie, or `Authorization: Bearer <session token>` (signed).
- **Pages**: `/auth` (`?mode=sign-in|sign-up`, `?redirect_url=`), `/auth/verify-email`,
  `/auth/verify-email/token`, `/auth/reset-password`, `/auth/reset-password/token`,
  `/auth/verify-2fa`, `/auth/verify-2fa/backup`, `/app/settings` (`?code=` opens the link dialog).
- **`authClient`** for client components; **`auth.api.getSession`** for server code.

## Data and state
Tables (better-auth's, in `web/src/server/db/schemas/`):

| Table | Use |
|---|---|
| `user` | `name`, `email` (unique), `email_verified`, `image`, `two_factor_enabled` |
| `session` | `token`, `expires_at`, `ip_address`, `user_agent`, `active_organization_id`, plus this repo's `mobile_expo_push_token` |
| `account` | Provider links and the password hash (`provider_id`, `password`, OAuth tokens) |
| `verification` | Email verification and reset tokens |
| `two_factor` | TOTP `secret` and `backup_codes` |

Env vars (`web/src/env.js`): `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN`, `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN`,
`BETTER_AUTH_ORGANIZATION_LIMIT`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_BASE_URL` (client base URL, email callback URLs);
`RESEND_API_KEY` is used by the email senders.

Browser state: the signed session cookie (5-minute cookie cache), `localStorage.twoFactorToken`
(written by `SignInForm` if the 2FA error carries a token).

## Depends on / used by
- Depends on: [database](../database/README.md) (`db`, `schema`), [email](../email/README.md)
  (`sendResetPasswordEmail`, `sendVerificationEmail`), [devices-and-pairing](../devices-and-pairing/README.md)
  (cards and `devicesApi` on the settings page and in `McpTokensManager`),
  [sessions-and-approvals](../sessions-and-approvals/README.md) (`ApprovalsCard`).
- Used by: every session-authenticated route and page (`auth.api.getSession`), the protected layout,
  `web/src/proxy.ts` (mobile redirect on `/api/auth/callback/google`, in
  [frontend-shell](../frontend-shell/README.md)).

## Gotchas
- **A revoked session lives up to 5 minutes** because of the cookie cache. Lower `maxAge` if that matters.
- **Do not enable `experimental: { joins: true }`.** The schema is passed as a flat table map with no
  Drizzle `relations()`, and the adapter's join path throws on every request.
- **`import type { auth }` in client components**, never `import { type auth }`: under
  `verbatimModuleSyntax` the latter emits a runtime import and drags the server auth module into the
  client bundle (see `not-logged-in.tsx`).
- `trustedOrigins: ["*"]` accepts any origin.
- **The backup-code form posts to `/api/auth/2fa/verify`**, which is not a better-auth endpoint (the
  two-factor plugin exposes `/two-factor/verify-backup-code`), so backup-code sign-in does not work as written.
- **The organization plugin is client-only.** `authClient` loads `organizationClient` with `ac`/`owner`,
  but `auth.ts` has no organization plugin, `BETTER_AUTH_ORGANIZATION_LIMIT` is read nowhere, and
  `convertPermissionsToObject` / `convertCommaSeparatedPermissions` have no callers. Workstations are
  their own table (`workstation`), not better-auth organizations.
- `VerifyEmailStatus` reports success for any visit without `?error=token_expired`.
- `AccountUpdateProfileCard` sends `image: null` when no new file is picked, so saving a name change
  clears the avatar. Images are stored as base64 data URLs in `user.image`.
- The settings page comment says `/link?code=…` redirects to it; `/link` now renders its own approval
  page and only redirects when there is no code.
- Index note: `web/src/app/api/auth/` is not listed in `docs/modules/README.md`; it is documented here.

## Tests
None in `web/src/__tests__/` exercise this module. `web/src/__tests__/proxy.test.ts` covers the
Google-callback mobile redirect in `web/src/proxy.ts` (frontend shell). Run `pnpm --filter web test`.
