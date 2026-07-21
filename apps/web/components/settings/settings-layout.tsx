"use client";

import type { ReactNode } from "react";

import { useTranslations } from "@repo/i18n/web";
import { Link } from "@repo/navigation";
import { cn } from "@repo/ui";

import { visibleSettingsTabs, type SettingsTabKey } from "../../lib/settings-tabs";
import { usePlatformAdmin, useRole } from "../../lib/use-role";

/**
 * The Nastavení section shell (1c-2, design §4.1). Provides the ONE `<main>` +
 * section heading + role-gated tab strip that every absorbed settings surface
 * (`/account`, `/account/security`, `/team`, `/team/legal-profile`, `/admin`)
 * wraps its content in — each keeps its own url, so this is a shared chrome, not
 * a route group. `active` names the current tab (each page knows its own), so
 * highlighting never depends on url parsing. No `min-h-screen`: the app shell
 * owns the scroll, so these surfaces do not over-scroll inside it (the §5
 * per-surface fix, applied here as the section is unified).
 */
export function SettingsLayout({
  active,
  children,
}: {
  active: SettingsTabKey;
  children: ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <h1 className="font-display text-2xl">{t("title")}</h1>
      <SettingsTabs active={active} />
      <div className="flex min-w-0 flex-col gap-8">{children}</div>
    </main>
  );
}

function SettingsTabs({ active }: { active: SettingsTabKey }) {
  const t = useTranslations("settings");
  const role = useRole();
  const isPlatformAdmin = usePlatformAdmin();
  const tabs = visibleSettingsTabs({ role, isPlatformAdmin });
  return (
    <nav
      aria-label={t("title")}
      className="border-border -mx-1 flex gap-1 overflow-x-auto border-b px-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
              isActive
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-border border-transparent",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
