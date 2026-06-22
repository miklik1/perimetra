"use client";

import * as React from "react";

import { type Catalog, type ExprScope } from "@repo/model";

import {
  runReleaseValidation,
  type EngineRequest,
  type EngineResponse,
  type ReleaseValidation,
} from "./release-engine";
import { type ReleaseDraftInput, type ReleaseEditorForm } from "./section-schemas";

export type { ReleaseValidation } from "./release-engine";

const DEBOUNCE_MS = 250;

/**
 * Live, debounced client-side validation — the editor's spine. Offloads the
 * pipeline (`buildReleaseFromDraft` → `slotScopes` + `validateRelease`) to a web
 * worker (ADR 0068 Phase 4) so a large release does not jank typing; the first
 * snapshot is computed synchronously so the initial render (and SSR / jsdom,
 * where `Worker` is absent) has data, and the whole hook degrades to the
 * synchronous path when no worker can be constructed. The public shape is
 * unchanged — every workbench/ExprField/dock consumer is untouched.
 */
export function useReleaseValidation(
  form: ReleaseEditorForm,
  catalog: Catalog | null = null,
): ReleaseValidation {
  // Latest catalog reachable inside the (form-keyed) watch without re-subscribing.
  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;

  const [result, setResult] = React.useState<ReleaseValidation>(() =>
    runReleaseValidation(form.getValues(), catalog),
  );

  // The worker handle (null → synchronous fallback) and the last-write-wins
  // token: only the reply whose id matches the latest request updates state.
  const workerRef = React.useRef<Worker | null>(null);
  const tokenRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./release-engine.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      // Bundler/runtime can't give us a module worker — stay on the sync path.
      return;
    }
    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const message = event.data;
      if (message.kind === "validate" && message.id === tokenRef.current) {
        setResult(message.result);
      }
    };
    workerRef.current = worker;
    // Seed the cached catalog (ordered before any validate the effects below send).
    worker.postMessage({ kind: "catalog", catalog: catalogRef.current } satisfies EngineRequest);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Request a fresh snapshot — via the worker (tagged, debounced upstream) or,
  // when there is none, synchronously on the main thread.
  const request = React.useCallback((values: ReleaseDraftInput) => {
    const worker = workerRef.current;
    if (worker) {
      const id = (tokenRef.current += 1);
      worker.postMessage({ kind: "validate", id, values } satisfies EngineRequest);
    } else {
      setResult(runReleaseValidation(values, catalogRef.current));
    }
  }, []);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => request(values as ReleaseDraftInput), DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form, request]);

  // Re-validate when the loaded catalog changes (the role/section/material checks
  // only fire once it is present). Push the new catalog to the worker cache, then
  // re-run. Skip the mount pass — the useState initializer already computed the
  // first snapshot — so a fresh editor does not double-compute.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    workerRef.current?.postMessage({ kind: "catalog", catalog } satisfies EngineRequest);
    request(form.getValues());
  }, [catalog, form, request]);

  return result;
}

export const EMPTY_SCOPE: ExprScope = { known: new Set(), openPrefixes: [] };
