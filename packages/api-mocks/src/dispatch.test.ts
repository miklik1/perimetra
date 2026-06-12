import { afterEach, describe, expect, it } from "vitest";

import { resetSessions } from "./fixtures/session";
import { createMockConfig, resolveMock } from "./index";

const config = createMockConfig({ overrides: { delayRange: undefined } });

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

afterEach(() => resetSessions());

describe("auth mock flow via resolveMock", () => {
  it("logs in, sets a refresh cookie, then reads /me with the bearer", async () => {
    const login = await resolveMock(
      request("POST", "/api/auth/login", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    expect(login.status).toBe(200);
    const body = login.body as {
      success: boolean;
      data: { accessToken: string; user: { email: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe("ada@example.com");
    expect(login.headers["Set-Cookie"]).toContain("refresh_token=");

    const me = await resolveMock(
      request("GET", "/api/v1/me", {
        headers: { Authorization: `Bearer ${body.data.accessToken}` },
      }),
      config,
    );
    expect(me.status).toBe(200);
    expect((me.body as { email: string }).email).toBe("ada@example.com");
  });

  it("rejects bad credentials with a 401 envelope", async () => {
    const res = await resolveMock(
      request("POST", "/api/auth/login", { body: { email: "ada@example.com", password: "wrong" } }),
      config,
    );
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects invalid input with a 422", async () => {
    const res = await resolveMock(
      request("POST", "/api/auth/login", { body: { email: "x" } }),
      config,
    );
    expect(res.status).toBe(422);
  });

  it("refreshes using the refresh cookie", async () => {
    const login = await resolveMock(
      request("POST", "/api/auth/login", {
        body: { email: "alan@example.com", password: "hunter2" },
      }),
      config,
    );
    const cookie = login.headers["Set-Cookie"]!.split(";")[0]!; // refresh_token=...

    const refresh = await resolveMock(
      request("POST", "/api/auth/refresh", { headers: { Cookie: cookie } }),
      config,
    );
    expect(refresh.status).toBe(200);
    expect(typeof (refresh.body as { data: { accessToken: string } }).data.accessToken).toBe(
      "string",
    );
  });

  it("logs out (204) and then refresh fails", async () => {
    const login = await resolveMock(
      request("POST", "/api/auth/login", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );
    const cookie = login.headers["Set-Cookie"]!.split(";")[0]!;

    const logout = await resolveMock(
      request("POST", "/api/auth/logout", { headers: { Cookie: cookie } }),
      config,
    );
    expect(logout.status).toBe(204);
    expect(logout.body).toBeUndefined();

    const refresh = await resolveMock(
      request("POST", "/api/auth/refresh", { headers: { Cookie: cookie } }),
      config,
    );
    expect(refresh.status).toBe(401);
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
  const login = () =>
    resolveMock(
      request("POST", "/api/auth/login", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      config,
    );

  it("BFF (cookieLess false): a cookieless refresh 401s even after a login", async () => {
    await login(); // sets lastSession
    const refresh = await resolveMock(request("POST", "/api/auth/refresh"), config); // no cookie
    expect(refresh.status).toBe(401); // no fallback — no cross-user bleed
  });

  it("MSW (cookieLess true): a cookieless refresh falls back to the last login", async () => {
    const cookieLessConfig = { ...config, cookieLess: true };
    await resolveMock(
      request("POST", "/api/auth/login", {
        body: { email: "ada@example.com", password: "password123" },
      }),
      cookieLessConfig,
    );
    const refresh = await resolveMock(request("POST", "/api/auth/refresh"), cookieLessConfig);
    expect(refresh.status).toBe(200);
  });
});
