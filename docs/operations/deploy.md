# Deploy

One image, three commands, fixed order. Platform-agnostic by design (ADR
0031/0038): the container image is the contract, no k8s manifests in the
skeleton. Companion runbooks: [backup-restore.md](backup-restore.md),
[incident.md](incident.md).

## One image, three commands

`docker/api.Dockerfile` (build from the **repo root**) produces the single
backend image; the start command selects the deployable:

```sh
docker build -f docker/api.Dockerfile -t <registry>/app-api:<git-sha> .
```

| Deployable  | Command                                                                    | Role                                                        |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **migrate** | `node --enable-source-maps --import ./dist/otel/loader.js dist/migrate.js` | one-shot release phase; exit 0 gates the rollout            |
| **api**     | `node --enable-source-maps --import ./dist/otel/loader.js dist/main.js`    | HTTP on `:4000`; health at `/health/live` + `/health/ready` |
| **worker**  | `node --enable-source-maps --import ./dist/otel/loader.js dist/worker.js`  | BullMQ consumers + outbox relay; no HTTP port               |

Notes:

- The image's default `CMD` is the api **without** the OTel `--import` flag;
  the loader ships in the image (`dist/otel/loader.js`) and no-ops unless
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so always passing the flag in the
  platform start command (as above) is the recommended posture.
- The web app (`apps/web`, Next.js standalone) is a separate deployable built
  with `pnpm --filter web build` — not part of this image.
- Tag images with the git SHA. "Rollback = previous image" needs the previous
  image to be addressable.

## The order (never reorder)

```
1. migrate   — one-shot, same image, NEW version. Non-zero exit ABORTS the deploy.
2. api + worker — roll to the new image (any rollout strategy; both stateless).
```

Migrations never run at app boot — N replicas racing the same DDL is the
outage generator this order exists to prevent (ADR 0038).

**Rollback = previous image, nothing else.** Expand/contract discipline means
every applied migration is compatible with N−1 code, so the schema **stays** —
there are no down migrations. Redeploy the previous tag for api + worker and
you're done. (The exception that needs a human: the migration itself did
damage — that's a [restore](backup-restore.md), not a rollback.)

## Environment

Everything is env-configured (12-factor; defaults in
`apps/api/src/common/config/env.ts` match the local compose stack — every
default is a **dev** value). The prod-mandatory set:

| Var                                                                           | Notes                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                                                                | Postgres DSN                                                                   |
| `DATABASE_POOL_SIZE`                                                          | default 10 — check the ADR 0038 invariant: `pool × replicas < max_connections` |
| `REDIS_URL`                                                                   | the instance MUST run `maxmemory-policy noeviction` (BullMQ)                   |
| `BETTER_AUTH_SECRET`                                                          | generate (`openssl rand -base64 32`); never the dev default                    |
| `BETTER_AUTH_URL`                                                             | public base URL of the api                                                     |
| `WEB_ORIGIN`                                                                  | web app origin (Better Auth trusted origin / CSRF check)                       |
| `TRUST_PROXY=true`                                                            | required behind the Next proxy / any LB — real client IPs for throttling       |
| `CENTRIFUGO_URL` / `CENTRIFUGO_API_KEY` / `CENTRIFUGO_TOKEN_SECRET`           | API key + token HMAC must match the Centrifugo config; generate both           |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` | the production bucket (versioning on — see backup-restore.md)                  |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM`      | real provider creds (Mailpit is dev-only)                                      |
| `SENTRY_DSN`, `POSTHOG_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`                | optional — each layer is off until its var is set (OBSERVABILITY.md)           |

Web service env: `API_URL` (proxy target — also flips MSW mocks off),
`NEXT_PUBLIC_REALTIME_URL` (`wss://<centrifugo-host>/connection/websocket`),
plus the Sentry/PostHog publics from `apps/web/.env.example`.

## Recipe A — managed PaaS (Railway-style)

Services from the one Dockerfile + managed datastores. Maps 1:1 onto Railway;
Render/Fly differ only in nouns.

| Service        | Source                           | Start command / notes                                                                                                                                                                      |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **api**        | `docker/api.Dockerfile`          | api command above; expose `:4000`; healthcheck `/health/ready`                                                                                                                             |
| **worker**     | same image                       | worker command above; no public networking                                                                                                                                                 |
| **postgres**   | managed addon                    | PITR on (backup-restore.md checklist)                                                                                                                                                      |
| **redis**      | managed addon                    | verify `noeviction`                                                                                                                                                                        |
| **centrifugo** | `centrifugo/centrifugo:v6` image | config via env: `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`, `CENTRIFUGO_HTTP_API_KEY`, `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS=<web origin>`, namespaces `user`,`org`; expose the websocket port |
| **web**        | Next standalone build            | `API_URL` → the api's **private** URL (server-side rewrite — internal networking is fine)                                                                                                  |

