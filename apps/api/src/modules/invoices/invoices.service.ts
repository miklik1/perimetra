/**
 * Invoices service (ADR 0112, ADR-O2) — issue and re-derive the second frozen
 * document class. `issue` mirrors quote-issue discipline in ONE `@Transactional()`
 * (guards → §29 gate → allocate number → map + `buildInvoice` → insert → audit →
 * outbox, all committing together, ADR 0037). The CZ tax logic is NEVER
 * re-derived here: the mapper produces a `BuildInvoiceInput` and the kernel's
 * `buildInvoice` assembles the whole `ExportableDocument` (the ADR-0112 §2 seam).
 *
 * `facts` = the frozen `BuildInvoiceInput`; `snapshot` = `buildInvoice(facts)`.
 * Because `buildInvoice` is a pure total function of its input,
 * `verifyReproducibility` re-runs it over the frozen `facts` and deep-equals the
 * frozen `snapshot` — byte-identical or it names the diverging key (§6, I3).
 *
 * Identity is captured LIVE at issue (§29 supply-time parties, ADR 0112 §4): the
 * supplier from the org legal profile (with the IBAN 422 gate) and the buyer from
 * the live customer (fail-closed 422 if GDPR-anonymized). Only the tax/money
 * (the quote's frozen per-rate `TaxBreakdown`) comes from the frozen quote.
 */
import {
  checkSection29Issuable,
  numberingYearFromDuzp,
  todayInPrague,
  variableSymbolFromNumber,
} from "@cardo/tax-cz";
import { formatCents } from "@cardo/tax-cz/export";
import { Transactional } from "@nestjs-cls/transactional";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { uuidv7 } from "uuidv7";

import { type InvoiceRow } from "@repo/db/schema/invoices";
import { type TaxModeKind } from "@repo/model";
import {
  type Invoice,
  type InvoiceReproduction,
  type InvoicesPage,
  type InvoiceSummary,
  type IssueInvoiceInput,
  type ListInvoicesQuery,
  type MarkInvoicePaidInput,
} from "@repo/validators/invoices";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CustomersService } from "../customers/customers.service.js";
import { LegalProfilesService } from "../legal-profiles/legal-profiles.service.js";
import { NumberingService } from "../numbering/numbering.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { QuotesService } from "../quotes/quotes.service.js";
import { formatInvoiceNumber } from "./document-number.js";
import { buildInvoiceDocument, reproduceInvoice } from "./invoice-mapper.js";
import { InvoicesRepository } from "./invoices.repository.js";
import { INVOICE_ISSUED, INVOICE_PAID } from "./invoices.tokens.js";

/** Add whole days to a `YYYY-MM-DD` date (UTC — no TZ drift on the calendar day). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toSummary(row: InvoiceRow): InvoiceSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    documentNumber: row.documentNumber,
    status: row.status,
    currency: row.currency,
    issuedOn: row.issuedOn,
    duzp: row.duzp,
    dueOn: row.dueOn,
    variableSymbol: row.variableSymbol,
    total: row.totalMoney,
    supersededById: row.supersededById ?? null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidNote: row.paidNote ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Detail = summary + the frozen `ExportableDocument` (opaque, the print seam). */
