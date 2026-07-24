"use client";

import { useRouter } from "next/navigation";

import { AuthGuard, useAuth } from "@repo/auth/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { cn, DisplayLabel, Icon, Panel, Separator, Skeleton, StatCard } from "@repo/ui";
import type {
  DashboardActivityItem,
  DashboardExpiringQuote,
  DashboardFunnel,
  DashboardKpis,
  User,
} from "@repo/validators";

import { formatMoney } from "../lib/format-money";
import { useDashboardSummary } from "../lib/use-dashboard-summary";
import { useRole } from "../lib/use-role";
import { OrderStatusBadge } from "./orders/order-status";
import { QuoteStatusBadge } from "./quotes/quote-status";

/**
 * The owner "Přehled" dashboard client subtree (ADR 0125, Phase 2 Wave D). Gated
 * like `/orders` — the AppShell owns height/scroll/bg on the FRAMED authed route,
 * so the authed `<main>` drops `min-h-screen`/`bg-field`; only the AuthGuard
 * fallback (which renders BARE, outside the shell) keeps them (the §5 per-branch
 * rule).
 *
 * CONTRACT-HONESTY: this is an honest SUBTRACTION of the design canvas
 * (`design/configurator/frames-dashboard.jsx`) — every widget is backed by real
 * `quotes`+`orders` data. The canvas's leads KPI/funnel-stage, revenue bars,
 * deposit tile, and the scheduling "Nadcházející" calendar are OMITTED (no
 * backend), and the activity feed is built from order/quote `updatedAt`, NOT the
 * audit trail. Role-filtering is server-side via OPTIONAL summary keys, so the
 * price-blind `workshop` role is deliberately sparse (activeOrders KPI + activity
 * only) — an absent key is simply NOT rendered.
 */
export function DashboardClient() {
  const router = useRouter();
  const t = useTranslations("dashboard");
  const { user } = useAuth();
  const role = useRole();
  const summary = useDashboardSummary();

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-6 md:p-8">
        <DashboardHeader user={user} isWorkshop={role === "workshop"} />
        {summary ? (
          <>
            <KpiRow kpis={summary.kpis} />
            {(summary.funnel !== undefined || summary.expiringQuotes !== undefined) && (
              <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                {summary.funnel !== undefined && <Funnel funnel={summary.funnel} />}
                {summary.expiringQuotes !== undefined && (
                  <ExpiringQuotes quotes={summary.expiringQuotes} />
                )}
              </section>
            )}
            <Activity items={summary.activity} />
          </>
        ) : (
          <DashboardSkeleton />
        )}
      </main>
    </AuthGuard>
  );
}

/** morning `< 12` · afternoon `< 18` · evening — three buckets, the canvas set. */
function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Locale-correct relative time via `Intl.RelativeTimeFormat` (handles Czech
 * plurals: "před 3 dny" / "za 3 dny"). Auto-picks minute/hour/day granularity —
 * used by the activity feed. Computed client-side only (the content subtree
 * mounts after AuthGuard resolves, so there is no SSR `Date.now()` mismatch).
 */
function relativeTime(iso: string, locale: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}

/** Day-granularity relative ("za 3 dny" / "zítra" / "dnes") for `validUntil`. */
function daysUntil(iso: string, locale: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(diff / DAY),
    "day",
  );
}

function DashboardHeader({ user, isWorkshop }: { user: User | null; isWorkshop: boolean }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const now = new Date();

  const firstName = user?.name?.trim().split(/\s+/)[0] ?? user?.email?.split("@")[0] ?? "";
  const salutation = t(`greeting.${greetingKey(now.getHours())}`);
  const heading = firstName ? `${salutation}, ${firstName}` : salutation;
  const dateLine = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  return (
    <header className="flex min-w-0 flex-col gap-1">
      <DisplayLabel as="h1">{heading}</DisplayLabel>
      <p className="text-muted-foreground text-ui-sm">
        {dateLine}
        {isWorkshop ? ` · ${t("workshopSuffix")}` : ""}
      </p>
    </header>
  );
}

function KpiRow({ kpis }: { kpis: DashboardKpis }) {
  const t = useTranslations("dashboard");
  return (
    <section
      aria-label={t("kpi.sectionLabel")}
      className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {/* The ONE spotlight — the single most important KPI (§StatCard reserve). */}
      <StatCard className="flex flex-col justify-between gap-2">
        <StatCard.Label>{t("kpi.activeOrders")}</StatCard.Label>
        <StatCard.Metric className="tabular-nums">{kpis.activeOrders}</StatCard.Metric>
      </StatCard>
      {kpis.openQuotes !== undefined && (
        <PlainKpi label={t("kpi.openQuotes")} value={kpis.openQuotes} />
      )}
      {kpis.acceptedQuotes !== undefined && (
        <PlainKpi label={t("kpi.acceptedQuotes")} value={kpis.acceptedQuotes} />
      )}
      {kpis.expiringSoon !== undefined && (
        <PlainKpi label={t("kpi.expiringSoon")} value={kpis.expiringSoon} />
      )}
    </section>
  );
}

