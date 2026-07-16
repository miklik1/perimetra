/**
 * `catalog@4` — the fourth immutable catalog release (CORE_SPEC §2, I3):
 * catalog@3 plus the pedestrian-gate (Branka) family's hardware. Built by
 * extending the v3 DATA into a new release — v1/v2/v3 are never edited or
 * deleted; quotes stamped against an earlier catalog re-derive against it
 * forever.
 *
 * What the branka completion adds over the swing corpus (CAR-34, FIL 2026
 * `Branky` workbook, `Kalkulace` accessory lines P24 + P26–P28):
 *
 *  - Three NEW material-agnostic hardware components, each on its OWN role so
 *    resolveComponent never sees two components on one role (the ambiguity the
 *    v3 header warns about — a branka lock set is a DISTINCT SKU from the swing
 *    `kovani_klika_koule`@1700 handle, so it carries its own `hardware.lockset`
 *    role rather than colliding on `hardware.handle`):
 *      · `sada_ram_sroub`  "Sada rám šroub"  (Excel P26/S26 = 1350) → hardware.frame_bolt
 *      · `sada_kovani`     "Sada kování"     (Excel P27/S27 = 1695) → hardware.lockset
 *      · `elektro_zamek`   "Elektro-zámek"   (Excel P24/S24 =  680) → hardware.electrolock (opt-in)
 *  - The hinge set is SHARED with the swing gate: FIL prices the same "Sada pant"
 *    @675 for both families (identical SKU + price), so branka reuses v3's
 *    `sada_pant` (role `hardware.hinge`) — no new component, no collision.
 *
 * branka@1's frame/fill/labour resolutions are unchanged by the move from @1 to
 * @4: section + material disambiguate every request (e.g. `frame.h_profile`+`h50`
 * still lands on `h_profile_50`, never v2's `h_profile_25`), and branka's
 * sections (L50x50, h50, planka_100) are byte-identical across the superset
 * chain — so its geometry/drawing goldens reproduce exactly; only the stamped
 * `catalogVersion` changes (1 → 4).
 */
import type { Catalog } from "@repo/model";

import { catalogV3 } from "./catalog-v3.js";

export const catalogV4: Catalog = {
  id: "catalog@4",
  version: 4,

  materials: [...catalogV3.materials],
  sections: [...catalogV3.sections],

  components: [
    ...catalogV3.components,

    // --- branka hardware (Branky Kalkulace P24, P26–P28) ---------------------
    // Distinct roles: a branka lock/frame-bolt set is a different SKU from the
    // swing gate's handle/frame kit, so each carries its own role (no ambiguity).
    // The hinge set (`sada_pant`, hardware.hinge) is inherited from v3 — same SKU.
    {
      code: "sada_ram_sroub",
      name: "Sada rám šroub",
      unit: "set",
      roles: ["hardware.frame_bolt"],
    },
    { code: "sada_kovani", name: "Sada kování", unit: "set", roles: ["hardware.lockset"] },
    {
      code: "elektro_zamek",
      name: "Elektro-zámek",
      unit: "piece",
      roles: ["hardware.electrolock"],
    },
  ],
};
