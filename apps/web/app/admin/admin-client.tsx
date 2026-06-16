"use client";

import { useRouter } from "next/navigation";

import { useApiClient, useAuthQueries, useInfiniteQuery, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { createAdminQueries } from "../../lib/admin-queries";
import { PriceTableForm } from "./price-table-form";

/**
 * Tenant admin surface (ADR 0061, retiered by ADR 0062): the org's PRICE TABLES.
 * Catalog/release publishing + per-tenant assignment moved to the platform/vendor
 * console (`/platform`) — authoring is vendor-only (CORE_SPEC §3). Admin gate
 * mirrors /team: reads `me?.role === "admin"` from the prefetched query; the
 * server still enforces via `@RequireRole('admin')` on the price-table routes.
 */
export function AdminClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <AdminContent />
    </AuthGuard>
  );
}

function AdminContent() {
  const t = useTranslations("admin");
  const authQueries = useAuthQueries();
  const { data: me } = useQuery(authQueries.me());
  const isAdmin = me?.role === "admin";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      {!isAdmin && <p className="text-muted-foreground text-sm">{t("onlyAdmin")}</p>}

      {isAdmin && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t("priceTables")}</h2>
          <PriceTablesList />
          <PriceTableForm />
        </section>
      )}
    </main>
  );
}

const listClass = "text-muted-foreground flex flex-col gap-1 text-sm";

function PriceTablesList() {
  const t = useTranslations("admin");
  const { data, isLoading } = useInfiniteQuery(
    createAdminQueries(useApiClient()).listPriceTables(),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noneYet")}</p>;
  return (
    <ul className={listClass}>
      {items.map((p) => (
        <li key={p.id} className="font-mono text-xs">
          v{p.version} · {p.currency} · {p.effectiveFrom.slice(0, 10)}
        </li>
      ))}
    </ul>
  );
}
