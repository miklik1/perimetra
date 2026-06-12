/**
 * Node `--import` entry for observability (ADR 0036). Wired in package.json
 * scripts: `node --import ./dist/otel/loader.js dist/main.js`.
 *
 * ESM instrumentation needs the import-in-the-middle loader hook registered
 * BEFORE any application module loads — `module.register()` here (the modern
 * replacement for the deprecated `--experimental-loader` flag), then the SDK
 * boots. Both steps are skipped when OTel is off (see `isOtelEnabled`), so
 * the disabled path costs nothing.
 */
import { register } from "node:module";

import { isOtelEnabled } from "./enabled.js";

if (isOtelEnabled()) {
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  await import("./register.js");
}
