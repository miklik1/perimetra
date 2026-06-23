/**
 * Structural diff of two `ProductModelRelease`s (ADR 0068 Phase 3D) — what a
 * clone-and-bump draft changed vs its source published release, BEFORE publish.
 * Compares the BUILT releases (canonical form), keyed by business key
 * (parameters/constraints/derived by `key`, parts by `path`) so a reorder is not
 * a change and a rename reads as add+remove; the not-yet-structured sections
 * (optionSets/ports/terrain/ui/fixtures) compare whole. The version bump is
 * reported separately (it is expected for a clone, not a content change).
 */
import { type ProductModelRelease } from "@repo/model";

type DiffSectionId = "parameters" | "constraints" | "derived" | "parts";

interface SectionDiff {
  section: DiffSectionId;
  /** Keys present in the draft but not the source. */
  added: string[];
  /** Keys present in the source but not the draft. */
  removed: string[];
  /** Keys present in both but no longer equal. */
  changed: string[];
}

export interface ReleaseDiff {
  /** True when any section/island content differs (the version bump excluded). */
  hasChanges: boolean;
  versionChanged: boolean;
  baseVersion: number;
  currentVersion: number;
  /** Only sections that actually changed. */
  sections: SectionDiff[];
  /** Island sections (optionSets/ports/terrain/ui) whose JSON differs. */
  islandsChanged: string[];
}

/** Order-insensitive deep equality over JSON-shaped values (Expr = string). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

function diffByKey<T>(
  base: readonly T[],
  current: readonly T[],
  keyOf: (item: T) => string,
): Omit<SectionDiff, "section"> {
  const baseMap = new Map(base.map((x) => [keyOf(x), x] as const));
  const currMap = new Map(current.map((x) => [keyOf(x), x] as const));
  const added: string[] = [];
  const changed: string[] = [];
  for (const [k, v] of currMap) {
    if (!baseMap.has(k)) added.push(k);
    else if (!deepEqual(baseMap.get(k), v)) changed.push(k);
  }
  const removed = [...baseMap.keys()].filter((k) => !currMap.has(k));
  return { added, removed, changed };
}

const ISLANDS = ["optionSets", "ports", "terrain", "ui", "fixtures"] as const;

export function diffRelease(base: ProductModelRelease, current: ProductModelRelease): ReleaseDiff {
  const sections: SectionDiff[] = [];
  const add = (section: DiffSectionId, d: Omit<SectionDiff, "section">): void => {
    if (d.added.length || d.removed.length || d.changed.length) sections.push({ section, ...d });
  };
  add(
    "parameters",
    diffByKey(base.parameters, current.parameters, (p) => p.key),
  );
  add(
    "constraints",
    diffByKey(base.constraints, current.constraints, (c) => c.key),
  );
  add(
    "derived",
    diffByKey(base.derivation.derived, current.derivation.derived, (d) => d.key),
  );
  add(
    "parts",
    diffByKey(base.derivation.parts, current.derivation.parts, (p) => p.path),
  );

  const islandsChanged = ISLANDS.filter((k) => !deepEqual(base[k], current[k]));

  return {
    hasChanges: sections.length > 0 || islandsChanged.length > 0,
    versionChanged: base.version !== current.version,
    baseVersion: base.version,
    currentVersion: current.version,
    sections,
    islandsChanged,
  };
}
