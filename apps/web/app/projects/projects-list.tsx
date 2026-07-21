"use client";

import Link from "next/link";

import { optimisticUpdate } from "@repo/api";
import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Badge, Button, EmptyState, Icon, Skeleton } from "@repo/ui";
import { formatDate } from "@repo/utils";
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
 * Reskinned to the canvas o-LIST look (copied VERBATIM from
 * orders-list.tsx/orders-client.tsx): a bare accessible `<table>` with
 * uppercase muted column heads, hairline-divided rows, per-row hover, and the
 * primary cell as a single stretched-link anchor (`after:inset-0`) so the row
 * is one tab stop. DELIBERATE divergence from the pure-nav orders list: this
 * row also carries archive/delete controls, so the actions cell is lifted
 * (`relative z-10`) above the stretched link's `after:absolute after:inset-0`
 * so those controls stay clickable and keyboard-reachable in their own right.
 *
 * Archive + delete are optimistic-with-rollback (`optimisticUpdate` over the
 * cached InfiniteData) — the row flips/disappears immediately, `onError`
 * restores the snapshot AND toasts (the helper's rollback is chained, not
 * overridden), `onSettled` revalidates against the server.
 */
export function ProjectsList() {
  const t = useTranslations("projects");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const projectsQueries = createProjectsQueries(useApiClient());
  const queryClient = useQueryClient();
  const listKey = projectKeys.list();

  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(projectsQueries.list());
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
    <section className="flex w-full flex-col gap-4">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
          {devErrorDetail(error) && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {devErrorDetail(error)}
            </span>
          )}
        </p>
      )}
      {isPending && !error && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!isPending && projects.length === 0 && !error && (
        <EmptyState>
          <EmptyState.Icon>
            <Icon name="layers" />
          </EmptyState.Icon>
          <EmptyState.Title>{t("empty")}</EmptyState.Title>
        </EmptyState>
      )}
      {projects.length > 0 && (
        <div className="relative min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.name")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.description")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.status")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-right text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.created")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-right text-xs font-medium uppercase tracking-wide"
                >
                  <span className="sr-only">{t("actionsLabel")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const archived = project.status === "archived";
                return (
                  <tr key={project.id} className="border-border hover:bg-chrome relative border-t">
                    <td className="py-3">
                      <Link
                        href={`/site/${project.id}`}
                        className={
                          archived
                            ? "text-muted-foreground focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
                            : "focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
                        }
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="py-3">
                      {project.description && (
                        <span className="text-muted-foreground block max-w-xs truncate text-xs">
                          {project.description}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <Badge tone={archived ? "outline" : "success"}>
                        {archived ? t("status.archived") : t("status.active")}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-data text-muted-foreground tabular-nums">
                        {formatDate(project.createdAt, { dateStyle: "medium" }, locale)}
                      </span>
                    </td>
                    <td className="relative z-10 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {!archived && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => archiveMutation.mutate(project.id)}
                            disabled={archiveMutation.isPending}
                            aria-label={`${t("archive")} ${project.name}`}
                          >
                            {t("archive")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMutation.mutate(project.id)}
                          disabled={removeMutation.isPending}
                          aria-label={`${t("delete")} ${project.name}`}
                          className="text-destructive hover:text-destructive"
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {projects.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="self-start"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </Button>
      )}
    </section>
  );
}
