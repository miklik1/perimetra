"use client";

import * as React from "react";

import {
  slotScopes,
  validateRelease,
  type Catalog,
  type ExprScope,
  type ProductModelRelease,
  type ReleaseDefect,
} from "@repo/model";

import { buildReleaseFromDraft, type IslandDefect } from "./draft";
import {
  releaseDraftSchema,
  type ReleaseDraftInput,
  type ReleaseEditorForm,
} from "./section-schemas";

export interface ReleaseValidation {
  /** Per-slot scope (by `where`) for the editor's ExprFields. */
  scopes: Map<string, ExprScope>;
  /** Defects indexed by `where` so each field reads its own. */
  defectsByWhere: Map<string, ReleaseDefect[]>;
  /** Every defect (release + JSON-island), for the dock list. */
  defects: (ReleaseDefect | IslandDefect)[];
  /** Blocking-defect count (Publish is disabled while > 0). */
  errorCount: number;
  /** The built release (for the clone diff, Phase 3D); null on a parse failure. */
  release: ProductModelRelease | null;
}

const EMPTY: ReleaseValidation = {
  scopes: new Map(),
  defectsByWhere: new Map(),
  defects: [],
  errorCount: 0,
  release: null,
};

function compute(values: ReleaseDraftInput, catalog: Catalog | null): ReleaseValidation {
  const parsed = releaseDraftSchema.safeParse(values);
  if (!parsed.success) return EMPTY;
  const { release, islandDefects } = buildReleaseFromDraft(parsed.data);

  let scopes = new Map<string, ExprScope>();
  let defects: ReleaseDefect[] = [];
  try {
    scopes = slotScopes(release);
    // Pass the loaded catalog so role/section/material checks (catalog.*.unknown)
    // match the server publish gate, which validates against the same catalog.
    defects = validateRelease(release, catalog ?? undefined);
  } catch {
    // A malformed JSON island can produce a shape validateRelease assumes but
    // does not get — surface it as one defect instead of crashing the editor.
    islandDefects.push({
      code: "structure.invalid",
      where: "release",
      message: "release structure is invalid — check the raw-JSON sections",
    });
  }

  const defectsByWhere = new Map<string, ReleaseDefect[]>();
  for (const defect of defects) {
    const list = defectsByWhere.get(defect.where) ?? [];
    list.push(defect);
    defectsByWhere.set(defect.where, list);
  }

  const all = [...defects, ...islandDefects];
  return { scopes, defectsByWhere, defects: all, errorCount: all.length, release };
}

/**
 * Live, debounced client-side validation — the editor's spine. Runs the SAME
 * `validateRelease` the server publish gate runs (and `slotScopes` for
 * autocomplete), so what the author sees green publishes green. Subscribes to
 * form changes without forcing per-keystroke re-renders; only the validation
 * snapshot updates the tree.
 */
export function useReleaseValidation(
  form: ReleaseEditorForm,
  catalog: Catalog | null = null,
): ReleaseValidation {
  // Keep the latest catalog reachable inside the (form-keyed) watch subscription
  // without re-subscribing on every catalog change.
  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;

  const [result, setResult] = React.useState<ReleaseValidation>(() =>
    compute(form.getValues(), catalog),
  );

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => setResult(compute(values as ReleaseDraftInput, catalogRef.current)),
        250,
      );
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form]);

  // Re-validate immediately when the loaded catalog changes (the role/section/
  // material checks only fire once it is present). Skip the mount run — the
  // useState initializer already computed the first snapshot — so a fresh editor
  // does not double-compute (which would re-render every workbench twice).
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setResult(compute(form.getValues(), catalog));
  }, [catalog, form]);

  return result;
}

export const EMPTY_SCOPE: ExprScope = { known: new Set(), openPrefixes: [] };
