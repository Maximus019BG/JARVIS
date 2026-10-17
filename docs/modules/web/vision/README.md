# Vision

Code: `web/src/server/vision.ts`, `web/src/server/hand/`, `web/src/app/api/vision/`, `web/src/app/api/device/hand/`, `web/models/` · Verified: 2026-10-16 @ 3a9c2d9

## Purpose
Runs the camera models for paired devices, so a laptop or a Pi needs no ONNX runtime and no
model files of its own. It provides hand tracking (landmarks, and gesture and motion labels)
for the TUI's freehand pen and gesture commands, and few-shot item teaching and finding for
`/learn`, `/find` and the agent's `find_item`. Images are decoded, run and then discarded.
Only the patch features of a taught item are stored.

## How it works

### Shared code, through the `@pi/*` alias
The model code is not copied into the web app. It is the TUI's own source in `tui/src/pi/`,
which is written runtime-neutral: it imports nothing from Bun or Node, and `ort` is passed in
(see [tui/pi-vision](../../tui/pi-vision/README.md)). Three files make the alias work:
- `web/tsconfig.json` maps `@pi/*` → `../tui/src/pi/*`.
- `web/next.config.ts` sets `experimental.externalDir: true`, so Next compiles TypeScript that lives outside `web/`.
- `web/jest.config.cjs` repeats the mapping in `moduleNameMapper`.

The web app imports `@pi/track.ts` (`createTracker`), `@pi/detect.ts` (the `TrailPoint` type)
and `@pi/items.ts` (`createEmbedder`, `learn`, `locate`, `ItemError`, `DEFAULT_THRESHOLD`).
Because both sides run the same file, the Pi and the hosted model cannot disagree about how a
frame becomes landmarks.

### Model loading
- `onnxruntime-node` is in `serverExternalPackages`: it is loaded from `node_modules`, not bundled.
- `outputFileTracingIncludes` in `web/next.config.ts` adds the linux-x64 native binary and the model files to each route's trace by hand. File tracing cannot follow the `.node` path, which is computed at runtime.
- Both loaders import `onnxruntime-node` dynamically on the first request, cache the promise, and clear it on failure. A missing model is therefore retried on the next request and not cached as a failure.
  - Hand: `web/src/app/api/device/hand/route.ts` → `getTracker` loads `web/models/hand/palm_detection.onnx` and `hand_landmark.onnx`. `loadGesture` adds `hand_gesture.onnx` with its `hand_gesture.json` labels, but only when both files are present.
  - Items: `web/src/server/vision.ts` → `getEmbedder` loads `web/models/items/dinov2-small.onnx`.
- A load failure returns **503**. The TUI treats that as fatal and points the user at the model README.

### Auth: device token vs ticket
- **Device token** (`jvd_…`, checked by `~/server/device-auth` → `authenticateDevice`) costs a database query.
- **Hand ticket** (`jvh_…`): `web/src/server/hand/ticket.ts` → `signTicket` produces `jvh_<base64url claims>.<HMAC>`. The claims are `{d: deviceId, w: workstationId, s: scopes, exp}`, and the ticket lives `TICKET_TTL_MS` (5 min). The HMAC key is derived from `BETTER_AUTH_SECRET` with the label `"hand-ticket:v1"`, so the auth secret itself never signs anything outside better-auth. `verifyTicket` checks the signature with `timingSafeEqual`, then the expiry and the claim types.
- A device trades its token for a ticket once (`POST /api/device/hand/ticket`), then sends the ticket with every frame or find. Checking a ticket is an HMAC, with no database round trip.
- `web/src/server/vision.ts`:
  - `deviceFor(request, scope)` requires the device token and checks `device.scopes` with `~/server/mcp/scopes` → `satisfies`. `vision:write` implies `vision:read`.
  - `callerFor(request, scope)` accepts a `jvh_` ticket, checking the scopes it carries, and otherwise falls back to `deviceFor`.

### Hand frame (`POST /api/device/hand`)
1. `verifyTicket`. It must be a ticket: a device token gets a 401.
2. The body must be `image/jpeg` of at most 300 KB. It is decoded with `jpeg-js`, capped at 1.3 MP and 64 MB as a guard against decompression bombs.
3. `x-hand-roi` (`x,y,w,h;…`, at most 2 regions) and `x-hand-trail` (`x,y,span;…`, at most 64 points) are validated with zod. `x-hand-detect: 1` forces palm detection.
4. `tracker.step(...)` runs inside `serial`, a per-instance promise queue. The tracker reuses its tensor buffers, so two concurrent runs would corrupt each other, and inference is CPU-bound anyway.
5. The response is `{hands, rois, trail, motion, ms}` with `cache-control: no-store`. `trail` is formatted back into the header string, which the client echoes on its next frame. That way the server keeps no state, and any instance can serve any frame.

