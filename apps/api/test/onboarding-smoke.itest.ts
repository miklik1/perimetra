/**
 * Fabricator-team onboarding smoke test (CAR-17) — an api INTEGRATION TEST
 * only, no production code change. Walks the FULL onboarding flow end-to-end
 * against the real containers, exercising the same session-hook machinery
 * `org-invite.itest.ts` proves piecewise (ADR 0057/0058): owner signup →
 * invite sales+workshop BEFORE they exist → each signs up (invite-first
 * suppression) → each accepts → the daily-loop reads (list quotes,
 * price-blind price-tables) → next-login stability. A second describe covers
 * the OTHER onboarding order (invited AFTER signup) and pins the documented
 * ADR 0058 wart.
 *
 * Idioms follow `org-invite.itest.ts` exactly: `createApiApp`/`inject` against
 * the real Better Auth mount (`/api/auth/organization/*`), invitation ids read
 * straight off the HTTP response (email delivery is a stub — Mailpit is never
 * consulted here), drizzle reads via `app.get<Db>(DB)` for ground truth.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { invitation, member } from "@repo/db/schema/auth";

import { DB } from "../src/common/db/db.module.js";
import {
  cookieFrom,
  createApiApp,
  inject,
  orgIdOf,
  signUpUser,
  webOrigin,
  type TestUser,
} from "./setup/app.js";

describe("fabricator-team onboarding smoke (HTTP, real stack) — CAR-17", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let owner: TestUser;
  let ownerOrgId: string;
  let sales: TestUser;
  let workshop: TestUser;
  let salesInvitationId: string;
  let workshopInvitationId: string;

  const salesEmail = `car17-sales-${Date.now()}@itest.example`;
  const workshopEmail = `car17-workshop-${Date.now()}@itest.example`;

  const authPost = (u: TestUser | null, url: string, payload: Record<string, unknown>) =>
    inject(app, {
      method: "POST",
      url,
      headers: { origin: webOrigin(), ...(u ? { cookie: u.cookie } : {}) },
      payload,
    });
  const authGet = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
  });

  afterAll(async () => {
    await app.close();
  });

  it("1) the owner signs up — auto-provisioned personal org, owner role", async () => {
    owner = await signUpUser(app, "car17-owner");
    ownerOrgId = await orgIdOf(db, owner.id);

    const [row] = await db.select().from(member).where(eq(member.userId, owner.id));
    expect(row?.role).toBe("owner");
    expect(row?.organizationId).toBe(ownerOrgId);
  });

  it("2) the owner invites sales@ and workshop@ before either account exists", async () => {
    const salesInvite = await authPost(owner, "/api/auth/organization/invite-member", {
      email: salesEmail,
      role: "sales",
    });
    expect(salesInvite.statusCode, salesInvite.body).toBe(200);
    salesInvitationId = (salesInvite.json() as { id: string; role: string }).id;
    expect((salesInvite.json() as { role: string }).role).toBe("sales");

    const workshopInvite = await authPost(owner, "/api/auth/organization/invite-member", {
      email: workshopEmail,
      role: "workshop",
    });
    expect(workshopInvite.statusCode, workshopInvite.body).toBe(200);
    workshopInvitationId = (workshopInvite.json() as { id: string; role: string }).id;
    expect((workshopInvite.json() as { role: string }).role).toBe("workshop");

    const rows = await db
      .select()
      .from(invitation)
      .where(inArray(invitation.id, [salesInvitationId, workshopInvitationId]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.organizationId).toBe(ownerOrgId);
    }
  });

  it("3) each invitee signs up fresh — invite-first suppression: zero memberships, org-less session", async () => {
    sales = await signUpUser(app, "car17-sales", { email: salesEmail });
    workshop = await signUpUser(app, "car17-workshop", { email: workshopEmail });

    // Documented behavior (ADR 0058): a pending invite at signup time
    // suppresses personal-org provisioning entirely — the session hook
    // returns early, so there is NO owner membership (indeed no membership at
    // all) for either invitee yet.
    const salesMembersBefore = await db.select().from(member).where(eq(member.userId, sales.id));
    expect(salesMembersBefore).toHaveLength(0);
    const workshopMembersBefore = await db
      .select()
      .from(member)
      .where(eq(member.userId, workshop.id));
    expect(workshopMembersBefore).toHaveLength(0);

    // The org-less session fail-closed 403s a scoped endpoint (RolesGuard has
    // no org to resolve a role against) — same contract org-invite.itest.ts
    // pins for the invite-first case.
    expect((await authGet(sales, "/v1/me")).statusCode).toBe(403);
    expect((await authGet(workshop, "/v1/me")).statusCode).toBe(403);
  });

  it("4) each accepts — membership lands in the OWNER's org with the invited role", async () => {
    const salesAccept = await authPost(sales, "/api/auth/organization/accept-invitation", {
      invitationId: salesInvitationId,
    });
    expect(salesAccept.statusCode, salesAccept.body).toBe(200);
    const workshopAccept = await authPost(workshop, "/api/auth/organization/accept-invitation", {
      invitationId: workshopInvitationId,
    });
    expect(workshopAccept.statusCode, workshopAccept.body).toBe(200);

    const [salesRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, sales.id), eq(member.organizationId, ownerOrgId)));
    expect(salesRow?.role).toBe("sales");
    const [workshopRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, workshop.id), eq(member.organizationId, ownerOrgId)));
    expect(workshopRow?.role).toBe("workshop");

    // Exactly one membership each — the accept stamped the ONLY org they
    // belong to, never a leftover/dead personal org (there is none — signup
    // provisioning was suppressed in step 3).
    expect(await db.select().from(member).where(eq(member.userId, sales.id))).toHaveLength(1);
    expect(await db.select().from(member).where(eq(member.userId, workshop.id))).toHaveLength(1);

    // Any-membership fallback (ADR 0057): the owner-membership preference
    // does not apply to either invitee (they own nothing), so a FRESH
    // sign-in lands activeOrganizationId at the owner's org.
    const salesSignIn = await authPost(null, "/api/auth/sign-in/email", {
      email: sales.email,
      password: sales.password,
    });
    expect(salesSignIn.statusCode, salesSignIn.body).toBe(200);
    sales = { ...sales, cookie: cookieFrom(salesSignIn) };
    const salesSession = await inject(app, {
      method: "GET",
      url: "/api/auth/get-session?disableCookieCache=true",
      headers: { cookie: sales.cookie },
    });
    expect(salesSession.statusCode, salesSession.body).toBe(200);
    expect(
      (salesSession.json() as { session: { activeOrganizationId: string } }).session
        .activeOrganizationId,
    ).toBe(ownerOrgId);

    const workshopSignIn = await authPost(null, "/api/auth/sign-in/email", {
      email: workshop.email,
      password: workshop.password,
    });
    expect(workshopSignIn.statusCode, workshopSignIn.body).toBe(200);
    workshop = { ...workshop, cookie: cookieFrom(workshopSignIn) };
    const workshopSession = await inject(app, {
      method: "GET",
      url: "/api/auth/get-session?disableCookieCache=true",
      headers: { cookie: workshop.cookie },
    });
    expect(workshopSession.statusCode, workshopSession.body).toBe(200);
    expect(
      (workshopSession.json() as { session: { activeOrganizationId: string } }).session
        .activeOrganizationId,
    ).toBe(ownerOrgId);
  });

  it("5) daily-loop reads: sales lists quotes, workshop is price-blind, /v1/me role is correct", async () => {
    const salesQuotes = await authGet(sales, "/v1/quotes");
    expect(salesQuotes.statusCode, salesQuotes.body).toBe(200);

    // Workshop CAN read the quote list (no class-level RequireRole on
    // QuotesController's GET) — the price-blind contract is enforced deeper
    // (per-field stripping on a priced read), not by refusing the list.
    const workshopQuotes = await authGet(workshop, "/v1/quotes");
    expect(workshopQuotes.statusCode, workshopQuotes.body).toBe(200);

    // The deterministic price-blind-by-absence surface (ADR 0056): the WHOLE
    // price-tables controller is role-gated to admin+sales, so workshop is
    // 403'd outright on a priced read — no price table needs to exist for
    // this to hold.
    const workshopPrices = await authGet(workshop, "/v1/price-tables/active");
    expect(workshopPrices.statusCode).toBe(403);
    // Sales — the other invited role — CAN reach the same endpoint (may 404 for
    // "no active price table" rather than 403; the point is it's not role-blocked).
    const salesPrices = await authGet(sales, "/v1/price-tables/active");
    expect(salesPrices.statusCode).not.toBe(403);

    const salesMe = await authGet(sales, "/v1/me");
    expect(salesMe.statusCode).toBe(200);
    expect((salesMe.json() as { role: string }).role).toBe("sales");

    const workshopMe = await authGet(workshop, "/v1/me");
    expect(workshopMe.statusCode).toBe(200);
    expect((workshopMe.json() as { role: string }).role).toBe("workshop");
  });

  it("6) next-login stability: sales signs in again — still lands in the owner's org", async () => {
    const signIn = await authPost(null, "/api/auth/sign-in/email", {
      email: sales.email,
      password: sales.password,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    const cookie = cookieFrom(signIn);

    const session = await inject(app, {
      method: "GET",
      url: "/api/auth/get-session?disableCookieCache=true",
      headers: { cookie },
    });
    expect(
      (session.json() as { session: { activeOrganizationId: string } }).session
        .activeOrganizationId,
    ).toBe(ownerOrgId);

    const me = await inject(app, { method: "GET", url: "/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { role: string }).role).toBe("sales");
  });
});

describe("fabricator-team onboarding smoke — invited AFTER signup (ADR 0058 wart)", () => {
  // The OTHER onboarding order: the user signs up on their own FIRST (gets a
  // personal org, owner role) and is invited + accepts afterwards. This is
  // documented as intended-but-unfortunate (ADR 0058): the owner-membership
  // preference in the session hook means a fresh login prefers the org they
  // OWN over the one they were invited into — so they keep landing in their
  // own (now-orphaned) personal org and must switch per session to reach the
  // inviting org. Fixed later by the onboarding fork (CAR-26) — NOT fixed
  // here; this test PINS the current documented behavior, it does not assert
  // the eventual fix.
  let app: NestFastifyApplication;
  let db: Db;
  let owner: TestUser;
  let ownerOrgId: string;
  let invitee: TestUser;
  let inviteeOwnOrgId: string;

  const authPost = (u: TestUser | null, url: string, payload: Record<string, unknown>) =>
    inject(app, {
      method: "POST",
      url,
      headers: { origin: webOrigin(), ...(u ? { cookie: u.cookie } : {}) },
      payload,
    });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    owner = await signUpUser(app, "car17-late-owner");
    ownerOrgId = await orgIdOf(db, owner.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it("signs up first (own org), is invited + accepts, and the personal org is RETAINED", async () => {
    invitee = await signUpUser(app, "car17-late-invitee");
    inviteeOwnOrgId = await orgIdOf(db, invitee.id);
    expect(inviteeOwnOrgId).not.toBe(ownerOrgId);

    const invited = await authPost(owner, "/api/auth/organization/invite-member", {
      email: invitee.email,
      role: "sales",
    });
    expect(invited.statusCode, invited.body).toBe(200);
    const invitationId = (invited.json() as { id: string }).id;

    const accepted = await authPost(invitee, "/api/auth/organization/accept-invitation", {
      invitationId,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    // Two memberships now: the retained personal org (owner) AND the new
    // sales membership in the inviting org — the wart is exactly that the
    // personal org is NEVER cleaned up.
    const rows = await db.select().from(member).where(eq(member.userId, invitee.id));
    expect(rows).toHaveLength(2);
    const own = rows.find((r) => r.organizationId === inviteeOwnOrgId);
    const invited_ = rows.find((r) => r.organizationId === ownerOrgId);
    expect(own?.role).toBe("owner");
    expect(invited_?.role).toBe("sales");

    // Documented wart (ADR 0058): the owner-membership PREFERENCE in the
    // session hook fires first (they own their own org), so a fresh login
    // lands them back in their OWN org — not the org they were just invited
    // into — despite the invited membership being the more RECENT one. Reaching
    // the inviting org needs a per-session switch (not exercised here).
    const signIn = await authPost(null, "/api/auth/sign-in/email", {
      email: invitee.email,
      password: invitee.password,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    const session = await inject(app, {
      method: "GET",
      url: "/api/auth/get-session?disableCookieCache=true",
      headers: { cookie: cookieFrom(signIn) },
    });
    expect(session.statusCode, session.body).toBe(200);
    expect(
      (session.json() as { session: { activeOrganizationId: string } }).session
        .activeOrganizationId,
    ).toBe(inviteeOwnOrgId); // NOT ownerOrgId — the documented wart.

    const me = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: cookieFrom(signIn) },
    });
    expect(me.statusCode).toBe(200);
    // `/v1/me` reads their OWN org's role (owner → admin), not the sales role
    // they hold in the inviting org — the same assertion org-invite.itest.ts
    // makes for this order.
    expect((me.json() as { role: string }).role).toBe("admin");
  });
});
