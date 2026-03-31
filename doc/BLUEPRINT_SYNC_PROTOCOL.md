# Hardware ↔ Server Blueprint Sync Protocol

This document describes how the hardware client and server blueprint sync works end-to-end, including required security headers, offline queuing on the device, and server-side persistence.

Primary references in code:

- Hardware orchestration: [`SyncManager.sync_to_server()`](hardware/core/sync/sync_manager.py:35), [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55), [`SyncManager.update_blueprint()`](hardware/core/sync/sync_manager.py:89), [`SyncManager.resolve_conflict()`](hardware/core/sync/sync_manager.py:113), [`SyncManager.list_blueprint_versions()`](hardware/core/sync/sync_manager.py:137), [`SyncManager.restore_blueprint_version()`](hardware/core/sync/sync_manager.py:155), [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29), [`OfflineQueue.pop()`](hardware/core/sync/offline_queue.py:43)
- Server routes: [`GET()`](web/src/app/api/workstation/blueprint/sync/route.ts:9), [`POST()`](web/src/app/api/workstation/blueprint/push/route.ts:11), [`POST()`](web/src/app/api/workstation/blueprint/pull/route.ts:10), [`POST()`](web/src/app/api/workstation/blueprint/resolve/route.ts:11), [`GET()`](web/src/app/api/workstation/blueprint/versions/route.ts:17), [`POST()`](web/src/app/api/workstation/blueprint/restore/route.ts:25), [`GET()`](web/src/app/api/workstation/device/usage/route.ts:21)
- Security helpers: [`verifyDeviceToken()`](web/src/lib/device-auth.ts:12), [`verifyHMACSignature()`](web/src/lib/hmac-verify.ts:3), [`replayProtection()`](web/src/middleware/replay-protection.ts:9), [`idempotency()`](web/src/middleware/idempotency.ts:8), [`storeIdempotencyResponse()`](web/src/middleware/idempotency.ts:42)

## Actors

### Hardware client (device)

- Stores local blueprint JSON files under [`data/blueprints/*.json`](data/blueprints:1).
- Initiates sync to server using REST calls via the hardware HTTP client.
- If offline or server errors occur, queues operations locally in [`data/offline_queue.json`](data/offline_queue.json:1) using [`OfflineQueue`](hardware/core/sync/offline_queue.py:7).

### Server API

- Provides blueprint sync endpoints under `/api/workstation/blueprint/*`.
- Enforces:
  - device authentication (JWT)
  - request integrity (HMAC)
  - replay protection (timestamp + nonce)
  - idempotency (for push)

### Database (server)

Persists:

- Blueprint records: [`blueprint`](web/src/server/db/schemas/blueprint.ts:6)
- Seen nonces for replay protection: [`nonce`](web/src/server/db/schemas/nonce.ts:4)
- Idempotency cache: `idempotency_key` (see [`idempotency()`](web/src/middleware/idempotency.ts:8) and migration [`0003_blueprint_sync.sql`](web/drizzle/0003_blueprint_sync.sql:30))
- Device registration and active status: [`device`](web/src/server/db/schemas/device.ts:5)

## Endpoints and flows

