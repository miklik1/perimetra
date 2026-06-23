"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useMutation } from "@repo/api/react";
import { useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

/**
 * TOTP challenge form (ADR 0040). Reached mid-login, BEFORE a session exists, so
 * it sits OUTSIDE `AuthGuard`. `twoFactor.verifyTotp` consumes the pending 2FA
 * cookie Better Auth set on sign-in and mints the real session on success — the
 * `useSession` subscribers then flip signed-in and we resume at `next`.
 */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const authClient = useAuthClient();
  const codeId = useId();
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

  const inputClass =
    "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-center text-lg tracking-widest outline-none focus-visible:ring-2";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="border-border flex w-full max-w-sm flex-col gap-3 rounded-md border p-4 text-sm"
      noValidate
    >
      <h1 className="text-lg font-bold">{t("twoFactor.title")}</h1>
      <label htmlFor={codeId} className="text-muted-foreground">
        {t("twoFactor.prompt")}
      </label>
      <input
        id={codeId}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={t("twoFactor.code")}
        className={inputClass}
      />
      <Button type="submit" disabled={mutation.isPending || code.trim().length < 6}>
        {mutation.isPending ? t("twoFactor.verifying") : t("twoFactor.verify")}
      </Button>
      {mutation.isError && (
        <p className="text-destructive" role="alert">
          {t("twoFactor.error")}
        </p>
      )}
    </form>
  );
}
