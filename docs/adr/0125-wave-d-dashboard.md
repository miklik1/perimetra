# ADR 0125 — Wave D: the honest Přehled dashboard at `/` + the `GET /v1/me/dashboard-summary` aggregator (root-demo retirement)

**Status:** Accepted (2026-07-24 — W9 Phase 2, Wave D). The one §5-IN surface that needed a new endpoint. Applies the design authority (`design/configurator/frames-dashboard.jsx`) under the contract-honesty rule; follows the wave method of [ADR 0119](0119-orders-surface-reskin.md)–[0124](0124-wave-c-admin-katalog-reskin.md).

## Context

`app/page.tsx` (the bare `/` route) was still the fullstack-skeleton **root demo** — a users list + create-user form + theme/locale togglers. Meanwhile the app-shell nav (ADR 0118) already carried a `dashboard` entry that lights on `/` and is visible to admin/sales/workshop. So the nav pointed at a route that rendered the skeleton demo.

The design canvas (`frames-dashboard.jsx`) draws an aspirational owner dashboard: four KPI tiles (incl. **leads** and **revenue**), a **four-stage** funnel (Poptávky→Nabídky→Objednáno→Vyfakturováno), a six-month **revenue** bar chart, an **upcoming**/scheduling calendar (Doměření/Montáž/Doplatek), and a recent-activity feed. Most of that has **no backend source** — there is no leads module, invoices are not adoption-wired (no revenue), there is no deposit concept, and there is no scheduling field. Wave D builds the honest core and, because it lands at `app/page.tsx`, retires the root demo.

## Decision

**Build an honest, role-filtered dashboard backed only by real orders/quotes data, served by one schema-less aggregator, and retire the skeleton root demo.**

### The aggregator — `GET /v1/me/dashboard-summary`

Added to the **existing `nav` module** (which already hosts `nav-counts` and imports Quotes+Orders), mirroring the `nav-counts` precedent exactly:

