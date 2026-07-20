"use client";

import * as React from "react";

import type { ConfigInput } from "@repo/engine";
import type { Catalog } from "@repo/model";

import { useEngineWorker } from "../../../lib/engine-worker/use-engine-worker";
import type { UiDerivation } from "../derive";
import type { ConfigurableProduct, ConfiguratorPricing } from "../products";
import {
  runConfiguratorDerive,
  type DeriveOutcome,
  type EngineRequest,
  type EngineResponse,
} from "./configurator-engine";

/** §7.6: keystroke input in a form field debounces at 150 ms. */
const DEBOUNCE_MS = 150;

/**
 * The configurator's compute worker. The `new URL(…, import.meta.url)` must stay
 * here at the call site — bundlers statically analyse that exact expression.
 */
const createConfiguratorEngineWorker = (): Worker =>
  new Worker(new URL("./configurator-engine.worker.ts", import.meta.url), { type: "module" });

export interface ConfiguratorDerive {
  /** The last SUCCESSFUL derivation, held across recomputes so the scene and the
   *  form do not blank out mid-keystroke; null before the first one lands. */
  derivation: UiDerivation | null;
  /** True while a request is in flight — drives the computing indicator (§8.2). */
  computing: boolean;
  /** A derive failure (a bundle-assembly bug, I5), else null. */
  error: string | null;
  /**
   * Fire a derive for a synthetic input NOW, bypassing the 150 ms keystroke
   * debounce — the direct-manipulation drag path (§7.6: the drag emits at most
   * one derive per animation frame, and the caller does that rAF throttling).
   * The result flows into `derivation`/`computing`/`error` like any other, so the
   * live scene, price and defects track the drag; nothing is persisted (the
   * caller commits once, through the ordinary input state, on pointer-up). It
   * derives against the SAME cached context, so it inherits the price table and
   * catalog the effect ordering guarantees are current.
   */
  requestImmediate: (input: ConfigInput) => void;
}

/**
 * Run the configurator derive on the shared engine worker (ADR 0116), replacing
 * the `useMemo` that ran it synchronously on the main thread. §7.6 forbids the
 * main thread here: the derive re-runs per keystroke today and per animation
 * frame once direct manipulation lands, and on the main thread it competes with
 * the frames it exists to feed.
 *
 * Same seam as the release editor (ADR 0068 Phase 4A): monotonic id +
 * last-write-wins, context cached worker-side, and a synchronous fallback when no
 * `Worker` can be constructed (SSR, jsdom, a bundler that cannot give a module
 * worker) so behaviour is identical, only slower.
 *
 * ⚠️ THE EFFECT ORDER BELOW IS LOAD-BEARING. The two context-caching effects are
 * declared BEFORE the request effect, so on any render where both the context
 * and the input changed, the worker holds the new context before the request
 * that must derive against it. Inverting them derives the new input against the
 * PREVIOUS price table — which returns `status: "ok"` carrying a plausible,
 * wrong price. That is the failure this ordering exists to prevent; it is not a
 * crash and no test of the happy path would see it.
 *
 * The `no-context` outcome is a second, independent guard on the same class: the
 * worker refuses to derive against a partially-populated cache rather than
 * silently using the half it has. Belt and braces, because the consequence is a
 * wrong number on a rep's screen rather than a visible failure.
 */
export function useConfiguratorDerive(
  product: ConfigurableProduct,
  catalogs: ReadonlyMap<string, Catalog>,
  pricing: ConfiguratorPricing,
  input: ConfigInput,
): ConfiguratorDerive {
  const [derivation, setDerivation] = React.useState<UiDerivation | null>(null);
  const [computing, setComputing] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Mirrors for the synchronous fallback, which needs the CURRENT context
  // without re-creating the request callback on every context change.
  const productRef = React.useRef(product);
  productRef.current = product;
  const catalogsRef = React.useRef(catalogs);
  catalogsRef.current = catalogs;
  const pricingRef = React.useRef(pricing);
  pricingRef.current = pricing;

  const tokenRef = React.useRef(0);
  /** Whether any result has landed — the FIRST request skips the debounce, so a
   *  fresh mount paints real content immediately instead of after 150 ms. */
  const settledRef = React.useRef(false);

  // Switching product invalidates the held derivation: it describes the PREVIOUS
  // release's geometry, BOM and price. Without this the surface renders the old
  // product's scene and price under the new product's form for a debounce
  // interval — a visible wrong-product flash, and briefly a wrong number. Reset
  // during render (React's documented "adjust state when a prop changes"
  // pattern) rather than in an effect, so there is no frame where the two
  // disagree.
  const productIdRef = React.useRef(product.release.id);
  if (productIdRef.current !== product.release.id) {
    productIdRef.current = product.release.id;
    settledRef.current = false;
    // Invalidate any derive still in flight for the PREVIOUS product. Without
    // this bump the switch cleared the state but left `tokenRef` untouched, so a
    // response for the old product — posted by the worker in the gap between
    // this render and the effect flush that schedules the next request — still
    // matched the id guard and was installed under the NEW product: the old
    // release's price and margin beside the new one's catalog version, its scope
    // fed through `resolveUi` for a different release, its scene under the new
    // key. Bumping here means that response can no longer match anything.
    tokenRef.current += 1;
    setDerivation(null);
    setComputing(true);
    setError(null);
  }

  const apply = React.useCallback((outcome: DeriveOutcome) => {
    if (outcome.status === "no-context") return; // keep prior state; a later request covers it
    setComputing(false);
    settledRef.current = true;
    if (outcome.status === "error") {
      setError(outcome.message);
      return;
    }
    setError(null);
    setDerivation(outcome.derivation);
  }, []);

  const { post } = useEngineWorker<EngineRequest, EngineResponse>(
    createConfiguratorEngineWorker,
    (message) => {
      // Last-write-wins: an in-flight stale result is discarded, which is what
      // makes a per-frame request rate safe (§7.6).
      if (message.kind === "derive" && message.id === tokenRef.current) apply(message.result);
    },
  );

  const request = React.useCallback(
    (next: ConfigInput) => {
      const id = (tokenRef.current += 1);
      setComputing(true);
      if (!post({ kind: "derive", id, input: next })) {
        apply(
          runConfiguratorDerive(next, {
            product: productRef.current,
            catalogs: catalogsRef.current,
            pricing: pricingRef.current,
          }),
        );
      }
    },
    [post, apply],
  );

  // ── Context caching. DECLARED FIRST — see the ⚠️ note above. ───────────────
  React.useEffect(() => {
    post({ kind: "context", product, catalogs: [...catalogs] });
  }, [product, catalogs, post]);

  React.useEffect(() => {
    post({ kind: "pricing", pricing });
  }, [pricing, post]);

  // ── The request. DECLARED LAST, so the worker already holds the context this
  //    derive must run against. ───────────────────────────────────────────────
  React.useEffect(() => {
    const timer = setTimeout(() => request(input), settledRef.current ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [input, product, catalogs, pricing, request]);

  return { derivation, computing, error, requestImmediate: request };
}
