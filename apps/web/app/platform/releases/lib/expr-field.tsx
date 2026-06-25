"use client";

import * as React from "react";

import { evaluate, parse, type ExprScope, type Scope } from "@repo/model";
import { fieldInputClass } from "@repo/ui/forms/field-shell";
import { cn } from "@repo/ui/lib/utils";

import {
  codeCandidates,
  completionCandidates,
  currentWord,
  exprStatus,
  formatExprValue,
  highlightSpans,
  type HighlightKind,
} from "./expr-authoring";

/**
 * A live derivation scope (the engine's post-derive `scope`, from the preview)
 * shared with every ExprField so it can show the formula's evaluated value
 * inline (`= 1840`). Null when no preview is live (or the sample config is
 * invalid); the readout is then simply absent. Provided at the editor level so
 * the workbenches stay prop-clean (ADR 0068 Phase 4).
 */
export const ExprEvalScopeContext = React.createContext<Scope | null>(null);

/** Token kind → Tailwind colour for the syntax overlay (theme-consistent, with
 *  dark variants; identifiers + whitespace inherit the field's text colour). */
const HIGHLIGHT_CLASS: Record<HighlightKind, string> = {
  number: "text-blue-600 dark:text-blue-400",
  string: "text-emerald-600 dark:text-emerald-400",
  function: "text-violet-600 dark:text-violet-400",
  keyword: "text-amber-600 dark:text-amber-400",
  ident: "",
  operator: "text-muted-foreground",
  punct: "text-muted-foreground",
  space: "",
  unknown: "text-destructive",
};

/**
 * The editor's keystone field: a monospace expression input with LIVE parse +
 * in-scope autocomplete + reference/function checking, all from the same
 * `@repo/model` primitives the publish gate uses (`slotScopes` feeds the
 * `scope`). Single-line. A character-faithful syntax-colour overlay sits behind
 * the (transparent-text) input, and — when a live derivation scope is in context
 * — the formula's evaluated value shows inline (`= 1840`) (ADR 0068 Phase 4).
 */
export interface ExprFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The slot's in-scope names + open prefixes, from `slotScopes(draft)`. */
  scope: ExprScope;
  /** Catalog codes this slot resolves to (section/material) — offered as quoted
   *  string-literal completions (`"code"`), the catalog-aware picker (Phase 2). */
  codeSuggestions?: readonly string[];
  /** A server/whole-release defect for this slot, shown if the local check is clean. */
  defect?: string;
  id?: string;
  describedById?: string;
  placeholder?: string;
  "aria-label"?: string;
}

export function ExprField({
  value,
  onChange,
  scope,
  codeSuggestions,
  defect,
  id,
  describedById,
  placeholder,
  "aria-label": ariaLabel,
}: ExprFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const pendingCaret = React.useRef<number | null>(null);

  const status = React.useMemo(() => exprStatus(value, scope), [value, scope]);

  // Inline evaluated value, against the live preview scope (when one is in
  // context and the formula evaluates cleanly there) — best-effort and never
  // throwing: a slot whose refs are not in the top-level scope just shows nothing.
  const evalScope = React.useContext(ExprEvalScopeContext);
  const evalReadout = React.useMemo(() => {
    if (evalScope === null || value.trim() === "") return null;
    try {
      return formatExprValue(evaluate(parse(value), evalScope));
    } catch {
      return null;
    }
  }, [evalScope, value]);
  const { word, start } = currentWord(value, caret);
  const candidates = React.useMemo(() => {
    if (!open) return [];
    const idents = completionCandidates(scope, word);
    const codes = codeSuggestions ? codeCandidates(codeSuggestions, word) : [];
    return [...new Set([...idents, ...codes])];
  }, [open, scope, word, codeSuggestions]);
  const showList = open && candidates.length > 0;

  // Apply a programmatic caret move after an autocomplete insertion.
  React.useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const accept = (candidate: string) => {
    // currentWord() walks only LEFT of the caret; consume the rest of the token to
    // its RIGHT too, so accepting with the caret mid-word replaces the whole word
    // (not just its left half — else `"L|50"` would keep the stray `50"`).
    let wordEnd = caret;
    while (wordEnd < value.length && /[A-Za-z0-9_.]/.test(value[wordEnd]!)) wordEnd++;
    // A quoted catalog-code completion typed next to an existing quote must not
    // double it (`"L50"` accepted at `"L|` → `"L50"`, not `""L50"`).
    let insert = candidate;
    if (insert.startsWith('"') && value[start - 1] === '"') insert = insert.slice(1);
    if (insert.endsWith('"') && value[wordEnd] === '"') insert = insert.slice(0, -1);
    const next = value.slice(0, start) + insert + value.slice(wordEnd);
    const nextCaret = start + insert.length;
    pendingCaret.current = nextCaret;
    setCaret(nextCaret);
    setOpen(false);
    setActiveIndex(0);
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(candidates[activeIndex]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const syncCaret = (e: { currentTarget: HTMLInputElement }) =>
    setCaret(e.currentTarget.selectionStart ?? 0);

  const message =
    status.kind === "parse-error" || status.kind === "ref-error" ? status.message : defect;
  const tone =
    status.kind === "parse-error"
      ? "error"
      : status.kind === "ref-error"
        ? "warn"
        : defect
          ? "warn"
          : null;

  return (
    <div className="relative" data-slot="expr-field">
      {/* Syntax overlay behind the transparent-text input. Identical box model
          (border + padding + font) so the colour layer aligns to the character;
          scroll-synced for long expressions. */}
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(
          fieldInputClass,
          "text-foreground pointer-events-none absolute inset-0 overflow-hidden whitespace-pre border-transparent font-mono",
        )}
      >
        {highlightSpans(value).map((span, i) => (
          <span key={i} className={HIGHLIGHT_CLASS[span.kind]}>
            {span.text}
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={showList ? listboxId : undefined}
        aria-invalid={status.kind === "parse-error" ? true : undefined}
        aria-describedby={message ? describedById : undefined}
        aria-expanded={showList}
        placeholder={placeholder}
        value={value}
        className={cn(
          fieldInputClass,
          "caret-foreground relative bg-transparent font-mono text-transparent",
        )}
        onChange={(e) => {
          setOpen(true);
          setActiveIndex(0);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          onChange(e.target.value);
        }}
        onScroll={(e) => {
          if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {status.kind === "ok" && evalReadout === null ? (
        <span
          aria-hidden
          className="text-muted-foreground bg-background pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs"
        >
          ✓
        </span>
      ) : null}
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          className="border-border bg-popover absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border py-1 text-sm shadow-md"
        >
          {candidates.map((candidate, i) => (
            <li key={candidate}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                // onMouseDown (not onClick) fires before the input's onBlur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(candidate);
                }}
                className={cn(
                  "block w-full px-2 py-1 text-left font-mono",
                  i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                {candidate}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <p
          id={describedById}
          role={tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-1 text-xs",
            tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-500",
          )}
        >
          {message}
        </p>
      ) : evalReadout !== null ? (
        <p className="text-muted-foreground mt-1 font-mono text-xs">= {evalReadout}</p>
      ) : null}
    </div>
  );
}
