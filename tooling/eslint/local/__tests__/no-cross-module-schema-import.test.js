/**
 * Tests for the `no-cross-module-schema-import` rule (ADR 0032 boundary).
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest. The cases mirror the real
 * skeleton import map: own-schema OK, the privacy→{auth,audit} sanctioned
 * exception OK, every other cross-module schema import (and the whole-barrel
 * import) flagged.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-cross-module-schema-import.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// The real wiring in base.js: only privacy may read auth + audit.
const opts = [{ allow: { privacy: ["auth", "audit"] } }];

ruleTester.run("no-cross-module-schema-import", rule, {
  valid: [
    // A module importing its OWN schema.
    {
      code: `import { project } from "@repo/db/schema/projects";`,
      filename: "/repo/apps/api/src/modules/projects/projects.repository.ts",
      options: opts,
    },
    {
      code: `import { audit } from "@repo/db/schema/audit";`,
      filename: "/repo/apps/api/src/modules/audit/audit.service.ts",
      options: opts,
    },
    // The sanctioned privacy → auth + audit exception (GDPR erasure boundary).
    {
      code: `import { user } from "@repo/db/schema/auth";`,
      filename: "/repo/apps/api/src/modules/privacy/privacy.processor.ts",
      options: opts,
    },
    {
      code: `import { audit } from "@repo/db/schema/audit";`,
      filename: "/repo/apps/api/src/modules/privacy/privacy.processor.ts",
      options: opts,
    },
    // A test file inside the module dir is covered by the same allowance.
    {
      code: `import { account, session, user } from "@repo/db/schema/auth";`,
      filename: "/repo/apps/api/src/modules/privacy/privacy.processor.test.ts",
      options: opts,
    },
    // Non-schema imports pass untouched.
    {
      code: `import { Injectable } from "@nestjs/common";`,
      filename: "/repo/apps/api/src/modules/projects/projects.service.ts",
      options: opts,
    },
    // Outside the api modules tree the rule is inert — tooling/seeds/redaction
    // and integration tests keep full schema access.
    {
      code: `import { user } from "@repo/db/schema/auth"; import { project } from "@repo/db/schema/projects";`,
      filename: "/repo/apps/api/src/common/logging/redaction.ts",
      options: opts,
    },
    {
      code: `import * as schema from "@repo/db/schema";`,
      filename: "/repo/apps/api/test/migrations.itest.ts",
      options: opts,
    },
    // Own-schema is allowed even with no `allow` map configured.
    {
      code: `import { outbox } from "@repo/db/schema/outbox";`,
      filename: "/repo/apps/api/src/modules/outbox/outbox.service.ts",
    },
  ],

  invalid: [
    // A module reaching into a FOREIGN module's schema — the core violation.
    {
      code: `import { user } from "@repo/db/schema/auth";`,
      filename: "/repo/apps/api/src/modules/projects/projects.service.ts",
      options: opts,
      errors: [{ messageId: "crossModule" }],
    },
    // billing reaching projects (no allowance) — flagged.
    {
      code: `import { project } from "@repo/db/schema/projects";`,
      filename: "/repo/apps/api/src/modules/billing/billing.service.ts",
      options: opts,
      errors: [{ messageId: "crossModule" }],
    },
    // privacy is allowed auth + audit but NOT projects.
    {
      code: `import { project } from "@repo/db/schema/projects";`,
      filename: "/repo/apps/api/src/modules/privacy/privacy.processor.ts",
      options: opts,
      errors: [{ messageId: "crossModule" }],
    },
    // Importing the whole barrel from inside a module reaches every table.
    {
      code: `import * as schema from "@repo/db/schema";`,
      filename: "/repo/apps/api/src/modules/audit/audit.service.ts",
      options: opts,
      errors: [{ messageId: "barrel" }],
    },
    // A re-export leaks the boundary just like an import.
    {
      code: `export { user } from "@repo/db/schema/auth";`,
      filename: "/repo/apps/api/src/modules/outbox/outbox.barrel.ts",
      options: opts,
      errors: [{ messageId: "crossModule" }],
    },
    // With no `allow` map, even the privacy exception is flagged (proves the
    // allowance is opt-in, not baked into the rule).
    {
      code: `import { user } from "@repo/db/schema/auth";`,
      filename: "/repo/apps/api/src/modules/privacy/privacy.processor.ts",
      errors: [{ messageId: "crossModule" }],
    },
  ],
});

describe("no-cross-module-schema-import", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
