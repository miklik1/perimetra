import { notFound } from "next/navigation";

import { sharedNabidkaSchema, type SharedNabidka } from "@repo/validators";

import { createPublicServerApiClient } from "../../../lib/server-api";
import { SharedNabidkaView } from "./shared-nabidka-view";

/**
 * Buyer-facing PUBLIC nabídka (ADR 0089). NO session — the unguessable
 * shareToken in the URL IS the credential. RSC fetches the SERVER-BUILT
 * `NabidkaDocument` through the cookie-less public client (the snapshot's
 * cost/margin, re-derivation seeds, and I3 stamps never cross the boundary —
 * built server-side, stripped by the response DTO), then hands it to the client
 * view, which renders the branded `NabidkaLandingView` conversion surface (the
 * ADR-0089 Wave-B reversal, replacing the earlier `NabidkaDocumentView` print
 * twin) plus accept/decline. The route lives OUTSIDE the `/quotes` protected
 * prefix, so the proxy auth gate lets it through; an unknown/withdrawn token
 * fails closed (404).
 */
export default async function SharedNabidkaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const client = createPublicServerApiClient();

  let data: SharedNabidka | undefined;
  try {
    data = await client.apiFetch<SharedNabidka>(`/v1/quotes/shared/${token}`, {
      parse: (d) => sharedNabidkaSchema.parse(d),
    });
  } catch {
    notFound();
  }
  if (!data) notFound();

  return <SharedNabidkaView initial={data} token={token} />;
}
