/**
 * Resolution cascade (CORE_SPEC §4) — release → catalog → tenant → customer →
 * quote, most specific wins, full provenance retained (I8: overrides layer,
 * never mutate; removing one restores the layer below).
 *
 * ONE write path (I7): every override is validated by the same machinery as
 * direct config input — `adjustability` decides WHO may write a parameter at
 * all, and the envelope decides WHAT values pass:
 *
 *   - tenant/customer `param:` overrides patch the parameter's DEFAULT and
 *     must stay inside `domain` (a default is not a deviation);
 *   - quote `param:` overrides are DEVIATIONS — the parameter's `deviation`
 *     spec replaces `domain` as the envelope (bounds reject outside, warn
 *     requires a reason and flags the result, free is silent). No spec means
 *     the parameter does not bend beyond its domain.
 *   - `price:` overrides re-point price-table entries at any scope (later
 *     scopes win); `artifact:` overrides are quote-only and applied to the
 *     emitted parts after derivation (CORE_SPEC §6).
 *
 * Overrides are tenant-side-authored data, so every failure is a typed Issue
 * (ADR 0047) — never a throw, and never a silent skip (I5).
 */
import { evalNumber, parseOverrideTarget } from "@repo/model";
import type { Override, OverrideScope, ProductModelRelease, Scope } from "@repo/model";

import { buildScope, domainIssue, gateInputKeys, missingParams, typeDefect } from "./scope.js";
import { ConfigError, type ConfigInput, type Issue, type PriceTable } from "./types.js";

/** Cascade layers 3–5 as the caller's storage hands them over. */
export interface CascadeLayers {
  tenant?: Override[];
  customer?: Override[];
  quote?: Override[];
}

export interface CascadeOutcome {
  /** tenant/customer default patches ⊕ user input ⊕ quote deviations. */
  effectiveInput: ConfigInput;
  /** The price table with all `price:` overrides applied in cascade order. */
  effectivePrices: PriceTable;
  issues: Issue[];
  /** Every override that passed validation, in application order (I3). */
  appliedOverrideIds: string[];
  /** Quote-scope `artifact:` overrides, shape-validated — the pipeline applies
   *  them to the emitted parts (CORE_SPEC §6). */
  artifactOverrides: Override[];
}

const SCOPE_ORDER: OverrideScope[] = ["tenant", "customer", "quote"];

const issue = (
  key: string,
  params: Issue["params"],
  severity: Issue["severity"] = "error",
): Issue => ({
  key,
  severity,
  scope: "instance",
  params,
});

/** Special `price:` codes that address the table's rate fields, not a component. */
const PRICE_FIELDS = new Set(["manufacturing_rate", "manufacturing_multiplier", "installation"]);

function applyPriceOverride(prices: PriceTable, code: string, value: number): PriceTable {
  switch (code) {
    case "manufacturing_rate":
      return { ...prices, manufacturing: { ...prices.manufacturing, rate: value } };
    case "manufacturing_multiplier":
      return { ...prices, manufacturing: { ...prices.manufacturing, multiplier: value } };
    case "installation":
      return { ...prices, installation: value };
    default:
      return { ...prices, components: { ...prices.components, [code]: value } };
  }
}

