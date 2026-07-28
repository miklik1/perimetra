import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSession, resetSessions, resolveSession } from "./session";

/**
 * Regression guard for the two-module-graphs defect (ADR 1034).
 *
 * Next resolves this module TWICE in one process — once under the
 * `react-server` export condition (RSC/server components) and once in the plain
 * Node graph (route handlers, i.e. the browser's `/api/*` calls). Two module
 * instances mean two module-level `Map`s, so a session opened over the route
 * handler is invisible to the RSC read of it. No single-instance test can see
 * that: inside ONE instance a module-level Map behaves perfectly, which is why
 * the defect survived a green suite until a server component needed eyes-on
 * verification.
 *
 * So the test loads the module twice (`vi.resetModules()` + a dynamic
 * re-import) and asserts the two instances share one store. The identity
 * assertion below is load-bearing: if the runner ever stops re-evaluating the
 * module, the re-import hands back the SAME instance and every remaining
 * assertion passes vacuously — silently degrading this into the naive
 * single-instance test it exists to replace.
 */
async function loadSecondInstance() {
  vi.resetModules();
  return import("./session");
}

describe("mock session store across module instances", () => {
  beforeEach(() => {
    resetSessions();
  });

  it("re-imports a genuinely separate module instance", async () => {
    const other = await loadSecondInstance();
    expect(other.createSession).not.toBe(createSession);
  });

  it("resolves a session opened by the other instance", async () => {
    const other = await loadSecondInstance();
    expect(other.createSession).not.toBe(createSession);

    // The RSC-vs-route-handler split, in miniature: one graph opens, the other reads.
    const token = createSession("u_shared");
    expect(other.resolveSession(token)).toBe("u_shared");
  });

  it("shares the cookie-less lastSession fallback", async () => {
    const other = await loadSecondInstance();
    expect(other.createSession).not.toBe(createSession);

    createSession("u_fallback");
    expect(other.resolveSession(null, true)).toBe("u_fallback");
  });

  it("wipes both instances from one resetSessions call", async () => {
    const other = await loadSecondInstance();
    expect(other.createSession).not.toBe(createSession);

    const token = createSession("u_reset");
    other.resetSessions();
    expect(resolveSession(token)).toBeUndefined();
  });
});
