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

/**
 * A surfaced config-time problem (CORE_SPEC §3 constraints, plus the input
 * gate and catalog resolution). `key` is the i18n message key; `params` is the
 * interpolation payload. The taxonomy split: AUTHOR-time errors (bad release /
 * catalog data) throw, CONFIG-time errors (user-shaped input) become Issues —
 * never raw throws on user input.
 */
export interface Issue {
  key: string;
  severity: "error" | "warn";
  scope: "instance" | "connection";
  params?: Record<string, Value>;
}

/** Carries a config-time Issue out of a throwing code path; the pipeline
 *  converts it into an invalid result, never lets it escape to the caller. */
export class ConfigError extends Error {
  constructor(readonly issue: Issue) {
    super(`Config error: ${issue.key}`);
    this.name = "ConfigError";
  }
}

/** What a derivation ran against (I3) — quotes snapshot these to be
 *  re-derivable forever. Grows priceTableVersion + overrideIds in step 3. */
export interface Stamps {
  releaseId: string;
  catalogVersion: number;
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
  stamps: Stamps;
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
