/**
 * Layer A — the Catalog (CORE_SPEC §2): data with physics. Global,
 * vendor-authored, versioned as immutable releases (`catalog@N`, I3). The
 * engine consumes a catalog the same way it consumes a price table: as a
 * versioned data ARGUMENT, never ambient state — quote stamps record the
 * exact catalog version a derivation ran against.
 *
 * Step 2 implements the resolution subset (roles / sections / materials);
 * physics fields (density, kerf, joining) are schema-present but optional —
 * real data only, never invented (FIL/supplier-sourced), so they stay unset
 * until sourced.
 */

export type MaterialClass = "metal" | "wood" | "glass" | "composite";

export type JoiningMethod = "weld" | "screw" | "clamp" | "glue";

export interface Material {
  /** Stable code, doubles as the id in authored data ("alu", "steel", "oak"). */
  code: string;
  class: MaterialClass;
  /** Physics — real data only, never invented (feeds weight/nesting later). */
  density_g_cm3?: number;
  /** Links to fabrication-profile kerf defaults (cut-list step). */
  kerfClass?: string;
  finishes?: string[];
  /** Feeds connection validation (site graph, CORE_SPEC §5). */
  joiningMethods?: JoiningMethod[];
}

export type SectionShape = "L" | "U" | "T" | "rect_tube" | "flat" | "pane" | "custom";

export interface SectionProfile {
  /** Stable code, doubles as the id ("L50x50", "jakl_30x30", "planka_100"). */
  code: string;
  shape: SectionShape;
  w_mm?: number;
  d_mm?: number;
  wall_mm?: number;
  /** Which materials this section exists in (informational; the Component
   *  rows are the actual purchasable (section × material) instances). */
  materials?: string[];
}

export type ComponentUnit = "piece" | "meter" | "m2" | "kg" | "hour" | "set";

/**
 * A purchasable/cuttable unit. Resolution (CORE_SPEC §2) matches a derivation
 * recipe's `{role, section?, material?}` request against these rows: the role
 * must be carried, and section/material must equal the request when the
 * request specifies them. A component without `material`/`section` is
 * agnostic and matches only requests that don't constrain that axis.
 */
export interface Component {
  /** SKU-like code — the price table and BOM lines key on it. */
  code: string;
  name: string;
  unit: ComponentUnit;
  /** Semantic roles ("post.vertical", "rail.top_guide", "fill", "labor.manufacturing"). */
  roles: string[];
  /** Material.code this component is made of (omit = material-agnostic). */
  material?: string;
  /** SectionProfile.code (omit = no profile, e.g. motors, labor). */
  section?: string;
  /** Stock length for nesting (cut-list step). */
  stockLength_mm?: number;
  /** Typed extras (e.g. lamela width 113). */
  attrs?: Record<string, number | string | boolean>;
}

/** An immutable catalog release (`catalog@N`). Never edited, never deleted (I3). */
export interface Catalog {
  /** `"catalog@<version>"`. */
  id: string;
  version: number;
  materials: Material[];
  sections: SectionProfile[];
  components: Component[];
}
