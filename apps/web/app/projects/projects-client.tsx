"use client";

import { useRouter } from "next/navigation";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { CreateProjectForm } from "./create-project-form";
import { ProjectsList } from "./projects-list";
import { ProjectsLiveBadge } from "./projects-live-badge";

/**
 * Client subtree of the protected projects page, gated exactly like /account:
 * the proxy gate bounced cookie-less visitors already, `<AuthGuard>` resolves
 * the session once on mount and redirects stale sessions to /login.
 */
export function ProjectsClient() {
  const router = useRouter();
  const t = useTranslations("projects");
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <ProjectsLiveBadge />
        </div>
        <CreateProjectForm />
        <ProjectsList />
      </main>
    </AuthGuard>
  );
}
