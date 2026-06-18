import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

import { baseConfig } from "./base.js";

/**
 * ESLint configuration for Expo / React Native apps.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const expoConfig = [
  ...baseConfig,
  pluginReact.configs.flat.recommended,
  {
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        __DEV__: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        console: "readonly",
        alert: "readonly",
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
      "react/no-unstable-nested-components": "warn",
    },
  },
  // Local custom rules — React-specific form guards, also applicable to RN.
  // The `local` plugin is already registered in baseConfig; these rules are
  // layered on top for Expo/RN apps.
  {
    rules: {
      // Bans `zodResolver` outside the `useZodForm` wrapper — prevents the
      // silent-submit bug from the z.input/z.output type-slot collapse.
      // `useZodForm` is DOM-free and works identically in React Native
      // (handleSubmit, formState, reset all work; register is replaced by Controller).
      "local/no-zod-resolver-without-use-zod-form": "warn",

      // Bans RHF `reset()` inside useEffect — prevents the _fields-registry
      // wipe that breaks pre-fill and inline errors (applies equally in RN forms).
      "local/no-rhf-reset-in-modal-useeffect": "warn",

      // React-Compiler memo-directive rules — OFF until React Compiler is
      // adopted. Enable these when the compiler is configured for this Expo app.
      // "local/no-tanstack-table-without-no-memo-directive": "warn",
      // "local/no-rhf-subscription-without-no-memo-directive": "warn",
    },
  },
  {
    // Jest specs reset the module registry (`jest.resetModules` + re-`require`)
    // to re-evaluate modules holding top-level state — a CommonJS-only idiom, so
    // `require()` is allowed here though it's forbidden in RN app source.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: [
      ".expo/**",
      "android/**",
      "ios/**",
      "dist/**",
      // CommonJS tooling configs — plain-JS `module.exports`, not RN app source
      // (no-undef would flag `module`; it's off for the .ts specs/setup).
      "babel.config.cjs",
      "metro.config.cjs",
      "jest.config.cjs",
      "jest/css-stub.cjs",
    ],
  },
];
