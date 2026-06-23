"use client";

import * as React from "react";

import { isForbidden, isNotFound } from "@repo/api";
import { useApiClient, useQuery } from "@repo/api/react";
import {
  type ConfigInput,
  type CostTable,
  type DerivationResult,
  type PriceTable,
} from "@repo/engine";
import { type Scope } from "@repo/model";
import { priceTableSchema } from "@repo/validators";

import { runReleasePreview, type PreviewResult } from "./release-engine";
import { type ReleaseDraftInput, type ReleaseEditorForm } from "./section-schemas";
import { useEngineWorker } from "./use-engine-worker";

const DEBOUNCE_MS = 180;

export interface ActivePrices {
  table: PriceTable;
  cost: CostTable | null;
}

/**
 * The org's active price table for the preview, fetched like the configurator
 * RSC: a 403 (price-blind, ADR 0056) or 404 (no active table) resolves to null,
 * not an error, so the preview degrades to a notice rather than throwing.
 */
export function useActivePriceTable(): ActivePrices | null {
  const client = useApiClient();
  const { data } = useQuery<ActivePrices | null>({
    queryKey: ["release-editor", "active-price-table"],
    queryFn: async () => {
      try {
        const active = await client.apiFetch("/v1/price-tables/active", {
          parse: (d) => priceTableSchema.parse(d),
        });
        if (!active) return null; // a 204 (no active table) degrades to the price-blind notice
        return {
          table: active.table as PriceTable,
          cost: (active.cost as CostTable | null) ?? null,
        };
      } catch (error) {
        if (isForbidden(error) || isNotFound(error)) return null;
        throw error;
      }
    },
  });
  return data ?? null;
}

export interface ReleasePreview {
  status: "computing" | "ok" | "no-catalog" | "no-prices" | "no-release" | "error";
  /** The derivation (BOM/totals/issues); null until a valid `ok` derive. */
  result: DerivationResult | null;
  /** Post-derivation scope — the per-formula `=value` source (4C); null unless ok+valid. */
  scope: Scope | null;
  /** A derive failure message, when status is "error". */
  message: string | null;
}

function toPreview(result: PreviewResult): ReleasePreview {
  if (result.status === "ok") {
    return { status: "ok", result: result.result, scope: result.scope, message: null };
  }
  return {
    status: result.status,
    result: null,
    scope: null,
    message: result.status === "error" ? result.message : null,
  };
}

/**
 * Live engine preview (ADR 0068 Phase 4) — derive the in-progress release on a
 * sample `input` so the author sees it produce BOM/price/Issues. Same worker
 * seam as validation (debounced, last-write-wins, synchronous fallback when no
 * Worker); the catalog + price table are cached worker-side so they are not
 * re-cloned as the sample input changes. Mounted at the editor level (4C), so
 * its derivation scope also feeds every workbench ExprField's inline `=value`;
 * the worker keeps the always-on derive off the main thread.
 */
export function useReleasePreview(
  form: ReleaseEditorForm,
  catalog: Parameters<typeof runReleasePreview>[2],
  prices: PriceTable | null,
  cost: CostTable | null,
  input: ConfigInput,
): ReleasePreview {
  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;
  const pricesRef = React.useRef(prices);
  pricesRef.current = prices;
  const costRef = React.useRef(cost);
  costRef.current = cost;
  const inputRef = React.useRef(input);
  inputRef.current = input;

  const [state, setState] = React.useState<ReleasePreview>({
    status: "computing",
    result: null,
    scope: null,
    message: null,
  });

  const tokenRef = React.useRef(0);
  const { post } = useEngineWorker((message) => {
    if (message.kind === "preview" && message.id === tokenRef.current) {
      setState(toPreview(message.result));
    }
  });

  const request = React.useCallback(
    (values: ReleaseDraftInput, sampleInput: ConfigInput) => {
      const id = (tokenRef.current += 1);
      if (!post({ kind: "preview", id, values, input: sampleInput })) {
        setState(
          toPreview(
            runReleasePreview(
              values,
              sampleInput,
              catalogRef.current,
              pricesRef.current,
              costRef.current,
            ),
          ),
        );
      }
    },
    [post],
  );

  // Cache the catalog + price table worker-side (sent only when they change, so
  // they are not re-cloned per sample-input keystroke).
  React.useEffect(() => {
    post({ kind: "catalog", catalog });
    post({ kind: "prices", prices, cost });
  }, [catalog, prices, cost, post]);

  // Derive on mount and whenever the sample input or the cached inputs change.
  // Debounced; the cache effect above runs first (declaration order) so the
  // worker already holds the catalog/prices this request derives against.
  React.useEffect(() => {
    const timer = setTimeout(() => request(form.getValues(), input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, catalog, prices, cost, form, request]);

  // Re-derive when the release definition itself changes (form edits don't touch
  // the deps above).
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => request(values as ReleaseDraftInput, inputRef.current), DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form, request]);

  return state;
}
