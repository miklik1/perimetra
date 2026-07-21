"use client";

import { useRouter } from "next/navigation";

import { useAuthQueries, useQuery } from "@repo/api/react";
import { AuthGuard, useAuth } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

import { SettingsLayout } from "../../components/settings/settings-layout";

/**
 * Client subtree of the protected account page. `<AuthGuard>` resolves the
 * cookie session once on mount (`useSession`) and renders the fallback only
 * for that initial fetch — the proxy gate already bounced cookie-less
 * visitors, so authenticated reloads resolve straight to children.
 */
export function AccountClient() {
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
      <AccountContent />
    </AuthGuard>
  );
}

function AccountContent() {
  const router = useRouter();
  const t = useTranslations("account");
  const { logout } = useAuth();
  const authQueries = useAuthQueries();
  // Consumes the SAME `me()` queryOptions the RSC parent prefetched (with the
  // session cookie forwarded), so the profile renders from hydrated cache with
  // no client refetch on first paint. The cross-surface links this page used to
  // hold (Nabídky / Tým / Zabezpečení / Správa / Platforma) are now the app
  // shell's rail + the settings tab strip, so the Účet tab is just the profile.
  const { data: user } = useQuery(authQueries.me());

  return (
    <SettingsLayout active="account">
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">{t("signedInAs", { email: user?.email ?? "" })}</p>
        <Button
          onClick={async () => {
            await logout();
            router.push("/login");
          }}
        >
          {t("logout")}
        </Button>
      </div>
    </SettingsLayout>
  );
}
