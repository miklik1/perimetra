"use client";

import { useTranslations } from "@repo/i18n/web";
import { cn, Panel } from "@repo/ui";

import { finishById, FINISHES, useFinish } from "./scene/finish";

/**
 * The finish / colour swatch row (ADR 0075) — the Bombardier "Stripe Colour"
 * control, but every pick recolours the LIVE mesh synchronously (no raster, no
 * spinner). Writes the `useFinish` slice the scene renderer reads. Presentation
 * only: the finish is a cosmetic choice the release does not model, so it never
 * touches the engine derivation. Soft-geometry circular swatches (the brand
 * control vocabulary); the RAL caveat is mandatory (Direction §7). This panel is
 * lifted into the wizard's "Barva a povrch" step in the camera/wizard slice.
 */
export function FinishPicker() {
  const t = useTranslations("configurator");
  const finishId = useFinish((s) => s.finishId);
  const setFinish = useFinish((s) => s.setFinish);
  const selected = finishById(finishId);

  return (
    <Panel className="flex flex-col gap-3 text-sm">
      <h2 className="font-semibold">{t("finishTitle")}</h2>
      <div role="radiogroup" aria-label={t("finishTitle")} className="flex flex-wrap gap-2">
        {FINISHES.map((f) => {
          const active = f.id === finishId;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={f.label}
              title={f.ral ? `${f.label} · ${f.ral}` : f.label}
              onClick={() => setFinish(f.id)}
              style={{ backgroundColor: f.swatch }}
              className={cn(
                "border-border/60 size-9 rounded-full border outline-none transition-transform",
                "focus-visible:ring-copper focus-visible:ring-2",
                active
                  ? "ring-copper ring-offset-chrome scale-105 ring-2 ring-offset-2"
                  : "hover:scale-105",
              )}
            />
          );
        })}
      </div>
      <p>
        <span className="font-medium">{selected.label}</span>
        {selected.ral !== undefined && (
          <span className="text-muted-foreground"> · {selected.ral}</span>
        )}
      </p>
      <p className="text-muted-foreground text-xs">{t("ralCaveat")}</p>
    </Panel>
  );
}
