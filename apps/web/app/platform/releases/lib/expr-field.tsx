"use client";

import type { ExprScope } from "@repo/model";
import { fieldInputClass } from "@repo/ui/forms/field-shell";
import { cn } from "@repo/ui/lib/utils";
import * as React from "react";

import { completionCandidates, currentWord, exprStatus } from "./expr-authoring";

/**
 * The editor's keystone field: a monospace expression input with LIVE parse +
 * in-scope autocomplete + reference/function checking, all from the same
 * `@repo/model` primitives the publish gate uses (`slotScopes` feeds the
 * `scope`). Single-line — every Phase-1 expr slot is one line. Syntax-coloring
 * overlay + the inline evaluated value (`= 1840`) are Phase 4.
 */
export interface ExprFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** The slot's in-scope names + open prefixes, from `slotScopes(draft)`. */
  scope: ExprScope;
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
  defect,
  id,
  describedById,
  placeholder,
  "aria-label": ariaLabel,
}: ExprFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const pendingCaret = React.useRef<number | null>(null);

  const status = React.useMemo(() => exprStatus(value, scope), [value, scope]);
  const { word, start } = currentWord(value, caret);
  const candidates = React.useMemo(
    () => (open ? completionCandidates(scope, word) : []),
    [open, scope, word],
  );
  const showList = open && candidates.length > 0;

  // Apply a programmatic caret move after an autocomplete insertion.
  React.useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const accept = (candidate: string) => {
    const next = value.slice(0, start) + candidate + value.slice(caret);
    const nextCaret = start + candidate.length;
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
          "font-mono",
          status.kind === "parse-error" && "text-destructive",
        )}
        onChange={(e) => {
          setOpen(true);
          setActiveIndex(0);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {status.kind === "ok" ? (
        <span
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs"
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
      ) : null}
    </div>
  );
}
