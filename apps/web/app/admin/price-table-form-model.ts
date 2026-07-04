/**
 * The `/admin` price-table form's data model (CAR-15): turns the structured
 * component ROWS the user edits into the engine `PriceTable`/`CostTable` bodies
 * (`@repo/validators` mirrors), and back — so a bulk-JSON paste can hydrate the
 * rows and the rows can serialize back to JSON (the raw-JSON escape hatch stays
 * in sync with the structured form, never a second source of truth).
 *
 * A price table's `components` is a flat `Record<code, unitPrice>` (CORE_SPEC
 * §4 `PriceLayer`) — the row model pairs each catalog component code with its
 * SELL price and its (optional) COST, one row per code, so a vendor edits
 * margin per-line instead of maintaining two parallel JSON blobs by hand. An
 * empty price/cost string means "this code is absent from that layer" — the
 * cost layer as a whole stays fully optional (`hasCost`), matching
 * `publishPriceTableSchema`'s `cost?: CostTableData`.
 *
 * Pure, DOM-free, no i18n — the schema (`price-table-form-schema.ts`) supplies
 * translated messages; this module only maps data.
 */
import { z } from "zod";

import {
  costTableDataSchema,
  priceTableDataSchema,
  type CostTableData,
  type PriceTableCurrency,
  type PriceTableData,
  type PublishPriceTableInput,
} from "@repo/validators";

export interface ComponentRowValues {
  code: string;
  /** "" = this code has no sell price (absent from `table.components`). */
  price: string;
  /** "" = this code has no cost (absent from `cost.components`). */
  cost: string;
}

export function blankComponentRow(): ComponentRowValues {
  return { code: "", price: "", cost: "" };
}

export interface PriceTableFormValues {
  currency: PriceTableCurrency;
  /** `datetime-local` input value. */
  effectiveFrom: string;
  /** `datetime-local` input value; "" = open-ended. */
  effectiveTo: string;
  /** Decimal string; "" = no floor. */
  marginFloorPct: string;
  /** Decimal string (percent). */
  dphRate: string;
  roundingMode: "half-up" | "half-even";
  roundingGranularity: "per-line" | "end-of-invoice";
  /** Integer string — the price table's own version (I3 stamp). */
  version: string;
  components: ComponentRowValues[];
  manufacturingRate: string;
  manufacturingMultiplier: string;
  installation: string;
  /** Whether a cost layer is published alongside the sell table at all. */
  hasCost: boolean;
  costManufacturingRate: string;
  costManufacturingMultiplier: string;
  costInstallation: string;
}

export const DEFAULT_PRICE_TABLE_FORM_VALUES: PriceTableFormValues = {
  currency: "CZK",
  effectiveFrom: "",
  effectiveTo: "",
  marginFloorPct: "",
  dphRate: "21",
  roundingMode: "half-up",
  roundingGranularity: "end-of-invoice",
  version: "1",
  components: [],
  manufacturingRate: "",
  manufacturingMultiplier: "",
  installation: "",
  hasCost: false,
  costManufacturingRate: "0",
  costManufacturingMultiplier: "0",
  costInstallation: "0",
};

/** Union of the codes present in either layer, sorted for a stable row order
 *  (`Object.fromEntries` on the way back doesn't care about order, but a stable
 *  render order keeps the UI from reshuffling rows on every hydrate). */
function componentCodesOf(table: PriceTableData, cost: CostTableData | null): string[] {
  const codes = new Set<string>(Object.keys(table.components));
  if (cost) for (const code of Object.keys(cost.components)) codes.add(code);
  return [...codes].sort();
}

/** Build the row list from a price table (+ optional cost table) — the initial
 *  hydrate from a bulk-JSON paste or (later) a loaded price table. */
export function componentRowsFromLayers(
  table: PriceTableData,
  cost: CostTableData | null,
): ComponentRowValues[] {
  return componentCodesOf(table, cost).map((code) => ({
    code,
    price: table.components[code] !== undefined ? String(table.components[code]) : "",
    cost: cost && cost.components[code] !== undefined ? String(cost.components[code]) : "",
  }));
}

/** Rows with a non-empty code, trimmed — the only rows that survive to the
 *  payload (a code-less row is a not-yet-filled-in draft row, not an error). */
function namedRows(rows: ComponentRowValues[]): { code: string; row: ComponentRowValues }[] {
  return rows
    .map((row) => ({ code: row.code.trim(), row }))
    .filter((entry): entry is { code: string; row: ComponentRowValues } => entry.code !== "");
}

function priceComponentsFromRows(rows: ComponentRowValues[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { code, row } of namedRows(rows)) {
    if (row.price.trim() === "") continue;
    out[code] = Number(row.price);
  }
  return out;
}

