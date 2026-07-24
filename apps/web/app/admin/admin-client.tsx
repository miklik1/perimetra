"use client";

import { useRouter } from "next/navigation";

import { invalidateKeys } from "@repo/api";
import {
  useApiClient,
  useAuthQueries,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Badge, Button, cn, Icon, Panel } from "@repo/ui";

import { SettingsLayout } from "../../components/settings/settings-layout";
import { adminKeys, createAdminQueries } from "../../lib/admin-queries";
import { toast } from "../../lib/toast";
import { PriceTableForm } from "./price-table-form";

/**
 * Tenant admin surface (ADR 0061, retiered by ADR 0062): the org's PRICE TABLES.
 * Catalog/release publishing + per-tenant assignment moved to the platform/vendor
 * console (`/platform`) — authoring is vendor-only (CORE_SPEC §3). Admin gate
 * mirrors /team: reads `me?.role === "admin"` from the prefetched query; the
 * server still enforces via `@RequireRole('admin')` on the price-table routes.
 *
 * Phase-2 reskin (Wave C, ADR 0123-family) to the design canvas's Katalog admin
 * LOOK (`design/configurator/frames-catalog.jsx`) under the CONTRACT-HONESTY
 * rule: the canvas invents an org-editable model IDE (family split, rule counts,
 * visibility toggle, release publish, immutable-table restore). NONE of that is
 * backend truth here, so this surface adopts the canvas's *visual grammar*
 * (family-style rows, a version-row price-table timeline) and OMITS the invented
 * data — the price table stays one flat, immutable org-wide table.
 */
export interface AdminClientProps {
  /** Catalog component codes across the org's pinned releases — see
   *  `page.tsx` (CAR-15). Empty when the catalog fetch degraded. */
  componentCodes: string[];
}

export function AdminClient({ componentCodes }: AdminClientProps) {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="bg-field flex min-h-screen items-center justify-center">…</main>}
    >
      <AdminContent componentCodes={componentCodes} />
    </AuthGuard>
  );
}

function AdminContent({ componentCodes }: AdminClientProps) {
  const t = useTranslations("admin");
  const authQueries = useAuthQueries();
  const { data: me } = useQuery(authQueries.me());
  const isAdmin = me?.role === "admin";

  return (
    <SettingsLayout active="admin">
      {!isAdmin && <p className="text-muted-foreground text-sm">{t("onlyAdmin")}</p>}

      {isAdmin && (
        <>
          <section className="flex min-w-0 flex-col gap-4">
            <header className="flex flex-col gap-1">
              <h2 className="text-foreground font-display text-xl font-semibold">
                {t("productVersions")}
              </h2>
              <p className="text-muted-foreground text-sm">{t("productVersionsDescription")}</p>
            </header>
            <ProductVersions />
          </section>

          <section className="flex min-w-0 flex-col gap-4">
            <h2 className="text-foreground font-display text-xl font-semibold">
              {t("priceTables")}
            </h2>
            <PriceTablesList />
            <PriceTableForm componentCodes={componentCodes} />
          </section>
        </>
      )}
    </SettingsLayout>
  );
}

const listClass = "text-muted-foreground flex flex-col gap-1 text-sm";

/**
 * A single generic product glyph — the neutral fallback shell from the canvas's
 * product-family set (`design/configurator/frames-catalog.jsx` `famGlyph`). One
 * glyph for every row on purpose: a `modelId` alone does not tell us the gate
 * family, so faking a per-family icon would be dishonest (§ CONTRACT-HONESTY).
 * A 96×64 viewBox at stroke 2.4 — the family set's weight, distinct from the
 * 24-unit UI `Icon` set (which stays domain-agnostic in `@repo/ui`).
 */
function ProductGlyph({ size = 40 }: { size?: number }) {
  const bars = Array.from({ length: 9 }, (_, i) => 20 + i * 7);
  return (
    <svg
      viewBox="0 0 96 64"
      width={size}
      height={size * 0.66}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x={14} y={20} width={68} height={30} rx={2} />
      {bars.map((x) => (
        <line key={x} x1={x} y1={24} x2={x} y2={46} opacity={0.6} />
      ))}
      <path d="M14 50 L6 50 L6 44 L14 44" opacity={0.7} />
    </svg>
  );
}

