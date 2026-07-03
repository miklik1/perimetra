import type { Issue } from "@repo/engine";

/**
 * Renders an engine {@link Issue} as a localized, Czech-first human sentence
 * (CAR-14) — the single shared formatter for every issue-rendering surface
 * (configurator results, site issue list, per-instance panel). Replaces the
 * old `<code>{issue.key}</code> (k: v, …)` rendering on all of them.
 *
 * `Issue.key` is either an engine-structural I5 code (`engine.*`,
 * packages/engine/src) or a vendor-authored constraint key from release data
 * (ConstraintDef.key doubles as the i18n key by design, CORE_SPEC §3). Both
 * live under the `issues.*` catalog namespace (packages/i18n), nested to match
 * each key's dots — `t(issue.key)` resolves through next-intl's own dot-path
 * traversal, so there is no separate lookup layer to drift from the catalog.
 *
 * `t` is typed loosely (not next-intl's strict per-namespace union) because
 * `issue.key` is a runtime string, not a literal known at compile time — the
 * same shape/cast next-intl itself needs for dynamic keys elsewhere in this
 * repo (see `@repo/i18n`'s `Translator` / `zod-i18n-boot.tsx`'s
 * `t as unknown as Translator`). Call sites pass `useTranslations("issues")`
 * cast through {@link IssueTranslator}.
 */
export interface IssueTranslator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

/**
 * Issue keys whose message intentionally leaves these OPTIONAL params (absent
 * unless the emitting code actually supplied them) out of the main ICU
 * sentence — `formatIssue` appends each present one as a small translated
 * clause from `issues.fragment.*` instead of forcing every message to guard a
 * possibly-missing ICU argument.
 */
const OPTIONAL_FRAGMENTS: Record<string, readonly string[]> = {
  "engine.deviation.out_of_bounds": ["note"],
  "engine.deviation.applied": ["note"],
  "engine.deviation.artifact": ["reason"],
  "engine.catalog.unresolved": ["section", "material"],
};

/** String-coerce every param (`Issue.params` values are `Value` — number,
 *  string, or boolean; next-intl's ICU args here are plain strings — the
 *  precise-ICU-arg-types convention, ADR 0020). Extra/unused keys are
 *  harmless: next-intl only requires the ones a message template references. */
function toIcuValues(params: Issue["params"]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    values[key] = String(value);
  }
  return values;
}

function formatParamsList(params: Issue["params"]): string {
  if (params === undefined) return "";
  return Object.entries(params)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

/** A vendor-custom or otherwise uncatalogued key — never a crash, never a bare
 *  key: a generic sentence carrying the key + params visibly. */
function formatUnknownIssue(t: IssueTranslator, issue: Issue): string {
  const paramsText = formatParamsList(issue.params);
  const base = t("unknown", { key: issue.key });
  return paramsText ? base + t("fragment.params", { params: paramsText }) : base;
}

/** Render one engine {@link Issue} as a full localized sentence. Pure — takes
 *  `t` as a param so it unit-tests without React (CAR-14). */
export function formatIssue(t: IssueTranslator, issue: Issue): string {
  if (!t.has(issue.key)) return formatUnknownIssue(t, issue);

  let text = t(issue.key, toIcuValues(issue.params));

  for (const field of OPTIONAL_FRAGMENTS[issue.key] ?? []) {
    const value = issue.params?.[field];
    if (value === undefined) continue;
    text += t(`fragment.${field}`, { [field]: String(value) });
  }

  return text;
}