/** Plain (non-spotlight) KPI tile — label + big tabular metric on flat chrome. */
function PlainKpi({ label, value }: { label: string; value: number }) {
  return (
    <Panel elevation="flat" className="flex min-w-0 flex-col justify-between gap-2">
      <span className="text-muted-foreground text-ui-sm">{label}</span>
      <span className="font-data text-metric tabular-nums leading-none">{value}</span>
    </Panel>
  );
}

/** Honest 2-stage funnel — Nabídky → Objednáno. No leads/invoiced stage. */
function Funnel({ funnel }: { funnel: DashboardFunnel }) {
  const t = useTranslations("dashboard");
  const max = Math.max(funnel.quotes, funnel.orders, 1);
  const rows = [
    { key: "quotes", label: t("funnel.quotes"), n: funnel.quotes, fill: "bg-copper" },
    { key: "orders", label: t("funnel.orders"), n: funnel.orders, fill: "bg-info" },
  ] as const;
  return (
    <Panel elevation="flat">
      <Panel.Header>
        <Panel.Title>{t("funnel.title")}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <span className="text-ui-sm w-24 shrink-0">{r.label}</span>
            <div className="bg-chrome-subtle relative h-6 min-w-0 flex-1 overflow-hidden rounded-full">
              <div
                className={cn("h-full rounded-full", r.fill)}
                style={{ width: `${(r.n / max) * 100}%` }}
              />
            </div>
            <span className="font-data text-ui-sm w-8 shrink-0 text-right tabular-nums">{r.n}</span>
          </div>
        ))}
      </Panel.Body>
    </Panel>
  );
}

/** Expiring issued quotes, `validUntil` ascending (server-sorted). Non-workshop. */
function ExpiringQuotes({ quotes }: { quotes: readonly DashboardExpiringQuote[] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  return (
    <Panel elevation="flat">
      <Panel.Header>
        <Panel.Title>{t("expiring.title")}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        {quotes.length === 0 ? (
          <p className="text-muted-foreground text-ui-sm">{t("expiring.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {quotes.map((q, i) => (
              <li key={q.id} className="flex flex-col">
                {i > 0 && <Separator />}
                <div className="flex min-w-0 items-center gap-3 py-2.5">
                  <span className="font-data min-w-0 flex-1 truncate font-medium">
                    {q.number ?? "—"}
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    <QuoteStatusBadge status={q.status} />
                  </span>
                  <span className="text-muted-foreground text-ui-sm shrink-0 whitespace-nowrap">
                    {q.validUntil ? daysUntil(q.validUntil, locale) : "—"}
                  </span>
                  {q.total !== null && (
                    <span className="font-data text-ui-sm shrink-0 whitespace-nowrap tabular-nums">
                      {formatMoney(q.total, locale)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}

/** Merged recent orders + quotes by `updatedAt` desc — NOT the audit trail. */
function Activity({ items }: { items: readonly DashboardActivityItem[] }) {
  const t = useTranslations("dashboard");
  return (
    <Panel elevation="flat">
      <Panel.Header>
        <Panel.Title>{t("activity.title")}</Panel.Title>
      </Panel.Header>
      <Panel.Body>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-ui-sm">{t("activity.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <ActivityRow key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </ul>
        )}
      </Panel.Body>
    </Panel>
  );
}

function ActivityRow({ item }: { item: DashboardActivityItem }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const isOrder = item.kind === "order";
  const label = `${isOrder ? t("activity.orderPrefix") : t("activity.quotePrefix")} ${
    item.number ?? "—"
  }`;
  return (
    <li className="flex min-w-0 items-center gap-3">
      <span className="bg-chrome-subtle text-muted-foreground grid size-8 shrink-0 place-items-center rounded-full">
        <Icon name={isOrder ? "list" : "draft"} size={15} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-ui-sm min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 whitespace-nowrap">
          {isOrder ? (
            <OrderStatusBadge status={item.status} />
          ) : (
            <QuoteStatusBadge status={item.status} />
          )}
        </span>
      </div>
      <span className="text-muted-foreground text-ui-sm shrink-0 whitespace-nowrap">
        {relativeTime(item.updatedAt, locale)}
      </span>
    </li>
  );
}

/** First-paint / re-fetch placeholder (the RSC usually hydrates instantly). */
function DashboardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-6" aria-hidden>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
