"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";

import { useMutation } from "@repo/api/react";
import { useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { useZodForm } from "@repo/ui/forms/use-zod-form";
import { loginSchema, type LoginInput } from "@repo/validators";

import { authErrorMessageKey } from "../../lib/error-messages";
import { safeNextPath } from "../../lib/safe-redirect";

/** Where to land after sign-in, unless a safe `?next=` overrides it. */
const DEFAULT_DESTINATION = "/account";

/**
 * Login form (ADR 0009, on the Better Auth client — design §7.1). The shared
 * `loginSchema` (@repo/validators) drives client validation; the request goes
 * through `authClient.signIn.email`, which sets the httpOnly session cookie via
 * the same-origin proxy and flips every `useSession` subscriber to signed-in.
 *
 * `?next=` is read CLIENT-side and open-redirect-guarded (`safeNextPath`): the
 * proxy sets it when bouncing an unauthenticated visitor here, so they return to
 * where they were headed after sign-in. A 2FA-enrolled user is NOT signed in by
 * the password step — Better Auth withholds the session and signals a TOTP
 * challenge, so they are routed to `/two-factor` first (ADR 0040).
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Open-redirect guard: never honour a `?next=` that could resolve off-origin.
  const requested = safeNextPath(searchParams.get("next"));
  // Avoid a redirect loop back to /login — compare the PATH exactly, so a
  // legitimate route like `/loginHelp` is not swallowed.
  const requestedPath = requested?.split(/[?#]/, 1)[0];
  const destination = requested && requestedPath !== "/login" ? requested : DEFAULT_DESTINATION;
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
  } = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (values: LoginInput) => {
      // The Better Auth client reports failure as a value (`{ data, error }`),
      // never a rejection — re-throw so useMutation's isError drives the banner.
      const { data, error } = await authClient.signIn.email(values);
      if (error) {
        throw Object.assign(new Error(error.message ?? error.statusText), {
          status: error.status,
          code: error.code,
        });
      }
      return data;
    },
    onSuccess: (data) => {
      // A 2FA-enabled user is NOT signed in yet — Better Auth signals a TOTP
      // challenge instead. Route to `/two-factor` first, carrying the (already
      // open-redirect-guarded) destination through `?next=`.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        router.push(`/two-factor?next=${encodeURIComponent(destination)}`);
        return;
      }
      router.push(destination);
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
