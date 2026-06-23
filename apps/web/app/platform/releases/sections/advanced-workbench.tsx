"use client";

import { useTranslations } from "@repo/i18n/web";
import { FieldShell, fieldTextareaClass } from "@repo/ui/forms/field-shell";
import type { Path } from "react-hook-form";

import type { ReleaseDraftInput, ReleaseEditorForm } from "../lib/section-schemas";

/**
 * The not-yet-structured sections as validated raw-JSON islands — so a COMPLETE
 * release stays authorable (option sets, ports, terrain, ui). They still validate
 * live (parse errors + I2 defects appear in the dock). Parts/BOM/geometry became
 * the structured master-detail workbench in Phase 2; Phase 4 the ui builder.
 */
const ISLANDS = [
  { name: "optionSetsJson", labelKey: "optionSetsJson", rows: 5 },
  { name: "portsJson", labelKey: "portsJson", rows: 4 },
  { name: "terrainJson", labelKey: "terrainJson", rows: 3 },
  { name: "uiJson", labelKey: "uiJson", rows: 6 },
  { name: "fixturesJson", labelKey: "fixturesJson", rows: 8 },
] as const;

export function AdvancedWorkbench({ form }: { form: ReleaseEditorForm }) {
  const t = useTranslations("releaseEditor");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("advancedHint")}</p>
      {ISLANDS.map((island) => (
        <FieldShell key={island.name} label={t(island.labelKey)}>
          {({ fieldId }) => (
            <textarea
              id={fieldId}
              rows={island.rows}
              spellCheck={false}
              className={fieldTextareaClass}
              {...form.register(island.name as Path<ReleaseDraftInput>)}
            />
          )}
        </FieldShell>
      ))}
    </div>
  );
}
