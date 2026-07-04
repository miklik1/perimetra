/**
 * The `/admin` price-table form's RHF schema (CAR-15). STRUCTURAL + field-level
 * validation only — deep semantics (component-code uniqueness, the JSON island's
 * shape) stay in `price-table-form-model.ts`. Messages are baked in at schema
 * construction time via a translator so `formState.errors` renders localized
 * copy directly (no generic zod fallback strings reaching the user).
 */
import { z } from "zod";

import { priceTableCurrencySchema } from "@repo/validators";

const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;
const NON_NEGATIVE_INT = /^\d+$/;

export type Translate = (key: string) => string;

function requiredDecimalString(t: Translate) {
  return z
    .string()
    .trim()
    .min(1, t("fieldRequired"))
    .regex(NON_NEGATIVE_DECIMAL, t("invalidNumber"));
}

function optionalDecimalString(t: Translate) {
  return z
    .string()
    .trim()
    .refine((v) => v === "" || NON_NEGATIVE_DECIMAL.test(v), { message: t("invalidNumber") });
}

function requiredIntString(t: Translate) {
  return z.string().trim().min(1, t("fieldRequired")).regex(NON_NEGATIVE_INT, t("invalidNumber"));
}

const componentRowSchema = (t: Translate) =>
  z.object({
    code: z.string().trim().min(1, t("fieldRequired")),
    price: optionalDecimalString(t),
    cost: optionalDecimalString(t),
  });

/** Built per-render from the live translator (`useMemo`d by the caller) so
 *  every message is in the active locale — the schema itself carries no
 *  hardcoded copy. */
export function makePriceTableFormSchema(t: Translate) {
  return z.object({
    currency: priceTableCurrencySchema,
    effectiveFrom: z.string().trim().min(1, t("effectiveFromRequired")),
    effectiveTo: z.string(),
    marginFloorPct: optionalDecimalString(t),
    dphRate: z
      .string()
      .trim()
      .min(1, t("dphRateRequired"))
      .regex(NON_NEGATIVE_DECIMAL, t("invalidNumber")),
    roundingMode: z.enum(["half-up", "half-even"]),
    roundingGranularity: z.enum(["per-line", "end-of-invoice"]),
    version: requiredIntString(t),
    components: z.array(componentRowSchema(t)),
    manufacturingRate: requiredDecimalString(t),
    manufacturingMultiplier: requiredDecimalString(t),
    installation: requiredDecimalString(t),
    hasCost: z.boolean(),
    costManufacturingRate: requiredDecimalString(t),
    costManufacturingMultiplier: requiredDecimalString(t),
    costInstallation: requiredDecimalString(t),
  });
}
