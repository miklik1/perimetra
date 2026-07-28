"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useTranslations } from "@repo/i18n/web";
import { Button, KeyValueList } from "@repo/ui";
import { type InvoiceDocument } from "@repo/validators";

import { PrintSheetStyle } from "../../../../lib/print/print-sheet-style";

/**
 * PROVISIONAL (CAR-27 pass 2) — the layout, the field selection and the money
 * presentation on this sheet have NOT been reviewed by an accountant. Nothing
 * here claims legal correctness or compliance.
 *
 * The printable §29 daňový doklad (ADR 0127) — the thin print SURFACE over the
 * pure-data document layer, exactly the split ADR 0086/0087/0088/0108 draw for
 * the nabídka and the workshop traveler. The difference is where the pure data
 * comes from: the invoice's provenance is a FROZEN KERNEL DOCUMENT, so the
 * document layer is the kernel's own `buildPdfViewModel`, SERVED through
 * `GET /v1/invoices/:id/document` rather than shipped — the web must never
 * import `@cardo/tax-cz` (its `/export` index eagerly loads the ISDOC/UBL
 * exporters and therefore native libxmljs2 + saxon-js).
 *
 * So this component holds NO document logic whatever: no tax rule, no §92e
 * legend text, no document-type label, no money formatting. Every one of those
 * is kernel-owned and arrives on the wire already rendered (the 2026-07-14
 * no-duplication ruling — a second CZ tax/legend/format code path is the worst
 * possible outcome on a regulated document).
 *
 * ABSENCE, NOT MASKING (ADR 0126's inversion + the ADR-0108 precedent): a §29
 * mandatory field that is absent renders a LABELLED em dash rather than being
 * omitted the way the nabídka omits. On a VIEW you may honestly subtract; on a
 * tax document a missing field is a DEFECT and must be visible.
 *
 * The sheet paints ONLY with the tokens `PrintSheetStyle`'s `LIGHT_TOKENS`
 * dark-reset covers: background, foreground, card, muted-foreground, border,
 * field, field-raised, the three chrome tokens and the two copper tokens. A
 * token outside that set (`destructive`, `success`, `primary`, `spotlight-*`)
 * would print in its DARK value for an operator on the dark theme.
 */

/** The absent-value mark. A literal, never an i18n key — the shipped quotes /
 *  customers idiom (an em dash is not copy, it is a typographic absence). */
const EM_DASH = "—";

/** A titled block of the sheet (items, payment details, VAT recap). `title` is
 *  the heading's CONTENT — the `KeyValueList.Row` `label` precedent — and the
 *  body is children, so a block composes freely (table, list, prose). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8 min-w-0">
      <h2 className="mb-3 font-display text-lg">{title}</h2>
      {children}
    </section>
  );
}

/** One party column (dodavatel / odběratel). The eyebrow register is a separate
 *  component rather than a `variant` flag on `Section`: two explicit shapes, no
 *  boolean mode. Identity lines are children, so each party block composes the
 *  fields the document actually carries for it. */
function PartyBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 font-display text-xs tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** A labelled identity line inside a party block. The label and the value are
 *  each their OWN element so an absent §29 field prints a standalone, legible
 *  `—` (and so a reader — human or assistive — pairs them). */
function PartyLine({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="font-data text-xs">
      <span className="text-muted-foreground">{label}</span>: <span>{value ?? EM_DASH}</span>
    </span>
  );
}

/**
 * A table on the sheet, inside its own horizontal scroll boundary.
 *
 * The wrapper is `relative min-w-0 overflow-x-auto` — the shipped o-LIST idiom
 * (ADR 0121), and load-bearing for the same reason: a table wider than the
 * viewport otherwise pushes the BODY wide instead of scrolling inside itself
 * (proven here at 390px, where the nine-column item table overflowed the body by
 * 253px in both themes). `min-w-0` has to run down the whole chain, so the sheet
 * and its sections carry it too.
 *
 * `print:overflow-visible` is the other half: an `overflow-x-auto` box CLIPS on
 * paper, which on a §29 daňový doklad would silently amputate the money columns.
 * The sheet is A4 by construction, so on print there is nothing to scroll.
 */
