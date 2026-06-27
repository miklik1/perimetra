"use client";

import { useId } from "react";
import { z } from "zod";

import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { type LegalProfile, type UpsertLegalProfileInput } from "@repo/validators";

import { devErrorDetail, errorMessageKey } from "../../../lib/error-messages";
import { createLegalProfileQueries, legalProfileKeys } from "../../../lib/legal-profile-queries";
import { toast } from "../../../lib/toast";

/**
 * Legal-profile form (ADR 0088) — the org's dodavatel identity behind every
 * nabídka. Form-local schema (all strings + the VAT-payer flag); empties map to
 * null on submit, and the server's `upsertLegalProfileSchema` is the strict gate
 * (IČO/DIČ/bank checksums) so a bad value surfaces as a mutation error.
 *
 * Render-taste (layout/grouping) is owed to Martin's eye — built functional on
 * the brand kit; the §29-ZDPH field-set itself is legal-gated (flagged ADR 0088).
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
    registrationNote: blank(v.registrationNote),
  };
}

const inputClass =
  "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 aria-invalid:border-destructive";

export function LegalProfileForm({ initial }: { initial: LegalProfile | null }) {
  const t = useTranslations("legalProfile");
  const tErrors = useTranslations("errors");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const queries = createLegalProfileQueries(client);
  const nameId = useId();
  const nameErrorId = useId();

  const {
    register,
    handleSubmit,
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

  const field = (key: Exclude<keyof LegalProfileFormValues, "vatPayer">) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${nameId}-${key}`} className="font-medium">
        {t(`fields.${key}`)}
      </label>
      <input {...register(key)} id={`${nameId}-${key}`} className={inputClass} />
    </div>
  );

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(toInput(values)))}
      className="border-border flex w-full max-w-2xl flex-col gap-4 rounded-md border p-6 text-sm"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="font-medium">
          {t("fields.name")}
        </label>
        <input
          {...register("name")}
          id={nameId}
          className={inputClass}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrorId : undefined}
        />
        {errors.name && (
          <p id={nameErrorId} className="text-destructive text-xs">
            {t("nameRequired")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {field("ico")}
        {field("dic")}
      </div>

      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" {...register("vatPayer")} className="size-4" />
        {t("fields.vatPayer")}
      </label>

      {field("addressLine")}
      <div className="grid grid-cols-2 gap-4">
        {field("postalCode")}
        {field("city")}
      </div>
      <div className="grid grid-cols-2 gap-4">
        {field("country")}
        {field("bankAccount")}
      </div>
      {field("registrationNote")}

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
