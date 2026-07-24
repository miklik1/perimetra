import { describe, expect, it } from "vitest";

import { ApiError } from "@repo/api";
import type { Issue } from "@repo/engine";

import { siteInvalidIssues } from "./error-messages";

const ISSUES: Issue[] = [
  { key: "engine.site.port_incompatible", severity: "error", scope: "connection" },
];

const apiError = (status: number, body: unknown, code?: string) =>
  new ApiError({ kind: "http", status, message: "err", ...(code !== undefined && { code }), body });

describe("siteInvalidIssues — the 422 site_invalid engine issues (CAR-162)", () => {
  it("returns the typed issues from a site_invalid rejection", () => {
    const err = apiError(
      422,
      { code: "site_invalid", details: { issues: ISSUES } },
      "site_invalid",
    );
    expect(siteInvalidIssues(err)).toEqual(ISSUES);
  });

  it("returns undefined for a 422 that carries no issues (margin_below_floor)", () => {
    const err = apiError(422, {
      code: "margin_below_floor",
      details: { marginPct: 5, floorPct: 10 },
    });
    expect(siteInvalidIssues(err)).toBeUndefined();
  });

  it("returns undefined for a site_invalid with an empty issues array", () => {
    expect(
      siteInvalidIssues(apiError(422, { code: "site_invalid", details: { issues: [] } })),
    ).toBeUndefined();
  });

  // The pre-ADR-0126 wire shape: issues at the TOP level. The filter never
  // forwarded those, so a body like this is not something the api can produce —
  // pinned here so a regression that reverts the api half fails loudly instead
  // of silently emptying the IssueList.
  it("returns undefined when issues sit at the top level instead of details", () => {
    expect(
      siteInvalidIssues(apiError(422, { code: "site_invalid", issues: ISSUES })),
    ).toBeUndefined();
  });

  it("returns undefined for non-422 errors and non-ApiError values", () => {
    expect(
      siteInvalidIssues(apiError(409, { code: "site_invalid", details: { issues: ISSUES } })),
    ).toBeUndefined();
    expect(siteInvalidIssues(new Error("boom"))).toBeUndefined();
    expect(siteInvalidIssues(null)).toBeUndefined();
  });
});
