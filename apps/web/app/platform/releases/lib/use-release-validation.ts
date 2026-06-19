"use client";

import * as React from "react";

import { slotScopes, validateRelease, type ExprScope, type ReleaseDefect } from "@repo/model";

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
}

const EMPTY: ReleaseValidation = {
  scopes: new Map(),
  defectsByWhere: new Map(),
  defects: [],
  errorCount: 0,
};

function compute(values: ReleaseDraftInput): ReleaseValidation {
  const parsed = releaseDraftSchema.safeParse(values);
  if (!parsed.success) return EMPTY;
  const { release, islandDefects } = buildReleaseFromDraft(parsed.data);

  let scopes = new Map<string, ExprScope>();
  let defects: ReleaseDefect[] = [];
  try {
    scopes = slotScopes(release);
    defects = validateRelease(release);
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
  return { scopes, defectsByWhere, defects: all, errorCount: all.length };
}

/**
 * Live, debounced client-side validation — the editor's spine. Runs the SAME
 * `validateRelease` the server publish gate runs (and `slotScopes` for
 * autocomplete), so what the author sees green publishes green. Subscribes to
 * form changes without forcing per-keystroke re-renders; only the validation
 * snapshot updates the tree.
 */
export function useReleaseValidation(form: ReleaseEditorForm): ReleaseValidation {
  const [result, setResult] = React.useState<ReleaseValidation>(() => compute(form.getValues()));

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch((values) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setResult(compute(values as ReleaseDraftInput)), 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form]);

  return result;
}

export const EMPTY_SCOPE: ExprScope = { known: new Set(), openPrefixes: [] };
