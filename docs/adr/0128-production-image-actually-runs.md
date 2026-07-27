# ADR 0128 — Phase A Wave A3 (account-free half): the production image actually builds, boots and stays healthy

**Status:** Accepted (2026-07-25 — Phase A, Wave A3, the half that needs no cloud account). Builds on [ADR 0031](0031-nestjs-modular-monolith-worker-split.md) (three deployables from one build), [ADR 0038](0038-zero-downtime-migrations-pooling.md) (migrations as a release phase), [ADR 0112](0112-invoice-frozen-document-class-and-tax-cz-seam.md) (the `@cardo/tax-cz` dependency), [ADR 0113](0113-production-deploy-topology.md) (the deploy topology this unblocks) and [ADR 0044](0044-security-baseline-supply-chain.md) (the image scan). Does not supersede ADR 0113 — it repairs the artifact ADR 0113 plans to deploy.

## Context

ADR 0113 designed the deploy: one image, three Railway services (`api-http`, `api-worker`, a release-phase `api-migrate`), Vercel for the web. Its execution is gated on Martin's cloud accounts. But one half needs no account at all and had never been done: **actually running the production image.**

`docker/api.Dockerfile` was built and CVE-scanned in CI and never executed anywhere. The `docker-build` job passes `push: false` with no `docker run`; the smoke job runs the api from the turbo build, not from the image. So the image's `CMD` and `HEALTHCHECK` had **never fired** — and the Dockerfile's own header says as much: "authored before local Docker was available… Treat a local failure as a bug to fix here."

Running it found four defects, in ascending order of how long they would have taken to diagnose in production.

## Decision

### 1. The image could not build at all — GitHub Packages auth never reached the builder

