"use client";

import { useEffect, useRef } from "react";
import { useStore } from "zustand";

import { useTranslations } from "@repo/i18n/web";
import { Toast, ToastViewport } from "@repo/ui";

import { toastStore } from "../lib/toast";

/**
 * Web `<Toaster>` (ADR 0027). Subscribes to the pure `toastStore` and renders
 * the visible slice. The store is deliberately timer-free (a pure state
 * machine), so the auto-dismiss `setTimeout`s live HERE — one per non-sticky
 * toast, keyed by id, cleared on unmount or when the toast leaves the queue.
 *
 * A11y: the viewport is an `aria-live="polite"` region; each toast carries
 * `role="alert"` (assertive) for the `error` variant and `role="status"`
 * otherwise, so screen readers announce errors urgently and the rest politely.
 * Mounted in `app/providers.tsx` near `ThemeEffect`.
 */

/** Fallback auto-dismiss when a toast carries no explicit `duration`. */
const DEFAULT_DURATION_MS = 5000;

export function Toaster() {
  const toasts = useStore(toastStore, (s) => s.toasts);
  const dismiss = useStore(toastStore, (s) => s.dismiss);
  const visible = toasts.slice(0, 3);

  // Track live timers by toast id so we set one timer per toast and never leak
  // (cleared when the toast is gone or the component unmounts).
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const live = new Set(visible.map((t) => t.id));

    for (const toast of visible) {
      // duration 0 / undefined = sticky (e.g. a `promise` loading toast); never
      // auto-dismiss those. Only schedule once per id.
      const sticky = toast.duration === 0;
      const ms = toast.duration ?? DEFAULT_DURATION_MS;
      if (sticky || timers.current.has(toast.id)) continue;
      timers.current.set(
        toast.id,
        setTimeout(() => {
          timers.current.delete(toast.id);
          dismiss(toast.id);
        }, ms),
      );
    }

    // Drop timers for toasts that left the queue (dismissed or updated to sticky).
    for (const [id, handle] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(handle);
        timers.current.delete(id);
      }
    }
  }, [visible, dismiss]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  const t = useTranslations("errors");

  if (visible.length === 0) return null;

  return (
    <ToastViewport>
      {visible.map((toast) => (
        <Toast
          key={toast.id}
          variant={toast.type}
          role={toast.type === "error" ? "alert" : "status"}
          title={toast.title}
          actionLabel={toast.action?.label}
          onAction={toast.action?.onAction}
          dismissLabel={t("dismiss")}
          onDismiss={() => dismiss(toast.id)}
        >
          {toast.message}
        </Toast>
      ))}
    </ToastViewport>
  );
}
