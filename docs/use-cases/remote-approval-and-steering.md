# Remote approval and steering

Modules: [web/sessions-and-approvals](../modules/web/sessions-and-approvals/README.md), [mobile](../modules/mobile/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why
A developer leaves a long `jarvis` turn running and walks away. From the web app or the phone
they can read the session's transcript, answer the permission prompt that stopped the agent,
and queue the next prompt for the terminal. The server never calls the terminal. The terminal
polls, and each flow is off until the user turns it on in the TUI config.

## Flow
**Setup.** The TUI must be paired ([pair-a-device.md](pair-a-device.md)). Three config switches,
all `false` by default (`tui/src/config/config.ts`):
- `syncSessions`: mirror transcripts to the web.
- `remoteApproval`: mirror permission prompts.
- `remoteSteering`: accept prompts typed elsewhere.

Steering also needs `syncSessions`, because a session the server has never seen cannot be
listed or claimed.

**Session sync**
1. At startup the TUI fetches the server's cursor (`GET /api/session/list`, `{ id, lines }` per
   session) and uploads every older session that grew (`tui/src/agent/session-sync.ts` →
   `pushSessions`). The live session is skipped here.
2. After every turn it pushes the live session (`pushSession`) without waiting for the result.
   A new session therefore appears on the web once its first turn ends.
3. `POST /api/session/push` upserts the whole JSONL with turn, token and cost totals
   (`web/src/app/api/session/push/route.ts`).
4. The web lists the 100 most recently updated sessions at `/app/sessions` and renders one
   transcript at `/app/sessions/<id>`. Tool calls are counted, not shown.

**Remote approval**
1. The agent hits an `ask` rule. The terminal shows its prompt and, with `remoteApproval` on,
   also posts `POST /api/approval` with tool, title, detail (cut to 4000 characters),
   detail kind and subject (`tui/src/agent/remote-approval.ts` → `remoteAnswer`). The
   transcript says "also asking on <host> — answer here or there".
2. The server stores an `approval` row that expires in 5 minutes and answers
   `{ id, interval: 3, expiresIn: 300 }` (`web/src/app/api/approval/route.ts`). Without waiting, it
   sends an Expo push "<device name> needs approval" to every phone signed in as the device's
   owner.
3. The web settings page (`ApprovalsCard`, refreshed every 3 s) and the phone's Approvals
   screen list open approvals from `GET /api/approval`: unanswered, unexpired, on the user's own
   devices.
4. The user taps **Allow once** or **Reject** (`POST /api/approval/<id>/answer`).
5. The terminal polls `GET /api/approval/<id>` every 3 s. An `once` or `reject` answer closes
   the local prompt and the tool runs or fails.
6. If the user answers in the terminal first, the poll stops and the TUI sends
   `DELETE /api/approval/<id>`, which marks the row `cancelled` so it leaves the phone. The
   delete is sent in every case, including after a remote answer, where it does nothing.

**Steering**
1. The user picks a session. The phone lists them with `GET /api/session`: each row carries
   `idleMs`, `fresh` and `full`, sorted by idleness, at most 50 (`web/src/server/steering.ts` →
   `steerable`). On the web, the prompt form sits under the transcript at `/app/sessions/<id>`.
2. The user types (web, Cmd/Ctrl+Enter) or dictates (phone Talk screen) a prompt and sends it:
   `POST /api/session/<id>/prompt` stores a `pending` row. The phone never sends dictation by
   itself. The user edits it and taps Send.
3. While the terminal is idle, it calls `POST /api/device/prompt/claim` every 5 s for the session
   on screen (`tui/src/ui/app.tsx`, `STEER_POLL_MS`).
4. The server marks the oldest pending prompt for that session `delivered` and returns it
   (`web/src/app/api/device/prompt/claim/route.ts`). The terminal notes "prompt from the web app"
   and sends it like typed input, so the permission gate still applies to every tool it triggers.
5. The web form shows "N queued, waiting for the workstation" and re-checks every 5 s while
   anything is pending.

## Business rules
- **Who may answer or steer:** only the signed-in user who owns the device or workstation.
  Answering another user's approval is a 403. A device can poll only its own approvals (403
  otherwise), and its cancel only touches its own rows. Another user's session is a 404, not a
  403, so its id is not revealed.
- **Answers are `once` or `reject` only.** "Always" is refused remotely because it would widen
  policy, and with `persistGrants` it would edit config on disk
  (`web/src/app/api/approval/[id]/answer/route.ts`).
- **First answer wins.** The write is conditional on `answer IS NULL` and not expired. A second
  answer gets 409 `already_answered`, and the terminal's cancel becomes a no-op.
- **Approval TTL:** 5 minutes server-side. The TUI stops polling at `expiresIn` (default 5 min)
  and then waits for the terminal answer only. Nothing is ever answered automatically.
- **Approval field caps:** title ≤ 200, detail ≤ 4000, subject ≤ 2000, tool ≤ 64 characters.
- **Steering queue:** at most `MAX_PENDING` = 10 pending prompts per session, after which the
  server answers 429 `too_many_pending`. Prompts are trimmed, 1–8000 characters. `fresh` means
  updated within 30 minutes (`FRESH_MS`). It only affects ordering and is never a gate.
- **At most once:** the claim is one `UPDATE … FOR UPDATE SKIP LOCKED` scoped to the device's
  workstation. A claimed prompt is never handed out again. If a local turn starts while a claim
  is in flight, the prompt is parked and delivered on the next idle poll, but only into the same
  session.
- **Steering only between turns**, and only into the session in the foreground.
- **Session push:** 8 MiB per transcript (bigger ones are skipped by the TUI), 60 pushes a minute
  per device, counted from `sync_log` and shared with blueprint and code pushes. A session id
  owned by another workstation is a 403.
- **Push notifications:** sent only to Expo tokens on unexpired sign-in sessions, and they are a
  nudge only. The approval can always be answered on the web.

## When it fails
- **Phone or web shows no sessions:** `syncSessions` is off, the device is not paired, or the
  session has not finished a turn yet.
- **409 on an answer:** someone already answered, or the approval expired. The phone drops the
  row quietly. The terminal prompt is still the answer of record.
- **"could not ask your other devices: … 400":** a field went over a cap (often a long `bash`
  command as the subject). Answer in the terminal.
- **No answer within 5 minutes:** remote polling stops, and the terminal prompt stays up until
  someone answers it there.
- **429 on send:** the terminal has not picked up 10 earlier prompts, because it is busy, closed
  or has `remoteSteering` off. Wait or check the terminal.
- **"a prompt from the web app was lost when session … closed":** a parked prompt belonged to
  a session the user switched away from. It is not replayed.
- **401 on the phone:** the sign-in token expired or was revoked. The app signs out.

## Related
- [Agent turn and permissions](agent-turn-and-permissions.md): the gate that raises the prompt.
- [Pair a device](pair-a-device.md): the device token every TUI call uses.
- [Sign up and sign in](sign-up-and-sign-in.md): the phone's bearer sign-in.
- [Voice](voice.md): dictating on the phone's Talk screen.
- Module docs: [web/sessions-and-approvals](../modules/web/sessions-and-approvals/README.md),
  [mobile](../modules/mobile/README.md), [tui/agent](../modules/tui/agent/README.md).
