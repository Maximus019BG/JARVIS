# Mobile

Code: `mobile/` (`app/*.tsx`, `src/*.ts`, `app.json`) · Verified: 2026-10-13 @ c292f2f

## Purpose
An Expo (React Native) app that lets a phone talk to a terminal in another room and answer
the approval prompt that stopped it. It has no API of its own. It signs in as the user,
exactly as the browser does, and calls existing web routes. Setup and the terminal-side
switches (`remoteSteering`, `syncSessions`, `remoteApproval`) are in [mobile/README.md](../../../mobile/README.md).

## How it works

1. **Sign in** (`mobile/app/index.tsx` → `SignIn`).
   - `loadSession` reads the base URL and token from SecureStore. With a token, the app goes straight to `/sessions`.
   - Otherwise there are three steps: address (it must start with `http://` or `https://`; `setBaseUrl`), then email and password (`signIn`), then TOTP if the server answered `twoFactorRedirect` (`verifyTotp`).
   - The app is self-hosted, so there is no default server, and the address comes first.
2. **Bearer session** (`mobile/src/api.ts`).
   - Every call goes through `call`, which sends `Authorization: Bearer <token>`.
   - `keep` stores any `set-auth-token` response header in SecureStore. better-auth's `bearer` plugin returns that header on sign-in and again after the second factor, which makes the two-step login work without a cookie jar.
3. **Sessions** (`mobile/app/sessions.tsx` → `Sessions`).
   - On focus, it lists sessions and counts pending approvals (`listSessions`, `listApprovals`). A non-zero count shows a banner that links to `/approvals`.
   - A 401 signs out and returns to sign-in, because the token expired or was revoked.
   - This is also where `registerForPush` runs, because a push token is only useful once there is a signed-in session to attach it to.
4. **Talk** (`mobile/app/talk.tsx` → `Talk`).
   - Hold to talk: `ExpoSpeechRecognitionModule.start` with `lang: "en-US"`, interim results and continuous recognition. Results fill an editable text box.
   - Send: `sendPrompt` with whatever text is in the box. A 429 means the terminal has not picked up earlier prompts yet. The text is not sent automatically, because a misheard prompt that has already started a turn costs money to take back.
5. **Approvals** (`mobile/app/approvals.tsx` → `Approvals`).
   - Lists pending approvals with the diff in its own scroll view.
   - Offers only `once` and `reject` (`answerApproval`), which is also the server's rule: `always` would widen policy on disk.
   - A 409 means the approval was already answered, and the row is removed quietly.
6. **Push** (`mobile/src/push.ts` → `registerForPush`).
   - Skipped on a simulator (`Constants.isDevice`).
   - Creates the Android `approvals` channel; without a channel, Android silently drops notifications.
   - Asks for permission, then mints an Expo push token with the EAS project id and `PUT`s it to the server.

