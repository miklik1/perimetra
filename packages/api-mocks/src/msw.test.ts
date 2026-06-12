import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { resetSessions } from "./fixtures/session";
import { allRoutes } from "./index";
import { createMswHandlers } from "./msw";

const server = setupServer(...createMswHandlers(allRoutes));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetSessions();
});
afterAll(() => server.close());

describe("createMswHandlers", () => {
  it("matches origin-agnostically (any base URL) and serves the mock", async () => {
    const res = await fetch("https://anything.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.user.email).toBe("ada@example.com");
  });

  it("flattens path params (/users/:id)", async () => {
    const res = await fetch("http://x/api/users/11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("emits an empty body (not 'null') for a 204", async () => {
    await fetch("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
    });
    const res = await fetch("http://x/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe(""); // HttpResponse(null), not JSON "null"
  });
});
