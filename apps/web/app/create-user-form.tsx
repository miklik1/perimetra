"use client";

import { useId } from "react";

import { invalidateKeys, keys, optimisticUpdate } from "@repo/api";
import { useMutation, useQueryClient, useUsersQueries } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { createUserSchema, type CreateUserInput, type User } from "@repo/validators";

import { devErrorDetail, errorMessageKey } from "../lib/error-messages";
import { toast } from "../lib/toast";

/**
 * Create-user form (ADR 0009). The shared `createUserSchema` (@repo/validators)
 * drives both client validation (RHF + zodResolver) and the server contract
 * (the `create` mutation parses the response). On success it invalidates the
 * users list — invalidation lives here because the component owns the
 * QueryClient, not the endpoint factory.
 *
 * Exemplar patterns a dev copies from here:
 * - i18n: every string comes from `useTranslations` (ADR 0020), never a literal.
 * - a11y: visible `<label htmlFor>` (not placeholder-as-label), each input
 *   `aria-describedby` its error `<p id>`, `aria-invalid` on error.
 * - errors: the mutation error is mapped through the error-message catalog
 *   (`errorMessageKey`) to translated copy — raw detail only in dev.
 * - toast: success/failure fire the shared `toast` API (ADR 0027).
 */
export function CreateUserForm() {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const usersQueries = useUsersQueries();
  const queryClient = useQueryClient();
  const nameId = useId();
  const emailId = useId();
  const nameErrorId = useId();
  const emailErrorId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useZodForm(createUserSchema, {
    defaultValues: { name: "", email: "" },
  });

  const mutation = useMutation({
    ...usersQueries.create(),
    // Optimistic-update-with-rollback (ADR 0007 helper): append a placeholder to
    // the users list immediately; `onError` rolls back, `onSettled` revalidates.
    ...optimisticUpdate<User[], CreateUserInput>({
      queryClient,
      key: keys.users.list(),
      update: (current, input) => [
        ...(current ?? []),
        { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() },
      ],
    }),
    onSuccess: () => {
      // Key-scoped invalidation helper — refresh both the flat list and the
      // paginated variant (the mock doesn't persist creates, so the optimistic
      // row is replaced by the refetched fixtures).
      void invalidateKeys(queryClient, [keys.users.lists(), keys.users.pages()]);
      reset();
      toast.success(t("created"));
    },
    onError: (error) => {
      // Map the raw failure (HTTP status / parse / network) to translated,
      // user-facing copy via the catalog — never surface the raw message.
      toast.error(tErrors(errorMessageKey(error)));
    },
  });

  const inputClass =
    "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 aria-invalid:border-destructive";

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="border-border flex w-full max-w-md flex-col gap-3 rounded-md border p-4 text-sm"
      noValidate
    >
      <h2 className="font-semibold">{t("newUser")}</h2>

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
        {errors.name && (
          <p id={nameErrorId} className="text-destructive text-xs">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="font-medium">
          {t("email")}
        </label>
        <input
          {...register("email")}
          id={emailId}
          type="email"
          className={inputClass}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? emailErrorId : undefined}
        />
        {errors.email && (
          <p id={emailErrorId} className="text-destructive text-xs">
            {errors.email.message}
          </p>
        )}
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
