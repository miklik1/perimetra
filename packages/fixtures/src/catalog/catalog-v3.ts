/**
 * `catalog@3` — the third immutable catalog release (CORE_SPEC §2, I3):
 * catalog@2 plus the swing-gate (Brány Křídlové) family's hardware. Built by
 * extending the v2 DATA into a new release — v1/v2 are never edited or deleted;
 * quotes stamped against an earlier catalog re-derive against it forever.
 *
 * What the swing gate adds over the sliding/fence corpus (CAR-33, FIL 2026
 * `Brány Křídlové` workbook, `Kalkulace` P-column BOM):
 *
 *  - Five NEW material-agnostic hardware components with no precedent anywhere:
 *    the ground travel-limiter `Limit S`, the drop-bolt latch `Zástrč`, the
 *    bolted frame kit `Sada k rámu (šroubovaná)` (a distinct SKU from the welded
 *    `frame_kit`@1300 — a second component on the SAME role would make
 *    resolveComponent throw CatalogAmbiguityError, so it carries its own
 *    `frame.kit.bolted` role), the handle set `Kování klika/koule`, and the
 *    hinge set `Sada pant`.
 *  - A gate-post role on the 100×100 post. The physical SKU `sloup_100` already
 *    exists in v2 but carries only the `fence.post` role; a gate hinge-post is
 *    the same profile serving a different structural role, so v3 re-declares
 *    `sloup_100` with BOTH `fence.post` and `frame.post` (v2's copy is
 *    immutable, so the extra role lands in this new version — the price entry
 *    `sloup_100`@1080 is unchanged).
 */
import type { Catalog } from "@repo/model";

import { catalogV2 } from "./catalog-v2.js";

export const catalogV3: Catalog = {
  id: "catalog@3",
  version: 3,

  materials: [...catalogV2.materials],
  sections: [...catalogV2.sections],

  components: [
    // Everything from v2 EXCEPT sloup_100, which is re-declared just below with
    // the added gate-post role (catalogs are immutable, so the extra role is a
    // new-version fact — the code and price stay identical).
    ...catalogV2.components.filter((c) => c.code !== "sloup_100"),
    {
      code: "sloup_100",
      name: "Sloup 100 (alu)",
      unit: "meter",
      // fence.post (v2 use) + frame.post (the swing-gate hinge post).
      roles: ["fence.post", "frame.post"],
      material: "alu",
      section: "jakl_100x100",
      stockLength_mm: 6000,
    },

    // --- swing-gate hardware (Kalkulace P24–P30 accessory lines) --------------
    { code: "limit_s", name: "Limit S", unit: "piece", roles: ["hardware.limiter"] },
    { code: "zastrc", name: "Zástrč", unit: "piece", roles: ["hardware.latch"] },
    {
      code: "frame_kit_bolted",
      name: "Sada k rámu (šroubovaná)",
      unit: "set",
      roles: ["frame.kit.bolted"],
    },
    {
      code: "kovani_klika_koule",
      name: "Kování klika/koule",
      unit: "piece",
      roles: ["hardware.handle"],
    },
    { code: "sada_pant", name: "Sada pant", unit: "piece", roles: ["hardware.hinge"] },
  ],
};
