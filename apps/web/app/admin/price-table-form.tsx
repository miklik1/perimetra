"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useWatch } from "react-hook-form";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { ArrayField } from "@repo/ui/forms/array-field";
import { DisclosureSection } from "@repo/ui/forms/disclosure-section";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { fieldInputClass, FieldShell, fieldTextareaClass } from "@repo/ui/forms/field-shell";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { PRICE_TABLE_CURRENCIES, type PriceTableCurrency } from "@repo/validators";

import { adminKeys, createAdminQueries } from "../../lib/admin-queries";
import { toast } from "../../lib/toast";
import {
  blankComponentRow,
  buildPublishPayload,
  DEFAULT_PRICE_TABLE_FORM_VALUES,
  findDuplicateComponentCodes,
  hydrateFromIsland,
  parseIslandJson,
  serializeIsland,
  type PriceTableFormValues,
} from "./price-table-form-model";
import { makePriceTableFormSchema, type Translate } from "./price-table-form-schema";

const COMPONENT_CODES_DATALIST_ID = "admin-price-component-codes";

export interface PriceTableFormProps {
  /** Catalog component codes across the org's pinned releases (ADR 0068 Phase 2
   *  `codeCandidates` precedent, degraded to a plain `<datalist>`) — powers a
   *  per-row code suggestion. Empty when no catalog is reachable; the code input
   *  degrades to a plain text field (never a hard requirement). */
  componentCodes?: string[];
}

