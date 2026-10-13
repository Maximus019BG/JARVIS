# models

Training for the hand-gesture classifier. One notebook, [`hand_gestgures.ipynb`](hand_gestgures.ipynb),
exports `export/hand_gesture.onnx` plus `export/hand_gesture.json` (the labels). The web API and the
Pi load these files to turn hand landmarks into gestures (👍 approve, ✋ stop, swipes…).

The model never sees pixels. Its input is the 21 landmarks per frame that `tui/src/pi/track.ts`
already produces, so it has ~10K weights (~80 KB) and runs in microseconds.

| | name | shape |
|---|---|---|
| in | `landmarks` | f32 [1, 21, 2]: camera pixels, MediaPipe order |
| in | `trail` | f32 [1, 16, 3]: last 16 frames of (palm x, y, hand span), oldest first |
| out | `gesture` | f32 [1, 12]: `none pinch palm fist point peace thumbs_up thumbs_down ok three call rock` |
| out | `motion` | f32 [1, 6]: `none swipe_left swipe_right swipe_up swipe_down wave` |

Normalisation happens inside the graph, so callers pass raw pixels and can't drift from training.

## Setup

Only use `uv`; there is no `requirements.txt`. On Linux it installs CPU-only torch.

```bash
cd models && uv sync     # then open the notebook with the .venv kernel
```

## Retrain

The notebook's own section headings walk through each step:

1. **Record:** this step is optional. The vision worker prints one JSON line per frame, so you
   record a take with a shell redirect:
   `bun tui/src/pi/vision-worker.ts --source=ffmpeg > models/data/static/<gesture>/<take>.ndjson`.
   Motions go in `data/motion/<motion>/`. For each label, the last file by name is held out for
   validation.
2. **HaGRID pretraining:** controlled by `USE_HAGRID`. On first run it downloads a ~720 MB
   landmark archive, cached as `data/hagrid/hagrid.npz`. The licence is a CC BY-SA 4.0 variant;
   read its terms before shipping a model trained on it.
3. **Train, evaluate, export:** this takes seconds on a laptop CPU. The notebook prints a confusion
   matrix for the held-out takes, checks that ONNX Runtime agrees with PyTorch, and measures
   latency.
4. **Install:** the last cell copies both files to `web/models/hand/` and `~/.local/share/jarvis/models/`.

`data/` is gitignored. You can point it somewhere else with `GESTURE_DATA=<dir>`.

## What to commit

Commit `export/*` and the copies in `web/models/hand/`; they're small and the server needs them.
Don't commit `data/` or `.venv/`. `tui/src/pi/track.ts` refuses a model whose outputs don't match
the JSON. If you rename labels, also update the default actions in `tui/src/config/config.ts` and
the emoji in `tui/src/ui/use-gestures.ts`.
