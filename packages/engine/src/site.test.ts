/**
 * Site-graph composition unit tests (CORE_SPEC §5, step 4) — a minimal
 * synthetic "panel" release exercising every deriveSite seam in isolation:
 * structural validation, terrain injection through the input gate, paired
 * connection-constraint scopes, sharing/ownership (I6), aggregation, and the
 * I11 degenerate case. The real fence+gate composition lives in
 * @repo/fixtures (site-composition.test.ts).
 */
import { describe, expect, it } from "vitest";

import { expr, type Catalog, type ProductModelRelease, type Site } from "@repo/model";

import { deriveInstance } from "./pipeline.js";
import { deriveSite, type SiteInstance } from "./site.js";
import type { PriceTable } from "./types.js";

/** A 1-D "panel": a body with a cap at each end. Caps are the shared element —
 *  `start` consumes (attaches to the neighbor's end cap), `end` owns. */
const panel: ProductModelRelease = {
  id: "panel@1",
  modelId: "panel",
  version: 1,
  status: "published",
  parameters: [
    {
      key: "len",
      type: "length_mm",
      domain: { kind: "range", min: 1000, max: 4000 },
      adjustability: "user",
    },
    {
      key: "elev",
      type: "length_mm",
      domain: { kind: "range", min: -1000, max: 1000 },
      default: 0,
      adjustability: "user",
    },
  ],
  constraints: [
    {
      key: "panel.connection.step",
      kind: "expr",
      expr: expr("abs(self.top - other.top) <= 100"),
      severity: "error",
      scope: "connection",
    },
  ],
  derivation: {
    derived: [{ key: "top", expr: expr("elev + 1000") }],
    parts: [
      {
        path: "cap.start",
        resolve: { role: "cap" },
        name: "Start cap",
        // Conditional on purpose: lets a test consume an absent element.
        when: expr("len > 1100"),
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
      },
      {
        path: "cap.end",
        resolve: { role: "cap" },
        name: "End cap",
        bom: { unit: "piece", quantity: expr("1"), category: "material" },
      },
      {
        path: "body",
        resolve: { role: "body" },
        name: "Body",
        bom: { unit: "meter", quantity: expr("len / 1000"), category: "material" },
      },
    ],
  },
  ports: [
    {
      id: "start",
      kind: "p.start",
      compatibleKinds: ["p.end"],
      sharing: { element: "cap.start", policy: "consumer" },
    },
    {
      id: "end",
      kind: "p.end",
      compatibleKinds: ["p.start"],
      sharing: { element: "cap.end", policy: "owner" },
    },
    // Pathological ports for the sharing negative paths.
    {
      id: "mid",
      kind: "p.mid",
      compatibleKinds: ["p.mid", "p.bare"],
      sharing: { element: "cap.start", policy: "consumer" },
    },
    { id: "bare", kind: "p.bare", compatibleKinds: ["p.mid"] },
  ],
  terrain: { elevationParam: "elev" },
};

const catalog: Catalog = {
  id: "catalog@7",
  version: 7,
  materials: [],
  sections: [],
  components: [
    { code: "cap", name: "Cap", unit: "piece", roles: ["cap"] },
    { code: "body", name: "Body", unit: "meter", roles: ["body"] },
  ],
};

const prices: PriceTable = {
  version: 3,
  components: { cap: 10, body: 5 },
  manufacturing: { rate: 0, multiplier: 0 },
  installation: 0,
};

/** Per-release catalog map (ADR 0065), keyed by release id — every panel release
 *  in these tests derives against catalog@7 (`panel@2` is the terrain-unbound
 *  clone). deriveSite routes each instance to its release's catalog. */
const catalogs = new Map<string, Catalog>([
  ["panel@1", catalog],
  ["panel@2", catalog],
]);

const flat: Site["terrain"] = [{ id: "s0", elevation_mm: 0 }];

const place = (...ids: string[]): Site["placements"] =>
  ids.map((instanceId, i) => ({
    instanceId,
    pose: { origin_mm: { x: i * 2000, y: 0 } },
    terrainSegmentId: "s0",
  }));

const twoPanels = (): SiteInstance[] => [
  { instanceId: "A", release: panel, input: { len: 2000 } },
  { instanceId: "B", release: panel, input: { len: 2000 } },
];

