/**
 * Scope assembly (CORE_SPEC §4) — turns a release + config input + price layer
 * into the flat, dotted-key {@link Scope} the Expr DSL evaluates against.
 *
 * Two stages, split along the error taxonomy:
 *   - {@link gateInput} — the I7 enforcement point: every input key must name a
 *     writable parameter and satisfy its type + domain. Violations are
 *     CONFIG-time Issues (user-shaped input never throws raw).
 *   - {@link buildScope} — the cascade wiring for delta-0:
 *       1. price.*            — the price layer (component prices + rates)
 *       2. parameter defaults — evaluated in declaration order
 *       3. config input       — the caller's chosen values win over defaults
 *       4. <optionSet>.<attr> — the selected option's attributes (e.g. `fill.*`)
 *
 * The tenant / customer / quote override layers (CORE_SPEC §4) slot between (1)
 * and (3) in step 3 — the signature already passes the whole cascade through a
 * single scope, so adding them does not change the engine's shape.
 */
import { evalString, type ParameterDef, type Scope, type Value } from "@repo/model";
import type { ProductModelRelease } from "@repo/model";

import { ConfigError, type ConfigInput, type Issue, type PriceTable } from "./types";

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

const issue = (key: string, params: Issue["params"]): Issue => ({
  key,
  severity: "error",
  scope: "instance",
  params,
});

/** Expected JS type per parameter type; multiselect is deferred (unused). */
function typeDefect(param: ParameterDef, value: Value): string | undefined {
  switch (param.type) {
    case "length_mm":
      // Lengths are integer mm (I10).
      return typeof value === "number" && Number.isInteger(value) ? undefined : "integer mm";
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? undefined : "integer";
    case "bool":
      return typeof value === "boolean" ? undefined : "boolean";
    case "select":
    case "color":
    case "text":
      return typeof value === "string" ? undefined : "string";
    case "multiselect":
      return undefined;
  }
}

function domainIssue(param: ParameterDef, value: Value): Issue | undefined {
  const domain = param.domain;
  if (!domain) return undefined;
  if (domain.kind === "range" && typeof value === "number") {
    const { min, max, step } = domain;
    if (min !== undefined && value < min) {
      return issue("engine.input.below_min", { key: param.key, min, value });
    }
    if (max !== undefined && value > max) {
      return issue("engine.input.above_max", { key: param.key, max, value });
    }
    if (step !== undefined && !Number.isInteger((value - (min ?? 0)) / step)) {
      return issue("engine.input.off_step", { key: param.key, step, value });
    }
  }
  if (domain.kind === "enum" && !domain.values.includes(String(value))) {
    return issue("engine.input.not_in_enum", {
      key: param.key,
      value,
      allowed: domain.values.join(", "),
    });
  }
  if (domain.kind === "pattern" && !new RegExp(domain.pattern).test(String(value))) {
    return issue("engine.input.pattern", { key: param.key, value });
  }
  return undefined;
}

/**
 * The input gate — I7's enforcement point. Checks every supplied key (exists,
 * writable, well-typed, in domain) and that every parameter without a default
 * is supplied. Returns Issues; the pipeline stops before scope assembly on any.
 *
 * `ConfigInput` is the post-cascade write surface: user- and tenant-adjustable
 * parameters are writable through it; `vendor` values never are — the schema,
 * not UI convention, is what makes them unwritable (I7).
 */
export function gateInput(release: ProductModelRelease, input: ConfigInput): Issue[] {
  const issues: Issue[] = [];
  const params = new Map(release.parameters.map((p) => [p.key, p]));

  for (const [key, value] of Object.entries(input)) {
    if (key.includes(".")) {
      issues.push(issue("engine.input.reserved_key", { key }));
      continue;
    }
    const param = params.get(key);
    if (!param) {
      issues.push(issue("engine.input.unknown_param", { key }));
      continue;
    }
    if (param.adjustability === "vendor") {
      issues.push(issue("engine.input.not_adjustable", { key }));
      continue;
    }
    const expected = typeDefect(param, value);
    if (expected !== undefined) {
      issues.push(issue("engine.input.bad_type", { key, expected }));
      continue;
    }
    const domain = domainIssue(param, value);
    if (domain) issues.push(domain);
  }

  for (const param of release.parameters) {
    if (param.default === undefined && param.defaultExpr === undefined && !(param.key in input)) {
      issues.push(issue("engine.input.missing_param", { key: param.key }));
    }
  }

  return issues;
}

/**
 * Resolve the cascade into an evaluation scope. Author-time failures (an
 * unresolvable default expression) throw; the one config-time failure here —
 * an option id no option carries — throws a {@link ConfigError} the pipeline
 * converts into an invalid result (I5: typed, surfaced, never a silent skip).
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
    if (param.defaultExpr !== undefined) {
      scope[param.key] = evalString(param.defaultExpr, scope);
    } else if (param.default !== undefined) {
      scope[param.key] = param.default;
    }
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
      throw new ConfigError(
        issue("engine.option.unresolved", {
          key: set.selectedBy,
          value: String(selectedId),
          optionSet: set.key,
        }),
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
