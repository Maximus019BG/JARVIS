# 🧠 JARVIS
### Job Acceleration Reference Visual Interface System

> “Your personal Agentic workspace assistant.”

JARVIS is a workstation assistant in three parts:

- **`jarvis`**, a terminal coding agent (`tui/`). One Bun binary that also runs headless jobs,
  the automation worker and the Raspberry Pi's camera daemon.
- **A web app and API** (`web/`). It holds accounts, paired devices, synced sessions, blueprints,
  automations, a model gateway and server-side vision.
- **A Raspberry Pi 5 with a camera and projector**, running the same `jarvis` binary.

A phone app (`mobile/`) approves and steers agent sessions remotely.

How the parts fit together is in [`docs/architecture.md`](docs/architecture.md). Each flow is
written out step by step in [`docs/use-cases/`](docs/use-cases/README.md).

---

## 💡 What it does

### 🤖 Terminal coding agent
- Chat with a model. The agent reads files, runs commands and edits code in a loop.
- Every step that changes the workspace or sends data off the machine passes a permission gate.
- Providers: Anthropic, OpenAI, Google, any OpenAI-compatible endpoint, or the hosted JARVIS gateway.
- Agents, commands, skills, tools, plugins, themes, keybinds and MCP servers are files on disk
  (`.jarvis/` or `~/.config/jarvis/`), not code you have to fork.
- `jarvis run "<prompt>"` runs one prompt headlessly.

### 📱 Remote approval and steering
- Read a running session's transcript from the web app or the phone.
- Answer the permission prompt that stopped the agent, or queue the next prompt for the terminal.

### ✋ Hand gestures and drawing
- The camera turns your hand into 21 landmarks and a gesture.
- In the TUI a thumbs-up approves a prompt and a swipe scrolls.
- In the blueprint editor, and on the Pi's projected sheet, a pinch draws a stroke that snaps to a clean shape.

### 📷 Teach and find items
- Teach JARVIS a physical object ("mug", "multimeter") from a few webcam shots. There is no training step.
- Later, you or the agent ask where it is. Items belong to the workstation, so every paired device can find them.

### 📐 Blueprints
- 2D technical drawings: wiring schematics, floor plans, IoT board layouts.
- Draw by hand in the terminal or browser, place library symbols, and let JARVIS route the wires.
  The agent can also draw one for you.
- Every save is a version you can view, diff and restore, synced between devices and the web.

### 🎙️ Voice
- Dictate prompts, wake JARVIS by name, and hear answers read aloud.
- An optional speaker check refuses voices that are not enrolled.
- The phone app turns speech into a queued prompt. Words always land as editable text first.

### ⚙️ Automations
- Draw a node graph in the browser and start it by hand, by webhook or on a cron schedule.
- Agent steps run on your own paired machine through `jarvis work`.
- Agents can also author and run automations over MCP.

### 🔗 Devices, gateway and MCP
- `jarvis pair` links a machine to your account (RFC 8628 device flow). Nothing is granted until you approve it.
- Paired devices without their own API key call models through the server's OpenAI-compatible
  gateway. The server holds the provider keys and records usage.
- `/api/mcp` lets MCP clients (Claude Code, Cursor, the JARVIS TUI) read and change a workstation's
  blueprints and automations.
- Code projects: git repos the agent works in, synced between machines or to a remote you already have.

---

## 🧩 Tech Stack

| Part | Stack |
|-----------|-------------------|
| Terminal agent, Pi vision, worker (`tui/`) | Bun, TypeScript, Vercel AI SDK, OpenTUI |
| Web app + API (`web/`) | Next.js 16, Drizzle ORM, Postgres, Better Auth |
| Phone app (`mobile/`) | Expo 54, React Native |
| Vision | ONNX Runtime: hand tracking, a gesture classifier trained in `models/` (PyTorch, `uv`), DINOv2 for items |
| Voice | Wake word, speaker verification, transcription and speech through the web gateway |
| Deploy | Docker, Kubernetes (kustomize overlays `dev`/`prod`/`test`), nginx with TLS, Postgres |
| Hardware | Raspberry Pi 5, camera, projector (systemd units and a Chromium kiosk in `tui/assets/pi/`) |

---

## 🛠️ Getting Started

### Install the `jarvis` binary

From a deployed JARVIS server:

```bash
curl -fsSL https://<your-jarvis-server>/install.sh | sh
```

Or from a checkout: `cd tui && ./install.sh`. Bun is required, and the binary is built on the machine
it runs on. Add `--pi` on a Raspberry Pi to install the camera daemon and kiosk services, or
`--service` for the automation worker.

Then run `jarvis`. It walks you through pairing with your server, or adding your own model key.
`ctrl+g` or `/tutorial` shows every key.

### Run the server

```bash
docker build -f web/Dockerfile -t jarvis-web .   # from the repo root
```

Deploy with [`k8s/`](k8s/README.md), or run locally with `pnpm --filter web dev`. Every env variable
is listed in [`web/.env.example`](web/.env.example). Migrations run separately:
`pnpm --filter web db:migrate`.

### Develop

| Path | Run / test |
|---|---|
| `tui/` | `bun run start` · `bun test` · `bun run typecheck` |
| `web/` | `pnpm --filter web dev` · `pnpm --filter web test` · `pnpm --filter web check` |
| `mobile/` | `cd mobile && bun install && bun start` · `bun run typecheck` |
| `models/` | `cd models && uv sync` |

From the root: `pnpm check` and `pnpm test`. Start with [`AGENTS.md`](AGENTS.md), whether you are a
person or an agent.

More detail: [`tui/`](tui/README.md) · [`web/`](web/README.md) · [`mobile/`](mobile/README.md) ·
[`models/`](models/README.md) · [`k8s/`](k8s/README.md) · [status](docs/ROADMAP.md) ·
[decisions](docs/decisions.md)

> ⚠️ **Python is only used in `models/`** (gesture model training), and only through **`uv`**
> (`pyproject.toml` + `uv.lock`). `pip install -r requirements.txt` is not supported.

---

## 📄 License

[GPL-3.0](LICENSE)
