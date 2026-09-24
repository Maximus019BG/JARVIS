# Hand-tracking models

Drop the two ONNX files here; `/api/device/hand` loads them on first request:

- `palm_detection.onnx`
- `hand_landmark.onnx`

MediaPipe's palm detector (192×192 input) and 21-point hand-landmark model (224×224 input).
`jarvis pi models` downloads a compatible pair into `<dataDir>/models`, which you can copy here.

A different model only means changing `tui/src/pi/track.ts`, which turns a frame into landmarks.
