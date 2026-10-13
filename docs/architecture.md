# Architecture

How the parts of JARVIS fit together. Package details live in each package's README:
[`tui/`](../tui/README.md), [`web/`](../web/README.md), [`mobile/`](../mobile/README.md),
[`k8s/`](../k8s/README.md), [`models/`](../models/README.md).

## The pieces

```
                 ┌──────────────────────── web (Next.js + Postgres) ────────────────────────┐
                 │  /api/device   pairing, grants, hand tracking (ONNX, stateless)          │
 laptop ─ jarvis │  /api/session  session sync, remote prompts (steering), approvals        │ ◀── mobile (Expo)
 (tui/) ────────▶│  /api/gateway  OpenAI-compatible proxy to model upstreams + usage        │     approvals, sessions, talk
                 │  /api/vision   item learning / detection (DINOv2 ONNX)                   │
 Pi 5 ─ jarvis   │  /api/blueprint, /api/code, /api/automations, /api/mcp                   │ ◀── browser
 pi | work ─────▶│  Drizzle schemas: web/src/server/db/schemas                              │     dashboard, editors
 camera+projector└──────────────────────────────────────────────────────────────────────────┘
```

- **`tui/`** is one Bun binary, `jarvis`, with several entry points:
  - `jarvis`: the interactive coding agent, with blueprints, voice and gestures.
  - `jarvis run`: headless.
  - `jarvis pi`: the camera and hand-drawing daemon on the Pi.
  - `jarvis work`: the automation worker that polls web for jobs.
  - `jarvis pair`: links a device to a web account.

  The Pi runs it through the systemd units in `tui/assets/pi/`, plus a Chromium kiosk that shows
  the projector page.
- **`web/`** is the cloud side. It handles accounts (Better Auth), devices and their grants, synced
  sessions and blueprints, the model gateway, and server-side vision inference. The models live in
  `web/models/`.
- **`mobile/`** is a thin client over `/api/session` and `/api/approval`. The server address and
  token are kept in SecureStore.
- **`models/`** trains the gesture classifier. The notebook exports `hand_gesture.onnx`, which is
  copied into `web/models/hand/`.

## Shared code

`web` compiles parts of `tui` source directly; they are not published as a package:

| Alias in web | Points to | Used for |
|---|---|---|
| `@blueprint/*` | `tui/src/blueprint/*` | blueprint schema, merge, render (one engine for terminal and web) |
| `@pi/*` | `tui/src/pi/*` | hand tracking and item features on the server |

`web/scripts/embed-install-sh.mjs` embeds `tui/install.sh` into the web build, which serves it at
`/install.sh`. Because of both of these, the Docker build context is the repo root.

## Main flows

- **Pairing:** `jarvis pair` shows a code, the user approves it on web, and the device gets scoped
  grants (`web/src/server/device-auth.ts`, `owned-device.ts`).
- **Remote approval and steering:** the TUI pushes its session and pending approvals. The phone or
  web answers, or queues a prompt; the queue is capped by `MAX_PENDING` in
  `web/src/server/steering.ts`.
- **Gestures:** the Pi/laptop camera sends a frame to `/api/device/hand`. The server returns
  landmarks, the gesture and a `trail` string. The client sends `trail` back with the next frame,
  so the server keeps no state.
- **Model calls via the gateway:** the TUI's `jarvis` provider (`tui/src/agent/hosted.ts`) points
  at `/api/gateway`. Routing to upstreams is code in `web/src/server/gateway/upstreams.ts`; the keys
  come from env.

## Deploy

`web/Dockerfile` builds the image `jarvis-web`. `k8s/` runs it as `api-server` behind an nginx
`reverse-proxy` with TLS, next to a `db-server` Postgres StatefulSet. Network policies deny ingress
by default. See [`k8s/README.md`](../k8s/README.md).
