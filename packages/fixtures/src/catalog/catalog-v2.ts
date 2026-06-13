/**
 * `catalog@2` — the second immutable catalog release (CORE_SPEC §2, I3):
 * catalog@1 plus the fence-run family's components. Built by extending the
 * v1 DATA into a new release — catalog@1 itself is never edited or deleted;
 * quotes stamped against v1 re-derive against v1 forever (step 4 also proves
 * two catalog versions coexisting in one corpus).
 *
 * Fence components are aluminum-only on purpose: the steel variants are a
 * vendor worklist item the resolution-gap Issue surfaces (CORE_SPEC §2), not
 * something to invent ahead of demand.
 */
import type { Catalog } from "@repo/model";

import { catalogV1 } from "./catalog-v1.js";

export const catalogV2: Catalog = {
  id: "catalog@2",
  version: 2,

  materials: [...catalogV1.materials],

  sections: [
    ...catalogV1.sections,
    { code: "jakl_60x60", shape: "rect_tube", w_mm: 60, d_mm: 60, materials: ["alu"] },
    { code: "jakl_40x20", shape: "rect_tube", w_mm: 40, d_mm: 20, materials: ["alu"] },
  ],

  components: [
    ...catalogV1.components,
    {
      code: "fence_post_60",
      name: "Plotový sloupek 60×60 (alu)",
      unit: "piece",
      roles: ["fence.post"],
      material: "alu",
      section: "jakl_60x60",
      // Standard 6 m bars (industry default; FIL-confirm pending) — step 5.
      stockLength_mm: 6000,
    },
    {
      code: "fence_rail_40x20",
      name: "Plotová příčle 40×20 (alu)",
      unit: "meter",
      roles: ["fence.rail"],
      material: "alu",
      section: "jakl_40x20",
      stockLength_mm: 6000,
    },
  ],
};
