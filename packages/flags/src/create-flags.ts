import { createStaticFlags } from "./static";
import type { Flags } from "./types";

/**
 * The single composition root (ADR 0028): one process-global holder, written
 * once at app boot, read by anything that needs flags outside React (the
 * hooks read the provider's context instead). Same justification as the
 * telemetry registry (ADR 0021) — a facade RESOLVER, not a request-scoped
 * transport, so ADR 0012 stays intact.
 *
 * The holder lives on `globalThis` under a symbol (the `@repo/api`
 * api-log-store pattern) so it is a true singleton across Next's
 * separately-bundled module graphs (RSC vs SSR vs route handlers) — a plain
 * module-level `let` gives each graph its own copy, stranding un-booted
 * graphs on the static default. One `configureFlags` per JS RUNTIME (server
 * process, browser) covers every graph in it.
 *
 * SCOPE: this sync carrier serves the NATIVE non-React read path
 * (`createPosthogNativeAdapter` in `./native`). On web nothing reads through
 * it — the client reads via `FlagsContext`/`useFlag` and the server via the
 * async `getFlag`/`getAllFlags` surface, so `bootFlags` (web) does not call
 * `configureFlags`. Mobile wiring lands in a later wave and becomes the first
 * real consumer of `getFlags()`.
 */
const REGISTRY_KEY = Symbol.for("@repo/flags/registry");

interface RegistryState {
  current: Flags | null;
}

const globalRef = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
const state: RegistryState = (globalRef[REGISTRY_KEY] ??= { current: null });

/** The pre-configure fallback: registry defaults (pure, built once). */
const staticFlags = createStaticFlags();

/**
 * Install the app's flags adapter at boot. Idempotent — the first configure
 * wins, so React StrictMode double-invocation and HMR re-runs are harmless.
 * Tests use `resetFlags` between cases instead of reconfiguring.
 */
export function configureFlags(adapter: Flags): void {
  state.current ??= adapter;
}

/** The configured adapter, or registry defaults before/without boot wiring. */
export function getFlags(): Flags {
  return state.current ?? staticFlags;
}

/** Clear the holder (tests only — production configures once per runtime). */
export function resetFlags(): void {
  state.current = null;
}
