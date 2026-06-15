"use client";

import { useRouter } from "next/navigation";

import { useMutation, useQueryClient } from "@repo/api/react";
import { AuthGuard, useAuth, useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";

/**
 * Accept-invitation leaf. Behind `<AuthGuard>` (the invitee must sign in first;
 * a cookie-less visitor is bounced to `/login`). Accepting creates the
 * membership in the inviting org; we then clear the cache + refresh the session
 * so the new org/role resolve, and land on the team page.
 */
export function AcceptInvitationClient({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const t = useTranslations("team");
  return (
    <AuthGuard
      redirect={() => router.push(`/login?next=/accept-invitation/${invitationId}`)}
      fallback={
        <main className="flex min-h-screen items-center justify-center">{t("accept.signIn")}</main>
      }
    >
      <AcceptContent invitationId={invitationId} />
    </AuthGuard>
  );
}

function AcceptContent({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { refetch } = useAuth();

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.acceptInvitation({ invitationId });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: async () => {
      // `acceptInvitation` stamps the active org on the session ROW but does NOT
      // re-issue the signed `session_data` cookie. With cookieCache on, a
      // same-session read keeps serving the stale cookie for up to its maxAge —
      // and for an invite-first invitee (ADR 0058) that stale cookie is
      // ORG-LESS, so `/team`'s `/v1/me` would 403 for minutes. A cache-bypassing
      // session read re-reads the DB (now the invited org) and re-stamps the
      // cookie, so the very next request is correctly scoped.
      await authClient.getSession({ query: { disableCookieCache: true } });
      queryClient.clear();
      refetch();
      router.push("/team");
    },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">{t("accept.title")}</h1>
      <p className="text-muted-foreground">{t("accept.body")}</p>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {t("accept.button")}
      </Button>
      {mutation.isError && (
        <p className="text-destructive text-sm" role="alert">
          {t("accept.error")}
        </p>
      )}
    </main>
  );
}
