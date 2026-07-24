"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, DisplayLabel } from "@repo/ui";

import { useRole } from "../../lib/use-role";
import { InvoicesList } from "./invoices-list";
import { IssueInvoicePanel } from "./issue-invoice-panel";

/**
 * Client subtree of the protected invoices page (ADR 0112 / ADR 0127 Wave A1),
 * gated like /quotes and /orders. The AppShell owns height + scroll +
 * `bg-background`, so the authed `<main>` drops `min-h-screen`/`bg-field` (the
 * per-surface min-h fix) — the AuthGuard fallback KEEPS `min-h-screen`/`bg-field`
 * since it renders bare, outside the shell's framed content slot.
 *
 * "Issue an invoice from an order" lives HERE, as a page-level action on the
 * list, rather than on a detail surface (ADR 0127): its order picker rides the
 * already-shipped `GET /v1/orders`, so it needs no new api read, no
 * `/orders/:id` surface and no edit to a shipped surface. `/invoices` is also
 * simply where the rep already is.
 *
 * The gate is FAIL-CLOSED: `useRole()` is `null` while `/v1/me` is in flight, so
 * the action stays hidden until the role is confirmed `admin`/`sales` — the exact
 * mirror of `@RequireRole('admin','sales')` on `InvoicesController`. This is UX
 * hygiene, not a security boundary; the api remains the authority.
 */
export function InvoicesClient() {
  const router = useRouter();
  const t = useTranslations("invoices");
  const role = useRole();
  const canIssue = role === "admin" || role === "sales";
  const [issuing, setIssuing] = useState(false);

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <DisplayLabel as="h1">{t("title")}</DisplayLabel>
          {canIssue && (
            <Button type="button" variant="copper" onClick={() => setIssuing((open) => !open)}>
              {t("issue.open")}
            </Button>
          )}
        </div>
        {canIssue && issuing && <IssueInvoicePanel onClose={() => setIssuing(false)} />}
        <InvoicesList />
      </main>
    </AuthGuard>
  );
}
