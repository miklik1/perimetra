"use client";

import { useRouter } from "next/navigation";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel } from "@repo/ui";

import { CreateProjectForm } from "./create-project-form";
import { ProjectsList } from "./projects-list";
import { ProjectsLiveBadge } from "./projects-live-badge";

/**
 * Client subtree of the protected projects page, gated exactly like /account:
 * the proxy gate bounced cookie-less visitors already, `<AuthGuard>` resolves
 * the session once on mount and redirects stale sessions to /login.
 *
 * Reskinned via the settings-layout idiom (copied from orders-client.tsx): the
 * AppShell owns height + scroll + `bg-background`, so the authed `<main>`
 * drops `min-h-screen`/`bg-field` — the AuthGuard fallback keeps
 * `min-h-screen bg-field` since it renders bare, outside the shell's framed
 * content slot.
 */
export function ProjectsClient() {
  const router = useRouter();
  const t = useTranslations("projects");
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
        <div className="flex items-center justify-between">
          <DisplayLabel as="h1">{t("title")}</DisplayLabel>
          <ProjectsLiveBadge />
        </div>
        <CreateProjectForm />
        <ProjectsList />
      </main>
    </AuthGuard>
  );
}
