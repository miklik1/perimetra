"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuthQueries, useQuery } from "@repo/api/react";
import { AuthGuard, useAuth } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button, buttonVariants } from "@repo/ui";

import { useIsAdmin, usePlatformAdmin } from "../../lib/use-role";

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
  const tTeam = useTranslations("team");
  const tAdmin = useTranslations("admin");
  const tPlatform = useTranslations("platform");
  const { logout } = useAuth();
  const authQueries = useAuthQueries();
  // Consumes the SAME `me()` queryOptions the RSC parent prefetched (with the
  // session cookie forwarded), so the profile renders from hydrated cache with
  // no client refetch on first paint.
  const { data: user } = useQuery(authQueries.me());
  // The admin surfaces are reachable only by typing the URL otherwise; surface
  // them here, role-gated from the SAME `/v1/me` the server enforces on (both
  // hooks FAIL-CLOSED while loading/anonymous, so they never flash for a guest).
  const isAdmin = useIsAdmin();
  const isPlatform = usePlatformAdmin();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("signedInAs", { email: user?.email ?? "" })}</p>
      <Link href="/team" className={buttonVariants({ variant: "outline" })}>
        {tTeam("title")}
      </Link>
      <Link href="/account/security" className={buttonVariants({ variant: "outline" })}>
        {t("security.link")}
      </Link>
      {isAdmin && (
        <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
          {tAdmin("title")}
        </Link>
      )}
      {isPlatform && (
        <Link href="/platform" className={buttonVariants({ variant: "outline" })}>
          {tPlatform("title")}
        </Link>
      )}
      <Button
        onClick={async () => {
          await logout();
          router.push("/login");
        }}
      >
        {t("logout")}
      </Button>
    </main>
  );
}
