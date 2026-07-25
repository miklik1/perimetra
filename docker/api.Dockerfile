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
# lefthook 2.x resolves the git dir even under CI/LEFTHOOK=0.
#
# It is NOT safe wholesale any more (ADR 0128). `pnpm-workspace.yaml` allows a
# third build script — `libxmljs2: true` — whose prebuild-install postinstall
# fetches the prebuilt native binary. `@cardo/tax-cz/export` eagerly constructs
# its ISDOC/UBL exporters at module init, so the api CANNOT BOOT without it: the
# invoices module imports that entrypoint (ADR 0112). We therefore skip scripts
# for the install and run that ONE approved build afterwards.
#
# `--mount=type=secret,id=npmrc`: `@cardo/tax-cz` is consumed as the
# `@miklik1/cardo-tax-cz` GitHub-Packages mirror (see the repo `.npmrc`), and GH
# Packages requires an auth token that lives OUTSIDE the repo in the user-level
# `~/.npmrc`. Without it pnpm resolves the package against the public registry
# and the supply-chain policy rejects the lockfile
# (`ERR_PNPM_TARBALL_URL_MISMATCH`) — the image could not build at all.
# A BuildKit SECRET, never an ARG or a COPYed file: a build arg is recorded in
# the image history and a COPYed `.npmrc` persists in the layer, either of which
# would publish a write:packages token inside the image.
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    pnpm install --frozen-lockfile --ignore-scripts
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
# Then run the ONE approved native build, INSIDE the deployed bundle (ADR 0128).
# Without this the image builds clean and the api CANNOT BOOT: `@cardo/tax-cz/export`
# constructs its ISDOC/UBL exporters at module init and the invoices module imports
# that entrypoint (ADR 0112 addendum), so loading `xmljs.node` throws in main.ts.
#
# Every part of this is load-bearing — three plausible-looking alternatives are
# all silent no-ops, which is why the failure reached a shipped image at all:
#   - it must run AFTER the deploy: `deploy --legacy --ignore-scripts` materializes
#     a FRESH node_modules under /app, so a binary built in /repo never arrives.
#   - `pnpm rebuild libxmljs2` in /repo matches NOTHING (libxmljs2 is transitive to
#     a workspace project, not a root dependency) and exits 0. `pnpm rebuild -r`
#     works there — but see the previous point.
#   - `pnpm rebuild` inside /app tries to corepack-fetch pnpm over the network and
#     still resolves nothing: /app is a single deployed bundle, not a workspace.
# So we invoke libxmljs2's own `install` script the way its package.json does.
# `prebuild-install` and `node-gyp` ship inside the deployed package's own
# node_modules, so this needs no pnpm and no corepack download.
#
# The `find` is a TRIPWIRE, not decoration: `prebuild-install || node-gyp rebuild`
# can fail on both legs and still leave a zero exit upstream, and the symptom would
# otherwise be a crash-looping container in production rather than a red build.
RUN LIBXML_DIR="$(ls -d /app/node_modules/.pnpm/libxmljs2@*/node_modules/libxmljs2 | head -1)" \
 && cd "$LIBXML_DIR" \
 && (./node_modules/.bin/prebuild-install || ./node_modules/.bin/node-gyp rebuild) \
 && find /app/node_modules -name xmljs.node -print -quit | grep -q . \
 || (echo "FATAL: libxmljs2 native binary missing — the api cannot boot without it" && exit 1)

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
#
# ENTRYPOINT-AWARE, and that is not a refinement (ADR 0128). One image carries
# three commands (ADR 0031) and a HEALTHCHECK is image-level, so the SAME HTTP
# probe was applied to all three. Only `dist/main.js` serves HTTP, so the worker
# container went `unhealthy` with a failing streak within a minute — PROVEN by
# running it, which nothing had ever done: CI's docker-build job passes
# `push: false` and never starts a container. Under ADR 0113 the `api-worker`
# Railway service would have been permanently unhealthy and restart-looped.
#
# So the probe reads PID 1's own command line and only makes an HTTP assertion
# for the http entrypoint; for the worker (and any non-server command) liveness
# IS "the process is up", which is exactly what Docker already tracks. Mechanical
# rather than a "remember to disable the healthcheck on the worker service" note
# in a runbook — the same reason ADR 0112 §3's procedural deploy constraint is
# called out as a weakness.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const c=require('node:fs').readFileSync('/proc/1/cmdline','utf8');if(!c.includes('dist/main.js'))process.exit(0);fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --import the OTel loader (ADR 0036) so instrumentation registers before any app
# module — without it the golden-signal telemetry/alerting watches nothing.
CMD ["node", "--enable-source-maps", "--import", "./dist/otel/loader.js", "dist/main.js"]
