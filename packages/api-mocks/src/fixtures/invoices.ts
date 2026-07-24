import { type Invoice } from "@repo/validators";

/**
 * In-memory invoice store for the mock tier (ADR 0018, ADR 0112 / ADR 0127). An
 * invoice is an immutable §29 daňový doklad: once issued it is only ever marked
 * paid/unpaid (ROW state) or superseded — never edited. The mock seeds three
 * representative rows (issued/unpaid, paid, superseded) so the `/invoices` list
 * + detail + payment surfaces render without a backend. ids are uuidv7-shaped
 * (lexicographic == creation order, the keyset-cursor contract) and `orderId`s
 * point at `handlers/orders.ts`' seeded orders.
 *
 * `snapshot` is a MINIMAL plausible `ExportableDocument`-shaped object. Nothing
 * here parses it and the mock does not own its shape — the frozen document is
 * projected api-side through the kernel's own `buildPdfViewModel`, which is why
 * `GET /v1/invoices/:id/document` is deliberately NOT mocked (see the handler).
 */
function snapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01930000-0000-7000-8000-00000000000f",
    number: "FV2026/0001",
    type: "invoice",
    issueDate: "2026-07-16",
    duzpDate: "2026-07-16",
    dueDate: "2026-07-30",
    currency: "CZK",
    reverseCharge: false,
    supplierName: "Perimetra Demo s.r.o.",
    supplierIco: "12345678",
    buyerName: "Bartek Vrata s.r.o.",
    variableSymbol: "20260001",
    paymentMethod: "bank_transfer",
    subtotalBaseCents: 10000000,
    vatTotalCents: 2100000,
    roundingCents: 0,
    totalCents: 12100000,
    vatSummary: [],
    lines: [],
    correctsNumber: null,
    note: null,
    ...over,
  };
}

function seedInvoice(index: number, over: Partial<Invoice>): Invoice {
  const seq = String(index).padStart(12, "0");
  const now = `2026-07-${String((index % 28) + 15).padStart(2, "0")}T08:00:00.000Z`;
  return {
    id: `01930000-0000-7000-8000-${seq}`,
    orderId: "01920000-0000-7000-8000-000000000001",
    documentNumber: `FV2026/${String(index).padStart(4, "0")}`,
    status: "issued",
    currency: "CZK",
    issuedOn: "2026-07-16",
    duzp: "2026-07-16",
    dueOn: "2026-07-30",
    variableSymbol: `2026${String(index).padStart(4, "0")}`,
    total: "121000.00",
    supersededById: null,
    paidAt: null,
    paidNote: null,
    createdAt: now,
    updatedAt: now,
    snapshot: snapshot(),
    ...over,
  };
}

let invoices: Invoice[] = [];
let createSeq = 0;

function seed(): Invoice[] {
  return [
    seedInvoice(1, {}),
    // Settled row — `paidAt`/`paidNote` are ROW state, never document content
    // (ADR 0112 §5), so the frozen snapshot is untouched by the payment mark.
    seedInvoice(2, {
      orderId: "01920000-0000-7000-8000-000000000002",
      status: "paid",
      total: "48400.00",
      paidAt: "2026-07-22T10:15:00.000Z",
      paidNote: "VS 20260002",
      snapshot: snapshot({ number: "FV2026/0002", totalCents: 4840000 }),
    }),
    // Superseded (the same SEPARATE-pointer shape as the quote fixtures): the
    // status stays `issued`; only `supersededById` marks the lineage.
    seedInvoice(3, {
      supersededById: "01930000-0000-7000-8000-000000000009",
      snapshot: snapshot({ number: "FV2026/0003" }),
    }),
  ];
}
invoices = seed();

export function listInvoiceFixtures(): Invoice[] {
  return [...invoices];
}

/** Find an invoice by id — the mock parity for `GET /v1/invoices/:id`. */
export function findInvoiceFixture(id: string): Invoice | undefined {
  return invoices.find((i) => i.id === id);
}

/** Issue: freeze a new invoice from an order. The mock derives nothing — it
 *  mirrors the standard-VAT seed row so the issue→detail flow renders. */
export function insertInvoiceFixture(input: { orderId: string; note?: string }): Invoice {
  createSeq += 1;
  const index = 100 + createSeq;
  const invoice = seedInvoice(index, {
    orderId: input.orderId,
    snapshot: snapshot({
      number: `FV2026/${String(index).padStart(4, "0")}`,
      note: input.note ?? null,
    }),
  });
  invoices.push(invoice);
  return invoice;
}

/** Mark/unmark paid — the mock parity for the two admin row-state actions.
 *  Returns `undefined` when the row is absent; the handler maps the typed
 *  already-paid / not-paid conflicts. */
export function setInvoicePaidFixture(
  id: string,
  paid: boolean,
  note?: string,
): Invoice | undefined {
  const index = invoices.findIndex((i) => i.id === id);
  if (index === -1) return undefined;
  const current = invoices[index]!;
  const updated: Invoice = {
    ...current,
    status: paid ? "paid" : "issued",
    paidAt: paid ? new Date().toISOString() : null,
    paidNote: paid ? (note ?? null) : null,
    updatedAt: new Date().toISOString(),
  };
  invoices[index] = updated;
  return updated;
}

export function resetInvoices(): void {
  invoices = seed();
  createSeq = 0;
}
