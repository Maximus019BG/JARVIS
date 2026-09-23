# syntax=docker/dockerfile:1
#
# The Next app. Build context is the REPO ROOT — web imports ../tui/src/blueprint and embeds
# tui/install.sh, so it cannot build from web/ alone:
#   docker build -f web/Dockerfile -t jarvis-web .
#   docker run --env-file web/.env -p 3000:3000 jarvis-web

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

################################################################################
# Workspace install (web + tui: the blueprint engine resolves `ai`/`zod` from tui).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY tui/package.json tui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

################################################################################
FROM deps AS build
COPY web web
COPY tui tui
# Inlined into the client bundle at build time.
ARG NEXT_PUBLIC_BASE_URL=http://www.jarvisweb.cloud
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1
# Some modules build clients at import time (e.g. `new Resend(key)` throws when empty), and
# `next build` imports routes to collect page data. Placeholders live in this stage only;
# the runner gets real values at runtime.
RUN RESEND_API_KEY=re_build_placeholder \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-placeholder-build-placeholder-00 \
    pnpm --filter web build

################################################################################
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=build --chown=node:node /app/web/public ./web/public
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
