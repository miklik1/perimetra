import { afterEach, describe, expect, it } from "vitest";

import { type MeResponse } from "@repo/validators";

import { resetSessions } from "./fixtures/session";
import { resetMockUsers } from "./fixtures/users";
import { createMockConfig, resolveMock } from "./index";

const config = createMockConfig({ overrides: { delayRange: undefined } });

const SESSION_COOKIE = "better-auth.session_token";

function request(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** The `name=value` head of a `Set-Cookie` string, ready to send back as `Cookie`. */
function cookieFrom(res: { headers: Record<string, string> }): string {
  return res.headers["Set-Cookie"]!.split(";")[0]!;
}

afterEach(() => {
  resetSessions();
  resetMockUsers();
});

describe("Better Auth auth mock flow via resolveMock", () => {
  it("sign-in/email authenticates and sets the better-auth session cookie", async () => {
    const res = await resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      redirect: boolean;
      token: string;
      user: { email: string; createdAt: string };
    };
    expect(body.redirect).toBe(false);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe("ada@example.com");
    // `useAuth` runs `new Date(createdAt).toISOString()` — a bad date throws.
    expect(Number.isNaN(new Date(body.user.createdAt).getTime())).toBe(false);
    // Exact dev cookie NAME the Next proxy gate (`hasSessionCookie`) recognizes.
    expect(res.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=`);
    expect(res.headers["Set-Cookie"]).toContain("HttpOnly");
  });

  it("get-session returns { session, user } for a live cookie and null otherwise", async () => {
    const signIn = await resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    const cookie = cookieFrom(signIn);

    const anon = await resolveMock(request("GET", "/api/auth/get-session"), config);
    expect(anon.status).toBe(200);
    expect(anon.body).toBeNull(); // literal null body, not a 401 — Better Auth's shape

    const session = await resolveMock(
      request("GET", "/api/auth/get-session", { headers: { Cookie: cookie } }),
      config,
    );
    expect(session.status).toBe(200);
    const sBody = session.body as {
      user: { id: string; email: string };
      session: { userId: string; token: string };
    };
    expect(sBody.user.email).toBe("ada@example.com");
    expect(sBody.session.userId).toBe(sBody.user.id);
  });

  it("/v1/me re-auths off the session cookie (not a bearer) and 401s without it", async () => {
    const signIn = await resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    const cookie = cookieFrom(signIn);

    const me = await resolveMock(
      request("GET", "/api/v1/me", { headers: { Cookie: cookie } }),
      config,
    );
    expect(me.status).toBe(200);
    const meBody = me.body as MeResponse;
    expect(meBody.email).toBe("ada@example.com");
    // Exactly `meResponseSchema`'s keys (perimetra widens the upstream four-key
    // `userSchema` with the org `role` + `isPlatformAdmin`, ADR 0056/0062). The
    // Better Auth `admin()`/`twoFactor()` plugin fields the real `MeController`
    // field-picks away (banned/banReason/banExpires/twoFactorEnabled) must not
    // appear here either — an exact key list is what catches that leak.
    expect(Object.keys(meBody).sort()).toEqual([
      "createdAt",
      "email",
      "id",
      "isPlatformAdmin",
      "name",
      "role",
    ]);
    // Mock mode is single-tenant: the mock user owns their org, and the vendor
    // console is a real-stack-only surface.
    expect(meBody.role).toBe("admin");
    expect(meBody.isPlatformAdmin).toBe(false);

    const noAuth = await resolveMock(request("GET", "/api/v1/me"), config);
    expect(noAuth.status).toBe(401);
  });

  it("sign-out clears the cookie and drops the session", async () => {
    const signIn = await resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    const cookie = cookieFrom(signIn);

    const out = await resolveMock(
      request("POST", "/api/auth/sign-out", { headers: { Cookie: cookie } }),
      config,
    );
    expect(out.status).toBe(200);
    expect((out.body as { success: boolean }).success).toBe(true);
    expect(out.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=`);
    expect(out.headers["Set-Cookie"]).toContain("Max-Age=0");

    const after = await resolveMock(
      request("GET", "/api/auth/get-session", { headers: { Cookie: cookie } }),
      config,
    );
    expect(after.body).toBeNull();
  });

  it("sign-up/email creates an account, auto-signs-in, and rejects a duplicate", async () => {
    const created = await resolveMock(
      request("POST", "/api/auth/sign-up/email", {
        body: { name: "Grace Hopper", email: "grace@example.com", password: "password123" },
      }),
      config,
    );
    expect(created.status).toBe(200);
    const body = created.body as { token: string; user: { email: string } };
    expect(body.user.email).toBe("grace@example.com");
    expect(created.headers["Set-Cookie"]).toContain(`${SESSION_COOKIE}=`);

    // The freshly-created account authenticates on its issued cookie.
    const me = await resolveMock(
      request("GET", "/api/v1/me", { headers: { Cookie: cookieFrom(created) } }),
      config,
    );
    expect((me.body as { email: string }).email).toBe("grace@example.com");

    const dup = await resolveMock(
      request("POST", "/api/auth/sign-up/email", {
        body: { name: "Grace II", email: "grace@example.com", password: "password123" },
      }),
      config,
    );
    expect(dup.status).toBe(422);
    expect((dup.body as { code: string }).code).toBe("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
  });

  it("rejects bad credentials with a 401 INVALID_EMAIL_OR_PASSWORD envelope", async () => {
    const res = await resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "wrong" },
      }),
      config,
    );
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("rejects malformed sign-in input with a 401", async () => {
    const res = await resolveMock(
      request("POST", "/api/auth/sign-in/email", { body: { email: "x" } }),
      config,
    );
    expect(res.status).toBe(401);
  });

  it("404s an unknown path", async () => {
    const res = await resolveMock(request("GET", "/api/nope", {}), config);
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe("NOT_FOUND");
  });
});

