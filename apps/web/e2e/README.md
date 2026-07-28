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

CI runs the mock suite in a dedicated `e2e-web` job and the smoke suite in
`smoke-e2e` (which composes postgres/redis/…, migrates, and starts api + worker —
but never runs the seed, so a smoke spec must create whatever data it asserts on).

## Authed surfaces: the shared single-sign-in fixture

Most of the app is authed-only — `/` (the ADR 0125 dashboard), `/orders`,
`/quotes`, `/projects`. Two things follow from that:

- **An authed surface belongs in the real-stack smoke suite, not mock mode.**
  Mock mode has no `nav` route group, so the dashboard aggregate
  (`/v1/me/dashboard-summary`) is an unmatched route there; asserting the surface
  against mocks would test the fixtures, not the app.
- **Signing in per spec walks into the rate limit.** The API caps the credential
  endpoints at `AUTH_RATE_LIMIT_MAX` requests per minute per IP (ADR 0044 — only
  `/get-session` gets the generous tier).

So `e2e/fixtures/auth.ts` signs up **once per worker process** and reuses the
resulting `storageState` — the same single-sign-in harness the
`scripts/verify/capture-*.mjs` eyes-on scripts use. Import `test`/`expect` from
it instead of `@playwright/test` and take the `authedPage` fixture:

```ts
import { expect, test } from "./fixtures/auth";

test("… @smoke", async ({ authedPage, authedSession }) => {
  await authedPage.goto("/");
  // authedSession.{email,name,firstName} are generated at run time — assert
  // against them to anchor the spec to the real stack (see the trap below).
});
```

A signup (not a sign-in) is what the fixture does deliberately: the smoke
database is empty, and Better Auth's `databaseHooks` provision one org with an
OWNER membership per new user (ADR 0055), which is the role the org-scoped
endpoints gate on. A spec that needs the _anonymous_ branch just takes the plain
`page` fixture in the same file.

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

### A port is not enough — make the run OWN its server

Claiming a port only helps until someone else claims the same one, and the
failure is silent by construction: a run that finds the URL answering never boots
its own server and never says so. Set **`WEB_E2E_OWN_SERVER=1`** and Playwright
refuses to start on a port it does not own instead of testing whatever is there:

```bash
# Foreign listener on the port -> the run REFUSES to start (measured, PW 1.60):
#   Error: http://localhost:PORT is already used, make sure that nothing is
#   running on the port/url or set reuseExistingServer:true in config.webServer.
WEB_PORT=3100 WEB_E2E_OWN_SERVER=1 pnpm --filter web test:e2e
```

Use it for **anything automated**. Leave it off for interactive work, where
reusing the `pnpm dev` you already have running is the whole point.

It is a dedicated knob and not `CI=1` on purpose. `CI` would also flip
`forbidOnly`, `retries` (0 → 1), `workers` (parallel → 1) and the reporter (list
→ github + html, which writes `playwright-report/` and emits `::error ::`
workflow commands into the captured output), and it leaks into the `next dev`
child — four unrelated changes to buy one. ADR 1038 has the measurements.

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

## Arming the suite in the Stop-hook gate (per-wave, opt-in — ADR 1038)

`scripts/claude-gate.sh` runs this suite as its **last** step, and only when the
wave arms it:

```bash
touch .git/claude-gate-e2e     # arm: every stop now ends with the e2e suite
rm .git/claude-gate-e2e        # disarm when the web work is done

CLAUDE_GATE_E2E=1 <cmd>        # one-off override, no marker file
CLAUDE_GATE_WEB_PORT=61234     # pin the gate's port instead of deriving it
```

Only the **mock-mode** suite runs there — the gate calls the root `test:e2e`,
which is `playwright test` under `playwright.config.ts` (`grepInvert: /@smoke/`).
The real-stack `@smoke` suite stays out: it needs `docker compose` up and a
running api, which a Stop hook must never assume and must never boot.

It is **off by default** on purpose. The gate fires on every stop, and a browser
plus a `next dev` boot is the most expensive thing this repo can run — a
Playwright run per stop would tax every derived project for a suite that only
earns its cost on waves that actually touch the web surface. Armed, it is the
local complement to CI's `e2e-web` job: without it a reskin ships gate-green and
CI-red, because `turbo run test` has no `test:e2e` task and no pre-push hook
invokes Playwright either.

The **marker file** is the primary switch rather than an env var because `.git/`
is never committed and the gate already keeps `.git/claude-gate-green` there —
the path and the .gitignore posture are both already proven, and a marker
survives across the many short-lived shells an agent session spawns, which an
exported variable does not.

### The gate's port is derived, and its run fails closed

The gate does **not** ship a port constant. A constant is the same trap wearing a
different number: every skeleton and every project stamped from one inherits it,
so the second gate to fire on a shared box finds the port bound and — before this
— drove the sibling repo's app automatically, on every armed stop. So:

```bash
WEB_PORT="${CLAUDE_GATE_WEB_PORT:-$(gate_web_port)}" WEB_E2E_OWN_SERVER=1 pnpm test:e2e
#                                   ^ sha1 of the repo root's physical path,
#                                     mapped into 61000-65535
```

- **Stable per checkout** — the same repo gets the same port every run, so a
  leftover listener from your own previous run is still recognisably yours.
- **Different per checkout** — a sibling clone or a git worktree differs. The
  path is the right key precisely because worktrees (the fleet's normal
  multi-seat shape) share a remote and a HEAD lineage but never a path.
- **61000-65535** — inside IANA's dynamic/private range and above Linux's default
  ephemeral allocation range (`net.ipv4.ip_local_port_range`, 32768-60999), so
  the kernel never hands one of these to an outbound socket.
