"use client";

import { useTranslations } from "@repo/i18n/web";
import { Badge } from "@repo/ui";
import type { QuoteStatus } from "@repo/validators";

// The contract tuple IS the vocabulary — pointing at `QuoteStatus` (rather than
// re-typing the union) makes `Record<…>` below a compile-time exhaustiveness
// check against @repo/validators. That is what caught every site when ADR 0127
// removed the unwritable `draft`.
type Status = QuoteStatus;

// Copper (the single UI accent) marks the live/actionable `issued` state;
// accepted is settled-neutral; the rest are quiet outlines. Amber (`deviation`)
// stays reserved for the deviated-piece signal — never a status here.
const TONE: Record<Status, "neutral" | "copper" | "outline"> = {
  issued: "copper",
  accepted: "neutral",
  declined: "outline",
  expired: "outline",
};

export function QuoteStatusBadge({ status }: { status: string }) {
  const t = useTranslations("quotes");
  const tone = TONE[status as Status] ?? "outline";
  return <Badge tone={tone}>{t(`status.${status as Status}`)}</Badge>;
}
