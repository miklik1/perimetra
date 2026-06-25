"use client";

import type { DerivationResult } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { Badge, Panel } from "@repo/ui";

/**
 * The deviation reason rows (ADR 0076, CORE_SPEC §6) — the human-readable mirror
 * of the 3D edge markers. Reads `DerivationResult.parts[].deviations`, the SAME
 * `PartDeviation` source the 2D drawing emits as a `DrawingFlag`, so the
 * salesperson sees every artifact-override (field, original→value, reason) on
 * one panel. Renders nothing when nothing deviates (the happy-path configurator
 * has no quote-scope overrides). Reused in the wizard Summary (ADR 0077).
 */
export function DeviationPanel({ result }: { result: DerivationResult }) {
  const t = useTranslations("configurator");
  const rows = result.parts.flatMap((part) =>
    (part.deviations ?? []).map((d) => ({ part: part.name, ...d })),
  );
  if (rows.length === 0) return null;

  return (
    <Panel className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{t("deviationsTitle")}</h2>
        <Badge tone="deviation">{rows.length}</Badge>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((d, i) => (
          <li key={`${d.overrideId}-${i}`} className="flex flex-col">
            <span>
              <span className="font-medium">{d.part}</span>
              <span className="text-muted-foreground"> · {d.field}: </span>
              {d.original !== undefined && (
                <span className="text-muted-foreground tabular-nums">{d.original} → </span>
              )}
              <span className="font-medium tabular-nums">{d.value}</span>
            </span>
            {d.reason !== undefined && (
              <span className="text-muted-foreground text-xs">{d.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
