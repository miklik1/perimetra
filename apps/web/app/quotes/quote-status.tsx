"use client";

import { useTranslations } from "@repo/i18n/web";
import { Badge } from "@repo/ui";

type Status = "draft" | "issued" | "accepted" | "declined" | "expired";

// Copper (the single UI accent) marks the live/actionable `issued` state;
// accepted is settled-neutral; the rest are quiet outlines. Amber (`deviation`)
// stays reserved for the deviated-piece signal — never a status here.
const TONE: Record<Status, "neutral" | "copper" | "outline"> = {
  draft: "outline",
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
