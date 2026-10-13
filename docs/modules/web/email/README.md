# Email

Code: `web/src/server/email/`, `web/src/emails/`, `web/src/lib/email.ts` · Verified: 2026-10-13 @ c292f2f

## Purpose
Transactional email for accounts. There are exactly two messages, email verification and password
reset. Both are rendered from React Email templates and sent through Resend. better-auth decides
when to send them. This module only builds and delivers them.

## How it works
1. better-auth (`web/src/lib/auth.ts`) is configured with
   `emailVerification.sendVerificationEmail: sendVerificationEmail` and
   `emailAndPassword.sendResetPassword: sendResetPasswordEmail`. It calls them with
   `{ user, url, token }` and the incoming `request`.
2. The sender works out two strings for the template:
   - **Where from:** `getIpLocationString(request)` (`web/src/lib/ip-location.ts`, owned by
     [web/frontend-shell](../frontend-shell/README.md)) takes the first `x-forwarded-for` hop and
     looks it up at `ip-api.com`, giving `"<ip>, <city>, <countryCode>"`. With no request it
     uses `"Unknown"`.
   - **When / how long:** `web/src/lib/email.ts` → `formatEmailDates` formats the request time
     as `d MMMM yyyy, HH:mm 'UTC'` and the expiry as a relative duration (`formatDistanceStrict`).
     - Verification: `web/src/server/email/utils/send-verification-email.ts` →
       `sendVerificationEmail` decodes the token as a JWT (`jwtDecode`) and uses its `iat`/`exp`,
       so the stated expiry is the token's real one.
     - Reset: `web/src/server/email/utils/send-password-reset-email.ts` → `sendResetPasswordEmail`
       uses now plus `BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN` × 1000 ms. That is, it treats
       the value as seconds.
3. The template component is called as a plain function
   (`EmailVerification({...})`, `PasswordResetEmail({...})`) and the element is handed to
   `web/src/server/email/index.ts` → `sendEmail({ to, subject, body })`. That calls
   `resend.emails.send({ from: "JARVIS <no-reply@jarvisweb.cloud>", to, subject, react: body })`.
   Resend renders the React element to HTML.
4. Errors from Resend are `console.error`-ed and swallowed. The auth flow never sees a failed send.

Templates share `web/src/emails/components/email-layout.tsx` → `EmailLayout`. It wraps the body
in React Email's `Tailwind` with a hard-coded dark theme (oklch colours copied from the app),
a preview line and a logo. Both templates use `EmailButton`, `SecurityNotice` (expiry warning)
and `RequestInfo` ("didn't request this?" with IP/location/time).

## Files
| File | Responsibility |
|---|---|
| `web/src/server/email/index.ts` | `sendEmail`: the Resend client (`server-only`), fixed `from` address |
| `web/src/server/email/utils/send-verification-email.ts` | `sendVerificationEmail`: better-auth hook; JWT expiry; subject "Verify your email address" |
| `web/src/server/email/utils/send-password-reset-email.ts` | `sendResetPasswordEmail`: better-auth hook; env-based expiry; subject "Password reset request" |
| `web/src/lib/email.ts` | `formatEmailDates`: request time and relative expiry strings |
| `web/src/emails/email-verification-email.tsx` | `EmailVerification` template (default export) |
| `web/src/emails/password-reset-email.tsx` | `PasswordResetEmail` template (default export) |
| `web/src/emails/components/email-layout.tsx` | `EmailLayout`: html/head/body, Tailwind theme, logo, preview text |
| `web/src/emails/components/email-button.tsx` | `EmailButton`: CVA variants mirroring the app's `Button` |
| `web/src/emails/components/email-security-notice.tsx` | `SecurityNotice` (default export): "link expires in ..." box |
| `web/src/emails/components/email-request-info.tsx` | `RequestInfo` (default export): who/where/when requested it |

## Interfaces
No routes and no commands. Exports used elsewhere:
- `sendVerificationEmail` and `sendResetPasswordEmail` → `web/src/lib/auth.ts`.
- `sendEmail` is generic. Nothing else calls it today.

The templates' props have preview defaults (`"John Doe"`, `https://example.com/`, ...) so they
render without input in a React Email preview. The package has no preview script configured.

## Data and state
- Env: `RESEND_API_KEY` (required). `BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN` and
  `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN` are passed by `web/src/lib/auth.ts` to better-auth.
  The reset one is also read here. All are validated in `web/src/env.js`.
- No tables, no cache. One module-level `Resend` instance.

## Depends on / used by
- Depends on: `resend`, `@react-email/components`, `date-fns`, `jwt-decode`,
  `web/src/lib/ip-location.ts`, `web/src/lib/utils.ts` (`cn`), `web/src/env.js`.
- Used by: [web/auth-and-accounts](../auth-and-accounts/README.md) (sign-up verification, password reset).

## Gotchas
- **Expiry units.** `web/src/env.js` comments say "in minutes" (defaults 60 and 1440), but
  `sendResetPasswordEmail` multiplies by 1000 to get milliseconds, i.e. treats the value as seconds,
  and better-auth's `resetPasswordTokenExpiresIn`/`expiresIn` also take seconds. If unset, the
  reset link lasts 60 seconds. Set both explicitly.
- **Send failures are silent.** `sendEmail` only logs. A wrong `RESEND_API_KEY` or an
  unverified sending domain looks like "the email never arrived".
- **IP lookup:** `ip-api.com` over plain `http`, unauthenticated and rate-limited, on every send.
  With no `x-forwarded-for`, `extractIp` falls back to `8.8.8.8`. That shows the IP as
  "Unknown" but still looks up 8.8.8.8, so the city is Google's, not the user's.
- `RequestInfo` text says the account "will remain inactive until verified". It is shown in
  the password reset mail too, and sign-in does not require verification
  (`requireEmailVerification: false` in `web/src/lib/auth.ts`). `SecurityNotice` calls every
  link a "confirmation link".
- The logo in `EmailLayout` is a `placehold.co` placeholder image.
- The `from` address domain is hard-coded to `jarvisweb.cloud`. A self-hosted deployment must
  verify that domain in Resend or change `web/src/server/email/index.ts`.

## Tests
None. `pnpm --filter web test` has no email suite. To check by hand, request a password
reset on a dev deployment with `RESEND_API_KEY` set.