function toDetail(row: InvoiceRow): Invoice {
  return { ...toSummary(row), snapshot: row.snapshot };
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly quotes: QuotesService,
    private readonly legalProfiles: LegalProfilesService,
    private readonly customers: CustomersService,
    private readonly numbering: NumberingService,
  ) {}

  async list(scope: RequestScope, query: ListInvoicesQuery): Promise<InvoicesPage> {
    const { items, nextCursor } = await this.invoices.list(scope, query);
    return { items: items.map(toSummary), nextCursor };
  }

  /** 404 covers both "doesn't exist" and "not yours" — no existence oracle. */
  async get(scope: RequestScope, invoiceId: string): Promise<Invoice> {
    const row = await this.invoices.findById(scope, invoiceId);
    if (!row) throw new NotFoundException("Invoice not found");
    return toDetail(row);
  }

  /**
   * Issue a §29 daňový doklad from an order. All guards run BEFORE a číselná-řada
   * number is burned (an issued tax document is irreversible). The order → quote
   * basis and the live supplier/customer identity are read through the owning
   * services (cross-module, never a schema join — ADR 0032).
   */
  @Transactional()
  async issue(scope: RequestScope, input: IssueInvoiceInput): Promise<Invoice> {
    // 1. Order → frozen commercial basis.
    const { quoteId } = await this.orders.assertIssuableForInvoice(scope, input.orderId);
    const basis = await this.quotes.getInvoiceBasis(scope, quoteId);

    // 2. Supplier identity (live) — §29 completeness + the IBAN payment gate.
    const supplier = await this.legalProfiles.get(scope);
    if (!supplier) {
      throw new UnprocessableEntityException({
        message: "the organization has not completed its legal profile",
        code: "legal_profile_required",
      });
    }
    if (!supplier.ico) {
      throw new UnprocessableEntityException({
        message: "the legal profile is missing its IČO (required on a §29 document)",
        code: "legal_profile_incomplete",
      });
    }
    if (!supplier.iban) {
      throw new UnprocessableEntityException({
        message: "the legal profile has no IBAN — an invoice cannot state a payment target",
        code: "iban_required",
      });
    }

    // 3. Buyer identity (live) — required + not GDPR-anonymized (§29 supply-time).
    if (!basis.customerId) {
      throw new UnprocessableEntityException({
        message: "the quote has no attached customer — a §29 document needs an odběratel",
        code: "customer_required",
      });
    }
    const customer = await this.customers.getIdentityForInvoice(scope, basis.customerId);
    if (!customer) {
      throw new UnprocessableEntityException({
        message: "the attached customer no longer exists",
        code: "customer_required",
      });
    }
    if (customer.anonymized) {
      throw new UnprocessableEntityException({
        message: "the attached customer was anonymized — cannot issue a document naming them",
        code: "customer_anonymized",
      });
    }

    // 4. Effective tax mode (§21 override, audited) + rate-override sanity.
    const mode: TaxModeKind = input.modeOverride ?? basis.tax.mode;
    if (input.ratePctOverride && basis.tax.lines.length > 1) {
      throw new UnprocessableEntityException({
        message: "a uniform rate override is ambiguous on a multi-rate quote",
        code: "rate_override_multi_rate",
      });
    }

    // 4b. A non-VAT-payer (neplátce) MUST NOT issue a document bearing output VAT
    // (§108 ZDPH makes charged DPH a state liability). Nothing upstream couples the
    // supplier's payer status to the price table's dphRate — a non-payer org whose
    // table charges 21% freezes `standard_vat` quotes with real VAT lines — so this
    // is the final legal backstop BEFORE an irreversible číselná-řada number is
    // burned: fail closed rather than print illegal DPH. (Reverse charge zeroes
    // output VAT and is unreachable for a non-payer by construction — resolveTaxMode
    // needs supplierVatPayer — so only a taxed standard-VAT rate is the hazard.)
    const bearsOutputVat =
      mode === "standard_vat" &&
      basis.tax.lines.some((line) => Number(input.ratePctOverride ?? line.ratePct) > 0);
    if (!supplier.vatPayer && bearsOutputVat) {
      throw new UnprocessableEntityException({
        message:
          "the supplier is not a VAT payer but the quote charges DPH — register for VAT or set the price table's DPH rate to 0 before invoicing",
        code: "supplier_not_vat_payer",
      });
    }

    // 5. §29 completeness gate — BEFORE burning a number.
    const reverseCharge = mode === "reverse_charge_92e";
    const violations = checkSection29Issuable({
      isVatPayer: supplier.vatPayer,
      issuerDic: supplier.dic,
      reverseCharge,
      buyerDic: customer.dic,
    });
    if (violations.length > 0) {
      throw new UnprocessableEntityException({
        message: "the document is not §29-issuable",
        code: "section29_incomplete",
        violations,
      });
    }

    // 6. Dates (§29): issue = today in Prague, DUZP = issue, due = issue + 14d.
    const issuedOn = input.issuedOn ?? todayInPrague();
    const duzp = input.duzp ?? issuedOn;
    const dueOn = input.dueOn ?? addDaysIso(issuedOn, 14);

    // 7. Gap-free §29 number allocated INSIDE the tx (rolls back with the insert).
    //    The číselná-řada year is the DUZP year (kernel rule).
    const year = numberingYearFromDuzp(duzp);
    const documentNumber = formatInvoiceNumber(
      year,
      await this.numbering.allocate(scope, "invoice", year),
    );
    const variableSymbol = variableSymbolFromNumber(documentNumber);

    // 8. Map (quote's frozen per-rate gross → BuildInvoiceInput) + build the doc.
    const invoiceId = uuidv7();
    const { facts, snapshot } = buildInvoiceDocument({
      invoiceId,
      documentNumber,
      issuedOn,
      duzp,
      dueOn,
      currency: basis.currency,
      tax: basis.tax,
      mode,
      ratePctOverride: input.ratePctOverride ?? null,
      supplier: {
        name: supplier.name,
        ico: supplier.ico,
        dic: supplier.dic,
        addressLine: supplier.addressLine,
        city: supplier.city,
        postalCode: supplier.postalCode,
        country: supplier.country,
        bankAccount: supplier.bankAccount,
        iban: supplier.iban,
      },
      buyer: {
        name: customer.name,
        ico: customer.ico,
        dic: customer.dic,
        email: customer.email,
        addressLine: customer.addressLine,
        city: customer.city,
        postalCode: customer.postalCode,
        country: customer.country,
      },
      paymentMethod: input.paymentMethod ?? "bank_transfer",
      variableSymbol,
      basisLabel: basis.quoteNumber,
      note: input.note ?? null,
    });

    const totalMoney = formatCents(snapshot.totalCents);

    // 9. Freeze. `invoice_order_active_uq` makes a double-issue a clean 409.
    let row: InvoiceRow;
    try {
      row = await this.invoices.insert(scope, {
        id: invoiceId,
        orderId: input.orderId,
        documentNumber,
        status: "issued",
        currency: basis.currency,
        issuedOn,
        duzp,
        dueOn,
        variableSymbol,
        totalMoney,
        facts,
        snapshot,
      });
    } catch (err) {
      if (isUniqueViolation(err, "invoice_order_active_uq")) {
        throw new ConflictException({
          message: "an active invoice already exists for this order",
          code: "invoice_exists",
        });
      }
      throw err;
    }

    await this.emit(row.id, INVOICE_ISSUED);
    await this.audit.record({
      actorId: scope.userId,
      action: "invoice.issued",
      entityType: "invoice",
      entityId: row.id,
      diff: {
        before: null,
        after: {
          orderId: row.orderId,
          documentNumber,
          total: totalMoney,
          ...(input.modeOverride && { modeOverride: input.modeOverride }),
          ...(input.ratePctOverride && { ratePctOverride: input.ratePctOverride }),
        },
      },
    });
    return toDetail(row);
  }

  /** Mark an issued invoice paid (admin-only) — audited, idempotent (409 repeat). */
  @Transactional()
  async markPaid(
    scope: RequestScope,
    invoiceId: string,
    input: MarkInvoicePaidInput,
  ): Promise<Invoice> {
    const before = await this.invoices.findById(scope, invoiceId);
    if (!before) throw new NotFoundException("Invoice not found");
    const row = await this.invoices.markPaid(scope, invoiceId, new Date(), input.note ?? null);
    if (!row) {
      throw new ConflictException({ message: "invoice is already paid", code: "already_paid" });
    }
    await this.emit(row.id, INVOICE_PAID);
    await this.audit.record({
      actorId: scope.userId,
      action: "invoice.paid",
      entityType: "invoice",
      entityId: row.id,
      diff: { before: { status: "issued" }, after: { status: "paid" } },
    });
    return toDetail(row);
  }

  /** Reverse a mark-paid (admin-only) — audited, idempotent (409 when not paid). */
  @Transactional()
  async unmarkPaid(scope: RequestScope, invoiceId: string): Promise<Invoice> {
    const before = await this.invoices.findById(scope, invoiceId);
    if (!before) throw new NotFoundException("Invoice not found");
    const row = await this.invoices.unmarkPaid(scope, invoiceId);
    if (!row) {
      throw new ConflictException({ message: "invoice is not paid", code: "not_paid" });
    }
    await this.audit.record({
      actorId: scope.userId,
      action: "invoice.unpaid",
      entityType: "invoice",
      entityId: row.id,
      diff: { before: { status: "paid" }, after: { status: "issued" } },
    });
    return toDetail(row);
  }

  /**
   * I3 reproducibility (ADR 0112 §6): re-run `buildInvoice` over the frozen
   * `facts` and deep-equal the frozen `snapshot` — with ZERO engine involvement
   * (the quote already proves the engine half). Names the diverging key(s).
   */
  async verifyReproducibility(
    scope: RequestScope,
    invoiceId: string,
  ): Promise<InvoiceReproduction> {
    const row = await this.invoices.findById(scope, invoiceId);
    if (!row) throw new NotFoundException("Invoice not found");
    const { reproduced, mismatches } = reproduceInvoice(row.facts, row.snapshot);
    return { invoiceId, reproduced, mismatches };
  }

  private emit(invoiceId: string, eventType: string): Promise<string> {
    return this.outbox.emit({
      aggregateType: "invoice",
      aggregateId: invoiceId,
      eventType,
      payload: { invoiceId },
    });
  }
}

/** A Postgres unique-violation (23505) on the named constraint — walks the
 *  DrizzleQueryError `.cause` chain (mirrors the orders module). */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
    current = pg.cause;
  }
  return false;
}