- **`CLAUDE_GATE_WEB_PORT` still wins**, and `WEB_E2E_OWN_SERVER=1` means a
  collision is a loud gate failure rather than a green run against someone else's
  app.

Pinned by selftest cases 14a-14c in `scripts/__tests__/claude-gate.test.sh`,
including one that binds a real listener on the gate's own port and asserts the
gate FAILS.

## The eyes-on harness — seeing a screen instead of asserting about it

**When:** any screen carrying a disclosure obligation (price and VAT, consent,
legal or regulatory text, an error the user must act on), and any new or
reskinned surface before you call it done. A committed spec proves the DOM says
the right thing. It does not prove a human can see it.

**The standing trap this exists for:** _a green DOM assertion is not evidence the
user can see the field._ `expect(locator).toBeVisible()` passes for text pushed
off-screen by an overflowing sibling, clipped by an `overflow: hidden` ancestor,
rendered in the page background colour, or covered by a fixed overlay. Every one
of those has shipped behind a green suite.

The harness is a **throwaway** — write it under your scratchpad, run it, read the
output, delete it. It must **never** become a committed spec: it asserts nothing
stable, its real output is images that a human or agent has to look at, and it
goes stale the moment the design changes. What gets committed is a normal spec
for whatever the sweep _found_ (a specific overflow, a specific unreachable
control), plus the finding or ADR.

### 1. The sweep: named variants x viewport bands

```bash
mkdir -p /tmp/eyeson && cd apps/web
# --config with a throwaway path keeps the file out of e2e/ entirely.
# WEB_E2E_OWN_SERVER=1: boot your own server or fail — never screenshot a
# sibling seat's app and spend an hour reviewing the wrong pixels.
WEB_PORT=3100 WEB_E2E_OWN_SERVER=1 pnpm exec playwright test /tmp/eyeson/sweep.spec.ts \
  --config playwright.config.ts --reporter=line
```

```ts
// /tmp/eyeson/sweep.spec.ts — THROWAWAY. Do not commit.
import { test } from "@playwright/test";

const OUT = "/tmp/eyeson";
// Five bands, chosen because each one is a different layout REGIME, not because
// they are round numbers: 1440 desktop, 1320 the last width before the container
// stops growing, 1024 tablet landscape / the usual lg breakpoint, 768 the
// one-column flip, 390 the smallest phone still worth supporting.
const BANDS = [1440, 1320, 1024, 768, 390];
// Name variants after the STATES the screen can be in, never after the data.
// The states are where layout breaks: nothing, one, many, longest-possible,
// failed.
const VARIANTS = ["empty", "single", "many", "long-labels", "error"];

for (const variant of VARIANTS) {
  for (const width of BANDS) {
    test(`${variant} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?variant=${variant}`);
      await page.waitForLoadState("networkidle");

      // Overflow, measured per PAGE and per SECTION. The page number alone is
      // not enough: an `overflow-x: auto|hidden` ancestor zeroes it while the
      // section underneath still clips its content. Anything > 0 is a horizontal
      // scrollbar the design did not ask for.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const sections = Array.from(document.querySelectorAll("main, main section, [data-eyes]"));
        return {
          page: doc.scrollWidth - doc.clientWidth,
          sections: sections
            .map((el) => ({
              label:
                el.getAttribute("data-eyes") ??
                `${el.tagName}.${(el.className || "").split(" ")[0]}`,
              overflow: el.scrollWidth - el.clientWidth,
            }))
            .filter((s) => s.overflow > 0),
        };
      });
      console.log(`${variant} ${width}`, JSON.stringify(overflow));

      await page.screenshot({
        path: `${OUT}/${variant}-${width}.png`,
        fullPage: true,
      });
    });
  }
}
```

### 2. The tab-walk, screenshotted

Keyboard reachability is the half that pure screenshots miss — and the half a
disclosure obligation usually turns on, since a control nobody can reach is a
control nobody consented with.

```ts
test("tab walk @ 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: (el.innerText ?? "").slice(0, 40),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      };
    });
    console.log(i, JSON.stringify(focused));
    await page.screenshot({ path: `/tmp/eyeson/tab-${String(i).padStart(2, "0")}.png` });
  }
});
```

Read the log for three things the screenshots will not tell you: a stop with a
zero-size rect (focusable but invisible), `inViewport: false` (the focus ring is
off-screen — the user is typing somewhere they cannot see), and a walk that
cycles before it reaches the primary action (a focus trap).

### 3. READ the images back — this is the step that gets skipped

A run that writes 25 PNGs and asserts nothing has verified **nothing** until
someone opens them. Read every image; do not sample. The whole point of the
harness is to replace an inference with an observation, and an unopened PNG is
still an inference. Note what you saw, per band, before you touch the code.

### Standing traps

- **A fixed bottom overlay intercepts pointer events.** A cookie/consent banner
  pinned to the bottom covers whatever is beneath it: Playwright's actionability
  check times out with "element intercepts pointer events", and at 390px it can
  hide the primary CTA outright while every DOM assertion stays green. Dismiss it
  (or set the consent cookie via `context.addInitScript`) for the sweep — then
  run **one** band with it present, because the banner's own layout is part of
  what you are checking.
- **Never edit the tree while a suite runs.** `next dev` hot-reloads mid-spec;
  you get screenshots of a half-compiled page and failures that do not reproduce.
  Freeze the worktree for the duration of the run, including agent edits.
- **Never `pkill -f` to free the port** — see the section above. The pattern
  matches your own shell's argv, so it can kill the shell running it, and it
  kills every sibling seat's dev server too. Kill the PID `ss` reported.
