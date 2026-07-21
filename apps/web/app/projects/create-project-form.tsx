"use client";

import { invalidateKeys } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Field, Input, Textarea } from "@repo/ui";
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
 * Reskinned onto the `Field`/`Input`/`Textarea` kit grammar (ADR 0111): each
 * field's id/aria-describedby/aria-invalid wiring comes from `<Field.Control>`
 * cloning the register()'d control, and `<Field.Error>` is mounted only while
 * that field actually has an error — which is what flips the field's
 * `aria-invalid`/`aria-describedby` on, so the two stay in lockstep by
 * construction rather than by a parallel `errors.x ? … : undefined` check.
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useZodForm(createProjectSchema, {
    defaultValues: { name: "" },
  });
  const nameError = errors.name?.message;
  const descriptionError = errors.description?.message;

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

  return (
    <form
      method="post"
      onSubmit={handleSubmit((values) =>
        mutation.mutate({ input: values, idempotencyKey: crypto.randomUUID() }),
      )}
      className="border-border flex w-full flex-col gap-4 rounded-md border p-4 text-sm"
      noValidate
    >
      <h2 className="font-semibold">{t("newProject")}</h2>

      <Field>
        <Field.Label>{t("name")}</Field.Label>
        <Field.Control>
          <Input {...register("name")} />
        </Field.Control>
        {nameError && <Field.Error>{nameError}</Field.Error>}
      </Field>

      <Field>
        <Field.Label>{t("description")}</Field.Label>
        <Field.Control>
          <Textarea
            {...register("description", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            rows={2}
          />
        </Field.Control>
        {descriptionError && <Field.Error>{descriptionError}</Field.Error>}
      </Field>

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
