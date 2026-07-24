"use client";

import { useTranslations } from "@repo/i18n/web";
import { Badge } from "@repo/ui";

type Status = "issued" | "paid";

/**
 * Invoice row-state badge (ADR 0112 §5 / ADR 0127). Copper — the single UI
 * accent — marks the LIVE, actionable `issued` state (money is still owed);
 * `success` marks the settled `paid` one. The vocabulary is exactly the two
 * statuses `invoiceStatusSchema` carries.
 *
 * There is deliberately NO "overdue" tone: overdue would have to be derived from
 * `dueOn` against a client clock, and a document's legal state is never a
 * function of the reader's wall clock. Payment is ROW state, confirmed by an
 * admin against a bank statement — never inferred here.
 */
const TONE: Record<Status, "neutral" | "copper" | "success"> = {
  issued: "copper",
  paid: "success",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const t = useTranslations("invoices");
  const tone = TONE[status as Status] ?? "outline";
  return <Badge tone={tone}>{t(`status.${status as Status}`)}</Badge>;
}
