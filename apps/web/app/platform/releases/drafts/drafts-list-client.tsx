"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { createPlatformQueries, platformKeys } from "../../../../lib/platform-queries";
import { toast } from "../../../../lib/toast";
import { usePlatformAdmin } from "../../../../lib/use-role";

const listClass = "text-muted-foreground flex flex-col gap-1 text-sm";

/**
 * Release-drafts resume list (ADR 0068 Phase 3B) — the vendor's in-flight drafts
 * (org-scoped, vendor-only). Resume opens the editor seeded from the draft;
 * delete discards it. Gated on `isPlatformAdmin`; the server enforces.
 */
export function DraftsListClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <DraftsContent />
    </AuthGuard>
  );
}

function DraftsContent() {
  const t = useTranslations("platform");
  const isPlatform = usePlatformAdmin();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const queries = createPlatformQueries(client);

  const { data, isLoading } = useInfiniteQuery(queries.listDrafts());
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const del = useMutation({
    ...queries.deleteDraft(),
    onSuccess: () => {
      invalidateKeys(queryClient, [platformKeys.draftsList()]);
      toast.success(t("draftDeleted"));
    },
    onError: () => toast.error(t("draftDeleteError")),
  });

  if (!isPlatform) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted-foreground text-sm">{t("onlyPlatform")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("draftsTitle")}</h1>
        <Button asChild>
          <Link href="/platform/releases/new">{t("newRelease")}</Link>
        </Button>
      </div>

      {isLoading ? (
        <p className={listClass}>{t("loadingList")}</p>
      ) : items.length === 0 ? (
        <p className={listClass}>{t("noDrafts")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="font-mono text-xs">
                {d.modelId || t("untitledDraft")} · v{d.version}
                {d.catalogVersion != null ? ` · catalog@${d.catalogVersion}` : ""}
                {d.baseReleaseId ? ` · ${t("clonedFrom", { releaseId: d.baseReleaseId })}` : ""}
              </span>
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link href={`/platform/releases/drafts/${d.id}`}>{t("resumeDraft")}</Link>
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={del.isPending}
                  onClick={() => {
                    if (window.confirm(t("deleteDraftConfirm"))) del.mutate({ id: d.id });
                  }}
                >
                  {t("deleteDraft")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
