/**
 * Tests for the `no-zod-resolver-without-use-zod-form` rule.
 *
 * RuleTester throws on any failed assertion, so reaching the vitest `it` block
 * means all cases passed. The trivial `expect(true).toBe(true)` is the vitest
 * registration hook — without at least one `it`, vitest ignores the file.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-zod-resolver-without-use-zod-form.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-zod-resolver-without-use-zod-form", rule, {
  valid: [
    // The wrapper file itself can import zodResolver — the single legitimate consumer.
    {
      code: `import { zodResolver } from "@hookform/resolvers/zod";`,
      filename: "/repo/packages/ui/src/forms/use-zod-form.ts",
    },
    // Consumer that reaches for the wrapper is fine.
    {
      code: `import { useZodForm } from "@repo/ui/forms/use-zod-form";`,
      filename: "/repo/apps/web/app/some/form.tsx",
    },
    // Unrelated imports from the same package family pass.
    {
      code: `import { useForm } from "react-hook-form";`,
      filename: "/repo/apps/web/app/some/form.tsx",
    },
    // Custom allowedFileSuffixes: a project-specific wrapper location is allowed.
    {
      code: `import { zodResolver } from "@hookform/resolvers/zod";`,
      filename: "/repo/packages/forms/src/use-project-form.ts",
      options: [{ allowedFileSuffixes: ["packages/forms/src/use-project-form.ts"] }],
    },
  ],

  invalid: [
    // Named import outside the wrapper — caught.
    {
      code: `import { zodResolver } from "@hookform/resolvers/zod";`,
      filename: "/repo/apps/web/app/components/modals/edit-modal.tsx",
      errors: [{ messageId: "direct" }],
    },
    // Default import — caught.
    {
      code: `import zodResolver from "@hookform/resolvers/zod";`,
      filename: "/repo/apps/web/app/feature/foo.tsx",
      errors: [{ messageId: "direct" }],
    },
    // Namespace import — caught.
    {
      code: `import * as resolvers from "@hookform/resolvers/zod";`,
      filename: "/repo/apps/web/app/feature/bar.tsx",
      errors: [{ messageId: "direct" }],
    },
    // Side-effect import — caught.
    {
      code: `import "@hookform/resolvers/zod";`,
      filename: "/repo/apps/web/app/feature/baz.tsx",
      errors: [{ messageId: "direct" }],
    },
    // Mobile form — same rule applies.
    {
      code: `import { zodResolver } from "@hookform/resolvers/zod";`,
      filename: "/repo/apps/mobile/components/create-user-form.tsx",
      errors: [{ messageId: "direct" }],
    },
  ],
});

describe("no-zod-resolver-without-use-zod-form", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
