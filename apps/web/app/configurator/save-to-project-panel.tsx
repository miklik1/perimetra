"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import type { ConfigInput } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { Button, Panel } from "@repo/ui";
import { toIsoDate } from "@repo/utils";

import { errorMessageKey } from "../../lib/error-messages";
import { createProjectsQueries } from "../../lib/projects-queries";
import { toast } from "../../lib/toast";
import { appendInstanceToDocument } from "../site/persistence";

const inputClass =
  "border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 outline-none focus-visible:ring-2";

/**
 * Configurator → project hand-off (CAR-13, Linear): from the Souhrn step,
 * send the CURRENT configuration into a new or an existing project's site
 * document, then land on `/site/:projectId` with the new instance selected.
 *
 * Composes EXISTING contracts only — no new backend endpoint: create the
 * project (if new) → GET its site (current doc + optimistic-lock version) →
 * `appendInstanceToDocument` (pure, `../site/persistence.ts`; the SAME
 * id/placement rules the canvas's own "+ add" uses) → PUT the result back with
 * `expectedVersion`. A concurrent-save 409 surfaces as the shared "conflict"
 * message; retrying re-GETs, so it composes against the fresh version.
 */
export function SaveToProjectPanel({
  releaseId,
  productLabel,
  input,
}: {
  releaseId: string;
  productLabel: string;
  input: ConfigInput;
}) {
  const t = useTranslations("configurator");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectsQueries = createProjectsQueries(useApiClient());

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState(() => `${productLabel} ${toIsoDate(new Date())}`);
  const [existingId, setExistingId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fed by the SAME `list()` the /projects page uses — first page only (a
  // compact hand-off panel, not a second projects browser); only fetched once
  // the user actually picks the "existing project" mode.
  const existingProjects = useInfiniteQuery({
    ...projectsQueries.list(),
    enabled: mode === "existing",
  });
  const projects = existingProjects.data?.pages[0]?.items ?? [];

  const createMutation = useMutation(projectsQueries.create());
  const saveMutation = useMutation(projectsQueries.saveSite());

  const canSubmit = !submitting && (mode === "new" ? name.trim().length > 0 : existingId !== "");

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const projectId =
        mode === "new"
          ? (
              await createMutation.mutateAsync({
                input: { name: name.trim() },
                idempotencyKey: crypto.randomUUID(),
              })
            ).id
          : existingId;

      // `staleTime: 0` forces a fresh network read every attempt (including a
      // retry after a 409) — a cached, already-stale version would just
      // reproduce the same conflict.
      const current = await queryClient.fetchQuery({
        ...projectsQueries.site(projectId),
        staleTime: 0,
      });
      const { document, instanceId } = appendInstanceToDocument(
        current,
        projectId,
        releaseId,
        input,
      );
      await saveMutation.mutateAsync({
        projectId,
        input: { ...document, expectedVersion: current.version },
      });

      toast.success(t("saveToProject.saved"));
      router.push(`/site/${projectId}?focus=${instanceId}`);
    } catch (error) {
      toast.error(tErrors(errorMessageKey(error)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel className="flex flex-col gap-3 text-sm">
      <h2 className="font-semibold">{t("saveToProject.title")}</h2>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="radio"
            name="save-to-project-mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          {t("saveToProject.newProject")}
        </label>
        {mode === "new" && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("saveToProject.projectName")}
            aria-label={t("saveToProject.projectName")}
            className={inputClass}
          />
        )}

        <label className="flex items-center gap-2 font-medium">
          <input
            type="radio"
            name="save-to-project-mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          {t("saveToProject.existingProject")}
        </label>
        {mode === "existing" &&
          (existingProjects.isLoading ? (
            <p className="text-muted-foreground">{t("saveToProject.loadingProjects")}</p>
          ) : projects.length === 0 ? (
            <p className="text-muted-foreground">{t("saveToProject.noProjects")}</p>
          ) : (
            <select
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              aria-label={t("saveToProject.selectProject")}
              className={inputClass}
            >
              <option value="">{t("saveToProject.selectProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ))}
      </div>

      <Button
        type="button"
        variant="copper"
        size="sm"
        className="self-start"
        onClick={() => void submit()}
        disabled={!canSubmit}
      >
        {submitting ? t("saveToProject.saving") : t("saveToProject.submit")}
      </Button>
    </Panel>
  );
}
