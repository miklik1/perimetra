/**
 * Per-tenant release visibility (ADR 0062) at the HTTP layer against the real
 * containers. Proves the vendor-assigns model end-to-end:
 *
 *  - PUBLISHING is vendor-only — the platform operator (Better Auth
 *    `user.role='admin'`) may publish releases/catalog; an org admin is 403'd.
 *  - The platform console (`/v1/platform/*`) is platform-only.
 *  - A tenant's `GET /v1/releases` returns ONLY the releases ASSIGNED to its org
 *    — narrowed to the active PIN per model since ADR 0064, but with one version
 *    per model here, pin ≡ assignment (and `GET /:id` 404s an unassigned one — no
 *    body leak, no existence oracle); assignment is org-scoped (A never leaks to B).
 *  - Quote ISSUE is gated by assignment (defense-in-depth — the configurator only
 *    offers assigned releases, this closes the direct-API seam).
 *  - I3 ≠ VISIBILITY: unassigning a release still lets a quote STAMPED on it
 *    re-derive byte-identically — discovery is gated, re-derivation is not.
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

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  createBuyerFor,
  inject,
  orgIdOf,
  promotePlatformAdmin,
  setupLegalProfile,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** The golden three-instance site (gate + two fences), roster by natural key —
 *  MINUS the buyer, which `beforeAll` folds in (mandatory since ADR 0126). The
 *  assignment gate fires BEFORE the buyer guard in `issue`, so the two
 *  `release_not_assigned` 403s below still prove exactly what they always did. */
