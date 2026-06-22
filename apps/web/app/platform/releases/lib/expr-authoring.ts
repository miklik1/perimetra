/**
 * Pure helpers behind the editor's ExprField — kept separate from the component
 * so the make-or-break logic (parse, in-scope reference checking, autocomplete
 * candidates) is unit-tested directly. Every check mirrors `validateRelease`
 * (same `ExprScope`, same whitelist) so the field agrees with the publish gate.
 */
import {
  collectCalls,
  collectRefs,
  EXPR_FUNCTIONS,
  ExprError,
  isKnownFunction,
  parse,
  type ExprScope,
  type Value,
} from "@repo/model";

export type ExprStatus =
  | { kind: "empty" }
  | { kind: "ok" }
  | { kind: "parse-error"; message: string }
  | { kind: "ref-error"; message: string };

/**
 * Live status of an expression against its slot scope — exactly the checks
 * `validateRelease` runs (parse → unknown function → out-of-scope reference),
 * surfaced per keystroke so the author never waits for the full pass.
 */
export function exprStatus(value: string, scope: ExprScope): ExprStatus {
  if (value.trim() === "") return { kind: "empty" };
  let ast;
  try {
    ast = parse(value);
  } catch (error) {
    return {
      kind: "parse-error",
      message: error instanceof ExprError ? error.message : String(error),
    };
  }
  for (const fn of collectCalls(ast)) {
    if (!isKnownFunction(fn)) {
      return { kind: "ref-error", message: `"${fn}()" is not a whitelisted function` };
    }
  }
  for (const ref of collectRefs(ast)) {
    if (scope.openPrefixes.some((prefix) => ref.startsWith(prefix))) continue;
    if (!scope.known.has(ref)) {
      return { kind: "ref-error", message: `"${ref}" will not be in scope here` };
    }
  }
  return { kind: "ok" };
}

/** The dotted identifier being typed at the caret (for autocomplete). */
export function currentWord(value: string, caret: number): { word: string; start: number } {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_.]/.test(value[start - 1]!)) start--;
  return { word: value.slice(start, caret), start };
}

/**
 * Autocomplete candidates for a partial word at the caret: in-scope names, the
 * whitelisted functions (suffixed `(`), and the open prefixes (`price.` etc.) —
 * all derived from the slot's `ExprScope`, so adding a parameter immediately
 * makes it completable downstream.
 */
export function completionCandidates(scope: ExprScope, word: string, limit = 12): string[] {
  if (word === "") return [];
  const pool = [...scope.known, ...EXPR_FUNCTIONS.map((fn) => `${fn}(`), ...scope.openPrefixes];
  const lower = word.toLowerCase();
  return [...new Set(pool)]
    .filter((candidate) => candidate.toLowerCase().startsWith(lower) && candidate !== word)
    .sort()
    .slice(0, limit);
}

/**
 * Quoted string-literal completions for the catalog-code slots (a part's
 * `resolve.section` / `resolve.material`, ADR 0068 Phase 2). A catalog code
 * resolves as a STRING, so it completes to `"code"`, not a bare identifier —
 * catalog-aware authoring WITHOUT forking the one Expr path. Matched by the bare
 * word at the caret (prefix, case-insensitive); the empty word offers all codes
 * so a fresh field surfaces the catalog on focus.
 */
export function codeCandidates(codes: readonly string[], word: string, limit = 8): string[] {
  const lower = word.toLowerCase();
  return [...new Set(codes)]
    .filter((code) => word === "" || code.toLowerCase().startsWith(lower))
    .sort()
    .slice(0, limit)
    .map((code) => `"${code}"`);
}

// --- Syntax highlighting (ADR 0068 Phase 4) ----------------------------------

export type HighlightKind =
  | "number"
  | "string"
  | "function"
  | "keyword"
  | "ident"
  | "operator"
  | "punct"
  | "space"
  | "unknown";

export interface HighlightSpan {
  text: string;
  kind: HighlightKind;
}

const HL_KEYWORDS = new Set(["true", "false"]);
const HL_OPERATOR_CHARS = new Set(["|", "&", "=", "!", "<", ">", "+", "-", "*", "/", "%"]);

/**
 * Classify an expression's source into contiguous, character-faithful spans for
 * the ExprField syntax overlay — the concatenation of all `text` is exactly the
 * input, so the colored layer aligns with the caret to the character. This is a
 * COSMETIC lexer: it cannot reuse `@repo/model`'s `tokenize` (which drops
 * whitespace + the exact source of strings/numbers, so the overlay would desync
 * from the textbox), and a miscolor never affects validation — the canonical
 * `parse`/`validateRelease` still govern what publishes. A function is an
 * identifier whose next non-space character is `(`.
 */
export function highlightSpans(src: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  const push = (text: string, kind: HighlightKind) => {
    if (text !== "") spans.push({ text, kind });
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      push(src.slice(i, j), "space");
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      if (j < src.length) j++; // include the closing quote when present
      push(src.slice(i, j), "string");
      i = j;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      push(src.slice(i, j), "number");
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j]!)) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k]!)) k++;
      push(word, src[k] === "(" ? "function" : HL_KEYWORDS.has(word) ? "keyword" : "ident");
      i = j;
    } else if (c === "(" || c === ")" || c === ",") {
      push(c, "punct");
      i++;
    } else if (HL_OPERATOR_CHARS.has(c)) {
      let j = i;
      while (j < src.length && HL_OPERATOR_CHARS.has(src[j]!)) j++;
      push(src.slice(i, j), "operator");
      i = j;
    } else {
      push(c, "unknown");
      i++;
    }
  }
  return spans;
}

/** Render an evaluated Expr value for the inline `= …` readout: integers plain,
 *  fractions trimmed to 4 dp, strings quoted, booleans as-is. */
export function formatExprValue(value: Value): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e4) / 1e4);
  }
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}