/**
 * Opt-in upgrade surface (ADR 0064). Lists the models the org is pinned to for
 * which the vendor has assigned a newer version; "Upgrade" moves the org's pin
 * (explicit opt-in, CORE_SPEC §3). Per-release catalog (ADR 0065) means a newer
 * version may carry a different catalog version and still be opted into freely —
 * there is no cross-catalog refusal. Old quotes/saved sites on the prior version
 * are untouched (I3). Rendered as family-style rows (the canvas `familyList`
 * LOOK) off the REAL upgrade offers only — never fabricated (§ CONTRACT-HONESTY).
 */
function ProductVersions() {
  const t = useTranslations("admin");
  const client = useApiClient();
  const queryClient = useQueryClient();
  const adminQueries = createAdminQueries(client);

  const { data, isLoading } = useQuery(adminQueries.listUpgrades());
  const offers = data?.items ?? [];

  const pin = useMutation({
    ...adminQueries.pinVersion(),
    onSuccess: () => {
      void invalidateKeys(queryClient, [adminKeys.upgrades()]);
      toast.success(t("upgraded"));
    },
    onError: () => toast.error(t("upgradeError")),
  });

  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (offers.length === 0) {
    return (
      <Panel elevation="flat">
        <Panel.Body>
          <p className="text-muted-foreground text-sm">{t("noUpgrades")}</p>
        </Panel.Body>
      </Panel>
    );
  }
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {offers.map((o) => {
        // Scope the pending label to the row actually being upgraded — a single
        // shared mutation would otherwise show "Upgrading…" on every button.
        const upgrading = pin.isPending && pin.variables?.releaseId === o.latestReleaseId;
        return (
          <li
            key={o.modelId}
            className="border-border flex items-center gap-3 rounded-md border px-3 py-2.5"
          >
            <span className="text-muted-foreground flex w-10 shrink-0 justify-center">
              <ProductGlyph size={40} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold">{o.modelId}</span>
                <Badge tone="info">{t("upgradeAvailable")}</Badge>
              </div>
              <div className="text-muted-foreground font-mono text-xs">
                v{o.pinnedVersion} → v{o.latestVersion}
              </div>
            </div>
            <Button
              type="button"
              disabled={pin.isPending}
              onClick={() => pin.mutate({ releaseId: o.latestReleaseId })}
            >
              {upgrading ? t("upgrading") : t("upgradeTo", { version: String(o.latestVersion) })}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Published price tables as a version-row timeline (the canvas `versionRow` LOOK,
 * `frames-catalog.jsx`). Price tables are IMMUTABLE (invariant I3): a newer
 * version supersedes the prior one from its effective date — so there is NO
 * "restore" action the canvas draws, only an honest immutability note. The
 * newest table (highest version — robust to list ordering) carries the copper
 * "latest" glyph + a Nejnovější badge; older ones a muted draft glyph.
 */
function PriceTablesList() {
  const t = useTranslations("admin");
  const { data, isLoading } = useInfiniteQuery(
    createAdminQueries(useApiClient()).listPriceTables(),
  );
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  if (isLoading) return <p className={listClass}>{t("loadingList")}</p>;
  if (items.length === 0) return <p className={listClass}>{t("noneYet")}</p>;

  const maxVersion = Math.max(...items.map((p) => p.version));

  return (
    <Panel elevation="flat">
      <Panel.Body>
        <ul className="flex min-w-0 flex-col">
          {items.map((p) => {
            const isLatest = p.version === maxVersion;
            return (
              <li
                key={p.id}
                className="border-border flex items-center gap-3 border-t py-3 first:border-t-0"
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full",
                    isLatest
                      ? "bg-copper text-copper-foreground"
                      : "bg-chrome-subtle text-muted-foreground",
                  )}
                >
                  <Icon name={isLatest ? "check" : "draft"} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">v{p.version}</span>
                    <span className="text-muted-foreground font-mono text-xs">{p.currency}</span>
                    {isLatest && <Badge tone="success">{t("priceTablesActive")}</Badge>}
                  </div>
                </div>
                <span className="text-muted-foreground font-data text-xs tabular-nums">
                  {p.effectiveFrom.slice(0, 10)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground mt-3 text-xs">{t("priceTablesDescription")}</p>
      </Panel.Body>
    </Panel>
  );
}
