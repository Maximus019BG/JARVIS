# Pi vision

Code: `tui/src/pi/`, `tui/assets/pi/` · Verified: 2026-10-16 @ 8cde74a

## Purpose
Turns a camera into hands, and hands into actions. It drives three features: drawing on a
projected blueprint with a pinch (`jarvis pi`, on a Raspberry Pi), the TUI's hand gestures and
freehand pen (the webcam, with the model running on the paired web app), and teaching and
finding physical items (`/learn`, `/find`, the agent's `find_item`). The ONNX tracking and item
matching code is shared with the web app, which imports it as `@pi/*` (see [web/vision](../../web/vision/README.md)).
For usage, see [tui/README.md → Drawing with your hands](../../../../tui/README.md#drawing-with-your-hands) and
[Vision: gestures and items](../../../../tui/README.md#vision-gestures-and-items).

## How it works

### Two paths to hands
Everything that reads hands consumes a `HandSource` (`hand-source.ts` → `HandSource`): an async
stream of `Frame`s (`gestures.ts` → `Frame`: `t`, `hands[]`, optional `motion`).

| | Local path (`jarvis pi`) | Remote path (TUI gestures, freehand pen) |
|---|---|---|
| Source | `hand-source.ts` → `onnxSource` | `hand-source.ts` → `remoteSource` |
| Camera | `vision-worker.ts` spawns `rpicam-vid` (YUV420) or ffmpeg (rgb24), raw frames | `camera.ts` → `openFeed`: one shared MJPEG feed, mirrored, 480×360 (`REMOTE_CAMERA`) |
| Model runs | In a child process on this machine (`onnxruntime-node`) | On the web app: `POST /api/device/hand` |
| Tracking state | Kept by the worker loop | Echoed by the client in headers, so the server is stateless |
| Default size | 640×480 (`DEFAULT_CAMERA`) | 480×360, because every frame crosses the internet |

**Local.** `onnxSource` spawns `bun vision-worker.ts --width --height --fps --source` and reads
one NDJSON line per frame from its stdout (`{ready, camera}`, `{t, hands, motion}` or `{error}`).
It runs as a separate process so that a crash in the native addon, or a Bun/N-API problem on
arm64, kills a child that can be restarted and not the daemon. The worker (`vision-worker.ts` →
`main`) loads `onnxruntime-node` dynamically, checks the models are present, builds a tracker
(`track.ts` → `createTracker`), and loops over fixed-size raw frames. It re-detects palms only
when tracking is lost or every `fps/2` frames, because the landmark model tracks well enough
on its own and detecting on every frame is too slow for a Pi.

**Remote.** `remoteSource` captures JPEGs through `openFeed` and POSTs them to
`${baseUrl}/api/device/hand`. It never queues frames. Capture overwrites one "latest" slot,
`inFlight` (default 2) sender loops each send the newest frame not yet sent, and an answer older
than one already yielded is dropped. Worst-case lag is one round trip, and a slow link lowers
the frame rate instead of adding delay. Each request carries:

| Header | Value |
|---|---|
| `authorization` | `Bearer <jvh_ ticket>` from `ticketFor` (below), not the device token |
| `content-type` | `image/jpeg` |
| `x-hand-detect` | `1` to run palm detection: when no ROI is held, or every 15 frames; else `0` |
| `x-hand-roi` | When not detecting: `x,y,w,h` per tracked hand, joined by `;` (one hand matches the header older servers read) |
| `x-hand-trail` | The `trail` string from the previous answer, echoed back so the server can classify motion |

The answer is `{hands, rois, trail, motion, ms}`. `rois` and `trail` are stored and sent with
the next frame, so any server instance can serve any frame. A body with only `roi` (an older
server) is read as one region. On a 401 the ticket is refreshed once (`ticketFor(base, token, stale)`).
A second 401, or a 503 (model not installed), throws `Fatal`, which stops the stream. Other
errors drop the ROI and trail, report `reconnecting` through `onStats`, and back off from 250 ms
up to 4 s.

**Tickets.** `hand-source.ts` → `ticketFor` swaps the device token for a short-lived `jvh_`
ticket at `POST /api/device/hand/ticket`. Every caller in the process shares it, and it is
refreshed when less than 60 s remain. A device-token check is a database query, which a
per-frame request cannot afford. Checking a ticket is an HMAC. `items-client.ts` → `findItems` uses the same ticket.

### Camera (`camera.ts`, `ffmpeg.ts`)
- `cameraCommands` lists capture commands in order of preference. Each writes mirrored MJPEG to stdout.
  - With a `vision.camera` override (`setCameraOverride`, set from `tui/src/ui/app.tsx`), only that command is used.
  - On Linux, if `rpicam-vid` is on PATH, it comes first: a Pi camera module only speaks libcamera.
  - Then ffmpeg, with `vision-worker.ts` → `ffmpegInput` choosing the platform input: AVFoundation with `nv12` on macOS, DirectShow by device name on Windows (`parseDshowCameras`), and v4l2 `/dev/video0` on Linux. `fitFilter` crops to the requested aspect before scaling, so hands are not squashed. `-fps_mode passthrough` stops ffmpeg from repeating frames across AVFoundation timestamp jumps.
- `openFeed` starts one shared capture, because v4l2 lets only one process open a camera. It is reference-counted: `release()` stops it after `LINGER_MS` (10 s) with no users, so a quick follow-up `find` finds the camera still running. `splitJpegs` cuts the byte stream on the SOI/EOI markers.
- Failure handling in `start`:
  - Each command must send a first frame within `FIRST_FRAME_MS` (15 s), or the next command is tried. On macOS a camera without permission opens and then never sends a frame.
  - A camera that sent frames and then stopped is treated as unplugged, with no fallback.
  - If no command worked and there is no ffmpeg, `fetchFfmpeg` downloads one, once, and tries again.
- `ffmpeg.ts` → `fetchFfmpeg` downloads one pinned ffmpeg-static release (`b6.1.1`) for the
  current `platform-arch` into `<dataDir>/bin/ffmpeg` and checks its sha256 against a table in
  the code. It unpacks to a `.part` file and renames it, so an interrupted fetch never leaves a
  half-written binary. It is fetched rather than bundled because `install.sh` compiles a single
  binary with no `node_modules` beside it. `ffmpegBinary` prefers ffmpeg on PATH.
- `snapshot` waits until 700 ms after the camera started, so a cold webcam has adjusted its exposure first.

### Tracking (`track.ts`, `detect.ts`, `models.ts`)
`track.ts` takes `ort` as a parameter and imports nothing from Bun or Node, because Next.js
compiles this file for the web app too. `createTracker(ort, {palm, landmark}, gesture?)` returns
`step(rgb, camera, {rois, detect, trail})`:
1. **Palm detection**, when `detect` is set or no ROI is held. The frame is letterboxed to a 192×192 square (`cropToTensor`) and run through the palm model. `decodeDetections` decodes the output against `generateAnchors(PALM_ANCHORS)` (2016 anchors), and `nms` keeps up to 2 hands. `roiFromPalm` grows each palm box 2.6× and shifts it up so the fingers are inside the crop. ROIs are not clamped to the frame (outside is padded black). They are sorted by distance from the previous first hand, so `hands[0]` stays the same hand.
2. **Landmarks**: for each ROI, a 224×224 crop goes through the landmark model, and `landmarksToCamera` maps the 21 points back to camera pixels. A presence score below 0.5 drops the hand, and with it the ROI, which forces a new detection.
3. **Classifier**, optional (`createClassifier`). The first hand's palm centre and span are appended to the trail (`palmCentre`, `handSpan`, `pushTrail`). Each hand gets a pose label (`gesture`), and the first hand also gets a `motion` label. The trail is dropped when the first hand changes, so a hand that reappears is not read as a swipe.

Sanity checks:
- `assertAnchorCount` and the classifier's label-count check fail loudly. A wrong model variant would otherwise misplace hands or mislabel gestures without any error.
- Pixel layout (NCHW or NHWC) is read from each model's input shape (`layoutOf`). The OpenCV Zoo conversions are channels-last.

`models.ts` → `fetchModels` downloads the palm and landmark models (MediaPipe, OpenCV Zoo
conversions on Hugging Face) into `<dataDir>/models`, writing to a `.part` file and renaming.
The gesture classifier is not downloaded. It is trained in
[`models/hand_gestgures.ipynb`](../../../../models/README.md) and copied to `gesturePaths`.

### Gestures (`gestures.ts`)
Two readers. Both are plain classes with `push(frame)`, so recorded frames can be fed through
them in tests.

- **`GestureReader`** works from geometry and drives the pen. A pinch (thumb-to-index gap / `handSpan`) below `pinchEnter` puts the pen down, and the gap has to exceed `pinchExit` to lift it again (hysteresis). Each state is debounced over `debounce` frames. Other events:
  - open palm → `cancel`
  - fist → `undo`
  - pointing held for `pointHoldMs` → `palette`
  - two pinching hands → `zoom`, beyond `zoomDeadZone`

  `lostFrames` keeps a stroke alive through short dropouts. The remote pen uses 3; the default 0 lifts the pen on the first miss. `oneEuro` smooths the pen point.
- **`GestureCommands`** maps learned classifier labels to commands for the TUI. A pose fires once after it has been held for `holdMs` and re-arms when the label changes or the hand leaves. A motion fires on the first frame of its run, followed by a `cooldownMs` quiet period. Frames below `minScore` neither extend nor break a hold, because the classifier flickers at the edges of a pose. `tui/src/ui/use-gestures.ts` → `useGestures` runs it over `remoteSource`, and `tui/src/ui/app.tsx` performs the result: `approve`/`reject` answer the permission prompt, and any other value is a keybind action.

### Items (`items.ts`, `items-client.ts`)
Few-shot finding with no training step. `items.ts` is runtime-neutral like `track.ts`, and the
web app runs it.
- `createEmbedder` runs DINOv2-small. `toPixelValues` scales the long side to 448 px, keeps the aspect ratio, and rounds to 14 px patches. The output is one unit-length 384-wide vector per patch. Token 0 (CLS) is dropped.
- `learn` sorts patches from each boxed photo:
  - Patches entirely inside the box go to the `pos` bank.
  - Patches whose centre is more than one patch outside the box go to `neg`.
  - Edge patches go to neither, because including them made the training backgrounds match too.
  - A sample with `box: null` (the overlay's empty shot) goes wholly to `neg`.

  Then every `pos` patch whose `nearest` against the whole unpacked `neg` list reaches `BACKGROUND_SIM` (0.7) is dropped: it is the background seen through the box, and left in, it matched the empty spot once the item was gone. Each bank keeps at most `MAX_BANK` (256), sampled evenly, after the prune. A box with fewer than `MIN_PATCHES` (4) patches inside, fewer than 4 `pos` patches left, or no boxed photo at all throws `ItemError`.
- `locate` marks a scene patch when its nearest `pos` match beats its nearest `neg` match and reaches `threshold` (`DEFAULT_THRESHOLD` 0.65). It returns one box per connected group of at least 4 patches (up to 8 boxes), plus `best`, the closest score even when nothing was found.
- `items-client.ts` is the TUI client:
  - `teachItem`, `listItems`, `forgetItem` and `deleteItem` call `/api/vision/items` with the device token through `blueprint/sync.ts` → `call`. A `teachItem` shot with `box: null` is the empty shot. `forgetItem` looks the name up first and then calls `deleteItem`, because the route deletes by id. `/forget`'s picker calls `deleteItem` directly.
  - `findItems` POSTs a JPEG to `/api/vision/detect` with the hand ticket. On a 401 or a 403 it fetches a fresh ticket and retries once: a ticket carries the scopes it was minted with, so a vision scope granted a moment ago needs a new one.
  - A 5xx with no message reads "the server failed (500) — see the web server log", because a route that threw answers with an empty body.
  - `describeFound` and `where` turn a box into "left · top" (thirds of the mirrored view).
  - `itemColours` gives each item a fixed colour from `ITEM_COLOURS` (8 RGB values, not theme colours, because they are drawn over camera pixels). The colour is its place in the taught list sorted by name, so it does not change between frames or filters. An id that is not in the list is hashed to a colour. Colours repeat after 8 items.

  Callers: `tui/src/ui/components/vision-view.tsx` (`/learn`, `/find`), `tui/src/ui/builtin-commands.ts` (`/items`, `/forget`) and `tui/src/tools/vision.ts` → `findItemTool`.

### Calibration and the projector (`calibration.ts`, `projector-page.ts`, `index.ts`)
`index.ts` → `runPi` is the daemon. Data flows one way: hand source → `GestureReader` → stroke
→ `fitStroke` → blueprint commit. The projector only observes it.
1. Starts `Bun.serve` on `port` (default 7331). It serves `projectorPage()` at `/` and `/projector`, and a WebSocket at `/live` that broadcasts `scene`/`stroke`/`cursor`/`tool`/`status`/`calibrate`/`calibrate-done`. Messages from the browser are ignored, so a kiosk that is compromised or confused cannot change the drawing.
2. Picks a source: `onnxSource` (`rpicam`, or `webcam` → ffmpeg), `replaySource` (an NDJSON recording) or `scriptedSource` (a synthetic hand that draws a square, for testing without hardware).
3. Calibration: `usableCalibration` loads `<dataDir>/calibration.json`. It is rejected when missing or when it was recorded at a different camera resolution, because a stale mapping draws in the wrong place without any error. `runCalibration` projects the four `TARGETS` (inset 15% from the sheet corners) and records each pen-down. `calibrate` then solves the homography (`homographyFrom`, Gauss-Jordan with pivoting) and reports the mean reprojection error. A warning is printed above 5 mm.
4. Drawing: pen events are mapped through `applyHomography` to sheet coordinates. On pen-up, `fitStroke` (snapping to `endpointsOf(doc)`) produces an entity, which is committed with `applyOps` and `writeDoc`. Palette cycles through `TOOLS`, and a fist deletes the last entity.

`projector-page.ts` returns one self-contained HTML page with no imports. The daemon flattens
geometry to polylines (`sceneOf`), so the page does no geometry of its own. An earlier version
bundled engine code, and it broke in the compiled binary, where source files live in `$bunfs`.
The page reconnects every second if the daemon restarts.

### `jarvis pi` and systemd
`tui/src/index.tsx` (case `"pi"`) parses `[blueprint|calibrate|models]` and
`--source/--replay/--width/--height/--fps/--port`, then calls `runPi`. `models` only fetches the
models. `calibrate` runs calibration and exits without creating a blueprint.

`tui/install.sh --pi` installs `jarvis-pi@.service` and `jarvis-kiosk@.service`, and
`--service` installs `jarvis-work@.service`. Each is a template, with `%i` standing for the user name. That way each unit reads that user's XDG directories, where `jarvis pair`
stored the credentials and `jarvis pi calibrate` stored the calibration.

## Files
| File | Responsibility |
|---|---|
| `tui/src/pi/index.ts` | `runPi` daemon: projector server, source choice, calibration flow, gesture → stroke → blueprint commit; exports `TOOLS`, `endpointsOf` (used by the TUI blueprint editor) |
| `tui/src/pi/hand-source.ts` | `HandSource` seam; `onnxSource`, `remoteSource`, `replaySource`, `scriptedSource`, `syntheticHand`; `ticketFor`, `assertSecureUrl`, `Fatal`; `DEFAULT_CAMERA` |
| `tui/src/pi/camera.ts` | Shared MJPEG webcam feed: `cameraCommands`, `openFeed`, `snapshot`, `splitJpegs`, `setCameraOverride`, `onCameraNotice`, `noCameraTool`, `REMOTE_CAMERA` |
| `tui/src/pi/ffmpeg.ts` | `ffmpegBinary`, `ffmpegAsset`, `fetchFfmpeg`: pinned, sha256-checked static ffmpeg in `<dataDir>/bin` |
| `tui/src/pi/vision-worker.ts` | Child process: raw camera frames → tracker → NDJSON; `cameraCommand`, `ffmpegInput`, `fitFilter`, `parseDshowCameras` |
| `tui/src/pi/track.ts` | Runtime-neutral `createTracker` (palm → ROI → landmarks → classifier) and `createClassifier`; `Ort` structural type; shared with web |
| `tui/src/pi/detect.ts` | Pure tensor math: anchors, `decodeDetections`, `nms`, `roiFromPalm`, `landmarksToCamera`, `cropToTensor`, `palmCentre`, `pushTrail`, `trailToTensor` |
| `tui/src/pi/gestures.ts` | Landmark indices, `Hand`/`Frame`/`Label` types, `GestureReader` (pen), `GestureCommands` (label → action), `oneEuro`, `DEFAULT_GESTURES` |
| `tui/src/pi/models.ts` | `MODELS` URLs, `modelPaths`, `missingModels`, `fetchModels`, `gesturePaths` |
| `tui/src/pi/items.ts` | Runtime-neutral DINOv2 item matching: `createEmbedder`, `learn`, `locate`, `ItemError`, constants (`BACKGROUND_SIM` among them); shared with web |
| `tui/src/pi/items-client.ts` | TUI client for `/api/vision/*`: `teachItem`, `listItems`, `forgetItem`, `deleteItem`, `findItems`, `describeFound`, `where`, `itemColours`, `VisionError` |
| `tui/src/pi/calibration.ts` | Homography solve, `calibrate`, `TARGETS`, `usableCalibration`, load/save `calibration.json`; `findCalibrationPath` (`find-calibration.json`, the TUI's `/calibrate`: mirrored 480×360 feed → screen fractions) and `toScreen` (a camera box → screen fractions, bounds of the warped corners) |
| `tui/src/pi/projector-page.ts` | `projectorPage`: the self-contained kiosk HTML/canvas client |
| `tui/src/pi/onnxruntime-node.d.ts` | Ambient types for `onnxruntime-node`, which is deliberately not a TUI dependency |
| `tui/assets/pi/jarvis-pi.service` | systemd unit running `jarvis pi` as `%i`; `KillMode=control-group` so the worker dies with it |
| `tui/assets/pi/jarvis-kiosk.service` | systemd unit: `cage` + Chromium kiosk on `http://localhost:7331/projector`; requires `jarvis-pi` |
| `tui/assets/pi/jarvis-work.service` | systemd unit running `jarvis work --root /home/%i/jarvis` (the headless automation worker, installed by `install.sh --service`) |

## Interfaces

**CLI** (`tui/src/index.tsx`)

| Command | Effect |
|---|---|
| `jarvis pi [blueprint]` | Draw into `blueprint` (default `sketch`), creating it if needed |
| `jarvis pi calibrate` | Calibrate and save, then exit |
| `jarvis pi models` | Fetch palm and landmark models, then exit |
| flags | `--source rpicam\|webcam\|script\|replay`, `--replay <file>`, `--width`, `--height`, `--fps`, `--port` |

**Projector server** (`index.ts`): `GET /`, `GET /projector` (HTML), WebSocket `/live` (server → page only).

**Web routes it calls** (served by [web/vision](../../web/vision/README.md)): `POST /api/device/hand/ticket`,
`POST /api/device/hand`, `GET|POST|DELETE /api/vision/items`, `POST /api/vision/detect`.

**Config keys** (`tui/src/config/config.ts`)

| Key | Used by |
|---|---|
| `blueprint.pi.gestures.*` (`pinchEnter`, `pinchExit`, `debounce`, `pointHoldMs`, `minScore`, `zoomDeadZone`) | `runPi` → `GestureReader` |
| `blueprint.pi.fit.*` | `runPi` → `fitStroke` |
| `vision.gestures` (label → action), `vision.minScore`, `vision.holdMs`, `vision.cooldownMs`, `vision.autostart` | `GestureCommands` via `use-gestures.ts` |
| `vision.threshold` | `find_item` / `/find` → `findItems` |
| `vision.camera` | `setCameraOverride` |

Default label map (`DEFAULT_GESTURE_MAP`):

| Label | Action |
|---|---|
| `thumbs_up` | `approve` |
| `thumbs_down` | `reject` |
| `palm` | `interrupt` |
| `call` | `voice` |
| `swipe_up` | `scrollHalfDown` |
| `swipe_down` | `scrollHalfUp` |

**Agent tool**: `find_item`, defined in `tui/src/tools/vision.ts`. It uses `openFeed`, `snapshot` and `findItems`.

## Data and state
| What | Where |
|---|---|
| Palm and landmark models | `<dataDir>/models/palm_detection.onnx`, `hand_landmark.onnx` (`models.ts` → `modelDir`) |
| Gesture classifier (optional, local path) | `<dataDir>/models/hand_gesture.onnx` + `hand_gesture.json` |
| Calibration | `<dataDir>/calibration.json` (`calibrationPath`), zod-validated |
| Fetched ffmpeg | `<dataDir>/bin/ffmpeg` (`bundledFfmpeg`) |
| Drawings | Blueprint store, via `tui/src/blueprint/store.ts` (`writeDoc`) |
| In memory | Shared camera `shared` + `capturing` set (`camera.ts`); ticket cache `tickets` (`hand-source.ts`) |

`<dataDir>` is `$XDG_DATA_HOME/jarvis` or `~/.local/share/jarvis` (`tui/src/config/paths.ts`).
`onnxruntime-node` has to be installed by hand on the machine that runs the local path (`bun add onnxruntime-node`).

## Depends on / used by
- **Depends on**:
  - the blueprint engine (`tui/src/blueprint/`: `fit`, `geom`, `ops`, `schema`, `store`, `credentials`, `sync`), see [tui/blueprint-system](../blueprint-system/README.md)
  - config (`tui/src/config/`)
  - external binaries `rpicam-vid` and `ffmpeg`; `cage` and `chromium-browser` for the kiosk
- **Used by**:
  - TUI UI (`tui/src/ui/app.tsx`, `use-gestures.ts`, `components/blueprint-editor.tsx`, `components/use-hand-pen.ts`, `components/vision-view.tsx`, `components/camera-canvas.tsx`, `builtin-commands.ts`), see [tui/ui](../ui/README.md)
  - the `find_item` tool, see [tui/tools](../tools/README.md)
  - the CLI, see [tui/cli](../cli/README.md)
  - the web app imports `track.ts`, `detect.ts` and `items.ts` as `@pi/*`, see [web/vision](../../web/vision/README.md)

## Gotchas
- **`track.ts`, `detect.ts` and `items.ts` must stay runtime-neutral**: no Bun, no `node:` imports, and `ort` is passed in. Next.js compiles them. `gestures.ts` is imported by `track.ts`, so the same rule applies to it.
- **Mirroring differs by path.** The remote feed is flipped horizontally (`hflip` in `cameraCommands`), so `motion` swipes are in mirrored image space. The local worker's `cameraCommand` does not flip, and the homography absorbs the orientation.
- **Config keys the CLI overrides.** `jarvis pi` always passes `port` and `camera`, using its own defaults when flags are absent, so `blueprint.pi.port` and `blueprint.pi.camera` in config have no effect. `blueprint.pi.sketch` is read nowhere: the CLI hard-codes `"sketch"`.
- **`--runtime=node` is not wired.** The worker's error message suggests it, and `onnxSource` accepts a `runtime` option, but `runPi` never passes one and the CLI has no such flag.
- **`pinchExit` must be greater than `pinchEnter`.** `runPi` refuses to start otherwise, because without hysteresis the pen flickers.
- **Calibration is tied to the camera resolution.** Changing `--width`/`--height` means recalibrating.
- **The kiosk unit hard-codes** `XDG_RUNTIME_DIR=/run/user/1000` (it assumes the first user's uid) and port 7331.
- **Remote-path shortcut** (`ponytail:` in `remoteSource`): the trail is echoed from the server, so with 2 requests in flight it skips frames. The model was trained on 0.5–2× speed to tolerate this.
- **Other `ponytail:` shortcuts:**
  - `cropToTensor` samples nearest-neighbour.
  - `toPixelValues` samples nearest-neighbour.
  - `DEFAULT_THRESHOLD` was tuned only on synthetic scenes, and `BACKGROUND_SIM` is untuned on real cameras.
  - `learn`'s background prune is brute force, `pos` × every `neg` patch × 384, once per teach.
  - `locate` is a brute-force nearest-neighbour search, about 150M multiply-adds per item at 448 px.
- **`remoteSource` refuses non-https URLs** other than localhost (`assertSecureUrl`), and so do `teachItem` and `findItems`.

## Tests
`cd tui && bun test` (or `bun test test/pi-detect.test.ts` for a single file).

| File | Covers |
|---|---|
| `tui/test/pi-detect.test.ts` | `detect.ts`: anchors, decode, NMS, ROI, landmark mapping, `cropToTensor`, trail |
| `tui/test/pi-track.test.ts` | `createTracker` with a fake `Ort`: two hands, dropped hand, stable ordering, re-detect |
| `tui/test/pi-gestures.test.ts` | `gestures.ts` geometry and `GestureReader`; `calibration.ts`; `lostFrames`; `oneEuro` |
| `tui/test/pi-pipeline.test.ts` | `scriptedSource` → `GestureReader` → `fitStroke` end to end; calibration round trip; `missingModels` |
| `tui/test/pi-remote.test.ts` | `splitJpegs`; `remoteSource` against a local server: https rule, stale answers, ticket refresh, two hands, legacy `roi`, revoked device |
| `tui/test/pi-camera.test.ts` | `cameraCommands` per platform and override; `parseDshowCameras` |
| `tui/test/gesture-commands.test.ts` | `GestureCommands` hold, re-arm, motion cooldown |
| `tui/test/vision-items.test.ts` | `listItems`, `forgetItem`, `deleteItem` against a stub server |

The matching math in `items.ts` is tested on the web side (`web/src/__tests__/vision-items.test.ts`).
