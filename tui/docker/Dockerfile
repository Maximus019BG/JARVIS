# syntax=docker/dockerfile:1
#
# jarvis in a container. Build context is the `tui` directory:
#   docker build -f docker/Dockerfile -t jarvis .
#
# Bun stays in the final image on purpose: jarvis installs the provider packages
# named in your config on first use (`bun add` into $XDG_DATA_HOME/jarvis/packages),
# so a compiled binary alone would not be enough.

ARG BUN_VERSION=1-debian

################################################################################
# Dependencies, in their own stage so a source change does not reinstall them.
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

################################################################################
FROM oven/bun:${BUN_VERSION} AS final

# ca-certificates: HTTPS to model providers.
# git:            the workspace is usually a repo, and the bash tool expects it.
# ripgrep:        the grep tool uses `rg` when it is present, and falls back to grep.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json jarvis.schema.json ./
COPY src ./src

# Config and state live on volumes so they survive `docker compose down`.
# jarvis resolves ~/.config/jarvis and ~/.local/share/jarvis from these.
ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data \
    JARVIS_IN_DOCKER=1
RUN mkdir -p /config/jarvis /data/jarvis /workspace

# The directory jarvis operates on. Mount your project here.
WORKDIR /workspace

ENTRYPOINT ["bun", "run", "/app/src/index.tsx"]
