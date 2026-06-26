/**
 * Vendor BROADCAST of an upgrade offer (CORE_SPEC §3, the ADR 0064-deferred
 * fan-out) at the HTTP layer against the real containers. Proves the §3
 * contract "the vendor makes a new version available to every org on an older
 * version; each tenant still opts in":
 *
 *  - One platform action (`POST /v1/platform/releases/:id/broadcast`) assigns
 *    the new version to EVERY org currently pinned to an older version of its
 *    MODEL — and to those orgs ONLY (model-scoped, version-aware targeting).
 *  - The broadcast NEVER moves a pin: a targeted org keeps its active version
 *    and the new one surfaces as an explicit opt-in offer (`/v1/releases/
 *    upgrades`), exactly like a single assign.
 *  - Already-current orgs (pinned to the broadcast version) and orgs on a
 *    different model are untouched.
 *  - Idempotent: a re-broadcast reports every still-behind org as SKIPPED and
 *    changes nothing; once an org opts in it drops out of the target set.
 *  - I3 ≠ visibility ≠ pin: a quote issued on the old version reproduces
 *    byte-identically through the whole fan-out.
 *  - Platform-only: a tenant admin 403s, an anonymous caller 401s; an
 *    unknown/unpublished release 404/409s before any write.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { release } from "@repo/db/schema/releases";
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

/** A synthetic v2 of the gate model — same definition, bumped natural key +
 *  version, same catalog@2 (so it validates + shares the catalog). */
const slidingGateV2: ProductModelRelease = { ...slidingGateV1, id: "sliding-gate@2", version: 2 };

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** The golden three-instance site, roster on the v1 ids (the I3 baseline). */
const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

interface UpgradeItems {
  items: { modelId: string; pinnedReleaseId: string; latestReleaseId: string }[];
}
interface Assignments {
  organizationId: string;
  releaseIds: string[];
  pins: { modelId: string; pinnedReleaseId: string }[];
}
interface BroadcastResult {
  releaseId: string;
  assignedOrgIds: string[];
  skippedOrgIds: string[];
}

