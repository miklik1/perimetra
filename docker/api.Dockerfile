# Builds the ONE backend image with three commands (ADR 0031):
#   api:     node dist/main.js      (default CMD)
#   worker:  node dist/worker.js
#   migrate: node dist/migrate.js   (release phase, before rollout — ADR 0038)
#
# Build from the REPO ROOT:
#   docker build -f docker/api.Dockerfile -t fullstack-skeleton-api .
#
# NOTE: authored before local Docker was available — exercised by the CI
# docker-build job (Phase 7). Treat a local failure as a bug to fix here.

# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- prune: reduce the build context to api + its workspace deps ----------
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@^2 prune api --docker

# ---- build: install (lockfile-strict), build the api graph, deploy --------
FROM base AS builder
# Lockfile + package.jsons first — dependency layer caches across src changes.
COPY --from=pruner /repo/out/json/ .
# --ignore-scripts: the root `prepare` runs `lefthook install`, which needs a
# git binary + repo — neither exists in the image (alpine, pruned context) and
# lefthook 2.x resolves the git dir even under CI/LEFTHOOK=0. Safe to skip
# wholesale: allowBuilds (pnpm-workspace.yaml) only permits @sentry/cli +
# lefthook scripts anyway, and the api graph needs neither at build time.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=api...
# Standalone production bundle: api + prod deps + built workspace packages.
RUN pnpm --filter=api deploy --prod /app

# ---- run: minimal, non-root ------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app .
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.js"]
