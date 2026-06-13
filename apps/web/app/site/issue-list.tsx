"use client";

import type { Issue } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { cn } from "@repo/ui";

/**
 * Typed-issue list shared by the site results panel and the per-instance editor
 * (I5 — a problem is surfaced as its typed key + params, never a silent zero).
 * Issue texts render as `key (params)` for now; the issue-key i18n catalog is a
 * step-6 follow-up (ConstraintDef.key doubles as the message key by design).
 */
export function IssueList({ issues }: { issues: Issue[] }) {
  const t = useTranslations("site");
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, i) => {
        const params =
          issue.params === undefined
            ? ""
            : Object.entries(issue.params)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(", ");
        return (
          <li key={`${issue.key}-${i}`} className="flex items-baseline gap-2">
            <span
              className={cn(
                "rounded px-1.5 text-[10px] font-semibold uppercase",
                issue.severity === "error"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {issue.severity === "error" ? t("issueError") : t("issueWarn")}
            </span>
            <span>
              <code className="text-xs">{issue.key}</code>
              {params && <span className="text-muted-foreground text-xs"> ({params})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