describe("deriveSite — sharing & aggregation (I6)", () => {
  const site: Site = {
    id: "site-1",
    terrain: flat,
    placements: place("A", "B"),
    connections: [
      { a: { instanceId: "A", portId: "end" }, b: { instanceId: "B", portId: "start" } },
    ],
  };

  const result = deriveSite(site, twoPanels(), prices, catalogs);

  it("is valid and resolves the shared element to one owner", () => {
    expect(result.isValid).toBe(true);
    expect(result.sharing).toEqual([
      {
        connection: 0,
        ownerInstanceId: "A",
        ownerPartPath: "cap.end",
        consumerInstanceId: "B",
        consumedPartPath: "cap.start",
      },
    ]);
  });

  it("counts the consumed cap once across the aggregate BOM", () => {
    // A: cap.start + cap.end; B: cap.end only (its cap.start is consumed).
    const caps = result.bom.find((l) => l.componentCode === "cap");
    expect(caps?.quantity).toBe(3);
    expect(caps?.totalPrice).toBe(30);
    expect(caps?.sources).toEqual([
      { instanceId: "A", path: "cap.start" },
      { instanceId: "A", path: "cap.end" },
      { instanceId: "B", path: "cap.end" },
    ]);
  });

  it("merges same-component lines across instances with provenance", () => {
    const body = result.bom.find((l) => l.componentCode === "body");
    expect(body?.quantity).toBe(4);
    expect(body?.totalPrice).toBe(20);
  });

  it("totals re-sum from surviving parts and cross the money boundary (I10)", () => {
    expect(result.totals.total).toBe(50);
    expect(result.money.total).toBe("50");
  });

  it("keeps both caps on an UNCONNECTED consumer port (standalone run)", () => {
    const standalone = deriveSite(
      { id: "site-2", terrain: flat, placements: place("A"), connections: [] },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expect(standalone.bom.find((l) => l.componentCode === "cap")?.quantity).toBe(2);
  });

  it("consuming an element the config never emitted is a no-op drop", () => {
    // len 1100 fails cap.start's `when` — B has no start cap to drop.
    const result = deriveSite(
      site,
      [
        { instanceId: "A", release: panel, input: { len: 2000 } },
        { instanceId: "B", release: panel, input: { len: 1100 } },
      ],
      prices,
      catalogs,
    );
    expect(result.isValid).toBe(true);
    expect(result.sharing).toHaveLength(1);
    // A keeps both caps (its start is unconnected); B emits cap.end only.
    expect(result.bom.find((l) => l.componentCode === "cap")?.quantity).toBe(3);
  });

  it("stamps every instance's release pin + each release's catalog version (I3)", () => {
    expect(result.stamps).toEqual({
      releaseIds: { A: "panel@1", B: "panel@1" },
      catalogVersions: { "panel@1": 7 },
      priceTableVersion: 3,
      overrideIds: [],
    });
  });

  it("is deterministic — re-derivation is byte-identical (I1)", () => {
    expect(JSON.stringify(deriveSite(site, twoPanels(), prices, catalogs))).toBe(
      JSON.stringify(result),
    );
  });
});

describe("deriveSite — the degenerate single-instance site (I11)", () => {
  it("aggregate equals the standalone instance result", () => {
    const alone = deriveInstance(panel, { len: 2000 }, prices, catalog);
    const result = deriveSite(
      {
        id: "site-3",
        terrain: [],
        placements: [{ instanceId: "A", pose: { origin_mm: { x: 0, y: 0 } } }],
        connections: [],
      },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expect(result.isValid).toBe(true);
    expect(result.totals).toEqual(alone.totals);
    expect(result.money).toEqual(alone.money);
    expect(result.instances.A).toEqual(alone);
  });
});

describe("deriveSite — stepped terrain & connection constraints", () => {
  const stepped: Site = {
    id: "site-4",
    terrain: [
      { id: "lo", elevation_mm: 0 },
      { id: "hi", elevation_mm: 80 },
    ],
    placements: [
      { instanceId: "A", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "lo" },
      { instanceId: "B", pose: { origin_mm: { x: 2000, y: 0 } }, terrainSegmentId: "hi" },
    ],
    connections: [
      { a: { instanceId: "A", portId: "end" }, b: { instanceId: "B", portId: "start" } },
    ],
  };

  it("injects the segment elevation into the declared parameter", () => {
    const result = deriveSite(stepped, twoPanels(), prices, catalogs);
    expect(result.isValid).toBe(true);
    expect(result.instances.A!.derived.top).toBe(1000);
    expect(result.instances.B!.derived.top).toBe(1080);
  });

  it("fails the connection constraint when the step exceeds the model's rule", () => {
    const tooSteep: Site = {
      ...stepped,
      terrain: [
        { id: "lo", elevation_mm: 0 },
        { id: "hi", elevation_mm: 250 },
      ],
    };
    const result = deriveSite(tooSteep, twoPanels(), prices, catalogs);
    expect(result.isValid).toBe(false);
    expect(result.bom).toEqual([]);
    expect(result.totals.total).toBe(0);
    // Both ends raise it (each instance reports its own violation).
    expect(result.issues).toEqual([
      {
        key: "panel.connection.step",
        severity: "error",
        scope: "connection",
        params: { connection: 0, self: "A", other: "B" },
      },
      {
        key: "panel.connection.step",
        severity: "error",
        scope: "connection",
        params: { connection: 0, self: "B", other: "A" },
      },
    ]);
  });

  it("rejects an explicit input that contradicts the placement's terrain", () => {
    const result = deriveSite(
      stepped,
      [
        { instanceId: "A", release: panel, input: { len: 2000 } },
        { instanceId: "B", release: panel, input: { len: 2000, elev: 500 } },
      ],
      prices,
      catalogs,
    );
    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual([
      {
        key: "engine.site.elevation_conflict",
        severity: "error",
        scope: "site",
        params: { id: "B", param: "elev", input: 500, terrain: 80 },
      },
    ]);
  });

  it("accepts an explicit input that AGREES with the terrain", () => {
    const result = deriveSite(
      stepped,
      [
        { instanceId: "A", release: panel, input: { len: 2000 } },
        { instanceId: "B", release: panel, input: { len: 2000, elev: 80 } },
      ],
      prices,
      catalogs,
    );
    expect(result.isValid).toBe(true);
  });
});

describe("deriveSite — structural validation", () => {
  const expectSingleIssue = (result: ReturnType<typeof deriveSite>, key: string) => {
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toEqual([key]);
    expect(result.issues[0]!.scope).toBe("site");
  };

  it("rejects a duplicate instanceId", () => {
    const result = deriveSite(
      { id: "s", terrain: flat, placements: place("A"), connections: [] },
      [
        { instanceId: "A", release: panel, input: { len: 2000 } },
        { instanceId: "A", release: panel, input: { len: 3000 } },
      ],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.duplicate_instance");
  });

  it("rejects a placement of an unknown instance", () => {
    const result = deriveSite(
      { id: "s", terrain: flat, placements: place("A", "GHOST"), connections: [] },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.unknown_instance");
  });

  it("rejects a duplicate placement", () => {
    const result = deriveSite(
      { id: "s", terrain: flat, placements: place("A", "A"), connections: [] },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.duplicate_placement");
  });

  it("rejects an unplaced instance", () => {
    const result = deriveSite(
      { id: "s", terrain: flat, placements: [], connections: [] },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.unplaced_instance");
  });

  it("rejects a placement on an unknown terrain segment", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: [
          { instanceId: "A", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "nope" },
        ],
        connections: [],
      },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.unknown_terrain_segment");
  });

  it("rejects a terrain placement of a model without a terrain binding", () => {
    const unbound: ProductModelRelease = { ...panel, id: "panel@2" };
    delete (unbound as Partial<ProductModelRelease>).terrain;
    const result = deriveSite(
      { id: "s", terrain: flat, placements: place("A"), connections: [] },
      [{ instanceId: "A", release: unbound, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.terrain_unbound");
  });

  it("rejects a duplicate terrain segment id", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: [...flat, { id: "s0", elevation_mm: 50 }],
        placements: place("A"),
        connections: [],
      },
      [{ instanceId: "A", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.duplicate_terrain_segment");
  });

  it("rejects a connection to an unknown port", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: place("A", "B"),
        connections: [
          { a: { instanceId: "A", portId: "end" }, b: { instanceId: "B", portId: "nope" } },
        ],
      },
      twoPanels(),
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.unknown_port");
  });

  it("rejects a port used in two connections", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: place("A", "B", "C"),
        connections: [
          { a: { instanceId: "A", portId: "end" }, b: { instanceId: "B", portId: "start" } },
          { a: { instanceId: "A", portId: "end" }, b: { instanceId: "C", portId: "start" } },
        ],
      },
      [...twoPanels(), { instanceId: "C", release: panel, input: { len: 2000 } }],
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.port_reused");
  });

  it("rejects incompatible port kinds (must be mutual)", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: place("A", "B"),
        connections: [
          { a: { instanceId: "A", portId: "start" }, b: { instanceId: "B", portId: "start" } },
        ],
      },
      twoPanels(),
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.port_incompatible");
  });

  it("rejects a consumer↔consumer connection (nobody provides the element)", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: place("A", "B"),
        connections: [
          { a: { instanceId: "A", portId: "mid" }, b: { instanceId: "B", portId: "mid" } },
        ],
      },
      twoPanels(),
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.sharing_conflict");
  });

  it("rejects a consumer attached to a port that provides nothing", () => {
    const result = deriveSite(
      {
        id: "s",
        terrain: flat,
        placements: place("A", "B"),
        connections: [
          { a: { instanceId: "A", portId: "mid" }, b: { instanceId: "B", portId: "bare" } },
        ],
      },
      twoPanels(),
      prices,
      catalogs,
    );
    expectSingleIssue(result, "engine.site.sharing_unprovided");
  });
});

describe("deriveSite — per-instance cascade layers", () => {
  it("applies an instance's overrides and stamps them on the site (I3/I8)", () => {
    const result = deriveSite(
      { id: "s", terrain: flat, placements: place("A", "B"), connections: [] },
      [
        {
          instanceId: "A",
          release: panel,
          input: { len: 2000 },
          overrides: {
            tenant: [
              {
                id: "ovr-1",
                scope: "tenant",
                scopeRef: "t1",
                target: "price:cap",
                value: 25,
                author: "fil",
                createdAt: "2026-06-12",
              },
            ],
          },
        },
        { instanceId: "B", release: panel, input: { len: 2000 } },
      ],
      prices,
      catalogs,
    );
    expect(result.isValid).toBe(true);
    expect(result.stamps.overrideIds).toEqual(["ovr-1"]);
    // A's caps reprice; B's stay on the base table — lines merge but sum both.
    const caps = result.bom.find((l) => l.componentCode === "cap");
    expect(caps?.totalPrice).toBe(2 * 25 + 2 * 10);
  });
});
