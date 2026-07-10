/**
 * The workshop PRODUCTION view (CAR-24, ADR 0101) at the HTTP layer against the
 * real containers — a NEW `GET /v1/quotes/:id/production` reachable by
 * admin/sales/workshop alike, built off the quote's FROZEN snapshot (never
 * re-derived — I3), and role-INDEPENDENT: every caller gets the identical
 * price-blind shape.
 *
 * The load-bearing assertion is the NON-LEAK test (mirrors the buyer nabídka
 * precedent in quotes.itest.ts): a recursive key scan over the whole response
 * proves zero money/price/cost/margin-shaped keys survive, deeply — not just at
 * the top level.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import {
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  steppedSite,
} from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** The golden three-instance site, roster by release natural key — the SAME
 *  fixture `quotes.itest.ts`/`roles.itest.ts` issue against. */
const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

/** A price table WITH a cost layer (ADR 0059) — the cost golden (82889.86) is
 *  the sharpest leak probe: if it ever appeared in a production body, the
 *  boundary failed. */
const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

interface QuoteResponse {
  id: string;
  documentNumber: string;
  shareToken: string;
}

interface ProductionResponse {
  id: string;
  documentNumber: string;
  status: string;
  createdAt: string;
  instances: { instanceId: string; releaseId: string }[];
  bom: { componentCode: string; name: string; unit: string; category: string; quantity: number }[];
  cutList: { components: { componentCode: string; lines: unknown[] }[] };
  cutOptions: { kerfMm: number };
  drawings: { site: unknown; instances: Record<string, { quads: unknown[] }> };
  // ADR 0108 — frozen technical drawing + spec/dimension rows, projected here.
  technicalDrawings?: Record<string, { viewId: string; annotations: { id: string }[] }>;
  specRows?: Record<string, { key: string; label: string; value: string }[]>;
  dimensionRows?: Record<string, { id: string; label: string; valueMm: number }[]>;
}

/** Recursively collect every object key in a JSON value — the deep leak-scan
 *  idiom this suite introduces (mirrors, and generalises, the flat
 *  `res.body.not.toContain(...)` check in quotes.itest.ts's buyer-nabídka
 *  non-leak test). */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(key);
      collectKeys(v, into);
    }
  }
  return into;
}