## Files
| File | Responsibility |
|---|---|
| `mobile/app/_layout.tsx` | expo-router `Stack` with the four screens and dark header styling |
| `mobile/app/index.tsx` | Sign-in flow: address → credentials → TOTP |
| `mobile/app/sessions.tsx` | Session list, approvals banner, push registration, sign out |
| `mobile/app/talk.tsx` | Push-to-talk speech recognition into an editable prompt; send |
| `mobile/app/approvals.tsx` | Pending approvals with allow once / reject |
| `mobile/src/api.ts` | SecureStore session, `call`/`json` wrapper, `ApiError`, typed API calls, `idle` formatter |
| `mobile/src/push.ts` | `registerForPush`: Expo push token → server |
| `mobile/src/theme.ts` | `colors` and shared `styles` (the web app's palette) |
| `mobile/app.json` | Expo config: scheme `jarvis`, bundle ids, plugins (`expo-router`, `expo-secure-store`, `expo-speech-recognition` with permission strings), Android `googleServicesFile` |
| `mobile/package.json` | Expo 54 / RN 0.81 dependencies; `start`, `android`, `ios`, `typecheck` scripts |
| `mobile/tsconfig.json` | Strict TS, `~/*` → `./src/*` alias used by the screens |

## Interfaces

API calls (all in `mobile/src/api.ts`, all bearer-authenticated except the first):

| Function | Method · path | Web route file | Body → response |
|---|---|---|---|
| `signIn` | `POST /api/auth/sign-in/email` | `web/src/app/api/auth/[...all]/route.ts` (better-auth) | `{email, password}` → `{twoFactorRedirect?}` + `set-auth-token` header |
| `verifyTotp` | `POST /api/auth/two-factor/verify-totp` | same | `{code}` → `set-auth-token` header |
| `listSessions` | `GET /api/session` | `web/src/app/api/session/route.ts` | → `{sessions: Session[]}` |
| `sendPrompt` | `POST /api/session/{id}/prompt` | `web/src/app/api/session/[sessionId]/prompt/route.ts` | `{prompt}` → `{id}`; 429 when the queue is full |
| `listApprovals` | `GET /api/approval` | `web/src/app/api/approval/route.ts` | → `{approvals: Approval[]}` |
| `answerApproval` | `POST /api/approval/{id}/answer` | `web/src/app/api/approval/[id]/answer/route.ts` | `{answer: "once"\|"reject"}`; 409 if already answered |
| `registerPush` | `PUT /api/mobile/notifications` | `web/src/app/api/mobile/notifications/route.ts` | `{expoToken}` |

The server side of these routes is documented in [web/sessions-and-approvals](../web/sessions-and-approvals/README.md)
and [web/auth-and-accounts](../web/auth-and-accounts/README.md).

Deep-link scheme: `jarvis` (`app.json`). It is registered, but nothing uses it yet.

## Data and state
| What | Where |
|---|---|
| Server address | SecureStore key `jarvis.baseUrl` (trailing slashes stripped) |
| Session token | SecureStore key `jarvis.token`, the same better-auth session token a browser keeps in a cookie, so it lives in the platform keychain and not in AsyncStorage |
| In memory | `token` and `baseUrl` in `api.ts`, loaded by `loadSession` |
| Push token | Stored server-side against the better-auth session row (`/api/mobile/notifications`) |

`google-services.json` and `service-account.json` are credentials and are gitignored (`mobile/.gitignore`), as are `android/` and `ios/`, which `expo prebuild` generates.

## Depends on / used by
- **Depends on**:
  - the web app's better-auth setup with the `bearer` and `twoFactor` plugins (`web/src/lib/auth.ts`)
  - the session, approval and notification routes listed above
  - Expo modules: `expo-router`, `expo-secure-store`, `expo-notifications`, `expo-constants`, `expo-speech-recognition`
- **Used by**: nothing in the repo. It is an end-user app.

## Gotchas
- **Speech is not forced to run on the device.** `talk.tsx` passes `requiresOnDeviceRecognition: false`, so the platform may use its own cloud recognizer. The README and the comments say recognition runs on the phone. What is true is that only text reaches the JARVIS server: the app never uploads audio itself.
- **Re-registering the same push token returns no response.** In `web/src/app/api/mobile/notifications/route.ts`, the "token unchanged" branch falls through without a `return`. `registerForPush` is called on every focus of the sessions screen, and the error is swallowed there, so nothing visible breaks.
- **Only email and password sign-in.** OAuth would need the deep-link scheme tested on a real installed build.
- **No refresh logic.** A 401 on the sessions screen signs out. Other screens show the error.
- **Push needs a real build and an EAS project id** (`expoConfig.extra.eas.projectId` or `easConfig.projectId`). Expo Go and simulators get no token, and the app treats that as "no notifications".
- **The speech language is hard-coded** to `en-US`.

## Tests
There are none. `cd mobile && bun run typecheck` (`tsc --noEmit`) is the only check.
