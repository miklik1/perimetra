"use client";

import { Controller, useWatch } from "react-hook-form";

import { useTranslations } from "@repo/i18n/web";
import { ArrayField } from "@repo/ui/forms/array-field";
import { fieldInputClass, FieldShell } from "@repo/ui/forms/field-shell";

import { blankDerived } from "../lib/draft";
import { ExprField } from "../lib/expr-field";
import type { ReleaseEditorForm } from "../lib/section-schemas";
import { EMPTY_SCOPE, type ReleaseValidation } from "../lib/use-release-validation";
import { whereDerived } from "../lib/where";

interface Props {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
}

function DerivedRow({ form, validation, index }: Props & { index: number }) {
  const t = useTranslations("releaseEditor");
  const key = (useWatch({ control: form.control, name: `derived.${index}.key` }) as string) ?? "";
  const where = whereDerived(key);
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-2">
      <FieldShell label={t("key")}>
        {({ fieldId }) => (
          <input
            id={fieldId}
            className={fieldInputClass}
            {...form.register(`derived.${index}.key`)}
          />
        )}
      </FieldShell>
      <FieldShell label={t("expression")}>
        {({ fieldId, describedById }) => (
          <Controller
            control={form.control}
            name={`derived.${index}.expr`}
            render={({ field }) => (
              <ExprField
                id={fieldId}
                describedById={describedById}
                aria-label={t("expression")}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
                scope={validation.scopes.get(where) ?? EMPTY_SCOPE}
                defect={validation.defectsByWhere.get(where)?.[0]?.message}
              />
            )}
          />
        )}
      </FieldShell>
    </div>
  );
}

export function DerivedWorkbench({ form, validation }: Props) {
  const t = useTranslations("releaseEditor");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("derivedHint")}</p>
      <ArrayField
        control={form.control}
        name="derived"
        addLabel={t("addDerived")}
        emptyLabel={t("derivedEmpty")}
        makeDefault={blankDerived}
      >
        {({ index }) => <DerivedRow form={form} validation={validation} index={index} />}
      </ArrayField>
    </div>
  );
}
