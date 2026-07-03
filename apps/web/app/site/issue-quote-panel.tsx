"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Panel } from "@repo/ui";
import { lookupIcoSchema, type IssueQuoteInput } from "@repo/validators";

import { createCustomersQueries, customerKeys } from "../../lib/customers-queries";
import { errorMessageKey } from "../../lib/error-messages";
import { createQuotesQueries } from "../../lib/quotes-queries";
import { useAresLookup, useViesLookup, ViesBadge } from "../../lib/registry-lookup";
import { toast } from "../../lib/toast";

const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 w-full";

/**
 * Issue-a-quote affordance on the site canvas (ADR 0083) — configure → attach
 * customer → issue. The buyer's VAT status auto-fills the §92e decision
 * server-side (ADR 0080/0082); the panel only sends the customer + the
 * construction/assembly scope. On success it navigates to the frozen quote.
 */
export function IssueQuotePanel({
  projectId,
  payload,
}: {
  projectId: string;
  payload: Pick<IssueQuoteInput, "site" | "instances">;
}) {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const tLookup = useTranslations("lookup");
  const router = useRouter();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const customersQueries = createCustomersQueries(apiClient);
  const quotesQueries = createQuotesQueries(apiClient);

  const [customerId, setCustomerId] = useState("");
  const [construction, setConstruction] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [vatPayer, setVatPayer] = useState(false);

  const { data } = useInfiniteQuery(customersQueries.list());
  const customers = data?.pages.flatMap((page) => page.items) ?? [];

  const createCustomer = useMutation({
    ...customersQueries.create(),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      setCustomerId(created.id);
      setShowNew(false);
      setName("");
      setIco("");
      setDic("");
      setVatPayer(false);
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  // IČO → ARES prefill (name + DIČ). Fail-soft server-side, so a non-found
  // status is a toast, never an error; vatPayer stays the rep's explicit choice.
  const ares = useAresLookup(apiClient, (prefill) => {
    if (prefill.name) setName(prefill.name);
    if (prefill.dic) setDic(prefill.dic);
  });

  // DIČ → VIES validity badge — reactive, gated on a well-formed DIČ.
  const dicTrimmed = dic.trim().toUpperCase();
  const vies = useViesLookup(apiClient, dicTrimmed);

  const issue = useMutation({
    ...quotesQueries.issue(),
    onSuccess: (quote) => {
      toast.success(t("issue.issued"));
      router.push(`/quotes/${quote.id}`);
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  const submitNewCustomer = () => {
    if (!name.trim()) return;
    createCustomer.mutate({
      input: {
        name: name.trim(),
        ico: ico.trim() || null,
        dic: dic.trim() || null,
        vatPayer,
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const submitIssue = () => {
    issue.mutate({
      input: {
        projectId,
        site: payload.site,
        instances: payload.instances,
        ...(customerId ? { customerId } : {}),
        ...(construction ? { tax: { constructionAssembly: true } } : {}),
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Panel elevation="flat">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-base">{t("issue.title")}</h2>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("issue.customer")}
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("issue.noCustomer")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {showNew ? (
          <div className="border-border flex flex-col gap-2 rounded-md border p-3">
            <input
              className={inputClass}
              placeholder={t("issue.customerName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder={t("issue.ico")}
                value={ico}
                onChange={(e) => setIco(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder={t("issue.dic")}
                value={dic}
                onChange={(e) => setDic(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => ares.mutate(ico.trim())}
                disabled={!lookupIcoSchema.safeParse(ico.trim()).success || ares.isPending}
              >
                {ares.isPending ? tLookup("aresLoading") : tLookup("aresLoad")}
              </Button>
              <ViesBadge result={vies.data} loading={vies.isFetching} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={vatPayer}
                onChange={(e) => setVatPayer(e.target.checked)}
                className="h-4 w-4"
              />
              {t("issue.vatPayer")}
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={submitNewCustomer}
              disabled={createCustomer.isPending || !name.trim()}
            >
              {createCustomer.isPending ? t("issue.creating") : t("issue.create")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="text-copper self-start text-sm hover:underline"
          >
            + {t("issue.newCustomer")}
          </button>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={construction}
            onChange={(e) => setConstruction(e.target.checked)}
            className="h-4 w-4"
          />
          {t("issue.constructionAssembly")}
        </label>

        <Button type="button" variant="copper" onClick={submitIssue} disabled={issue.isPending}>
          {issue.isPending ? t("issue.issuing") : t("issue.button")}
        </Button>
      </div>
    </Panel>
  );
}
