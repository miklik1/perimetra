"use client";

import { useTranslations } from "@repo/i18n/web";
import { Badge } from "@repo/ui";

type Status = "confirmed" | "in_production" | "completed" | "cancelled";

// Copper (the single UI accent) marks the actively-worked `in_production` state;
// confirmed is queued-neutral; completed/cancelled are quiet outlines. Amber
// (`deviation`) stays reserved for the deviated-piece signal — never a status.
const TONE: Record<Status, "neutral" | "copper" | "outline"> = {
  confirmed: "neutral",
  in_production: "copper",
  completed: "outline",
  cancelled: "outline",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations("orders");
  const tone = TONE[status as Status] ?? "outline";
  return <Badge tone={tone}>{t(`status.${status as Status}`)}</Badge>;
}
