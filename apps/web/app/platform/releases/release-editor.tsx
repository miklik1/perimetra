"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, invalidateKeys, isHttpError } from "@repo/api";
import { useApiClient, useMutation, useQuery, useQueryClient } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import type { ConfigInput } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { type ProductModelRelease } from "@repo/model";
import { Button, cn } from "@repo/ui";
import { DefectList, type DefectListItem } from "@repo/ui/components/defect-list";
import { NavTree, type NavTreeNode } from "@repo/ui/components/nav-tree";
import { useZodForm } from "@repo/ui/forms/use-zod-form";

import { createAdminQueries } from "../../../lib/admin-queries";
import { createPlatformQueries, platformKeys } from "../../../lib/platform-queries";
import { toast } from "../../../lib/toast";
import { usePlatformAdmin, usePriceBlind } from "../../../lib/use-role";
import { diffRelease, type ReleaseDiff } from "./lib/diff";
import { blankDraft, buildReleaseFromDraft } from "./lib/draft";
import { ExprEvalScopeContext } from "./lib/expr-field";
import { releaseDraftSchema, type ReleaseDraftInput } from "./lib/section-schemas";
import { useDraftAutosave, type SaveStatus } from "./lib/use-draft-autosave";
import { usePlatformCatalog } from "./lib/use-platform-catalog";
import { useActivePriceTable, useReleasePreview } from "./lib/use-release-preview";
import { useReleaseValidation } from "./lib/use-release-validation";
import { AdvancedWorkbench } from "./sections/advanced-workbench";
import { ConstraintsWorkbench } from "./sections/constraints-workbench";
import { DerivedWorkbench } from "./sections/derived-workbench";
import { IdentityWorkbench } from "./sections/identity-workbench";
import { ParametersWorkbench } from "./sections/parameters-workbench";
import { PartsWorkbench } from "./sections/parts-workbench";
import { PreviewTab } from "./sections/preview-tab";

const SECTIONS = ["identity", "parameters", "constraints", "derived", "parts", "advanced"] as const;
type SectionId = (typeof SECTIONS)[number];

/** The right dock has two tabs: the defect list and the live engine preview. */
type DockTabId = "defects" | "preview";

/** Which section owns a defect `where` (drives nav badges + click-to-navigate). */
function sectionForWhere(where: string): SectionId {
  if (where.startsWith("parameters[")) return "parameters";
  if (where.startsWith("constraints[")) return "constraints";
  if (where.startsWith("derived[")) return "derived";
  if (where.startsWith("parts[")) return "parts";
  return "advanced";
}

/** A draft loaded server-side to resume editing (Phase 3B/3C). */
export interface LoadedDraft {
  id: string;
  /** The editor form state (web `ReleaseDraftInput`), persisted opaque. */
  body: unknown;
  /** Provenance: the published "modelId@version" this was cloned from, if any. */
  baseReleaseId: string | null;
}

export function ReleaseEditorClient({ initial }: { initial?: LoadedDraft }) {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <EditorGate initial={initial} />
    </AuthGuard>
  );
}

function EditorGate({ initial }: { initial?: LoadedDraft }) {
  const t = useTranslations("releaseEditor");
  const isPlatform = usePlatformAdmin();
  if (!isPlatform) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted-foreground">{t("onlyPlatform")}</p>
      </main>
    );
  }
  return <Editor initial={initial} />;
}

