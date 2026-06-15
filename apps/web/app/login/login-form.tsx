"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useForm } from "react-hook-form";

import { useMutation } from "@repo/api/react";
import { useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { loginSchema, type LoginInput } from "@repo/validators";

import { authErrorMessageKey } from "../../lib/error-messages";

/**
 * Login form (ADR 0009, on the Better Auth client — design §7.1). The shared
 * `loginSchema` (@repo/validators) drives client validation; the request goes
 * through `authClient.signIn.email`, which sets the httpOnly session cookie via
 * the same-origin proxy and flips every `useSession` subscriber to signed-in —
 * no token to store, no `setAuth`. The mutation wrapper keeps TanStack's
 * pending/error state driving the UI exactly like the other forms.
 *
 * `next` is the validated post-login destination (default `/account`) — the
 * page sanitises `?next=` before passing it, so an invitee bounced here from
 * `/accept-invitation` returns there after signing in.
 */
export function LoginForm({ next = "/account" }: { next?: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tErrors = useTranslations("errors");
  const authClient = useAuthClient();
  const emailId = useId();
  const passwordId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: LoginInput) => {
      // The Better Auth client reports failure as a value (`{ data, error }`),
      // never a rejection — re-throw so useMutation's isError drives the banner.
      const { error } = await authClient.signIn.email(values);
      if (error) {
        throw Object.assign(new Error(error.message ?? error.statusText), {
          status: error.status,
          code: error.code,
        });
      }
    },
    onSuccess: () => {
      router.push(next);
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

      <div className="flex flex-col gap-1">
        <label htmlFor={passwordId} className="font-medium">
          {t("password")}
        </label>
        <input
          {...register("password")}
          id={passwordId}
          type="password"
          className={inputClass}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? passwordErrorId : undefined}
        />
        {errors.password && (
          <p id={passwordErrorId} className="text-destructive text-xs">
            {errors.password.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t("signingIn") : t("login")}
      </Button>

      {mutation.isError && (
        <p className="text-destructive" role="alert">
          {tErrors(authErrorMessageKey(mutation.error))}
        </p>
      )}
    </form>
  );
}
