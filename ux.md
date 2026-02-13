# UX/System Walkthrough (non-legacy)

> Scope note: this summary intentionally excludes anything under `./legacy/`.

## 1) System at a glance: main “surfaces”

- **Hardware app (Raspberry Pi)**: captures camera frames, recognizes hand gestures, drives a local **blueprint engine** (scene graph + selection + transforms + undo/redo), renders frames (numpy/OpenCV) to a display, and syncs blueprints to a cloud server.
  - Entrypoint + overall wiring: [`hardware/app.py`](hardware/app.py:1)
  - Config (includes sync base URL): [`hardware/config/config.py`](hardware/config/config.py:1)

- **Web server (Next.js App Router)**: stores blueprints in Postgres (via Drizzle), exposes workstation sync endpoints with **device JWT + HMAC signatures + replay protection + idempotency**.
  - Example device registration route: [`web/src/app/api/workstation/device/register/route.ts`](web/src/app/api/workstation/device/register/route.ts:10)

- **Web blueprint UI**: client-side canvas editor that reads/writes blueprint “metadata” via routes separate from the hardware sync endpoints.
  - Editor: [`web/src/components/blueprints/blueprint-editor.tsx`](web/src/components/blueprints/blueprint-editor.tsx:1)
  - Client API wrapper (user auth token in localStorage): [`web/src/lib/api/blueprints.ts`](web/src/lib/api/blueprints.ts:45)

- **Mobile app**: currently shows mostly notifications plumbing (Firebase messaging init).
  - Firebase init: [`mobile/firebase.ts`](mobile/firebase.ts:1)

## 2) Hardware runtime: what runs, and why it matters for UX

### 2.1 Boot flow and interaction model

The hardware app is oriented around a chat/orchestrator + tool registry pattern (voice/text → tool invocation), with blueprint operations exposed as tools.

- Main wiring: security manager, LLM/TTS selection, tool registry, optional plugins, then chat handler loop: [`hardware/app.py`](hardware/app.py:177)
- Orchestrator routing heuristics (when to route user input into orchestrated multi-step workflows): [`hardware/core/orchestration.py`](hardware/core/orchestration.py:201)

UX implication: the user experience is not a single fixed “blueprint editor screen”; it’s a **multi-modal assistant** where blueprint editing is a capability surfaced via tools.

### 2.2 Camera + gesture recognition

- Camera abstraction supports Pi camera backend and OpenCV backend, with an async streaming interface: [`hardware/core/vision/camera_capture.py`](hardware/core/vision/camera_capture.py:162)
- Gesture recognition is rule-based from landmarks, supporting both static poses and motion gestures (swipes/wave) with a short motion history: [`hardware/core/vision/gesture_recognizer.py`](hardware/core/vision/gesture_recognizer.py:52)
  - Static gesture examples: OPEN_PALM, CLOSED_FIST, POINTING, OK_SIGN, PINCH, etc.: [`GestureType`](hardware/core/vision/gesture_recognizer.py:15)
  - Motion gestures prioritized (swipe, wave) with displacement thresholds: [`GestureRecognizer._detect_motion_gesture()`](hardware/core/vision/gesture_recognizer.py:223)

UX implication: gestures are “command-like” (discrete recognized events), not continuous tracking; this matches the blueprint engine’s explicit begin/update/end transform APIs.

### 2.3 Gesture → blueprint commands

Gesture events are mapped into engine actions through a registry.

- Default mappings (examples):
  - Swipe left/right → pan, swipe up/down → zoom: [`GestureCommandRegistry._register_default_commands()`](hardware/core/blueprint_gesture/gesture_commands.py:61)
  - POINTING (in SELECT mode) → select at point: [`GestureCommand(POINTING → select_at_point)`](hardware/core/blueprint_gesture/gesture_commands.py:95)
  - CLOSED_FIST → begin translate selection; PINCH → begin scale selection: [`GestureCommand(CLOSED_FIST → begin_translate)`](hardware/core/blueprint_gesture/gesture_commands.py:111)
  - THUMBS_UP/DOWN → confirm/cancel, PEACE → undo, OK_SIGN → toggle snap, CALL_ME → toggle grid: [`GestureCommandRegistry._register_default_commands()`](hardware/core/blueprint_gesture/gesture_commands.py:128)

UX implication: this is the “gesture UX contract”. Modes matter (e.g., selection gesture requires SELECT mode), so the user must have a way to see/understand current mode.

