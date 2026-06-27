import {
  type NabidkaDocumentDto,
  type QuoteAcceptance,
  type QuoteDetail,
  type QuoteReproduction,
  type QuoteSummary,
  type SharedNabidka,
} from "@repo/validators";

/**
 * In-memory quote store for the mock tier (ADR 0018). The quote is an immutable
 * I3 artifact; the mock seeds a few representative frozen snapshots (standard
 * VAT, §92e reverse-charge, an accepted one) so the web list/detail/verify
 * surface renders without a backend. ids are uuidv7-shaped (lexicographic ==
 * creation order, the keyset-cursor contract).
 */

/** A frozen snapshot shaped like the engine/tax output the detail surface reads
 *  (the contract treats `snapshot` as opaque `unknown`). */
function snapshot(net: string, tax: object) {
  return {
    money: { material: net, accessory: "0", manufacturing: "0", installation: "0", total: net },
    tax,
  };
}

const standardTax = {
  mode: "standard_vat" as const,
  currency: "CZK",
  rounding: { scale: 2, mode: "half-up" as const, granularity: "end-of-invoice" as const },
  lines: [{ ratePct: "21", netBase: "129891.5", vatAmount: "27277.22", gross: "157168.72" }],
  netTotal: "129891.5",
  vatTotal: "27277.22",
  grossTotal: "157168.72",
};

const reverseChargeTax = {
  mode: "reverse_charge_92e" as const,
  legend:
    "Daň odvede zákazník — přenesená daňová povinnost podle § 92e zákona č. 235/2004 Sb., o dani z přidané hodnoty.",
  currency: "CZK",
  rounding: { scale: 2, mode: "half-up" as const, granularity: "end-of-invoice" as const },
  lines: [{ ratePct: "21", netBase: "129891.5", vatAmount: "0", gross: "129891.5" }],
  netTotal: "129891.5",
  vatTotal: "0",
  grossTotal: "129891.5",
};

const stamps = {
  releaseIds: { gate: "sliding-gate@1" },
  catalogVersions: { "sliding-gate@1": 2 },
  priceTableVersion: 2,
  overrideIds: [],
};

function seedQuote(index: number, over: Partial<QuoteDetail>): QuoteDetail {
  const seq = String(index).padStart(12, "0");
  const now = `2026-06-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`;
  return {
    id: `00000000-0000-7000-8000-${seq}`,
    projectId: null,
    customerId: null,
    status: "issued",
    documentNumber: `2026/${String(index).padStart(4, "0")}`,
    currency: "CZK",
    total: "129891.5",
    validUntil: null,
    shareToken: `share-${seq}`,
    createdAt: now,
    updatedAt: now,
    stamps,
    snapshot: snapshot("129891.5", standardTax),
    ...over,
  };
}

let quotes: QuoteDetail[] = [];
let createSeq = 0;

function seed(): QuoteDetail[] {
  return [
    seedQuote(1, { status: "issued", snapshot: snapshot("129891.5", standardTax) }),
    seedQuote(2, {
      status: "issued",
      total: "129891.5",
      snapshot: snapshot("129891.5", reverseChargeTax),
    }),
    seedQuote(3, { status: "accepted", snapshot: snapshot("129891.5", standardTax) }),
  ];
}
quotes = seed();

export function listQuoteFixtures(): QuoteSummary[] {
  return quotes.map((q) => ({
    id: q.id,
    projectId: q.projectId,
    customerId: q.customerId,
    status: q.status,
    documentNumber: q.documentNumber,
    currency: q.currency,
    total: q.total,
    validUntil: q.validUntil,
    shareToken: q.shareToken,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  }));
}

export function findQuoteFixture(id: string): QuoteDetail | undefined {
  return quotes.find((q) => q.id === id);
}

export function findQuoteByShareToken(token: string): QuoteDetail | undefined {
  return quotes.find((q) => q.shareToken === token);
}

