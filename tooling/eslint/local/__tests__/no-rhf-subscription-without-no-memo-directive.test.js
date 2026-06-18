/**
 * Tests for the `no-rhf-subscription-without-no-memo-directive` rule.
 *
 * This rule is currently "off" in the shared configs — enable it when the
 * React Compiler is adopted. The tests ensure the logic is correct so it's
 * ready to turn on without surprises.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-rhf-subscription-without-no-memo-directive.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-rhf-subscription-without-no-memo-directive", rule, {
  valid: [
    // Hook call WITH the directive — passes.
    {
      code: `function Field({ control }) {
  "use no memo";
  const { errors } = useFormState({ control });
  return errors;
}`,
    },
    // form.watch() render-read WITH the directive — passes.
    {
      code: `function Section({ form }) {
  "use no memo";
  const isOn = form.watch("enabled");
  return isOn;
}`,
    },
    // A custom hook reading form.watch() WITH the directive — passes.
    {
      code: `function useThing() {
  "use no memo";
  const slug = form.watch("slug");
  return slug;
}`,
    },
    // The subscription/callback form form.watch(cb) (used in effects) is NOT
    // a render-time read — not flagged even without the directive.
    {
      code: `function useThing() {
  useEffect(() => {
    const sub = form.watch((values) => console.log(values));
    return () => sub.unsubscribe();
  }, []);
  return null;
}`,
    },
    // A .watch() on a non-form object is unrelated — not flagged.
    {
      code: `function watcher() {
  const w = fsWatcher.watch("file.txt");
  return w;
}`,
    },
    // No form-state read at all — passes.
    {
      code: `function Greeting({ name }) {
  return name;
}`,
    },
  ],

  invalid: [
    // useFormState call WITHOUT the directive.
    {
      code: `function Field({ control }) {
  const { errors } = useFormState({ control });
  return errors;
}`,
      errors: [{ messageId: "missing" }],
      output: `function Field({ control }) {
  "use no memo";

  const { errors } = useFormState({ control });
  return errors;
}`,
    },
    // form.watch("name") render-read WITHOUT the directive.
    {
      code: `function Section({ form }) {
  const isOn = form.watch("enabled");
  return isOn;
}`,
      errors: [{ messageId: "missing" }],
      output: `function Section({ form }) {
  "use no memo";

  const isOn = form.watch("enabled");
  return isOn;
}`,
    },
    // form.watch(["a","b"]) array render-read WITHOUT the directive.
    {
      code: `function Section({ form }) {
  const [a, b] = form.watch(["a", "b"]);
  return a + b;
}`,
      errors: [{ messageId: "missing" }],
      output: `function Section({ form }) {
  "use no memo";

  const [a, b] = form.watch(["a", "b"]);
  return a + b;
}`,
    },
  ],
});

describe("no-rhf-subscription-without-no-memo-directive", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
