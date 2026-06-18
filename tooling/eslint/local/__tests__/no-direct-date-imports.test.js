/**
 * Tests for the `no-direct-date-imports` rule.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-direct-date-imports.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-direct-date-imports", rule, {
  valid: [
    // Allowed: the formatting package itself (path fragment exemption).
    {
      code: `import { format } from "date-fns";`,
      filename: "/repo/packages/formatting/src/index.ts",
      options: [{ allowedPathFragments: ["/packages/formatting/src/"] }],
    },
    // Allowed: i18n package (second allowed fragment).
    {
      code: `import { format } from "date-fns";`,
      filename: "/repo/packages/i18n/src/date-helpers.ts",
      options: [
        {
          allowedPathFragments: ["/packages/formatting/src/", "/packages/i18n/src/"],
        },
      ],
    },
    // Unrelated imports pass.
    {
      code: `import { z } from "zod";`,
      filename: "/repo/apps/web/app/form.tsx",
    },
    // A custom bannedModules option: only ban what's specified.
    {
      code: `import { format } from "date-fns";`,
      filename: "/repo/apps/web/app/form.tsx",
      options: [{ bannedModules: ["temporal-polyfill"] }],
    },
  ],

  invalid: [
    // date-fns root — the main format-token footgun.
    {
      code: `import { format } from "date-fns";`,
      filename: "/repo/apps/web/app/date-display.tsx",
      errors: [{ messageId: "direct" }],
    },
    // date-fns subpath (e.g. date-fns/format, date-fns/parseISO).
    {
      code: `import { parseISO } from "date-fns/parseISO";`,
      filename: "/repo/apps/web/app/util.ts",
      errors: [{ messageId: "direct" }],
    },
    // date-fns/locale — locale objects must be re-exported from the formatting package.
    {
      code: `import { cs } from "date-fns/locale";`,
      filename: "/repo/apps/web/app/picker.tsx",
      errors: [{ messageId: "direct" }],
    },
    // temporal-polyfill.
    {
      code: `import { Temporal } from "temporal-polyfill";`,
      filename: "/repo/apps/web/app/calendar.tsx",
      errors: [{ messageId: "direct" }],
    },
    // @js-temporal/polyfill.
    {
      code: `import { Temporal } from "@js-temporal/polyfill";`,
      filename: "/repo/apps/web/app/calendar.tsx",
      errors: [{ messageId: "direct" }],
    },
    // @js-temporal/polyfill subpath.
    {
      code: `import something from "@js-temporal/polyfill/impl";`,
      filename: "/repo/apps/web/app/thing.ts",
      errors: [{ messageId: "direct" }],
    },
    // Mobile app — same rule applies.
    {
      code: `import { format } from "date-fns";`,
      filename: "/repo/apps/mobile/components/date-cell.tsx",
      errors: [{ messageId: "direct" }],
    },
  ],
});

describe("no-direct-date-imports", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