export function resolveCascade(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceTable,
  layers: CascadeLayers,
): CascadeOutcome {
  const issues: Issue[] = [];
  const appliedOverrideIds: string[] = [];
  const artifactOverrides: Override[] = [];
  const params = new Map(release.parameters.map((p) => [p.key, p]));

  let effectivePrices = prices;
  const defaultPatches: ConfigInput = {};
  const deviations: ConfigInput = {};
  const quoteParamOverrides: Override[] = [];

  // --- Single pass in cascade order: prices apply immediately (later scopes
  // win), param targets route by scope, artifact targets are quote-only.
  for (const scope of SCOPE_ORDER) {
    for (const override of layers[scope] ?? []) {
      if (override.scope !== scope) {
        issues.push(issue("engine.override.scope_mismatch", { id: override.id, scope }));
        continue;
      }
      const target = parseOverrideTarget(override.target);
      if (target === undefined) {
        issues.push(
          issue("engine.override.bad_target", { id: override.id, target: override.target }),
        );
        continue;
      }

      if (target.kind === "price") {
        if (typeof override.value !== "number" || override.value < 0) {
          issues.push(
            issue("engine.override.bad_price", { id: override.id, value: override.value }),
          );
          continue;
        }
        if (!PRICE_FIELDS.has(target.code) && !(target.code in effectivePrices.components)) {
          // New codes are legal (a tenant prices a SKU the base table lacks) —
          // but only deliberately: surface a warn so a typo never silently
          // creates a dead price entry.
          issues.push(
            issue("engine.override.new_price_code", { id: override.id, code: target.code }, "warn"),
          );
        }
        effectivePrices = applyPriceOverride(effectivePrices, target.code, override.value);
        appliedOverrideIds.push(override.id);
        continue;
      }

      if (target.kind === "artifact") {
        if (scope !== "quote") {
          issues.push(issue("engine.override.artifact_scope", { id: override.id, scope }));
          continue;
        }
        if (typeof override.value !== "number") {
          issues.push(
            issue("engine.override.bad_value", { id: override.id, value: override.value }),
          );
          continue;
        }
        if (target.field === "quantity" && override.pricingResolution === undefined) {
          // A quantity patch changes what the line costs — sales must say
          // whether the price follows (margin floor guards consume this).
          issues.push(issue("engine.override.pricing_resolution_required", { id: override.id }));
          continue;
        }
        artifactOverrides.push(override);
        appliedOverrideIds.push(override.id);
        continue;
      }

      // param target
      const param = params.get(target.key);
      if (param === undefined) {
        issues.push(issue("engine.input.unknown_param", { key: target.key }));
        continue;
      }
      if (param.adjustability === "vendor") {
        // I7 — no override scope may touch vendor-owned values.
        issues.push(issue("engine.input.not_adjustable", { key: target.key }));
        continue;
      }
      const expected = typeDefect(param, override.value);
      if (expected !== undefined) {
        issues.push(issue("engine.input.bad_type", { key: target.key, expected }));
        continue;
      }

      if (scope === "quote") {
        quoteParamOverrides.push(override);
        continue;
      }

      // tenant/customer: a default patch — the domain stays the envelope.
      const domain = domainIssue(param, override.value);
      if (domain) {
        issues.push(domain);
        continue;
      }
      defaultPatches[target.key] = override.value;
      appliedOverrideIds.push(override.id);
    }
  }

  // --- User input: per-key gate only; completeness is checked post-cascade.
  issues.push(...gateInputKeys(release, input));

  // --- Quote deviations. Bounds are expressions (the structural limit may
  // depend on other parameters), evaluated against the pre-deviation scope.
  let preScope: Scope | undefined;
  if (quoteParamOverrides.length > 0) {
    try {
      preScope = buildScope(release, { ...defaultPatches, ...input }, effectivePrices);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      // The scope itself is invalid (e.g. unresolvable option) — the pipeline
      // surfaces that; bounds are unevaluable here, value checks still ran.
    }
  }

  for (const override of quoteParamOverrides) {
    const key = override.target.slice("param:".length);
    const param = params.get(key)!;
    const spec = param.deviation;

    if (spec === undefined) {
      // No deviation knowledge authored — the parameter does not bend.
      const domain = domainIssue(param, override.value);
      if (domain) {
        issues.push(domain);
        continue;
      }
    } else {
      if (
        spec.bounds !== undefined &&
        typeof override.value === "number" &&
        preScope !== undefined
      ) {
        const min = evalNumber(spec.bounds.min, preScope);
        const max = evalNumber(spec.bounds.max, preScope);
        if (override.value < min || override.value > max) {
          issues.push(
            issue("engine.deviation.out_of_bounds", {
              key,
              value: override.value,
              min,
              max,
              ...(spec.note !== undefined && { note: spec.note }),
            }),
          );
          continue;
        }
      }
      if (spec.mode === "warn") {
        if (override.reason === undefined || override.reason.trim() === "") {
          issues.push(issue("engine.deviation.reason_required", { key, id: override.id }));
          continue;
        }
        // The accepted deviation is flagged — workshop and ledger both see it.
        issues.push(
          issue(
            "engine.deviation.applied",
            {
              key,
              value: override.value,
              reason: override.reason,
              ...(spec.note !== undefined && { note: spec.note }),
            },
            "warn",
          ),
        );
      }
    }

    deviations[key] = override.value;
    appliedOverrideIds.push(override.id);
  }

  const effectiveInput: ConfigInput = { ...defaultPatches, ...input, ...deviations };
  issues.push(...missingParams(release, new Set(Object.keys(effectiveInput))));

  return { effectiveInput, effectivePrices, issues, appliedOverrideIds, artifactOverrides };
}
