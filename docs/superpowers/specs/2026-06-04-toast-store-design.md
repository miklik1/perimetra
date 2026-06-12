# Design — Toast/notification store (`@repo/store`)

**Date:** 2026-06-04
**Status:** Implemented — toast/notification store in `@repo/store` + web/mobile
Toaster renderers (ADR 0027)
**Decision record:** [ADR 0027](../../adr/0027-toast-notification-store.md)

## Goal

A cross-platform toast/notification primitive: a shared, pure queue in
`@repo/store` (the second store, per the ADR 0010 placement rule) + per-platform
`<Toaster>` render in the apps. One API callable from shared code.

## Store — `@repo/store/src/toast.ts`

```ts
export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number; // ms; 0/undefined-with-sticky = no auto-dismiss
  key?: string; // dedup/coalesce key
  action?: { label: string; onAction: () => void };
}

export type ToastInput = Omit<Toast, "id">;

export interface ToastState {
  toasts: Toast[]; // visible + queued (render slices to maxVisible)
  add: (toast: ToastInput) => string; // returns id; dedups by `key`
  update: (id: string, patch: Partial<Toast>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export function createToastStore(options?: { maxVisible?: number }): StoreApi<ToastState>;
```

- **Pure & ephemeral** — no `Storage` adapter (contrast `createThemeStore`).
- **Counter IDs** — an in-store counter (`let seq = 0`), no `Date.now()` /
  `Math.random()`.
- **Dedup** — `add` with an existing `key` updates that toast instead of pushing
  a duplicate.
- **maxVisible** — config (default 3); the queue holds all, the render layer
  shows the first N (or the store exposes a `visible` selector). Timers are NOT
  in the store.

### Convenience API — `createToastApi(store)`

```ts
export interface ToastApi {
  success(message: string, opts?: Partial<ToastInput>): string;
  error(message: string, opts?: Partial<ToastInput>): string;
  info(message: string, opts?: Partial<ToastInput>): string;
  warning(message: string, opts?: Partial<ToastInput>): string;
  promise<T>(
    p: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((v: T) => string);
      error: string | ((e: unknown) => string);
    },
  ): Promise<T>;
  dismiss(id: string): void;
}
export function createToastApi(store: StoreApi<ToastState>): ToastApi;
```

`promise` adds a sticky loading toast, then `update`s it to success/error on
settle. Pure logic (no timers) — the loading toast just isn't auto-dismissed
until updated.

## App wiring

- Each app instantiates a singleton, e.g. `apps/web/lib/toast.ts`:
  `export const toastStore = createToastStore(); export const toast =
createToastApi(toastStore);` — importable from anywhere (shared modules
  included), like `themeStore`.
- **Web `<Toaster>`** (`apps/web/app/toaster.tsx`, `"use client"`): subscribes via
  `useStore(toastStore)`, renders a shadcn-styled `@repo/ui` toast list, owns
  auto-dismiss `setTimeout`s (cleared on unmount/dismiss), pause-on-hover
  optional. A11y: container `aria-live="polite"` (errors `role="alert"`). Mounted
  in `app/providers.tsx` near `ThemeEffect`.
- **Mobile `<Toaster>`** (`apps/mobile/components/toaster.tsx`): RN + Reanimated
  slide/fade, same store. **Deferred** (mobile dormant) — store is cross-platform,
  render pending.

## Integration (the shared-call-site payoff)

- `makeQueryClient`'s `onError` hook (ADR 0021 telemetry wiring) can call
  `toast.error(...)` **and** `getTelemetry().captureException(...)` — one shared
  place, both platforms. (`@repo/api` stays agnostic; the app supplies the hook.)
- Mutation flows use `toast.promise(mutateAsync(...), { loading, success, error })`.

## DAG / boundaries

Unchanged: `@repo/store` stays a pure leaf (zustand only). No new edge — the
toast store, like theme, is consumed by apps; `@repo/ui` provides the toast
_presentational_ component (web), consumed by the app's `<Toaster>`.

## Testing (Vitest)

- `createToastStore`: add returns id + enqueues; dedup by `key` updates in place;
  dismiss/clear; counter IDs unique & deterministic; maxVisible slice.
- `createToastApi`: type helpers set `type`; `promise` transitions
  loading→success and loading→error (with fake resolved/rejected promises).
- Web `<Toaster>` (jsdom/RTL): renders toasts, auto-dismiss timer fires
  `dismiss`, action button invokes callback, `aria-live` present.

## Files (for the plan)

**New:** `packages/store/src/toast.ts` (+ test); `packages/ui` toast
presentational component (+ test); `apps/web/lib/toast.ts`,
`apps/web/app/toaster.tsx` (+ mount in `providers.tsx`).

**Changed:** `packages/store/src/index.ts` (export toast);
`packages/api` `makeQueryClient` `onError` already added in the telemetry spec —
app wires it to `toast.error`; `docs/adr/0027-*.md`, `docs/adr/README.md`,
`ARCHITECTURE.md`.

**Deferred:** `apps/mobile/components/toaster.tsx` (mobile render).
