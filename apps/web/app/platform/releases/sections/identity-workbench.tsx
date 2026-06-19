"use client";

import { useTranslations } from "@repo/i18n/web";
import { FieldShell, fieldInputClass } from "@repo/ui/forms/field-shell";

import type { ReleaseEditorForm } from "../lib/section-schemas";

export function IdentityWorkbench({ form }: { form: ReleaseEditorForm }) {
  const t = useTranslations("releaseEditor");
  const { register } = form;
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
          {({ fieldId }) => (
            <input
              id={fieldId}
              type="number"
              min={0}
              className={fieldInputClass}
              {...register("catalogVersion")}
            />
          )}
        </FieldShell>
      </div>
      <p className="text-muted-foreground text-xs">{t("identityIdNote")}</p>
    </div>
  );
}