function SheetTable({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-w-0 overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-max font-data text-sm tabular-nums print:min-w-0">
        {children}
      </table>
    </div>
  );
}

/** Column classes. Cells need HORIZONTAL separation, not just vertical padding:
 *  without it adjacent columns butt together and the sheet reads
 *  `MnožstvíMJ` / `1 ks129891.50 CZK129891.50 CZK` — proven on the printed
 *  document, which is the worst place for it. Amounts, units and rates never
 *  wrap; only the description column is prose and may. */
const TH = "px-3 py-1 text-right font-medium first:pl-0 last:pr-0";
const TH_LEFT = "px-3 py-1 font-medium first:pl-0 last:pr-0";
const TD = "whitespace-nowrap px-3 py-1.5 text-right first:pl-0 last:pr-0";
const TD_LEFT = "whitespace-nowrap px-3 py-1.5 first:pl-0 last:pr-0";

/** A standalone labelled line under the tables (opravovaný doklad). Same
 *  label/value element split as `PartyLine`, at body scale. */
function DocLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-6 text-sm">
      <span className="text-muted-foreground">{label}</span>:{" "}
      <span className="font-data">{children}</span>
    </p>
  );
}

export function FakturaDocumentView({
  doc,
  backHref,
}: {
  doc: InvoiceDocument;
  backHref?: string;
}) {
  const t = useTranslations("invoices");

  /** Frozen-document amounts are the KERNEL's `formatCents` output (dot-decimal,
   *  xsd:decimal canonical). They are printed VERBATIM beside the frozen ISO
   *  currency code — never through `formatMoney`, never through `Number()`,
   *  never regrouped. Money formatting is kernel-owned (the 2026-07-14
   *  no-duplication ruling); a web-side reformatter would be a second money path
   *  on a regulated document. PROVISIONAL: Czech money presentation (space
   *  grouping, comma decimal, "Kč") is a CAR-27 accountant-pass question.
   *
   *  The separator is a NON-BREAKING space (U+00A0, invisible in this source):
   *  an amount and its currency code are one unit and must never be split
   *  across a line or an A4 page. */
  const amount = (value: string) => `${value}\u00A0${doc.currency}`;

  return (
    <main className="min-h-screen bg-field">
      <PrintSheetStyle margin="18mm 16mm" extra="  .faktura-sheet tr { break-inside: avoid; }" />

      {/* Toolbar — screen only */}
      <div className="no-print mx-auto flex w-full max-w-[210mm] items-center justify-between gap-4 px-6 pt-6">
        {backHref ? (
          <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
            ← {t("title")}
          </Link>
        ) : (
          <span />
        )}
        <Button type="button" variant="copper-outline" onClick={() => window.print()}>
          {t("print.print")}
        </Button>
      </div>

      {/* The document sheet */}
      {/* `min-w-0` is on the sheet AND on `SheetTable`'s wrapper: the banked
          ADR-0121 lesson is that it must run down the WHOLE chain, not just the
          innermost box, or a wide table still pushes the body. */}
      <article className="faktura-sheet mx-auto my-6 w-full max-w-[210mm] min-w-0 bg-background p-6 text-foreground shadow-sm sm:p-10 print:my-0 print:p-0 print:shadow-none">
        {/* The document type name has exactly ONE source: the kernel's own
            `DOCUMENT_TYPE_LABELS`, on the wire. Never an i18n key here. */}
        <header className="mb-8 flex items-start justify-between border-b border-border pb-6">
          <h1 className="font-display text-3xl">{doc.documentTypeLabel}</h1>
          <p className="font-data text-sm text-muted-foreground">{doc.documentNumber}</p>
        </header>

        {/* Parties — the frozen supplier/buyer identity. `supplierEmail` has NO
            data source at all today (the org legal profile carries no e-mail
            field), so it is structurally an absence, never a live read. */}
        <section className="mb-8 grid grid-cols-2 gap-8 text-sm">
          <PartyBlock title={t("print.supplier")}>
            <span className="font-medium">{doc.supplierName}</span>
            <span>{doc.supplierAddress}</span>
            <PartyLine label={t("print.ico")} value={doc.supplierIco} />
            <PartyLine label={t("print.dic")} value={doc.supplierDic} />
            <PartyLine label={t("print.email")} value={doc.supplierEmail} />
          </PartyBlock>
          <PartyBlock title={t("print.customer")}>
            <span className="font-medium">{doc.buyerName}</span>
            <span>{doc.buyerAddress}</span>
            <PartyLine label={t("print.ico")} value={doc.buyerIco} />
            <PartyLine label={t("print.dic")} value={doc.buyerDic} />
          </PartyBlock>
        </section>

        {/* Payment details. The dates are the FROZEN `YYYY-MM-DD` strings,
            rendered verbatim: they are document content, not a locale-formatted
            view. `dueDate` is §29-mandatory-shaped and nullable → labelled `—`. */}
        <Section title={t("print.payment")}>
          <KeyValueList className="max-w-md text-sm">
            <KeyValueList.Row label={t("print.issueDate")}>{doc.issueDate}</KeyValueList.Row>
            <KeyValueList.Row label={t("print.duzp")}>{doc.duzpDate}</KeyValueList.Row>
            <KeyValueList.Row label={t("print.dueDate")}>{doc.dueDate ?? EM_DASH}</KeyValueList.Row>
            <KeyValueList.Row label={t("print.variableSymbol")} mono>
              {doc.variableSymbol}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("print.paymentMethod")}>
              {doc.paymentMethod}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("print.bankAccount")} mono>
              {doc.supplierBankAccount ?? EM_DASH}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("print.iban")} mono>
              {doc.supplierIban ?? EM_DASH}
            </KeyValueList.Row>
          </KeyValueList>
        </Section>

        {/* Invoiced lines. Under §92e the VAT cell prints `—` (the shipped
            nabídka idiom): the tax is the customer's to declare, so there is no
            VAT amount on this document to state. */}
        <Section title={t("print.items")}>
          <SheetTable>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className={TH_LEFT}>
                  {t("print.colIndex")}
                </th>
                <th scope="col" className={TH_LEFT}>
                  {t("print.colDescription")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colQuantity")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colUnit")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colUnitPrice")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colBase")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colRate")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colVat")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colGross")}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.index} className="border-b border-border/50">
                  <td className={TD_LEFT}>{line.index}</td>
                  {/* The only prose cell — it MAY wrap, and takes the slack so the
                      numeric columns keep their own width on a narrow sheet. */}
                  <td className="w-full px-3 py-1.5 first:pl-0 last:pr-0">
                    <span className="font-sans">{line.description}</span>
                  </td>
                  <td className={TD}>{line.quantity}</td>
                  <td className={TD}>{line.unit}</td>
                  <td className={TD}>{amount(line.unitPriceNet)}</td>
                  <td className={TD}>{amount(line.lineBaseAmount)}</td>
                  {/* A non-breaking space: "21 %" is one unit and must not break. */}
                  <td className={TD}>{line.vatRatePercent}&#160;%</td>
                  <td className={TD}>{doc.reverseCharge ? EM_DASH : amount(line.lineVatAmount)}</td>
                  <td className={TD}>{amount(line.lineGrossAmount)}</td>
                </tr>
              ))}
            </tbody>
          </SheetTable>
        </Section>

        {/* Rekapitulace DPH — the per-rate recap. `rateLabel` is already
            formatted by the kernel ("21 %" / "0 %") and is never recomposed.
            The rows are frozen and never reorder, so the index is a stable key
            (two rows can legitimately share a rate label across regimes). */}
        <Section title={t("print.vatRecap")}>
          <SheetTable>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className={`${TH_LEFT} w-full`}>
                  {t("print.colRate")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colBase")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colVat")}
                </th>
                <th scope="col" className={TH}>
                  {t("print.colGross")}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.vatRows.map((row, index) => (
                <tr key={index} className="border-b border-border/50">
                  <td className={TD_LEFT}>{row.rateLabel}</td>
                  <td className={TD}>{amount(row.baseAmount)}</td>
                  <td className={TD}>{amount(row.vatAmount)}</td>
                  <td className={TD}>{amount(row.grossAmount)}</td>
                </tr>
              ))}
            </tbody>
          </SheetTable>

          {/* Totals. `roundingAmount` is null unless the kernel actually rounded
              (§36 odst. 5), so it is rendered only when it applies — an absent
              rounding is "does not apply", not a missing mandatory field. */}
          {/* Sized to its content and right-aligned rather than a fixed `w-1/2`:
              a nowrap amount wider than half the sheet would otherwise push the
              body out at phone widths, the same defect as the item table. */}
          <table className="mt-4 ml-auto w-fit max-w-full font-data text-sm tabular-nums">
            <tbody>
              <tr>
                <td className="py-0.5 pr-6">{t("print.subtotalBase")}</td>
                <td className="py-0.5 text-right whitespace-nowrap">{amount(doc.subtotalBase)}</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-6">{t("print.vatTotal")}</td>
                <td className="py-0.5 text-right whitespace-nowrap">{amount(doc.vatTotal)}</td>
              </tr>
              {doc.roundingAmount !== null && (
                <tr>
                  <td className="py-0.5 pr-6">{t("print.rounding")}</td>
                  <td className="py-0.5 text-right whitespace-nowrap">
                    {amount(doc.roundingAmount)}
                  </td>
                </tr>
              )}
              <tr className="border-t border-border">
                <td className="pt-2 pr-6 font-medium">{t("print.total")}</td>
                <td className="pt-2 text-right text-base font-semibold whitespace-nowrap text-copper">
                  {amount(doc.totalAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* The CZK recap of a foreign-currency document. These three amounts are
            in CZK by construction (the labels say so), so they are NOT suffixed
            with `doc.currency` — that would state the wrong currency. */}
        {doc.exchangeRateLabel !== null && (
          <section className="mb-8">
            <KeyValueList className="ml-auto max-w-md text-sm">
              <KeyValueList.Row label={t("print.exchangeRate")}>
                {doc.exchangeRateLabel}
              </KeyValueList.Row>
              {doc.subtotalBaseCzk !== null && (
                <KeyValueList.Row label={t("print.subtotalBaseCzk")}>
                  {doc.subtotalBaseCzk}
                </KeyValueList.Row>
              )}
              {doc.vatTotalCzk !== null && (
                <KeyValueList.Row label={t("print.vatTotalCzk")}>
                  {doc.vatTotalCzk}
                </KeyValueList.Row>
              )}
              {doc.totalCzk !== null && (
                <KeyValueList.Row label={t("print.totalCzk")}>{doc.totalCzk}</KeyValueList.Row>
              )}
            </KeyValueList>
          </section>
        )}

        {/* The §92e legend — kernel-owned mandatory text, printed VERBATIM from
            the payload. Never composed, never translated, never conditioned on
            anything but this field. */}
        {doc.reverseChargeLegend !== null && (
          <p className="mt-3 rounded-md bg-field p-3 text-sm text-foreground">
            {doc.reverseChargeLegend}
          </p>
        )}

        {/* Structurally always null today (v1 issues no opravné daňové doklady),
            but it is FROZEN document content: the sheet never silently drops it. */}
        {doc.correctsNumber !== null && (
          <DocLine label={t("print.correctsNumber")}>{doc.correctsNumber}</DocLine>
        )}

        {doc.note !== null && (
          <section className="mt-6">
            <h2 className="mb-1 font-display text-xs tracking-wide text-muted-foreground uppercase">
              {t("print.note")}
            </h2>
            <p className="text-sm">{doc.note}</p>
          </section>
        )}

        <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
          {t("print.issuedBy", { system: doc.issuingSystem })}
        </footer>
      </article>
    </main>
  );
}
