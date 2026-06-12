# loadtest

k6 load tests against a locally running stack. k6 is an **external binary**
(<https://grafana.com/docs/k6/latest/set-up/install-k6/>) — it is not an npm
dependency and nothing in the workspace builds or lints this script beyond
formatting.

## What `projects.k6.js` does

Each VU signs up + signs in once via the raw Better Auth routes
(`/api/auth/sign-up/email`, `/api/auth/sign-in/email`; the httpOnly session
cookie lives in k6's per-VU cookie jar), then loops a read-heavy mix on the
reference resource:

- `POST /v1/projects` (fresh `Idempotency-Key` per attempt)
- `GET /v1/projects` keyset cursor walk (up to 3 pages of 20)

Pass/fail (k6 `thresholds`, exit code != 0 on breach) at the default
`vus=10` / `duration=30s`:

| op             | threshold         |
| -------------- | ----------------- |
| list (read)    | p95 < 200 ms      |
| create (write) | p95 < 400 ms      |
| checks         | > 99% non-4xx/5xx |

## Running it

1. Boot the local dependencies (ports may be overridden by the gitignored
   `docker/.env` — the API reads the matching values from
   `apps/api/.env.local`):

   ```sh
   docker compose -f docker/compose.yaml up -d
   ```

2. Migrate, build and start the API **with the throttle tiers raised** — the
   defaults (100 req/min per user, 10 auth req/min per IP, ADR 0044) are abuse
   protection, not load-test budgets, and will 429 every VU within seconds:

   ```sh
   pnpm --filter api build
   pnpm --filter api migrate
   THROTTLE_LIMIT=100000 AUTH_RATE_LIMIT_MAX=1000 pnpm --filter api start
   ```

3. Run k6 against it (`BASE_URL` defaults to `http://localhost:4000`):

   ```sh
   BASE_URL=http://localhost:4000 k6 run loadtest/projects.k6.js
   ```

Knobs (all env vars): `BASE_URL`, `VUS` (default 10), `DURATION` (default
`30s`) — e.g. `VUS=25 DURATION=2m k6 run loadtest/projects.k6.js`. Note the
thresholds are calibrated for the default 10/30s shape on a local stack;
heavier shapes are for exploration, not pass/fail.

The test writes throwaway users (`loadtest-*@example.com`) and projects into
the dev database; `docker compose -f docker/compose.yaml down -v` resets
everything.
