"use client";

import { useId } from "react";
import { z } from "zod";

import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { lookupIcoSchema, type CreateCustomerInput, type Customer } from "@repo/validators";

import { createCustomersQueries, customerKeys } from "../../lib/customers-queries";
import { devErrorDetail, errorMessageKey } from "../../lib/error-messages";
import { useAresLookup, useViesLookup, ViesBadge } from "../../lib/registry-lookup";
import { toast } from "../../lib/toast";

/**
 * Customer create/edit form (ADR 0082/CAR-23) — the full field set, ARES
 * prefill + VIES badge (same `useAresLookup`/`useViesLookup` composition the
 * quote issue-panel's mini create form and the supplier legal-profile form
 * use — never re-wired here). ONE component covers both modes: no `initial`
 * → POST create (used on `/customers`); an `initial` row → PATCH update (used
 * on `/customers/:id`). Archive/restore is a separate, deliberately OUTSIDE-
 * the-form action (it's a status flip, not a field edit) — see
 * `customer-detail-client.tsx`.
 *
 * Render-taste is functional-minimal (out of scope per CAR-23) — same raw-
 * input shape as `LegalProfileForm`, which this mirrors field-for-field where
 * the two entities overlap (name/ico/dic/vatPayer/address).
 */
const customerFormSchema = z.object({
  name: z.string().min(1),
  ico: z.string(),
  dic: z.string(),
  vatPayer: z.boolean(),
  email: z.string(),
  phone: z.string(),
  addressLine: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  note: z.string(),
});
type CustomerFormValues = z.infer<typeof customerFormSchema>;

function toDefaults(initial: Customer | undefined): CustomerFormValues {
  return {
    name: initial?.name ?? "",
    ico: initial?.ico ?? "",
    dic: initial?.dic ?? "",
    vatPayer: initial?.vatPayer ?? false,
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    addressLine: initial?.addressLine ?? "",
    city: initial?.city ?? "",
    postalCode: initial?.postalCode ?? "",
    country: initial?.country ?? "CZ",
    note: initial?.note ?? "",
  };
}

/** Form values → API contract: trim, and map empty optional strings to null.
 *  `CreateCustomerInput` (name required) — also valid as a partial `UpdateCustomerInput`
 *  patch, since a required field always satisfies an optional one. */
function toInput(v: CustomerFormValues): CreateCustomerInput {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: v.name.trim(),
    ico: blank(v.ico),
    dic: blank(v.dic),
    vatPayer: v.vatPayer,
    email: blank(v.email),
    phone: blank(v.phone),
    addressLine: blank(v.addressLine),
    city: blank(v.city),
    postalCode: blank(v.postalCode),
    country: v.country.trim() || "CZ",
    note: blank(v.note),
  };
}

const inputClass =
  "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 aria-invalid:border-destructive";

export function CustomerForm({
  initial,
  onSaved,
}: {
  /** Omit for create mode; pass the loaded row for edit mode. */
  initial?: Customer;
  /** Fires after a successful create OR update with the resulting row. */
  onSaved?: (customer: Customer) => void;
}) {
  const t = useTranslations("customers");
  const tErrors = useTranslations("errors");
  const tLookup = useTranslations("lookup");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const queries = createCustomersQueries(client);
  const nameId = useId();
  const nameErrorId = useId();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useZodForm(customerFormSchema, { defaultValues: toDefaults(initial) });

  const createMutation = useMutation({
    ...queries.create(),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      toast.success(t("created"));
      reset(toDefaults(undefined));
      onSaved?.(created);
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  const updateMutation = useMutation({
    ...queries.update(),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.setQueryData(customerKeys.detail(updated.id), updated);
      toast.success(t("saved"));
      onSaved?.(updated);
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  const mutation = initial ? updateMutation : createMutation;

  // IČO → ARES prefill (name + DIČ + sídlo, like the legal-profile form —
  // a customer carries the same address fields).
  const ares = useAresLookup(client, (prefill) => {
    const set = (key: keyof CustomerFormValues, value: string) =>
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

  const field = (key: Exclude<keyof CustomerFormValues, "vatPayer">) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${nameId}-${key}`} className="font-medium">
        {t(`fields.${key}`)}
      </label>
      <input {...register(key)} id={`${nameId}-${key}`} className={inputClass} />
    </div>
  );

  const onSubmit = handleSubmit((values) => {
    const input = toInput(values);
    if (initial) {
      updateMutation.mutate({ id: initial.id, input });
    } else {
      createMutation.mutate({ input, idempotencyKey: crypto.randomUUID() });
    }
  });

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="border-border flex w-full max-w-2xl flex-col gap-4 rounded-md border p-6 text-sm"
      noValidate
    >
      {!initial && <h2 className="font-semibold">{t("newCustomer")}</h2>}

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

      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" {...register("vatPayer")} className="size-4" />
        {t("fields.vatPayer")}
      </label>

      <div className="grid grid-cols-2 gap-4">
        {field("email")}
        {field("phone")}
      </div>
      {field("addressLine")}
      <div className="grid grid-cols-2 gap-4">
        {field("postalCode")}
        {field("city")}
      </div>
      {field("country")}
      {field("note")}

      <div className="flex items-center gap-4">
        <Button type="submit" variant="copper" disabled={mutation.isPending}>
          {mutation.isPending
            ? initial
              ? t("saving")
              : t("creating")
            : initial
              ? t("save")
              : t("create")}
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