- A new `DashboardSummaryService.forCaller(scope, role)` — owns no table; fans the caller's scope out to the exported `OrdersService`/`QuotesService` (cross-module reads through services, never a schema join, ADR 0032). Schema-less server-side (a plain interface; the zod parse is the FE trust boundary).
- **Role-filtered via optional keys** (the nav-counts convention: an absent key is "not shown", never a zero placeholder). The price-blind `workshop` role (`isPriceBlind`, ADR 0056) is handled by an **early branch that never invokes the quotes services** — it returns ONLY `kpis.activeOrders` + orders-only `activity`; no quotes KPI, no funnel, no expiring-quotes, no money field anywhere. `admin`/`sales` get the full shape, with every quotes-derived number owner-narrowed for `sales` inside `QuotesService` (ADR 0082). No `@RequireRole` — workshop still gets a (sparse) dashboard.
- Thin new read methods on the surface services+repositories, copying the `countActive`/`countOpen` `scoped()`+`inArray`/`orderBy` machinery: `OrdersService.listRecent`, `QuotesService.{listRecent, listExpiring, countByStatuses, countExpiringSoon}`. `listExpiring`/`countExpiringSoon` apply `effectiveStatus` server-side so a **lapsed** quote (`validUntil ≤ now`) is excluded from "expiring soon" (it has lapsed, not "expiring"). The activity feed is built from orders+quotes `updatedAt` only — **never the audit trail** (the audit module's CONTEXT.md forbids cross-module audit reads).
- Structural parameters live as service constants (not per-tenant config): `ACTIVITY_LIMIT = 8`, `EXPIRING_QUOTES_LIMIT = 5`, `EXPIRING_SOON_HORIZON_DAYS = 14`. If the design later specifies a window/limit, these are the single edit points.
- FE trust-boundary schema: `packages/validators/src/dashboard-summary.ts` (`dashboardSummaryResponseSchema` + `DashboardSummaryResponse`), role-encoded via optional keys, reusing the quote/order status enums, `isoDatetime`, and the decimal-string `| null` money convention.

### The dashboard surface

- `app/page.tsx` follows the `/orders` prefetch+hydrate shape: the RSC fetches the summary **as the user** (`createServerApiClient`, session cookie forwarded) and dehydrates it. An **unauthenticated** visitor to `/` still renders — the prefetch **swallows a 401** (`isUnauthorized`, the `/admin` pattern) so the client `<AuthGuard>` owns the redirect to `/login`. `/` is deliberately **NOT** added to the proxy `PROTECTED_PREFIXES` (a `/` prefix would match every route); access is owned by the AuthGuard subtree + the org-scoped endpoint.
- `dashboard-client.tsx` renders the honest core on kit primitives: a time-of-day **greeting** (`DisplayLabel` h1 + a cs-CZ date line, a `· přehled dílny` suffix for workshop) · a **KPI row** — the single `StatCard` **spotlight** on _Aktivní zakázky_, the rest plain `Panel` tiles, each rendered only when its (optional) count is present · an honest **2-stage funnel** (Nabídky→Objednáno; no leads/invoiced stage) · an **expiring-quotes** list (`validUntil` ascending, money gated on `total !== null`) · an **activity** merge (orders+quotes by `updatedAt`, relative time via `Intl.RelativeTimeFormat` for correct Czech plurals, reusing `OrderStatusBadge`/`QuoteStatusBadge`). Every flex/grid ancestor carries `min-w-0` (+ `truncate`/`shrink-0`) so nothing overflows the body at 390.
- **`min-h-screen` per-branch:** the AppShell (ADR 0118) frames `/` when authed and owns height/scroll/bg, so the authed `<main>` drops `min-h-screen`; only the AuthGuard fallback (which renders bare, outside the shell) keeps `min-h-screen` + `bg-field`.
- **Workshop degradation** is driven by summary _presence_, not a client role check: absent `funnel`/`expiringQuotes`/quote-KPIs simply do not render (the funnel/expiring grid row disappears entirely), so the workshop home is deliberately sparse and money-free.

### Honest subtraction (the §11.2 divergence list)

OMITTED because no backend source backs them: **leads / Poptávky** (no leads module) · **revenue / Tržby / Vyfakturováno** and every money-total KPI (invoices not adoption-wired — revenue is never fabricated) · **deposit / Čeká na doplatek** (no deposit concept) · **scheduling / Doměření / Montáž / the Nadcházející calendar** (no scheduling field). The activity feed is `updatedAt`-derived, never the audit trail.

### Root-demo retirement

Building the dashboard at `app/page.tsx` retires the skeleton root demo (a long-standing carry). Deleted as orphaned (page.tsx was their only consumer — no `/users` route, no other importer): `app/{create-user-form,locale-switcher,theme-toggle,users-infinite-list,users-list}.tsx`, `app/users-list.test.tsx`, `app/page.data-source-gate.test.ts`, the three demo e2e specs `e2e/{home,locale,users}.spec.ts`, and `lib/locale-cookie.ts` (dead once `LocaleSwitcher` went — the server still reads the cookie via `@repo/i18n`'s `LOCALE_COOKIE`). Removed the `home` i18n namespace (kept the unrelated `nav.home: "Domů"` label). `@repo/api` `createUsersQueries` + `@repo/validators` `userSchema` are **retained** — library exports used by api-mocks/tests, only name-referenced in a `projects-queries.ts` comment.

## Consequences

- **i18n:** a new `dashboard` namespace (cs primary + en parity: `greeting.*`, `workshopSuffix`, `kpi.*`, `funnel.*`, `expiring.*`, `activity.*`, `checkingSession`); order/quote status labels are reused from the existing `orders.status.*`/`quotes.status.*` (not duplicated).
- **No schema / table / migration** (the aggregator is schema-less). A new endpoint IS new backend behaviour → an integration test (`apps/api/test/dashboard-summary.itest.ts`, role-flip on one org: money present for admin/sales, absent for workshop) + a unit test (`dashboard-summary.service.test.ts`, one case per role asserting the workshop strip + sales owner-narrowing) were added.
- **Gate:** full `turbo check-types lint build --force` (56/56) + `web` vitest (`--no-file-parallelism`) + `knip` + `pnpm --filter api test:integration` all green.
- **Adversarial review** (3 opus dims: backend-role-strip / frontend-honesty-kit / contract-cleanup-tests) found **1 confirmed medium** — a _vacuous test guard_: deleting the `home` namespace removed the only `{count, plural}` fixture (`home.users`), so the i18n icu test's numeric-plural-arg `@ts-expect-error` was thereafter satisfied by an _unknown-key_ error (silently duplicating the adjacent unknown-key case, its comment now lying). Retargeted to the live `nav.badge` plural so the wrong-arg-type check is real again (**fixed** + re-gated). Independently re-read + eyes-on-verified: no fabrication, and the workshop strip holds (the quotes services are not even invoked for a workshop caller).
- **Eyes-on** cleared ×6 ship-bar widths in light + dark (`capture-wave-d.mjs`, new authed-only): the greeting + KPI row (StatCard spotlight) + 2-stage funnel + expiring-quotes + activity merge, framed by the app shell; both themes resolve, no horizontal body scroll at 390.
- **⚠️ Flags for Martin (not blocking):** (1) the demo retirement removed the app's **only manual theme/locale toggle UI**; the app still follows OS theme via `ThemeEffect` (no theme-_resolution_ regression), but a manual override belongs on `/account` (fenced out this phase) — a follow-up. (2) `/` now has **no e2e smoke** (the three deleted specs drove the old root demo); an authed-dashboard e2e (needs auth fixtures) is a follow-on. (3) The dashboard's structural constants (activity top-8, expiring horizon 14 d / list 5) were chosen without a design figure.
