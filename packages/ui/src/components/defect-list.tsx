import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * A grouped, severity-coded, click-to-navigate defect panel — the editor's
 * right-dock validation surface. Generalizes the inline 422 rendering the
 * raw-JSON publish form used (`where · code` + message). Domain-agnostic: it
 * renders any `{ code, where, message }` list, so the same component shows
 * client-side `validateRelease` output and re-mapped server 422 defects.
 */
export interface DefectListItem {
  code: string;
  where: string;
  message: string;
  /** Defaults to "error". */
  severity?: "error" | "warn";
}

export interface DefectListProps {
  defects: readonly DefectListItem[];
  /** Click a defect to focus its field/section. */
  onSelect?: (where: string) => void;
  emptyLabel?: React.ReactNode;
  className?: string;
}

export function DefectList({ defects, onSelect, emptyLabel, className }: DefectListProps) {
  if (defects.length === 0) {
    return emptyLabel ? (
      <p className="text-muted-foreground text-sm" data-slot="defect-list-empty">
        {emptyLabel}
      </p>
    ) : null;
  }

  return (
    <ul className={cn("flex flex-col gap-1", className)} data-slot="defect-list">
      {defects.map((defect, i) => {
        const tone =
          defect.severity === "warn" ? "text-amber-600 dark:text-amber-500" : "text-destructive";
        const body = (
          <>
            <span className="font-mono text-xs">
              {[defect.where, defect.code].filter(Boolean).join(" · ")}
            </span>
            {defect.message ? <span className="ml-2 text-sm">{defect.message}</span> : null}
          </>
        );
        return (
          <li key={`${defect.where}:${defect.code}:${i}`} className={tone}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(defect.where)}
                className="hover:bg-accent/50 block w-full rounded-md px-2 py-1 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="px-2 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
