/**
 * Org invite + member-sharing lifecycle at the HTTP layer against the real
 * containers (ADR 0057). Drives Better Auth's organization endpoints (mounted
 * at `/api/auth/organization/*`, outside Nest) and asserts the custom `ac`/role
 * gate + the cross-user membership it produces:
 *
 *   - owner/admin CAN invite; a workshop member CANNOT (the ac, not RolesGuard)
 *   - an invited user accepts and becomes a `sales` member of the inviting org
 *   - the active-org default is deterministic: a fresh login lands the now
 *     multi-org invitee back in their OWN org (owner → admin at `/v1/me`)
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { invitation, member } from "@repo/db/schema/auth";

import { DB } from "../src/common/db/db.module.js";
import {
  cookieFrom,
  createApiApp,
  inject,
  signUpUser,
  webOrigin,
  type TestUser,
} from "./setup/app.js";

describe("org invite + member sharing (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let admin: TestUser;
  let adminOrgId: string;

  const authPost = (u: TestUser | null, url: string, payload: Record<string, unknown>) =>
    inject(app, {
      method: "POST",
      url,
      headers: { origin: webOrigin(), ...(u ? { cookie: u.cookie } : {}) },
      payload,
    });
  const setRole = (userId: string, orgId: string, role: string) =>
    db
      .update(member)
      .set({ role })
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    admin = await signUpUser(app, "invite-admin"); // owner → admin, own org
    const [row] = await db.select().from(member).where(eq(member.userId, admin.id));
    adminOrgId = row!.organizationId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin invites a member; the invitation is persisted as pending/sales", async () => {
    const email = `invitee-${adminOrgId.slice(0, 6)}@itest.example`;
    const res = await authPost(admin, "/api/auth/organization/invite-member", {
      email,
      role: "sales",
    });
    expect(res.statusCode, res.body).toBe(200);
    const created = res.json() as { id: string; role: string };
    expect(created.role).toBe("sales");

    const [inv] = await db.select().from(invitation).where(eq(invitation.id, created.id));
    expect(inv?.status).toBe("pending");
    expect(inv?.role).toBe("sales");
    expect(inv?.organizationId).toBe(adminOrgId);
  });

  it("a workshop member cannot invite (the ac gate, not RolesGuard)", async () => {
    await setRole(admin.id, adminOrgId, "workshop");
    const res = await authPost(admin, "/api/auth/organization/invite-member", {
      email: `denied-${adminOrgId.slice(0, 6)}@itest.example`,
      role: "sales",
    });
    expect(res.statusCode).toBe(403);
    await setRole(admin.id, adminOrgId, "owner"); // restore
  });

  it("an invited user accepts and becomes a member of the inviting org", async () => {
    // The invitee signs up first (gets their OWN org); Better Auth's accept
    // checks the logged-in user's email matches the invitation, so invite THAT.
    const invitee = await signUpUser(app, "invitee");
    const invited = await authPost(admin, "/api/auth/organization/invite-member", {
      email: invitee.email,
      role: "workshop",
    });
    expect(invited.statusCode, invited.body).toBe(200);
    const invitationId = (invited.json() as { id: string }).id;

    const accepted = await authPost(invitee, "/api/auth/organization/accept-invitation", {
      invitationId,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    // They are now a workshop member of the ADMIN's org…
    const [joined] = await db
      .select()
      .from(member)
      .where(and(eq(member.userId, invitee.id), eq(member.organizationId, adminOrgId)));
    expect(joined?.role).toBe("workshop");

    // …while still owning their own org (two memberships now).
    const all = await db.select().from(member).where(eq(member.userId, invitee.id));
    expect(all.length).toBe(2);

    // Determinism (ADR 0057): a FRESH login lands them in their OWN (owner) org,
    // so `/v1/me` reads admin — not the workshop role they hold elsewhere.
    const signIn = await authPost(null, "/api/auth/sign-in/email", {
      email: invitee.email,
      password: invitee.password,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    const me = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: cookieFrom(signIn) },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { role: string }).role).toBe("admin");
  });

  it("invite-first: a user invited BEFORE signup gets no personal org and lands in the inviting org", async () => {
    // The ADR 0057 wart, fixed (ADR 0058): when the invite exists at signup
    // time, the session hook suppresses personal-org provisioning, so the
    // invitee never carries a dead workspace and lands straight in the org.
    const email = `invitefirst-${adminOrgId.slice(0, 6)}@itest.example`;

    // 1) admin invites the email FIRST — no account exists for it yet.
    const invited = await authPost(admin, "/api/auth/organization/invite-member", {
      email,
      role: "sales",
    });
    expect(invited.statusCode, invited.body).toBe(200);
    const invitationId = (invited.json() as { id: string }).id;

    // 2) the invitee signs up at THAT email — provisioning is suppressed, so
    //    they have ZERO memberships (no personal org) right after signup…
    const invitee = await signUpUser(app, "invitefirst", { email });
    const before = await db.select().from(member).where(eq(member.userId, invitee.id));
    expect(before.length).toBe(0);

    // …and their org-less first session fail-closed 403s on a scoped endpoint.
    const meBefore = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: invitee.cookie },
    });
    expect(meBefore.statusCode).toBe(403);

    // 3) accept → exactly ONE membership: the inviting org, as sales.
    const accepted = await authPost(invitee, "/api/auth/organization/accept-invitation", {
      invitationId,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const after = await db.select().from(member).where(eq(member.userId, invitee.id));
    expect(after.length).toBe(1);
    expect(after[0]!.organizationId).toBe(adminOrgId);
    expect(after[0]!.role).toBe("sales");

    // 3b) Same-session recovery (ADR 0058): acceptInvitation stamps the active
    //     org on the session ROW but not the cached `session_data` cookie, so a
    //     suppressed invitee's stale cookie is still org-less. The web client
    //     forces a cache-bypassing session read after accept to re-stamp it;
    //     prove that read resolves the invited org (the scope the re-stamped
    //     cookie carries — so `/team` is correctly scoped, no stale 403).
    const refreshed = await inject(app, {
      method: "GET",
      url: "/api/auth/get-session?disableCookieCache=true",
      headers: { cookie: invitee.cookie },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(
      (refreshed.json() as { session: { activeOrganizationId: string } }).session
        .activeOrganizationId,
    ).toBe(adminOrgId);

    // 4) a FRESH login lands them in the inviting org (no owner org to prefer),
    //    so `/v1/me` reads their sales role there — never a dead personal org.
    const signIn = await authPost(null, "/api/auth/sign-in/email", {
      email: invitee.email,
      password: invitee.password,
    });
    expect(signIn.statusCode, signIn.body).toBe(200);
    const me = await inject(app, {
      method: "GET",
      url: "/v1/me",
      headers: { cookie: cookieFrom(signIn) },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { role: string }).role).toBe("sales");
  });
});