export function Editor({ initial }: { initial?: LoadedDraft }) {
  const t = useTranslations("releaseEditor");
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);
  const platformQueries = createPlatformQueries(client);

  // Seed from the loaded draft (resume / clone) merged over a blank shape so a
  // partial/legacy body never leaves an array field undefined. No `form.reset`
  // (which would fire the autosave/validation watch) — seed at construction.
  const form = useZodForm(releaseDraftSchema, {
    defaultValues: { ...blankDraft(), ...((initial?.body as Partial<ReleaseDraftInput>) ?? {}) },
  });
  const catalogVersion = Number(form.watch("catalogVersion")) || 0;
  const { catalog, versions } = usePlatformCatalog(catalogVersion);
  const validation = useReleaseValidation(form, catalog);
  const [section, setSection] = useState<SectionId>("identity");
  const [dockTab, setDockTab] = useState<DockTabId>("defects");
  const modelId = form.watch("modelId");

  // Live engine preview (Phase 4), lifted here so its derivation scope feeds
  // BOTH the dock Preview tab and every workbench ExprField's inline `=value`
  // (via ExprEvalScopeContext). The derive runs in a worker, so keeping it live
  // does not jank the editor.
  const priceBlind = usePriceBlind();
  const prices = useActivePriceTable();
  const [previewInput, setPreviewInput] = useState<ConfigInput>({});
  const preview = useReleasePreview(
    form,
    catalog,
    prices?.table ?? null,
    prices?.cost ?? null,
    previewInput,
  );

  // Continuous autosave to the mutable draft store (Phase 3B). A fresh editor
  // creates the row on first edit, then swaps the URL to the draft so a reload
  // resumes; subsequent edits PATCH. Publish stays the immutable path below.
  const autosave = useDraftAutosave(form, {
    initialDraftId: initial?.id,
    baseReleaseId: initial?.baseReleaseId ?? null,
    onCreated: (id) => window.history.replaceState(null, "", `/platform/releases/drafts/${id}`),
  });
  const deleteDraft = useMutation(platformQueries.deleteDraft());

  // Clone diff (Phase 3D): for a cloned draft (baseReleaseId = the source's
  // natural key), lazy-load the source release and show what changed vs it,
  // before publishing. Recomputes off the built release the validator already
  // produced — no second build/subscription.
  const baseReleaseId = initial?.baseReleaseId ?? null;
  const { data: baseRelease } = useQuery({
    ...platformQueries.releaseByReleaseId(baseReleaseId ?? ""),
    enabled: baseReleaseId !== null,
  });
  const diff = useMemo(
    () =>
      baseRelease && validation.release
        ? diffRelease(baseRelease.body as ProductModelRelease, validation.release)
        : null,
    [baseRelease, validation.release],
  );

  // Pass the mutationOptions directly (not spread) so TanStack keeps the
  // variables/data generics; success handling rides the per-call options.
  const mutation = useMutation(adminQueries.publishRelease());

  const counts = useMemo(() => {
    const c: Record<SectionId, number> = {
      identity: 0,
      parameters: 0,
      constraints: 0,
      derived: 0,
      parts: 0,
      advanced: 0,
    };
    for (const defect of validation.defects) c[sectionForWhere(defect.where)] += 1;
    return c;
  }, [validation.defects]);

  const navNodes: NavTreeNode[] = SECTIONS.map((id) => ({
    id,
    label: t(`section_${id}`),
    errorCount: counts[id],
  }));

  const dockDefects: DefectListItem[] = validation.defects.map((d) => ({
    code: d.code,
    where: d.where,
    message: d.message,
    severity: "error",
  }));

  const canPublish =
    validation.errorCount === 0 && (modelId ?? "").trim() !== "" && !mutation.isPending;

  const onPublish = () => {
    const parsed = releaseDraftSchema.safeParse(form.getValues());
    if (!parsed.success) return;
    const { release } = buildReleaseFromDraft(parsed.data);
    mutation.mutate(
      {
        input: { catalogVersion: parsed.data.catalogVersion, body: release },
        idempotencyKey: crypto.randomUUID(),
      },
      {
        onSuccess: (data) => {
          // The draft has served its purpose — discard it (best-effort) so it
          // doesn't linger in the resume list. The release is already frozen.
          if (autosave.draftId) {
            deleteDraft.mutate(
              { id: autosave.draftId },
              { onSettled: () => void invalidateKeys(queryClient, [platformKeys.draftsList()]) },
            );
          }
          void invalidateKeys(queryClient, [platformKeys.releasesList()]);
          toast.success(t("published", { releaseId: data.releaseId }));
          router.push("/platform");
        },
      },
    );
  };

  return (
    <main className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-4 border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-xs">
            {validation.errorCount === 0
              ? t("noDefects")
              : t("defectCount", { count: String(validation.errorCount) })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusBadge status={autosave.status} />
          <Button onClick={onPublish} disabled={!canPublish}>
            {mutation.isPending ? t("publishing") : t("publish")}
          </Button>
        </div>
      </header>

      {mutation.isError ? <PublishError error={mutation.error} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr_300px]">
        <aside className="border-border overflow-auto border-r p-2">
          <NavTree
            nodes={navNodes}
            selectedId={section}
            onSelect={(id) => setSection(id as SectionId)}
          />
        </aside>

        {/* The live preview's derivation scope feeds every ExprField's inline
            `=value` while authoring (absent → no readout). */}
        <ExprEvalScopeContext.Provider value={preview.scope}>
          <section className="overflow-auto p-4">
            {section === "identity" ? <IdentityWorkbench form={form} versions={versions} /> : null}
            {section === "parameters" ? (
              <ParametersWorkbench form={form} validation={validation} />
            ) : null}
            {section === "constraints" ? (
              <ConstraintsWorkbench form={form} validation={validation} />
            ) : null}
            {section === "derived" ? (
              <DerivedWorkbench form={form} validation={validation} />
            ) : null}
            {section === "parts" ? (
              <PartsWorkbench form={form} validation={validation} catalog={catalog} />
            ) : null}
            {section === "advanced" ? <AdvancedWorkbench form={form} /> : null}
          </section>
        </ExprEvalScopeContext.Provider>

        <aside className="border-border flex flex-col overflow-auto border-l p-3">
          {diff && baseReleaseId ? (
            <DiffPanel diff={diff} baseReleaseId={baseReleaseId} onNavigate={setSection} />
          ) : null}
          <div className="mb-2 flex gap-1" role="tablist">
            <DockTabButton
              id="defects"
              active={dockTab}
              onSelect={setDockTab}
              label={t("tabDefects")}
              count={validation.errorCount}
            />
            <DockTabButton
              id="preview"
              active={dockTab}
              onSelect={setDockTab}
              label={t("tabPreview")}
            />
          </div>
          {dockTab === "defects" ? (
            <DefectList
              defects={dockDefects}
              emptyLabel={t("noDefects")}
              onSelect={(where) => setSection(sectionForWhere(where))}
            />
          ) : (
            <PreviewTab
              release={validation.release}
              preview={preview}
              input={previewInput}
              onInputChange={setPreviewInput}
              priceBlind={priceBlind}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

/** A right-dock tab toggle (Defects | Preview). The defects tab carries a count. */
function DockTabButton({
  id,
  active,
  onSelect,
  label,
  count,
}: {
  id: DockTabId;
  active: DockTabId;
  onSelect: (id: DockTabId) => void;
  label: string;
  count?: number;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => onSelect(id)}
      className={cn(
        "rounded-md px-2 py-1 text-sm",
        isActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count ? ` (${count})` : ""}
    </button>
  );
}

/** Clone diff (Phase 3D) — what changed vs the source release; clicking a key
 *  jumps to its section. Shown only for a cloned draft (carries baseReleaseId). */
function DiffPanel({
  diff,
  baseReleaseId,
  onNavigate,
}: {
  diff: ReleaseDiff;
  baseReleaseId: string;
  onNavigate: (section: SectionId) => void;
}) {
  const t = useTranslations("releaseEditor");
  return (
    <section className="border-border mb-3 rounded-md border p-2">
      <h2 className="mb-1 text-sm font-semibold">{t("diffTitle", { releaseId: baseReleaseId })}</h2>
      {diff.versionChanged ? (
        <p className="text-muted-foreground text-xs">
          {t("diffVersion", { from: String(diff.baseVersion), to: String(diff.currentVersion) })}
        </p>
      ) : null}
      {diff.hasChanges ? (
        <>
          {diff.sections.map((s) => (
            <div key={s.section} className="mt-1">
              <p className="text-xs font-medium">{t(`section_${s.section}`)}</p>
              <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                {s.added.map((k) => (
                  <li key={`a-${k}`}>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => onNavigate(s.section)}
                    >
                      + {k}
                    </button>
                  </li>
                ))}
                {s.changed.map((k) => (
                  <li key={`c-${k}`}>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => onNavigate(s.section)}
                    >
                      ~ {k}
                    </button>
                  </li>
                ))}
                {s.removed.map((k) => (
                  <li key={`r-${k}`} className="line-through">
                    − {k}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {diff.islandsChanged.length > 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("diffIslands", { sections: diff.islandsChanged.join(", ") })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-xs">{t("diffNone")}</p>
      )}
    </section>
  );
}

/** Autosave state (Phase 3B) — a quiet header indicator; `idle` shows nothing. */
function SaveStatusBadge({ status }: { status: SaveStatus }) {
  const t = useTranslations("releaseEditor");
  if (status === "idle") return null;
  const label =
    status === "saving"
      ? t("saving")
      : status === "saved"
        ? t("saved")
        : status === "error"
          ? t("saveFailed")
          : t("unsaved");
  return (
    <span
      className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
    >
      {label}
    </span>
  );
}

/** Server-side 422 defects (e.g. catalog checks the client can't run) re-shown. */
function PublishError({ error }: { error: unknown }) {
  const t = useTranslations("releaseEditor");
  if (isHttpError(error) && error.status === 422) {
    const body = (error as ApiError).body as Record<string, unknown> | null | undefined;
    const defects = body?.defects;
    if (Array.isArray(defects) && defects.length > 0) {
      return (
        <div className="border-destructive/30 bg-destructive/5 border-b px-4 py-2" role="alert">
          <p className="text-destructive text-sm font-semibold">{t("serverRejected")}</p>
          <DefectList
            defects={(defects as { code?: string; where?: string; message?: string }[]).map(
              (d) => ({
                code: d.code ?? "",
                where: d.where ?? "",
                message: d.message ?? "",
                severity: "error",
              }),
            )}
          />
        </div>
      );
    }
  }
  return (
    <p
      className="text-destructive border-destructive/30 bg-destructive/5 border-b px-4 py-2 text-sm"
      role="alert"
    >
      {error instanceof Error ? error.message : t("publishError")}
    </p>
  );
}