### Items (`/api/vision/items`, `/api/vision/detect`)
- **Teach** (`POST /api/vision/items`):
  1. Each base64 JPEG is decoded (`decodeJpeg`, capped at 4 MP) and embedded. A boxed one is embedded again under each of `LIGHTS` (`relight`), two more model runs, so the item is known under other lights too.
  2. `learn(samples)` builds the `pos` and `neg` banks. A photo whose `box` is `null` is an empty shot and goes wholly to `neg`. Then `pos` patches that match the background are dropped (`BACKGROUND_SIM`).
  3. Each bank is packed by `packBank`: each unit vector component × 127 as int8, then base64. That is a quarter of the size of float32, with rounding error far below any useful threshold.
  4. The item is upserted into `vision_item` on `(workstationId, name)`, so teaching a name again replaces it. With `add: true`, the stored row is selected first (one more query, only then) and `merge`d with the new banks, and the sample counts are summed.
- **Find** (`POST /api/vision/detect`): the item query and the embedding run in parallel. Each item's banks are unpacked (`unpackBank`) and passed to `locate`. Coordinates are rounded, and `best` is returned even on a miss so the threshold can be tuned per camera.

## Files
| File | Responsibility |
|---|---|
| `web/src/server/vision.ts` | Shared by both item routes: `getEmbedder` (lazy DINOv2), `modelMissing` (503), `decodeJpeg` (4 MP cap), `deviceFor`, `callerFor`, `packBank`/`unpackBank` |
| `web/src/server/hand/ticket.ts` | `signTicket`, `verifyTicket`, `TICKET_TTL_MS`, `TicketHolder`: HMAC tickets |
| `web/src/app/api/device/hand/route.ts` | `POST`: one JPEG frame → landmarks/labels; lazy `getTracker`, `serial` queue, header schemas |
| `web/src/app/api/device/hand/ticket/route.ts` | `POST`: device token → ticket |
| `web/src/app/api/vision/items/route.ts` | `POST` teach, `GET` list, `DELETE` forget |
| `web/src/app/api/vision/detect/route.ts` | `POST`: find taught items in one JPEG |
| `web/models/hand/README.md` | Which hand files go here, and the gesture model's input/output contract |
| `web/models/hand/palm_detection.onnx` | MediaPipe palm detector, 192 px (committed) |
| `web/models/hand/hand_landmark.onnx` | MediaPipe 21-point hand landmarks, 224 px (committed) |
| `web/models/hand/hand_gesture.onnx` | Our gesture and motion classifier, from `models/hand_gestgures.ipynb` (committed, optional at runtime) |
| `web/models/hand/hand_gesture.json` | Classifier labels (`gesture`, `motion`) and trail `window` (16) |
| `web/models/items/README.md` | Where `dinov2-small.onnx` comes from, and its input sizing |
| `web/models/items/dinov2-small.onnx` | DINOv2 ViT-S/14, int8, ~24 MB (committed) |

## Interfaces

| Method · route | Auth | Request | Response |
|---|---|---|---|
| `POST /api/device/hand/ticket` | Device token (`authenticateDevice`); no scope check | — | `{ticket, expiresAt}` (ms epoch) |
| `POST /api/device/hand` | Ticket only (`verifyTicket`); scopes not checked | Body `image/jpeg` ≤ 300 KB. Headers `x-hand-detect: 0\|1`, `x-hand-roi`, `x-hand-trail` | `{hands: Hand[], rois?, trail?, motion?, ms}` |
| `POST /api/vision/items` | Device token + `vision:write` (`deviceFor`) | JSON ≤ 10 MB: `{name (1–64), images: [{jpeg: base64, box: [x,y,w,h] \| null}] (1–20, at least one boxed), add?: boolean}` | `{id, name, samples}` |
| `GET /api/vision/items` | Device token + `vision:read` | — | `{items: [{id, name, samples, updatedAt}]}`, ordered by name |
| `DELETE /api/vision/items?id=` | Device token + `vision:write` | `id` query | `{success: true}` or 404 `not_found` |
| `POST /api/vision/detect?item=&threshold=` | Ticket or device token + `vision:read` (`callerFor`) | Body `image/jpeg` ≤ 2 MB. `item` is an id or name; `threshold` is in [0,1] | `{items: [{id, name, found, best, boxes: [{x,y,w,h,score}]}], ms}` |

`Hand` is `{score, landmarks: [{x,y,z?}] ×21, gesture?: {name, score}}` in the frame's pixels
(`tui/src/pi/gestures.ts` → `Hand`).

