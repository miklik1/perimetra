"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, invalidateKeys, isHttpError } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { DefectList, type DefectListItem } from "@repo/ui/components/defect-list";
import { NavTree, type NavTreeNode } from "@repo/ui/components/nav-tree";
import { useZodForm } from "@repo/ui/forms/use-zod-form";

import { createAdminQueries } from "../../../lib/admin-queries";
import { platformKeys } from "../../../lib/platform-queries";
import { toast } from "../../../lib/toast";
import { usePlatformAdmin } from "../../../lib/use-role";
import { blankDraft, buildReleaseFromDraft } from "./lib/draft";
import { releaseDraftSchema } from "./lib/section-schemas";
import { useReleaseValidation } from "./lib/use-release-validation";
import { AdvancedWorkbench } from "./sections/advanced-workbench";
import { ConstraintsWorkbench } from "./sections/constraints-workbench";
import { DerivedWorkbench } from "./sections/derived-workbench";
import { IdentityWorkbench } from "./sections/identity-workbench";
import { ParametersWorkbench } from "./sections/parameters-workbench";

const SECTIONS = ["identity", "parameters", "constraints", "derived", "advanced"] as const;
type SectionId = (typeof SECTIONS)[number];

/** Which section owns a defect `where` (drives nav badges + click-to-navigate). */
function sectionForWhere(where: string): SectionId {
  if (where.startsWith("parameters[")) return "parameters";
  if (where.startsWith("constraints[")) return "constraints";
  if (where.startsWith("derived[")) return "derived";
  return "advanced";
}

export function ReleaseEditorClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <EditorGate />
    </AuthGuard>
  );
}

function EditorGate() {
  const t = useTranslations("releaseEditor");
  const isPlatform = usePlatformAdmin();
  if (!isPlatform) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-muted-foreground">{t("onlyPlatform")}</p>
      </main>
    );
  }
  return <Editor />;
}

export function Editor() {
  const t = useTranslations("releaseEditor");
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  const form = useZodForm(releaseDraftSchema, { defaultValues: blankDraft() });
  const validation = useReleaseValidation(form);
  const [section, setSection] = useState<SectionId>("identity");
  const modelId = form.watch("modelId");

  // Pass the mutationOptions directly (not spread) so TanStack keeps the
  // variables/data generics; success handling rides the per-call options.
  const mutation = useMutation(adminQueries.publishRelease());

  const counts = useMemo(() => {
    const c: Record<SectionId, number> = {
      identity: 0,
      parameters: 0,
      constraints: 0,
      derived: 0,
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
              : t("defectCount", { count: validation.errorCount })}
          </p>
        </div>
        <Button onClick={onPublish} disabled={!canPublish}>
          {mutation.isPending ? t("publishing") : t("publish")}
        </Button>
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

        <section className="overflow-auto p-4">
          {section === "identity" ? <IdentityWorkbench form={form} /> : null}
          {section === "parameters" ? (
            <ParametersWorkbench form={form} validation={validation} />
          ) : null}
          {section === "constraints" ? (
            <ConstraintsWorkbench form={form} validation={validation} />
          ) : null}
          {section === "derived" ? <DerivedWorkbench form={form} validation={validation} /> : null}
          {section === "advanced" ? <AdvancedWorkbench form={form} /> : null}
        </section>

        <aside className="border-border overflow-auto border-l p-3">
          <h2 className="mb-2 text-sm font-semibold">{t("defects")}</h2>
          <DefectList
            defects={dockDefects}
            emptyLabel={t("noDefects")}
            onSelect={(where) => setSection(sectionForWhere(where))}
          />
        </aside>
      </div>
    </main>
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
