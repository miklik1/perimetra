// Mobile unit-test runner — Jest + jest-expo + RNTL (ADR 0005). Web + shared
// packages use Vitest; Jest is confined to this one React Native app.
//
// CommonJS (`.cjs`) like babel.config.cjs / metro.config.cjs — the package is
// `"type": "module"`, so a bare `jest.config.js` would be parsed as ESM.
//
// The `jest-expo` preset already supplies the babel-jest transform, the RN
// haste/platform resolver, and a `transformIgnorePatterns` that whitelists
// `.pnpm` (so nativewind / react-native-css get transpiled) — `@repo/*`
// workspace packages live under /packages (outside node_modules) and are always
// transformed. So we only add what the preset can't know about.
const expoPreset = require("jest-expo/jest-preset");

// ESM-only deps that MUST be transformed (ADR 0020). The preset whitelists
// `.pnpm` at the FIRST node_modules segment, but pnpm nests the real package
// under a SECOND `node_modules/<name>`, which re-triggers the ignore. CJS deps
// survive being ignored (they just `require`); use-intl ships ESM-only, so an
// untransformed import is a hard SyntaxError. Injecting the names into the
// whitelist alternation fixes it — the lookahead runs at every node_modules
// boundary, so the nested `node_modules/use-intl` is whitelisted too.
const esmDeps = ["use-intl", "intl-messageformat", "@formatjs"];
const [firstIgnore, ...restIgnore] = expoPreset.transformIgnorePatterns;
const transformIgnorePatterns = [
  firstIgnore.replace("(?!(", `(?!(${esmDeps.join("|")}|`),
  ...restIgnore,
];

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns,
  // env-setup runs before the module graph (sets SKIP_ENV_VALIDATION); setup
  // runs after the framework is up (registers jest.mock).
  setupFiles: ["<rootDir>/jest/env-setup.ts"],
  setupFilesAfterEnv: ["<rootDir>/jest/setup.ts"],
  // global.css is Metro-compiled by NativeWind v5 / react-native-css; Jest
  // bypasses Metro, so stub the CSS side-effect import to an empty module.
  // (Merged with the preset's moduleNameMapper — vector-icons aliases survive.)
  moduleNameMapper: {
    "\\.css$": "<rootDir>/jest/css-stub.cjs",
  },
};