const baseIssueBody = {
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

describe("per-tenant release visibility (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let userA: TestUser; // orgA admin
  let userB: TestUser; // orgB admin
  let orgA: string;
  let orgB: string;
  let gateId: string; // sliding-gate@1 surrogate id
  let fenceId: string; // fence-run@1 surrogate id
  let quoteId: string; // orgA's golden quote (stamped on both releases)
  /** `baseIssueBody` + orgA's odběratel (mandatory since ADR 0126). */
  let issueBody: Record<string, unknown>;

  const postAs = (u: TestUser, url: string, payload: Record<string, unknown> = {}) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });
  const delAs = (u: TestUser, url: string) =>
    inject(app, { method: "DELETE", url, headers: { cookie: u.cookie } });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "vis-platform");
    await promotePlatformAdmin(db, platform.id);
    userA = await signUpUser(app, "vis-orgA");
    userB = await signUpUser(app, "vis-orgB");
    orgA = await orgIdOf(db, userA.id);
    orgB = await orgIdOf(db, userB.id);

    // Platform publishes the global corpus (shared store — tolerate a sibling's 409).
    expect([201, 409]).toContain(
      (await postAs(platform, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1]) {
      expect([201, 409]).toContain(
        (await postAs(platform, "/v1/releases", { catalogVersion: 2, body })).statusCode,
      );
    }

    // Resolve the release surrogate ids from the platform (global) list.
    const all = (await getAs(platform, "/v1/platform/releases?limit=100")).json() as ReleaseItems;
    gateId = all.items.find((r) => r.releaseId === "sliding-gate@1")!.id;
    fenceId = all.items.find((r) => r.releaseId === "fence-run@1")!.id;

    // orgA needs a price table to issue (per-org, ADR 0055).
    expect((await postAs(userA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    // Issuing requires a legal profile (ADR 0088) and an odběratel (ADR 0126).
    await setupLegalProfile(app, userA);
    issueBody = { ...baseIssueBody, customerId: await createBuyerFor(app, userA) };
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishing is vendor-only; the platform console is platform-only", async () => {
    // Platform re-publish → 409 (PASSED the platform gate; the conflict proves
    // immutability, not a 403 — that is what proves the vendor may publish).
    expect(
      (await postAs(platform, "/v1/releases", { catalogVersion: 2, body: slidingGateV1 }))
        .statusCode,
    ).toBe(409);
    // An org admin is NOT the vendor → 403 on publish (releases + catalog).
    expect(
      (await postAs(userA, "/v1/releases", { catalogVersion: 2, body: slidingGateV1 })).statusCode,
    ).toBe(403);
    expect((await postAs(userA, "/v1/catalog-versions", { body: catalogV2 })).statusCode).toBe(403);
    // The platform console itself is platform-only.
    expect((await getAs(userA, "/v1/platform/organizations")).statusCode).toBe(403);
    expect((await getAs(userA, "/v1/platform/releases")).statusCode).toBe(403);
    expect(
      (await postAs(userA, `/v1/platform/organizations/${orgB}/releases`, { releaseId: "x@1" }))
        .statusCode,
    ).toBe(403);
  });

  it("a tenant sees only its assigned releases (org-scoped, no leak)", async () => {
    // Both orgs start with NO assignments → empty release list.
    expect(((await getAs(userA, "/v1/releases")).json() as ReleaseItems).items).toHaveLength(0);
    expect(((await getAs(userB, "/v1/releases")).json() as ReleaseItems).items).toHaveLength(0);

    // Platform assigns sliding-gate@1 to orgA only.
    expect([200, 201]).toContain(
      (
        await postAs(platform, `/v1/platform/organizations/${orgA}/releases`, {
          releaseId: "sliding-gate@1",
        })
      ).statusCode,
    );

    // orgA now sees exactly sliding-gate@1; orgB still sees nothing.
    const aList = ((await getAs(userA, "/v1/releases")).json() as ReleaseItems).items;
    expect(aList.map((r) => r.releaseId)).toEqual(["sliding-gate@1"]);
    expect(((await getAs(userB, "/v1/releases")).json() as ReleaseItems).items).toHaveLength(0);
  });

  it("GET /:id 404s an unassigned release (no body leak, no existence oracle)", async () => {
    // orgA is assigned sliding-gate@1 (200) but NOT fence-run@1 (404 — same as missing).
    expect((await getAs(userA, `/v1/releases/${gateId}`)).statusCode).toBe(200);
    expect((await getAs(userA, `/v1/releases/${fenceId}`)).statusCode).toBe(404);
  });

  it("quote issue is gated by assignment (defense-in-depth)", async () => {
    // orgA has sliding-gate@1 but NOT fence-run@1 → the golden site is 403.
    const blocked = await postAs(userA, "/v1/quotes", issueBody);
    expect(blocked.statusCode).toBe(403);
    expect((blocked.json() as { code: string }).code).toBe("release_not_assigned");

    // Assign fence-run@1 → the golden site now issues at the golden total.
    expect([200, 201]).toContain(
      (
        await postAs(platform, `/v1/platform/organizations/${orgA}/releases`, {
          releaseId: "fence-run@1",
        })
      ).statusCode,
    );
    const issued = await postAs(userA, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    const q = issued.json() as { id: string; total: string };
    expect(q.total).toBe("134723.5");
    quoteId = q.id;
  });

  it("I3 ≠ visibility: unassigning a release still reproduces its quote", async () => {
    // Unassign sliding-gate@1 from orgA.
    expect(
      (
        await delAs(
          platform,
          `/v1/platform/organizations/${orgA}/releases/${encodeURIComponent("sliding-gate@1")}`,
        )
      ).statusCode,
    ).toBe(200);

    // Discovery now hides it (orgA sees only fence-run@1). The positive assertion
    // guards pin hygiene: unassigning sliding-gate@1 must NOT clear fence-run@1's
    // pin (ADR 0064 — `deletePinByReleaseId` is scoped to the unassigned release).
    const aList = ((await getAs(userA, "/v1/releases")).json() as ReleaseItems).items.map(
      (r) => r.releaseId,
    );
    expect(aList).not.toContain("sliding-gate@1");
    expect(aList).toContain("fence-run@1");

    // But the EXISTING quote (stamped on sliding-gate@1) still re-derives
    // BYTE-IDENTICALLY — re-derivation uses the GLOBAL store, not the assignment.
    const verify = await postAs(userA, `/v1/quotes/${quoteId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId, reproduced: true, mismatches: [] });

    // And re-issuing now fails (sliding-gate@1 no longer assigned).
    const reissue = await postAs(userA, "/v1/quotes", issueBody);
    expect(reissue.statusCode).toBe(403);
    expect((reissue.json() as { code: string }).code).toBe("release_not_assigned");
  });
});
