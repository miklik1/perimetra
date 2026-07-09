/**
 * `catalog@2` — the second immutable catalog release (CORE_SPEC §2, I3):
 * catalog@1 plus the fence-run family's components. Built by extending the
 * v1 DATA into a new release — catalog@1 itself is never edited or deleted;
 * quotes stamped against v1 re-derive against v1 forever (step 4 also proves
 * two catalog versions coexisting in one corpus).
 *
 * The fence components are the FIL `Ploty` reality (CAR-32): the 100 mm post
 * `Sloup 100` (priced per metre), the vertical `h-profil` fill carriers (the
 * 50 mm channel for 3D fills, the 25 mm channel for 2D — the Excel `P19`
 * switch), the horizontal lamella/planka fill (shared with the gate families),
 * the post/h-profil caps + footing + fill connector accessories, and the two
 * per-field labour lines (`Výroba`/`Montáž` are flat per-field in the fence
 * Excel, NOT hours × rate — so they are their own components, priced per piece,
 * decoupled from the gate's `manufacturing.rate` scalar). Every material
 * component ships an aluminium AND a steel variant (CAR-32: steel is now real,
 * not a deferred worklist item).
 */
import type { Catalog } from "@repo/model";

import { catalogV1 } from "./catalog-v1.js";

export const catalogV2: Catalog = {
  id: "catalog@2",
  version: 2,

  materials: [...catalogV1.materials],

  sections: [
    ...catalogV1.sections,
    // Sloup 100 — the 100 mm fence post.
    { code: "jakl_100x100", shape: "rect_tube", w_mm: 100, d_mm: 100, materials: ["alu", "steel"] },
    // h-profil 25 — the narrow fill carrier for 2D fills (h50 already in v1).
    { code: "h25", shape: "U", w_mm: 25, materials: ["alu", "steel"] },
  ],

  components: [
    ...catalogV1.components,

    // --- fence posts (Sloup 100, per-metre) ---------------------------------
    {
      code: "sloup_100",
      name: "Sloup 100 (alu)",
      unit: "meter",
      roles: ["fence.post"],
      material: "alu",
      section: "jakl_100x100",
      // Standard 6 m bars (industry default; FIL-confirm pending) — cut-list nesting.
      stockLength_mm: 6000,
    },
    {
      code: "sloup_100_steel",
      name: "Sloup 100 (ocel)",
      unit: "meter",
      roles: ["fence.post"],
      material: "steel",
      section: "jakl_100x100",
      stockLength_mm: 6000,
    },

    // --- fill carriers: the 25 mm h-profil for 2D fills (h50 lives in v1) ----
    {
      code: "h_profile_25",
      name: "h-profil 25 (alu)",
      unit: "meter",
      roles: ["frame.h_profile"],
      material: "alu",
      section: "h25",
    },
    {
      code: "h_profile_25_steel",
      name: "h-profil 25 (ocel)",
      unit: "meter",
      roles: ["frame.h_profile"],
      material: "steel",
      section: "h25",
    },

    // --- fence accessories (per piece) --------------------------------------
    { code: "krytka_roof", name: "Krytka roof", unit: "piece", roles: ["fence.cap.roof"] },
    {
      code: "krytka_sloup_100",
      name: "Krytka Sloup 100",
      unit: "piece",
      roles: ["fence.cap.post"],
    },
    {
      code: "krytka_h_profile",
      name: "Krytka h-profil",
      unit: "piece",
      roles: ["fence.cap.hprofile"],
    },
    { code: "patka_sloup", name: "Patka Sloup", unit: "piece", roles: ["fence.footing"] },

    // --- fence labour: flat per-field (NOT hours × rate) ---------------------
    {
      code: "fence_manufacturing",
      name: "Výroba",
      unit: "piece",
      roles: ["fence.manufacturing"],
    },
    {
      code: "fence_installation",
      name: "Montáž",
      unit: "piece",
      roles: ["fence.installation"],
    },
  ],
};
