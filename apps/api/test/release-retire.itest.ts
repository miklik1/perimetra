/**
 * Release RETIRE (CORE_SPEC §3 status `published`→`retired`, ADR 0067) at the
 * HTTP layer against the real containers. Proves the §3 contract "a vendor can
 * take a version out of circulation for NEW work, without breaking anyone
 * already on it or any historical quote":
 *
 *  - One platform action (`POST /v1/platform/releases/:id/retire`) flips a
 *    published release to retired. It is then NO LONGER OFFERED: it cannot be
 *    newly assigned / broadcast / pinned (409), and it drops out of the opt-in
 *    upgrade offers — while a still-published newer version is still offered.
 *  - NON-STRANDING: an org already PINNED to a retired release keeps it in its
 *    configurator list (the active version still works).
 *  - I3 ≠ status: a quote issued on a release reproduces byte-identically AFTER
 *    that exact release is retired (re-derivation is status-agnostic — the body
 *    is never mutated, the row never deleted).
 *  - The GLOBAL platform detail read (`GET /v1/platform/releases/:id`) returns
 *    any release's body even when the operator's own org is not assigned it.
 *  - Idempotent (re-retire → 200, no-op). Platform-only (tenant 403, anon 401);
 *    unknown release 404; non-uuid detail id 400.
 *
 * Uses a DEDICATED throwaway model ("retire-demo") so retiring its versions
 * never pollutes the shared, append-only release store other itests rely on.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
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

/** A dedicated model, body-cloned from the gate (same recipe/ports/catalog@2, so
 *  it validates + derives + connects identically) under a fresh natural key, so
 *  retiring its versions is isolated from every other itest. */
const mk = (version: number): ProductModelRelease => ({
  ...slidingGateV1,
  id: `retire-demo@${version}`,
  modelId: "retire-demo",
  version,
});
const demoV1 = mk(1);
const demoV2 = mk(2);
const demoV3 = mk(3);

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** A three-instance site: the gate slot on the demo model (which we retire), the
 *  fences on the shared fence model — the I3 baseline quote. */
const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "retire-demo@1", input: siteGateConfig },
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
interface ReleasesList {
  items: { releaseId: string }[];
}