/** A representative supplier (dodavatel) block (ADR 0088) for the mock buyer
 *  view — the real API freezes the org legal profile at issue. */
const mockSupplier = {
  name: "Perimetra Vrata s.r.o.",
  ico: "01234567",
  dic: "CZ01234567",
  addressLine: "Tovární 5",
  city: "Olomouc",
  postalCode: "779 00",
  bankAccount: "2000145399/2010",
  registrationNote: "Zapsáno v OR vedeném Krajským soudem v Ostravě, oddíl C.",
};

/**
 * The buyer-facing public nabídka by shareToken (ADR 0089). The real API builds
 * the `NabidkaDocument` server-side off the frozen snapshot; the mock assembles a
 * representative one from the seeded quote so the no-session buyer route renders
 * without a backend. NO cost data — mirrors the real boundary.
 */
export function findSharedNabidkaFixture(token: string): SharedNabidka | undefined {
  const quote = quotes.find((q) => q.shareToken === token);
  if (!quote) return undefined;
  const snap = quote.snapshot as { tax: NabidkaDocumentDto["tax"] };
  const { tax } = snap;
  const document: NabidkaDocumentDto = {
    documentNumber: quote.documentNumber,
    supplier: mockSupplier,
    customer: quote.customerId
      ? {
          name: "Stavby Vrata s.r.o.",
          ico: "27074358",
          dic: "CZ27074358",
          addressLine: "Průmyslová 12",
          city: "Brno",
          postalCode: "61200",
        }
      : null,
    currency: tax.currency,
    instanceCount: 1,
    lines: [
      {
        componentCode: "GATE-FRAME",
        name: "Rám brány",
        unit: "ks",
        category: "material",
        quantity: 1,
        totalPriceMoney: tax.netTotal,
      },
    ],
    categories: [
      { key: "material", total: tax.netTotal },
      { key: "accessory", total: "0" },
      { key: "manufacturing", total: "0" },
      { key: "installation", total: "0" },
    ],
    tax,
    netTotal: tax.netTotal,
    vatTotal: tax.vatTotal,
    grossTotal: tax.grossTotal,
    ...(tax.legend !== undefined ? { legend: tax.legend } : {}),
  };
  // Mirror the real API's effective status (ADR 0083): a lapsed `issued` quote
  // reads as `expired`, so mock-mode dev sees the same banner as production.
  const effective =
    quote.status === "issued" &&
    quote.validUntil !== null &&
    new Date(quote.validUntil).getTime() <= Date.now()
      ? "expired"
      : quote.status;
  return { document, status: effective, validUntil: quote.validUntil };
}

/** Issue: freeze a new quote from a site payload. The mock derives nothing — it
 *  mirrors the standard-VAT golden so the issue→detail flow renders. */
export function insertQuoteFixture(input: {
  customerId?: string;
  tax?: { constructionAssembly?: boolean; customerVatPayer?: boolean };
}): QuoteDetail {
  createSeq += 1;
  const reverse = input.tax?.constructionAssembly && input.tax?.customerVatPayer;
  const quote = seedQuote(100 + createSeq, {
    customerId: input.customerId ?? null,
    snapshot: snapshot("129891.5", reverse ? reverseChargeTax : standardTax),
  });
  quotes.push(quote);
  return quote;
}

export function setQuoteStatusFixture(
  token: string,
  status: "accepted" | "declined",
): QuoteAcceptance | undefined {
  const quote = quotes.find((q) => q.shareToken === token);
  if (!quote || quote.status !== "issued") return undefined;
  quote.status = status;
  return { documentNumber: quote.documentNumber, status };
}

/** Verify always reproduces in the mock (the I3 happy path). */
export function verifyQuoteFixture(id: string): QuoteReproduction | undefined {
  const quote = quotes.find((q) => q.id === id);
  if (!quote) return undefined;
  return { quoteId: id, reproduced: true, mismatches: [] };
}

export function resetQuotes(): void {
  quotes = seed();
  createSeq = 0;
}
