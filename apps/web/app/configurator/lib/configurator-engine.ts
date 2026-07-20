/**
 * The configurator's worker protocol and its pure compute (ADR 0116).
 *
 * Worker-agnostic by design, exactly like the release editor's
 * `release-engine.ts` (ADR 0068 Phase 4A): everything here runs identically on
 * the worker thread and on the synchronous fallback, so the fallback can never
 * drift from the real path. `deriveForUi` itself stays in `../derive` — this
 * module only adds the message shapes and the "did the inputs arrive yet" guard.
 *
 * §7.6 forbids running the derive on the main thread: the drag loop re-derives
 * per animation frame, and a main-thread derive would compete with the very
 * frames it is meant to feed.
 */
import type { ConfigInput } from "@repo/engine";
import type { Catalog } from "@repo/model";

import { deriveForUi, type UiDerivation } from "../derive";
import type { ConfigurableProduct, ConfiguratorPricing } from "../products";

/** What the worker holds between requests — sent on change, not per keystroke. */
export interface EngineContext {
  product: ConfigurableProduct | null;
  catalogs: ReadonlyMap<string, Catalog> | null;
  pricing: ConfiguratorPricing | null;
}

export type EngineRequest =
  | { kind: "context"; product: ConfigurableProduct; catalogs: [string, Catalog][] }
  | { kind: "pricing"; pricing: ConfiguratorPricing | null }
  | { kind: "derive"; id: number; input: ConfigInput };

export type EngineResponse = { kind: "derive"; id: number; result: DeriveOutcome };

export type DeriveOutcome =
  | { status: "ok"; derivation: UiDerivation }
  /** The worker has not been given a product/catalog/pricing yet. Not an error —
   *  the ordinary first-paint race, and the caller simply keeps its prior state. */
  | { status: "no-context" }
  /** The derive threw. `deriveForUi` throws on a bundle-assembly bug (a release
   *  with no catalog, I5); surfaced rather than swallowed into a blank price. */
  | { status: "error"; message: string };

/**
 * Run one derive against the cached context. A missing piece of context yields
 * `no-context`, NOT a derive against a partial one — deriving with the wrong
 * price table is a wrong number, and a wrong number is worse than a late one.
 */
export function runConfiguratorDerive(input: ConfigInput, ctx: EngineContext): DeriveOutcome {
  if (ctx.product === null || ctx.catalogs === null || ctx.pricing === null) {
    return { status: "no-context" };
  }
  try {
    return { status: "ok", derivation: deriveForUi(ctx.product, input, ctx.pricing, ctx.catalogs) };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
