# Hand gestures and drawing

Modules: [tui/pi-vision](../modules/tui/pi-vision/README.md), [web/vision](../modules/web/vision/README.md), [tui/ui](../modules/tui/ui/README.md), [`models/`](../../models/README.md) · Verified: 2026-10-15 @ aff1145

## Who and why

A user in front of a camera wants to use their hand instead of the keyboard. In the TUI, a thumbs-up
approves a permission prompt and a swipe scrolls the transcript. In the fullscreen blueprint editor,
a pinch draws a stroke that snaps to a clean shape. On a Raspberry Pi with a projector, the same
pinch draws on a projected sheet. All three turn camera frames into 21 hand landmarks, then into
pen events or commands.

## Flow

1. **Choose a path.** There are two ways to get hands, and both yield the same `Frame` stream
   (`tui/src/pi/hand-source.ts` → `HandSource`).
   - **Hosted (TUI gestures, freehand pen).** The laptop only captures. The model runs on the paired
     web app. This needs a paired device ([Pair a device](pair-a-device.md)).
   - **Local (`jarvis pi`).** A child process on the Pi runs the ONNX models itself
     (`tui/src/pi/vision-worker.ts`), so no frame leaves the machine.
2. **Capture.** On the hosted path, `tui/src/pi/camera.ts` → `openFeed` starts one shared MJPEG feed:
   480×360, mirrored, 30 fps (`REMOTE_CAMERA`). It tries `rpicam-vid` first on Linux when present,
   then ffmpeg (AVFoundation, DirectShow or v4l2), or only `vision.camera` when that is set. If no
   ffmpeg is on PATH, a pinned, sha256-checked build is downloaded once. On the local path, the worker
   reads raw 640×480 frames from `rpicam-vid` (YUV420) or ffmpeg (rgb24) and does not mirror.
3. **Get a ticket** (hosted path). `ticketFor` posts the device token (`jvd_…`) once to
   `POST /api/device/hand/ticket`. The server checks it against the database
   (`web/src/server/device-auth.ts` → `authenticateDevice`) and returns a `jvh_` ticket that lives 5
   minutes (`web/src/server/hand/ticket.ts` → `signTicket`). Every caller in the process shares it.
   It is refreshed when less than 60 s remain.
4. **Send a frame.** `remoteSource` keeps one "latest frame" slot. Two sender loops (`inFlight`)
   each post the newest unsent frame to `POST /api/device/hand`, with the ticket as the bearer.
   Frames never queue: a slow link lowers the frame rate instead of adding lag. Each request says:
   - `x-hand-detect: 1` when no hand is tracked or every 15 frames; otherwise `0`.
   - `x-hand-roi`: the regions from the last answer (`x,y,w,h`, one per hand, joined by `;`), sent
     only when not detecting.
   - `x-hand-trail`: the trail string from the last answer, sent back unchanged.
5. **Check the request** (`web/src/app/api/device/hand/route.ts` → `POST`). The ticket's HMAC and expiry
   are checked with no database query. Then the body type, the size, the headers and the JPEG
   decode are checked, in that order. The limits are in Business rules.
6. **Track** (`tui/src/pi/track.ts` → `createTracker`, the same file on the Pi and the server).
   - **Palm detection** runs when asked or when there is no region. The frame is letterboxed to
     192×192. Up to 2 palms are kept. Each palm box is grown 2.6× and shifted up so the fingers fit.
   - **Landmarks**: each region is cropped to 224×224 and gives 21 points in camera pixels. A
     presence score below 0.5 drops that hand and its region. With no region left, the next frame
     re-detects.
   - The hand that was first stays first, so the trail and one-hand gestures follow the same hand.
7. **Classify** (only when the gesture model is installed). The first hand's palm centre and span are
   added to the trail (window 16). Every hand gets a pose label. The first hand also gets a motion
   label. A different first hand starts a new trail, so a reappearing hand never reads as a swipe.
8. **Answer.** The server returns `{hands, rois, trail, motion, ms}` with `cache-control: no-store`.
   The client stores `rois` and `trail` and sends them with its next frame. The server keeps no
   state, so any instance can serve any frame. An answer older than one already used is dropped.
