/**
 * Tests for the `no-raw-field-error-message` rule.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest. The key risk this locks down is
 * FALSE POSITIVES: the rule must flag react-hook-form field errors
 * (`{errors.x.message}`) while leaving TanStack mutation errors
 * (`mutation.error.message`) and toast/API errors (`toast.message`) alone.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-raw-field-error-message.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-raw-field-error-message", rule, {
  valid: [
    // TanStack mutation error — a legitimate raw render, NOT a field error.
    {
      code: `const C = () => <p>{mutation.error.message}</p>;`,
      filename: "/repo/apps/web/form.tsx",
    },
    // Toast / single API error — one-level `.message`, root is not an errors object.
    { code: `const C = () => <p>{toast.message}</p>;`, filename: "/repo/apps/web/toaster.tsx" },
    { code: `const C = () => <p>{error.message}</p>;`, filename: "/repo/apps/web/x.tsx" },
    // The sanctioned sink itself.
    {
      code: `const C = () => <FieldError error={errors.email} />;`,
      filename: "/repo/apps/web/form.tsx",
    },
    // A `.message` read in plain logic (not rendered) is fine.
    {
      code: `function f(errors) { return errors.email.message; }`,
      filename: "/repo/apps/web/x.ts",
    },
  ],
  invalid: [
    // The canonical raw field-error render.
    {
      code: `const C = () => <p>{errors.email.message}</p>;`,
      filename: "/repo/apps/web/login-form.tsx",
      errors: [{ messageId: "raw" }],
    },
    // A renamed errors object (a second form on the same screen).
    {
      code: `const C = () => <span>{addErrors.measuredOn.message}</span>;`,
      filename: "/repo/apps/web/measurements-tab.tsx",
      errors: [{ messageId: "raw" }],
    },
    // Inside the common `{errors.x && (<p>...</p>)}` guard.
    {
      code: `const C = () => <div>{errors.name && <p>{errors.name.message}</p>}</div>;`,
      filename: "/repo/apps/web/signup-form.tsx",
      errors: [{ messageId: "raw" }],
    },
  ],
});

describe("no-raw-field-error-message", () => {
  it("ran the RuleTester assertions", () => {
    expect(true).toBe(true);
  });
});
