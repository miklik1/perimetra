"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useMutation, useQuery, useQueryClient } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

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
    <main className="bg-field mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <Link href="/customers" className="text-muted-foreground text-sm hover:underline">
        ← {t("backToList")}
      </Link>

      {!canManage ? (
        <p className="text-muted-foreground text-sm">{t("onlyAdminOrSales")}</p>
      ) : error ? (
        <p className="text-muted-foreground text-sm">
          {errorMessageKey(error) === "notFound" ? t("notFound") : tErrors(errorMessageKey(error))}
        </p>
      ) : (
        customer && (
          <>
            <div className="flex items-center justify-between gap-4">
              <h1 className="font-display text-2xl">{customer.name}</h1>
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
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">{t("status.archived")}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => restoreMutation.mutate(id)}
                    disabled={restoreMutation.isPending}
                  >
                    {restoreMutation.isPending ? t("restoring") : t("restore")}
                  </Button>
                </div>
              )}
            </div>
            <CustomerForm initial={customer} key={customer.id} />
          </>
        )
      )}
    </main>
  );
}