- **Migrate** runs as the api service's **pre-deploy / release command**
  (Railway: "pre-deploy command"): the migrate command above. The platform
  runs it with the new image before swapping traffic — exactly the required
  order. The worker deploys after (or simultaneously; the worker tolerates
  the new schema by the same N−1 doctrine).
- Browser traffic only ever hits **web** (same-origin `/api/*` proxy — cookies
  stay first-party) and **centrifugo** (websocket, token-authenticated).
  The api needs a public URL only if mobile (direct API access) is in play.
- One env group per environment; generate the three secret pairs
  (auth, Centrifugo, S3) per environment — the `create-project` stamp-out
  generates the initial set.

## Recipe B — self-hosted (Hetzner + compose / Coolify-style)

One box (or a pair: app + db) running compose behind a TLS proxy.
`docker/compose.yaml` is the **dev** stack (infra only, apps on the host) —
production gets its own compose file in the project, sketch:

```yaml
# compose.prod.yaml — sketch, adapt per project
services:
  caddy: # or traefik; TLS + the two public hostnames
    image: caddy:2
    ports: ["80:80", "443:443"]
    # app.example.com  -> web:3000
    # app.example.com/centrifugo/* (or rt.example.com) -> centrifugo:8000

  web:
    image: <registry>/app-web:${TAG}
    environment:
      API_URL: http://api:4000 # internal — the rewrite runs server-side

  api:
    image: <registry>/app-api:${TAG}
    command: ["node", "--enable-source-maps", "--import", "./dist/otel/loader.js", "dist/main.js"]
    env_file: .env.production
    depends_on: { migrate: { condition: service_completed_successfully } }

  worker:
    image: <registry>/app-api:${TAG}
    command: ["node", "--enable-source-maps", "--import", "./dist/otel/loader.js", "dist/worker.js"]
    env_file: .env.production
    depends_on: { migrate: { condition: service_completed_successfully } }

  migrate: # one-shot: runs first, exits; api/worker wait on success
    image: <registry>/app-api:${TAG}
    command:
      ["node", "--enable-source-maps", "--import", "./dist/otel/loader.js", "dist/migrate.js"]
    env_file: .env.production
    restart: "no"

  centrifugo:
    image: centrifugo/centrifugo:v6.8.2
    # prod config.json: real secrets, allowed_origins = the public web origin

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory-policy", "noeviction"]

  postgres: # prefer managed Postgres even on this recipe; if self-hosted:
    image: postgres:17-alpine
    volumes: [pg-data:/var/lib/postgresql/data]
    # + pgBackRest per backup-restore.md — a volume is not a backup
```

Deploy = `TAG=<sha> docker compose -f compose.prod.yaml up -d` — compose's
`service_completed_successfully` dependency encodes the migrate-first order.
Rollback = rerun with the previous `TAG`. Coolify wraps exactly this shape
(it deploys compose files with per-service commands and injects env); the
`depends_on`/migrate pattern carries over unchanged.

## Preview environments (ephemeral, per PR)

The CI `smoke-e2e` job (`.github/workflows/ci.yml`) is the working reference
for booting the whole stack from nothing; a preview env is the same recipe
left running:

1. **Infra:** `docker compose -f docker/compose.yaml up -d --wait postgres
redis centrifugo minio mailpit && docker compose -f docker/compose.yaml
run --rm minio-init` — with a per-PR project name
   (`COMPOSE_PROJECT_NAME=pr-123`) and per-PR host ports (`POSTGRES_HOST_PORT`,
   `REDIS_HOST_PORT`) so PRs don't collide on one box.
2. **Migrate:** `pnpm --filter api migrate` (or the migrate command of the
   PR's image).
3. **Seed:** the demo dataset via the `pnpm run setup` bootstrap / `@repo/db`
   factories — gives reviewers data, not an empty app.
4. **Run:** api + worker (PR image or `pnpm --filter api start` /
   `start:worker`) + `pnpm --filter web dev` with `API_URL` pointing at the
   PR's api.
5. **Teardown on PR close:** `docker compose -p pr-123 down -v` — `-v` drops
   the volumes; preview data is disposable by definition.

Because migrate is a one-shot and everything else is env-driven, a preview
env is _only_ these five steps — there is no special preview mode in the app.
