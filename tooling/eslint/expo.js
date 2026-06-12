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
