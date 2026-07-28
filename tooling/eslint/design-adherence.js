import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design-adherence rules, sourced from the design export itself (ADR 0137).
 *
 * The export ships `_adherence.oxlintrc.json` — the only automated adherence gate
 * that comes with it. This module READS that file and hands its rules to ESLint,
 * rather than restating them here, so the export stays the single source of truth
 * and a re-export changes the gate without anyone editing this file.
 *
 * ## Why ESLint and not oxlint
 *
 * The config is written for oxlint, and oxlint cannot run it. Measured against the
 * pinned oxlint 1.75.0, every rule in that file is a no-op here:
 *
 *   - `no-restricted-syntax` — which carries ALL THREE substantive checks (raw hex,
 *     raw px, non-system font) — is NOT IMPLEMENTED. oxlint refuses the whole config
 *     with "Rule 'no-restricted-syntax' not found in plugin 'eslint'".
 *   - `react/forbid-elements` ships `{"forbid": []}` — a no-op by construction.
 *   - `no-restricted-imports` targets `components/general/**` paths that exist only
 *     INSIDE the export; this repo's kit is `packages/ui/src/components/ui`, so it
 *     matches nothing here.
 *   - The file also carries a vendor `x-omelette` key that oxlint rejects outright.
 *
 * So wiring oxlint against it would have produced a green task that audits nothing —
 * ADR 1029's "the guards were guarding nothing", with the extra harm that it reads as
 * done. ESLint implements `no-restricted-syntax` and uses the same esquery selector
 * dialect the config is already written in, so the rule payloads transfer verbatim.
 *
 * ## Fail-closed
 *
 * Everything below throws rather than degrading to an empty rule set. A gate that
 * silently lints nothing is the failure this module exists to avoid, so a missing
 * export, an ambiguous one, or a re-export that drops the rules all stop the build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const EXPORT_ROOT = join(REPO_ROOT, "design", "_ds");

/**
 * The export directory name carries a per-export uuid, so it is discovered rather
 * than hard-coded. Exactly one export must be present: zero means the gate has no
 * source, and more than one means nobody can say which is authoritative.
 */
function findAdherenceConfig() {
  let entries;
  try {
    entries = readdirSync(EXPORT_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (cause) {
    throw new Error(`[design-adherence] cannot read the design export at ${EXPORT_ROOT}`, {
      cause,
    });
  }
  const found = entries
    .map((e) => join(EXPORT_ROOT, e.name, "_adherence.oxlintrc.json"))
    .filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
  if (found.length !== 1) {
    throw new Error(
      `[design-adherence] expected exactly ONE _adherence.oxlintrc.json under ${EXPORT_ROOT}, found ${found.length}. ` +
        `The adherence gate has no unambiguous source; resolve the export before linting.`,
    );
  }
  return found[0];
}

/**
 * The selectors the export is expected to carry. This is an ANTI-VACUITY check, not
 * a second copy of the rules: the messages and selectors still come from the export,
 * but if a re-export silently drops one of these checks the gate fails loudly instead
 * of quietly shrinking. Keyed by a stable fragment of each selector.
 */
const EXPECTED_SELECTOR_FRAGMENTS = [
  { name: "raw hex colour", fragment: "#[0-9a-fA-F]" },
  { name: "raw px value", fragment: "px" },
  { name: "non-system font-family", fragment: "font-family" },
];

/**
 * The raw-px check is READ and validated like the others, but deliberately NOT
 * enforced. It is written for a `var()`-authoring world; this repo styles with
 * Tailwind utilities, where an arbitrary value (`w-[220px]`, `min-h-[44px]`) IS the
 * sanctioned escape hatch and the design system's own kit uses one (`Badge` is
 * `text-[10px]`). Worse, it contradicts a standing decision: ADR 0114 §7.1 declined
 * to tokenise the spacing scale on purpose — the rung vocabulary is a COMMENT, not a
 * token set — so there is frequently no token to move a value to. The 14 hits on real
 * surfaces are rail widths and the 44px WCAG touch target, none of which the export
 * ships a token for.
 *
 * Enforcing it as written would force either a fake tokenisation or a tree full of
 * disable comments, and both are worse than saying plainly that it is off.
 *
 * TO ENABLE: the export must ship width/size tokens covering the rail and control
 * dimensions, and ADR 0114 §7.1 must be revisited. Until then this stays off, and the
 * anti-vacuity check above still requires the rule to EXIST — so if a re-export drops
 * or renames it, the gate says so rather than silently agreeing.
 */
const UNENFORCED_SELECTOR_FRAGMENTS = ["px"];

/** Reads the export's `no-restricted-syntax` entries. Throws if they are not usable. */
export function designAdherenceEntries() {
  const path = findAdherenceConfig();
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`[design-adherence] ${path} is not valid JSON`, { cause });
  }

  const rule = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(rule) || rule.length < 2) {
    throw new Error(
      `[design-adherence] ${path} carries no usable 'no-restricted-syntax' rule. ` +
        `That rule holds every substantive adherence check; without it this gate audits nothing.`,
    );
  }

  // Drop the leading severity ("warn"): this repo runs the checks as errors.
  const entries = rule.slice(1);
  const invalid = entries.filter((e) => typeof e?.selector !== "string" || !e.selector);
  if (invalid.length > 0) {
    throw new Error(`[design-adherence] ${path} has ${invalid.length} entr(ies) with no selector`);
  }

  for (const { name, fragment } of EXPECTED_SELECTOR_FRAGMENTS) {
    if (!entries.some((e) => e.selector.includes(fragment))) {
      throw new Error(
        `[design-adherence] the export no longer carries a '${name}' check ` +
          `(no selector containing ${JSON.stringify(fragment)} in ${path}). ` +
          `Either the export changed shape or a check was dropped — resolve it deliberately, ` +
          `do not let the gate silently shrink.`,
      );
    }
  }

  return entries;
}

/** The subset actually enforced — see `UNENFORCED_SELECTOR_FRAGMENTS`. */
export function enforcedAdherenceEntries() {
  const enforced = designAdherenceEntries().filter(
    (e) => !UNENFORCED_SELECTOR_FRAGMENTS.some((f) => e.selector.includes(f)),
  );
  if (enforced.length === 0) {
    throw new Error(
      `[design-adherence] every adherence check ended up filtered out — the gate would ` +
        `pass while auditing nothing. Refusing to lint vacuously.`,
    );
  }
  return enforced;
}

/**
 * The flat-config block. `files` is the caller's, because `apps/web` and
 * `packages/ui` spell their source globs differently.
 *
 * Scope note: the rules read STRING LITERALS, so they apply to product source only.
 * Tests, config and generated files are excluded by the caller — a raw `12px` in a
 * test assertion is describing the DOM, not authoring a style.
 */
export function designAdherenceConfig({ files, ignores = [] }) {
  return {
    files,
    ignores,
    rules: { "no-restricted-syntax": ["error", ...enforcedAdherenceEntries()] },
  };
}