describe("users mock routes", () => {
  it("lists users, fetches one, and 404s an unknown id", async () => {
    const list = await resolveMock(request("GET", "/api/users"), config);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const id = (list.body as { id: string }[])[0]!.id;

    const one = await resolveMock(request("GET", `/api/users/${id}`), config);
    expect(one.status).toBe(200);
    expect((one.body as { id: string }).id).toBe(id);

    const missing = await resolveMock(request("GET", "/api/users/nope"), config);
    expect(missing.status).toBe(404);
  });

  it("creates a user (201) and rejects invalid input (422)", async () => {
    const created = await resolveMock(
      request("POST", "/api/users", { body: { name: "Grace Hopper", email: "grace@example.com" } }),
      config,
    );
    expect(created.status).toBe(201);
    expect((created.body as { email: string }).email).toBe("grace@example.com");

    const bad = await resolveMock(request("POST", "/api/users", { body: { name: "" } }), config);
    expect(bad.status).toBe(422);
  });
});

describe("users pagination mock", () => {
  it("pages with nextPage and matches /users/paged before /users/:id", async () => {
    const p1 = await resolveMock(request("GET", "/api/users/paged?page=1&perPage=10"), config);
    expect(p1.status).toBe(200);
    const body1 = p1.body as { data: unknown[]; nextPage: number | null };
    expect(body1.data).toHaveLength(10);
    expect(body1.nextPage).toBe(2);

    // Last page: 47 total, perPage 10 → page 5 has 7 rows and nextPage null.
    const p5 = await resolveMock(request("GET", "/api/users/paged?page=5&perPage=10"), config);
    const body5 = p5.body as { data: unknown[]; nextPage: number | null };
    expect(body5.data).toHaveLength(7);
    expect(body5.nextPage).toBeNull();
  });
});

describe("cookieLess session isolation", () => {
  const signIn = (cfg: typeof config) =>
    resolveMock(
      request("POST", "/api/auth/sign-in/email", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      cfg,
    );

  it("BFF (cookieLess false): a cookieless get-session returns null even after a sign-in", async () => {
    await signIn(config); // sets lastSession
    const session = await resolveMock(request("GET", "/api/auth/get-session"), config); // no cookie
    expect(session.body).toBeNull(); // no fallback — no cross-user bleed
  });

  it("MSW (cookieLess true): a cookieless get-session falls back to the last sign-in", async () => {
    const cookieLessConfig = { ...config, cookieLess: true };
    await signIn(cookieLessConfig);
    const session = await resolveMock(request("GET", "/api/auth/get-session"), cookieLessConfig);
    const body = session.body as { user: { email: string } } | null;
    expect(body?.user.email).toBe("ada@example.com");
  });
});
