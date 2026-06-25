"use client";

import { Controller, useWatch } from "react-hook-form";

import { useTranslations } from "@repo/i18n/web";
import { ArrayField } from "@repo/ui/forms/array-field";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { fieldInputClass, FieldShell } from "@repo/ui/forms/field-shell";

import { blankConstraint } from "../lib/draft";
import { ExprField } from "../lib/expr-field";
import {
  constraintKindValues,
  constraintScopeValues,
  severityValues,
  type ReleaseEditorForm,
} from "../lib/section-schemas";
import { EMPTY_SCOPE, type ReleaseValidation } from "../lib/use-release-validation";
import { whereConstraint } from "../lib/where";

interface Props {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
}

function ConstraintRow({ form, validation, index }: Props & { index: number }) {
  const t = useTranslations("releaseEditor");
  const key =
    (useWatch({ control: form.control, name: `constraints.${index}.key` }) as string) ?? "";
  const where = whereConstraint(key);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label={t("key")}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              className={fieldInputClass}
              {...form.register(`constraints.${index}.key`)}
            />
          )}
        </FieldShell>
        <FieldShell label={t("constraintScope")}>
          {({ fieldId }) => (
            <Controller
              control={form.control}
              name={`constraints.${index}.scope`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={constraintScopeValues.map((v) => ({ value: v }))}
                />
              )}
            />
          )}
        </FieldShell>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label={t("constraintKind")}>
          {({ fieldId }) => (
            <Controller
              control={form.control}
              name={`constraints.${index}.kind`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={constraintKindValues.map((v) => ({ value: v }))}
                />
              )}
            />
          )}
        </FieldShell>
        <FieldShell label={t("severity")}>
          {({ fieldId }) => (
            <Controller
              control={form.control}
              name={`constraints.${index}.severity`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={severityValues.map((v) => ({ value: v }))}
                />
              )}
            />
          )}
        </FieldShell>
      </div>
      <FieldShell label={t("expression")}>
        {({ fieldId, describedById }) => (
          <Controller
            control={form.control}
            name={`constraints.${index}.expr`}
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

export function ConstraintsWorkbench({ form, validation }: Props) {
  const t = useTranslations("releaseEditor");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("constraintsHint")}</p>
      <ArrayField
        control={form.control}
        name="constraints"
        addLabel={t("addConstraint")}
        emptyLabel={t("constraintsEmpty")}
        reorderable={false}
        makeDefault={blankConstraint}
      >
        {({ index }) => <ConstraintRow form={form} validation={validation} index={index} />}
      </ArrayField>
    </div>
  );
}
