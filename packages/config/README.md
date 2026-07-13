# @repo/config

Typed environment (`@t3-oss/env-*`) + platform-neutral app constants, split per platform so one platform's env (and its preset) never leaks into the other's bundle.

## Exports

Root barrel (`@repo/config`) — re-exports `./constants` only (platform-neutral, safe in any bundle):

- `APP_NAME` — app identifier.
- `STALE_TIME_MS`, `DEFAULT_RETRY` — TanStack Query defaults consumed by `@repo/api`.
- `STALE` — per-resource cache tiers (`STATIC` / `STABLE` / `MODERATE` / `FRESH` / `REALTIME`).
- `GC` — garbage-collection windows (`LONG` / `MEDIUM` / `SHORT`).

Subpaths (side-effectful — validate env on import):

- `@repo/config/constants` — the same constants directly.
- `@repo/config/env/web` — `env` for the Next.js web app (`@t3-oss/env-nextjs`).
- `@repo/config/env/mobile` — `env` for the Expo app.

## Usage

Read typed web env (mirrors `apps/web/lib/server-flags.ts`):

```ts
import { env } from "@repo/config/env/web";

if (env.NEXT_PUBLIC_POSTHOG_KEY) {
  /* boot PostHog */
}
```

Read a neutral constant (mirrors `packages/api/src/client/query-client.ts`):

```ts
import { DEFAULT_RETRY, STALE_TIME_MS } from "@repo/config/constants";
```

## Decisions

- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — `@repo/config` as a separate single-responsibility package (no `@repo/shared` grab-bag).
- [ADR 0020](../../docs/adr/0020-i18n-next-intl-use-intl.md) — locale/currency identity moved out of constants to `@repo/i18n`.
