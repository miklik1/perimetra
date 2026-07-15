"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { errorMessageKey } from "../../../../lib/error-messages";
import { createOrdersQueries } from "../../../../lib/orders-queries";
// The price-blind production view + traveler are ONE surface rendered from two
// entry points (quotes N-1, orders). Their canonical home is the quotes
// production folder; the orders route wraps the same components — the same
// app-route→app-route reuse `production-view` itself already does with the
// configurator's drawing renderers (no second implementation, ADR 0077/0101).
import { ProductionView } from "../../../quotes/[id]/production/production-view";

export function OrderProductionClient({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("orders");
  const tErrors = useTranslations("errors");
  const ordersQueries = createOrdersQueries(useApiClient());
  const { data: production, error } = useQuery(ordersQueries.production(id));

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="bg-field mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
        <Link href="/orders" className="text-muted-foreground text-sm hover:underline">
          ← {t("title")}
        </Link>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {tErrors(errorMessageKey(error))}
          </p>
        )}
        {production && (
          <ProductionView
            production={production}
            travelerHref={`/orders/${id}/production/traveler`}
          />
        )}
      </main>
    </AuthGuard>
  );
}
