# @repo/store

Client UI state for domain-less app-shell concerns: Zustand store factories for theme and the toast/notification queue, with platform persistence/render injected per app (ADR 0010 / 0027).

## Exports

Barrel (`@repo/store`):

Theme (`src/theme.ts`):

- `createThemeStore(storage)` — vanilla Zustand store bound to a `ThemeStorage` adapter.
- `isThemePreference` — narrow an untrusted string to a `ThemePreference`.
- `resolveScheme(theme, systemScheme)` — resolve `system` against the live OS scheme (pure).
- Types: `ThemePreference`, `ColorScheme`, `ThemeStorage`, `ThemeState`.

Toast (`src/toast.ts`):

- `createToastStore({ maxVisible? })` — pure, timer-free notification queue (counter-assigned ids, `key` dedup, overflow).
- `createToastApi(store)` — ergonomic surface (`success` / `error` / `info` / `warning` / `promise` / `dismiss`).
- `DEFAULT_MAX_VISIBLE` — default simultaneously-shown toasts.
- Types: `ToastType`, `ToastAction`, `Toast`, `ToastInput`, `ToastState`, `ToastApi`.

This package owns no DOM/native globals (no storage, no timers) — adapters and the render/timer layer live in the apps.

## Usage

App-scoped stores with injected persistence (mirrors `apps/web/lib/theme.ts` + `apps/web/lib/toast.ts`):

```ts
import { createThemeStore, createToastApi, createToastStore, type ThemeStorage } from "@repo/store";

const webThemeStorage: ThemeStorage = {
  get: () => /* read localStorage, validated */ null,
  set: (value) => window.localStorage.setItem("theme", value),
};
export const themeStore = createThemeStore(webThemeStorage);

export const toastStore = createToastStore();
export const toast = createToastApi(toastStore); // toast.success(...), used even from makeQueryClient onError
```

Consume with `useStore` from `zustand`; the app's `<Toaster>` owns the auto-dismiss timers.

## Decisions

- [ADR 0010](../../docs/adr/0010-ui-state-zustand-store-package.md) — UI state via Zustand in `@repo/store`; theme as the first store; effects are the app's concern.
- [ADR 0027](../../docs/adr/0027-toast-notification-store.md) — toast/notification queue as the second store (pure queue; custom `@repo/ui` Toaster).
- [ADR 0015](../../docs/adr/0015-mobile-storage-asyncstorage-over-mmkv.md) — mobile theme persistence backs `ThemeStorage` with AsyncStorage (Expo Go-compatible).
