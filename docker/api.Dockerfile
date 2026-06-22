# Builds the ONE backend image with three commands (ADR 0031). Each long-running
# entry loads the OTel instrumentation via `--import` (ADR 0036; fail-soft — the
# loader no-ops unless an OTEL_* exporter is configured):
#   api:     node --import ./dist/otel/loader.js dist/main.js      (default CMD)
#   worker:  node --import ./dist/otel/loader.js dist/worker.js
#   migrate: node --import ./dist/otel/loader.js dist/migrate.js   (release phase — ADR 0038)
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
# `--legacy`: pnpm v10+ refuses `deploy` without it (or inject-workspace-packages)
# — ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE. --legacy restores the pre-v10 symlink
# behavior; the /app bundle + the runner-stage COPY are unchanged.
# `--ignore-scripts`: legacy deploy re-runs lifecycle scripts, and the root
# `prepare` (lefthook install) needs the git binary + repo — neither exists in
# this pruned alpine builder (same reason the install step above skips scripts).
RUN pnpm --filter=api deploy --prod --legacy --ignore-scripts /app

# ---- run: minimal, non-root ------------------------------------------------
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder --chown=node:node /app .
USER node
EXPOSE 4000

# Liveness probe (process up; readiness/DB+Redis stays the orchestrator's concern,
# so a transient dep blip never marks the container unhealthy). Node's global
# fetch — the alpine runtime has no curl/wget.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --import the OTel loader (ADR 0036) so instrumentation registers before any app
# module — without it the golden-signal telemetry/alerting watches nothing.
CMD ["node", "--enable-source-maps", "--import", "./dist/otel/loader.js", "dist/main.js"]
