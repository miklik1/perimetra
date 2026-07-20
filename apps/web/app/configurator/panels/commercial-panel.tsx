"use client";

import type { ReactNode } from "react";

import type { DerivationResult } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Alert, Icon, KeyValueList, Separator, SkeletonText, StatCard } from "@repo/ui";

import { formatMoney } from "../../../lib/format-money";
import { marginPct } from "../../../lib/margin";
import type { ConfiguratorPricing } from "../products";
import { marginBreaches, MarginFloorMeter } from "./margin-floor-meter";

/**
 * The commercial summary under the configurator's option rail (canvas
 * `commercialPanel`, design/configurator/frames-v2.jsx:238-269): the sell price,
 * and — for whoever is allowed to see them — cost, margin and the margin floor.
 *
 * INFORMATION ONLY. The canvas draws three controls here (a "Povolit odchylku"
 * approval button and the "Vytvořit nabídku" / "Uložit do projektu" CTAs) and
 * this panel ships NONE of them: there is no deviation-ledger backend to approve
 * into, and saving already lives in the Souhrn step. A control that leads nowhere
 * is worse than an absent one, so the breach banner states the CONSEQUENCE
 * ("issuing will require deviation approval") and stops there.
 *
 * ── THE THREE VISIBILITY RULES ────────────────────────────────────────────────
 * 1. `priceBlind` (ADR 0056, the workshop role): no money at ALL. Not a masked
 *    value, not a dash — the panel renders NOTHING. Absence is the rule, because
 *    a masked field still tells the reader a price exists and roughly where it
 *    sits in the layout. This is defence in depth; the server is the authority.
 * 2. `canSeeCost` (ADR 0116, admin only): the sell PRICE is for admin+sales, but
 *    cost, margin and the floor gauge are admin-only. A sales viewer gets the
 *    price card and a validity line and nothing else.
 * 3. Cost data may not EXIST: `result.costMoney` is undefined on a price table
 *    published before the cost model (ADR 0059). There is then no margin to show
 *    even for an admin — and a missing cost layer must never be rendered as a
 *    0 % margin, which reads as "we make nothing on this" rather than "we do not
 *    know". The admin view degrades to exactly the sales view.
 *
 * Rules 2 and 3 both collapse onto ONE thing — is the cost block shown — so they
 * are resolved into explicit variants (`PriceOnlyPanel` / `PriceAndCostPanel`)
 * rather than threaded through the tree as booleans.
 *
 * Composition note: the parts below are deliberately plain internal variants and
 * not an exported compound namespace. There is no consumer choice to expose —
 * WHICH block renders is decided by the viewer's role and by whether the engine
 * produced cost, never by the call site — so a `<CommercialPanel.Cost/>` slot
 * would hand callers a way to render cost to a sales user. The visibility rules
 * are only enforceable while this component owns the branch.
 */

type CommercialPanelProps = {
  /** null while the first derive is still in flight. */
  result: DerivationResult | null;
  pricing: ConfiguratorPricing;
  catalogVersion: number;
  /** ADR 0056 — the workshop role sees no money whatsoever. */
  priceBlind: boolean;
  /** ADR 0116 — cost, margin and the floor gauge are admin-only. */
  canSeeCost: boolean;
};

/**
 * How much money this viewer may see. The two booleans on the props are the
 * SERVER's two independent facts and are kept as-is on the public API; inside,
 * they collapse to one ordered vocabulary so no part of the tree can be handed a
 * contradictory pair.
 */
/**
 * Does this configuration breach the org's margin floor? One definition, shared
 * by the admin panel (which shows the figures) and the sales panel (which shows
 * only that approval will be needed) — so the two viewers can never disagree
 * about whether a configuration is clean.
 */
function breaches(result: DerivationResult, pricing: ConfiguratorPricing): boolean {
  const costMoney = result.costMoney;
  if (costMoney === undefined || pricing.marginFloorPct === null) return false;
  return marginBreaches(marginPct(result.money, costMoney), pricing.marginFloorPct);
}

type MoneyVisibility = "none" | "price" | "price-and-cost";

