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
 *
 * READ SCOPE (ADR 0082, retrofitted): every read runs through `scopeOpts(role)`
 * — org scope always, plus per-rep ownership for a non-admin. This is a pure
 * VISIBILITY narrowing: nothing about what is frozen or how it re-derives
 * changed, so for any row a caller may see, `verifyReproducibility` behaves
 * exactly as before (I3 is a property of the row, not of who is looking).
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

import { type OrgRole } from "../../common/rbac/org-role.js";
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
import { InvoicesRepository, type InvoiceScopeOpts } from "./invoices.repository.js";
import { INVOICE_ISSUED, INVOICE_PAID } from "./invoices.tokens.js";

/**
 * admin sees the whole org; every other rep is narrowed to the invoices it
 * issued (ADR 0082, mirroring customers). Spelled `!== "admin"` rather than
 * quotes' `=== "sales"` deliberately: the whole invoice surface is
 * `@RequireRole("admin","sales")`, so `workshop` never reaches this service at
 * all (403 by absence — an invoice is price-BEARING) and the two spellings are
 * equivalent today. `!== "admin"` is the fail-CLOSED direction: if a future role
 * is ever added to the `@RequireRole` list it starts narrowed, and a too-small
 * list is a visible bug where a too-large one is a silent PII leak.
 */
function scopeOpts(role: OrgRole): InvoiceScopeOpts {
  return { restrictToOwner: role !== "admin" };
}

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

  async list(scope: RequestScope, role: OrgRole, query: ListInvoicesQuery): Promise<InvoicesPage> {
    const { items, nextCursor } = await this.invoices.list(scope, scopeOpts(role), query);
    return { items: items.map(toSummary), nextCursor };
  }

  /** 404 covers "doesn't exist", "not this org" AND "another rep's" — one shape
   *  for all three, so the response is never an existence oracle (a 403 would
   *  confirm the invoice exists, which is itself a disclosure). */
  async get(scope: RequestScope, role: OrgRole, invoiceId: string): Promise<Invoice> {
    const row = await this.invoices.findById(scope, scopeOpts(role), invoiceId);
    if (!row) throw new NotFoundException("Invoice not found");
    return toDetail(row);
  }

  /**
   * Issue a §29 daňový doklad from an order. All guards run BEFORE a číselná-řada
   * number is burned (an issued tax document is irreversible). The order → quote
   * basis and the live supplier/customer identity are read through the owning
   * services (cross-module, never a schema join — ADR 0032).
   *
   * NOT owner-narrowed, deliberately (the three basis reads below):
   * `orders.assertIssuableForInvoice` and `quotes.getInvoiceBasis` are org-scoped
   * seams (an ORDER is org-visible to every role by design — it carries no money
   * and no PII beyond its number, ADR-O1), and `customers.getIdentityForInvoice`
   * is org-scoped-including-erased on purpose so the §29 anonymized guard fails
   * CLOSED instead of mis-reading a 404 (ADR 0112 §7). Invoicing is an ORG act,
   * not a personal one — a stand-in rep must be able to invoice a colleague's
   * completed order. The freeze then stamps `ownerId = scope.userId` (ADR 0055),
   * so the issuer is the row's owner and the narrowing applies from here on.
   * Consequence worth naming: a rep who invoices a colleague's order becomes the
   * only non-admin who can re-open that invoice. That is an availability quirk
   * (admin always sees everything), never a disclosure — the issuer already
   * received the whole document in this response.
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

  /**
   * Mark an issued invoice paid (admin-only) — audited, idempotent (409 repeat).
   * The role still threads through `scopeOpts` even though `@RequireRole("admin")`
   * makes it a no-op today: the narrowing then rides the ROUTE's role list rather
   * than a hand-maintained assumption, so opening the route to `sales` later
   * cannot silently widen the read.
   */
  @Transactional()
  async markPaid(
    scope: RequestScope,
    role: OrgRole,
    invoiceId: string,
    input: MarkInvoicePaidInput,
  ): Promise<Invoice> {
    const opts = scopeOpts(role);
    const before = await this.invoices.findById(scope, opts, invoiceId);
    if (!before) throw new NotFoundException("Invoice not found");
    const row = await this.invoices.markPaid(
      scope,
      opts,
      invoiceId,
      new Date(),
      input.note ?? null,
    );
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
  async unmarkPaid(scope: RequestScope, role: OrgRole, invoiceId: string): Promise<Invoice> {
    const opts = scopeOpts(role);
    const before = await this.invoices.findById(scope, opts, invoiceId);
    if (!before) throw new NotFoundException("Invoice not found");
    const row = await this.invoices.unmarkPaid(scope, opts, invoiceId);
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
   *
   * Owner-narrowed like every other read, and for the same reason: a 200 here vs
   * a 404 is an existence oracle over another rep's document. The re-derivation
   * ITSELF is untouched — same frozen `facts`, same pure `buildInvoice`, same
   * byte comparison — so for every row a caller may see the answer is identical
   * to before this narrowing (I3 is a property of the row, not of the reader).
   */
  async verifyReproducibility(
    scope: RequestScope,
    role: OrgRole,
    invoiceId: string,
  ): Promise<InvoiceReproduction> {
    const row = await this.invoices.findById(scope, scopeOpts(role), invoiceId);
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
