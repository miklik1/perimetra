"use client";

import { z } from "zod";

import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Field, Input, Panel, Switch, Textarea } from "@repo/ui";
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
 * Fields are grouped into sectioned `Panel` blocks (Identifikace / Kontakt /
 * Adresa / Poznámka) on the kit `Field`/`Input`/`Textarea`/`Switch` primitives
 * — same field-for-field shape `LegalProfileForm` mirrors where the two
 * entities overlap (name/ico/dic/vatPayer/address).
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
  const vatPayer = watch("vatPayer");

  const field = (key: Exclude<keyof CustomerFormValues, "vatPayer" | "note">) => (
    <Field>
      <Field.Label>{t(`fields.${key}`)}</Field.Label>
      <Field.Control>
        <Input {...register(key)} />
      </Field.Control>
    </Field>
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
      className="flex w-full flex-col gap-6 text-sm"
      noValidate
    >
      {!initial && <h2 className="font-display text-lg font-semibold">{t("newCustomer")}</h2>}

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
          <Panel.Title>{t("sections.contact")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <div className="grid grid-cols-2 gap-4">
            {field("email")}
            {field("phone")}
          </div>
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
          <Panel.Title>{t("sections.note")}</Panel.Title>
        </Panel.Header>
        <Panel.Body>
          <Field>
            <Field.Label>{t("fields.note")}</Field.Label>
            <Field.Control>
              <Textarea {...register("note")} rows={4} />
            </Field.Control>
          </Field>
        </Panel.Body>
      </Panel>

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
