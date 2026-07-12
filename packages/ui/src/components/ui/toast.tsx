import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Presentational toast primitives (ADR 0027). Pure, controlled DOM — no store,
 * no timers, no state: the app's `<Toaster>` owns the queue (`@repo/store`) and
 * the auto-dismiss timers, and feeds these components props. Keeping the visual
 * shell here (shadcn idiom, like `Button`) lets web + any future surface share
 * one styled toast while the behaviour lives in the app layer.
 *
 * A11y is the caller's contract: pass `role="status"` for non-urgent variants
 * and `role="alert"` for errors (the `<Toaster>` derives this from the toast
 * type). The viewport is an `aria-live` region.
 */

const toastVariants = cva(
  "pointer-events-auto flex w-full items-start gap-3 rounded-md border p-4 text-sm shadow-lg",
  {
    variants: {
      variant: {
        success: "border-border bg-background text-foreground",
        info: "border-border bg-background text-foreground",
        warning: "border-border bg-background text-foreground",
        error: "border-destructive/50 bg-background text-foreground",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

export interface ToastProps
  extends React.ComponentProps<"div">, VariantProps<typeof toastVariants> {
  title?: string;
  /** Optional action button label; renders the button only when `onAction` is set. */
  actionLabel?: string;
  onAction?: () => void;
  /** Accessible label for the dismiss control; renders a close button when set. */
  dismissLabel?: string;
  onDismiss?: () => void;
}

export function Toast({
  className,
  variant = "info",
  title,
  children,
  actionLabel,
  onAction,
  dismissLabel,
  onDismiss,
  ...props
}: ToastProps) {
  return (
    <div
      data-slot="toast"
      data-variant={variant}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-muted-foreground break-words">{children}</div>
      </div>
      {/* `pointer-coarse:` lifts the interactive targets to the 44px WCAG 2.5.5
          floor on touch, matching `Button`'s convention; fine-pointer rendering
          is left unchanged. The dismiss button keeps `leading-none` for that
          last part: without it the button inherits the root `text-sm`
          line-height and grows 14px -> 20px on a FINE pointer, where no
          `pointer-coarse:` utility applies. */}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="text-foreground pointer-coarse:min-h-11 pointer-coarse:px-3 inline-flex shrink-0 items-center text-sm font-medium underline-offset-4 hover:underline"
        >
          {actionLabel}
        </button>
      ) : null}
      {dismissLabel && onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground pointer-coarse:size-11 inline-flex shrink-0 items-center justify-center leading-none"
        >
          {"×"}
        </button>
      ) : null}
    </div>
  );
}

/** Fixed-position container for the toast stack; an `aria-live` region. */
export function ToastViewport({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toast-viewport"
      aria-live="polite"
      aria-relevant="additions"
      className={cn(
        "pointer-events-none fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { toastVariants };