function moneyVisibility(priceBlind: boolean, canSeeCost: boolean): MoneyVisibility {
  if (priceBlind) return "none";
  return canSeeCost ? "price-and-cost" : "price";
}

export function CommercialPanel({
  result,
  pricing,
  catalogVersion,
  priceBlind,
  canSeeCost,
}: CommercialPanelProps) {
  const visibility = moneyVisibility(priceBlind, canSeeCost);

  // Rule 1, first and unconditionally: a price-blind viewer gets no panel in any
  // state — not a skeleton, not a blocked placeholder. Both of those are
  // money-shaped furniture for a reader who is not entitled to money.
  if (visibility === "none") return null;
  if (result === null) return <PendingPanel />;
  if (!result.isValid) return <BlockedPanel />;

  return visibility === "price-and-cost" ? (
    <PriceAndCostPanel result={result} pricing={pricing} catalogVersion={catalogVersion} />
  ) : (
    <PriceOnlyPanel
      result={result}
      catalogVersion={catalogVersion}
      // The engine computed the margin for this session regardless of role —
      // only the DISPLAY is gated — so the breach is knowable here without
      // showing a figure.
      breach={breaches(result, pricing)}
    />
  );
}

/** The canvas's 14px column rhythm, shared by every variant. */
function PanelFrame({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3.5">{children}</div>;
}

/**
 * First derive in flight. `SkeletonText` is `aria-hidden` by contract, so the
 * announcement is the CONTEXT BAR's job for the surface as a whole; this panel
 * marks itself `aria-busy` and adds no second live region of its own.
 */
function PendingPanel() {
  return (
    <PanelFrame>
      {/* `aria-busy` only — NO second status region. The context bar already
          announces "recalculating" for the surface as a whole, and this panel
          mounts its pending state at exactly the same moments (first paint and
          every product switch), so a status line here made one event announce
          twice with identical text. */}
      <div aria-busy={true} className="bg-chrome-subtle rounded-card p-4">
        <SkeletonText lines={3} widths={["45%", "70%", "35%"]} />
      </div>
    </PanelFrame>
  );
}

/**
 * I5: the configuration does not derive, so there is no price — the dashed
 * placeholder, never a zero. `role="status"` announces the transition into the
 * blocked state; the typed issues themselves are `ResultsPanel`'s job.
 */
function BlockedPanel() {
  const t = useTranslations("configurator");
  return (
    <PanelFrame>
      <div
        role="status"
        className="border-border bg-chrome-subtle rounded-card flex flex-col gap-1.5 border border-dashed p-4"
      >
        <span className="text-muted-foreground text-ui-sm inline-flex items-center gap-2">
          <Icon name="lock" size={15} />
          {t("priceExVat")}
        </span>
        <span className="font-display text-ui-4xl text-muted-foreground">{t("priceBlocked")}</span>
        <span className="text-destructive text-ui-sm">{t("priceBlockedNote")}</span>
      </div>
    </PanelFrame>
  );
}

/**
 * Sell price only — the sales viewer (rule 2), and the admin viewer whose price
 * table carries no cost layer (rule 3). The validity line is the SHORT one:
 * `configValid` reads "…· margin above floor", a claim this variant has no
 * grounds to make.
 */
function PriceOnlyPanel({
  result,
  catalogVersion,
  breach = false,
}: {
  result: DerivationResult;
  catalogVersion: number;
  /**
   * Whether the configuration breaches the org's margin floor. This viewer may
   * not see the margin, but MUST still be warned: the floor is enforced
   * server-side at `issue`, so suppressing the warning outright would let a
   * sales rep build a configuration and meet the breach only as a 422. The
   * warning is therefore margin-FREE — it states that approval is needed and
   * discloses no figure, so the ADR 0116 role split holds through the warning.
   */
  breach?: boolean;
}) {
  const t = useTranslations("configurator");
  return (
    <PanelFrame>
      <PriceCard result={result} catalogVersion={catalogVersion} />
      {breach ? (
        <Alert tone="warning">
          <Alert.Icon />
          <Alert.Description>{t("approvalRequired")}</Alert.Description>
        </Alert>
      ) : (
        <ValidityLine>{t("configValidShort")}</ValidityLine>
      )}
    </PanelFrame>
  );
}

/** Sell price + cost + margin + the floor gauge — the admin viewer (rule 2). */
function PriceAndCostPanel({
  result,
  pricing,
  catalogVersion,
}: {
  result: DerivationResult;
  pricing: ConfiguratorPricing;
  catalogVersion: number;
}) {
  const t = useTranslations("configurator");
  const locale = useLocale();
  const costMoney = result.costMoney;

  // Rule 3 — no cost layer, no margin. Degrade to the price-only view rather
  // than inventing a 0 % margin out of absent data.
  if (costMoney === undefined) {
    return <PriceOnlyPanel result={result} catalogVersion={catalogVersion} />;
  }

  const floorPct = pricing.marginFloorPct;
  const margin = marginPct(result.money, costMoney);
  const breach = breaches(result, pricing);

  return (
    <PanelFrame>
      <PriceCard result={result} catalogVersion={catalogVersion} />

      <div className="flex flex-col gap-2.5 px-0.5">
        <KeyValueList className="text-ui-sm">
          <KeyValueList.Row label={t("cost")}>
            {formatMoney(costMoney.total, locale)}
          </KeyValueList.Row>
          <KeyValueList.Row label={t("margin")}>
            {formatMoney(marginMoney(result.money.total, costMoney.total), locale)}
          </KeyValueList.Row>
        </KeyValueList>

        {floorPct !== null && (
          <>
            <Separator />
            <MarginFloorMeter marginPct={margin} floorPct={floorPct} />
          </>
        )}
      </div>

      {breach ? (
        <Alert tone="warning">
          <Alert.Icon />
          <Alert.Title>{t("marginBelowFloor")}</Alert.Title>
          <Alert.Description>{t("marginBelowFloorNote")}</Alert.Description>
        </Alert>
      ) : (
        // Only a viewer who can SEE the margin against a real floor is told the
        // margin clears it; otherwise the claim is unsupported.
        <ValidityLine>{floorPct === null ? t("configValidShort") : t("configValid")}</ValidityLine>
      )}
    </PanelFrame>
  );
}

/**
 * The hero metric. `formatMoney` owns the currency (I10 — the value of record is
 * the engine's decimal STRING and is never `Number()`d for display), which is why
 * the subtitle carries only the catalog stamp: the canvas prints "Kč · katalog
 * v2026.3" because its mock formatter emits a bare number, whereas ours already
 * renders "81 451,50 Kč". Repeating the unit here would both duplicate it and
 * hardcode CZK outside the one function allowed to know about it.
 */
function PriceCard({
  result,
  catalogVersion,
}: {
  result: DerivationResult;
  catalogVersion: number;
}) {
  const t = useTranslations("configurator");
  const locale = useLocale();
  return (
    <StatCard>
      <StatCard.Label>{t("priceExVat")}</StatCard.Label>
      <StatCard.Metric className="mt-1.5 tabular-nums">
        {formatMoney(result.money.total, locale)}
      </StatCard.Metric>
      <StatCard.Subtitle className="mt-1.5">
        {t("catalogVersion", { version: String(catalogVersion) })}
      </StatCard.Subtitle>
    </StatCard>
  );
}

function ValidityLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-success text-ui-sm inline-flex items-center gap-1.5 font-medium">
      <Icon name="check" size={14} />
      {children}
    </p>
  );
}

/**
 * Margin as MONEY (the canvas's second price row), derived for DISPLAY ONLY.
 *
 * This is the one place the panel does arithmetic across the I10 decimal-string
 * boundary, and it is the same, already-accepted precedent as `lib/margin`'s
 * percent: a float subtraction of two engine-emitted decimals, rendered and then
 * discarded. It is never persisted, never sent to the server and never compared
 * against the floor (the floor comparison runs on the percent). `toFixed(3)`
 * pins the result at `formatMoney`'s own `maximumFractionDigits`, so IEEE dust
 * (16399.999999999998) can never reach the formatter as a stray digit.
 */
function marginMoney(priceTotal: string, costTotal: string): string {
  return (Number(priceTotal) - Number(costTotal)).toFixed(3);
}
