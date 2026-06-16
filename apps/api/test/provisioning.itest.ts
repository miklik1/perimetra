/**
 * New-org default provisioning (ADR 0063) at the HTTP layer against the real
 * containers. Proves a genuinely-new org lands with the vendor-configured
 * default release set instead of empty:
 *
 *   - A fresh owner is auto-assigned exactly the published ids in
 *     `PLATFORM_DEFAULT_RELEASE_IDS` (sliding-gate@1) — NOT fence-run@1, which is
 *     published but left out of the set (proving it's the CONFIGURED set, not
 *     "all published").
 *   - FAIL-SOFT: an UNPUBLISHABLE id in the default set (nonexistent-release@99)
 *     is skipped without blocking signup — the signup still returns 200 and the
 *     org lands with only the valid release. (The global release store is shared
 *     across itest files, so a "before publish" premise is unsound; an id no file
 *     ever publishes is the deterministic fail-soft subject.)
 *   - IDEMPOTENT: a second session for the same owner doesn't re-provision or
 *     duplicate the assignment.
 *   - INVITE-FIRST: a user invited before signup gets no personal org at all, so
 *     the provisioning hook (which sits AFTER the invite-first early-return)
 *     never assigns them a default-assigned workspace.
 *
 * The default set is injected via `overrideProvider(ENV)` (the sanctioned
 * testing hook) — `PLATFORM_DEFAULT_RELEASE_IDS` is boot-parsed env.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import { catalogV2, fenceRunV1, slidingGateV1 } from "@repo/fixtures";

import { ENV, loadEnv } from "../src/common/config/env.js";
import { DB } from "../src/common/db/db.module.js";
import {
  cookieFrom,
  createApiApp,
  inject,
  promotePlatformAdmin,
  signUpUser,
  webOrigin,
  type TestUser,
} from "./setup/app.js";

interface ReleaseItems {
  items: { id: string; releaseId: string }[];
}

describe("new-org default provisioning (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // owns an org (to invite from) + promoted vendor

  const authPost = (u: TestUser | null, url: string, payload: Record<string, unknown>) =>
    inject(app, {
      method: "POST",
      url,
      headers: { origin: webOrigin(), ...(u ? { cookie: u.cookie } : {}) },
      payload,
    });
  const releaseIdsOf = async (cookie: string): Promise<string[]> => {
    const res = await inject(app, { method: "GET", url: "/v1/releases", headers: { cookie } });
    return (res.json() as ReleaseItems).items.map((r) => r.releaseId);
  };

  beforeAll(async () => {
    // Default set = sliding-gate@1 (valid) + nonexistent-release@99 (never
    // published by any file → the deterministic fail-soft subject). fence-run@1
    // is published below but kept OUT of the set, so "configured set, not
    // all-published" is testable.
    app = await createApiApp((builder) =>
      builder.overrideProvider(ENV).useValue({
        ...loadEnv(),
        PLATFORM_DEFAULT_RELEASE_IDS: ["sliding-gate@1", "nonexistent-release@99"],
      }),
    );
    db = app.get<Db>(DB);

    platform = await signUpUser(app, "prov-platform");
    await promotePlatformAdmin(db, platform.id);

    // Publish the global corpus (shared store — tolerate a sibling file's 409).
    expect([201, 409]).toContain(
      (await authPost(platform, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1]) {
      expect([201, 409]).toContain(
        (await authPost(platform, "/v1/releases", { catalogVersion: 2, body })).statusCode,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("auto-assigns exactly the configured default set (published ids only, fail-soft on the rest)", async () => {
    const fresh = await signUpUser(app, "prov-fresh");
    // sliding-gate@1: configured + published → assigned.
    // fence-run@1: published but NOT in the set → excluded (configured, not all).
    // nonexistent-release@99: in the set but never published → fail-soft skipped,
    //   yet signUpUser returned 200 (the failed assign never blocked the session).
    expect(await releaseIdsOf(fresh.cookie)).toEqual(["sliding-gate@1"]);
  });

  it("re-login does not re-provision or duplicate the assignment (idempotent)", async () => {
    const owner = await signUpUser(app, "prov-idem");
    expect(await releaseIdsOf(owner.cookie)).toEqual(["sliding-gate@1"]);

    // A SECOND session for the same owner finds an existing membership → the
    // provisioning branch is skipped entirely; the assignment stays singular.
    const signIn = await authPost(null, "/api/auth/sign-in/email", {
      email: owner.email,
      password: owner.password,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    expect(await releaseIdsOf(cookieFrom(signIn))).toEqual(["sliding-gate@1"]);

    // The genuine-new-owner branch (which creates an org + owner membership, and
    // is where provisioning lives) did NOT re-run on the second session — else
    // the owner would now have a SECOND org. Exactly one membership ⇒ the
    // provisioning path is reached once per org lifetime, not per login. (A list
    // assertion alone can't prove this — `assign` is ON CONFLICT idempotent, so a
    // re-run would leave the list unchanged; the membership count is the tell.)
    const memberships = await db.select().from(member).where(eq(member.userId, owner.id));
    expect(memberships).toHaveLength(1);
  });

  it("an invite-first user is never provisioned a default-assigned personal org", async () => {
    // Invite an email FIRST (platform owns an org → can invite), then sign up at
    // it. Invite-first suppression returns BEFORE the genuine-owner branch where
    // provisioning lives, so the invitee gets no personal org — and no default
    // assignment — at all.
    const email = `prov-invitefirst-${platform.id.slice(0, 12)}@itest.example`;
    const invited = await authPost(platform, "/api/auth/organization/invite-member", {
      email,
      role: "sales",
    });
    expect(invited.statusCode, invited.body).toBe(200);

    const invitee = await signUpUser(app, "prov-invitefirst", { email });
    const memberships = await db.select().from(member).where(eq(member.userId, invitee.id));
    expect(memberships).toHaveLength(0); // no personal org → the provisioning hook never ran
  });
});
