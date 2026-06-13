/**
 * Step 3 proving harness (CORE_SPEC §10) — cascade + overrides + exception
 * ledger exercised on the REAL `sliding-gate@1` release against the delta-0
 * goldens. This is the FIL exception story as tests:
 *
 *   - tenant layer: FIL's price deltas apply without touching vendor data,
 *     and removing them restores delta-0 exactly (I8);
 *   - customer layer: "this client always gets steel" reproduces the steel
 *     golden 73 741.504 through the cascade, not through input;
 *   - quote layer: the mm-deviation ("client's plot is 8.05 m") passes the
 *     deviation gate WITH a reason, is flagged, and lands in the ledger;
 *   - artifact layer: "make that one cut shorter" patches one emitted part,
 *     flagged on the part, with an explicit pricing resolution;
 *   - ledger: the same deviation on three quotes surfaces as the vendor's
 *     promotion queue (ETO→CTO).
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, recurrenceReport, type CascadeLayers } from "@repo/engine";
import type { Override } from "@repo/model";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { planka_100_2d_3panel as anchor, steel_frame_3panel } from "./golden/sliding-gate.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

const ov = (patch: Partial<Override> & Pick<Override, "id" | "target" | "value">): Override => ({
  scope: "quote",
  scopeRef: "quote-1",
  author: "sales@fil",
  createdAt: "2026-06-12T00:00:00.000Z",
  ...patch,
});

const derive = (overrides: CascadeLayers, config = anchor.config, prices = anchor.prices) =>
  deriveInstance(slidingGateV1, config, prices, catalogV1, { overrides });

describe("tenant layer — FIL's price deltas (I8: layered, never mutated)", () => {
  const plankaUp = ov({
    id: "t-planka-260",
    scope: "tenant",
    scopeRef: "fil",
    target: "price:planka_100",
    value: 260,
  });

  it("repoints one price and shifts the total by exactly that line", () => {
    const result = derive({ tenant: [plankaUp] });
    expect(result.isValid).toBe(true);
    const fill = result.parts.find((p) => p.path === "fill.material")!;
    expect(fill.pricePerUnit).toBe(260);
    // 44 fill meters × +10 CZK = +440 over the anchor.
    expect(result.totals.total).toBeCloseTo(anchor.expectedTotalPrice + fill.quantity * 10, 6);
    expect(result.stamps.overrideIds).toEqual(["t-planka-260"]);
  });

  it("removing the override restores delta-0 exactly — the layer below was never edited", () => {
    derive({ tenant: [plankaUp] });
    const restored = derive({});
    expect(restored.totals.total).toBeCloseTo(anchor.expectedTotalPrice, 6);
    expect(restored.money.total).toBe(String(anchor.expectedTotalPrice));
  });
});

describe("customer layer — standing agreements (CORE_SPEC §4)", () => {
  const alwaysSteel = ov({
    id: "c-steel",
    scope: "customer",
    scopeRef: "agreement-7",
    target: "param:frame_material",
    value: "steel",
  });

  it('"this client always gets steel" reproduces the steel golden through the cascade', () => {
    // Anchor config (no frame_material → default alu) + the agreement.
    const result = derive({ customer: [alwaysSteel] }, anchor.config, steel_frame_3panel.prices);
    expect(result.isValid).toBe(true);
    expect(result.totals.total).toBeCloseTo(steel_frame_3panel.expectedTotalPrice, 6);
    expect(result.money.total).toBe(String(steel_frame_3panel.expectedTotalPrice));
    expect(result.stamps.overrideIds).toEqual(["c-steel"]);
  });

  it("explicit user input still wins over the agreement (defaults layer under input)", () => {
    const result = derive(
      { customer: [alwaysSteel] },
      { ...anchor.config, frame_material: "alu" },
      steel_frame_3panel.prices,
    );
    expect(result.totals.total).toBeCloseTo(anchor.expectedTotalPrice, 6);
  });
});

describe("quote layer — mm deviations through the deviation gate (I7, one write path)", () => {
  it("a deviation outside the domain passes WITH a reason, flagged for the workshop", () => {
    const result = derive({
      quote: [
        ov({
          id: "q-width-8050",
          target: "param:opening_width_mm",
          value: 8050,
          reason: "client's plot is 8.05 m",
        }),
      ],
    });
    expect(result.isValid).toBe(true);
    expect(result.derived.outerFrameWidth).toBe(8250);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        key: "engine.deviation.applied",
        severity: "warn",
        params: expect.objectContaining({ key: "opening_width_mm", value: 8050 }),
      }),
    );
    expect(result.stamps.overrideIds).toEqual(["q-width-8050"]);
  });

  it("the same deviation without a reason is rejected — provenance is not optional", () => {
    const result = derive({
      quote: [ov({ id: "q-no-reason", target: "param:opening_width_mm", value: 8050 })],
    });
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("engine.deviation.reason_required");
  });

  it("past the bounds the product does not bend, reason or not", () => {
    const result = derive({
      quote: [
        ov({
          id: "q-width-9500",
          target: "param:opening_width_mm",
          value: 9500,
          reason: "client insists",
        }),
      ],
    });
    expect(result.isValid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        key: "engine.deviation.out_of_bounds",
        params: expect.objectContaining({ key: "opening_width_mm", min: 1800, max: 9000 }),
      }),
    );
  });

  it("a hard-mode deviation needs no ceremony inside bounds, rejects outside (clear_height)", () => {
    const inside = derive({
      quote: [ov({ id: "q-h-2550", target: "param:clear_height_mm", value: 2550 })],
    });
    expect(inside.isValid).toBe(true);
    expect(inside.issues.map((i) => i.key)).not.toContain("engine.deviation.applied");

    const outside = derive({
      quote: [ov({ id: "q-h-2700", target: "param:clear_height_mm", value: 2700 })],
    });
    expect(outside.isValid).toBe(false);
    expect(outside.issues.map((i) => i.key)).toContain("engine.deviation.out_of_bounds");
  });
});

describe("artifact layer — 'make that one cut shorter' (CORE_SPEC §6)", () => {
  it("patches one emitted part, flags it, and resolves the price explicitly", () => {
    const result = derive({
      quote: [
        ov({
          id: "q-fill-45",
          target: "artifact:fill.material.quantity",
          value: 45,
          reason: "one spare length for the stepped corner",
          pricingResolution: "reprice",
        }),
      ],
    });
    expect(result.isValid).toBe(true);
    const fill = result.parts.find((p) => p.path === "fill.material")!;
    expect(fill.quantity).toBe(45);
    expect(fill.totalPrice).toBe(45 * 250);
    expect(fill.deviations).toEqual([
      {
        field: "quantity",
        original: 44,
        value: 45,
        overrideId: "q-fill-45",
        reason: "one spare length for the stepped corner",
      },
    ]);
    // +1 meter × 250 CZK over the anchor.
    expect(result.totals.total).toBeCloseTo(anchor.expectedTotalPrice + 250, 6);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ key: "engine.deviation.artifact", severity: "warn" }),
    );
  });

  it("keep_price patches the geometry but pins the derived line total", () => {
    const result = derive({
      quote: [
        ov({
          id: "q-fill-45-keep",
          target: "artifact:fill.material.quantity",
          value: 45,
          reason: "goodwill",
          pricingResolution: "keep_price",
        }),
      ],
    });
    expect(result.parts.find((p) => p.path === "fill.material")?.quantity).toBe(45);
    expect(result.totals.total).toBeCloseTo(anchor.expectedTotalPrice, 6);
  });
});

describe("the full cascade at once — determinism and stamp order (I1/I3)", () => {
  const layers: CascadeLayers = {
    tenant: [
      ov({ id: "t-1", scope: "tenant", scopeRef: "fil", target: "price:planka_100", value: 260 }),
    ],
    customer: [
      ov({
        id: "c-1",
        scope: "customer",
        scopeRef: "agreement-7",
        target: "param:manufacturing_hours",
        value: 20,
      }),
    ],
    quote: [
      ov({
        id: "q-1",
        target: "param:opening_width_mm",
        value: 8050,
        reason: "client's plot",
      }),
    ],
  };

  it("stamps every applied override in cascade order", () => {
    const result = derive(layers);
    expect(result.isValid).toBe(true);
    expect(result.stamps.overrideIds).toEqual(["t-1", "c-1", "q-1"]);
  });

  it("re-derivation under the same cascade state is byte-identical", () => {
    const once = derive(layers);
    const again = derive(layers);
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
  });
});

describe("exception ledger — deviations become product intelligence (§4)", () => {
  it("the same deviation on three quotes surfaces in the promotion queue", () => {
    const stored: Override[] = [
      ov({
        id: "q1-w",
        scopeRef: "quote-1",
        target: "param:opening_width_mm",
        value: 8050,
        reason: "plot",
      }),
      ov({
        id: "q2-w",
        scopeRef: "quote-2",
        target: "param:opening_width_mm",
        value: 8100,
        reason: "plot again",
      }),
      ov({
        id: "q3-w",
        scopeRef: "quote-3",
        target: "param:opening_width_mm",
        value: 8060,
        reason: "driveway",
      }),
      ov({ id: "q1-h", scopeRef: "quote-1", target: "param:clear_height_mm", value: 2550 }),
      // Tenant config is not an exception — must never pollute the ledger.
      ov({ id: "t-p", scope: "tenant", scopeRef: "fil", target: "price:planka_100", value: 260 }),
    ];

    expect(recurrenceReport(stored, 2)).toEqual([
      {
        target: "param:opening_width_mm",
        occurrences: 3,
        distinctQuotes: 3,
        values: [8050, 8100, 8060],
        reasons: ["plot", "plot again", "driveway"],
      },
    ]);
  });
});
