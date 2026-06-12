/**
 * PII scrubber (ADR 0021): a pure, platform-neutral pass the Sentry bindings
 * wire into `beforeSend` / `beforeBreadcrumb`, so tokens, emails and Czech
 * rodná čísla never leave the device — the cross-package obligation created by
 * `@repo/validators/primitives/cz.ts` shipping a rodné-číslo validator (a
 * validated-but-REJECTED candidate value otherwise rides along in form-state
 * context or error messages).
 *
 * Deliberately NOT the validator's logic, and no `telemetry → validators`
 * import (the DAG forbids it): validation is strict input checking (anchored,
 * mod-11 checksum); redaction is fail-safe DETECTION in arbitrary text. The
 * RČ pattern below redacts anything rodné-číslo-SHAPED — including 9–10 digit
 * runs that would fail the checksum — because over-redacting an innocent
 * numeric id is acceptable and a leaked RČ is not.
 */

const REDACTED = "[Filtered]";

// Order matters: Bearer/JWT first so an email-less token line doesn't get
// partially rewritten by a later pattern.
const STRING_PATTERNS: RegExp[] = [
  // Authorization header values: "Bearer <anything token-ish>".
  /\bBearer\s+[\w\-.~+/]+=*/gi,
  // Bare JWTs (three base64url segments).
  /\b[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/g,
  // Emails.
  /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
  // Rodné číslo SHAPE: YYMMDD, optional "/", 3–4 digits — also catches the
  // slashless 9–10 digit form (see the fail-safe note above).
  /\b\d{6}\s*\/?\s*\d{3,4}\b/g,
];

// Fast-path guard: one alternation over the patterns above, tested before any
// `.replace` runs. Breadcrumbs are the SDK's highest-frequency hook and the
// overwhelming majority of their strings carry no PII — those now cost a
// single `.test()` instead of four allocating `.replace` passes. Keep in sync
// with STRING_PATTERNS (the test below asserts the equivalence).
const ANY_PATTERN = new RegExp(STRING_PATTERNS.map((p) => `(?:${p.source})`).join("|"), "i");

// Keys whose VALUES are redacted wholesale, wherever they appear in an event.
const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|password|secret|token|access[-_]?token|refresh[-_]?token|api[-_]?key|email|rodne[-_]?cislo|birth[-_]?number)$/i;

// SDK/build metadata that is never user input: stack-frame locations, module
// and symbol names, release/build identifiers. Exempt from string redaction so
// a purely-numeric chunk filename or dotted module name can't be rewritten to
// "[Filtered]" (which would break source-map resolution and issue grouping).
// SENSITIVE_KEYS is checked first and wins on any overlap.
const STRUCTURAL_KEYS =
  /^(filename|abs_path|module|function|event_id|release|dist|environment|server_name|platform)$/;

/** Redact every PII pattern occurrence inside one string. */
export function redactString(value: string): string {
  if (!ANY_PATTERN.test(value)) return value;
  let out = value;
  for (const pattern of STRING_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

// `path` tracks the CURRENT recursion chain only (add before descending,
// delete after), so true cycles are cut while diamond-shaped sharing — the
// same object referenced from two sibling branches, common in Sentry events —
// is cloned normally instead of being dropped on its second visit.
function scrubValue(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (path.has(value)) return undefined; // genuine cycle — drop rather than recurse
  path.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item) => scrubValue(item, path));
  } else {
    const record: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(key) && entry != null) record[key] = REDACTED;
      else if (STRUCTURAL_KEYS.test(key) && typeof entry === "string") record[key] = entry;
      else record[key] = scrubValue(entry, path);
    }
    out = record;
  }
  path.delete(value);
  return out;
}

/**
 * Scrub a Sentry event (or any JSON-ish payload): every string field passes
 * `redactString`; values under sensitive keys are dropped wholesale;
 * structural SDK metadata (stack-frame paths, release ids) passes through
 * untouched. Pure — returns a scrubbed copy. Generic so the bindings can hand
 * it Sentry's own event types without this neutral module importing an SDK.
 */
export function scrubEvent<E>(event: E): E {
  return scrubValue(event, new WeakSet()) as E;
}

/** Breadcrumb variant of `scrubEvent` (same walk; named for the SDK hook). */
export function scrubBreadcrumb<B>(breadcrumb: B): B {
  return scrubEvent(breadcrumb);
}
