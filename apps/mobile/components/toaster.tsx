import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeOutUp, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "zustand";

import type { Toast } from "@repo/store";

import { toastStore } from "../lib/toast";
import { Stack, Text } from "./ui";

/** Default auto-dismiss when a toast does not set its own `duration` (ms). */
const DEFAULT_DURATION = 4000;

/** Per-type accent (border) class — the visual severity cue. */
const TYPE_CLASS: Record<Toast["type"], string> = {
  success: "border-l-4 border-l-primary",
  error: "border-l-4 border-l-destructive",
  info: "border-l-4 border-l-foreground",
  warning: "border-l-4 border-l-secondary",
};

/**
 * One toast row. Owns its auto-dismiss timer — the store is a pure queue and
 * never sets timers (ADR 0027): the render layer schedules `dismiss`. A
 * `duration` of `0`/`undefined` is sticky (e.g. the loading toast of
 * `toast.promise`), so no timer is armed. Entering/exiting use Reanimated
 * layout animations (slide in from the top, fade out) — the spec's "RN +
 * Reanimated slide/fade".
 */
function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useStore(toastStore, (s) => s.dismiss);

  useEffect(() => {
    // `duration: 0` is sticky (e.g. toast.promise's loading row); `undefined`
    // takes the default. Only arm a timer for a positive duration.
    const ms = toast.duration ?? DEFAULT_DURATION;
    if (ms <= 0) return;
    const handle = setTimeout(() => dismiss(toast.id), ms);
    return () => clearTimeout(handle);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <Animated.View
      entering={SlideInUp}
      exiting={FadeOutUp}
      // RN a11y mirror of the web Toaster's aria-live roles (ADR 0027):
      // `accessibilityLiveRegion` is the RN equivalent of `aria-live`
      // (assertive for errors, polite otherwise); the `alert` role marks errors
      // as urgent (RN has no `status` role — the live region carries the rest).
      accessibilityRole={toast.type === "error" ? "alert" : undefined}
      accessibilityLiveRegion={toast.type === "error" ? "assertive" : "polite"}
      className={`bg-background border-border rounded-md border px-4 py-3 shadow ${TYPE_CLASS[toast.type]}`}
    >
      <Pressable onPress={() => dismiss(toast.id)}>
        <Stack gap={1}>
          {toast.title ? <Text variant="heading">{toast.title}</Text> : null}
          <Text>{toast.message}</Text>
          {toast.action ? (
            <Pressable
              onPress={() => {
                toast.action?.onAction();
                dismiss(toast.id);
              }}
            >
              <Text variant="caption" className="text-primary">
                {toast.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Stack>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Mobile `<Toaster>` (ADR 0027) — the RN render of the cross-platform toast
 * queue, mounted once in the root layout (like `ThemeEffect`). Reads the
 * `visible()` slice (the store caps overflow), is safe-area aware (top inset so
 * toasts clear the notch/status bar), and pins to the top via an absolute
 * overlay that does not intercept touches outside the toasts (`pointerEvents`
 * is driven by each row being its own `Pressable`). Timers live in `ToastRow`,
 * not the store.
 */
export function Toaster() {
  const insets = useSafeAreaInsets();
  const toasts = useStore(toastStore, (s) => s.toasts);
  const visible = toasts.slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: insets.top + 8, left: 0, right: 0 }}
      className="px-4"
    >
      <Stack gap={2}>
        {visible.map((toast) => (
          <ToastRow key={toast.id} toast={toast} />
        ))}
      </Stack>
    </View>
  );
}
