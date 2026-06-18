"use client";

import { useRouter } from "next/navigation";

import { invalidateKeys, isHttpError } from "@repo/api";
import {
  useApiClient,
  useAuthQueries,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { adminKeys, createAdminQueries } from "../../lib/admin-queries";
import { toast } from "../../lib/toast";
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
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("productVersions")}</h2>
            <p className="text-muted-foreground text-sm">{t("productVersionsDescription")}</p>
            <ProductVersions />
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

/**
 * Opt-in upgrade surface (ADR 0064). Lists the models the org is pinned to for
 * which the vendor has assigned a newer version; "Upgrade" moves the org's pin
 * (explicit opt-in, CORE_SPEC §3). A cross-catalog opt-in is refused server-side
 * (422 `upgrade_catalog_conflict`) — surfaced as a specific message, not a generic
 * failure. Old quotes/saved sites on the prior version are untouched (I3).
 */
function ProductVersions() {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  const { data, isLoading } = useQuery(adminQueries.listUpgrades());
  const offers = data?.items ?? [];

  const pin = useMutation({
    ...adminQueries.pinVersion(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.upgrades()]);
      toast.success(t("upgraded"));
    },
    onError: (error) => toast.error(t(upgradeErrorKey(error))),
  });

  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (offers.length === 0) return <p className={listClass}>{t("noUpgrades")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {offers.map((o) => {
        // Scope the pending label to the row actually being upgraded — a single
        // shared mutation would otherwise show "Upgrading…" on every button.
        const upgrading = pin.isPending && pin.variables?.releaseId === o.latestReleaseId;
        return (
          <li
            key={o.modelId}
            className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="font-mono text-xs">
              {o.modelId} · {t("currentVersion", { version: o.pinnedVersion })} → v{o.latestVersion}
            </span>
            <Button
              type="button"
              disabled={pin.isPending}
              onClick={() => pin.mutate({ releaseId: o.latestReleaseId })}
            >
              {upgrading ? t("upgrading") : t("upgradeTo", { version: o.latestVersion })}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** A cross-catalog opt-in is the one domain-specific failure worth its own copy;
 *  everything else is a generic "couldn't upgrade". Returns an `admin.*` key. The
 *  `@repo/api` client already extracts the typed `code` off the error envelope. */
function upgradeErrorKey(error: unknown): "upgradeCatalogConflict" | "upgradeError" {
  if (isHttpError(error) && error.code === "upgrade_catalog_conflict") {
    return "upgradeCatalogConflict";
  }
  return "upgradeError";
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
