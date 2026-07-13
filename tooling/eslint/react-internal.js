import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

import { baseConfig } from "./base.js";

/**
 * ESLint configuration for React libraries.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const reactInternalConfig = [
  ...baseConfig,
  pluginReact.configs.flat.recommended,
  {
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
  // Local custom rules — React-specific form guards.
  // The `local` plugin is already registered in baseConfig; these rules are
  // layered on top for React library packages only.
  {
    rules: {
      // Bans `zodResolver` outside the `useZodForm` wrapper — prevents the
      // silent-submit bug from the z.input/z.output type-slot collapse.
      "local/no-zod-resolver-without-use-zod-form": "warn",

      // Bans RHF `reset()` inside useEffect — prevents the _fields-registry
      // wipe that breaks edit pre-fill and inline errors in modal forms.
      "local/no-rhf-reset-in-modal-useeffect": "warn",

      // Requires `method="post"` on a <form> with a secret/PII-bearing named
      // input — closes the pre-hydration GET-leak class (ADR 1001/1005).
      "local/no-form-missing-method-with-sensitive-input": "warn",

      // React-Compiler memo-directive rules — OFF until React Compiler is
      // adopted. Enable these when the compiler is configured in this package.
      // "local/no-tanstack-table-without-no-memo-directive": "warn",
      // "local/no-rhf-subscription-without-no-memo-directive": "warn",
    },
  },
];
