/**
 * Per-release catalog (CORE_SPEC §3/§5, ADR 0065) at the HTTP layer against the
 * real containers. The headline I3 proof: a quote whose instances span DIFFERENT
 * catalog versions issues and re-derives BYTE-IDENTICALLY.
 *
 * This is the real fix behind ADR 0064's old `upgrade_catalog_conflict` guard
 * (now removed): an org can pin one product to catalog@1 and another to
 * catalog@2 at once. The engine derives each instance against its OWN catalog;
 * the quote stamps a MAP of releaseId→catalogVersion and verify reloads each
 * stamped catalog version to reproduce (the multi-version load path).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { quote } from "@repo/db/schema/quotes";
import {
  catalogV1,
  catalogV2,
  fenceRunV1,
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";
import { type ProductModelRelease } from "@repo/model";

import { DB } from "../src/common/db/db.module.js";
import {
  assignReleases,
  createApiApp,
  inject,
  orgIdOf,
  promotePlatformAdmin,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** A gate release pinned to catalog@1 — the same definition slidingGateV1 (which
 *  validates against BOTH catalog releases), under its own natural key so it can
 *  coexist with the catalog@2 fence in one org's assigned set. */
const slidingGateCat1: ProductModelRelease = {
  ...slidingGateV1,
  id: "sliding-gate-c1@1",
  modelId: "sliding-gate-c1",
  version: 1,
};

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** The golden stepped site, but the gate resolves against catalog@1 and the two
 *  fences against catalog@2 — mixed versions in one quote. */
const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate-c1@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

interface IssuedQuote {
  id: string;
  total: string;
  stamps: { releaseIds: Record<string, string>; catalogVersions: Record<string, number> };
}

describe("per-release catalog — mixed versions in one quote (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let userA: TestUser;
  let orgA: string;
  let quoteId: string;

  const postAs = (u: TestUser, url: string, payload: Record<string, unknown> = {}) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "prc-platform");
    await promotePlatformAdmin(db, platform.id);
    userA = await signUpUser(app, "prc-orgA");
    orgA = await orgIdOf(db, userA.id);

    // Both catalog versions in the shared global store (tolerate a 409 — immutable).
    for (const body of [catalogV1, catalogV2]) {
      expect([201, 409]).toContain(
        (await postAs(platform, "/v1/catalog-versions", { body })).statusCode,
      );
    }
    // The gate on catalog@1, the fence on catalog@2 — published by the vendor.
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/releases", { catalogVersion: 1, body: slidingGateCat1 }))
        .statusCode,
    );
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/releases", { catalogVersion: 2, body: fenceRunV1 })).statusCode,
    );

    // orgA gets BOTH (different catalogs) + a price table → can issue a mixed quote.
    await assignReleases(app, platform, orgA, ["sliding-gate-c1@1", "fence-run@1"]);
    expect((await postAs(userA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("issues a quote whose instances span catalog@1 + catalog@2 (no mixed_catalog 422)", async () => {
    const res = await postAs(userA, "/v1/quotes", issueBody);
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    const q = res.json() as IssuedQuote;
    quoteId = q.id;

    // The stamp records each release's OWN catalog version (per-release catalog).
    expect(q.stamps.catalogVersions).toEqual({
      "sliding-gate-c1@1": 1,
      "fence-run@1": 2,
    });
    expect(q.stamps.releaseIds).toEqual({
      gate: "sliding-gate-c1@1",
      fenceA: "fence-run@1",
      fenceB: "fence-run@1",
    });
  });

  it("re-derives the mixed-catalog quote BYTE-IDENTICALLY from its stamps (I3)", async () => {
    // verify reloads BOTH stamped catalog versions and re-derives — the
    // multi-version load path that the single-catalog corpus never exercised.
    const verify = await postAs(userA, `/v1/quotes/${quoteId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId, reproduced: true, mismatches: [] });
  });

  it("surfaces a missing stamped catalog version as reproduced:false (the loud negative path, I5)", async () => {
    // Corrupt ONE stamped catalog version to one that was never published. verify
    // must reload it, fail to find it, and REPORT it — never silently pass. This
    // guards the multi-version load loop against a regression that always returns
    // reproduced:true (the rest of the suite only asserts the positive path).
    const issued = (await postAs(userA, "/v1/quotes", issueBody)).json() as IssuedQuote;
    const [row] = await db.select().from(quote).where(eq(quote.id, issued.id));
    const stamps = row!.stamps as { catalogVersions: Record<string, number> };
    await db
      .update(quote)
      .set({
        stamps: {
          ...stamps,
          catalogVersions: { ...stamps.catalogVersions, "fence-run@1": 999 },
        },
      })
      .where(eq(quote.id, issued.id));

    const verify = await postAs(userA, `/v1/quotes/${issued.id}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({
      quoteId: issued.id,
      reproduced: false,
      mismatches: ["catalog@999:missing"],
    });
  });
});
