/**
 * The engine's output types — the assembly graph and the derivation result
 * (CORE_SPEC §5). In slice 1 a single instance is the degenerate site (I11):
 * the assembly graph IS the whole result. Everything downstream (BOM, price,
 * and later cut list / 3D / 2D) derives from these parts — no consumer
 * recomputes geometry from raw config (I4).
 */
import type { BomCategory, BomUnit, Value } from "@repo/model";

/** One physical part produced by a {@link import("@repo/model").PartRule}. */
export interface Part {
  /** Stable id (I9) — survives re-derivation. */
  path: string;
  componentCode: string;
  name: string;
  unit: BomUnit;
  quantity: number;
  lengthMm?: number;
  category: BomCategory;
  /** Resolved unit price (from the price layer) — absent until priced. */
  pricePerUnit?: number;
  /** quantity × pricePerUnit, or an explicit override. */
  totalPrice?: number;
}

/** The derived assembly: named dimensions + the parts list. */
export interface AssemblyGraph {
  derived: Record<string, number>;
  parts: Part[];
}

/** A surfaced constraint outcome (CORE_SPEC §3). `key` is the i18n message key. */
export interface Issue {
  key: string;
  severity: "error" | "warn";
  scope: "instance" | "connection";
}

export interface CategoryTotals {
  material: number;
  accessory: number;
  manufacturing: number;
  installation: number;
  total: number;
}

export interface DerivationResult {
  isValid: boolean;
  derived: Record<string, number>;
  parts: Part[];
  totals: CategoryTotals;
  issues: Issue[];
}

/**
 * The price layer fed into derivation — component unit prices plus the
 * manufacturing rate/multiplier and installation price. Injected into the
 * evaluation scope under `price.*` (CORE_SPEC §4: a tenant-overridable cascade
 * layer; slice 1 takes it as a single table).
 */
export interface PriceTable {
  components: Record<string, number>;
  manufacturing: { rate: number; multiplier: number };
  installation: number;
}

/** Post-cascade input values for one instance. */
export type ConfigInput = Record<string, Value>;
