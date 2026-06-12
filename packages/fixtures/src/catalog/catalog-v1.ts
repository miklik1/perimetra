/**
 * `catalog@1` — the first immutable catalog release (CORE_SPEC §2), authored
 * for the sliding-gate family. Components are the purchasable
 * (role × section × material) instances the engine resolves derivation
 * requests against; the same release yields an aluminum or steel gate purely
 * by which material the request carries (multi-material, step 2).
 *
 * Aluminum components keep the MVP's SKU codes (they ARE the alu SKUs — the
 * golden price tables key on them); steel variants carry a `_steel` suffix.
 * Components without `material` are deliberately material-agnostic (motors,
 * labor, hardware sets) and resolve by role alone. Physics fields (density,
 * kerf) stay unset until FIL/supplier-sourced — never invented.
 */
import type { Catalog } from "@repo/model";

export const catalogV1: Catalog = {
  id: "catalog@1",
  version: 1,

  materials: [
    { code: "alu", class: "metal", joiningMethods: ["weld", "screw"] },
    { code: "steel", class: "metal", joiningMethods: ["weld", "screw"] },
  ],

  sections: [
    { code: "L50x50", shape: "L", w_mm: 50, d_mm: 50, materials: ["alu", "steel"] },
    { code: "T50x50", shape: "T", w_mm: 50, d_mm: 50, materials: ["alu", "steel"] },
    { code: "h50", shape: "U", w_mm: 50, materials: ["alu", "steel"] },
    { code: "planka_100", shape: "flat", w_mm: 100, materials: ["alu", "steel"] },
    { code: "lamela_113", shape: "flat", w_mm: 113, materials: ["alu", "steel"] },
  ],

  components: [
    // --- frame profiles (material-specific: the multi-material surface) ------
    {
      code: "sloupek_l_50",
      name: "Sloupek L 50×50 (alu)",
      unit: "meter",
      roles: ["frame.l_profile"],
      material: "alu",
      section: "L50x50",
    },
    {
      code: "sloupek_l_50_steel",
      name: "Sloupek L 50×50 (ocel)",
      unit: "meter",
      roles: ["frame.l_profile"],
      material: "steel",
      section: "L50x50",
    },
    {
      code: "sloupek_t_50",
      name: "Sloupek T 50×50 (alu)",
      unit: "meter",
      roles: ["frame.t_post"],
      material: "alu",
      section: "T50x50",
    },
    {
      code: "sloupek_t_50_steel",
      name: "Sloupek T 50×50 (ocel)",
      unit: "meter",
      roles: ["frame.t_post"],
      material: "steel",
      section: "T50x50",
    },
    {
      code: "h_profile_50",
      name: "h-profil 50 (alu)",
      unit: "meter",
      roles: ["frame.h_profile"],
      material: "alu",
      section: "h50",
    },
    {
      code: "h_profile_50_steel",
      name: "h-profil 50 (ocel)",
      unit: "meter",
      roles: ["frame.h_profile"],
      material: "steel",
      section: "h50",
    },

    // --- fill (material × section instances) ---------------------------------
    {
      code: "planka_100",
      name: "PLAŇKA 100 (alu)",
      unit: "meter",
      roles: ["fill"],
      material: "alu",
      section: "planka_100",
      attrs: { profile_mm: 100 },
    },
    {
      code: "planka_100_steel",
      name: "PLAŇKA 100 (ocel)",
      unit: "meter",
      roles: ["fill"],
      material: "steel",
      section: "planka_100",
      attrs: { profile_mm: 100 },
    },
    {
      code: "lamela_113",
      name: "Lamela 113 (alu)",
      unit: "meter",
      roles: ["fill"],
      material: "alu",
      section: "lamela_113",
      attrs: { profile_mm: 113 },
    },
    {
      code: "lamela_113_steel",
      name: "Lamela 113 (ocel)",
      unit: "meter",
      roles: ["fill"],
      material: "steel",
      section: "lamela_113",
      attrs: { profile_mm: 113 },
    },

    // --- material-agnostic hardware ------------------------------------------
    {
      code: "top_guide_beam",
      name: "Nosník V-horní vedení",
      unit: "meter",
      roles: ["rail.top_guide"],
    },
    { code: "tower_post", name: "Tower sloupek", unit: "piece", roles: ["frame.tower_post"] },
    { code: "gear_rack", name: "Hřeben V6", unit: "meter", roles: ["drive.gear_rack"] },
    { code: "diagonal_tensioner", name: "Napínák", unit: "piece", roles: ["frame.tensioner"] },
    // The ENZO rail sets: two real SKUs, not a price ternary in the model —
    // price truth lives in the price table, keyed by component code.
    {
      code: "rail_set_enzo",
      name: "Sada kolejnice ENZO",
      unit: "set",
      roles: ["rail.set.standard"],
    },
    {
      code: "rail_set_enzo_long",
      name: "Sada kolejnice ENZO (dlouhá)",
      unit: "set",
      roles: ["rail.set.long"],
    },
    { code: "frame_kit", name: "Sada k rámu", unit: "set", roles: ["frame.kit"] },
    { code: "motor", name: "Pohon SOMFY ELIXO io", unit: "piece", roles: ["drive.motor"] },
    { code: "fill_connector", name: "Spojovák výplně", unit: "piece", roles: ["fill.connector"] },
    { code: "gsm_module", name: "park GSM", unit: "piece", roles: ["drive.gsm"] },
    {
      code: "rack_mount",
      name: "Hřeben V6 (uchycení)",
      unit: "meter",
      roles: ["drive.rack_mount"],
    },
    { code: "guide_roller", name: "Kladka JRS 30", unit: "piece", roles: ["drive.guide_roller"] },

    // --- labor ----------------------------------------------------------------
    { code: "manufacturing", name: "Výroba", unit: "hour", roles: ["labor.manufacturing"] },
    { code: "installation", name: "Montáž", unit: "set", roles: ["labor.installation"] },
  ],
};
