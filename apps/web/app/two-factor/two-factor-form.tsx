"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useMutation } from "@repo/api/react";
import { useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, Field, Input, Panel } from "@repo/ui";

/**
 * TOTP challenge form (ADR 0040). Reached mid-login, BEFORE a session exists, so
 * it sits OUTSIDE `AuthGuard`. `twoFactor.verifyTotp` consumes the pending 2FA
 * cookie Better Auth set on sign-in and mints the real session on success — the
 * `useSession` subscribers then flip signed-in and we resume at `next`.
 *
 * Same kit language as `/login`: one `Panel` card on the `bg-field` page (the
 * page owns that), the code input on `Field`/`Field.Control`/`Input` (which
 * wires id/aria-describedby/aria-invalid by construction — see `CustomerForm`
 * for the same composition), and the mutation error surfaced as `Field.Error`
 * (still a `role="alert"`, now described-by the input instead of a floating
 * paragraph).
 */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const authClient = useAuthClient();
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (error) throw new Error(error.message ?? error.statusText);
    },
    onSuccess: () => {
      router.push(next);
    },
  });

  return (
    <Panel elevation="raised" className="w-full max-w-sm">
      <Panel.Body>
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-4 text-sm"
          noValidate
        >
          <Field>
            <Field.Label>{t("twoFactor.code")}</Field.Label>
            <Field.Description>{t("twoFactor.prompt")}</Field.Description>
            <Field.Control>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-lg tracking-widest"
              />
            </Field.Control>
            {mutation.isError && <Field.Error>{t("twoFactor.error")}</Field.Error>}
          </Field>

          <Button type="submit" disabled={mutation.isPending || code.trim().length < 6}>
            {mutation.isPending ? t("twoFactor.verifying") : t("twoFactor.verify")}
          </Button>
        </form>
      </Panel.Body>
    </Panel>
  );
}
