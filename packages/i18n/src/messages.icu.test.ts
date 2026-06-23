import { createTranslator } from "next-intl";
import { describe, expectTypeOf, it } from "vitest";

// Importing the web binding applies its `declare module "next-intl"` AppConfig
// augmentation (Locale + Messages), so `createTranslator()` below is typed
// against the real catalog — the same type chain the web app's `t("…")` uses.
import "./web";

import cs from "./messages/cs";

/**
 * Type-level regression for ICU-argument safety (the `as const` fix).
 *
 * next-intl derives each message's argument shape from the LITERAL message
 * string (e.g. `"Welcome back, {name}!"` → `t("account.greeting", { name })`).
 * That inference only works when the catalog values keep their literal string
 * types. Closing `cs.ts` with `satisfies Record<string, unknown>` WIDENS every
 * value to `unknown`, collapsing `t()` to the loose `string extends Value`
 * branch where any/no args are accepted — silently disabling this safety. With
 * `} as const;` the literals survive and the `@ts-expect-error` lines below
 * become real errors; under the old widening they would be UNUSED, so this file
 * fails `check-types`. It is therefore the fail-first guard for the type fix.
 *
 * `createTranslator` is a plain (non-hook) function, so this runs under the
 * package's Node vitest with no React/jsdom — the assertions are type-only.
 */
describe("ICU argument type-safety", () => {
  // Never executed — present so `tsc`/check-types evaluates the call types. The
  // catalog is passed only to satisfy the runtime signature; the types come
  // from the augmented `Messages`, not this value.
  function _typeChecks() {
    const t = createTranslator({ locale: "cs", messages: cs });

    // A plain message takes no arguments.
    t("nav.home");

    // A message with an ICU arg requires that arg, correctly typed.
    t("account.greeting", { name: "Martin" });

    // Missing the required `{name}` arg is a type error.
    // @ts-expect-error — `name` is required by the ICU literal.
    t("account.greeting");

    // Wrong-typed arg ({count} is a plural number) is a type error.
    // @ts-expect-error — `count` must be a number, not a string.
    t("home.users", { count: "many" });

    // Unknown message key is a type error.
    // @ts-expect-error — `nope` is not a key in the catalog.
    t("account.nope");
  }

  it("derives ICU argument shapes from literal catalog strings", () => {
    // A no-arg call returns a string; this also asserts the typed `t` exists
    // and is not collapsed to the untyped fallback shape.
    expectTypeOf<ReturnType<typeof createTranslator>>().toBeObject();
    void _typeChecks;
  });
});
