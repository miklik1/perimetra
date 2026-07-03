"use client";

import type { Issue } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { cn } from "@repo/ui";

import { formatIssue, type IssueTranslator } from "../../lib/format-issue";

/**
 * Typed-issue list shared by the site results panel and the per-instance editor
 * (I5 — a problem is surfaced as its typed key + params, never a silent zero).
 * Issue texts render as a localized human sentence via {@link formatIssue}
 * (CAR-14, `issues.*` catalog).
 */
export function IssueList({ issues }: { issues: Issue[] }) {
  const t = useTranslations("site");
  const tIssues = useTranslations("issues") as unknown as IssueTranslator;
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, i) => (
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
          <span>{formatIssue(tIssues, issue)}</span>
        </li>
      ))}
    </ul>
  );
}
