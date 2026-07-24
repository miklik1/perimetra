"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useWatch } from "react-hook-form";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Field, Input, Panel } from "@repo/ui";
import { ArrayField } from "@repo/ui/forms/array-field";
import { DisclosureSection } from "@repo/ui/forms/disclosure-section";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { fieldTextareaClass } from "@repo/ui/forms/field-shell";
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
      method="post"
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="flex flex-col gap-6"
    >
      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("settingsSection")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Field.Label>{t("currency")}</Field.Label>
              <Controller
                control={control}
                name="currency"
                render={({ field }) => (
                  <Field.Control>
                    <EnumSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={PRICE_TABLE_CURRENCIES.map((c: PriceTableCurrency) => ({
                        value: c,
                      }))}
                    />
                  </Field.Control>
                )}
              />
            </Field>

            <Field>
              <Field.Label>{t("dphRate")}</Field.Label>
              <Field.Control>
                <Input placeholder="21" {...register("dphRate")} />
              </Field.Control>
              {formState.errors.dphRate && (
                <Field.Error>{formState.errors.dphRate.message}</Field.Error>
              )}
            </Field>

            <Field>
              <Field.Label>{t("effectiveFrom")}</Field.Label>
              <Field.Control>
                <Input type="datetime-local" {...register("effectiveFrom")} />
              </Field.Control>
              {formState.errors.effectiveFrom && (
                <Field.Error>{formState.errors.effectiveFrom.message}</Field.Error>
              )}
            </Field>

            <Field>
              <Field.Label>{t("effectiveTo")}</Field.Label>
              <Field.Control>
                <Input type="datetime-local" {...register("effectiveTo")} />
              </Field.Control>
            </Field>

            <Field>
              <Field.Label>{t("marginFloorPct")}</Field.Label>
              <Field.Control>
                <Input placeholder={t("optional")} {...register("marginFloorPct")} />
              </Field.Control>
              {formState.errors.marginFloorPct && (
                <Field.Error>{formState.errors.marginFloorPct.message}</Field.Error>
              )}
            </Field>

            <Field>
              <Field.Label>{t("roundingMode")}</Field.Label>
              <Controller
                control={control}
                name="roundingMode"
                render={({ field }) => (
                  <Field.Control>
                    <EnumSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={[{ value: "half-up" }, { value: "half-even" }]}
                    />
                  </Field.Control>
                )}
              />
            </Field>

            <Field>
              <Field.Label>{t("roundingGranularity")}</Field.Label>
              <Controller
                control={control}
                name="roundingGranularity"
                render={({ field }) => (
                  <Field.Control>
                    <EnumSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={[{ value: "end-of-invoice" }, { value: "per-line" }]}
                    />
                  </Field.Control>
                )}
              />
            </Field>

            <Field>
              <Field.Label>{t("priceTableVersion")}</Field.Label>
              <Field.Control>
                <Input {...register("version")} />
              </Field.Control>
              {formState.errors.version && (
                <Field.Error>{formState.errors.version.message}</Field.Error>
              )}
            </Field>
          </div>
        </Panel.Body>
      </Panel>

      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("componentsSection")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <p className="text-muted-foreground text-xs">{t("priceRulesHint")}</p>
          <ArrayField
            control={control}
            name="components"
            addLabel={t("addComponent")}
            emptyLabel={t("componentsEmpty")}
            reorderable={false}
            makeDefault={blankComponentRow}
          >
            {({ index }) => (
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                <Field>
                  <Field.Label>{t("componentCode")}</Field.Label>
                  <Field.Control>
                    <Input
                      list={COMPONENT_CODES_DATALIST_ID}
                      {...register(`components.${index}.code`)}
                    />
                  </Field.Control>
                  {formState.errors.components?.[index]?.code && (
                    <Field.Error>{formState.errors.components?.[index]?.code?.message}</Field.Error>
                  )}
                </Field>
                <Field>
                  <Field.Label>{t("sellPrice")}</Field.Label>
                  <Field.Control>
                    <Input
                      inputMode="decimal"
                      placeholder={t("optional")}
                      {...register(`components.${index}.price`)}
                    />
                  </Field.Control>
                  {formState.errors.components?.[index]?.price && (
                    <Field.Error>
                      {formState.errors.components?.[index]?.price?.message}
                    </Field.Error>
                  )}
                </Field>
                <Field>
                  <Field.Label>{t("costPrice")}</Field.Label>
                  <Field.Control>
                    <Input
                      inputMode="decimal"
                      placeholder={t("optional")}
                      {...register(`components.${index}.cost`)}
                    />
                  </Field.Control>
                  {formState.errors.components?.[index]?.cost && (
                    <Field.Error>{formState.errors.components?.[index]?.cost?.message}</Field.Error>
                  )}
                </Field>
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
        </Panel.Body>
      </Panel>

      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("manufacturingSection")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
            <Field>
              <Field.Label>{t("manufacturingRate")}</Field.Label>
              <Field.Control>
                <Input {...register("manufacturingRate")} />
              </Field.Control>
              {formState.errors.manufacturingRate && (
                <Field.Error>{formState.errors.manufacturingRate.message}</Field.Error>
              )}
            </Field>
            <Field>
              <Field.Label>{t("manufacturingMultiplier")}</Field.Label>
              <Field.Control>
                <Input {...register("manufacturingMultiplier")} />
              </Field.Control>
              {formState.errors.manufacturingMultiplier && (
                <Field.Error>{formState.errors.manufacturingMultiplier.message}</Field.Error>
              )}
            </Field>
            <Field>
              <Field.Label>{t("installation")}</Field.Label>
              <Field.Control>
                <Input {...register("installation")} />
              </Field.Control>
              {formState.errors.installation && (
                <Field.Error>{formState.errors.installation.message}</Field.Error>
              )}
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="border-border accent-copper size-4 rounded border"
              {...register("hasCost")}
            />
            {t("hasCost")}
          </label>

          {hasCost && (
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <Field.Label>{t("costManufacturingRate")}</Field.Label>
                <Field.Control>
                  <Input {...register("costManufacturingRate")} />
                </Field.Control>
                {formState.errors.costManufacturingRate && (
                  <Field.Error>{formState.errors.costManufacturingRate.message}</Field.Error>
                )}
              </Field>
              <Field>
                <Field.Label>{t("costManufacturingMultiplier")}</Field.Label>
                <Field.Control>
                  <Input {...register("costManufacturingMultiplier")} />
                </Field.Control>
                {formState.errors.costManufacturingMultiplier && (
                  <Field.Error>{formState.errors.costManufacturingMultiplier.message}</Field.Error>
                )}
              </Field>
              <Field>
                <Field.Label>{t("costInstallation")}</Field.Label>
                <Field.Control>
                  <Input {...register("costInstallation")} />
                </Field.Control>
                {formState.errors.costInstallation && (
                  <Field.Error>{formState.errors.costInstallation.message}</Field.Error>
                )}
              </Field>
            </div>
          )}
        </Panel.Body>
      </Panel>

      <DisclosureSection title={t("bulkJsonSection")}>
        <div className="flex min-w-0 flex-col gap-2">
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

      <Button type="submit" variant="copper" disabled={mutation.isPending}>
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
