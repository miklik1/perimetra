/**
 * Fixture execution (CORE_SPEC I2) — the price-free half of the publish gate.
 *
 * A release ships golden fixtures (config → expected derived dimensions). At
 * publish the server has the catalog but NO tenant price table, so this checks
 * only `expected.derived` — the PHYSICAL dimensions, which never depend on
 * prices. `expected.totalPrice` is regression-locked in the delta-0 proving
 * harness (which has a price table), not here. `validateRelease` enforces that
 * fixtures EXIST; this enforces that they REPRODUCE.
 */
import type { Catalog, GoldenFixture, ProductModelRelease } from "@repo/model";

import { derive } from "./derive.js";
import { buildScope } from "./scope.js";
import { ConfigError, type ConfigInput, type Issue, type PriceLayer } from "./types.js";

export interface FixtureCheck {
  name: string;
  ok: boolean;
  mismatches: { key: string; expected: number; actual: number | null }[];
  /** Catalog-resolution or config-time errors that stopped the derivation. */
  issues: Issue[];
}

/** Tolerance mirrors the delta-0 harness's `toBeCloseTo(…, 6)`. */
const FIXTURE_EPSILON = 5e-7;

/**
 * Fixtures assert PHYSICAL derived dimensions, which never depend on prices — so
 * the publish gate (no tenant price table) can still verify them. Components are
 * empty; the manufacturing/installation rates are present-but-zero so any
 * `price.*` reference in a parameter default still resolves (to 0) rather than
 * throwing.
 */
const NO_PRICES: PriceLayer = {
  components: {},
  manufacturing: { rate: 0, multiplier: 0 },
  installation: 0,
};

export function checkFixture(
  release: ProductModelRelease,
  fixture: GoldenFixture,
  catalog: Catalog,
): FixtureCheck {
  const expected = fixture.expected.derived ?? {};
  let scope;
  try {
    scope = buildScope(release, fixture.config as ConfigInput, NO_PRICES);
  } catch (error) {
    if (error instanceof ConfigError) {
      return { name: fixture.name, ok: false, mismatches: [], issues: [error.issue] };
    }
    throw error;
  }
  const outcome = derive(release, scope, catalog);
  const errorIssues = outcome.issues.filter((i) => i.severity === "error");
  const mismatches: FixtureCheck["mismatches"] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = outcome.derived[key];
    if (got === undefined || Math.abs(got - want) > FIXTURE_EPSILON) {
      mismatches.push({ key, expected: want, actual: got ?? null });
    }
  }
  return {
    name: fixture.name,
    ok: mismatches.length === 0 && errorIssues.length === 0,
    mismatches,
    issues: errorIssues,
  };
}

export function checkFixtures(release: ProductModelRelease, catalog: Catalog): FixtureCheck[] {
  return (release.fixtures ?? []).map((f) => checkFixture(release, f, catalog));
}
