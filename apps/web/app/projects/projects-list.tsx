"use client";

import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { optimisticUpdate } from "@repo/api";
import { type Project } from "@repo/validators";

import { devErrorDetail, errorMessageKey } from "../../lib/error-messages";
import { createProjectsQueries, projectKeys, type ProjectsPages } from "../../lib/projects-queries";
import { toast } from "../../lib/toast";

/** Patch every cached page's items in place (archive flips status, delete removes). */
function mapPages(
  current: ProjectsPages | undefined,
  patch: (items: Project[]) => Project[],
): ProjectsPages {
  if (!current) return { pages: [], pageParams: [] };
  return {
    ...current,
    pages: current.pages.map((page) => ({ ...page, items: patch(page.items) })),
  };
}

/**
 * Infinite cursor-paginated projects list (ADR 0018 pattern over the keyset
 * `paginated()` envelope): `useInfiniteQuery` over `projects.list()`, paging by
 * the `nextCursor` uuid. First page comes hydrated from the RSC prefetch.
 *
 * Archive + delete are optimistic-with-rollback (`optimisticUpdate` over the
 * cached InfiniteData) — the row flips/disappears immediately, `onError`
 * restores the snapshot AND toasts (the helper's rollback is chained, not
 * overridden), `onSettled` revalidates against the server.
 */
export function ProjectsList() {
  const t = useTranslations("projects");
  const tErrors = useTranslations("errors");
  const projectsQueries = createProjectsQueries(useApiClient());
  const queryClient = useQueryClient();
  const listKey = projectKeys.list();

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    projectsQueries.list(),
  );
  const projects = data?.pages.flatMap((page) => page.items) ?? [];

  const archiveOptimistic = optimisticUpdate<ProjectsPages, string>({
    queryClient,
    key: listKey,
    update: (current, id) =>
      mapPages(current, (items) =>
        items.map((p) => (p.id === id ? { ...p, status: "archived" } : p)),
      ),
  });
  const archiveMutation = useMutation({
    ...projectsQueries.archive(),
    ...archiveOptimistic,
    onSuccess: () => toast.success(t("archived")),
    onError: (err, id, context) => {
      archiveOptimistic.onError(err, id, context);
      toast.error(tErrors(errorMessageKey(err)));
    },
  });

  const removeOptimistic = optimisticUpdate<ProjectsPages, string>({
    queryClient,
    key: listKey,
    update: (current, id) => mapPages(current, (items) => items.filter((p) => p.id !== id)),
  });
  const removeMutation = useMutation({
    ...projectsQueries.remove(),
    ...removeOptimistic,
    onSuccess: () => toast.success(t("deleted")),
    onError: (err, id, context) => {
      removeOptimistic.onError(err, id, context);
      toast.error(tErrors(errorMessageKey(err)));
    },
  });

  return (
    <section className="border-border w-full rounded-md border p-4 text-sm">
      {error && (
        <p className="text-destructive" role="alert">
          {tErrors(errorMessageKey(error))}
          {devErrorDetail(error) && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {devErrorDetail(error)}
            </span>
          )}
        </p>
      )}
      {projects.length === 0 && !error && <p className="text-muted-foreground">{t("empty")}</p>}
      <ul className="mb-3 space-y-2">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className={project.status === "archived" ? "text-muted-foreground" : ""}>
                {project.name}
              </span>
              {project.description && (
                <span className="text-muted-foreground block truncate text-xs">
                  {project.description}
                </span>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              {project.status === "active" ? (
                <button
                  type="button"
                  onClick={() => archiveMutation.mutate(project.id)}
                  disabled={archiveMutation.isPending}
                  className="border-border rounded-md border px-2 py-1 text-xs disabled:opacity-50"
                >
                  {t("archive")}
                </button>
              ) : (
                <span className="text-muted-foreground px-2 py-1 text-xs">{t("archived")}</span>
              )}
              <button
                type="button"
                onClick={() => removeMutation.mutate(project.id)}
                disabled={removeMutation.isPending}
                className="border-border text-destructive rounded-md border px-2 py-1 text-xs disabled:opacity-50"
              >
                {t("delete")}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void fetchNextPage()}
        disabled={!hasNextPage || isFetchingNextPage}
        className="border-border rounded-md border px-3 py-1 disabled:opacity-50"
      >
        {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
      </button>
    </section>
  );
}
