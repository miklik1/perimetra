"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useMutation, useQuery, useQueryClient } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Badge, Button, DisplayLabel, Panel } from "@repo/ui";

import { createCustomersQueries, customerKeys } from "../../../lib/customers-queries";
import { errorMessageKey } from "../../../lib/error-messages";
import { toast } from "../../../lib/toast";
import { useCanManageCustomers } from "../../../lib/use-role";
import { CustomerForm } from "../customer-form";

/**
 * Customer detail/edit client (ADR 0082/CAR-23) — the full field-set form
 * (`CustomerForm`, edit mode) plus the archive/restore action. Archive is a
 * REVERSIBLE `status` PATCH (never the GDPR-erase DELETE, which stays
 * backend-owned/unexposed here per the ticket's out-of-scope list — anonymize-
 * on-erasure semantics are untouched).
 *
 * Reskinned to the settings-layout idiom (copied from `orders-client.tsx`):
 * the AppShell owns height/scroll/`bg-background`, so the authed `<main>`
 * drops `min-h-screen`/`bg-field` — only the `AuthGuard` fallback keeps them,
 * since it renders bare, outside the shell's framed content slot (the
 * role-denied/not-found/error notices below render INSIDE the authed main,
 * so they're plain `Panel` notices, not a second bare-shell branch). The
 * titleband is a lighter cousin of the quote-detail one (`quote-detail.tsx`):
 * a back-link, a `DisplayLabel` name, a status `Badge`, and the archive/
 * restore action.
 */
export function CustomerDetailClient({ id }: { id: string }) {
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
      <Content id={id} />
    </AuthGuard>
  );
}

function Content({ id }: { id: string }) {
  const t = useTranslations("customers");
  const tErrors = useTranslations("errors");
  const canManage = useCanManageCustomers();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const queries = createCustomersQueries(client);
  const { data: customer, error } = useQuery({ ...queries.get(id), enabled: canManage });

  const archiveMutation = useMutation({
    ...queries.archive(),
    onSuccess: (updated) => {
      queryClient.setQueryData(customerKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      toast.success(t("archived"));
    },
    onError: (err) => toast.error(tErrors(errorMessageKey(err))),
  });

  const restoreMutation = useMutation({
    ...queries.restore(),
    onSuccess: (updated) => {
      queryClient.setQueryData(customerKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      toast.success(t("restored"));
    },
    onError: (err) => toast.error(tErrors(errorMessageKey(err))),
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
      <Link href="/customers" className="text-muted-foreground hover:text-foreground w-fit text-sm">
        ← {t("backToList")}
      </Link>

      {!canManage ? (
        <Panel elevation="flush">
          <p className="text-muted-foreground text-sm">{t("onlyAdminOrSales")}</p>
        </Panel>
      ) : error ? (
        <Panel elevation="flush">
          <p className="text-muted-foreground text-sm">
            {errorMessageKey(error) === "notFound"
              ? t("notFound")
              : tErrors(errorMessageKey(error))}
          </p>
        </Panel>
      ) : (
        customer && (
          <>
            <div className="border-border flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <DisplayLabel as="h1" className="text-3xl sm:text-4xl">
                  {customer.name}
                </DisplayLabel>
                <Badge tone={customer.status === "active" ? "success" : "outline"}>
                  {customer.status === "active" ? t("status.active") : t("status.archived")}
                </Badge>
              </div>
              {customer.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => archiveMutation.mutate(id)}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending ? t("archiving") : t("archive")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => restoreMutation.mutate(id)}
                  disabled={restoreMutation.isPending}
                >
                  {restoreMutation.isPending ? t("restoring") : t("restore")}
                </Button>
              )}
            </div>
            <CustomerForm initial={customer} key={customer.id} />
          </>
        )
      )}
    </main>
  );
}
