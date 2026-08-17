# jarvis in Docker

Useful when you want the agent's `bash` and `edit` tools confined to one directory,
or when you do not want to install bun on the host.

## Run it

From the `tui` directory:

```bash
docker compose -f docker/compose.yaml run --rm jarvis
```

`run`, not `up` — jarvis is a TUI and needs a terminal attached. Any subcommand works
the same way:

```bash
docker compose -f docker/compose.yaml run --rm jarvis models
docker compose -f docker/compose.yaml run --rm jarvis run "what does src/agent/agent.ts do?"
docker compose -f docker/compose.yaml run --rm jarvis init
```

Without compose:

```bash
docker build -f docker/Dockerfile -t jarvis .
docker run --rm -it \
  -v "$PWD:/workspace" \
  -v "$HOME/.config/jarvis:/config/jarvis" \
  -v jarvis-data:/data \
  -e ANTHROPIC_API_KEY \
  jarvis
```

## What is mounted where

| Host | Container | Why |
|---|---|---|
| `$WORKSPACE` (default: repo root) | `/workspace` | the project jarvis reads and edits |
| `~/.config/jarvis` | `/config/jarvis` | your config, agents, commands, skills, tools, plugins, themes |
| `jarvis-data` volume | `/data` | sessions, and the provider packages jarvis installs on demand |

`XDG_CONFIG_HOME` and `XDG_DATA_HOME` are set in the image, so jarvis finds those two
paths on its own.

To point at a different project:

```bash
WORKSPACE=~/Code/some-project docker compose -f docker/compose.yaml run --rm jarvis
```

A `.jarvis` directory inside the mounted project is picked up exactly as it would be
on the host.

## File ownership

The container runs as root by default, so files it creates in `/workspace` are owned
by root on Linux. To avoid that, uncomment the `user:` line in
[compose.yaml](compose.yaml) and export the ids:

```bash
export UID GID   # bash; zsh users can pass them literally
```

On macOS this does not come up — Docker Desktop maps ownership for you.

## Notes

- Bun stays in the final image on purpose. jarvis installs the `@ai-sdk/*` package
  named by each provider in your config on first use, so the image cannot be
  bun-free. That install lands on the `/data` volume and is cached across runs.
- `ripgrep` and `git` are installed because the `grep` tool prefers `rg` and the
  workspace is normally a repo.
- MCP servers of `type: "local"` run *inside* this container, so their commands have
  to exist here. Add them to the Dockerfile, or use `type: "remote"`.
- Building for another architecture: `docker build --platform=linux/amd64 …`. The
  opentui native library is selected per platform at install time, so it follows.
