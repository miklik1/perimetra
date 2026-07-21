"use client";

import { useRouter } from "next/navigation";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel } from "@repo/ui";

import { OrdersList } from "./orders-list";

/**
 * Client subtree of the protected orders page (ADR 0109 / ADR-O1), gated like
 * /quotes. Reskinned to the canvas o-LIST look (design/configurator/frames-order.jsx
 * `FrameList`) via the settings-layout idiom: the AppShell owns height + scroll +
 * `bg-background`, so the authed `<main>` drops `min-h-screen`/`bg-field` (the
 * §5 per-surface min-h fix) — the AuthGuard fallback keeps `min-h-screen` since it
 * renders bare, outside the shell's framed content slot.
 */
export function OrdersClient() {
  const router = useRouter();
  const t = useTranslations("orders");
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
        <DisplayLabel as="h1">{t("title")}</DisplayLabel>
        <OrdersList />
      </main>
    </AuthGuard>
  );
}
