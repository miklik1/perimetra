/**
 * Tests for the `no-form-missing-method-with-sensitive-input` rule.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * registration hook. The risks locked down: (1) a PII/secret form missing
 * `method="post"` MUST flag (the live create-user-form gap); (2) a compliant
 * `method="post"` form and a non-PII form (project name/description) MUST NOT
 * flag — no over-triggering on the ambiguous bare `name`.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-form-missing-method-with-sensitive-input.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-form-missing-method-with-sensitive-input", rule, {
  valid: [
    // Compliant: method="post" with a password field (the login-form shape).
    {
      code: `const C = () => <form method="post"><input {...register("email")} type="password" /></form>;`,
      filename: "/repo/apps/web/login-form.tsx",
    },
    // Case-insensitive method.
    {
      code: `const C = () => <form method="POST"><input {...register("email")} /></form>;`,
      filename: "/repo/apps/web/x.tsx",
    },
    // No sensitive field — project name/description is not PII (guards the
    // ambiguous bare `name` from over-triggering).
    {
      code: `const C = () => <form><input {...register("name")} /><input {...register("description")} /></form>;`,
      filename: "/repo/apps/web/create-project-form.tsx",
    },
    // A form with only unnamed / unregistered inputs.
    {
      code: `const C = () => <form><input type="text" /><button>Go</button></form>;`,
      filename: "/repo/apps/web/search.tsx",
    },
    // Dynamic method — unresolvable, conservatively not flagged.
    {
      code: `const C = () => <form method={m}><input {...register("email")} /></form>;`,
      filename: "/repo/apps/web/x.tsx",
    },
    // Dynamic register argument — cannot be traced statically, not flagged.
    {
      code: `const C = () => <form><input {...register(fieldName)} /></form>;`,
      filename: "/repo/apps/web/x.tsx",
    },
    // Braced string literal `method={"post"}` resolves exactly like the plain
    // attribute — compliant, not flagged.
    {
      code: `const C = () => <form method={"post"}><input {...register("email")} /></form>;`,
      filename: "/repo/apps/web/x.tsx",
    },
    // A form's OWN legacy `name` attribute must not self-trigger: here the only
    // descendant is a plain text `username` input (not on the sensitive list),
    // even though the form name contains the STRONG token "password".
    {
      code: `const C = () => <form name="passwordResetForm"><input type="text" name="username" /></form>;`,
      filename: "/repo/apps/web/x.tsx",
    },
  ],
  invalid: [
    // THE live gap: create-user-form registers "email" with no method.
    {
      code: `const C = () => <form onSubmit={h}><input {...register("email")} type="email" /></form>;`,
      filename: "/repo/apps/web/create-user-form.tsx",
      errors: [{ messageId: "missingMethod" }],
    },
    // A bare password field with no method.
    {
      code: `const C = () => <form><input type="password" name="pw" /></form>;`,
      filename: "/repo/apps/web/reset.tsx",
      errors: [{ messageId: "missingMethod" }],
    },
    // Explicit method="get" with a PII field.
    {
      code: `const C = () => <form method="get"><input name="ssn" /></form>;`,
      filename: "/repo/apps/web/x.tsx",
      errors: [{ messageId: "missingMethod" }],
    },
    // Nested input under a wrapper — descendant walk still finds it. STRONG
    // substring match (`creditCard` → `creditcard`).
    {
      code: `const C = () => <form><fieldset><input {...register("creditCardNumber")} /></fieldset></form>;`,
      filename: "/repo/apps/web/checkout.tsx",
      errors: [{ messageId: "missingMethod" }],
    },
  ],
});

describe("no-form-missing-method-with-sensitive-input", () => {
  it("ran the RuleTester assertions", () => {
    expect(true).toBe(true);
  });
});
