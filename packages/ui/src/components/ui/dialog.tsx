import { cva, type VariantProps } from "class-variance-authority";
import { Dialog as RadixDialog } from "radix-ui";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * Brand modal + side sheet on ONE radix Dialog engine (ADR 0111). Both roots share
 * the Root/Portal/Overlay machinery; only the Content differs — `DialogContent`
 * centers a chrome card, `SheetContent` anchors a full-height panel to an edge. A
 * tiny surface context lets each Content assert it sits under the matching root, so
 * a stray `<SheetContent>` in a `<Dialog>` fails loudly instead of mis-laying out.
 * No-glass depth: matte `bg-chrome` on a hairline inset ring, lifted by
 * `shadow-float` over a plain black scrim (mirrors the Popover depth model).
 */

type DialogSurface = "modal" | "sheet";

const DialogContext = React.createContext<DialogSurface | null>(null);

/** Assert a Content part sits under its matching root (modal→Dialog, sheet→Sheet). */
function useDialogSurface(part: string, expected: DialogSurface): void {
  const surface = React.use(DialogContext);
  if (surface === null) {
    throw new Error(`<${part}> must be rendered inside <Dialog> or <Sheet>.`);
  }
  if (surface !== expected) {
    throw new Error(
      `<${part}> must be rendered inside <${expected === "modal" ? "Dialog" : "Sheet"}>.`,
    );
  }
}

/** Centered modal root — radix Dialog machinery scoped to the modal surface. */
function Dialog(props: React.ComponentProps<typeof RadixDialog.Root>) {
  return (
    <DialogContext value="modal">
      <RadixDialog.Root {...props} />
    </DialogContext>
  );
}

/** Side-sheet root — same radix machinery, tagged as the sheet surface. */
function Sheet(props: React.ComponentProps<typeof RadixDialog.Root>) {
  return (
    <DialogContext value="sheet">
      <RadixDialog.Root {...props} />
    </DialogContext>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof RadixDialog.Trigger>) {
  return <RadixDialog.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof RadixDialog.Close>) {
  return <RadixDialog.Close data-slot="dialog-close" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof RadixDialog.Trigger>) {
  return <RadixDialog.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof RadixDialog.Close>) {
  return <RadixDialog.Close data-slot="sheet-close" {...props} />;
}

/** The dimming scrim shared by both surfaces — a plain black-40% dim over the page. */
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof RadixDialog.Overlay>) {
  return (
    <RadixDialog.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadixDialog.Content>) {
  useDialogSurface("DialogContent", "modal");
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        data-slot="dialog-content"
        className={cn(
          "bg-chrome text-chrome-foreground rounded-card shadow-float ring-border/60 fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 outline-none ring-1 ring-inset",
          className,
        )}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** Edge anchor per side (explicit variants, no booleans). */
const sheetVariants = cva(
  "bg-chrome text-chrome-foreground shadow-float ring-border/60 fixed z-50 overflow-y-auto p-6 outline-none ring-1 ring-inset",
  {
    variants: {
      side: {
        right: "inset-y-0 right-0 h-full w-full max-w-md",
        left: "inset-y-0 left-0 h-full w-full max-w-md",
        top: "inset-x-0 top-0 max-h-[85vh] w-full",
        bottom: "inset-x-0 bottom-0 max-h-[85vh] w-full",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof RadixDialog.Content> & VariantProps<typeof sheetVariants>) {
  useDialogSurface("SheetContent", "sheet");
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** a11y title (radix wires `aria-labelledby`) — the display-face heading of the surface. */
function DialogTitle({ className, ...props }: React.ComponentProps<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title
      data-slot="dialog-title"
      className={cn("font-display text-title", className)}
      {...props}
    />
  );
}

/** a11y description (radix wires `aria-describedby`) — muted supporting line. */
function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  sheetVariants,
};
