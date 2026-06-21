"use client";

import { useTranslations } from "@repo/i18n/web";
import { ArrayField } from "@repo/ui/forms/array-field";
import { DisclosureSection } from "@repo/ui/forms/disclosure-section";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { FieldShell, fieldInputClass } from "@repo/ui/forms/field-shell";
import { Controller, useWatch } from "react-hook-form";

import { ExprField } from "../lib/expr-field";
import { blankParam } from "../lib/draft";
import {
  adjustabilityValues,
  domainKindValues,
  deviationFieldModeValues,
  paramTypeValues,
  valueModeValues,
  type ReleaseEditorForm,
} from "../lib/section-schemas";
import { EMPTY_SCOPE, type ReleaseValidation } from "../lib/use-release-validation";
import {
  whereParam,
  whereParamDefaultExpr,
  whereParamDeviation,
  whereParamDeviationBound,
  whereParamRelevance,
} from "../lib/where";

interface Props {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
}

function ParameterRow({ form, validation, index }: Props & { index: number }) {
  const t = useTranslations("releaseEditor");
  const { control, register } = form;
  const base = `parameters.${index}` as const;
  const key = (useWatch({ control, name: `${base}.key` }) as string) ?? "";
  const valueMode = useWatch({ control, name: `${base}.valueMode` });
  const domainKind = useWatch({ control, name: `${base}.domainKind` });
  const deviationMode = useWatch({ control, name: `${base}.deviationMode` });

  const scopeFor = (where: string) => validation.scopes.get(where) ?? EMPTY_SCOPE;
  const defectFor = (where: string) => validation.defectsByWhere.get(where)?.[0]?.message;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label={t("key")} error={defectFor(whereParam(key))} required>
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register(`${base}.key`)} />
          )}
        </FieldShell>
        <FieldShell label={t("label")}>
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register(`${base}.label`)} />
          )}
        </FieldShell>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FieldShell label={t("type")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name={`${base}.type`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={paramTypeValues.map((v) => ({ value: v }))}
                />
              )}
            />
          )}
        </FieldShell>
        <FieldShell label={t("adjustability")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name={`${base}.adjustability`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={adjustabilityValues.map((v) => ({ value: v }))}
                />
              )}
            />
          )}
        </FieldShell>
      </div>

      {/* default: none | literal | expr (mutual exclusion enforced structurally) */}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <FieldShell label={t("valueMode")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name={`${base}.valueMode`}
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={valueModeValues.map((v) => ({ value: v, label: t(`valueMode_${v}`) }))}
                />
              )}
            />
          )}
        </FieldShell>
        {valueMode === "literal" ? (
          <FieldShell label={t("defaultLiteral")}>
            {({ fieldId }) => (
              <input
                id={fieldId}
                className={fieldInputClass}
                {...register(`${base}.defaultLiteral`)}
              />
            )}
          </FieldShell>
        ) : null}
        {valueMode === "expr" ? (
          <FieldShell label={t("defaultExpr")}>
            {({ fieldId, describedById }) => (
              <Controller
                control={control}
                name={`${base}.defaultExpr`}
                render={({ field }) => (
                  <ExprField
                    id={fieldId}
                    describedById={describedById}
                    aria-label={t("defaultExpr")}
                    value={(field.value as string) ?? ""}
                    onChange={field.onChange}
                    scope={scopeFor(whereParamDefaultExpr(key))}
                    defect={defectFor(whereParamDefaultExpr(key))}
                  />
                )}
              />
            )}
          </FieldShell>
        ) : null}
      </div>

      <FieldShell label={t("relevance")} description={t("relevanceHint")}>
        {({ fieldId, describedById }) => (
          <Controller
            control={control}
            name={`${base}.relevance`}
            render={({ field }) => (
              <ExprField
                id={fieldId}
                describedById={describedById}
                aria-label={t("relevance")}
                placeholder={t("relevancePlaceholder")}
                value={(field.value as string) ?? ""}
                onChange={field.onChange}
                scope={scopeFor(whereParamRelevance(key))}
                defect={defectFor(whereParamRelevance(key))}
              />
            )}
          />
        )}
      </FieldShell>

      <DisclosureSection title={t("domain")}>
        <div className="flex flex-col gap-2">
          <FieldShell label={t("domainKind")}>
            {({ fieldId }) => (
              <Controller
                control={control}
                name={`${base}.domainKind`}
                render={({ field }) => (
                  <EnumSelect
                    id={fieldId}
                    value={field.value}
                    onChange={field.onChange}
                    options={domainKindValues.map((v) => ({ value: v }))}
                  />
                )}
              />
            )}
          </FieldShell>
          {domainKind === "range" ? (
            <div className="grid grid-cols-3 gap-2">
              <FieldShell label={t("min")}>
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    {...register(`${base}.domainMin`)}
                  />
                )}
              </FieldShell>
              <FieldShell label={t("max")}>
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    {...register(`${base}.domainMax`)}
                  />
                )}
              </FieldShell>
              <FieldShell label={t("step")}>
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    {...register(`${base}.domainStep`)}
                  />
                )}
              </FieldShell>
            </div>
          ) : null}
          {domainKind === "enum" ? (
            <FieldShell label={t("domainValues")} description={t("domainValuesHint")}>
              {({ fieldId }) => (
                <input
                  id={fieldId}
                  className={fieldInputClass}
                  {...register(`${base}.domainValues`)}
                />
              )}
            </FieldShell>
          ) : null}
          {domainKind === "pattern" ? (
            <FieldShell label={t("domainPattern")}>
              {({ fieldId }) => (
                <input
                  id={fieldId}
                  className={fieldInputClass}
                  {...register(`${base}.domainPattern`)}
                />
              )}
            </FieldShell>
          ) : null}
        </div>
      </DisclosureSection>

      <DisclosureSection
        title={t("deviation")}
        badge={
          defectFor(whereParamDeviation(key)) ? (
            <span className="text-destructive">!</span>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2">
          <FieldShell
            label={t("deviationMode")}
            description={t("deviationHint")}
            error={defectFor(whereParamDeviation(key))}
          >
            {({ fieldId }) => (
              <Controller
                control={control}
                name={`${base}.deviationMode`}
                render={({ field }) => (
                  <EnumSelect
                    id={fieldId}
                    value={field.value}
                    onChange={field.onChange}
                    options={deviationFieldModeValues.map((v) => ({ value: v }))}
                  />
                )}
              />
            )}
          </FieldShell>
          {deviationMode !== "none" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <FieldShell label={t("boundMin")}>
                  {({ fieldId, describedById }) => (
                    <Controller
                      control={control}
                      name={`${base}.deviationMin`}
                      render={({ field }) => (
                        <ExprField
                          id={fieldId}
                          describedById={describedById}
                          aria-label={t("boundMin")}
                          value={(field.value as string) ?? ""}
                          onChange={field.onChange}
                          scope={scopeFor(whereParamDeviationBound(key, "min"))}
                          defect={defectFor(whereParamDeviationBound(key, "min"))}
                        />
                      )}
                    />
                  )}
                </FieldShell>
                <FieldShell label={t("boundMax")}>
                  {({ fieldId, describedById }) => (
                    <Controller
                      control={control}
                      name={`${base}.deviationMax`}
                      render={({ field }) => (
                        <ExprField
                          id={fieldId}
                          describedById={describedById}
                          aria-label={t("boundMax")}
                          value={(field.value as string) ?? ""}
                          onChange={field.onChange}
                          scope={scopeFor(whereParamDeviationBound(key, "max"))}
                          defect={defectFor(whereParamDeviationBound(key, "max"))}
                        />
                      )}
                    />
                  )}
                </FieldShell>
              </div>
              <FieldShell label={t("deviationNote")}>
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    {...register(`${base}.deviationNote`)}
                  />
                )}
              </FieldShell>
            </>
          ) : null}
        </div>
      </DisclosureSection>
    </div>
  );
}

export function ParametersWorkbench({ form, validation }: Props) {
  const t = useTranslations("releaseEditor");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("parametersHint")}</p>
      <ArrayField
        control={form.control}
        name="parameters"
        addLabel={t("addParameter")}
        emptyLabel={t("parametersEmpty")}
        makeDefault={blankParam}
      >
        {({ index }) => <ParameterRow form={form} validation={validation} index={index} />}
      </ArrayField>
    </div>
  );
}
