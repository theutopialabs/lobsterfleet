# lobsterfleet image. Multi-stage: build everything, then ship a slim runtime.
#
# Why two stages: the build needs pnpm + all dev deps + source. The runtime only
# needs node, the bundled server, the web build, the migrations, and the server's
# prod deps. esbuild bundles the server with --packages=external, so ssh2/ws/kysely
# are NOT in the bundle. We pull just those in via `pnpm deploy` (a self-contained
# folder with a pruned, prod-only node_modules).

# ---- Stage 1: build ----
FROM node:24-slim AS build

# git is handy for some installs. pnpm comes from corepack (pinned in package.json).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /src

# Copy the whole repo. The build needs server, web, and workspace config.
COPY . .

# Install all workspace deps (frozen so the lockfile is the source of truth).
RUN pnpm install --frozen-lockfile

# Build web (Vite -> web/dist) then bundle server (esbuild -> server/dist/index.js).
RUN pnpm build

# Carve out a self-contained server with ONLY its prod deps (ssh2, ws, kysely).
# `pnpm deploy` resolves the workspace package and writes a flat node_modules.
RUN pnpm --filter @lobsterfleet/server --prod deploy --legacy /out/server

# ---- Stage 2: runtime ----
FROM node:24-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Server bundle + its prod node_modules (ssh2/ws/kysely) + migrations.
COPY --from=build /out/server/dist        ./server/dist
COPY --from=build /out/server/node_modules ./server/node_modules
COPY --from=build /out/server/migrations  ./server/migrations

# The built SPA. The server resolves WEB_DIST to ../../web/dist by default,
# which from /app/server/dist/.. lands here at /app/web/dist.
COPY --from=build /src/web/dist           ./web/dist

# Writable runtime state: sqlite db + session archives.
# Owned by the non-root node user (uid 1000). If you bind-mount ./data, make
# sure the host dir is writable by uid 1000: chown -R 1000:1000 ./data
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME /app/data

USER node

EXPOSE 8088

# Defaults that match the volume layout. Override via env_file / -e as needed.
ENV PORT=8088
ENV DATABASE_PATH=/app/data/lobsterfleet.db
ENV SESSION_ARCHIVE_DIR=/app/data/archives
# Codex credential for leased boxes. Mount your host auth.json here (see
# docker-compose.yml) or set OPENAI_API_KEY instead.
ENV LOBSTERFLEET_CODEX_AUTH_PATH=/app/.codex/auth.json

CMD ["node", "server/dist/index.js"]
