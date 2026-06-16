"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { invalidateKeys } from "@repo/api";
import {
  useApiClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { createAdminQueries } from "../../lib/admin-queries";
import { createPlatformQueries, platformKeys } from "../../lib/platform-queries";
import { toast } from "../../lib/toast";
import { usePlatformAdmin } from "../../lib/use-role";
import { CatalogForm } from "./catalog-form";
import { ReleaseForm } from "./release-form";

/**
 * Platform/vendor console (ADR 0062) — the cross-tenant operator surface:
 * publish catalog/releases (authoring is vendor-only, §3) and assign published
 * releases to tenant orgs (per-tenant visibility). Gated on `isPlatformAdmin`
 * from `/v1/me`; the server enforces via `PlatformGuard`.
 */
export function PlatformClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <PlatformContent />
    </AuthGuard>
  );
}

function PlatformContent() {
  const t = useTranslations("platform");
  const isPlatform = usePlatformAdmin();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      {!isPlatform && <p className="text-muted-foreground text-sm">{t("onlyPlatform")}</p>}

      {isPlatform && (
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
            <h2 className="text-lg font-semibold">{t("assignTitle")}</h2>
            <p className="text-muted-foreground text-sm">{t("assignDescription")}</p>
            <AssignmentManager />
          </section>
        </>
      )}
    </main>
  );
}

const listClass = "text-muted-foreground flex flex-col gap-1 text-sm";
const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2";

/** Published catalog versions — context for which version a release can pin. */
function CatalogVersionsList() {
  const t = useTranslations("platform");
  const { data, isLoading } = useInfiniteQuery(
    createAdminQueries(useApiClient()).listCatalogVersions(),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noReleases")}</p>;
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

/** Every published release (global) — the vendor's catalog. */
function ReleasesList() {
  const t = useTranslations("platform");
  const { data, isLoading } = useInfiniteQuery(
    createPlatformQueries(useApiClient()).listReleases(),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noReleases")}</p>;
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

/**
 * Assign published releases to a tenant org (ADR 0062). Pick an org, then toggle
 * each release on/off. The mutations return the org's updated assignment set;
 * we invalidate the org's assignment query to reflect it.
 */
function AssignmentManager() {
  const t = useTranslations("platform");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const platformQueries = createPlatformQueries(client);
  const [orgId, setOrgId] = useState("");

  const { data: orgsData } = useQuery(platformQueries.listOrganizations());
  const orgs = orgsData?.items ?? [];

  const { data: releasesData } = useInfiniteQuery(platformQueries.listReleases());
  const releases = releasesData?.pages.flatMap((p) => p.items) ?? [];

  const { data: assignments } = useQuery({
    ...platformQueries.assignments(orgId),
    enabled: orgId !== "",
  });
  const assignedIds = new Set(assignments?.releaseIds ?? []);

  const invalidate = () => invalidateKeys(queryClient, [platformKeys.assignments(orgId)]);
  const onError = () => toast.error(t("assignError"));
  const assign = useMutation({ ...platformQueries.assign(), onSuccess: invalidate, onError });
  const unassign = useMutation({ ...platformQueries.unassign(), onSuccess: invalidate, onError });
  const busy = assign.isPending || unassign.isPending;

  return (
    <div className="border-border flex flex-col gap-4 rounded-md border p-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("selectOrg")}
        {/* Disabled while a toggle is in flight: switching orgId mid-mutation
            would redirect the settling mutation's cache invalidation to the new
            org's key, leaving the mutated org's assignment list stale. */}
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          disabled={busy}
          className={inputClass}
        >
          <option value="">—</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      {orgs.length === 0 && <p className={listClass}>{t("noOrgs")}</p>}

      {orgId !== "" && releases.length === 0 && <p className={listClass}>{t("noReleases")}</p>}

      {orgId !== "" && releases.length > 0 && (
        <ul className="flex flex-col gap-2">
          {releases.map((r) => {
            const isAssigned = assignedIds.has(r.releaseId);
            return (
              <li
                key={r.id}
                className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="font-mono text-xs">
                  {r.releaseId}
                  {isAssigned && <span className="ml-2 text-green-600">· {t("assigned")}</span>}
                </span>
                <Button
                  type="button"
                  variant={isAssigned ? "outline" : "default"}
                  disabled={busy}
                  onClick={() =>
                    isAssigned
                      ? unassign.mutate({ orgId, releaseId: r.releaseId })
                      : assign.mutate({ orgId, releaseId: r.releaseId })
                  }
                >
                  {isAssigned ? t("unassign") : t("assign")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