describe("vendor broadcast upgrade-offer fan-out (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let userA: TestUser; // orgA — stays on gate@1 (a target)
  let userB: TestUser; // orgB — already opted into gate@2 (NOT a target)
  let userC: TestUser; // orgC — on a different model (NOT a target)
  let orgA: string;
  let orgB: string;
  let orgC: string;
  let quoteId: string; // orgA's golden quote, stamped on sliding-gate@1

  const postAs = (u: TestUser, url: string, payload: Record<string, unknown> = {}) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });
  const upgradesOf = async (u: TestUser): Promise<UpgradeItems["items"]> =>
    ((await getAs(u, "/v1/releases/upgrades")).json() as UpgradeItems).items;
  const assignmentsOf = async (orgId: string): Promise<Assignments> =>
    (await getAs(platform, `/v1/platform/organizations/${orgId}/releases`)).json() as Assignments;
  /** Broadcast as `u`; the web percent-encodes the natural key in the path. */
  const broadcastAs = (u: TestUser, releaseId: string) =>
    inject(app, {
      method: "POST",
      url: `/v1/platform/releases/${encodeURIComponent(releaseId)}/broadcast`,
      headers: { cookie: u.cookie },
    });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "bc-platform");
    await promotePlatformAdmin(db, platform.id);
    userA = await signUpUser(app, "bc-orgA");
    userB = await signUpUser(app, "bc-orgB");
    userC = await signUpUser(app, "bc-orgC");
    orgA = await orgIdOf(db, userA.id);
    orgB = await orgIdOf(db, userB.id);
    orgC = await orgIdOf(db, userC.id);

    // Publish the corpus + the synthetic gate@2 (shared store — tolerate 409).
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1, slidingGateV2]) {
      const res = await postAs(platform, "/v1/releases", { catalogVersion: 2, body });
      expect([201, 409], JSON.stringify(res.json())).toContain(res.statusCode);
    }

    // orgA: on gate@1 + fence@1 (+ a price table → can issue the I3 baseline).
    await assignReleases(app, platform, orgA, ["sliding-gate@1", "fence-run@1"]);
    expect((await postAs(userA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);

    // orgB: assigned gate@1 then gate@2, and has OPTED IN to gate@2 (pinned @2).
    await assignReleases(app, platform, orgB, ["sliding-gate@1", "sliding-gate@2"]);
    expect(
      (await postAs(userB, "/v1/releases/pin", { releaseId: "sliding-gate@2" })).statusCode,
    ).toBe(201);

    // orgC: a tenant on a DIFFERENT model (fence only) — never a gate target.
    await assignReleases(app, platform, orgC, ["fence-run@1"]);

    // orgA's golden quote on the pinned v1 — the I3 baseline (before any fan-out).
    const issued = await postAs(userA, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    const q = issued.json() as { id: string; total: string };
    expect(q.total).toBe("129891.5");
    quoteId = q.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("baseline: orgA on @1 (no offer), orgB already on @2, orgC has no gate", async () => {
    expect(await upgradesOf(userA)).toHaveLength(0); // @2 not yet available to A
    expect(await upgradesOf(userB)).toHaveLength(0); // already on the latest
    expect((await assignmentsOf(orgA)).pins).toContainEqual({
      modelId: "sliding-gate",
      pinnedReleaseId: "sliding-gate@1",
    });
    expect((await assignmentsOf(orgC)).pins.map((p) => p.modelId)).not.toContain("sliding-gate");
  });

  it("broadcasts gate@2 to every org behind — and ONLY those (model + version scoped)", async () => {
    const res = await broadcastAs(platform, "sliding-gate@2");
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    const result = res.json() as BroadcastResult;

    expect(result.releaseId).toBe("sliding-gate@2");
    // orgA was behind (pinned @1) → newly assigned @2.
    expect(result.assignedOrgIds).toContain(orgA);
    // orgB is current (pinned @2) and orgC is on another model → never targeted.
    expect(result.assignedOrgIds).not.toContain(orgB);
    expect(result.assignedOrgIds).not.toContain(orgC);
    expect(result.skippedOrgIds).not.toContain(orgB);
    expect(result.skippedOrgIds).not.toContain(orgC);
  });

  it("the fan-out raised an opt-in offer for orgA WITHOUT moving its pin (§3)", async () => {
    // gate@2 is now available to orgA, but its active version is still @1.
    const a = await assignmentsOf(orgA);
    expect(a.releaseIds).toContain("sliding-gate@1");
    expect(a.releaseIds).toContain("sliding-gate@2");
    expect(a.pins).toContainEqual({ modelId: "sliding-gate", pinnedReleaseId: "sliding-gate@1" });

    const offers = await upgradesOf(userA);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      modelId: "sliding-gate",
      pinnedReleaseId: "sliding-gate@1",
      latestReleaseId: "sliding-gate@2",
    });
  });

  it("orgB (already current) and orgC (other model) are untouched", async () => {
    expect(await upgradesOf(userB)).toHaveLength(0);
    expect((await assignmentsOf(orgB)).pins).toContainEqual({
      modelId: "sliding-gate",
      pinnedReleaseId: "sliding-gate@2",
    });
    expect((await assignmentsOf(orgC)).releaseIds).not.toContain("sliding-gate@2");
  });

  it("I3 ≠ broadcast: orgA's quote on @1 still reproduces byte-identically", async () => {
    const verify = await postAs(userA, `/v1/quotes/${quoteId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId, reproduced: true, mismatches: [] });
  });

  it("is idempotent: a re-broadcast skips the still-behind org and changes nothing", async () => {
    const res = await broadcastAs(platform, "sliding-gate@2");
    expect(res.statusCode).toBe(201);
    const result = res.json() as BroadcastResult;
    // orgA already has @2 now (still pinned @1, so still in the target set) →
    // reported as SKIPPED, not assigned; the offer is unchanged.
    expect(result.assignedOrgIds).not.toContain(orgA);
    expect(result.skippedOrgIds).toContain(orgA);
    expect(await upgradesOf(userA)).toHaveLength(1);
  });

  it("once orgA opts in, it drops out of the target set (no longer behind)", async () => {
    expect(
      (await postAs(userA, "/v1/releases/pin", { releaseId: "sliding-gate@2" })).statusCode,
    ).toBe(201);
    expect(await upgradesOf(userA)).toHaveLength(0);

    const res = await broadcastAs(platform, "sliding-gate@2");
    expect(res.statusCode).toBe(201);
    const result = res.json() as BroadcastResult;
    expect(result.assignedOrgIds).not.toContain(orgA);
    expect(result.skippedOrgIds).not.toContain(orgA); // not even targeted
  });

  it("is platform-only and validates the release", async () => {
    // A tenant admin cannot broadcast.
    expect((await broadcastAs(userA, "sliding-gate@2")).statusCode).toBe(403);
    // Anonymous.
    expect(
      (
        await inject(app, {
          method: "POST",
          url: `/v1/platform/releases/${encodeURIComponent("sliding-gate@2")}/broadcast`,
        })
      ).statusCode,
    ).toBe(401);
    // Unknown release → 404 (before any write).
    expect((await broadcastAs(platform, "ghost-model@9")).statusCode).toBe(404);

    // Unpublished (draft) release → 409 (before any write). Drafts aren't
    // reachable via the publish API (it always freezes status=published), so
    // seed one directly; the broadcast must reject on status, not fan anything out.
    await db
      .insert(release)
      .values({
        releaseId: "bc-draft-gate@1",
        modelId: "bc-draft-gate",
        version: 1,
        catalogVersion: 2,
        status: "draft",
        body: slidingGateV1,
      })
      .onConflictDoNothing();
    expect((await broadcastAs(platform, "bc-draft-gate@1")).statusCode).toBe(409);
  });
});
