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
      <div className="bg-chrome shadow-float rounded-control absolute left-4 top-[70px] flex items-center gap-2.5 py-2 pl-3 pr-2.5">
        <span className="bg-copper text-copper-foreground font-data grid size-6 place-items-center rounded-full text-[12px] font-semibold">
          {current}
        </span>
        <div className="leading-tight">
          <div className="text-ui-sm font-semibold">{stepLabel}</div>
          <div className="text-muted-foreground text-[11px]">
            {t("stepOfShort", { current: String(current), total: String(total) })}
          </div>
        </div>
        <span className="bg-border mx-0.5 h-5 w-px" aria-hidden />
        {/* `aria-disabled` + guarded handlers, NOT native `disabled` (the guard
            lives in onPrev/onNext). A native disabled attribute on the focused
            control at a flow boundary drops focus to <body> — the same trap the
            banded Back/Next were rewritten to avoid. */}
        <IconButton
          size="sm"
          aria-label={t("back")}
          aria-disabled={current <= 1}
          onClick={onPrev}
          className="pointer-coarse:size-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
          className="pointer-coarse:size-11 aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Icon name="chevron" size={14} />
        </IconButton>
      </div>

      {/* "Nastavení" — leaves immersive for the full form (right edge). */}
      <button
        type="button"
        onClick={() => setImmersive(false)}
        className="bg-chrome shadow-float focus-visible:ring-ring rounded-control absolute right-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5 px-2 py-3 outline-none focus-visible:ring-2"
      >
        <span className="text-ui-xs font-semibold [transform:rotate(180deg)] [writing-mode:vertical-rl]">
          {t("settings")}
        </span>
        <span className="text-muted-foreground inline-flex rotate-180">
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
    <div className="bg-chrome shadow-float rounded-control absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 py-2.5 pl-4 pr-3">
      <div className="flex flex-col leading-tight">
        <span className="text-muted-foreground text-[10.5px]">
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
            ? "text-success text-ui-xs inline-flex items-center gap-1.5"
            : "text-destructive text-ui-xs inline-flex items-center gap-1.5"
        }
      >
        <Icon name={result.isValid ? "check" : "warn"} size={14} />
        {result.isValid ? t("configValidShort") : t("priceBlockedNote")}
      </span>
    </div>
  );
}
