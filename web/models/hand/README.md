# Hand-tracking models

Drop the two ONNX files here; `/api/device/hand` loads them on first request:

- `palm_detection.onnx`
- `hand_landmark.onnx`

MediaPipe's palm detector (192×192 input) and 21-point hand-landmark model (224×224 input).
`jarvis pi models` downloads a compatible pair into `<dataDir>/models`, which you can copy here.

A different model only means changing `tui/src/pi/track.ts`, which turns a frame into landmarks.

## Gestures (optional)

- `hand_gesture.onnx` + `hand_gesture.json`: our own classifier, trained and copied here by
  `models/hand_gestgures.ipynb`. Commit them: ~70 KB.

With them present, each answer also carries `hands[0].gesture` and `motion` (`{name, score}`)
and a `trail` string. Send `trail` back as the `x-hand-trail` header on the next frame, the same
way as the ROI; motion needs the last 16 frames, and the server keeps no state.

The model's own contract, for running it anywhere else:

| | name | shape | |
|---|---|---|---|
| in | `landmarks` | f32 [1, 21, 2] | camera pixels, MediaPipe order |
| in | `trail` | f32 [1, 16, 3] | palm centre x, y and hand span per frame, oldest first, left-padded with the oldest |
| out | `gesture` | f32 [1, N] | softmax over `hand_gesture.json` → `gesture` |
| out | `motion` | f32 [1, M] | softmax over `hand_gesture.json` → `motion` |

Palm centre is the mean of landmarks 0, 5, 9, 13, 17; span is the wrist to middle-knuckle
distance (`palmCentre` and `handSpan` in `tui/src/pi`).