9. **Use the hands.**
   - **Gesture commands** (ctrl+x or `/gestures on|off`; starts on with `vision.autostart`).
     `tui/src/ui/use-gestures.ts` → `useGestures` feeds frames to `GestureCommands`, which maps labels
     through `vision.gestures`. The defaults are `thumbs_up` → approve, `thumbs_down` → reject,
     `palm` → interrupt, `call` → voice, `swipe_up` → half page down, `swipe_down` → half page up
     (`tui/src/config/config.ts` → `DEFAULT_GESTURE_MAP`). Approve and reject answer an open
     permission prompt ("once" or reject). Other actions run like the matching key. The status line
     shows what the model sees, for example `palm 0.9`.
   - **Freehand pen.** In the fullscreen blueprint editor, `f` toggles the hand.
     The pen starts by itself when gestures were on, and gesture commands pause while the editor
     is fullscreen. `GestureReader` reads geometry, not labels. A pinch puts the pen down, an open palm
     cancels the stroke, a fist undoes, pointing for 400 ms cycles the tool, and two pinching hands
     zoom. The pinch point is One-Euro smoothed and mapped onto the view
     (`tui/src/ui/components/blueprint-editor.tsx` → `cameraToSheet`, inner 70% of the frame). On
     pen-up, `fitStroke` turns the stroke into one entity that snaps to existing endpoints.
   - **Pi projector.** `tui/src/pi/index.ts` → `runPi` serves the projector page on port 7331 and
     pushes the scene, live stroke and cursor over the `/live` WebSocket. Pen points go through
     the saved calibration (a homography) into sheet coordinates. Each fitted stroke is committed to
     the blueprint store. A fist deletes the last entity, pointing cycles the tool, and an open palm
     cancels. The browser can only watch: messages from it are ignored.
10. **Calibrate** (Pi only). `jarvis pi calibrate` projects four targets, inset 15% from the sheet
    corners. The user pinches each one. The homography and its mean error are saved to
    `calibration.json` in the data dir. Above 5 mm the daemon prints a warning to recalibrate.
    `jarvis pi` recalibrates by itself when there is no calibration or when it was made at a
    different camera resolution.
11. **Where the gesture model comes from.** The palm and landmark models are MediaPipe conversions,
    committed under `web/models/hand/` and downloaded on the Pi by `jarvis pi models`. The gesture
    classifier is ours. `models/hand_gestgures.ipynb` trains it on landmarks only (recorded takes, plus
    optional HaGRID pretraining), checks that ONNX Runtime agrees with PyTorch, and exports
    `models/export/hand_gesture.onnx` with `models/export/hand_gesture.json` (12 poses, 6 motions,
    window 16). Its last cell copies both files to `web/models/hand/` and to the data dir's `models/`
    folder for the Pi. The server loads them on the first frame after it starts.

## Business rules

