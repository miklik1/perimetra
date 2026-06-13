/**
 * Cut-list emission (CORE_SPEC §5, step 5) — the site graph's pieces as the
 * workshop's cutting instructions, with deterministic first-fit-decreasing
 * nesting into catalog stock lengths. Derives from pieces only (I4); a BOM
 * quantity is rolled-up purchasing truth, a cut line is physical truth — the
 * two coexist by design.
 *
 * Kerf is an explicit option (default 0 = not accounted) until fabrication
 * profiles carry sourced kerf data — never an invented constant. A piece
 * longer than its stock bar is surfaced on `oversize`, never dropped (I5).
 */
import type { PieceProfile, SiteResult } from "@repo/engine";

import { assertRenderable, consumedParts } from "./shared.js";

/** Identical cuts merged: same component, length, and end angles. */
export interface CutLine {
  componentCode: string;
  name: string;
  lengthMm: number;
  /** Mitre angles, arc-minutes (I10); absent end = square 90°. */
  cutArcMin?: { left?: number; right?: number };
  count: number;
  /** Every piece folded into this line (I9 site addresses). */
  sources: string[];
}

export interface StockBar {
  /** Bar number within its component group (deterministic FFD order). */
  index: number;
  stockLengthMm: number;
  cuts: { lengthMm: number; source: string }[];
  /** Material consumed: cut lengths plus kerf between cuts. */
  usedMm: number;
  offcutMm: number;
}

export interface ComponentCuts {
  componentCode: string;
  name: string;
  profile?: PieceProfile;
  /** Longest first, then by source address — stable across re-derivations. */
  lines: CutLine[];
  totalPieces: number;
  totalLengthMm: number;
  /** Present when the catalog declares a stock length for the component. */
  nesting?: {
    stockLengthMm: number;
    kerfMm: number;
    bars: StockBar[];
    /** Pieces longer than the stock bar — a splice/special-order decision for
     *  a human, surfaced instead of silently mis-nested (I5). */
    oversize: { lengthMm: number; source: string }[];
  };
}

export interface CutList {
  components: ComponentCuts[];
}

export interface CutListOptions {
  /** Blade kerf between cuts on one bar, mm. Explicit until fabrication
   *  profiles carry sourced kerf data. */
  kerfMm?: number;
}

interface PieceRef {
  lengthMm: number;
  source: string;
  cutArcMin?: { left?: number; right?: number };
}

const byLengthThenSource = (a: PieceRef, b: PieceRef): number =>
  b.lengthMm - a.lengthMm || (a.source < b.source ? -1 : 1);

export function buildCutList(result: SiteResult, options: CutListOptions = {}): CutList {
  assertRenderable(result, "a cut list");
  const kerfMm = options.kerfMm ?? 0;
  const consumed = consumedParts(result);

  /** componentCode → pieces + display facts. */
  const groups = new Map<
    string,
    { name: string; profile?: PieceProfile; stockLengthMm?: number; pieces: PieceRef[] }
  >();

  for (const [instanceId, instance] of Object.entries(result.instances)) {
    for (const part of instance.parts) {
      if (part.geometry === undefined) continue;
      if (consumed.has(`${instanceId}/${part.path}`)) continue;
      let group = groups.get(part.componentCode);
      if (group === undefined) {
        group = {
          name: part.name,
          ...(part.geometry.profile !== undefined && { profile: part.geometry.profile }),
          ...(part.geometry.stockLengthMm !== undefined && {
            stockLengthMm: part.geometry.stockLengthMm,
          }),
          pieces: [],
        };
        groups.set(part.componentCode, group);
      }
      for (const piece of part.geometry.pieces) {
        group.pieces.push({
          lengthMm: piece.lengthMm,
          source: `${instanceId}/${part.path}/${piece.id}`,
          ...(piece.cutArcMin !== undefined && { cutArcMin: piece.cutArcMin }),
        });
      }
    }
  }

  const components = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([componentCode, group]): ComponentCuts => {
      const pieces = [...group.pieces].sort(byLengthThenSource);

      // Merge identical cuts into lines.
      const lines: CutLine[] = [];
      for (const piece of pieces) {
        const angleKey = (cut?: { left?: number; right?: number }): string =>
          `${cut?.left ?? ""}|${cut?.right ?? ""}`;
        const last = lines.at(-1);
        if (
          last !== undefined &&
          last.lengthMm === piece.lengthMm &&
          angleKey(last.cutArcMin) === angleKey(piece.cutArcMin)
        ) {
          last.count += 1;
          last.sources.push(piece.source);
        } else {
          lines.push({
            componentCode,
            name: group.name,
            lengthMm: piece.lengthMm,
            ...(piece.cutArcMin !== undefined && { cutArcMin: piece.cutArcMin }),
            count: 1,
            sources: [piece.source],
          });
        }
      }

      const cuts: ComponentCuts = {
        componentCode,
        name: group.name,
        ...(group.profile !== undefined && { profile: group.profile }),
        lines,
        totalPieces: pieces.length,
        totalLengthMm: pieces.reduce((sum, p) => sum + p.lengthMm, 0),
      };

      if (group.stockLengthMm !== undefined) {
        cuts.nesting = nest(pieces, group.stockLengthMm, kerfMm);
      }
      return cuts;
    });

  return { components };
}

/** First-fit-decreasing — deterministic (pieces arrive pre-sorted), good
 *  enough until a fabrication profile demands true nesting. */
function nest(
  pieces: PieceRef[],
  stockLengthMm: number,
  kerfMm: number,
): NonNullable<ComponentCuts["nesting"]> {
  const bars: StockBar[] = [];
  const oversize: { lengthMm: number; source: string }[] = [];

  for (const piece of pieces) {
    if (piece.lengthMm > stockLengthMm) {
      oversize.push({ lengthMm: piece.lengthMm, source: piece.source });
      continue;
    }
    const needs = (bar: StockBar): number => piece.lengthMm + (bar.cuts.length > 0 ? kerfMm : 0);
    let bar = bars.find((b) => stockLengthMm - b.usedMm >= needs(b));
    if (bar === undefined) {
      bar = { index: bars.length, stockLengthMm, cuts: [], usedMm: 0, offcutMm: stockLengthMm };
      bars.push(bar);
    }
    bar.usedMm += needs(bar);
    bar.offcutMm = stockLengthMm - bar.usedMm;
    bar.cuts.push({ lengthMm: piece.lengthMm, source: piece.source });
  }

  return { stockLengthMm, kerfMm, bars, oversize };
}