describe("quote production view (HTTP, real stack) — CAR-24", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;
  let quote: QuoteResponse;

  const post = (user: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });
  const setRole = (userId: string, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, userId));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "production-tenant"); // owner → admin (org role)

    await seedGoldenCorpusFor(app, db, tenant);
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    const issued = await post(tenant, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    quote = issued.json() as QuoteResponse;
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin: reads the production view — cut list, BOM quantities, drawings", async () => {
    const res = await get(tenant, `/v1/quotes/${quote.id}/production`);
    expect(res.statusCode, res.body).toBe(200);
    const production = res.json() as ProductionResponse;

    expect(production.id).toBe(quote.id);
    expect(production.documentNumber).toBe(quote.documentNumber);
    expect(production.status).toBe("issued");
    expect(production.instances).toEqual(
      expect.arrayContaining([
        { instanceId: "gate", releaseId: "sliding-gate@1" },
        { instanceId: "fenceA", releaseId: "fence-run@1" },
        { instanceId: "fenceB", releaseId: "fence-run@1" },
      ]),
    );
    expect(production.bom.length).toBeGreaterThan(0);
    expect(production.bom.every((line) => typeof line.quantity === "number")).toBe(true);
    expect(production.cutList.components.length).toBeGreaterThan(0);
    expect(Object.keys(production.drawings.instances)).toEqual(
      expect.arrayContaining(["gate", "fenceA", "fenceB"]),
    );

    // ADR 0108 — the frozen 2D technical drawing per instance (the gate falls
    // back to the emitter's default overall-dims; the fence carries its authored
    // DrawingSpec dimensions/labels).
    expect(Object.keys(production.technicalDrawings ?? {})).toEqual(
      expect.arrayContaining(["gate", "fenceA", "fenceB"]),
    );
    expect(production.technicalDrawings?.gate?.annotations.length ?? 0).toBeGreaterThan(0);

    // The §8 spec-sheet rows per instance, off the release UiSpec + frozen config.
    expect(production.specRows?.gate?.length ?? 0).toBeGreaterThan(0);
    expect(production.specRows?.gate?.every((r) => typeof r.value === "string")).toBe(true);

    // Dimension rows derived from the technical drawing's annotations. The fence
    // carries its release-authored Czech label ("Celková šířka") on the width.
    const fenceDims = production.dimensionRows?.fenceA ?? [];
    expect(fenceDims.length).toBeGreaterThan(0);
    expect(fenceDims.every((d) => typeof d.valueMm === "number")).toBe(true);
    expect(fenceDims.some((d) => d.label === "Celková šířka")).toBe(true);
  });

  it("sales and workshop see the IDENTICAL shape as admin — role-independent", async () => {
    const admin = (await get(tenant, `/v1/quotes/${quote.id}/production`)).json();

    await setRole(tenant.id, "sales");
    const sales = (await get(tenant, `/v1/quotes/${quote.id}/production`)).json();
    expect(sales).toEqual(admin);

    await setRole(tenant.id, "workshop");
    const workshop = await get(tenant, `/v1/quotes/${quote.id}/production`);
    expect(workshop.statusCode).toBe(200);
    expect(workshop.json()).toEqual(admin);

    await setRole(tenant.id, "admin"); // restore for later tests in this file
  });

  it("workshop now sees the org's quotes on the LIST too (ADR-widened scopeOpts, CAR-24)", async () => {
    await setRole(tenant.id, "workshop");
    const res = await get(tenant, "/v1/quotes");
    expect(res.statusCode).toBe(200);
    const page = res.json() as { items: { id: string; total: string | null }[] };
    expect(page.items.some((q) => q.id === quote.id)).toBe(true);
    // Still price-blind — the list total stays null for workshop.
    expect(page.items.find((q) => q.id === quote.id)?.total).toBeNull();
    await setRole(tenant.id, "admin");
  });

  it("NEVER leaks a money/price/cost/margin-shaped key, deeply — the load-bearing test", async () => {
    const res = await get(tenant, `/v1/quotes/${quote.id}/production`);
    expect(res.statusCode).toBe(200);

    // The frozen technical drawing + spec/dimension rows (ADR 0108) are present,
    // so the recursive scan below runs over the NEW fields' real data, not an
    // absent branch — the leak guard must cover them too.
    const production = res.json() as ProductionResponse;
    expect(production.technicalDrawings).toBeDefined();
    expect(production.specRows).toBeDefined();
    expect(production.dimensionRows).toBeDefined();

    const keys = collectKeys(res.json());
    const forbidden = [...keys].filter((k) => /price|cost|margin/i.test(k));
    expect(forbidden, `forbidden keys found: ${forbidden.join(", ")}`).toEqual([]);

    // The golden money strings themselves must never appear anywhere in the body.
    expect(res.body).not.toContain("134723.5"); // the site total (I10)
    expect(res.body).not.toContain("82889.86"); // the cost-of-goods total (ADR 0059)
    // Every field the priced detail carries but production must not.
    expect(res.body).not.toContain('"totals"');
    expect(res.body).not.toContain('"money"');
    expect(res.body).not.toContain('"customer"');
    expect(res.body).not.toContain('"supplier"');
    expect(res.body).not.toContain('"stamps"');
    expect(res.body).not.toContain('"tax"');
  });

  it("a different org cannot read the production view (404, no existence oracle)", async () => {
    const intruder = await signUpUser(app, "production-intruder");
    const res = await get(intruder, `/v1/quotes/${quote.id}/production`);
    expect(res.statusCode).toBe(404);
  });

  it("a declined quote 404s — nothing to build once the buyer walks away", async () => {
    const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const decline = await inject(app, {
      method: "POST",
      url: `/v1/quotes/shared/${issued.shareToken}/decline`,
    });
    expect(decline.statusCode).toBe(200);

    const res = await get(tenant, `/v1/quotes/${issued.id}/production`);
    expect(res.statusCode).toBe(404);
  });

  it("an expired quote 404s — the derived effective status gates production too", async () => {
    const issued = (
      await post(tenant, "/v1/quotes", { ...issueBody, validUntil: "2020-01-01T00:00:00.000Z" })
    ).json() as QuoteResponse;
    const res = await get(tenant, `/v1/quotes/${issued.id}/production`);
    expect(res.statusCode).toBe(404);
  });

  it("an accepted quote is still producible", async () => {
    const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const accept = await inject(app, {
      method: "POST",
      url: `/v1/quotes/shared/${issued.shareToken}/accept`,
    });
    expect(accept.statusCode).toBe(200);

    const res = await get(tenant, `/v1/quotes/${issued.id}/production`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as ProductionResponse).status).toBe("accepted");
  });
});
