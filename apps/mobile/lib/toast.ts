import { createToastApi, createToastStore } from "@repo/store";

/**
 * The single app-scoped toast store + ergonomic API (ADR 0027), the mobile
 * mirror of web's `lib/toast.ts`. Consume the store with `useStore` (zustand)
 * in the `<Toaster>`; call `toast.success(...)` / `toast.error(...)` from
 * anywhere — components or the shared `makeQueryClient` `onError`. The store is
 * a pure, cross-platform queue from `@repo/store`; only the render
 * (`components/toaster.tsx`) is platform-specific.
 */
export const toastStore = createToastStore();

/** Imperative call surface over {@link toastStore} — one app singleton. */
export const toast = createToastApi(toastStore);
