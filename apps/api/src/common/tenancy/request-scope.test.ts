import { describe, expect, it } from "vitest";

import { MissingOrganizationScopeError, scopeFromSession } from "./request-scope.js";

describe("scopeFromSession", () => {
  it("maps the session user and active org to the scope", () => {
    expect(
      scopeFromSession({
        user: { id: "user-1" },
        session: { activeOrganizationId: "org-1" },
      }),
    ).toEqual({ userId: "user-1", organizationId: "org-1" });
  });

  it("rejects a session with no active organization (fail-closed seam, ADR 0055)", () => {
    expect(() => scopeFromSession({ user: { id: "user-1" }, session: {} })).toThrow(
      MissingOrganizationScopeError,
    );
    expect(() =>
      scopeFromSession({ user: { id: "user-1" }, session: { activeOrganizationId: null } }),
    ).toThrow(MissingOrganizationScopeError);
  });
});