## 3) Blueprint logic: model, state, and interaction sequence

### 3.1 Blueprint file format + hashing

Blueprints are Pydantic models; files can be `.jarvis` or `.json`.

- Data model + metadata blocks: [`Blueprint`](hardware/core/blueprint/parser.py:138), [`SyncMetadata`](hardware/core/blueprint/parser.py:110), [`SecurityMetadata`](hardware/core/blueprint/parser.py:121)
- Hashing excludes sync/security/modified fields: [`Blueprint.compute_hash()`](hardware/core/blueprint/parser.py:212)
- Parser supports load/parse/save/validate and create_empty: [`BlueprintParser`](hardware/core/blueprint/parser.py:228)

UX implication: there’s a clean separation between “design content” vs “sync/security bookkeeping”. That enables deterministic comparisons/conflict resolution.

### 3.2 In-memory editing model: engine + subsystems

The blueprint editor core is an engine orchestrating several subsystems:

- Engine orchestration and UX-facing API: [`BlueprintEngine`](hardware/core/blueprint/engine.py:132)
  - Load/save: [`BlueprintEngine.load()`](hardware/core/blueprint/engine.py:216), [`BlueprintEngine.save()`](hardware/core/blueprint/engine.py:246)
  - Modes + toggles: [`InteractionMode`](hardware/core/blueprint/engine.py:27), [`toggle_grid()`](hardware/core/blueprint/engine.py:320), [`toggle_snap()`](hardware/core/blueprint/engine.py:326)
  - Selection: [`select_component()`](hardware/core/blueprint/engine.py:337), [`select_at_point()`](hardware/core/blueprint/engine.py:355)
  - Transforms: [`transform_selection()`](hardware/core/blueprint/engine.py:381), interactive lifecycle: [`begin_interactive_transform()`](hardware/core/blueprint/engine.py:419) → [`update_interactive_transform()`](hardware/core/blueprint/engine.py:434) → [`end_interactive_transform()`](hardware/core/blueprint/engine.py:440)
  - View: pan/zoom/fit/reset: [`pan_view()`](hardware/core/blueprint/engine.py:453), [`zoom_view()`](hardware/core/blueprint/engine.py:463)
  - Undo/redo: [`undo()`](hardware/core/blueprint/engine.py:498), [`redo()`](hardware/core/blueprint/engine.py:506)
  - Event bus (UI hooks / external integrations): [`on()`](hardware/core/blueprint/engine.py:631), [`_emit()`](hardware/core/blueprint/engine.py:653)

Subsystems and their UX meaning:

- **Scene graph**: hierarchical nodes, bounds queries, hit-testing by point, component↔node mapping: [`SceneGraph`](hardware/core/blueprint/scene_graph.py:334), hit test: [`find_at_point()`](hardware/core/blueprint/scene_graph.py:487)
- **Selection model**: replace/add/remove/toggle, primary selection, selection bounds; emits selection events: [`SelectionManager`](hardware/core/blueprint/selection.py:37)
- **Transforms**: translate/rotate/scale, snapping and constraints, interactive state machine: [`TransformManager`](hardware/core/blueprint/transforms.py:120)
- **Undo/redo**: command pattern for transforms and node add/remove, plus history buffer: [`CommandHistory`](hardware/core/blueprint/history.py:289)

### 3.3 Rendering (hardware-side)

Rendering is a 2D top-down pass into a numpy frame, optionally using OpenCV for draw primitives.

- Renderer entrypoint: [`BlueprintRenderer.render()`](hardware/core/blueprint/renderer.py:103)
- Grid overlay is view-aware and scales with zoom: [`BlueprintRenderer._draw_grid()`](hardware/core/blueprint/renderer.py:181)
- Node drawing uses node world bounds → screen mapping and draws selection differently: [`BlueprintRenderer._draw_node()`](hardware/core/blueprint/renderer.py:217)

UX implication: the render model is “technical canvas” rather than photoreal; selection/labels/grid are first-class.

## 4) Hardware ↔ Server communication: protocol + runtime sequence

### 4.1 Protocol guarantees (docs) vs implementation (code)

