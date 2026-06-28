import { describe, expect, it } from "vitest";

import { buildRedactPaths } from "./redaction.js";

/**
 * pino redact-path builder (ADR 0036/0040). The guard that bites: a multi-word
 * pii() column is `ip_address` in the registry but `ipAddress` on a logged body
 * / Drizzle row, so a snake-only `req.body.ip_address` path silently no-ops.
 * buildRedactPaths must emit BOTH casings.
 */
describe("buildRedactPaths", () => {
  it("always redacts the static auth-material headers", () => {
    const paths = buildRedactPaths();
    expect(paths).toContain("req.headers.authorization");
    expect(paths).toContain("req.headers.cookie");
    expect(paths).toContain('res.headers["set-cookie"]');
  });

  it("emits BOTH snake_case and camelCase body paths for a multi-word pii column", () => {
    const paths = buildRedactPaths();
    // session.ip_address / session.user_agent are registered pii() columns
    // (loaded via the side-effecting `@repo/db/schema` import in redaction.ts).
    for (const camel of ["ipAddress", "userAgent"]) {
      expect(paths).toContain(`req.body.${camel}`);
      expect(paths).toContain(`res.body.${camel}`);
    }
    // The snake form stays too (a raw DB-shaped log object still matches).
    expect(paths).toContain("req.body.ip_address");
  });

  it("emits one body path per casing for a single-word column (email)", () => {
    const paths = buildRedactPaths();
    expect(paths.filter((p) => p === "req.body.email")).toHaveLength(1);
  });
});
