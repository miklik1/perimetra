import { createStore, type StoreApi } from "zustand/vanilla";

/** The four severity variants a toast can carry. */
export type ToastType = "success" | "error" | "info" | "warning";

/** An optional action button rendered alongside the toast. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

/**
 * A queued notification. `id` is store-assigned (counter — see
 * {@link createToastStore}); everything else is caller-supplied.
 */
export interface Toast {
  /** Store-assigned, stable for the toast's lifetime. */
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  /**
   * Auto-dismiss delay in ms, read by the render layer's timer. `0` or
   * `undefined` means sticky (no auto-dismiss) — e.g. the loading toast of
   * {@link ToastApi.promise}. The store never sets timers (ADR 0027).
   */
  duration?: number;
  /** Coalesce key: `add` with an existing key updates in place (dedup). */
  key?: string;
  action?: ToastAction;
}

/** Caller-supplied shape for {@link ToastState.add} — the store assigns `id`. */
export type ToastInput = Omit<Toast, "id">;

export interface ToastState {
  /**
   * The full queue (visible + overflow), oldest first. The render layer slices
   * to `maxVisible` (or reads {@link ToastState.visible}); the store keeps all
   * so overflow promotes as visible toasts dismiss.
   */
  toasts: Toast[];
  /** Enqueue a toast and return its id. Dedups by `key` (updates in place). */
  add: (toast: ToastInput) => string;
  /** Patch a toast by id (no-op if it has already been dismissed). */
  update: (id: string, patch: Partial<Toast>) => void;
  /** Remove a toast by id (no-op if absent). */
  dismiss: (id: string) => void;
  /** Drop every toast. */
  clear: () => void;
  /** The first `maxVisible` toasts — what the render layer shows. */
  visible: () => Toast[];
}

/** Default number of simultaneously-shown toasts; overflow stays queued. */
export const DEFAULT_MAX_VISIBLE = 3;

/**
 * Build a pure, ephemeral toast queue (ADR 0027). Unlike `createThemeStore`
 * there is no `Storage` adapter — toasts are not persisted. IDs come from an
 * in-store incrementing counter (deterministic, test-friendly — no `Date.now()`
 * / `Math.random()`). Timers live in the app's `<Toaster>`, not here (the store
 * is a pure state machine; effects are the app's concern — ADR 0010). Vanilla
 * store (no React) — consume with `useStore` from `zustand`.
 */
export function createToastStore(options?: { maxVisible?: number }): StoreApi<ToastState> {
  const maxVisible = options?.maxVisible ?? DEFAULT_MAX_VISIBLE;
  let seq = 0;

  return createStore<ToastState>((set, get) => ({
    toasts: [],
    add: (toast) => {
      // Dedup: an `add` carrying a key that is already queued updates that
      // toast in place rather than pushing a duplicate (keeps its id + slot).
      if (toast.key !== undefined) {
        const existing = get().toasts.find((t) => t.key === toast.key);
        if (existing) {
          set((state) => ({
            toasts: state.toasts.map((t) =>
              t.id === existing.id ? { ...t, ...toast, id: existing.id } : t,
            ),
          }));
          return existing.id;
        }
      }
      const id = String(seq++);
      set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
      return id;
    },
    update: (id, patch) => {
      set((state) => ({
        toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch, id } : t)),
      }));
    },
    dismiss: (id) => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },
    clear: () => {
      set({ toasts: [] });
    },
    visible: () => get().toasts.slice(0, maxVisible),
  }));
}

/** The ergonomic call surface a singleton `toast` exposes (ADR 0027). */
export interface ToastApi {
  success: (message: string, opts?: Partial<ToastInput>) => string;
  error: (message: string, opts?: Partial<ToastInput>) => string;
  info: (message: string, opts?: Partial<ToastInput>) => string;
  warning: (message: string, opts?: Partial<ToastInput>) => string;
  /**
   * Track a promise: adds a sticky `loading` toast, then `update`s it to a
   * `success`/`error` toast on settle. Pure logic — the loading toast simply
   * isn't auto-dismissed (sticky) until it transitions. Re-throws so callers
   * still observe rejection.
   */
  promise: <T>(
    p: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((value: T) => string);
      error: string | ((error: unknown) => string);
    },
  ) => Promise<T>;
  dismiss: (id: string) => void;
}

/**
 * Wrap a toast store with the convenience API. The app instantiates one
 * `toastStore` + one `toast` singleton (like `themeStore`) so any shared module
 * — e.g. `makeQueryClient`'s `onError` — can import and fire toasts on both
 * platforms (ADR 0027).
 */
export function createToastApi(store: StoreApi<ToastState>): ToastApi {
  const make =
    (type: ToastType) =>
    (message: string, opts?: Partial<ToastInput>): string =>
      store.getState().add({ ...opts, type, message });

  return {
    success: make("success"),
    error: make("error"),
    info: make("info"),
    warning: make("warning"),
    promise: async (p, msgs) => {
      // Sticky loading toast (duration 0 = no auto-dismiss until it transitions).
      const id = store.getState().add({ type: "info", message: msgs.loading, duration: 0 });
      try {
        const value = await p;
        store.getState().update(id, {
          type: "success",
          message: typeof msgs.success === "function" ? msgs.success(value) : msgs.success,
          duration: undefined,
        });
        return value;
      } catch (error) {
        store.getState().update(id, {
          type: "error",
          message: typeof msgs.error === "function" ? msgs.error(error) : msgs.error,
          duration: undefined,
        });
        throw error;
      }
    },
    dismiss: (id) => {
      store.getState().dismiss(id);
    },
  };
}