describe("release retire (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let userA: TestUser; // orgA — on retire-demo@1, assigned @1/@2/@3
  let orgA: string;
  let demoV1RowId: string; // surrogate uuid of retire-demo@1 (for the detail read)
  let quoteId: string; // orgA's quote stamped on retire-demo@1 (the I3 baseline)

  const postAs = (u: TestUser, url: string, payload: Record<string, unknown> = {}) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });
  const upgradesOf = async (u: TestUser): Promise<UpgradeItems["items"]> =>
    ((await getAs(u, "/v1/releases/upgrades")).json() as UpgradeItems).items;
  const assignmentsOf = async (orgId: string): Promise<Assignments> =>
    (await getAs(platform, `/v1/platform/organizations/${orgId}/releases`)).json() as Assignments;
  /** Retire as `u`; the web percent-encodes the natural key in the path. */
  const retireAs = (u: TestUser, releaseId: string) =>
    inject(app, {
      method: "POST",
      url: `/v1/platform/releases/${encodeURIComponent(releaseId)}/retire`,
      headers: { cookie: u.cookie },
    });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "rt-platform");
    await promotePlatformAdmin(db, platform.id);
    userA = await signUpUser(app, "rt-orgA");
    orgA = await orgIdOf(db, userA.id);

    // Publish catalog@2 + the demo versions + the shared fence (tolerate 409 —
    // the release store is global/append-only across itests).
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [demoV1, demoV2, demoV3, fenceRunV1]) {
      const res = await postAs(platform, "/v1/releases", { catalogVersion: 2, body });
      expect([201, 409], JSON.stringify(res.json())).toContain(res.statusCode);
    }

    // orgA: assigned all demo versions (pin lazily lands on @1, the first) +
    // fence-run@1, with a price table → it can issue the I3 baseline quote.
    await assignReleases(app, platform, orgA, [
      "retire-demo@1",
      "retire-demo@2",
      "retire-demo@3",
      "fence-run@1",
    ]);
    expect((await postAs(userA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);

    const [row] = await db.select().from(release).where(eq(release.releaseId, "retire-demo@1"));
    demoV1RowId = row!.id;

    const issued = await postAs(userA, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    const q = issued.json() as { id: string; total: string };
    // retire-demo@1 is a byte-clone of the gate, so the golden total holds —
    // anchor it, else the I3 reproduce step could vacuously agree on a wrong value.
    expect(q.total).toBe("129891.504");
    quoteId = q.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("baseline: orgA pinned @1, offered the latest published version (@3)", async () => {
    expect((await assignmentsOf(orgA)).pins).toContainEqual({
      modelId: "retire-demo",
      pinnedReleaseId: "retire-demo@1",
    });
    const offers = await upgradesOf(userA);
    const demo = offers.find((o) => o.modelId === "retire-demo");
    expect(demo?.latestReleaseId).toBe("retire-demo@3");
  });

  it("the GLOBAL platform detail read returns a body for an UN-assigned release", async () => {
    // The operator's own org is NOT assigned retire-demo, yet the platform read
    // returns the full body (the tenant GET /v1/releases/:id would 404 it).
    const res = await getAs(platform, `/v1/platform/releases/${demoV1RowId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { releaseId: string; body: { id: string } };
    expect(body.releaseId).toBe("retire-demo@1");
    expect(body.body.id).toBe("retire-demo@1");

    // A well-formed but unknown id → 404; a non-uuid → 400 (ParseUUIDPipe).
    expect(
      (await getAs(platform, "/v1/platform/releases/00000000-0000-4000-8000-000000000000"))
        .statusCode,
    ).toBe(404);
    expect((await getAs(platform, "/v1/platform/releases/not-a-uuid")).statusCode).toBe(400);
  });

  it("retire @3 → it drops as an upgrade target, @2 (still published) becomes the offer", async () => {
    const res = await retireAs(platform, "retire-demo@3");
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    expect((res.json() as { status: string }).status).toBe("retired");

    const offers = await upgradesOf(userA);
    const demo = offers.find((o) => o.modelId === "retire-demo");
    expect(demo?.latestReleaseId).toBe("retire-demo@2"); // @3 excluded, @2 still offered
  });

  it("a retired release cannot be assigned, broadcast, or pinned (409)", async () => {
    // Re-assigning @3 to orgA — the status guard fires before the join.
    expect(
      (
        await postAs(platform, `/v1/platform/organizations/${orgA}/releases`, {
          releaseId: "retire-demo@3",
        })
      ).statusCode,
    ).toBe(409);
    // Broadcasting a retired release.
    expect(
      (
        await postAs(
          platform,
          `/v1/platform/releases/${encodeURIComponent("retire-demo@3")}/broadcast`,
        )
      ).statusCode,
    ).toBe(409);
    // Opting into (pinning) a retired version, as the tenant admin.
    expect(
      (await postAs(userA, "/v1/releases/pin", { releaseId: "retire-demo@3" })).statusCode,
    ).toBe(409);
  });

  it("retire is idempotent: a re-retire is a no-op 200, still retired", async () => {
    const res = await retireAs(platform, "retire-demo@3");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("retired");
  });

  it("is platform-only and validates the release (no state change on rejection)", async () => {
    // A tenant admin cannot retire (would otherwise retire @2 — must NOT).
    expect((await retireAs(userA, "retire-demo@2")).statusCode).toBe(403);
    // Anonymous.
    expect(
      (
        await inject(app, {
          method: "POST",
          url: `/v1/platform/releases/${encodeURIComponent("retire-demo@2")}/retire`,
        })
      ).statusCode,
    ).toBe(401);
    // Unknown release → 404 (before any write).
    expect((await retireAs(platform, "ghost-model@9")).statusCode).toBe(404);
    // A non-published (draft) release → 409. Drafts aren't reachable via the
    // publish API (it always freezes status=published), so seed one directly;
    // only a published release can be retired. Isolated modelId (rt-draft-gate).
    await db
      .insert(release)
      .values({
        releaseId: "rt-draft-gate@1",
        modelId: "rt-draft-gate",
        version: 1,
        catalogVersion: 2,
        status: "draft",
        body: slidingGateV1,
      })
      .onConflictDoNothing();
    expect((await retireAs(platform, "rt-draft-gate@1")).statusCode).toBe(409);
    // @2 is untouched by the rejected calls — still offered as the upgrade.
    const demo = (await upgradesOf(userA)).find((o) => o.modelId === "retire-demo");
    expect(demo?.latestReleaseId).toBe("retire-demo@2");
  });

  it("I3 ≠ status: retiring the quote's exact release, it still reproduces byte-identically", async () => {
    expect((await retireAs(platform, "retire-demo@1")).statusCode).toBe(200);

    const verify = await postAs(userA, `/v1/quotes/${quoteId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId, reproduced: true, mismatches: [] });
  });

  it("non-stranding: orgA stays able to configure the retired version it is pinned to", async () => {
    // Self-contained: ensure @1 is retired (idempotent no-op if a prior test
    // already did). retire-demo@1 is retired AND orgA's active pin — the
    // configurator list (pinned ∧ assigned, status-agnostic) still serves it, so
    // new work is not stranded (the vendor's lever to move tenants off is
    // publish-a-fix + broadcast, not a hard cutoff).
    expect((await retireAs(platform, "retire-demo@1")).statusCode).toBe(200);
    const list = (await getAs(userA, "/v1/releases")).json() as ReleasesList;
    expect(list.items.map((r) => r.releaseId)).toContain("retire-demo@1");
  });
});
