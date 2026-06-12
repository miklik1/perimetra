import { describe, expect, it } from "vitest";

import { scopeFromSession } from "./request-scope.js";

describe("scopeFromSession", () => {
  it("maps the session user to the scope", () => {
    expect(
      scopeFromSession({
        user: { id: "user-1" },
        session: { activeOrganizationId: "org-1" },
      }),
    ).toEqual({ userId: "user-1", organizationId: "org-1" });
  });

  it("normalizes a missing active organization to null (dormant seam)", () => {
    expect(scopeFromSession({ user: { id: "user-1" }, session: {} })).toEqual({
      userId: "user-1",
      organizationId: null,
    });
  });
});