function costComponentsFromRows(rows: ComponentRowValues[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { code, row } of namedRows(rows)) {
    if (row.cost.trim() === "") continue;
    out[code] = Number(row.cost);
  }
  return out;
}

/** Component codes that appear (trimmed, non-empty) on more than one row — the
 *  row→map fold would otherwise silently let the last one win. */
export function findDuplicateComponentCodes(rows: ComponentRowValues[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { code } of namedRows(rows)) {
    if (seen.has(code)) dupes.add(code);
    seen.add(code);
  }
  return [...dupes].sort();
}

type TableValues = Pick<
  PriceTableFormValues,
  "version" | "components" | "manufacturingRate" | "manufacturingMultiplier" | "installation"
>;

export function buildPriceTableData(values: TableValues): PriceTableData {
  return {
    version: Number(values.version),
    components: priceComponentsFromRows(values.components),
    manufacturing: {
      rate: Number(values.manufacturingRate),
      multiplier: Number(values.manufacturingMultiplier),
    },
    installation: Number(values.installation),
  };
}

type CostValues = Pick<
  PriceTableFormValues,
  "components" | "costManufacturingRate" | "costManufacturingMultiplier" | "costInstallation"
>;

export function buildCostTableData(values: CostValues): CostTableData {
  return {
    components: costComponentsFromRows(values.components),
    manufacturing: {
      rate: Number(values.costManufacturingRate),
      multiplier: Number(values.costManufacturingMultiplier),
    },
    installation: Number(values.costInstallation),
  };
}

/** The full publish payload — metadata fields pass through as-is; `table`/
 *  `cost` are built from the structured rows (never JSON.parse'd). */
export function buildPublishPayload(values: PriceTableFormValues): PublishPriceTableInput {
  const effectiveFromIso = new Date(values.effectiveFrom).toISOString();
  const effectiveToIso = values.effectiveTo.trim()
    ? new Date(values.effectiveTo).toISOString()
    : null;
  return {
    currency: values.currency,
    effectiveFrom: effectiveFromIso,
    effectiveTo: effectiveToIso,
    marginFloorPct: values.marginFloorPct.trim() || undefined,
    dphRate: values.dphRate,
    roundingPolicy: {
      scale: 2,
      mode: values.roundingMode,
      granularity: values.roundingGranularity,
    },
    table: buildPriceTableData(values),
    cost: values.hasCost ? buildCostTableData(values) : undefined,
  };
}

// --- The bulk-JSON island -----------------------------------------------

/** What the bulk-JSON island holds — the same `table`/`cost` shape the publish
 *  payload carries, so a paste is literally "the table/cost half of the form".
 *  Reuses the SAME schemas the server validates against (no drift). */
const islandSchema = z.object({
  table: priceTableDataSchema,
  cost: costTableDataSchema.optional(),
});
export type IslandPayload = z.infer<typeof islandSchema>;

/** Parse + validate a bulk-JSON paste. Throws (`SyntaxError` from a bad
 *  `JSON.parse`, `ZodError` from a shape mismatch) — the caller turns either
 *  into a field-level message, never lets it escape to the user raw. */
export function parseIslandJson(text: string): IslandPayload {
  return islandSchema.parse(JSON.parse(text));
}

/** The island's live mirror of the current structured form state — so the
 *  textarea is always a faithful export of what Publish would send, even
 *  before the user ever touches it. */
export function serializeIsland(values: PriceTableFormValues): string {
  const table = buildPriceTableData(values);
  const cost = values.hasCost ? buildCostTableData(values) : undefined;
  return JSON.stringify(cost ? { table, cost } : { table }, null, 2);
}

/** The structured-field patch a successful island parse hydrates onto the
 *  form (via `setValue`) — everything the `table`/`cost` bodies touch. */
export interface IslandHydration {
  version: string;
  components: ComponentRowValues[];
  manufacturingRate: string;
  manufacturingMultiplier: string;
  installation: string;
  hasCost: boolean;
  costManufacturingRate: string;
  costManufacturingMultiplier: string;
  costInstallation: string;
}

export function hydrateFromIsland(payload: IslandPayload): IslandHydration {
  const cost = payload.cost ?? null;
  return {
    version: String(payload.table.version),
    components: componentRowsFromLayers(payload.table, cost),
    manufacturingRate: String(payload.table.manufacturing.rate),
    manufacturingMultiplier: String(payload.table.manufacturing.multiplier),
    installation: String(payload.table.installation),
    hasCost: cost !== null,
    costManufacturingRate: cost ? String(cost.manufacturing.rate) : "0",
    costManufacturingMultiplier: cost ? String(cost.manufacturing.multiplier) : "0",
    costInstallation: cost ? String(cost.installation) : "0",
  };
}
