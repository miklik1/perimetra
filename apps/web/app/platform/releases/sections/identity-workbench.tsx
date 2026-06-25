"use client";

import { Controller, useWatch } from "react-hook-form";

import { useTranslations } from "@repo/i18n/web";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { fieldInputClass, FieldShell } from "@repo/ui/forms/field-shell";

import type { ReleaseEditorForm } from "../lib/section-schemas";

interface Props {
  form: ReleaseEditorForm;
  /** Published catalog versions — the operator picks one rather than typing a
   *  number (ADR 0068 Phase 2). Empty until the platform list loads. */
  versions: { id: string; version: number }[];
}

export function IdentityWorkbench({ form, versions }: Props) {
  const t = useTranslations("releaseEditor");
  const { control, register } = form;
  const current = String(useWatch({ control, name: "catalogVersion" }) ?? "");

  // The published versions, plus the current value if it is not (yet) among them
  // — so an unpublished/typed number is never silently dropped from the select.
  const options = versions.map((v) => ({
    value: String(v.version),
    label: `catalog@${v.version}`,
  }));
  if (current !== "" && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: `catalog@${current}` });
  }

  return (
    <div className="flex flex-col gap-4">
      <FieldShell label={t("modelId")} description={t("modelIdHint")}>
        {({ fieldId }) => (
          <input
            id={fieldId}
            className={fieldInputClass}
            placeholder="sliding-gate"
            {...register("modelId")}
          />
        )}
      </FieldShell>
      <div className="grid grid-cols-2 gap-3">
        <FieldShell label={t("version")}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              type="number"
              min={0}
              className={fieldInputClass}
              {...register("version")}
            />
          )}
        </FieldShell>
        <FieldShell label={t("catalogVersion")} description={t("catalogVersionHint")}>
          {({ fieldId }) =>
            versions.length > 0 ? (
              <Controller
                control={control}
                name="catalogVersion"
                render={({ field }) => (
                  <EnumSelect
                    id={fieldId}
                    value={String(field.value ?? "")}
                    onChange={(v) => field.onChange(Number(v))}
                    options={options}
                  />
                )}
              />
            ) : (
              <input
                id={fieldId}
                type="number"
                min={0}
                className={fieldInputClass}
                {...register("catalogVersion")}
              />
            )
          }
        </FieldShell>
      </div>
      <p className="text-muted-foreground text-xs">{t("identityIdNote")}</p>
    </div>
  );
}