export function PriceTableForm({ componentCodes = [] }: PriceTableFormProps) {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  // `t` is narrowed to the "admin" catalog's literal keys by next-intl; the
  // schema factory takes a plain `(key: string) => string` (ADR 0020's
  // `Translator` shape, same cast precedent as `ZodI18nBoot`). Rebuilt when the
  // locale changes so a language switch re-translates existing field errors.
  const schema = useMemo(() => makePriceTableFormSchema(t as unknown as Translate), [t]);
  const form = useZodForm(schema, { defaultValues: DEFAULT_PRICE_TABLE_FORM_VALUES });
  const { control, register, handleSubmit, setValue, formState, reset } = form;

  const hasCost = useWatch({ control, name: "hasCost" });
  const watchedValues = useWatch({ control }) as PriceTableFormValues;

  const [islandText, setIslandText] = useState("");
  const [islandDirty, setIslandDirty] = useState(false);
  const [islandError, setIslandError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // The island is a live mirror of the structured fields until the user starts
  // typing into it — then a paste + Apply is the only way it feeds back in
  // (never auto-applied, so a bad paste can't silently clobber good rows).
  useEffect(() => {
    if (islandDirty) return;
    setIslandText(serializeIsland(watchedValues));
  }, [watchedValues, islandDirty]);

  const mutation = useMutation({
    ...adminQueries.publishPriceTable(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.priceTablesList()]);
      reset(DEFAULT_PRICE_TABLE_FORM_VALUES);
      setIslandText("");
      setIslandDirty(false);
      setFormError(null);
      toast.success(t("published"));
    },
  });

  function applyIsland() {
    try {
      const hydrated = hydrateFromIsland(parseIslandJson(islandText));
      setValue("version", hydrated.version, { shouldValidate: true, shouldDirty: true });
      setValue("components", hydrated.components, { shouldValidate: true, shouldDirty: true });
      setValue("manufacturingRate", hydrated.manufacturingRate, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue("manufacturingMultiplier", hydrated.manufacturingMultiplier, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue("installation", hydrated.installation, { shouldValidate: true, shouldDirty: true });
      setValue("hasCost", hydrated.hasCost, { shouldValidate: true, shouldDirty: true });
      setValue("costManufacturingRate", hydrated.costManufacturingRate, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue("costManufacturingMultiplier", hydrated.costManufacturingMultiplier, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue("costInstallation", hydrated.costInstallation, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setIslandDirty(false);
      setIslandError(null);
    } catch {
      setIslandError(t("jsonParseError"));
    }
  }

  function onSubmit(values: PriceTableFormValues) {
    const dupes = findDuplicateComponentCodes(values.components);
    if (dupes.length > 0) {
      setFormError(t("duplicateComponentCode", { codes: dupes.join(", ") }));
      return;
    }
    setFormError(null);
    mutation.mutate({
      input: buildPublishPayload(values),
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <FieldShell label={t("currency")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={PRICE_TABLE_CURRENCIES.map((c: PriceTableCurrency) => ({ value: c }))}
                />
              )}
            />
          )}
        </FieldShell>

        <FieldShell label={t("dphRate")} error={formState.errors.dphRate?.message}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              className={fieldInputClass}
              placeholder="21"
              {...register("dphRate")}
            />
          )}
        </FieldShell>

        <FieldShell label={t("effectiveFrom")} error={formState.errors.effectiveFrom?.message}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              type="datetime-local"
              className={fieldInputClass}
              {...register("effectiveFrom")}
            />
          )}
        </FieldShell>

        <FieldShell label={t("effectiveTo")}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              type="datetime-local"
              className={fieldInputClass}
              {...register("effectiveTo")}
            />
          )}
        </FieldShell>

        <FieldShell label={t("marginFloorPct")} error={formState.errors.marginFloorPct?.message}>
          {({ fieldId }) => (
            <input
              id={fieldId}
              className={fieldInputClass}
              placeholder={t("optional")}
              {...register("marginFloorPct")}
            />
          )}
        </FieldShell>

        <FieldShell label={t("roundingMode")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name="roundingMode"
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={[{ value: "half-up" }, { value: "half-even" }]}
                />
              )}
            />
          )}
        </FieldShell>

        <FieldShell label={t("roundingGranularity")}>
          {({ fieldId }) => (
            <Controller
              control={control}
              name="roundingGranularity"
              render={({ field }) => (
                <EnumSelect
                  id={fieldId}
                  value={field.value}
                  onChange={field.onChange}
                  options={[{ value: "end-of-invoice" }, { value: "per-line" }]}
                />
              )}
            />
          )}
        </FieldShell>

        <FieldShell label={t("priceTableVersion")} error={formState.errors.version?.message}>
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register("version")} />
          )}
        </FieldShell>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("componentsSection")}</h3>
        <p className="text-muted-foreground text-xs">{t("componentsSectionHint")}</p>
        <ArrayField
          control={control}
          name="components"
          addLabel={t("addComponent")}
          emptyLabel={t("componentsEmpty")}
          reorderable={false}
          makeDefault={blankComponentRow}
        >
          {({ index }) => (
            <div className="grid grid-cols-3 gap-2">
              <FieldShell
                label={t("componentCode")}
                error={formState.errors.components?.[index]?.code?.message}
              >
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    list={COMPONENT_CODES_DATALIST_ID}
                    {...register(`components.${index}.code`)}
                  />
                )}
              </FieldShell>
              <FieldShell
                label={t("sellPrice")}
                error={formState.errors.components?.[index]?.price?.message}
              >
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    inputMode="decimal"
                    placeholder={t("optional")}
                    {...register(`components.${index}.price`)}
                  />
                )}
              </FieldShell>
              <FieldShell
                label={t("costPrice")}
                error={formState.errors.components?.[index]?.cost?.message}
              >
                {({ fieldId }) => (
                  <input
                    id={fieldId}
                    className={fieldInputClass}
                    inputMode="decimal"
                    placeholder={t("optional")}
                    {...register(`components.${index}.cost`)}
                  />
                )}
              </FieldShell>
            </div>
          )}
        </ArrayField>
        {componentCodes.length > 0 && (
          <datalist id={COMPONENT_CODES_DATALIST_ID}>
            {componentCodes.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <FieldShell
          label={t("manufacturingRate")}
          error={formState.errors.manufacturingRate?.message}
        >
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register("manufacturingRate")} />
          )}
        </FieldShell>
        <FieldShell
          label={t("manufacturingMultiplier")}
          error={formState.errors.manufacturingMultiplier?.message}
        >
          {({ fieldId }) => (
            <input
              id={fieldId}
              className={fieldInputClass}
              {...register("manufacturingMultiplier")}
            />
          )}
        </FieldShell>
        <FieldShell label={t("installation")} error={formState.errors.installation?.message}>
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register("installation")} />
          )}
        </FieldShell>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" {...register("hasCost")} />
        {t("hasCost")}
      </label>

      {hasCost && (
        <div className="grid grid-cols-3 gap-2">
          <FieldShell
            label={t("costManufacturingRate")}
            error={formState.errors.costManufacturingRate?.message}
          >
            {({ fieldId }) => (
              <input
                id={fieldId}
                className={fieldInputClass}
                {...register("costManufacturingRate")}
              />
            )}
          </FieldShell>
          <FieldShell
            label={t("costManufacturingMultiplier")}
            error={formState.errors.costManufacturingMultiplier?.message}
          >
            {({ fieldId }) => (
              <input
                id={fieldId}
                className={fieldInputClass}
                {...register("costManufacturingMultiplier")}
              />
            )}
          </FieldShell>
          <FieldShell
            label={t("costInstallation")}
            error={formState.errors.costInstallation?.message}
          >
            {({ fieldId }) => (
              <input id={fieldId} className={fieldInputClass} {...register("costInstallation")} />
            )}
          </FieldShell>
        </div>
      )}

      <DisclosureSection title={t("bulkJsonSection")}>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">{t("bulkJsonDescription")}</p>
          <textarea
            value={islandText}
            onChange={(e) => {
              setIslandText(e.target.value);
              setIslandDirty(true);
              setIslandError(null);
            }}
            rows={10}
            spellCheck={false}
            className={fieldTextareaClass}
          />
          {islandError && (
            <p className="text-destructive text-sm" role="alert">
              {islandError}
            </p>
          )}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={applyIsland}>
              {t("applyJson")}
            </Button>
          </div>
        </div>
      </DisclosureSection>

      {formError && (
        <p className="text-destructive text-sm" role="alert">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t("publishing") : t("publish")}
      </Button>

      {mutation.isError && (
        <p className="text-destructive text-sm" role="alert">
          {mutation.error instanceof Error ? mutation.error.message : t("publishError")}
        </p>
      )}

      {mutation.isSuccess && mutation.data && (
        <p className="text-sm text-green-600" role="status">
          {t("priceTablePublished", { version: String(mutation.data.version) })}
        </p>
      )}
    </form>
  );
}
