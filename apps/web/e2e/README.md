# Web E2E (Playwright) — running it safely on a shared box

Two suites share this `e2e/` dir (ADR 0025), split by the `@smoke` tag:

- **Mock mode** (`playwright.config.ts`, the default) boots `next dev` with the
  in-process BFF mocks (`NEXT_PUBLIC_ENABLE_MSW=true`, every mock group active,
  `API_URL` cleared) and drives it in Chromium. No real backend, no database.
- **Real-stack smoke** (`playwright.smoke.config.ts`, `@smoke`-tagged specs)
  boots `next dev` against the real API + compose stack (postgres/redis/…).

```bash
pnpm --filter web test:e2e            # mock mode, headless
pnpm --filter web test:e2e:ui         # mock mode, Playwright UI
pnpm --filter web test:e2e:smoke      # real-stack smoke (needs the compose stack)
```

CI runs the mock suite in a dedicated `e2e-web` job.

## The multi-seat port-ownership trap (read before trusting a green run)

The dev server defaults to **:3000**, and the mock config's `webServer` is set
with **`reuseExistingServer: !process.env.CI`** — locally, if something is
already listening on the port, Playwright reuses it instead of booting its own.

On a machine running **more than one skeleton-derived repo at once** (several
agent seats, or you plus an agent), every repo defaults to the same :3000. The
first process to bind it owns it, and every other repo's `test:e2e` then
**silently drives that first app** — the routes and UI are identical, so specs
pass while asserting against the wrong repo's data. This is a real trap that has
produced a false-green run in the fleet: the only thing that exposed it was a
database query for a value the wrong app could not have produced.

### Fix: give each seat its own port

`WEB_PORT` is a single knob read by **both** the dev script
(`next dev --port ${WEB_PORT:-3000}`) and `playwright.config.ts` (it derives the
wait-URL from `WEB_PORT` and threads the same value into the dev server's env),
so the URL Playwright waits on and the port the server binds can never drift
apart.

```bash
# Second seat on the same box — claim a distinct port:
WEB_PORT=3100 pnpm --filter web test:e2e
```

Pick a per-repo offset and keep it stable (this box already runs the dev stack
on the +2 offset — web :3002 — so the seat convention is `WEB_PORT=3002`). CI is
unaffected: it sets `CI`, so `reuseExistingServer` is off and every job always
boots a fresh server on the default port in its own isolated runner.

The **real-stack smoke** config uses a separate knob, `SMOKE_WEB_PORT`, and
never reuses an existing server (a leftover mock-mode server on the port would
make the smoke suite pass against fixtures — the one thing it exists to catch).
Override it only **together with** `WEB_ORIGIN` on the API, since the smoke web
port must match the API's Better Auth trusted-origin check.

### Prove who owns a port before you trust — or kill — anything

If a run looks suspicious, confirm which repo owns the listening port. Do NOT
assume; prove it:

```bash
# 1. Which PID is bound to the port?
ss -ltnp 'sport = :3000'

# 2. Which repo is that PID actually running from?
sudo readlink /proc/<pid>/cwd                 # the working directory = the repo
tr '\0' '\n' < /proc/<pid>/environ | grep -E 'WEB_PORT|PWD|npm_'   # its env

# 3. Anchor the assertion to a fact only the REAL system under test produces —
#    never to shared UI. A mock-mode run is only trustworthy once a spec has
#    observed something the wrong app could not have generated (a specific
#    seeded record, a 401 on a deliberately wrong credential, etc.).
```

### Never `pkill -f` across seats

To free a port, kill **only your own** server by PID (from `ss` above). A broad
`pkill -f "next-server"` kills every sibling seat's dev server too — and, because
the pattern matches the `pkill` command's own argument list, it can also kill the
shell running it. If you must match by name, exclude the matcher itself:

```bash
pkill -f "[n]ext-server"     # the [n] class stops the pattern matching its own argv
```
