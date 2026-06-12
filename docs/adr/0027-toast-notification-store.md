# ADR 0027 — Toast/notification queue as the second `@repo/store` store

**Status:** Accepted (2026-06-04). Applies the store-placement rule of
[ADR 0010 (Amendment)](0010-ui-state-zustand-store-package.md).

## Context

The skeleton has no cross-platform user-feedback primitive. Toast/notification
is **domain-less app-shell UI state** — the exact category the ADR 0010
amendment reserved for `@repo/store` (it named "a toast queue" explicitly). It is
also the second store, which validates that the placement rule generalizes beyond
theme.

The value of putting the queue in a shared package (vs a per-app toast lib) is
**shared call sites**: the cross-platform `makeQueryClient` `onError` hook (or a
telemetry handler) can fire one toast that works on web and mobile.

## Decision

**Add `createToastStore()` to `@repo/store`** — a pure, ephemeral queue — with
per-platform `<Toaster>` render components living in the apps (pixels, not
shared), mirroring the theme store/`ThemeEffect` split.

- **Pure queue, no persistence.** Unlike theme, toasts are ephemeral, so there is
  no `Storage` adapter. State: `toasts: Toast[]`; actions `add(toast) → id`,
  `dismiss(id)`, `update(id, patch)`, `clear()`.
- **Counter IDs.** IDs come from an in-store incrementing counter — deterministic,
  no `Date.now()` / `Math.random()`, test-friendly.
- **Timers live in the render layer, not the store** (ADR 0010 philosophy: store =
  pure state machine, effects in the app). The `<Toaster>` sets auto-dismiss
  timeouts and calls `dismiss`.
- **Convenience API.** `createToastApi(store)` returns
  `toast.success/error/info/warning(message, opts)` + `toast.promise(p, msgs)`
  (loading → success/error via `add`+`update`). The app instantiates one
  `toastStore` + `toast` singleton (like `themeStore`) so any shared module can
  import and fire toasts.
- **Feature set (chosen for a reusable base):** the four types, auto + manual
  dismiss, an optional **action** (label + callback), **`toast.promise`**, and
  **dedup + a `maxVisible` cap** (coalesce by optional `key`; overflow queued) so
  bursts don't spam. Each is low-cost and broadly needed; omitting them only
  forces per-project reinvention.
- **Custom `@repo/ui` Toaster, not `sonner`.** Web renders our own shadcn-styled
  toaster from the store queue — single source of truth, full styling control,
  and symmetry with mobile. `sonner` keeps its own imperative queue (a second
  source of truth) and is web-only, so it is rejected.
- **Mobile `<Toaster>`** (RN + Reanimated) is **deferred** while the mobile app is
  dormant — the store is cross-platform; only the render is pending (consistent
  with the other mobile seams).

## Consequences

- A cross-platform feedback primitive with one shared API; shared error handling
  (`onError` → `toast.error` + telemetry capture) becomes possible.
- `@repo/store` now hosts two stores (theme + toast), confirming the placement
  rule and keeping the package a pure leaf (no new edges; zustand only).
- A11y is the Toaster's responsibility (`role="status"`/`"alert"`, `aria-live`)
  and is covered by the jsx-a11y lint (ADR 0026 quality sweep).
- Mobile feedback is unproven until its `<Toaster>` is built (deferred).

## Sources

- [ADR 0010](0010-ui-state-zustand-store-package.md) (store package + the
  placement-rule amendment this applies; theme store/effect split mirrored here).
- Zustand v5 vanilla store factory (https://zustand.docs.pmnd.rs).
- WAI-ARIA live regions for notifications:
  <https://developer.mozilla.org/docs/Web/Accessibility/ARIA/ARIA_Live_Regions>
  (verified 2026-06-04).
