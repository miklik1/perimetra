"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useMutation } from "@repo/api/react";
import { AuthGuard, useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { SettingsLayout } from "../../../components/settings/settings-layout";

const inputClass =
  "border-border bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2";

/** The `secret` for manual authenticator entry, pulled out of the otpauth:// URI. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? uri;
  } catch {
    return uri;
  }
}

export function SecurityClient() {
  const router = useRouter();
  const t = useTranslations("account");
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <SecurityContent />
    </AuthGuard>
  );
}

function SecurityContent() {
  const t = useTranslations("account");
  const authClient = useAuthClient();
  const passwordId = useId();
  const codeId = useId();
  const { data: session, refetch } = authClient.useSession();
  // The generic client doesn't infer the plugin's user field; it IS on the row.
  const enabled = (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);

  const enableMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data) throw new Error(error?.message ?? "enable failed");
      return data;
    },
    onSuccess: (data) => setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes }),
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (error) throw new Error(error.message ?? "verify failed");
    },
    onSuccess: () => {
      setSetup(null);
      setPassword("");
      setCode("");
      refetch();
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) throw new Error(error.message ?? "disable failed");
    },
    onSuccess: () => {
      setPassword("");
      refetch();
    },
  });

  return (
    <SettingsLayout active="security">
      <div className="flex max-w-md flex-col gap-4 text-sm">
        <h2 className="text-lg font-semibold">{t("security.title")}</h2>
        <section className="border-border flex flex-col gap-3 rounded-md border p-4">
          <h2 className="font-semibold">{t("security.twoFactorTitle")}</h2>
          <p className="text-muted-foreground">
            {enabled ? t("security.enabled") : t("security.disabled")}
          </p>

          {enabled ? (
            // Already enrolled — offer disable (re-auth with the password).
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                disableMutation.mutate();
              }}
              className="flex flex-col gap-2"
              noValidate
            >
              <label htmlFor={passwordId} className="font-medium">
                {t("security.passwordLabel")}
              </label>
              <input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={disableMutation.isPending || !password}
              >
                {disableMutation.isPending ? t("security.disabling") : t("security.disable")}
              </Button>
              {disableMutation.isError && (
                <p className="text-destructive" role="alert">
                  {t("security.disableError")}
                </p>
              )}
              {disableMutation.isSuccess && <p role="status">{t("security.disabledNow")}</p>}
            </form>
          ) : setup ? (
            // Secret generated — show it for manual entry + confirm with a live code.
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground">{t("security.scanHint")}</p>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{t("security.secretLabel")}</span>
                <code className="bg-muted break-all rounded px-2 py-1">
                  {secretFromUri(setup.totpURI)}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{t("security.uriLabel")}</span>
                <code className="bg-muted break-all rounded px-2 py-1 text-xs">
                  {setup.totpURI}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{t("security.backupCodes")}</span>
                <ul className="bg-muted grid grid-cols-2 gap-1 rounded px-2 py-1 font-mono text-xs">
                  {setup.backupCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <form
                method="post"
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmMutation.mutate();
                }}
                className="flex flex-col gap-2"
                noValidate
              >
                <label htmlFor={codeId} className="font-medium">
                  {t("security.codeLabel")}
                </label>
                <input
                  id={codeId}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={inputClass}
                />
                <Button
                  type="submit"
                  disabled={confirmMutation.isPending || code.trim().length < 6}
                >
                  {confirmMutation.isPending ? t("security.confirming") : t("security.confirm")}
                </Button>
                {confirmMutation.isError && (
                  <p className="text-destructive" role="alert">
                    {t("security.confirmError")}
                  </p>
                )}
              </form>
            </div>
          ) : (
            // Not enrolled — start setup by re-authing with the password.
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                enableMutation.mutate();
              }}
              className="flex flex-col gap-2"
              noValidate
            >
              <label htmlFor={passwordId} className="font-medium">
                {t("security.passwordLabel")}
              </label>
              <input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              <Button type="submit" disabled={enableMutation.isPending || !password}>
                {enableMutation.isPending ? t("security.generating") : t("security.enable")}
              </Button>
              {enableMutation.isError && (
                <p className="text-destructive" role="alert">
                  {t("security.enableError")}
                </p>
              )}
            </form>
          )}
        </section>
      </div>
    </SettingsLayout>
  );
}
