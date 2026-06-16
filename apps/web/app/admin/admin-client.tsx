"use client";

import { useRouter } from "next/navigation";

import { useApiClient, useAuthQueries, useInfiniteQuery, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { createAdminQueries } from "../../lib/admin-queries";
import { CatalogForm } from "./catalog-form";
import { PriceTableForm } from "./price-table-form";
import { ReleaseForm } from "./release-form";

/**
 * Admin publish surface (ADR 0061): catalog versions, releases, price tables.
 * Admin gate mirrors /team: reads `me?.role === "admin"` from the prefetched
 * query; non-admins see a notice. Server still enforces via `@RequireRole('admin')`.
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
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("catalogVersions")}</h2>
            <CatalogVersionsList />
            <CatalogForm />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("releases")}</h2>
            <ReleasesList />
            <ReleaseForm />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("priceTables")}</h2>
            <PriceTablesList />
            <PriceTableForm />
          </section>
        </>
      )}
    </main>
  );
}

const listClass = "text-muted-foreground flex flex-col gap-1 text-sm";

/** Compact read-only "what's published" list — an admin checks this before
 *  publishing (e.g. which catalog version a release can pin). */
function CatalogVersionsList() {
  const t = useTranslations("admin");
  const { data, isLoading } = useInfiniteQuery(
    createAdminQueries(useApiClient()).listCatalogVersions(),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noneYet")}</p>;
  return (
    <ul className={listClass}>
      {items.map((c) => (
        <li key={c.id} className="font-mono text-xs">
          catalog@{c.version}
        </li>
      ))}
    </ul>
  );
}

function ReleasesList() {
  const t = useTranslations("admin");
  const { data, isLoading } = useInfiniteQuery(createAdminQueries(useApiClient()).listReleases());
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noneYet")}</p>;
  return (
    <ul className={listClass}>
      {items.map((r) => (
        <li key={r.id} className="font-mono text-xs">
          {r.releaseId} · {r.status} · catalog@{r.catalogVersion}
        </li>
      ))}
    </ul>
  );
}

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
