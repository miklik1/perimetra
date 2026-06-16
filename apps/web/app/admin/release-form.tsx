"use client";

import { useState } from "react";

import { ApiError, invalidateKeys, isHttpError } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { adminKeys, createAdminQueries } from "../../lib/admin-queries";
import { toast } from "../../lib/toast";

const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 w-full";
const textareaClass = `${inputClass} font-mono resize-y`;

export function ReleaseForm() {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  const [catalogVersion, setCatalogVersion] = useState("");
  const [bodyJson, setBodyJson] = useState("");
  const [initialInputJson, setInitialInputJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const mutation = useMutation({
    ...adminQueries.publishRelease(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.releasesList()]);
      setCatalogVersion("");
      setBodyJson("");
      setInitialInputJson("");
      toast.success(t("published"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);

    const versionNum = parseInt(catalogVersion, 10);
    if (isNaN(versionNum) || versionNum < 0) {
      setParseError(t("catalogVersionInvalid"));
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyJson);
    } catch {
      setParseError(t("jsonParseError"));
      return;
    }

    let initialInput: Record<string, unknown> | undefined;
    if (initialInputJson.trim()) {
      try {
        initialInput = JSON.parse(initialInputJson) as Record<string, unknown>;
      } catch {
        setParseError(t("jsonParseError"));
        return;
      }
    }

    mutation.mutate({
      input: { catalogVersion: versionNum, body, initialInput },
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("catalogVersionField")}
        <input
          type="number"
          min={0}
          value={catalogVersion}
          onChange={(e) => setCatalogVersion(e.target.value)}
          className={inputClass}
          placeholder="1"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("releaseJson")}
        <textarea
          value={bodyJson}
          onChange={(e) => setBodyJson(e.target.value)}
          rows={8}
          className={textareaClass}
          placeholder={'{\n  "modelId": "...",\n  ...\n}'}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("initialInputJson")}
        <textarea
          value={initialInputJson}
          onChange={(e) => setInitialInputJson(e.target.value)}
          rows={4}
          className={textareaClass}
          placeholder={t("optional")}
        />
      </label>

      {parseError && (
        <p className="text-destructive text-sm" role="alert">
          {parseError}
        </p>
      )}

      <Button
        type="submit"
        disabled={mutation.isPending || !bodyJson.trim() || !catalogVersion.trim()}
      >
        {mutation.isPending ? t("publishing") : t("publish")}
      </Button>

      {mutation.isError && <ReleaseErrorDetail error={mutation.error} />}

      {mutation.isSuccess && mutation.data && (
        <p className="text-sm text-green-600" role="status">
          {t("releasePublished", { releaseId: mutation.data.releaseId })}
        </p>
      )}
    </form>
  );
}

function ReleaseErrorDetail({ error }: { error: unknown }) {
  const t = useTranslations("admin");
  if (isHttpError(error) && error.status === 422) {
    const body = (error as ApiError).body as Record<string, unknown> | null | undefined;
    const defects = body?.defects;
    const issues = body?.issues;
    if (Array.isArray(defects) && defects.length > 0) {
      return (
        <div className="text-destructive flex flex-col gap-2 text-sm" role="alert">
          <p className="font-semibold">{t("validationFailed")}</p>
          <ul className="flex flex-col gap-1 pl-4">
            {(defects as Array<{ code?: string; where?: string; message?: string }>).map((d, i) => (
              <li key={i} className="list-disc">
                <span className="font-mono text-xs">
                  {[d.where, d.code].filter(Boolean).join(" · ")}
                </span>
                {d.message && <span className="ml-2">{d.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    if (Array.isArray(issues) && issues.length > 0) {
      return (
        <div className="text-destructive flex flex-col gap-2 text-sm" role="alert">
          <p className="font-semibold">{t("validationFailed")}</p>
          <ul className="flex flex-col gap-1 pl-4">
            {(issues as Array<Record<string, unknown>>).map((issue, i) => (
              <li key={i} className="list-disc font-mono text-xs">
                {JSON.stringify(issue)}
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {error instanceof Error ? error.message : t("publishError")}
    </p>
  );
}