All endpoints are HTTPS and require the security headers described in [Security model](#security-model).

### 1) `/sync` (GET) — server delta scan

Server implementation: [`GET()`](web/src/app/api/workstation/blueprint/sync/route.ts:9)

Purpose:

- Hardware asks: which blueprints changed since my last successful sync timestamp?

Request:

- `GET /api/workstation/blueprint/sync?since=<iso8601>`
- `since` is optional; hardware generally uses `SyncConfigManager`’s last sync timestamp as sent by [`SyncManager.sync_to_server()`](hardware/core/sync/sync_manager.py:35).

Server behavior:

- Validates required headers.
- Validates device token via [`verifyDeviceToken()`](web/src/lib/device-auth.ts:12) and ensures `claims.deviceId === X-Device-Id`.
- Applies replay protection via [`replayProtection()`](web/src/middleware/replay-protection.ts:9).
- Validates HMAC for payload `{ since }` via [`verifyHMACSignature()`](web/src/lib/hmac-verify.ts:3).
- Queries blueprint table by `workstationId` and `updatedAt >= since` if provided.

Hardware behavior:

- On success, hardware updates its `last_sync_timestamp` and uses the returned list for decision-making.
- On failure, hardware enqueues a `sync` operation: [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29) called by [`SyncManager.sync_to_server()`](hardware/core/sync/sync_manager.py:35).

### 2) `/push` (POST) — upload local blueprint

Server implementation: [`POST()`](web/src/app/api/workstation/blueprint/push/route.ts:11)

Purpose:

- Hardware sends a local blueprint revision to the server.

Hardware flow:

- Loads blueprint JSON from disk.
- Computes `hash = sha256(json.dumps(data, sort_keys=True))` in [`SyncManager._calculate_hash()`](hardware/core/sync/sync_manager.py:249).
- Computes `X-Idempotency-Key = <blueprintId>_<version>` and calls server from [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55).
- On success, updates local `version` field in the file via [`SyncManager._update_blueprint_version()`](hardware/core/sync/sync_manager.py:234).
- On failure, enqueues a `push` operation with the blueprint path and payload: [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29).

Server flow:

1. Idempotency check runs first via [`idempotency()`](web/src/middleware/idempotency.ts:8). If a stored response exists, the server returns it with `X-Idempotency-Replayed: true`.
2. Validates headers + device token + replay protection + HMAC signature of the JSON body.
3. Validates required fields: `blueprintId`, `name`, `data`, `version`, `hash`.
4. Checks for conflicts:
   - If existing blueprint belongs to a different workstation: 403
   - If existing version is `>=` incoming `version`: 409 conflict
5. Creates or updates the blueprint row and logs the operation.
6. Stores the response for future idempotent replays via [`storeIdempotencyResponse()`](web/src/middleware/idempotency.ts:42).

Conflict outcome:

- Hardware must resolve by pulling latest, then choosing `/resolve` strategy, or by re-sending with a higher version after reconciliation.

### 3) `/pull` (POST) — download blueprint from server

Server implementation: [`POST()`](web/src/app/api/workstation/blueprint/pull/route.ts:10)

Purpose:

- Hardware requests one blueprint by id (typically when server has a newer version).

Hardware flow:

- Sends `{ blueprintId, localVersion }` from [`SyncManager.update_blueprint()`](hardware/core/sync/sync_manager.py:89).
- On success, writes returned blueprint content to local storage using [`SyncManager._save_blueprint()`](hardware/core/sync/sync_manager.py:222).
- On failure, enqueues a `pull` operation: [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29).

Server behavior:

- Validates headers + device token + replay protection + HMAC signature.
- Looks up blueprint by id.
- Enforces workstation ownership (prevents IDOR).
- Returns parsed `metadata` as `data`.

### 4) `/resolve` (POST) — server-side conflict resolution

Server implementation: [`POST()`](web/src/app/api/workstation/blueprint/resolve/route.ts:11)

Purpose:

- Hardware requests the server to finalize a resolution when local and server versions diverge.

Request body:

- `blueprintId`: target
- `resolution`: one of `server`, `local`, `merge`
- `localData`: client-side blueprint content
- `serverData`: server-side blueprint content (hardware obtains it with an internal pull in [`SyncManager._get_server_blueprint_data()`](hardware/core/sync/sync_manager.py:209))

Server behavior:

- Validates headers + device token + replay protection + HMAC signature.
- Checks resolution enum.
- Fetches existing blueprint and validates workstation ownership.
- Creates `mergedData`:
  - `server`: server wins
  - `local`: local wins
  - `merge`: server wins conflicts; preserve local-only keys
- Increments version (server authoritative): `existing.version + 1`
- Recomputes hash of `mergedData`.
- Updates blueprint row and returns `{ blueprintId, version, mergedData, hash }`.

Hardware behavior:

- Writes response to disk via [`SyncManager._save_blueprint()`](hardware/core/sync/sync_manager.py:222).

### 5) `/versions` (GET) — list blueprint version history

Server implementation: [`GET()`](web/src/app/api/workstation/blueprint/versions/route.ts:17)

Purpose:

- Retrieve the list of historical snapshots for a blueprint so the user or hardware can choose a version to restore.

Request:

- `GET /api/workstation/blueprint/versions?blueprintId=<id>`

Server behavior:

- Validates required headers + device auth + replay protection.
- Validates HMAC for payload `{ blueprintId }`.
- Checks workstation ownership.
- Returns all `blueprint_version` rows ordered newest-first.

Returns:

- `{ success, blueprintId, currentVersion, versions: [{ id, version, hash, deviceId, createdAt }] }`

### 6) `/restore` (POST) — restore a historical version

Server implementation: [`POST()`](web/src/app/api/workstation/blueprint/restore/route.ts:25)

Purpose:

- Roll a blueprint back to any previously snapshotted version.

Hardware flow:

- Calls [`SyncManager.restore_blueprint_version()`](hardware/core/sync/sync_manager.py:155) with `blueprintId` and `targetVersion`.
- On success, saves the restored content locally.
- On failure, does NOT queue offline (restore is intentional; user must retry).

Request body:

- `blueprintId`: target blueprint
- `targetVersion`: version number from the history to restore

Server behavior:

- Validates headers + device auth + replay protection + HMAC signature.
- Loads current blueprint and validates workstation ownership.
- Locates the historical snapshot for `targetVersion`.
- Snapshots the current live version into `blueprint_version` (so the rollback is also reversible).
- Updates the blueprint row with the historical content, using `existing.version + 1` as the new version number.
- Logs the operation as `action: "restore"` in `sync_log`.
- Returns `{ success, blueprintId, restoredFromVersion, version, hash, data }`.

### 7) `/api/workstation/device/usage` (GET) — API request counts

Server implementation: [`GET()`](web/src/app/api/workstation/device/usage/route.ts:21)

Purpose:

- Web dashboard and admins can view how many API sync operations each device has made within a time window.

Authentication:

- User session (web dashboard, not device JWT).

Query parameters:

- `workstationId` (optional): restrict to one workstation
- `days` (optional, default 30): look-back window

Returns:

- `{ windowDays, since, totalRequests, requests: [{ deviceId, deviceName, workstationId, workstationName, totalRequests, byAction }] }`

### 8) Offline queue behavior (hardware)

Implementation: [`OfflineQueue`](hardware/core/sync/offline_queue.py:7), processor loop in [`SyncManager.process_offline_queue()`](hardware/core/sync/sync_manager.py:137)

Stored as JSON list in [`data/offline_queue.json`](data/offline_queue.json:1).

- On any network or server failure, an operation is appended to the queue with `type`, `data`, and a timestamp.
- When connectivity returns, hardware processes entries FIFO:
  - `sync` → call [`SyncManager.sync_to_server()`](hardware/core/sync/sync_manager.py:35)
  - `push` → call [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55)
  - `pull` → call [`SyncManager.update_blueprint()`](hardware/core/sync/sync_manager.py:89)
  - `restore` → call [`SyncManager.restore_blueprint_version()`](hardware/core/sync/sync_manager.py:155)
- If an operation fails during processing, it is re-added to the queue.

Notes:

- Queue size is capped: when full, oldest entries are dropped in [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29).

## Security model

The server applies defense-in-depth. Every request must satisfy all layers.

### Required headers

Across endpoints, the server expects:

- `Authorization: Bearer <device_jwt>`
- `X-Device-Id: <device_id>`
- `X-Timestamp: <iso8601>`
- `X-Nonce: <random_unique>`
- `X-Signature: <hex_hmac_sha256>`

For idempotent operations:

- `X-Idempotency-Key: <string>` (used by `/push`)

### JWT device token (authentication)

Server verification: [`verifyDeviceToken()`](web/src/lib/device-auth.ts:12)

- Token is verified using `BLUEPRINT_SYNC_JWT_SECRET`.
- The decoded JWT claims are required to match the request device:
  - `claims.deviceId === X-Device-Id`
- Device must exist in DB and be active (`device.isActive === true`).

Operational assumption:

- Tokens are long-lived by default (see `DEVICE_TOKEN_EXPIRY_HOURS` default in [`generateDeviceToken()`](web/src/lib/device-auth.ts:38)). If production requires shorter TTLs, the system needs a refresh/rotation strategy.

### HMAC signature (integrity)

Server verification: [`verifyHMACSignature()`](web/src/lib/hmac-verify.ts:3)

- Canonical object:
  - `timestamp` (from `X-Timestamp`)
  - `nonce` (from `X-Nonce`)
  - `payload` (body JSON, or `{ since }` for sync)
- Signature is `HMAC_SHA256(secret, JSON.stringify(canonical, sortedKeys))` encoded as hex.
- Server compares signatures using timing-safe equality.

Important constraint:

- Client and server must use identical canonicalization. Differences in JSON serialization or key ordering will break verification.

### Timestamp/nonce replay protection

Server middleware: [`replayProtection()`](web/src/middleware/replay-protection.ts:9)

- `X-Timestamp` must be within ±300 seconds of server time.
- A `(deviceId, nonce)` pair can be used only once within the nonce expiry window.
- Server stores nonce rows with `expires_at` and rejects duplicates with 403.

### Idempotency behavior

Server middleware: [`idempotency()`](web/src/middleware/idempotency.ts:8)

- Used for safe retries when the device is uncertain whether a previous request succeeded.
- Only implemented on `/push` route today.
- A stored response is returned with:
  - HTTP 200
  - `X-Idempotency-Replayed: true`

Hardware behavior:

- The idempotency key used by hardware is derived from blueprint id + version: [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55).

## Data model

### Hardware storage

Blueprint files:

- Path: [`data/blueprints/*.json`](data/blueprints:1)
- Typical fields used by sync:
  - `id` (maps to server `blueprint.id`)
  - `name`
  - `data` (arbitrary JSON payload)
  - `version` (integer, server enforces monotonic updates)

Offline queue:

- Path: [`data/offline_queue.json`](data/offline_queue.json:1)
- Contents (per [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29)):
  - `type`: `sync` | `push` | `pull` | `restore`
  - `data`: operation-specific payload
  - `timestamp`: UTC ISO string

### Server storage

Blueprint table:

- Schema: [`blueprint`](web/src/server/db/schemas/blueprint.ts:6)
- Key fields used by sync:
  - `id`: blueprint identifier
  - `workstationId`: ownership boundary
  - `metadata`: JSON string for `data`
  - `version`: integer
  - `hash`: integrity marker for last stored payload
  - `syncStatus`, `lastSyncedAt`, `deviceId`, `updatedAt`

Blueprint version history table:

- Schema: [`blueprintVersion`](web/src/server/db/schemas/blueprint_version.ts:1)
- Immutable snapshot of each past `blueprint` state.
- Key fields:
  - `blueprintId`: FK to `blueprint.id` (CASCADE delete)
  - `version`: the version number captured in this snapshot
  - `metadata`: JSON string at that version
  - `hash`: sha256 of `metadata` at that version
  - `deviceId`, `createdBy`, `createdAt`
- A new row is inserted by the `/push` route whenever an existing blueprint is updated.
- A new row is also inserted by `/restore` before applying the rollback, so that restores are themselves reversible.

Nonce table:

- Schema: [`nonce`](web/src/server/db/schemas/nonce.ts:4)
- Stores nonce values per device with expiry and creation time.

Idempotency table:

- Migration: [`0003_blueprint_sync.sql`](web/drizzle/0003_blueprint_sync.sql:30)
- Stores `(key, device_id, response, expires_at)`.

Device table:

- Schema: [`device`](web/src/server/db/schemas/device.ts:5)
- Used to validate that a device exists and is active.

## Error handling and expected status codes

Common error response shape is JSON with `error`.

### `/sync` (GET)

- 200: `{ success: true, serverTime, blueprints: [...] }`
- 400: missing headers; timestamp out of range
- 401: invalid device token; invalid signature
- 403: replay attack detected
- 500: server configuration error; internal server error

### `/push` (POST)

- 200: success response (or idempotent replay with `X-Idempotency-Replayed: true`)
- 400: missing required headers or body fields
- 401: invalid device token; invalid signature
- 403: replay attack; access denied (workstation mismatch)
- 409: version conflict
- 500: server configuration error; internal server error

### `/pull` (POST)

- 200: `{ success: true, blueprint: {...} }`
- 400: missing required headers; missing `blueprintId`; timestamp out of range
- 401: invalid device token; invalid signature
- 403: replay attack; access denied (workstation mismatch)
- 404: blueprint not found
- 500: server configuration error; internal server error

### `/resolve` (POST)

- 200: `{ success: true, blueprintId, version, mergedData, hash }`
- 400: missing required fields; invalid resolution enum; timestamp out of range
- 401: invalid device token; invalid signature
- 403: replay attack; access denied (workstation mismatch)
- 404: blueprint not found
- 500: server configuration error; internal server error

### `/versions` (GET)

- 200: `{ success: true, blueprintId, currentVersion, versions: [...] }`
- 400: missing required headers; missing `blueprintId`; timestamp out of range
- 401: unknown/inactive device; invalid signature
- 403: replay attack; access denied (workstation mismatch)
- 404: blueprint not found
- 500: server configuration error; internal server error

### `/restore` (POST)

- 200: `{ success: true, blueprintId, restoredFromVersion, version, hash, data }`
- 400: missing required headers or body fields; timestamp out of range
- 401: unknown/inactive device; invalid signature
- 403: replay attack; access denied (workstation mismatch)
- 404: blueprint not found; target version snapshot not found
- 500: server configuration error; internal server error

### `/api/workstation/device/usage` (GET)

- 200: `{ windowDays, since, totalRequests, requests: [...] }`
- 401: user not authenticated
- 404: workstationId not found or not owned by user
- 500: internal server error

Hardware-side behavior guidance:

- For 400/401/403: treat as non-retryable until configuration/clock/token is corrected.
- For 409: invoke conflict handling (pull latest + resolve).
- For 500: retry with backoff and/or queue offline.

## Operational notes

### Clock skew requirements

Replay protection enforces a hard tolerance of 300 seconds in [`replayProtection()`](web/src/middleware/replay-protection.ts:9).

- Hardware must maintain a reasonably accurate clock (NTP recommended).
- If clocks drift beyond tolerance, all requests will fail with 400.

### Token rotation assumptions

- Device JWTs are validated against `BLUEPRINT_SYNC_JWT_SECRET` and device active status.
- Rotating `BLUEPRINT_SYNC_JWT_SECRET` invalidates all previously issued device JWTs.
- If `DEVICE_TOKEN_EXPIRY_HOURS` is large, rotation requires coordinated rollout:
  - issue new tokens to devices
  - deploy new secret
  - deactivate old tokens/devices as needed

### HMAC secret rotation assumptions

- Rotating `BLUEPRINT_SYNC_HMAC_SECRET` requires that hardware and server switch together; otherwise signatures will fail (401).

---

## Related docs

- Legacy/previous protocol notes: [`hardware/doc/COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:1)
