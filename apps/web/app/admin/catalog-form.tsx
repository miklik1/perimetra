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

export function CatalogForm() {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);
  const [json, setJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const mutation = useMutation({
    ...adminQueries.publishCatalogVersion(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.catalogVersionsList()]);
      setJson("");
      toast.success(t("published"));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setParseError(t("jsonParseError"));
      return;
    }
    mutation.mutate({ input: { body: parsed }, idempotencyKey: crypto.randomUUID() });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("catalogJson")}
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={8}
          className={textareaClass}
          placeholder={'{\n  "version": 1,\n  ...\n}'}
        />
      </label>

      {parseError && (
        <p className="text-destructive text-sm" role="alert">
          {parseError}
        </p>
      )}

      <Button type="submit" disabled={mutation.isPending || !json.trim()}>
        {mutation.isPending ? t("publishing") : t("publish")}
      </Button>

      {mutation.isError && <CatalogErrorDetail error={mutation.error} />}

      {mutation.isSuccess && mutation.data && (
        <p className="text-sm text-green-600" role="status">
          {t("catalogPublished", { version: String(mutation.data.version) })}
        </p>
      )}
    </form>
  );
}

function CatalogErrorDetail({ error }: { error: unknown }) {
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
