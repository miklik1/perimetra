/**
 * Local ESLint plugin — battle-tested custom rules ported from production.
 *
 * Every rule encodes a production lesson: the doc comment explains the exact
 * bug class it prevents. Read the rule file before changing severity or adding
 * an exemption.
 *
 * Plugin name: "local"  →  rule IDs: "local/<rule-name>"
 *
 * Consumed by tooling/eslint/base.js (no-direct-date-imports) and the React-
 * facing configs (next.js, react-internal.js, expo.js) for the form rules.
 */

import noCrossModuleSchemaImport from "./no-cross-module-schema-import.js";
import noDirectDateImports from "./no-direct-date-imports.js";
import noFormMissingMethodWithSensitiveInput from "./no-form-missing-method-with-sensitive-input.js";
import noRawFieldErrorMessage from "./no-raw-field-error-message.js";
import noRhfResetInModalUseEffect from "./no-rhf-reset-in-modal-useeffect.js";
import noRhfSubscriptionWithoutNoMemoDirective from "./no-rhf-subscription-without-no-memo-directive.js";
import noTanstackTableWithoutNoMemoDirective from "./no-tanstack-table-without-no-memo-directive.js";
import noZodResolverWithoutUseZodForm from "./no-zod-resolver-without-use-zod-form.js";

/** @type {import("eslint").ESLint.Plugin} */
const localPlugin = {
  meta: {
    name: "local",
    version: "0.0.0",
  },
  rules: {
    // Bans `zodResolver` outside the `useZodForm` wrapper — prevents the
    // silent-submit bug from the z.input/z.output type-slot collapse.
    "no-zod-resolver-without-use-zod-form": noZodResolverWithoutUseZodForm,

    // Bans direct date-library imports outside the shared formatting package —
    // prevents date-fns format-token RangeError crashes.
    "no-direct-date-imports": noDirectDateImports,

    // Enforces ADR 0032 module-schema ownership: an api module imports only its
    // own `@repo/db/schema/<module>` — prevents the cross-module schema coupling
    // (and the forbidden cross-schema FK) the global allow-list can't gate.
    "no-cross-module-schema-import": noCrossModuleSchemaImport,

    // Bans rendering RHF field errors raw (`{errors.x.message}`) — forces the
    // shared `<FieldError>` so messages go through the i18n-wired zod error-map.
    "no-raw-field-error-message": noRawFieldErrorMessage,

    // Requires `method="post"` on any <form> holding a secret/PII-bearing named
    // input — a pre-hydration native GET submit serialises the field into the
    // URL/history/Referer/logs (ADR 1001 → the class rule, ADR 1005).
    "no-form-missing-method-with-sensitive-input": noFormMissingMethodWithSensitiveInput,

    // Bans RHF `reset()` inside useEffect — prevents the _fields-registry
    // wipe that breaks edit pre-fill and inline errors in modal forms.
    "no-rhf-reset-in-modal-useeffect": noRhfResetInModalUseEffect,

    // Requires `"use no memo"` when touching TanStack Table mutation APIs —
    // prevents the React Compiler caching stale table-state reads.
    // OFF until React Compiler is adopted (see tooling/eslint/next.js etc.).
    "no-tanstack-table-without-no-memo-directive": noTanstackTableWithoutNoMemoDirective,

    // Requires `"use no memo"` when calling RHF subscription hooks (useFormState,
    // useWatch, useController, form.watch()) — prevents compiler-frozen form errors.
    // OFF until React Compiler is adopted (see tooling/eslint/next.js etc.).
    "no-rhf-subscription-without-no-memo-directive": noRhfSubscriptionWithoutNoMemoDirective,
  },
};

export default localPlugin;
