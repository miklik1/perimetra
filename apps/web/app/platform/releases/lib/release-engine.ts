/**
 * The editor's pure compute core — form state → validation snapshot — shared by
 * the main-thread fallback and the web worker (`release-engine.worker.ts`). Pure
 * and synchronous: it runs the SAME `validateRelease` the server publish gate
 * runs (and `slotScopes` for autocomplete), so what the author sees green
 * publishes green. Kept worker-agnostic so vitest can drive it without a Worker.
 *
 * Phase 4 (ADR 0068): moved off the validation hook so the (heavier, derive-
 * bearing) pipeline can run in a worker without janking the editor; the request
 * protocol below is the worker seam (validation now; live preview/derive next).
 */
import {
  slotScopes,
  validateRelease,
  type Catalog,
  type ExprScope,
  type ProductModelRelease,
  type ReleaseDefect,
} from "@repo/model";

import { buildReleaseFromDraft, type IslandDefect } from "./draft";
import { releaseDraftSchema, type ReleaseDraftInput } from "./section-schemas";

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

const EMPTY_VALIDATION: ReleaseValidation = {
  scopes: new Map(),
  defectsByWhere: new Map(),
  defects: [],
  errorCount: 0,
  release: null,
};

/**
 * Validate a draft: parse the form shape, build the release, then run the model
 * gate (`slotScopes` + `validateRelease`) against the loaded catalog (so the
 * `catalog.*.unknown` checks match the server gate). A malformed JSON island is
 * surfaced as one defect, never a thrown editor. The result is structured-clone
 * safe (Map/Set/plain objects, branded `ExprString` = string) so it crosses the
 * worker boundary unchanged.
 */
export function runReleaseValidation(
  values: ReleaseDraftInput,
  catalog: Catalog | null,
): ReleaseValidation {
  const parsed = releaseDraftSchema.safeParse(values);
  if (!parsed.success) return EMPTY_VALIDATION;
  const { release, islandDefects } = buildReleaseFromDraft(parsed.data);

  let scopes = new Map<string, ExprScope>();
  let defects: ReleaseDefect[] = [];
  try {
    scopes = slotScopes(release);
    defects = validateRelease(release, catalog ?? undefined);
  } catch {
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

// --- Worker message protocol -------------------------------------------------
// The catalog is sent once (and on change) and cached worker-side so it is not
// re-cloned on every keystroke; `validate` carries only the (small) form state.
// Each `validate` is tagged with a monotonic id; the main thread keeps the
// latest-sent id and drops any stale reply (last-write-wins).

export type EngineRequest =
  | { kind: "catalog"; catalog: Catalog | null }
  | { kind: "validate"; id: number; values: ReleaseDraftInput };

export type EngineResponse = { kind: "validate"; id: number; result: ReleaseValidation };
