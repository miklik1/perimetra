/**
 * Stable query-string + cache-key serialization. Server-safe (no platform deps)
 * so URL building and cache keys agree across browser, RN, and RSC. Single-homed
 * here (the pure leaf) because both `@repo/api` (endpoint URLs, query keys) and
 * `@repo/navigation` (typed route queries, ADR 0022) need the SAME ordering —
 * and `navigation → api` is not an allowed edge (ADR 0008/0011).
 *
 * `null`/`undefined` values are dropped; arrays expand to repeated keys
 * (`tags=a&tags=b`); everything else is coerced via `String()`. Booleans and
 * numbers round-trip as their literal text.
 */
export type SearchParamValue = string | number | boolean | null | undefined;
export type SearchParamsInput = Record<string, SearchParamValue | SearchParamValue[]>;

/**
 * The one normalization rule shared by URL building and cache keys: sort keys,
 * drop `null`/`undefined`, coerce the rest via `String()`. Returns sorted
 * `[key, stringValues[]]` pairs so the URL and the cache key can never disagree
 * on which values survive or how they stringify.
 */
function normalizeEntries(input: SearchParamsInput): [string, string[]][] {
  const entries: [string, string[]][] = [];
  for (const key of Object.keys(input).sort()) {
    const raw = input[key];
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (v): v is NonNullable<SearchParamValue> => v !== null && v !== undefined,
    );
    if (values.length) entries.push([key, values.map(String)]);
  }
  return entries;
}

/**
 * Build a `URLSearchParams` from a plain record. Keys are emitted in sorted
 * order so the serialized string is deterministic regardless of input key order
 * — the property that makes it safe to reuse inside a cache key.
 */
export function buildSearchParams(input: SearchParamsInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, values] of normalizeEntries(input)) {
    for (const value of values) params.append(key, value);
  }
  return params;
}

/**
 * Append serialized params to a path. Returns the path unchanged when nothing
 * survives serialization, so callers never emit a dangling `?`.
 */
export function appendSearchParams(path: string, input?: SearchParamsInput): string {
  if (!input) return path;
  const query = buildSearchParams(input).toString();
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

/**
 * Normalize a params record into a deterministic, key-sorted plain object for
 * use as a query-key segment. Drops `null`/`undefined` so `{ a: 1 }` and
 * `{ a: 1, b: undefined }` collapse to the same key. Use this instead of
 * stuffing a raw filters object into a key, where property order would
 * otherwise produce distinct cache entries for equivalent queries.
 */
export function stableParams(input?: SearchParamsInput): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!input) return out;
  for (const [key, values] of normalizeEntries(input)) {
    // Preserve input shape: array stays an array, scalar collapses to a string.
    out[key] = Array.isArray(input[key]) ? values : values[0]!;
  }
  return out;
}
