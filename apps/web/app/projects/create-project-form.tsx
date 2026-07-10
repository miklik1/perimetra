"use client";

import { useId } from "react";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, FieldError } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { createProjectSchema } from "@repo/validators";

import { devErrorDetail, errorMessageKey } from "../../lib/error-messages";
import { createProjectsQueries, projectKeys } from "../../lib/projects-queries";
import { toast } from "../../lib/toast";

/**
 * Create-project form (ADR 0009 — same exemplar shape as the create-user
 * form): the shared `createProjectSchema` drives RHF validation client-side
 * and is the same contract the server validates.
 *
 * Idempotency: ONE `crypto.randomUUID()` is minted per submission
 * attempt-chain — inside the submit handler, so transport retries of that
 * attempt (the retry middleware re-dispatches the same headers) carry the SAME
 * `Idempotency-Key`, while a user re-submitting after a hard failure mints a
 * fresh one. The server dedupes on it (POST /v1/projects honors the header).
 */
export function CreateProjectForm() {
  const t = useTranslations("projects");
  const tErrors = useTranslations("errors");
  const projectsQueries = createProjectsQueries(useApiClient());
  const queryClient = useQueryClient();
  const nameId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const descriptionErrorId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useZodForm(createProjectSchema, {
    defaultValues: { name: "" },
  });

  const mutation = useMutation({
    ...projectsQueries.create(),
    onSuccess: () => {
      // The component owns invalidation (the factory holds an ApiClient, not a
      // QueryClient): refresh every list variant so the new row appears.
      void invalidateKeys(queryClient, [projectKeys.lists()]);
      reset();
      toast.success(t("created"));
    },
    onError: (error) => {
      toast.error(tErrors(errorMessageKey(error)));
    },
  });

  const inputClass =
    "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 aria-invalid:border-destructive";

  return (
    <form
      method="post"
      onSubmit={handleSubmit((values) =>
        mutation.mutate({ input: values, idempotencyKey: crypto.randomUUID() }),
      )}
      className="border-border flex w-full flex-col gap-3 rounded-md border p-4 text-sm"
      noValidate
    >
      <h2 className="font-semibold">{t("newProject")}</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="font-medium">
          {t("name")}
        </label>
        <input
          {...register("name")}
          id={nameId}
          className={inputClass}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? nameErrorId : undefined}
        />
        <FieldError id={nameErrorId} error={errors.name} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={descriptionId} className="font-medium">
          {t("description")}
        </label>
        <input
          {...register("description", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          id={descriptionId}
          className={inputClass}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? descriptionErrorId : undefined}
        />
        <FieldError id={descriptionErrorId} error={errors.description} />
      </div>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t("creating") : t("create")}
      </Button>

      {mutation.isError && (
        <p className="text-destructive" role="alert">
          {tErrors(errorMessageKey(mutation.error))}
          {devErrorDetail(mutation.error) && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {devErrorDetail(mutation.error)}
            </span>
          )}
        </p>
      )}
    </form>
  );
}
