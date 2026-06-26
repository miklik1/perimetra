"use client";

import { useState } from "react";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import {
  PRICE_TABLE_CURRENCIES,
  type CostTableData,
  type PriceTableCurrency,
  type PriceTableData,
} from "@repo/validators";

import { adminKeys, createAdminQueries } from "../../lib/admin-queries";
import { toast } from "../../lib/toast";

const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 w-full";
const textareaClass = `${inputClass} font-mono resize-y`;

export function PriceTableForm() {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  const [currency, setCurrency] = useState<PriceTableCurrency>("CZK");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [marginFloorPct, setMarginFloorPct] = useState("");
  const [dphRate, setDphRate] = useState("21");
  // Commercial rounding policy (ADR 0081) — provisional defaults, accountant-gated.
  const [roundingMode, setRoundingMode] = useState<"half-up" | "half-even">("half-up");
  const [roundingGranularity, setRoundingGranularity] = useState<"per-line" | "end-of-invoice">(
    "end-of-invoice",
  );
  const [tableJson, setTableJson] = useState("");
  const [costJson, setCostJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const mutation = useMutation({
    ...adminQueries.publishPriceTable(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.priceTablesList()]);
      setTableJson("");
      setCostJson("");
      toast.success(t("published"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);

    if (!effectiveFrom.trim()) {
      setParseError(t("effectiveFromRequired"));
      return;
    }
    if (!dphRate.trim()) {
      setParseError(t("dphRateRequired"));
      return;
    }

    let table: PriceTableData;
    try {
      table = JSON.parse(tableJson) as PriceTableData;
    } catch {
      setParseError(t("jsonParseError"));
      return;
    }

    let cost: CostTableData | undefined;
    if (costJson.trim()) {
      try {
        cost = JSON.parse(costJson) as CostTableData;
      } catch {
        setParseError(t("jsonParseError"));
        return;
      }
    }

    const effectiveFromIso = new Date(effectiveFrom).toISOString();
    const effectiveToIso = effectiveTo.trim() ? new Date(effectiveTo).toISOString() : null;

    mutation.mutate({
      input: {
        currency,
        effectiveFrom: effectiveFromIso,
        effectiveTo: effectiveToIso,
        marginFloorPct: marginFloorPct.trim() || undefined,
        dphRate,
        roundingPolicy: { scale: 2, mode: roundingMode, granularity: roundingGranularity },
        table,
        cost,
      },
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("currency")}
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as PriceTableCurrency)}
            className={inputClass}
          >
            {PRICE_TABLE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("dphRate")}
          <input
            type="text"
            value={dphRate}
            onChange={(e) => setDphRate(e.target.value)}
            className={inputClass}
            placeholder="21"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("effectiveFrom")}
          <input
            type="datetime-local"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("effectiveTo")}
          <input
            type="datetime-local"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("marginFloorPct")}
          <input
            type="text"
            value={marginFloorPct}
            onChange={(e) => setMarginFloorPct(e.target.value)}
            className={inputClass}
            placeholder={t("optional")}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("roundingMode")}
          <select
            value={roundingMode}
            onChange={(e) => setRoundingMode(e.target.value as "half-up" | "half-even")}
            className={inputClass}
          >
            <option value="half-up">half-up</option>
            <option value="half-even">half-even</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("roundingGranularity")}
          <select
            value={roundingGranularity}
            onChange={(e) =>
              setRoundingGranularity(e.target.value as "per-line" | "end-of-invoice")
            }
            className={inputClass}
          >
            <option value="end-of-invoice">end-of-invoice</option>
            <option value="per-line">per-line</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("priceTableJson")}
        <textarea
          value={tableJson}
          onChange={(e) => setTableJson(e.target.value)}
          rows={8}
          className={textareaClass}
          placeholder={
            '{\n  "version": 1,\n  "components": {},\n  "manufacturing": { "rate": 1, "multiplier": 1 },\n  "installation": 0\n}'
          }
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("costTableJson")}
        <textarea
          value={costJson}
          onChange={(e) => setCostJson(e.target.value)}
          rows={4}
          className={textareaClass}
          placeholder={t("optional")}
        />
      </label>

      {parseError && (
        <p className="text-destructive text-sm" role="alert">
          {parseError}
        </p>
      )}

      <Button
        type="submit"
        disabled={mutation.isPending || !tableJson.trim() || !effectiveFrom.trim()}
      >
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
