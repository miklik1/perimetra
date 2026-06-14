"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useAuthQueries, useMutation, useQuery, useQueryClient } from "@repo/api/react";
import { AuthGuard, useAuth, useAuthClient } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { ORG_ROLES, type OrgRole } from "@repo/validators";

/**
 * Team management (ADR 0057): the org invite + member-sharing surface, all on
 * Better Auth's organization client (`authClient.organization.*`) — the invite
 * lifecycle is the plugin's, gated by the custom `ac`/roles, so there is no
 * `/v1/*` endpoint behind this page. Admin-only mutations are mirrored from the
 * authoritative `/me` role (the SAME value the BE enforces); a non-admin sees a
 * read-only roster. The org switcher flips the session's active org and clears
 * the cache so every scoped query re-reads under the new tenant.
 */
export function TeamClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <TeamContent />
    </AuthGuard>
  );
}

function TeamContent() {
  const t = useTranslations("team");
  // Built from literal (type-checked) keys, then looked up by the raw
  // `member.role` string — which may be Better Auth's structural `owner`,
  // outside our `OrgRole` union — falling back to the raw value.
  const roleLabels: Record<string, string> = {
    owner: t("roles.owner"),
    admin: t("roles.admin"),
    sales: t("roles.sales"),
    workshop: t("roles.workshop"),
  };
  const roleLabel = (raw: string): string => roleLabels[raw] ?? raw;
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const authQueries = useAuthQueries();
  const { data: me } = useQuery(authQueries.me());
  const isAdmin = me?.role === "admin";

  // Full active organization: members + invitations in one call.
  const orgQuery = useQuery({
    queryKey: ["org", "active"],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization();
      if (error) throw new Error(error.message ?? "failed");
      return data;
    },
  });
  const invalidateOrg = () => queryClient.invalidateQueries({ queryKey: ["org", "active"] });

  const members = orgQuery.data?.members ?? [];
  const pending = (orgQuery.data?.invitations ?? []).filter((i) => i.status === "pending");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <OrgSwitcher />
      </header>

      {isAdmin && <InviteForm onInvited={invalidateOrg} />}
      {!isAdmin && <p className="text-muted-foreground text-sm">{t("onlyAdmin")}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("members")}</h2>
        <ul className="border-border divide-border divide-y rounded-md border text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col">
                <span className="font-medium">
                  {m.user?.name || m.user?.email}
                  {m.userId === user?.id && (
                    <span className="text-muted-foreground ml-1">{t("you")}</span>
                  )}
                </span>
                <span className="text-muted-foreground text-xs">{m.user?.email}</span>
              </div>
              <div className="flex items-center gap-3">
                {isAdmin && m.role !== "owner" && m.userId !== user?.id ? (
                  <MemberRoleSelect memberId={m.id} current={m.role} onChanged={invalidateOrg} />
                ) : (
                  <span className="text-muted-foreground">{roleLabel(m.role)}</span>
                )}
                {isAdmin && m.role !== "owner" && m.userId !== user?.id && (
                  <RemoveMemberButton email={m.user?.email ?? ""} onRemoved={invalidateOrg} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("pending")}</h2>
          {pending.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noPending")}</p>
          ) : (
            <ul className="border-border divide-border divide-y rounded-md border text-sm">
              {pending.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{inv.email}</span>
                    <span className="text-muted-foreground text-xs">{roleLabel(inv.role)}</span>
                  </div>
                  <CancelInviteButton invitationId={inv.id} onCancelled={invalidateOrg} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2";

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("sales");

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.inviteMember({ email, role });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: () => {
      setEmail("");
      onInvited();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="border-border flex flex-wrap items-end gap-3 rounded-md border p-4"
    >
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">
          {t("emailLabel")}
        </label>
        <input
          id={emailId}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={roleId} className="text-sm font-medium">
          {t("roleLabel")}
        </label>
        <select
          id={roleId}
          value={role}
          onChange={(e) => setRole(e.target.value as OrgRole)}
          className={inputClass}
        >
          {ORG_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={mutation.isPending}>
        {t("sendInvite")}
      </Button>
      {mutation.isError && (
        <p className="text-destructive w-full text-sm" role="alert">
          {t("inviteError")}
        </p>
      )}
      {mutation.isSuccess && (
        <p className="w-full text-sm text-green-600" role="status">
          {t("inviteSent")}
        </p>
      )}
    </form>
  );
}

function MemberRoleSelect({
  memberId,
  current,
  onChanged,
}: {
  memberId: string;
  current: string;
  onChanged: () => void;
}) {
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const mutation = useMutation({
    mutationFn: async (role: OrgRole) => {
      const { error } = await authClient.organization.updateMemberRole({ memberId, role });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: onChanged,
  });
  // A member carrying a non-OrgRole value (e.g. Better Auth's bare `member`)
  // still shows as a valid option set; selecting one writes a real OrgRole.
  const value = (ORG_ROLES as readonly string[]).includes(current) ? (current as OrgRole) : "sales";
  return (
    <select
      aria-label={t("roleLabel")}
      value={value}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as OrgRole)}
      className={inputClass}
    >
      {ORG_ROLES.map((r) => (
        <option key={r} value={r}>
          {t(`roles.${r}`)}
        </option>
      ))}
    </select>
  );
}

function RemoveMemberButton({ email, onRemoved }: { email: string; onRemoved: () => void }) {
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.removeMember({ memberIdOrEmail: email });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: onRemoved,
  });
  return (
    <Button variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      {t("remove")}
    </Button>
  );
}

function CancelInviteButton({
  invitationId,
  onCancelled,
}: {
  invitationId: string;
  onCancelled: () => void;
}) {
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.organization.cancelInvitation({ invitationId });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: onCancelled,
  });
  return (
    <Button variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      {t("cancelInvite")}
    </Button>
  );
}

/**
 * Active-org switcher. Hidden when the user belongs to a single org (the common
 * case until invites land). `setActive` rewrites the session's active org; we
 * then clear the query cache so every org-scoped query re-fetches under the new
 * tenant, and refresh the session so `/me` (and the role mirror) re-resolve.
 */
function OrgSwitcher() {
  const t = useTranslations("team");
  const authClient = useAuthClient();
  const queryClient = useQueryClient();
  const { refetch } = useAuth();
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();

  const mutation = useMutation({
    mutationFn: async (organizationId: string) => {
      const { error } = await authClient.organization.setActive({ organizationId });
      if (error) throw new Error(error.message ?? "failed");
    },
    onSuccess: () => {
      queryClient.clear();
      refetch();
    },
  });

  if (!orgs || orgs.length < 2) return null;
  return (
    <select
      aria-label={t("switchOrg")}
      value={active?.id ?? ""}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value)}
      className={inputClass}
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
