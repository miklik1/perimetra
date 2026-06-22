"use client";

import * as React from "react";

import { type Catalog, type ExprScope } from "@repo/model";

import { runReleaseValidation, type ReleaseValidation } from "./release-engine";
import { type ReleaseDraftInput, type ReleaseEditorForm } from "./section-schemas";
import { useEngineWorker } from "./use-engine-worker";

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
  // Latest catalog reachable in the synchronous fallback without re-subscribing.
  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;

  const [result, setResult] = React.useState<ReleaseValidation>(() =>
    runReleaseValidation(form.getValues(), catalog),
  );

  // Last-write-wins: only the reply whose id matches the latest request applies.
  const tokenRef = React.useRef(0);
  const { post } = useEngineWorker((message) => {
    if (message.kind === "validate" && message.id === tokenRef.current) setResult(message.result);
  });

  const request = React.useCallback(
    (values: ReleaseDraftInput) => {
      const id = (tokenRef.current += 1);
      if (!post({ kind: "validate", id, values })) {
        setResult(runReleaseValidation(values, catalogRef.current));
      }
    },
    [post],
  );

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

  // Push the catalog to the worker cache, then re-validate when it changes (the
  // role/section/material checks only fire once it is present). The catalog
  // message is posted before the validate, so the worker validates against it.
  // Skip the re-validate on mount — the useState initializer already computed the
  // first snapshot — so a fresh editor does not double-compute.
  const mounted = React.useRef(false);
  React.useEffect(() => {
    post({ kind: "catalog", catalog });
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    request(form.getValues());
  }, [catalog, form, post, request]);

  return result;
}

export const EMPTY_SCOPE: ExprScope = { known: new Set(), openPrefixes: [] };
