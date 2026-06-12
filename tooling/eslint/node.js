import globals from "globals";

import { baseConfig } from "./base.js";

/**
 * ESLint configuration for pure Node/platform-neutral TS packages
 * (no React). Adds Node globals so `process`, `console`, `URL`, `Intl`,
 * timers, etc. don't trip `no-undef` under `--max-warnings 0`.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
