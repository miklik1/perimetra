import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { resetSessions } from "./fixtures/session";
import { resetMockUsers } from "./fixtures/users";
import { allRoutes } from "./index";
import { createMswHandlers } from "./msw";

const server = setupServer(...createMswHandlers(allRoutes));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetSessions();
  resetMockUsers();
});
afterAll(() => server.close());

describe("createMswHandlers", () => {
  it("matches origin-agnostically (any base URL) and serves sign-in/email", async () => {
    const res = await fetch("https://anything.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("ada@example.com");
  });

  it("flattens path params (/users/:id)", async () => {
    const res = await fetch("http://x/api/users/11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("get-session falls back to the last sign-in in the cookieless MSW runtime", async () => {
    // MSW runtimes (Expo/Vitest) can't carry the httpOnly cookie, so the mock
    // resolves the session from the most-recent sign-in (`cookieLess: true`).
    await fetch("http://x/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "password123" }),
    });
    const res = await fetch("http://x/api/auth/get-session");
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe("ada@example.com");
  });
});
