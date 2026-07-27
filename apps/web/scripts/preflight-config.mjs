#!/usr/bin/env node
// Preflight for `check-types` (ADR 1027) — evaluate `next.config.js` in a
// process WE own, and turn "the config could not be loaded" into an EXPLICIT
// non-zero exit code.
//
// WHY THIS EXISTS. `check-types` used to be `next typegen && tsc --noEmit`.
// `next typegen` reports a config-load failure — an env-validation failure from
// `@repo/config/env/web`, or an `assertTierInvariants()` violation — as an
// UNHANDLED PROMISE REJECTION and still exits 0. The `&&` chain therefore never
// short-circuited and the gate was green on exactly the values it exists to
// refuse. That is not "a gate that passes by cache"; the gate never ran.
//
// ROOT CAUSE. Next installs its own userland `unhandledRejection` listener that
// only logs
// (`next/dist/server/node-environment-extensions/unhandled-rejection.external.js`).
// Its own comment says it deliberately avoids relying on Node's default
// terminate-the-process behaviour. That listener is why the DEFAULT Node mode
// exits 0.
//
// WHAT THIS IS NOT. An earlier revision of this header claimed a userland
// listener "suppresses Node's unhandled-rejection mode outright", making
// `--unhandled-rejections=strict` INERT. That is FALSE and was measured false in
// this tree (Node v24.16.0, Next 16.2.9): under `strict`, Node raises the
// rejection as an uncaught exception without dispatching to the listener at all,
// and `next typegen` exits 1 at both throw sites. `web-native-skeleton` shipped
// exactly that flag and its gate enforced. See the Correction block in ADR 1027 —
// asserting this from a source comment instead of executing it is the same fault
// class as the defect the file exists to close.
//
// WHY THE PREFLIGHT ANYWAY, on grounds that survive measurement: it does not
// depend on Node rejection semantics at all, it also covers the "config loaded
// but exported nothing" and "the preflight itself could not run" arms that no
// rejection flag reaches, and `NODE_OPTIONS` is inherited environment — a CI
// runner, wrapper script or turbo task env that resets it disarms the flag
// silently, whereas a command in the chain cannot be disarmed without editing
// the script.
//
// THE GUARANTEE THIS RELIES ON is therefore deliberately minimal: a dynamic
// `import()` of a module whose top-level evaluation throws returns a REJECTED
// promise, and we `await` it inside `try`/`catch`. No implicit process-
// termination semantics are involved anywhere. Every exit code below is written
// out explicitly.
//
// DEFAULT-DENY. There is no path through this file that exits 0 without a
// completed, successful evaluation of the real config. "The preflight itself
// could not run" also exits 1 — a guard that grants passage must never fail
// open (the same discipline ADR 1021 applies to `isLoopbackOrigin`).
//
// WHY IMPORT THE WHOLE CONFIG rather than just `@repo/config/env/web`: importing
// `next.config.js` also exercises `assertTierInvariants()` (next.config.js:17)
// and any future throw added at config-load time. Both known throw sites were
// measured to be swallowed by `next typegen`, so this closes the CLASS, not the
// one instance.

// Explicit `node:process` import rather than the ambient global: this app's
// eslint config scopes globals to the browser (the app is overwhelmingly
// client/RSC code), and an explicit import is the honest declaration anyway for
// a file that only ever runs under Node.
import process from "node:process";

// Belt-and-braces: if anything escapes the try/catch as an async rejection,
// fail closed rather than letting the process drift to a 0 exit. This is a
// backstop, not the mechanism — the awaited try/catch below is the mechanism.
process.on("unhandledRejection", (reason) => {
  console.error("[preflight-config] unhandled rejection while loading next.config.js:");
  console.error(reason);
  process.exit(1);
});

// Relative to THIS module, not to cwd, so the script behaves identically however
// it is invoked (pnpm script, turbo, an absolute path from CI).
const CONFIG_SPECIFIER = "../next.config.js";

// Node error codes that mean "the preflight could not run", as distinct from
// "the config ran and rejected the environment". Both exit 1; they are told
// apart only so the operator is pointed at the right problem. Notably
// ERR_UNKNOWN_FILE_EXTENSION is what a too-old Node emits here:
// `@repo/config` exports raw TypeScript (`"./env/web": "./src/env/web.ts"`), so
// this import transitively depends on native type-stripping. That is pinned by
// `engines.node >= 22.18`, `.nvmrc`, and CI's `node-version-file`.
const INFRASTRUCTURE_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_UNKNOWN_FILE_EXTENSION",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_UNSUPPORTED_ESM_URL_SCHEME",
]);

try {
  const loaded = await import(CONFIG_SPECIFIER);

  // Evaluating without throwing is the thing we actually assert. The default
  // export is checked too so a config that silently degenerates to nothing
  // cannot be read as a pass.
  if (!loaded || loaded.default === undefined) {
    console.error(
      "[preflight-config] next.config.js evaluated but produced no default export — refusing to treat that as a pass.",
    );
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : undefined;

  if (code !== undefined && INFRASTRUCTURE_ERROR_CODES.has(code)) {
    console.error(
      `[preflight-config] could not LOAD next.config.js (${code}). This is a preflight/toolchain failure, not an environment rejection.`,
    );
    console.error(
      "[preflight-config] check the Node version — this repo requires Node >= 22.18 for native TypeScript type-stripping (see .nvmrc).",
    );
    console.error(error);
    process.exit(1);
  }

  console.error("[preflight-config] next.config.js REFUSED to load — check-types cannot proceed.");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
}
