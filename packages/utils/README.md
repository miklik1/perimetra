# @repo/utils

Pure-TS leaf helpers (no React): a logger with a pluggable `LogSink` seam, Intl-based formatting (no date-math lib), stable search-param serialization, and assertions (ADR 0021 / 0023).

## Exports

Barrel (`@repo/utils`):

- `createLogger`, `logger`, `setLoggerSink` — scoped logger + the pluggable sink seam (`@repo/telemetry` installs the sink); types `Logger`, `LogLevel`, `CreateLoggerOptions`, `LogSink`.
- Formatting (from `./format`): `formatDate`, `toIsoDate`, `formatNumber`, `formatPercent`, `formatCurrency`, `formatRelativeTime`, `formatFileSize` (`FormatFileSizeOptions`), `formatList`, `capitalize`, `truncate`, `slugify`, `FALLBACK_LOCALE`.
- `buildSearchParams`, `appendSearchParams`, `stableParams` — stable (sorted-key, null/undefined-dropped) param serialization shared by route URLs and API cache keys; types `SearchParamValue`, `SearchParamsInput`.
- Assertions (from `./assert`, re-exported wholesale).

Subpaths: `@repo/utils/*` map to the source modules directly.

## Usage

Stable param serialization, the single home both `@repo/navigation` and `@repo/api` build on (mirrors `packages/navigation/src/index.ts`):

```ts
import { appendSearchParams, type SearchParamsInput } from "@repo/utils";

const path = appendSearchParams("/users", query as SearchParamsInput);
```

The logger's sink is installed once at boot via `setLoggerSink(createLogSink())` (see `apps/web/lib/telemetry-boot.ts`).

## Decisions

- [ADR 0021](../../docs/adr/0021-telemetry-observability-package.md) — the logger's `LogSink` seam lets app + `@repo/api` logs feed telemetry without an `api → telemetry` edge.
- [ADR 0023](../../docs/adr/0023-datetime-intl-temporal-deferred.md) — Intl formatting only; no date-math lib; Temporal deferred.
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — pure-leaf utils as a separate package (the bottom of the DAG).
