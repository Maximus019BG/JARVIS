# Sessions and approvals

Code: `web/src/app/api/{session,approval,mobile}/`, `web/src/app/api/device/prompt/`, `web/src/server/steering.ts`, `web/src/server/db/queries/session.ts`, `web/src/components/{sessions,approvals}/`, `web/src/app/(protected)/app/sessions/`, `web/src/lib/{transcript-lines,notifications,session}.ts`, `web/src/lib/validation/mobile/` · Verified: 2026-10-13 @ c292f2f

## Purpose
The cloud side of reaching a running TUI from somewhere else. Three flows, all opt-in in the TUI
config and all driven by the TUI polling (the server never calls a device):
**session sync** (transcripts mirrored up for reading), **steering** (a prompt typed on the web or
phone, queued for the terminal to pick up), and **remote approval** (a permission prompt the agent is
blocked on, answered from the web or phone). Plus Expo push registration for the mobile app.

## How it works

**Session sync** (TUI config `syncSessions`, client `tui/src/agent/session-sync.ts`):
1. The TUI calls `GET /api/session/list` (device token) to get `{ id, lines }` for every session the
   server already has in its workstation. That list is the whole sync cursor, so the TUI keeps no
   local sync state.
2. For each session that grew, it posts the full JSONL plus totals to `POST /api/session/push`.
   `web/src/app/api/session/push/route.ts` → `POST`: 8 MiB cap (checked on `content-length` and on
   the read body), 60 pushes/min per device (counted from `sync_log`), refuses a session id owned by
   another workstation (403), answers `upToDate` if `lines` did not grow, else upserts `agent_session`
   and writes a `sync_log` row with `action: "session-push"`.
3. The web reads it: `/app/sessions` (`web/src/app/(protected)/app/sessions/page.tsx`, newest 100
   owned sessions) and `/app/sessions/[sessionId]` (`web/src/app/(protected)/app/sessions/[sessionId]/page.tsx`), which parses the
   transcript with `web/src/lib/transcript-lines.ts` → `transcriptLines` (messages and compaction
   markers; tool calls counted, not rendered; a truncated last line is skipped).

**Steering** (TUI config `remoteSteering`, client `tui/src/agent/remote-prompt.ts` → `claimPrompt`):
1. A client lists steerable sessions with `GET /api/session` (session auth). The route counts each
   session's pending prompts in SQL and passes rows through `web/src/server/steering.ts` →
   `steerable`: annotates `idleMs`, `fresh` (updated within `FRESH_MS`, 30 min) and `full`
   (`queued >= MAX_PENDING`, 10), sorts by idleness, caps at 50. `fresh` is an ordering hint only.
