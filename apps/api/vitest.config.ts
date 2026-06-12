import swc from "unplugin-swc";
import { mergeConfig } from "vitest/config";

import { baseConfig } from "@repo/vitest-config/base";

// NestJS relies on `emitDecoratorMetadata` (constructor-injection types),
// which Vitest's esbuild transform cannot emit — SWC transforms the api's
// TS instead (the standard NestJS+Vitest setup).
export default mergeConfig(baseConfig, {
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true, tsx: true },
        transform: { decoratorMetadata: true, react: { runtime: "automatic" } },
        target: "esnext",
      },
      module: { type: "es6" },
    }),
  ],
});
