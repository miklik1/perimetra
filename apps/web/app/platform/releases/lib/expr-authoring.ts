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
