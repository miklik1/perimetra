/**
 * Release version pin / opt-in upgrade (CORE_SPEC §3, ADR 0064) at the HTTP layer
 * against the real containers. Proves the §3 contract "tenants are assigned
 * releases and pin to them; upgrades are explicit opt-in per tenant":
 *
 *  - Assigning the FIRST version of a model lazily pins the org to it; the
 *    configurator list (`GET /v1/releases`, pinned-only) shows that one version.
 *  - Assigning a NEWER version does NOT move the pin — it surfaces as an opt-in
 *    offer (`GET /v1/releases/upgrades`); the configurator still shows the old one.
 *  - Opting in (`POST /v1/releases/pin`) moves the pin; the configurator now shows
 *    the new version and the offer clears.
 *  - I3 ≠ pin: a quote ISSUED on the old version re-derives byte-identically after
 *    the org has opted into the newer version (the pin is not a re-derivation key).
 *  - assertAssigned stays set-membership: the still-assigned old version is still
 *    quotable after the upgrade (the pin governs the default offer, not authz).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import {
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

/** A synthetic v2 of the gate model — the same definition, bumped natural key +
 *  version, same catalog@2 (so it validates + shares the org's catalog). */
const slidingGateV2: ProductModelRelease = {
  ...slidingGateV1,
  id: "sliding-gate@2",
  version: 2,
};

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** The golden three-instance site (gate + two fences), roster on the v1 ids. */
const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

interface ReleaseItems {
  items: { id: string; releaseId: string }[];
}
interface UpgradeItems {
  items: {
    modelId: string;
    pinnedReleaseId: string;
    pinnedVersion: number;
    latestReleaseId: string;
    latestVersion: number;
  }[];
}

describe("release version pin / opt-in upgrade (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let userA: TestUser; // orgA admin (owner)
  let orgA: string;
  let quoteId: string; // orgA's golden quote, stamped on sliding-gate@1

  const postAs = (u: TestUser, url: string, payload: Record<string, unknown> = {}) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });
  const releaseIdsOf = async (u: TestUser): Promise<string[]> =>
    ((await getAs(u, "/v1/releases?limit=100")).json() as ReleaseItems).items.map(
      (r) => r.releaseId,
    );
  const upgradesOf = async (u: TestUser): Promise<UpgradeItems["items"]> =>
    ((await getAs(u, "/v1/releases/upgrades")).json() as UpgradeItems).items;

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "pin-platform");
    await promotePlatformAdmin(db, platform.id);
    userA = await signUpUser(app, "pin-orgA");
    orgA = await orgIdOf(db, userA.id);

    // Publish the corpus + a synthetic gate v2 (shared store — tolerate a 409).
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1, slidingGateV2]) {
      const res = await postAs(platform, "/v1/releases", { catalogVersion: 2, body });
      expect([201, 409], JSON.stringify(res.json())).toContain(res.statusCode);
    }

    // orgA gets the v1 corpus (gate@1 + fence@1) + a price table → can issue.
    await assignReleases(app, platform, orgA, ["sliding-gate@1", "fence-run@1"]);
    expect((await postAs(userA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("the first assigned version is the active pin; no upgrade is offered yet", async () => {
    // orgA configures with gate@1 + fence@1 (the lazily-created pins), not gate@2.
    const list = await releaseIdsOf(userA);
    expect(list).toContain("sliding-gate@1");
    expect(list).toContain("fence-run@1");
    expect(list).not.toContain("sliding-gate@2");
    // Nothing newer is assigned → no offer.
    expect(await upgradesOf(userA)).toHaveLength(0);
  });

  it("issues the golden quote on the pinned v1 (the I3 baseline)", async () => {
    const issued = await postAs(userA, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    const q = issued.json() as { id: string; total: string };
    expect(q.total).toBe("129891.5");
    quoteId = q.id;
  });

  it("assigning a newer version surfaces an opt-in offer WITHOUT moving the pin", async () => {
    await assignReleases(app, platform, orgA, ["sliding-gate@2"]);

    // The configurator STILL shows v1 (the pin did not silently move) — §3.
    const list = await releaseIdsOf(userA);
    expect(list).toContain("sliding-gate@1");
    expect(list).not.toContain("sliding-gate@2");

    // gate@2 is offered as an explicit upgrade.
    const offers = await upgradesOf(userA);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      modelId: "sliding-gate",
      pinnedReleaseId: "sliding-gate@1",
      pinnedVersion: 1,
      latestReleaseId: "sliding-gate@2",
      latestVersion: 2,
    });
  });

  it("opting in moves the pin; the configurator now shows v2 and the offer clears", async () => {
    const opted = await postAs(userA, "/v1/releases/pin", { releaseId: "sliding-gate@2" });
    expect(opted.statusCode, JSON.stringify(opted.json())).toBe(201);
    // The response is the remaining offers (now empty for the gate model).
    expect((opted.json() as UpgradeItems).items).toHaveLength(0);

    const list = await releaseIdsOf(userA);
    expect(list).toContain("sliding-gate@2");
    expect(list).not.toContain("sliding-gate@1");
    expect(await upgradesOf(userA)).toHaveLength(0);
  });

  it("I3 ≠ pin: the quote issued on v1 still reproduces byte-identically after the upgrade", async () => {
    const verify = await postAs(userA, `/v1/quotes/${quoteId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId, reproduced: true, mismatches: [] });
  });

  it("assertAssigned stays set-membership: the still-assigned v1 is quotable after the upgrade", async () => {
    // gate@1 is no longer the PIN, but it is still ASSIGNED — a roster on it
    // still issues (the pin governs the default offer, not authorization).
    const reissue = await postAs(userA, "/v1/quotes", issueBody);
    expect(reissue.statusCode, JSON.stringify(reissue.json())).toBe(201);
    expect((reissue.json() as { total: string }).total).toBe("129891.5");
  });

  it("opting into a non-assigned version is refused (you can only pin what the vendor made available)", async () => {
    const userB = await signUpUser(app, "pin-orgB");
    // orgB has nothing assigned → cannot pin gate@2.
    const res = await postAs(userB, "/v1/releases/pin", { releaseId: "sliding-gate@2" });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("release_not_assigned");
  });
});
