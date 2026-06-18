import pluginNext from "@next/eslint-plugin-next";
import pluginJsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import { globalIgnores } from "eslint/config";
import globals from "globals";

import { baseConfig } from "./base.js";

/**
 * ESLint configuration for Next.js apps.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextJsConfig = [
  ...baseConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  // Accessibility lint floor (ADR 0026 / critic a11y gap). Next's flat-config
  // plugin no longer bundles jsx-a11y, so we add its recommended ruleset
  // explicitly — labels, alt text, valid ARIA, etc. — across all JSX.
  {
    ...pluginJsxA11y.flatConfigs.recommended,
    files: ["**/*.{jsx,tsx}"],
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
  // layered on top for React/Next surfaces only.
  {
    rules: {
      // Bans `zodResolver` outside the `useZodForm` wrapper — prevents the
      // silent-submit bug from the z.input/z.output type-slot collapse under
      // @hookform/resolvers v3 + Zod v4.
      "local/no-zod-resolver-without-use-zod-form": "warn",

      // Bans RHF `reset()` inside useEffect — prevents the _fields-registry
      // wipe that breaks edit pre-fill and inline errors in modal forms.
      "local/no-rhf-reset-in-modal-useeffect": "warn",

      // React-Compiler memo-directive rules — OFF until React Compiler is
      // adopted. Enable these when `reactCompiler: true` is added to
      // next.config.js and the compiler Babel plugin is wired in.
      // "local/no-tanstack-table-without-no-memo-directive": "warn",
      // "local/no-rhf-subscription-without-no-memo-directive": "warn",
    },
  },
];
