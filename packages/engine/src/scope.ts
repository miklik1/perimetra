/**
 * Scope assembly (CORE_SPEC §4) — turns a release + config input + price layer
 * into the flat, dotted-key {@link Scope} the Expr DSL evaluates against.
 *
 * Slice 1 wires the layers that matter for delta-0:
 *   1. price.*            — the price layer (component prices + manufacturing /
 *                           installation), so part rules can reference them.
 *   2. parameter defaults — evaluated in declaration order (a default may
 *                           reference an earlier layer, e.g. `price.*`).
 *   3. config input       — the caller's chosen values win over defaults.
 *   4. <optionSet>.<attr> — the selected option's attributes (e.g. `fill.*`).
 *
 * The tenant / customer / quote override layers (CORE_SPEC §4) slot between (1)
 * and (3) in step 3 — the signature already passes the whole cascade through a
 * single scope, so adding them does not change the engine's shape.
 */
import { evalString, type Scope, type Value } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import type { ConfigInput, PriceTable } from "./types";

function priceScope(prices: PriceTable): Scope {
  const scope: Scope = {};
  for (const [code, value] of Object.entries(prices.components)) {
    scope[`price.${code}`] = value;
  }
  scope["price.manufacturing_rate"] = prices.manufacturing.rate;
  scope["price.manufacturing_multiplier"] = prices.manufacturing.multiplier;
  scope["price.installation"] = prices.installation;
  return scope;
}

/**
 * Resolve the cascade into an evaluation scope. Throws (via the Expr layer) on
 * an unresolvable default — never silently defaults a value (I5).
 */
export function buildScope(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
): Scope {
  const scope: Scope = priceScope(prices);

  // Parameter defaults, in declaration order so later defaults can reference
  // earlier ones (and the price layer already present above).
  for (const param of release.parameters) {
    if (param.default === undefined) continue;
    const value: Value =
      typeof param.default === "string" ? evalString(param.default, scope) : param.default;
    scope[param.key] = value;
  }

  // Caller input wins over defaults.
  for (const [key, value] of Object.entries(input)) {
    scope[key] = value;
  }

  // Inject the selected option's attributes under its set key.
  for (const set of release.optionSets ?? []) {
    const selectedId = scope[set.selectedBy];
    const option = set.options.find((o) => o.id === selectedId);
    if (!option) {
      throw new Error(
        `Unresolved option: ${set.selectedBy}="${String(selectedId)}" not in option set "${set.key}"`,
      );
    }
    for (const [attr, value] of Object.entries(option.attrs)) {
      // null attrs are absent, not zero — referencing one is an I5 error.
      if (value === null) continue;
      scope[`${set.key}.${attr}`] = value;
    }
  }

  return scope;
}
