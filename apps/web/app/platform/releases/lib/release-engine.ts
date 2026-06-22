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
  deriveInstanceDetailed,
  type ConfigInput,
  type CostTable,
  type DerivationResult,
  type PriceTable,
} from "@repo/engine";
import {
  slotScopes,
  validateRelease,
  type Catalog,
  type ExprScope,
  type ProductModelRelease,
  type ReleaseDefect,
  type Scope,
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

// --- Live preview (ADR 0068 Phase 4) -----------------------------------------
// Derive the in-progress release on a sample input so the author SEES it produce
// (BOM/quantities/price/Issues). Pure, like validation, and run in the same
// worker so the heavier derive never janks typing. An invalid config emits typed
// Issues only, never a silent BOM (I5).

export type PreviewResult =
  | { status: "no-catalog" }
  | { status: "no-prices" }
  | { status: "no-release" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      result: DerivationResult;
      /** Post-derivation evaluation scope (params + option attrs + derived); the
       *  source of the per-formula `=value` readout. Null on an invalid config. */
      scope: Scope | null;
    };

/**
 * Derive the in-progress release on `input`. Needs a catalog (resolution targets
 * it) AND a price table — the engine treats a missing component price as an I5
 * error, not a zero, so there is no honest "BOM without prices"; absent either,
 * the preview is unavailable, not wrong (same contract the configurator holds).
 * A malformed in-progress release is caught and reported, never thrown, so the
 * worker survives partial authoring.
 */
export function runReleasePreview(
  values: ReleaseDraftInput,
  input: ConfigInput,
  catalog: Catalog | null,
  prices: PriceTable | null,
  cost: CostTable | null,
): PreviewResult {
  if (catalog === null) return { status: "no-catalog" };
  if (prices === null) return { status: "no-prices" };
  const parsed = releaseDraftSchema.safeParse(values);
  if (!parsed.success) return { status: "no-release" };

  let release: ProductModelRelease;
  try {
    release = buildReleaseFromDraft(parsed.data).release;
  } catch {
    return { status: "no-release" };
  }

  try {
    const detailed = deriveInstanceDetailed(release, input, prices, catalog, {
      ...(cost !== null && { costs: cost }),
    });
    return { status: "ok", result: detailed.result, scope: detailed.scope ?? null };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "derive failed" };
  }
}

// --- Worker message protocol -------------------------------------------------
// Catalog and price table are sent once (and on change) and cached worker-side
// so they are not re-cloned on every keystroke; `validate`/`preview` carry only
// the (small) form state + sample input. Each is tagged with a monotonic id;
// the main thread keeps the latest-sent id per kind and drops stale replies
// (last-write-wins).

export type EngineRequest =
  | { kind: "catalog"; catalog: Catalog | null }
  | { kind: "prices"; prices: PriceTable | null; cost: CostTable | null }
  | { kind: "validate"; id: number; values: ReleaseDraftInput }
  | { kind: "preview"; id: number; values: ReleaseDraftInput; input: ConfigInput };

export type EngineResponse =
  | { kind: "validate"; id: number; result: ReleaseValidation }
  | { kind: "preview"; id: number; result: PreviewResult };
