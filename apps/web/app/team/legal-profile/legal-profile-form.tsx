"use client";

import { z } from "zod";

import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Field, Input, Panel, Switch, Textarea } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { lookupIcoSchema, type LegalProfile, type UpsertLegalProfileInput } from "@repo/validators";

import { devErrorDetail, errorMessageKey } from "../../../lib/error-messages";
import { createLegalProfileQueries, legalProfileKeys } from "../../../lib/legal-profile-queries";
import { useAresLookup, useViesLookup, ViesBadge } from "../../../lib/registry-lookup";
import { toast } from "../../../lib/toast";

/**
 * Legal-profile form (ADR 0088) — the org's dodavatel identity behind every
 * nabídka. Form-local schema (all strings + the VAT-payer flag); empties map to
 * null on submit, and the server's `upsertLegalProfileSchema` is the strict gate
 * (IČO/DIČ/IBAN/bank checksums) so a bad value surfaces as a mutation error —
 * the local schema deliberately does NOT re-validate the IBAN (mod-97) itself.
 *
 * Sectioned `Panel` blocks (Identifikace / Adresa / Bankovní spojení /
 * Poznámka) on the kit `Field`/`Input`/`Textarea`/`Switch` primitives — same
 * field-for-field shape `CustomerForm` mirrors where the two entities overlap
 * (name/ico/dic/vatPayer/address), including the shared `useAresLookup` /
 * `useViesLookup` composition (ADR 0090/CAR-23).
 */
const legalProfileFormSchema = z.object({
  name: z.string().min(1),
  ico: z.string(),
  dic: z.string(),
  vatPayer: z.boolean(),
  addressLine: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  bankAccount: z.string(),
  iban: z.string(),
  registrationNote: z.string(),
});
type LegalProfileFormValues = z.infer<typeof legalProfileFormSchema>;

function toDefaults(initial: LegalProfile | null): LegalProfileFormValues {
  return {
    name: initial?.name ?? "",
    ico: initial?.ico ?? "",
    dic: initial?.dic ?? "",
    vatPayer: initial?.vatPayer ?? false,
    addressLine: initial?.addressLine ?? "",
    city: initial?.city ?? "",
    postalCode: initial?.postalCode ?? "",
    country: initial?.country ?? "CZ",
    bankAccount: initial?.bankAccount ?? "",
    iban: initial?.iban ?? "",
    registrationNote: initial?.registrationNote ?? "",
  };
}

/** Form values → API contract: trim, and map empty optional strings to null. */
function toInput(v: LegalProfileFormValues): UpsertLegalProfileInput {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: v.name.trim(),
    ico: blank(v.ico),
    dic: blank(v.dic),
    vatPayer: v.vatPayer,
    addressLine: blank(v.addressLine),
    city: blank(v.city),
    postalCode: blank(v.postalCode),
    country: v.country.trim() || "CZ",
    bankAccount: blank(v.bankAccount),
    iban: blank(v.iban),
    registrationNote: blank(v.registrationNote),
  };
}

export function LegalProfileForm({ initial }: { initial: LegalProfile | null }) {
  const t = useTranslations("legalProfile");
  const tErrors = useTranslations("errors");
  const tLookup = useTranslations("lookup");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const queries = createLegalProfileQueries(client);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useZodForm(legalProfileFormSchema, { defaultValues: toDefaults(initial) });

  const mutation = useMutation({
    ...queries.upsert(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalProfileKeys.detail() });
      toast.success(t("saved"));
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  // IČO → ARES prefill of the supplier's own identity (name + DIČ + sídlo) —
  // the shared hook (ADR 0090), same one `CustomerForm` consumes.
  const ares = useAresLookup(client, (prefill) => {
    const set = (key: keyof LegalProfileFormValues, value: string) =>
      setValue(key, value, { shouldValidate: true, shouldDirty: true });
    if (prefill.name) set("name", prefill.name);
    if (prefill.dic) set("dic", prefill.dic);
    if (prefill.addressLine) set("addressLine", prefill.addressLine);
    if (prefill.city) set("city", prefill.city);
    if (prefill.postalCode) set("postalCode", prefill.postalCode);
    set("country", prefill.country);
  });

  const icoValue = watch("ico").trim();
  const dicValue = watch("dic").trim().toUpperCase();
  const vies = useViesLookup(client, dicValue);
  const vatPayer = watch("vatPayer");

  const field = (key: Exclude<keyof LegalProfileFormValues, "vatPayer" | "registrationNote">) => (
    <Field>
      <Field.Label>{t(`fields.${key}`)}</Field.Label>
      <Field.Control>
        <Input {...register(key)} />
      </Field.Control>
    </Field>
  );

  return (
    <form
      method="post"
      onSubmit={handleSubmit((values) => mutation.mutate(toInput(values)))}
      className="flex w-full flex-col gap-6 text-sm"
      noValidate
    >
      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("sections.identity")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <Field>
            <Field.Label>{t("fields.name")}</Field.Label>
            <Field.Control>
              <Input {...register("name")} />
            </Field.Control>
            {errors.name && <Field.Error>{t("nameRequired")}</Field.Error>}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            {field("ico")}
            {field("dic")}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => ares.mutate(icoValue)}
              disabled={!lookupIcoSchema.safeParse(icoValue).success || ares.isPending}
            >
              {ares.isPending ? tLookup("aresLoading") : tLookup("aresLoad")}
            </Button>
            <ViesBadge result={vies.data} loading={vies.isFetching} />
          </div>

          <Field className="flex-row items-center justify-between gap-3">
            <Field.Label className="mb-0">{t("fields.vatPayer")}</Field.Label>
            <Field.Control>
              <Switch
                checked={vatPayer}
                onCheckedChange={(checked) => setValue("vatPayer", checked, { shouldDirty: true })}
              />
            </Field.Control>
          </Field>
        </Panel.Body>
      </Panel>

      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("sections.address")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          {field("addressLine")}
          <div className="grid grid-cols-2 gap-4">
            {field("postalCode")}
            {field("city")}
          </div>
          {field("country")}
        </Panel.Body>
      </Panel>

      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("sections.banking")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <div className="grid grid-cols-2 gap-4">
            {field("bankAccount")}
            {field("iban")}
          </div>
        </Panel.Body>
      </Panel>

      <Panel elevation="flat">
        <Panel.Header>
          <Panel.Title>{t("sections.note")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <Field>
            <Field.Label>{t("fields.registrationNote")}</Field.Label>
            <Field.Control>
              <Textarea {...register("registrationNote")} rows={4} />
            </Field.Control>
          </Field>
        </Panel.Body>
      </Panel>

      <div className="flex items-center gap-4">
        <Button type="submit" variant="copper" disabled={mutation.isPending}>
          {mutation.isPending ? t("saving") : t("save")}
        </Button>
        {mutation.isError && (
          <p className="text-destructive text-xs" role="alert">
            {tErrors(errorMessageKey(mutation.error))}
            {devErrorDetail(mutation.error) && (
              <span className="text-muted-foreground ml-1">{devErrorDetail(mutation.error)}</span>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
