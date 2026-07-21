"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel } from "@repo/ui";

import { useCanManageCustomers } from "../../lib/use-role";
import { CustomerForm } from "./customer-form";
import { CustomersList } from "./customers-list";

/**
 * Client subtree of the protected `/customers` page (ADR 0082/CAR-23), gated
 * like `/quotes`. Below `<AuthGuard>`, the whole surface ALSO gates on
 * admin/sales (`useCanManageCustomers` mirrors the server's `@RequireRole
 * ("admin", "sales")` on `CustomersController` — workshop is denied fail-
 * closed) — the same pattern `LegalProfileClient` uses for its admin-only gate.
 *
 * Reskinned via the settings-layout idiom (ADR 0119/0120): the AppShell owns
 * height + scroll + `bg-background`, so the authed `<main>` drops
 * `min-h-screen`/`bg-field` — the AuthGuard fallback keeps `min-h-screen
 * bg-field` since it renders bare, outside the shell's framed content slot.
 */
export function CustomersClient() {
  const router = useRouter();
  const t = useTranslations("customers");
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const t = useTranslations("customers");
  const canManage = useCanManageCustomers();
  const [showNew, setShowNew] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
      <DisplayLabel as="h1">{t("title")}</DisplayLabel>

      {!canManage ? (
        <p className="text-muted-foreground text-sm">{t("onlyAdminOrSales")}</p>
      ) : (
        <>
          {showNew ? (
            <CustomerForm onSaved={() => setShowNew(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="text-copper self-start text-sm hover:underline"
            >
              + {t("newCustomer")}
            </button>
          )}
          <CustomersList />
        </>
      )}
    </main>
  );
}
