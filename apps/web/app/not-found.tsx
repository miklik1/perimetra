import Link from "next/link";

import { getTranslations } from "@repo/i18n/web/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("notFoundDescription")}</p>
      <Link
        href="/"
        className="mt-4 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
      >
        {t("goHome")}
      </Link>
    </main>
  );
}