2. `POST /api/session/[sessionId]/prompt` queues a `session_prompt` row (`pending`). Owner only (via
   the session's workstation); a foreign or missing session is a 404 (`notFound()`). Refuses with
   429 `too_many_pending` at `MAX_PENDING` so a stuck terminal cannot be flooded.
3. The terminal polls `POST /api/device/prompt/claim` with its session id.
   `web/src/app/api/device/prompt/claim/route.ts` → `POST` runs one conditional `UPDATE … WHERE id =
   (SELECT … FOR UPDATE SKIP LOCKED)` scoped to the device's workstation in SQL, flipping the oldest
   pending prompt to `delivered`. At-most-once: two terminals cannot take the same row.
4. `web/src/components/sessions/session-prompt-form.tsx` → `SessionPromptForm` shows "queued" vs
   "last picked up", polling `GET …/prompt` every 5 s only while something is pending. Cmd/Ctrl+Enter sends.

**Remote approval** (TUI config `remoteApproval`, client `tui/src/agent/remote-approval.ts` → `remoteAnswer`):
1. The blocked device posts `POST /api/approval` (device token) with tool, title, detail (≤4000),
   detailKind, subject. The route inserts an `approval` row with a 5-minute `expiresAt` and returns
   `{ id, interval: 3, expiresIn: 300 }`.
2. In the background (not awaited, so a slow Expo cannot stall the agent) it sends a push to every
   live Expo token of the device's owner (`getExpoPushTokensByUserId` → `sendPushNotification`).
3. The device polls `GET /api/approval/[id]` (403 if the row is another device's).
4. A human answers from the web (`web/src/components/approvals/approvals-card.tsx` → `ApprovalsCard`
   on the settings page, polled every 3 s) or the phone: `POST /api/approval/[id]/answer` with
   `once` or `reject`. The write is conditional on `answer IS NULL` and not expired, so the first
   writer wins and everyone else gets 409 `already_answered`.
5. If the terminal answered locally first, the device calls `DELETE /api/approval/[id]`, which sets
   `answer: "cancelled"` under the same `IS NULL` condition.

**Mobile push registration.** The app calls `PUT /api/mobile/notifications` with `{ expoToken }`.
`web/src/app/api/mobile/notifications/route.ts` → `PUT` stores it on the caller's better-auth
`session` row (`updateSessionWithExpoPushToken`) and, when it changed, sends a welcome push.
Tokens live per session, so two logged-in phones get two pushes and an expired session gets none.

## Files
| File | Responsibility |
|---|---|
| `web/src/server/steering.ts` | `MAX_PENDING`, `FRESH_MS`, `SessionRow`, `SteerableSession`, `steerable` |
| `web/src/server/db/queries/session.ts` | `getExpoPushTokensByUserId` (live, de-duplicated), `updateSessionWithExpoPushToken`, `getExpoPushTokenBySessionId` |
| `web/src/app/api/session/route.ts` | `GET`: the user's sessions annotated for steering |
| `web/src/app/api/session/list/route.ts` | `GET`: device's sync cursor `{ id, lines }` |
| `web/src/app/api/session/push/route.ts` | `POST`: upsert a transcript, rate-limit, log to `sync_log` |
| `web/src/app/api/session/[sessionId]/prompt/route.ts` | `POST` queue a prompt; `GET` last 20 prompts for the owner |
| `web/src/app/api/device/prompt/claim/route.ts` | `POST`: device claims the oldest pending prompt for a session |
| `web/src/app/api/approval/route.ts` | `POST` device creates an approval (+ push); `GET` user lists open approvals |
| `web/src/app/api/approval/[id]/route.ts` | `GET` device polls its approval; `DELETE` device cancels it |
| `web/src/app/api/approval/[id]/answer/route.ts` | `POST`: user answers `once`/`reject` |
| `web/src/app/api/mobile/notifications/route.ts` | `PUT`: register an Expo push token on the session |
| `web/src/lib/notifications.ts` | `sendPushNotification`: POST to Expo's push API; throws on a null token |
| `web/src/lib/validation/mobile/notifications.ts` | `notificationRequestSchema`, `NotificationRequest` |
| `web/src/lib/transcript-lines.ts` | `transcriptLines`, `TranscriptEntry`: JSONL → renderable entries |
| `web/src/lib/session.ts` | `getSession`: `React.cache`-wrapped `auth.api.getSession` for server components |
| `web/src/components/sessions/session-prompt-form.tsx` | `SessionPromptForm`: queue a prompt, show queue status |
| `web/src/components/approvals/approvals-card.tsx` | `ApprovalsCard`: pending approvals with Allow once / Reject |
| `web/src/app/(protected)/app/sessions/page.tsx` | Session list with turns, tokens, cost |
| `web/src/app/(protected)/app/sessions/[sessionId]/page.tsx` | Transcript viewer + `SessionPromptForm` |

## Interfaces

| Method · path | Auth | Body | Response | Handler |
|---|---|---|---|---|
| `GET /api/session` | session | — | `{ sessions: SteerableSession[] }` | `web/src/app/api/session/route.ts` → `GET` |
| `GET /api/session/list` | device token | — | `{ sessions: [{ id, lines }] }` | `web/src/app/api/session/list/route.ts` → `GET` |
| `POST /api/session/push` | device token | `{ id, title, cwd, startedAt, lines, transcript, turns?, inputTokens?, outputTokens?, costMicros? }` | `{ success, lines }` or `{ success, upToDate, lines }`; 400; 403; 413 `payload_too_large`; 429 `rate_limited` | `web/src/app/api/session/push/route.ts` → `POST` |
| `POST /api/session/[sessionId]/prompt` | session, owner | `{ prompt (trimmed 1–8000) }` | `{ id, status: "pending" }`; 404; 429 `too_many_pending` | `web/src/app/api/session/[sessionId]/prompt/route.ts` → `POST` |
| `GET /api/session/[sessionId]/prompt` | session, owner | — | `{ prompts: [{ id, prompt, status, createdAt, deliveredAt }] }` (20 newest) | same → `GET` |
| `POST /api/device/prompt/claim` | device token | `{ sessionId }` | `{ prompt: { id, prompt } \| null }` | `web/src/app/api/device/prompt/claim/route.ts` → `POST` |
| `POST /api/approval` | device token | `{ tool, title, detail?, detailKind?: "diff"\|"text", subject? }` | `{ id, interval, expiresIn }` | `web/src/app/api/approval/route.ts` → `POST` |
| `GET /api/approval` | session | — | `{ approvals: [{ id, tool, title, detail, detailKind, createdAt, expiresAt, deviceName }] }` (unanswered, unexpired, owned devices) | `web/src/app/api/approval/route.ts` → `GET` |
| `GET /api/approval/[id]` | device token, same device | — | `{ answer, expired }`; 403; 404 | `web/src/app/api/approval/[id]/route.ts` → `GET` |
| `DELETE /api/approval/[id]` | device token, same device | — | `{ success: true }` always | `web/src/app/api/approval/[id]/route.ts` → `DELETE` |
| `POST /api/approval/[id]/answer` | session, owns the device | `{ answer: "once" \| "reject" }` | `{ success, answer }`; 403; 404; 409 `already_answered` | `web/src/app/api/approval/[id]/answer/route.ts` → `POST` |
| `PUT /api/mobile/notifications` | session (cookie or bearer) | `{ expoToken }` | `{ message, userId }` on change; 400 on error | `web/src/app/api/mobile/notifications/route.ts` → `PUT` |

Pages: `/app/sessions`, `/app/sessions/[sessionId]`. The approvals card renders on `/app/settings`.
Mobile callers: `mobile/src/api.ts` (`/api/session`, `…/prompt`, `/api/approval`, `…/answer`,
`/api/mobile/notifications`).

## Data and state
| Table | Use |
|---|---|
| `agent_session` (`web/src/server/db/schemas/agent_session.ts`) | One mirrored TUI session: `id` is the TUI's `ses_…` id, `workstation_id`, `device_id`, `created_by`, `lines` (sync cursor), `transcript` (raw JSONL), `turns`, tokens, `cost_micros` |
| `session_prompt` (`web/src/server/db/schemas/session_prompt.ts`) | Queued steering prompt: `status` `pending`/`delivered`/`cancelled`, `delivered_at`; indexed on `(session_id, status)` |
| `approval` (`web/src/server/db/schemas/approval.ts`) | Pending permission prompt: `device_id`, `tool`, `title`, `detail`, `detail_kind`, `answer` (NULL = pending), `answered_by`, `expires_at` |
| `session` (better-auth) | `mobile_expo_push_token` column |
| `sync_log` | Written per push (`session-push`), also the push rate-limit counter |
| `workstation`, `device` | Joined for ownership |

Env vars: none of its own. External: Expo push API (`https://exp.host/--/api/v2/push/send`). No caches
beyond `React.cache` in `web/src/lib/session.ts`, which lives for one render.

## Depends on / used by
- Depends on: [devices-and-pairing](../devices-and-pairing/README.md) (`authenticateDevice`, `forbidden`),
  [auth-and-accounts](../auth-and-accounts/README.md) (`auth.api.getSession`), `web/src/lib/format.ts`
  (`money`, `thousands`), `web/src/lib/api/error.ts` (`problem`).
- Used by: the TUI ([tui/agent](../../tui/agent/README.md): `session-sync.ts`, `remote-prompt.ts`,
  `remote-approval.ts`), the [mobile](../../mobile/README.md) app, the settings page.
  `web/src/lib/session.ts` → `getSession` is used by the protected layout and other server pages too.
  The [gateway](../gateway/README.md) usage page reads `agent_session`.

## Gotchas
- **Ownership is always through the workstation.** Neither `agent_session` nor `session_prompt` nor
  `approval` has a `user_id`; the owner is `workstation.userId` or `device.userId`, one join away.
- **Steering and approval are both opt-in on the TUI** (`remoteSteering`, `remoteApproval`,
  `syncSessions`, all default `false` in `tui/src/config/config.ts`). A queued prompt still goes
  through the terminal's permission gate.
- **No `always` answer remotely.** `answer` accepts only `once`/`reject`: `always` would widen
  policy on disk (`persistGrants`), which a phone tap should not do.
- Foreign session ids are 404, not 403, both in the viewer and the prompt route.
- `session_prompt.status = "cancelled"` is defined in the schema but no route sets it.
- `PUT /api/mobile/notifications` does not run `notificationRequestSchema`; it casts the body. When
  the token is unchanged the handler returns nothing (no `Response`), which Next.js treats as an error.
- `getExpoPushTokensByUserId` only returns tokens on unexpired sessions; push is a nudge, the
  approval is always answerable on the web.
- `web/src/lib/session.ts` → `getSession` is for server components only; route handlers call
  `auth.api.getSession` directly.
- The push size cap is in characters (`raw.length`) after the `content-length` check, not bytes.

## Tests
- `web/src/__tests__/steering.test.ts`: `steerable`, `FRESH_MS`, `MAX_PENDING`.
- TUI side: `tui/test/session-sync.test.ts`, `tui/test/remote-prompt.test.ts`, `tui/test/remote-approval.test.ts`.

Run: `pnpm --filter web test`; TUI: `cd tui && bun test test/session-sync test/remote-`.
Route handlers and `transcriptLines` have no tests.