The documented “Blueprint Synchronization Communication Protocol” is in:
- [`hardware/doc/COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:3)

Key properties:
- Transport: TLS 1.3: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:39)
- Device auth: JWT: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:46)
- Request integrity: HMAC-SHA256 signatures: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:66)
- Replay protection: timestamp window + nonce storage: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:86)
- Idempotency keys for safe retries: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:103)

Implementation alignment:
- Hardware builds headers + signature in one place: [`HttpClient._build_security_headers()`](hardware/core/network/http_client.py:125), [`HttpClient._calculate_signature()`](hardware/core/network/http_client.py:147)
- Server verifies HMAC canonical payload: [`verifyHMACSignature()`](web/src/lib/hmac-verify.ts:3)
- Server enforces replay protection: [`replayProtection()`](web/src/middleware/replay-protection.ts:9)
- Server enforces idempotency response replay: [`idempotency()`](web/src/middleware/idempotency.ts:8), storing: [`storeIdempotencyResponse()`](web/src/middleware/idempotency.ts:42)
- Device JWT verification: [`verifyDeviceToken()`](web/src/lib/device-auth.ts:12)

### 4.2 Endpoints used by hardware sync manager

Hardware sync orchestration: [`SyncManager`](hardware/core/sync/sync_manager.py:22)

- **Sync (pull list)**: GET `/api/workstation/blueprint/sync?since=...`: [`SyncManager.sync_to_server()`](hardware/core/sync/sync_manager.py:35), server route: [`GET`](web/src/app/api/workstation/blueprint/sync/route.ts:9)
- **Push local blueprint**: POST `/api/workstation/blueprint/push` with idempotency key: [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55), server route: [`POST`](web/src/app/api/workstation/blueprint/push/route.ts:12)
- **Pull one blueprint**: POST `/api/workstation/blueprint/pull`: [`SyncManager.update_blueprint()`](hardware/core/sync/sync_manager.py:89), server route: [`POST`](web/src/app/api/workstation/blueprint/pull/route.ts:11)
- **Resolve conflict**: POST `/api/workstation/blueprint/resolve`: [`SyncManager.resolve_conflict()`](hardware/core/sync/sync_manager.py:113), server route: [`POST`](web/src/app/api/workstation/blueprint/resolve/route.ts:12)

Device provisioning:
- Register device (interactive, user session required): [`POST`](web/src/app/api/workstation/device/register/route.ts:10)

### 4.3 Offline queue + ordering + retry

When network operations fail, the hardware side queues operations to disk and replays later.

- Queue persistence: [`OfflineQueue`](hardware/core/sync/offline_queue.py:7) writes to `data/offline_queue.json` (also documented): [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:403)
- Replay loop: [`SyncManager.process_offline_queue()`](hardware/core/sync/sync_manager.py:137)
- Local sync settings persisted in `data/sync_config.json`: [`SyncConfigManager`](hardware/core/sync/config_manager.py:7), docs: [`COMMUNICATION_PROTOCOL.md`](hardware/doc/COMMUNICATION_PROTOCOL.md:472)

Important UX behavior:
- Because requests include **idempotency keys**, retries can safely re-send without duplicating server writes (server may return cached response with replay header): [`idempotency()`](web/src/middleware/idempotency.ts:8)

### 4.4 Conflict model

- Hardware conflict resolver supports auto strategies (server/local/merge) or manual mode: [`ConflictResolver.resolve()`](hardware/core/sync/conflict_resolver.py:13)
- Server returns 409 on version conflicts and supports resolve endpoint: conflict behavior in push route: [`POST`](web/src/app/api/workstation/blueprint/push/route.ts:12), resolve: [`POST`](web/src/app/api/workstation/blueprint/resolve/route.ts:12)

UX implication:
- In “auto” mode, conflicts are resolved without user involvement; in “manual”, the UI/assistant must present a conflict bundle and guide a choice.

## 5) Security/auth (user vs device)

Two auth models coexist:

1) **Device auth** (hardware workstation sync)
- JWT device token: [`verifyDeviceToken()`](web/src/lib/device-auth.ts:12)
- HMAC signature verification: [`verifyHMACSignature()`](web/src/lib/hmac-verify.ts:3)
- Replay protection: [`replayProtection()`](web/src/middleware/replay-protection.ts:9)
- Idempotency: [`idempotency()`](web/src/middleware/idempotency.ts:8)

2) **User auth** (web UI)
- Web UI code suggests a separate auth token stored client-side (localStorage) used for blueprint listing/editing via a different set of endpoints: request interceptor: [`api.interceptors.request.use`](web/src/lib/api/blueprints.ts:45)

UX implication: the “same blueprint” can be touched by **two clients** (device and user web UI) with different auth + API surfaces; the system must reconcile expectations around “source of truth” and versioning.

## 6) Web UI blueprint editor (high-level fit)

The web blueprint editor is a canvas tool that:

- Loads a blueprint’s metadata via a workstation/blueprint path: loader effect: [`loadBlueprint()`](web/src/components/blueprints/blueprint-editor.tsx:68)
- Edits simple geometry lines + settings (grid, snap, dimensions) in local React state.
- Saves metadata via a POST request: save handler: [`handleSave()`](web/src/components/blueprints/blueprint-editor.tsx:243)

Notable mismatch to hardware sync:
- Hardware sync endpoints are `/api/workstation/blueprint/{sync,push,pull,resolve}`.
- Web editor references `/api/workstation/blueprint/${workstationId}/${blueprintId}/metadata` and `/api/workstation/blueprint/edit/...` (routes not covered in this summary).

UX risk: if these endpoints back the same DB records, you need a coherent story for version increments and hash/syncStatus updates across both flows.

## 7) Typical end-to-end sequences (runtime narratives)

### 7.1 “Edit blueprint on hardware with gestures”

1. Blueprint loaded from disk: [`BlueprintEngine.load()`](hardware/core/blueprint/engine.py:216)
2. User performs gesture (e.g., POINTING) → gesture recognized: [`GestureRecognizer.recognize()`](hardware/core/vision/gesture_recognizer.py:70)
3. Gesture mapped to engine action (mode-gated): [`GestureCommandRegistry.handle_gesture()`](hardware/core/blueprint_gesture/gesture_commands.py:251)
4. Engine updates selection/transforms/history and emits events: [`BlueprintEngine._emit()`](hardware/core/blueprint/engine.py:653)
5. Renderer draws the latest view/state into a frame: [`BlueprintRenderer.render()`](hardware/core/blueprint/renderer.py:103)

### 7.2 “Sync blueprint to server (online)”

1. Tool builds sync stack (security + http + token/id + SyncManager): [`build_sync_stack()`](hardware/core/sync/sync_factory.py:20)
2. Send blueprint: [`SyncManager.send_blueprint()`](hardware/core/sync/sync_manager.py:55)
3. Http client signs request: [`HttpClient._calculate_signature()`](hardware/core/network/http_client.py:147)
4. Server verifies device JWT + HMAC + replay + idempotency and writes blueprint: push route: [`POST`](web/src/app/api/workstation/blueprint/push/route.ts:12)

### 7.3 “Offline then later replay”

1. Network failure → operation queued to disk: [`OfflineQueue.add()`](hardware/core/sync/offline_queue.py:29)
2. Later, replay loop processes FIFO operations: [`SyncManager.process_offline_queue()`](hardware/core/sync/sync_manager.py:137)
3. Server idempotency prevents duplicates if requests are retried: [`idempotency()`](web/src/middleware/idempotency.ts:8)

## 8) What to pay attention to from a UX/product perspective

- **Mode visibility and feedback**: gestures are mode-gated (SELECT vs others). Engine exposes `InteractionMode` and emits events; UI should surface mode + last action + undo/redo availability: [`InteractionMode`](hardware/core/blueprint/engine.py:27), [`CommandHistory.undo_description`](hardware/core/blueprint/history.py:320)
- **Transform lifecycle feedback**: begin/update/end/cancel is explicit; consider projecting a “ghost” preview and requiring THUMBS_UP to commit: interactive transform APIs: [`begin_interactive_transform()`](hardware/core/blueprint/engine.py:419)
- **Conflict UX**: auto vs manual resolution is configurable; manual requires a user-facing diff/choice flow: [`SyncConfigManager`](hardware/core/sync/config_manager.py:7), [`ConflictResolver.resolve()`](hardware/core/sync/conflict_resolver.py:13)
- **Two-client coherence (web user vs device)**: ensure version/hash semantics are consistent across web editor routes and device sync routes (or explicitly treat them as separate resources).

---

## Appendix: test coverage that documents expected behavior

- Blueprint sync endpoint behaviors (idempotency replay, IDOR checks, stale timestamp, nonce replay): [`web/src/__tests__/blueprint-sync.test.ts`](web/src/__tests__/blueprint-sync.test.ts:85)