`@cardo/tax-cz` is consumed as the `@miklik1/cardo-tax-cz` GitHub-Packages mirror (ADR 0112's O2-b addendum). The repo `.npmrc` maps the scope but deliberately carries **no credential**; the token lives in the developer's user-level `~/.npmrc`, which is not in the Docker build context and must never be committed. So inside the builder, pnpm resolved the package against the public registry and the supply-chain policy rejected the lockfile:

```
✗ Lockfile failed supply-chain policy check (1887 entries in 17.6s)
[ERR_PNPM_TARBALL_URL_MISMATCH] 1 lockfile entries failed verification:
  @miklik1/cardo-tax-cz@0.1.0 could not be verified against the registry's published metadata
```

**The api image has not been buildable since ADR 0112 O2-b landed the dependency on 2026-07-16**, on CI or on any machine without that personal token.

The fix is a **BuildKit secret mount**, `RUN --mount=type=secret,id=npmrc,target=/root/.npmrc`. Deliberately not a build `ARG` (recorded in image history) and not a `COPY`ed `.npmrc` (persists in the layer) — either would publish a `write:packages` token inside a distributed artifact. `docker history` is asserted clean of it.

### 2. The api could not boot — the one approved native build was skipped

`pnpm-workspace.yaml` allows exactly three build scripts, and its comment on the third is explicit: `libxmljs2: true` is **REQUIRED** because `@cardo/tax-cz/export`'s index eagerly constructs its ISDOC/UBL exporters at module init, and the invoices module imports that entrypoint. The Dockerfile ran `pnpm install --ignore-scripts` **and** `pnpm --filter=api deploy --prod --legacy --ignore-scripts /app`, so the prebuilt binary was never fetched. Proven in the built image:

```
Error: Could not locate the bindings file… → …/libxmljs2/compiled/24.17.0/linux/x64/xmljs.node
```

The image built clean and the process died on the first import. Three plausible fixes are all **silent no-ops**, which is why this is worth recording rather than just patching:

- `pnpm rebuild libxmljs2` in the workspace root matches nothing and exits 0 — libxmljs2 is transitive to a workspace project, not a root dependency;
- `pnpm rebuild -r libxmljs2` _does_ work in `/repo` — but `deploy --legacy --ignore-scripts` then materializes a **fresh** `node_modules` under `/app`, so the binary never arrives;
- `pnpm rebuild` inside `/app` tries to corepack-fetch pnpm over the network and still resolves nothing, because `/app` is a single deployed bundle, not a workspace.

So the build invokes libxmljs2's own `install` script the way its `package.json` does (`prebuild-install || node-gyp rebuild`), inside the deployed bundle, using the `prebuild-install`/`node-gyp` that ship in that package's own `node_modules` — no pnpm, no corepack download. A `find … xmljs.node` **tripwire** follows: both legs of that `||` can fail while leaving a zero exit upstream, and the symptom would otherwise be a crash-looping production container instead of a red build.

### 3. The worker container was permanently unhealthy — one image, three commands, one image-level probe

A `HEALTHCHECK` is image-level, but this image carries three commands (ADR 0031) and only `dist/main.js` serves HTTP. Running the worker proved the consequence within a minute:

```
worker health: unhealthy failingStreak=3   (probe exit=1 ×5)
http   health: healthy
```

Under ADR 0113 the `api-worker` Railway service would have been permanently unhealthy and, on any orchestrator that acts on it, restart-looped — with the api itself perfectly fine, which is a genuinely confusing failure to diagnose.

The probe is now **entrypoint-aware**: it reads PID 1's own command line and asserts HTTP only for `dist/main.js`; for the worker (or any non-server command) liveness is "the process is up", which is what Docker already tracks. This is mechanical on purpose. The alternative — "remember to disable the healthcheck on the worker service" in a runbook — is the same procedural-mitigation weakness the Phase-A proposal criticised in ADR 0112 §3's rolling-deploy constraint.

### 4. CI has been failing at `Setup`, and therefore everywhere, since the same dependency landed

`tooling/github/setup/action.yml` runs `pnpm install --frozen-lockfile` with no GitHub Packages credential, so the failure in §1 hits **every job that installs**. The observed shape matches exactly: on the most recent run every job failed at the `Setup` step with its real work `skipped`, `Trivy` was skipped behind the failed `docker-build`, and the only green job was `Gitleaks` — the one job that does not install.

The workflow token gains `packages: read` (a read scope, on packages owned by the same account, granting no write anywhere), and the shared setup action writes that token to `~/.npmrc` — the runner's, never the committed repo `.npmrc` — before installing.

**Honest limit on this claim:** CI has been red since **2026-06-19**, which PREDATES the `@cardo/tax-cz` dependency (2026-07-16). This ADR fixes a cause it can prove and reproduce locally; it does **not** establish that this was the only cause, and the logs for the older runs are not retrievable with this box's `gh` credentials. **CI is not verified green by this ADR** — the next run is the test, and if jobs still fail the remaining cause is a separate investigation. Recording this rather than implying a fix that has not been observed.

### 5. `docker-build` now runs the image, not just builds it

The job gains a `load: true` build and a boot step that starts the image against throwaway Postgres/Redis containers and waits for **the container's own `HEALTHCHECK`** to report healthy (exercising the probe as shipped, not a substitute `curl`), then asserts `/health/live` and that `@cardo/tax-cz/export` actually loads. Building proves the Dockerfile compiles; it never proved the artifact starts, and for eight days it did not.

## What was verified, and how

Against the local dev infra (Postgres 5434 / Redis 6381), from the built image:

- **`dist/main.js`** — boots, all routes mapped including ADR 0127's new `GET /invoices/:id/document`, container reports `healthy` (streak 0), `/health/live` 200 and `/health/ready` 200 with `database: up`, `redis: up`.
- **`dist/migrate.js`** — `migrations applied` (the ADR 0038 release phase, from the image, for the first time).
- **`dist/worker.js`** — starts, drains the outbox, reports `healthy` after the §3 fix. Its Centrifugo warnings are fail-soft and expected here: the throwaway container was given a random API key that does not match the dev Centrifugo.
- **The production secret guard works.** The first boot attempt was correctly _refused_ — `Insecure production environment: CENTRIFUGO_API_KEY … still the dev placeholder`, and `CENTRIFUGO_TOKEN_SECRET: must be at least 32 characters`. Fail-closed, exactly as intended; recorded because it is the behaviour a first real deploy will meet.
- **No credential in the artifact** — `docker history --no-trunc` carries no `authToken`/`ghp_`/`github_pat` match.

## Consequences

- The image is buildable and runnable again, by anyone with `packages: read`, and the ADR-0113 deploy is no longer blocked on a broken artifact.
- **Building the image now requires the secret.** Local: `docker build -f docker/api.Dockerfile --secret id=npmrc,src=$HOME/.npmrc -t perimetra-api .`. A build without it fails fast and loudly at the install layer, which is the honest outcome — a lockfile that silently resolves a private package from the public registry is the supply-chain failure the policy exists to catch.
- The `@miklik1` alias dies at the M5/M6 monorepo fold-in (`workspace:*`), and this whole registry-auth apparatus — the secret mount, the CI `~/.npmrc` write, `packages: read` — dies with it. Marked so it is removed rather than inherited.
- **Still Martin-blocked, unchanged:** the Railway project/services/secrets, the Vercel project, a domain, an EU S3 bucket, an email sending domain, and the Centrifugo-in-prod call. **No CD workflow is authored here.** A deploy job referencing Railway/Vercel secrets that do not exist could never be run or verified, and a durable artifact encoding an aspiration is the failure mode the engineering rules name explicitly. CD lands with the accounts.
- ADR 0112 §3's rolling-deploy livelock is **still procedural**, and still worth converting into a mechanical guard when the first real deploy is set up. Untouched here.
- ADRs 0096/0113 carry a stale `SKIP_ENV_VALIDATION` note (ADR 1021 is current). Not corrected here; carried.
