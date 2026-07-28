"use client";

import type { DerivationResult } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Icon, IconButton } from "@repo/ui";

import { formatMoney } from "../../lib/format-money";
import { marginPct } from "../../lib/margin";
import { useManipulation } from "./scene/manipulation";

/**
 * The app-land chrome that floats over the edge-to-edge scene in immersive mode
 * (ADR 0116, `design/configurator/frames-v2.jsx` `FrameImmersive`). Three
 * floating cards: a collapsed step trigger (label + step-of-N + prev/next), a
 * "Nastavení" trigger that leaves immersive to reach the full form, and a minimal
 * commercial chip.
 *
 * What is deliberately NOT here (ADR 0116 §4, unchanged from the banded surface):
 * the commercial chip carries no CTA — saving lives on the Souhrn step and an
 * unbound `/configurator` has no quote to create — and it is ABSENT, not masked,
 * for a price-blind session (ADR 0056). The in-scene dimension editing (handles,
 * pills) is the direct-manipulation path; non-dimension parameters are edited in
 * the form, which "Nastavení" returns to.
 */
export function ImmersiveChrome({
  stepLabel,
  current,
  total,
  onPrev,
  onNext,
  result,
  canSeeCost,
  priceBlind,
}: {
  stepLabel: string;
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  result: DerivationResult | null;
  canSeeCost: boolean;
  priceBlind: boolean;
}): React.JSX.Element {
  const t = useTranslations("configurator");
  const setImmersive = useManipulation((s) => s.setImmersive);

  return (
    <>
      {/* Collapsed step trigger — top-left, below the scene HUD chip. */}
      <div className="absolute top-[70px] left-4 flex items-center gap-2.5 rounded-control bg-chrome py-2 pr-2.5 pl-3 shadow-float">
        <span className="grid size-6 place-items-center rounded-full bg-copper font-data text-[12px] font-semibold text-copper-foreground">
          {current}
        </span>
        <div className="leading-tight">
          <div className="text-ui-sm font-semibold">{stepLabel}</div>
          <div className="text-[11px] text-muted-foreground">
            {t("stepOfShort", { current: String(current), total: String(total) })}
          </div>
        </div>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        {/* `aria-disabled` + guarded handlers, NOT native `disabled` (the guard
            lives in onPrev/onNext). A native disabled attribute on the focused
            control at a flow boundary drops focus to <body> — the same trap the
            banded Back/Next were rewritten to avoid. */}
        <IconButton
          size="sm"
          aria-label={t("back")}
          aria-disabled={current <= 1}
          onClick={onPrev}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:size-11"
        >
          <span className="inline-flex rotate-180">
            <Icon name="chevron" size={14} />
          </span>
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t("next")}
          aria-disabled={current >= total}
          onClick={onNext}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50 pointer-coarse:size-11"
        >
          <Icon name="chevron" size={14} />
        </IconButton>
      </div>

      {/* "Nastavení" — leaves immersive for the full form (right edge). */}
      <button
        type="button"
        onClick={() => setImmersive(false)}
        className="absolute top-1/2 right-4 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-control bg-chrome px-2 py-3 shadow-float outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="[transform:rotate(180deg)] text-ui-xs font-semibold [writing-mode:vertical-rl]">
          {t("settings")}
        </span>
        <span className="inline-flex rotate-180 text-muted-foreground">
          <Icon name="chevron" size={15} />
        </span>
      </button>

      {/* Minimal commercial chip — bottom-centre; absent when price-blind. */}
      {!priceBlind && result !== null && <CommercialChip result={result} canSeeCost={canSeeCost} />}
    </>
  );
}

/** Price · margin · validity, in one floating chip. Mirrors the banded
 *  `CommerceBar` semantics (ADR 0116) — no CTA, margin only when allowed. */
function CommercialChip({
  result,
  canSeeCost,
}: {
  result: DerivationResult;
  canSeeCost: boolean;
}): React.JSX.Element {
  const t = useTranslations("configurator");
  const locale = useLocale();
  const margin =
    canSeeCost && result.isValid && result.costMoney !== undefined
      ? marginPct(result.money, result.costMoney)
      : null;

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-control bg-chrome py-2.5 pr-3 pl-4 shadow-float">
      <div className="flex flex-col leading-tight">
        <span className="text-[10.5px] text-muted-foreground">
          {t("priceExVat")}
          {margin !== null && Number.isFinite(margin)
            ? ` · ${t("marginWithPct", { pct: String(Math.round(margin)) })}`
            : ""}
        </span>
        <span className="font-data text-ui-lg font-semibold tabular-nums">
          {result.isValid ? formatMoney(result.money.total, locale) : t("priceBlocked")}
        </span>
      </div>
      <span
        className={
          result.isValid
            ? "inline-flex items-center gap-1.5 text-ui-xs text-success"
            : "inline-flex items-center gap-1.5 text-ui-xs text-destructive"
        }
      >
        <Icon name={result.isValid ? "check" : "warn"} size={14} />
        {result.isValid ? t("configValidShort") : t("priceBlockedNote")}
      </span>
    </div>
  );
}
