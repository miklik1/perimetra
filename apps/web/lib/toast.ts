import { createToastApi, createToastStore } from "@repo/store";

/**
 * Single app-scoped toast queue + convenience API (ADR 0027), mirroring
 * `themeStore`. Importable from anywhere — including shared modules and the
 * QueryClient `onError` hook — so any layer can fire a toast without prop
 * drilling. The store is pure/timer-free; `apps/web/app/toaster.tsx` subscribes
 * to it, renders the stack, and owns the auto-dismiss timers.
 */
export const toastStore = createToastStore();

/** Ergonomic call surface: `toast.success(...)`, `toast.error(...)`, etc. */
export const toast = createToastApi(toastStore);