Error responses:

| Status | When |
|---|---|
| 401 | Bad or expired ticket or token |
| 403 | Device lacks the scope |
| 400 | Undecodable JPEG, bad header, bad body, a box too small, no boxed photo, or an item that is all background (`ItemError`) |
| 404 | No items taught, or no such item |
| 413 | Body too large |
| 415 | Not `image/jpeg` |
| 503 | Model not installed |

Clients: `tui/src/pi/hand-source.ts` (`remoteSource`, `ticketFor`) and `tui/src/pi/items-client.ts`.

## Data and state
- **DB**: the `vision_item` table (`web/src/server/db/schemas/vision_item.ts`).
  - Columns: `id` (`vit_…`), `workstationId`, `createdBy`, `deviceId`, `name`, `samples`, `pos`, `neg`, `createdAt`, `updatedAt`.
  - Unique on `(workstation_id, name)`.
  - Items belong to the workstation, not to the device that taught them.
- **Env**: `BETTER_AUTH_SECRET`, from which the ticket HMAC key is derived.
- **Disk**: `web/models/` is read at `process.cwd()/models/...`.
- **In memory, per instance**: the `tracker` and `embedder` promises, and the `serial` queue.
- **Not stored or logged**: frames and photos.

Model sources and retraining: [web/models/hand/README.md](../../../../web/models/hand/README.md),
[web/models/items/README.md](../../../../web/models/items/README.md), [models/README.md](../../../../models/README.md).

## Depends on / used by
- **Depends on**:
  - `tui/src/pi/{track,detect,items,gestures}.ts` through `@pi/*`
  - `~/server/device-auth` and `~/server/mcp/scopes` ([web/devices-and-pairing](../devices-and-pairing/README.md))
  - the database ([web/database](../database/README.md))
  - `onnxruntime-node` 1.30 and `jpeg-js`
- **Used by**:
  - the TUI's gestures, freehand pen, `/learn`, `/find` and `find_item` ([tui/pi-vision](../../tui/pi-vision/README.md))
  - the `vision` area in `MCP_AREAS`, which is what the Devices scope matrix grants

## Gotchas
- **Shared code must stay runtime-neutral.** Anything added to `tui/src/pi/{track,detect,items,gestures}.ts` is compiled by Next.js too, so no `Bun.*` and no `node:` imports. A new `@pi` path needs nothing extra, but the jest mapping and tsconfig paths must keep matching each other.
- **Revocation and scopes lag for ticket holders.** A revoked device, or one whose scopes changed, keeps working until its ticket expires (up to 5 minutes; `ponytail:` in `ticket.ts`).
- **The hand route checks no scope.** `/api/device/hand` only verifies the ticket signature, and `/api/device/hand/ticket` issues a ticket to any active device. Hand tracking therefore needs no `vision` scope; only the item routes check one.
- **One inference at a time per instance** (`serial`, `ponytail:`). Throughput comes from more instances, not from concurrency within one.
- **The model READMEs talk about dropping files in.** All five model files are committed under `web/models/`. The TUI's local path downloads its own copies into `<dataDir>/models` (`jarvis pi models`).
- **Only linux-x64 is traced** for `onnxruntime-node`. A standalone build for another platform needs that platform's binary added to `outputFileTracingIncludes`.
- **Body limits:**

  | Route | Limit |
  |---|---|
  | Hand frame | 300 KB and 1.3 MP |
  | Detect | 2 MB and 4 MP |
  | Items | 10 MB JSON, sized under nginx's 10 MB cap |

  Phones should downscale before sending.
- **`preferredRegion` is commented out** in the hand route. Latency is dominated by the round trip, so it should run near the user, not near the database.

## Tests
`cd web && pnpm test` (Jest; `pnpm test -- vision-items` for a single file).

| File | Covers |
|---|---|
| `web/src/__tests__/vision-items.test.ts` | `@pi/items.ts` → `learn` (edge ring, too-small box, empty shot and background prune, all-background and box-less teaches), `learn` relit copies (found under the copy's light, pruned with their original, every light kept in a full bank), `merge` (both rooms found, capped), `relight`, `locate` (connected boxes, seed-and-grow groups, no false match), `packBank`/`unpackBank` round trip |
| `web/src/__tests__/hand-ticket.test.ts` | `signTicket`/`verifyTicket`: round trip, legacy ticket without workstation, expiry, tampered payload, wrong secret, device tokens refused |

The routes themselves have no tests. The tracker is covered on the TUI side (`tui/test/pi-track.test.ts`, `tui/test/pi-detect.test.ts`).
