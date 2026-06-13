"use client";

import { useId } from "react";

import { useTranslations } from "@repo/i18n/web";
import type { TerrainSegment } from "@repo/model";

/**
 * The stepped-terrain editor (CORE_SPEC §5): per-segment ground elevation in mm
 * (v1 is stepped, not a mesh). An instance "stands on" a segment via the
 * instance editor; changing a segment's elevation re-derives every instance on
 * it through the one input gate (I7) and can make a neighbouring connection's
 * top-line step exceed the model's limit — surfaced as a typed connection issue.
 */
export interface TerrainPanelProps {
  terrain: TerrainSegment[];
  onElevationChange: (segmentId: string, elevationMm: number) => void;
}

export function TerrainPanel({ terrain, onElevationChange }: TerrainPanelProps) {
  const t = useTranslations("site");
  const baseId = useId();
  if (terrain.length === 0) return null;

  return (
    <section className="border-border flex flex-col gap-2 rounded-md border p-4 text-sm">
      <h2 className="font-semibold">{t("terrain")}</h2>
      <div className="flex flex-col gap-2">
        {terrain.map((segment) => {
          const id = `${baseId}-${segment.id}`;
          return (
            <div key={segment.id} className="flex items-center gap-2">
              <label htmlFor={id} className="text-muted-foreground flex-1">
                {t("segmentElevation", { segment: segment.id })}
              </label>
              <input
                id={id}
                type="number"
                inputMode="numeric"
                value={segment.elevation_mm}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) onElevationChange(segment.id, Math.round(next));
                }}
                className="border-border bg-background w-24 rounded-md border px-2 py-1 text-right tabular-nums"
              />
              <span className="text-muted-foreground">mm</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
