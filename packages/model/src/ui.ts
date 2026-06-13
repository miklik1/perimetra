/**
 * Generated-UI resolution (CORE_SPEC §8): turn a release's `UiSpec` + the
 * per-parameter `relevance` expressions into what the configurator renders for
 * the CURRENT values. Pure — the same (release, scope) always resolves the
 * same surface (I1 applies to the UI too: a quote's wizard is reproducible).
 *
 * Visibility is fail-open: a relevance expression that cannot evaluate against
 * the given scope (e.g. it references an option attribute before the option is
 * chosen) leaves the parameter VISIBLE. Hiding what we cannot judge would be
 * the UI flavor of a silent zero (I5) — the engine's own gates still decide
 * what the value means.
 */
import { evalBoolean, type Scope } from "./expr.js";
import type { ParameterDef, ProductModelRelease, UiSpec } from "./schema.js";

export interface ResolvedUiParam {
  def: ParameterDef;
  /** `relevance` evaluated against the scope (true when absent/unevaluable). */
  visible: boolean;
}

export interface ResolvedUiGroup {
  id: string;
  label?: string;
  params: ResolvedUiParam[];
}

export interface ResolvedUiStep {
  id: string;
  label?: string;
  groups: ResolvedUiGroup[];
}

/** The fallback for a release authored without `ui`: one step, one group, all
 *  writable (non-vendor) parameters in declaration order. */
export function defaultUi(release: ProductModelRelease): UiSpec {
  return {
    steps: [
      {
        id: "config",
        groups: [
          {
            id: "config",
            params: release.parameters
              .filter((p) => p.adjustability !== "vendor")
              .map((p) => p.key),
          },
        ],
      },
    ],
  };
}

function isVisible(def: ParameterDef, scope: Scope): boolean {
  if (def.relevance === undefined) return true;
  try {
    return evalBoolean(def.relevance, scope);
  } catch {
    return true; // fail-open (see module doc)
  }
}

/**
 * Resolve the release's UI for one configuration state. `scope` is the
 * engine's evaluation scope when the config derived valid (params + option
 * attrs + derived), or any best-effort value map otherwise — relevance sees
 * exactly what the caller can honestly provide.
 *
 * Steps/groups are returned complete (with per-param `visible` flags) so a
 * wizard can keep stable step indices while values flip visibility.
 */
export function resolveUi(release: ProductModelRelease, scope: Scope): ResolvedUiStep[] {
  const byKey = new Map(release.parameters.map((p) => [p.key, p]));
  const spec = release.ui ?? defaultUi(release);
  return spec.steps.map((step) => ({
    id: step.id,
    ...(step.label !== undefined && { label: step.label }),
    groups: step.groups.map((group) => ({
      id: group.id,
      ...(group.label !== undefined && { label: group.label }),
      params: group.params
        .map((key) => byKey.get(key))
        .filter((def): def is ParameterDef => def !== undefined)
        .map((def) => ({ def, visible: isVisible(def, scope) })),
    })),
  }));
}
