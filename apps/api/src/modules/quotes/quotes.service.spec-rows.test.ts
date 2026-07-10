/**
 * `buildSpecRows` — the frozen spec sheet a workshop prints (ADR 0108).
 *
 * The load-bearing assertion is price provenance. A spec-row VALUE is resolved
 * against a scope that never contains the price layer, so a parameter whose
 * `defaultExpr` reads a `price.*` key cannot print a price-table number on the
 * price-blind traveler. It resolves to nothing and renders "—" — absence, never a
 * masked money value. `buildScope` (used for UI visibility) *does* seed the price
 * layer, which is exactly why the value scope is a separate, narrower thing.
 */
import { describe, expect, it } from "vitest";

import { type ConfigInput, type PriceLayer } from "@repo/engine";
import { expr, type ProductModelRelease } from "@repo/model";

import { buildSpecRows } from "./quotes.service.js";

const PRICES: PriceLayer = {
  components: {},
  // 790 CZK/hr — the figure that must never reach a price-blind sheet.
  manufacturing: { rate: 790, multiplier: 16 },
  installation: 0,
} as unknown as PriceLayer;

/** A release whose visible params cover each value provenance: literal default,
 *  buyer input, an option id, and a `price.*`-dependent default expression. */
function release(): ProductModelRelease {
  return {
    id: "spec-rows@1",
    modelId: "spec-rows",
    version: 1,
    status: "published",
    parameters: [
      { key: "width_mm", label: "Šířka", type: "length_mm", default: 1000 },
      { key: "height_mm", label: "Výška", type: "length_mm", default: 2000 },
      { key: "color_id", label: "Barva", type: "enum", default: "antracit" },
      // The leak vector: a visible parameter defaulting to a price-table key.
      {
        key: "manufacturing_rate_shown",
        label: "Sazba",
        type: "number",
        defaultExpr: expr("price.manufacturing_rate"),
      },
    ],
    optionSets: [
      {
        key: "color",
        selectedBy: "color_id",
        options: [
          { id: "antracit", label: "Antracit (RAL 7016)", attrs: {} },
          { id: "bila", label: "Bílá", attrs: {} },
        ],
      },
    ],
    ui: {
      steps: [
        {
          id: "main",
          groups: [
            {
              id: "dims",
              params: ["width_mm", "height_mm", "color_id", "manufacturing_rate_shown"],
            },
          ],
        },
      ],
    },
  } as unknown as ProductModelRelease;
}

describe("buildSpecRows — price provenance", () => {
  const input: ConfigInput = { height_mm: 1500, color_id: "bila" };
  const rows = buildSpecRows(release(), input, PRICES);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("values a buyer's frozen input, a literal default, and an option label", () => {
    expect(byKey.height_mm).toEqual({ key: "height_mm", label: "Výška", value: "1500 mm" });
    expect(byKey.width_mm).toEqual({ key: "width_mm", label: "Šířka", value: "1000 mm" });
    expect(byKey.color_id).toEqual({ key: "color_id", label: "Barva", value: "Bílá" });
  });

  it("never prints a price-table number for a price-dependent default", () => {
    // 790 is `price.manufacturing_rate` — a CZK/hr figure the workshop must not see.
    expect(byKey.manufacturing_rate_shown?.value).toBe("—");
    expect(JSON.stringify(rows)).not.toContain("790");
  });

  it("emits no money-shaped value anywhere on the sheet", () => {
    for (const row of rows) expect(row.value).not.toMatch(/\d+([.,]\d+)?\s*(Kč|CZK)/i);
  });
});