| Rule | Value | Source |
|---|---|---|
| Ticket lifetime | 5 min (`TICKET_TTL_MS`) | `web/src/server/hand/ticket.ts` |
| Ticket refresh on the client | when less than 60 s remain, or after a 401 | `tui/src/pi/hand-source.ts` → `ticketFor` |
| Ticket key | HMAC-SHA256 with a key derived from `BETTER_AUTH_SECRET` and the label `hand-ticket:v1` | `web/src/server/hand/ticket.ts` |
| Scopes for hand frames | none: the ticket route accepts any active device, and the frame route checks only the ticket | `web/src/app/api/device/hand/ticket/route.ts` |
| Frame body | `image/jpeg` only (else 415), 1 byte to 300,000 bytes (else 413) | `web/src/app/api/device/hand/route.ts` → `MAX_BYTES` |
| Decode guard | at most 1.3 MP and 64 MB, against decompression bombs | same file |
| `x-hand-roi` | at most 2 regions of 4 finite numbers, width and height positive | same file → `roiSchema` |
| `x-hand-trail` | at most 64 points of `x,y,span` (span positive) | same file → `trailSchema` |
| Inference | one frame at a time per server instance (`serial`) | same file |
| Proxy limit | behind the k8s nginx, `/api/` allows 10 requests/s per IP (burst 50); excess frames get a 429 and the client backs off | `k8s/base/nginx.conf` |
| Gesture model | optional; both `hand_gesture.onnx` and `hand_gesture.json` must exist, or hands come back unlabelled | same file → `loadGesture` |
| Label check | a model whose output sizes don't match the JSON labels fails loudly | `tui/src/pi/track.ts` → `createClassifier` |
| Hosted camera | 480×360 at 30 fps, mirrored | `tui/src/pi/camera.ts` → `REMOTE_CAMERA` |
| Local camera | 640×480 at 30 fps; re-detect palms every `fps/2` frames | `tui/src/pi/vision-worker.ts` |
| Command thresholds | `vision.minScore` 0.8, `vision.holdMs` 400, `vision.cooldownMs` 800 | `tui/src/config/config.ts` |
| Pen thresholds | `pinchEnter` 0.32, `pinchExit` 0.45, `debounce` 3 frames, `pointHoldMs` 400, `minScore` 0.6, `zoomDeadZone` 0.08 | `tui/src/config/config.ts` (`blueprint.pi.gestures`) |
| Pen dropouts | the editor's pen survives 3 missed frames; the Pi lifts on the first miss | `tui/src/ui/components/blueprint-editor.tsx` |
| Pinch hysteresis | `jarvis pi` refuses to start unless `pinchExit` > `pinchEnter` | `tui/src/pi/index.ts` → `runPi` |
| Calibration | 4 targets at 15% inset; warning above 5 mm mean error; invalid at a different resolution | `tui/src/pi/calibration.ts` |
| Transport | the camera is only streamed over https, or to localhost | `tui/src/pi/hand-source.ts` → `assertSecureUrl` |
| Privacy | frames are decoded, run and dropped; nothing is stored or logged | `web/src/app/api/device/hand/route.ts` |

A pose fires once, after it is held for `holdMs`. It fires again only after the label changes or the
hand leaves. A motion fires on its first frame, and then nothing fires for `cooldownMs`. Frames below
`minScore` neither extend nor break a hold.

## When it fails

- **Not paired.** Gestures turn off with "pair first (/pair)". The editor says "pair first (jarvis pair)".
- **Device revoked.** The ticket route answers 401, and the stream stops with "run `jarvis pair`".
  A ticket already issued keeps working until it expires (up to 5 minutes).
- **401 on a frame.** The client fetches a fresh ticket and retries once. A second 401 stops the stream.
- **503: model not installed.** The stream stops and points at `web/models/hand/README.md`. The server
  does not cache the failure, so it retries the load on the next request.
- **Hands without labels.** After 2 s of hands with no gesture label, the TUI warns that the server
  needs `hand_gesture.onnx`. Landmarks still arrive, so the freehand pen still works.
- **Network errors or 4xx/5xx other than 401/503.** The client drops its regions and trail, shows
  `reconnecting`, and backs off from 250 ms to 4 s.
- **Camera.** A capture command that sends no first frame within 15 s is dropped and the next one is
  tried. On macOS that usually means camera permission is missing. A camera that stops mid-stream counts as unplugged.
- **Not https.** The client refuses to stream the camera to a plain-http server other than localhost.
- **Pi.** Missing models stop `jarvis pi` with "run `jarvis pi models` first". A missing
  `onnxruntime-node` stops the worker. Add it with `bun add onnxruntime-node`. A missing or stale
  calibration starts calibration first.

## Related

- [Teach and find items](teach-and-find-items.md): the same camera feed and ticket, for items.
- [Voice](voice.md): the `call` gesture starts push-to-talk.
- [Blueprints](blueprints.md): what a committed stroke becomes.
- [Install and setup](install-and-setup.md): the Pi's systemd units and kiosk.
- [Pair a device](pair-a-device.md): the device token the ticket comes from.
- Module docs: [tui/pi-vision](../modules/tui/pi-vision/README.md), [web/vision](../modules/web/vision/README.md),
  [tui/ui](../modules/tui/ui/README.md), [`models/`](../../models/README.md).
