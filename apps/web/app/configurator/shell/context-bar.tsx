"use client";

import * as React from "react";

import { useTranslations } from "@repo/i18n/web";
import { cn, Separator, Spinner } from "@repo/ui";

/**
 * The configurator's top chrome bar — the "where am I / is it thinking" strip
 * above the shell's step rail + canvas.
 *
 * HONEST DEGRADE (deliberate, do not "restore" from the canvas). The design
 * reference (`design/configurator/frames-v2.jsx` `contextBar()`) draws a quote
 * number, a project name, a saved-state chip, a back-to-project button and a
 * quote-preview action. The standalone `/configurator` route is bound to
 * NEITHER a project NOR a quote — none of that data exists here, and drawing it
 * would put a fabricated record on screen. So the bar renders only what is
 * TRUE at this scope: the wordmark, the active product, the catalog version
 * (release data, and the one canvas element that IS real here) and a live
 * computing indicator (CORE_SPEC §8.2's "no engine-computing indicator" gap).
 * Project binding arrives in a later phase — when it does, it composes as
 * additional parts through `<ContextBar.Trailing>` / the leading slots rather
 * than as new booleans on the root.
 *
 * Presentational and prop-driven: it owns no state and fetches nothing.
 */

const ContextBarContext = React.createContext<boolean>(false);

function useContextBarGuard(part: string): void {
  if (!React.use(ContextBarContext)) {
    throw new Error(`<ContextBar.${part}> must be rendered inside <ContextBar>.`);
  }
}

export interface ContextBarProps extends Omit<React.ComponentProps<"header">, "children"> {
  /** Label of the release currently being configured. */
  productLabel: string;
  /** Catalog version the derivation resolves components against. */
  catalogVersion: number;
  /** True while a derive is in flight — drives the polite status region. */
  computing: boolean;
  /**
   * Trailing slot, rendered after the computing indicator inside the right-hand
   * group, so the shell can add actions without growing the root's prop list.
   */
  children?: React.ReactNode;
}

/**
 * 52px chrome bar; `flex-none` because it is the fixed top row of the shell's
 * full-height flex column.
 */
function ContextBarRoot({
  productLabel,
  catalogVersion,
  computing,
  children,
  className,
  ...props
}: ContextBarProps) {
  const t = useTranslations("configurator");
  return (
    <ContextBarContext value={true}>
      <header
        data-slot="context-bar"
        aria-label={t("configuratorLabel")}
        className={cn(
          "bg-chrome border-border h-13 flex flex-none items-center gap-3.5 border-b px-4",
          className,
        )}
        {...props}
      >
        <ContextBarWordmark />
        <ContextBarProduct>{productLabel}</ContextBarProduct>
        <ContextBarTrailing>
          <ContextBarCatalogVersion value={catalogVersion} />
          <Separator orientation="vertical" className="h-6" aria-hidden />
          <ContextBarComputing active={computing} />
          {children}
        </ContextBarTrailing>
      </header>
    </ContextBarContext>
  );
}

/** The Perimetra wordmark — display face, as the shell header has always set it. */
function ContextBarWordmark({ className, ...props }: React.ComponentProps<"span">) {
  useContextBarGuard("Wordmark");
  return (
    <span
      data-slot="context-bar-wordmark"
      className={cn(
        "text-foreground font-display text-ui-xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    >
      Perimetra
    </span>
  );
}

/** The active product's label — the bar's one piece of "what am I looking at". */
function ContextBarProduct({ className, ...props }: React.ComponentProps<"span">) {
  useContextBarGuard("Product");
  return (
    <span
      data-slot="context-bar-product"
      className={cn("text-foreground text-ui-base truncate font-semibold", className)}
      {...props}
    />
  );
}

/** Right-hand group — pushed to the far edge, everything after it flows inline. */
function ContextBarTrailing({ className, ...props }: React.ComponentProps<"div">) {
  useContextBarGuard("Trailing");
  return (
    <div
      data-slot="context-bar-trailing"
      className={cn("ml-auto flex items-center gap-3.5", className)}
      {...props}
    />
  );
}

/** Catalog version, mono + muted per the canvas. */
function ContextBarCatalogVersion({
  value,
  className,
  ...props
}: { value: number } & Omit<React.ComponentProps<"span">, "children">) {
  useContextBarGuard("CatalogVersion");
  const t = useTranslations("configurator");
  return (
    <span
      data-slot="context-bar-catalog-version"
      className={cn("text-muted-foreground text-ui-xs whitespace-nowrap font-mono", className)}
      {...props}
    >
      {t("catalogVersion", { version: String(value) })}
    </span>
  );
}

/**
 * Transient derive status. Two things are load-bearing here:
 *
 * 1. ANNOUNCEMENT — the live region is always mounted and its CONTENT toggles,
 *    which is what makes a polite announcement fire (a region that mounts
 *    together with its text is unreliable across screen readers). The spinner
 *    inside is forced decorative: the kit's `Spinner` ships its own
 *    `role="status"` + hardcoded label, and a nested live region would announce
 *    a second, non-catalog string over ours.
 * 2. NO LAYOUT SHIFT — an `aria-hidden`, `invisible` ghost of the same content
 *    sits in the same grid cell and permanently reserves the slot, so the bar's
 *    trailing group does not reflow when the indicator appears or clears.
 */
function ContextBarComputing({
  active,
  className,
  ...props
}: { active: boolean } & Omit<React.ComponentProps<"span">, "children">) {
  useContextBarGuard("Computing");
  const t = useTranslations("configurator");
  const label = t("computing");
  const line = "text-muted-foreground text-ui-sm col-start-1 row-start-1 flex items-center gap-1.5";

  return (
    <span data-slot="context-bar-computing" className={cn("grid", className)} {...props}>
      <span aria-hidden className={cn(line, "invisible")}>
        <ComputingLabel>{label}</ComputingLabel>
      </span>
      <span role="status" aria-live="polite" className={line}>
        {active ? <ComputingLabel>{label}</ComputingLabel> : null}
      </span>
    </span>
  );
}

function ComputingLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Spinner className="size-3.5" role="presentation" aria-hidden aria-label={undefined} />
      <span className="whitespace-nowrap">{children}</span>
    </>
  );
}

/**
 * Compound namespace: the root already composes the parts that are true at
 * `/configurator` scope, and the parts stay reachable so a later project-bound
 * bar can compose a different set without this root growing variant props.
 */
export const ContextBar = Object.assign(ContextBarRoot, {
  Wordmark: ContextBarWordmark,
  Product: ContextBarProduct,
  Trailing: ContextBarTrailing,
  CatalogVersion: ContextBarCatalogVersion,
  Computing: ContextBarComputing,
});
