# ADR 0127 — Phase A Wave A1: the invoice surface (ADR 0112's O2-c)

**Status:** Accepted (2026-07-24 — Phase A, Wave A1). Follows [ADR 0126](0126-phase-a-wave0-legal-tenancy-repairs.md) (Wave 0) and closes the last open slice of [ADR 0112](0112-invoice-frozen-document-class-and-tax-cz-seam.md).

## Context

The invoice backend shipped complete and byte-reproducible: `POST /v1/invoices` freezes a §29 daňový doklad from an order, `POST /:id/verify` re-derives it, payment is row state, per-rep ownership was tightened in Wave 0. And it was **unreachable from the product** — no route in `packages/navigation`, no entry in the app-shell nav, no query factory, no list, no detail, no print surface. A tax document nobody can open is not a shipped feature.

A1 makes it reachable: a route + nav entry, a `/invoices` list with the "issue from an order" action, an `/invoices/:id` detail carrying the payment and I3-trust panels, and an `/invoices/:id/faktura` print sheet. This ADR records the decisions those surfaces rest on; the deviations below are load-bearing and are stated as such.

## Decision

### 1. What A1 makes reachable — and what it deliberately does not

**Built:** the typed routes (`invoices`, `invoice`), the `/invoices` protected prefix, the nav entry (admin/sales), the query factory, the MSW handlers, the list, the issue panel, the detail (payment + supersession + I3 verify), the chromeless print sheet, and ONE new api read — `GET /v1/invoices/:id/document`.

**Not built, deliberately, and not a subtraction anyone should read as a gap being denied:** ISDOC / Pohoda / UBL export; the §28 advance chain; opravné daňové doklady (corrective documents); QR platba / SPAYD; a leads module; an `/orders/:id` detail surface; e-mail delivery of the document (Wave A2).

**Reported, not built** (each is a real want with a real cost, named here so it is not re-discovered as a bug):

- a nav count pill for unpaid invoices — it would widen `NavCountKey`, `navCountsResponseSchema`, `NavCounts`/`forCaller` and `NavModule`, and whether such a count is honest (and whether it must be per-rep narrowed) is unsettled. `leads` is the standing precedent for a reserved-but-never-emitted pill: an unbacked pill is worse than none;
- the dashboard revenue KPI — [ADR 0125](0125-wave-d-dashboard.md) subtracted it because "invoices are not adoption-wired". A1 removes that reason, but re-adding it would red `e2e/dashboard-smoke.spec.ts:47`/`:79-86` and widen `DashboardSummary`, so it is a separate slice;
- the order number on the invoice detail — it needs `GET /v1/orders/:id`, which is not in the MSW orders group; zero legal value for a shared-file edit;
- the §21 `ratePctOverride` / `modeOverride` and explicit `issuedOn`/`duzp`/`dueOn` in the issue form — accountant-gated legal semantics (CAR-27 pass 2 has not run) with correct-by-construction server defaults;
- `/quotes/:id/nabidka` is still FRAMED by the AppShell (the rails carry no `.no-print` class), so app chrome bleeds onto that A4. A pre-existing defect. A1 does not replicate it (the invoice sheet is chromeless) and does not fix it.

### 2. `DEVIATION:` `packages/renderers` gains NO invoice module

A literal reading of "extend the pure-data renderer split ([ADR 0086](0086-customer-identity-snapshot-freeze.md)/[0087](0087-nabidka-print-surface.md)/[0088](0088-org-legal-profile.md)/[0108](0108-workshop-traveler-frozen-technical-drawing.md)) to the invoice" would put an invoice renderer beside `buildNabidka`. It must not. Every renderer in that package is a pure function of `(Site, SiteResult)` — **engine provenance**. The invoice's provenance is a **frozen kernel document** whose types the web may not even import. The pure-data document layer is therefore the kernel's own `buildPdfViewModel`, exposed through a new zod-validated api read. Same architecture (pure data in, dumb layout surface out), different home, for a reason that is structural rather than stylistic.

### 3. The web never imports `@cardo/tax-cz` — any subpath

`@cardo/tax-cz/export`'s index eagerly constructs the ISDOC/Pohoda/UBL exporters at module scope and therefore pulls native `libxmljs2` + `saxon-js`. It is declared as an `apps/api` dependency and stays one. The consequence is the whole shape of this wave: the document layer is **served, not shipped**. Where a surface needs a kernel-derived value it gets a wire field, never a kernel import.

### 4. `supplierEmail` has no data source at all

Constraint 4 of this wave said the field "must not be read live". The stronger truth: **there is nothing to read.** `legalProfileSchema` (`packages/validators/src/legal-profiles.ts`) carries no e-mail field, and `packages/db/src/schema/legal-profiles/index.ts:14-17` records that a contact field would have to go through `pii()` — the table has no such column. `null` is the only honest value; the sheet prints `—`. That is the [ADR 0108](0108-workshop-traveler-frozen-technical-drawing.md) precedent: **absence, never a masked value.**

### 5. `issuingSystem` is the constant `Perimetra`

A build-time platform fact, not a live read of tenant or profile data, and not a §29 field. The other four `ExportableIssuer` fields (`isVatPayer`, `anonymousIdScheme`, `exportApplication`, `exportNote`) are structurally required by the interface and **never read** by `buildPdfViewModel` — they exist for the XML export seam this repo does not call. A test pins that none of their placeholder strings reaches the wire.

### 6. The new endpoint's PII exposure is unchanged in kind

`GET /v1/invoices/:id/document` returns a **strict subset** of what the already-shipped `GET /v1/invoices/:id` returns (`snapshot: z.unknown()` = the whole `ExportableDocument` verbatim). Dropped on the way through `buildPdfViewModel`: `snapshot.id`, the raw `type`, `buyerEmail`, every discrete supplier/buyer address component, `buyerPeppol`, and per-line `regime` / `khSubjectCode` / `foreign*Cents`. Also absent: row state (`status`, `paidAt`, `paidNote`, `supersededById`) — payment is row state, never document content (ADR 0112 §5); putting it on the document layer would let a "PAID" stamp leak onto a frozen §29 sheet.

The known **`pii()`-registry / privacy-handler gap** on `invoice.facts`/`snapshot` (ADR 0126 follow-up #2, governed by [ADR 0071](0071-immutable-snapshot-pii-retention.md); see the module `CONTEXT.md`) is explicitly OUT OF SCOPE here. A1 neither fixes it nor makes it worse.

### 7. The first runtime zod mirror of `ExportableDocument`

`apps/api/src/modules/invoices/exportable-document.ts` is the first runtime schema for either of this module's JSONB columns. It is a hand-kept mirror of a KERNEL type, and it lives in the api module rather than `@repo/validators` deliberately: it mirrors a type only `apps/api` may import, and it is a parse guard over stored bytes, not an api↔web wire contract. The lockstep obligation is the same precedent as `invoicePaymentMethodSchema` and the `OrgRole` tuple — and `paymentMethod` REUSES `invoicePaymentMethodSchema` so there is exactly one payment-method vocabulary.

It re-derives **no** tax, legend or format logic. Two details are load-bearing:

- the dates are validated as plain strings, **not** `isoDate`. The guard exists to prove the payload is STRUCTURALLY buildable; a stricter format check here would turn a legitimately-frozen historical document into a 422. The response schema re-validates the format on the way out, where refusing is safe;
- zod's default STRIP semantics are correct: an older frozen document may carry keys this mirror does not know, and dropping them from the parsed COPY changes nothing the view model reads (it never mutates the stored row).

The wire contract (`invoiceDocumentSchema` in `packages/validators/src/invoices.ts`) is pinned to the kernel view model by a **compile-time mutual-assignability proof** in `invoice-document.ts`: `Mutual<InvoiceDocument, PdfViewModel>` resolves to `InvoiceDocument` only while the two are mutually assignable and to `never` otherwise, so a kernel field added, removed or renamed fails the BUILD rather than silently becoming a stripped response field. (Verified by planting a drift field: `Type 'PdfViewModel' is not assignable to type 'never'`.)

### 8. Fail closed: 422 `invoice_document_unreadable`

A frozen payload that will not parse returns **HTTP 422** with `{ message, code: "invoice_document_unreadable" }`. Never a partial document, never a `null`-filled one, never a 200 with missing fields — ADR 0126's inversion rule: on a §29 daňový doklad a missing field is a DEFECT, not honest subtraction.

- **Not 404:** the row exists and this caller may read it. Claiming non-existence would be a lie and would corrupt the "404 is not an existence oracle" contract that the per-rep narrowing depends on.
- **Not 500:** an opaque server error is un-actionable and un-renderable; this module's whole vocabulary of refusals is a typed 422 + `code`.
- The `reason` carried on the pure result is a zod **path** only, never a value — no buyer data may reach a log line or an error body (pinned by a test).
- The print RSC turns any failure (401/403/404/422/parse) into `notFound()`, so a broken document never half-renders a §29 sheet in a browser.

Per-rep ownership is unchanged and un-widened: the read runs through the existing `scopeOpts(role)` (`{restrictToOwner: role !== "admin"}`, [ADR 0082](0082-customer-entity-per-rep-ownership.md)/ADR 0126 §5), reusing `findById` — no new repository query, no new scope variant, and never `findByIdSystem` (worker-only). Another rep's invoice **404s, never 403s**, pinned in both the unit and the integration suite.

### 9. The document reads `snapshot.currency`, never the `invoice.currency` column

They can disagree today: `InvoiceMapperInput.currency` is declared and never read, so `buildInvoice` hardcodes `CZK` while the row stores the price table's currency (which may be `EUR`). This is a **pre-existing latent divergence**, not introduced by A1. A1 does not fix it — it avoids it: the document endpoint reads the frozen value by construction (it comes out of `buildPdfViewModel`), so the sheet prints the currency the tax document actually claims. Named here so the mapper fix, when it comes, is a deliberate act.

### 10. `DEVIATION:` the print route is `/invoices/:id/faktura`

The `/quotes/:id/nabidka` precedent names a print route after the Czech document it prints. _Faktura_ is the everyday Czech name for the §29 daňový doklad and matches the number-series prefix `FV`, whereas `/danovy-doklad` would put a legal-classification claim in the URL that the CAR-27 accountant pass has not yet returned. The app shell's single-suffix `PRINT_SUFFIX` check becomes `PRINT_SUFFIXES` (a list) so the sheet renders CHROMELESS — the rails carry no `.no-print` class, so a framed print route bleeds app chrome onto the A4.

### 11. `DEVIATION:` "issue invoice from order" lives on `/invoices`

Not on a detail surface. It is a page-level action on the invoices LIST, opening an inline panel whose order picker rides the already-shipped `GET /v1/orders`. Every alternative needs a new endpoint or an edit to a shipped surface:

- an "invoiceable orders" filter needs a cross-module read (which orders already have a live invoice) that `OrdersModule` cannot perform — `InvoicesModule` imports `OrdersModule`, so the reverse edge is a DAG cycle;
- a quote-detail action needs `orderId` on `quoteSchema` (it carries none), i.e. a quotes contract + service + repository change plus an edit to the hottest shipped detail surface.

The server stays the authority with typed refusals — which is exactly ADR 0126's governing rule. "One live invoice per order" is a structural DB guarantee (`invoice_order_active_uq`), so re-picking an already-invoiced order returns a deterministic 409 `invoice_exists`, rendered as a NAMED, actionable refusal. A cancelled order is filtered out client-side, mirroring the api's own `order_cancelled` guard so the picker never advertises a dead end. No other pre-filter is attempted: a best-effort filter against the loaded invoice pages would be keyset-bounded and wrong for a sales rep (whose invoice list is owner-narrowed), and a filter that is right only sometimes is worse than none.

### 12. `DEVIATION:` §29-mandatory nullable fields render a labelled `—`

The nabídka idiom omits an absent field. The sheet does not, for the fields §29 makes mandatory (`supplierDic`, `supplierBankAccount`, `supplierIban`, `supplierEmail`, `buyerIco`, `buyerDic`, `dueDate`): a missing field on a daňový doklad is a DEFECT that must be VISIBLE (ADR 0126's inversion rule + the ADR-0108 "absence, not masking" precedent). Fields whose null means "does not apply" (`roundingAmount`, the FX block, `reverseChargeLegend`, `note`, `correctsNumber`) are still omitted when absent. The `—` is a literal in the component, never an i18n key.

### 13. PROVISIONAL (CAR-27 pass 2): money on the sheet is the kernel's format

Every amount on the print sheet is the kernel's `formatCents` output — dot-decimal, xsd:decimal canonical — rendered VERBATIM beside the frozen ISO currency code, never through `formatMoney`, never through `Number()`, never regrouped. Money formatting is kernel-owned (the 2026-07-14 no-duplication ruling); a web-side reformatter would be a second money path on a regulated document. Whether Czech money presentation (space grouping, comma decimal, "Kč") belongs on a daňový doklad is the accountant's question, not this wave's.

Consequently there are exactly two money formatters in the product and they never meet on one screen: `formatMoney` (cs-CZ) for values off the invoice ROW, on the list and the detail; the kernel's frozen strings on the print sheet. That is why the detail renders no line table, no VAT recapitulation and no §92e legend — an honest subtraction on a VIEW.

**No copy, comment or sentence anywhere in this wave claims legal correctness or compliance.** The accountant pass has not run; every PROVISIONAL flag already in the tree stays where it stands.

### 14. "Rekapitulace DPH" is correct HERE and only here

ADR 0126 §7 rejected that heading for the nabídka precisely because it is what Czech accounting software prints ON a daňový doklad. This sheet IS a daňový doklad, so the heading is right for the first time.

### 15. The dead `draft` quote status is removed — superseding ADR 0083:27-29

`draft` was provably unreachable: the only insert path hardcodes `status: "issued"`, the only mutation path's literal union is `"accepted" | "declined"`, and there is no DB artifact (`quote.status` is `text NOT NULL`, no default, no PG enum, no CHECK — `$type<QuoteStatus>()` is a TypeScript-only brand, and `drizzle-kit generate` against a scratch copy with `draft` removed emits "No schema changes, nothing to migrate"). No seed, factory, fixture, mock, itest or e2e ever wrote it.

This reverses ADR 0083:27-29's reservation ("`draft` is reserved for the future revision/draft-quote feature"). That reservation is spent: the revision half shipped differently ([ADR 0109](0109-order-domain-and-numbering.md)/CAR-158 — `revise()` mints a NEW `issued` row). Re-adding later costs one tuple entry and zero migration. Data risk zero (no row can exist); behaviour change zero (two dead branches collapse to what already ran); the contract change is real but honest (`GET /v1/quotes?status=draft` was an advertised filter that could never match).

**`quote_number_sequence` stays deferred.** ADR 0126 follow-up #5 defers both contract migrations because "both want a migration already in flight" — and A1 adds a read endpoint, a route and a print surface: no column, no table, no constraint. Nothing is in flight to ride. Worse, dropping it costs two of ADR 0112 §3's three named acceptance properties: `apps/api/test/numbering-consolidation.itest.ts` reads `migration.sql` off disk and re-executes `INSERT … SELECT … FROM "quote_number_sequence"`, which cannot be tested out of a table that no longer exists. ADR 0112:331 already certified the table "lingers (harmless)". It should land standalone, as its own commit plus a §-addendum to ADR 0112.

### 16. Date-only §29 fields render UTC-pinned — the ADR 0105 convention

`issuedOn`, `duzp` and `dueOn` are `isoDate` (`YYYY-MM-DD`): statutory CALENDAR days, never instants. They render through `formatCalendarDate` (`timeZone: "UTC"`), not `formatDate` — the [ADR 0105](0105-calendar-date-display-input-convention.md) rule, whose helper docblock names "an invoice date" as its case. Through plain `formatDate` a viewer west of UTC sees the previous day (JS parses `"2026-07-30"` as UTC midnight), so the detail titleband and the list would state a due date one day earlier than the frozen string the §29 sheet prints verbatim — on DUZP, the field that fixes the DPH period. The invoice surfaces are the web app's first `isoDate` consumers; every other web date (`createdAt`, `validUntil`, `paidAt`) is an `isoDatetime` instant and correctly stays on `formatDate`. The list cell and the detail titleband move together, so the two surfaces cannot disagree.

### 17. The order picker is complete, and states three answers rather than one

`GET /v1/orders` is keyset-paginated (20 per page, newest first) and a `<select>` carries no load-more affordance, so the issue panel follows the cursor to EXHAUSTION. Otherwise the order most likely to need invoicing — the oldest open one, behind twenty newer rows — has no `<option>` at all and is uninvoiceable from the UI with nothing on screen saying so; the client-side `cancelled` filter, which runs after the page slice, would compound it. (Server-side "invoiceable orders" filtering stays out of scope for the DAG reason in §11.)

And the panel branches three ways on the orders read: pending → `invoices.loading`, failure → the shared `errorMessageKey` `role="alert"` line, answered-empty → `invoices.issue.noOrders`. "Žádná zakázka k fakturaci." is a factual claim about the org's data and may not stand in for "still loading" or "the request failed" — ADR 0126's contract-honesty rule forbids asserting a state the backend has not backed. The "select one above" hint renders only WITH the picker, so it never points at a control that is not on screen. The shipped `site/issue-quote-panel.tsx` customers picker has both defects (single page, two-way branch); this is the pattern-level fix owed to it, reported not built here.

### 18. The sheet's tables scroll inside their own boundary, and its columns are separated

Both found by the eyes-on pass (×6 ship-bar widths × both themes, `apps/web/scripts/verify/capture-invoices.mjs`), not by any test — neither is expressible as an assertion the component suite could hold.

**The sheet overflowed the body by 253px at 390px, in both themes.** The nine-column item table is wider than a phone, so it pushed the document horizontally instead of scrolling within itself. The fix is the shipped o-LIST idiom (ADR 0121): a `relative min-w-0 overflow-x-auto` wrapper, with `min-w-0` carried down the WHOLE chain (the sheet `<article>` and each `Section`, not only the innermost box — the banked half of that lesson). The half that is specific to a printed document is `print:overflow-visible` on the wrapper: an `overflow-x-auto` box CLIPS on paper, and a clipped §29 daňový doklad would silently amputate its money columns. The A4 sheet has nothing to scroll on paper, so the scroll boundary exists for screens only. The totals table moved from a fixed `w-1/2` to `w-fit max-w-full` with non-wrapping amounts for the same reason.

**The columns collided — on the printed document.** With vertical padding only, adjacent cells butt together and the sheet reads `MnožstvíMJ`, `ZákladSazba`, `1 ks129891.50 CZK129891.50 CZK`. It was legible in neither theme and printed that way. Cells now carry horizontal padding, amounts/units/rates are `whitespace-nowrap` (an amount and its currency code are one unit), the rate uses a non-breaking space, and the description is the single prose column that takes the slack. The two sheet tables share one `SheetTable` component rather than repeating the wrapper.

The same collision appeared on the `/invoices` LIST at 390px (`ČÍSLO DOKLADUSTAV`, `7. 8. 2026157 168,72 Kč`). It is NOT purely inherited: `/quotes` at 390px was captured and does not collide, because its row is narrow enough that the browser's natural table spacing still separates the columns. An invoice row (document number + up to two badges + a date + a money total) is not, so the shared idiom degrades exactly here. The list cells gained `pr-4 last:pr-0` — the same list language with the spacing its content needs, not a second one. **The shipped o-LIST surfaces rely on natural table spacing and will degrade the same way as their rows grow** (a longer customer name, a second badge); making the separation part of the shared idiom is a cross-cutting slice, reported not built.

Related and NOT fixed here: the item table is tight on A4 because every money cell repeats the ISO currency code (`129891.50 CZK`). That is downstream of §13's PROVISIONAL money presentation — Czech practice states the currency once and formats `129 891,50 Kč` — so re-tuning column widths now would be tuning against a presentation the accountant pass is expected to change.

## Consequences

- **One new api route** (`GET /v1/invoices/:id/document`), two new pure api modules (`exportable-document.ts`, `invoice-document.ts`), one new wire contract (`invoiceDocumentSchema`). **No schema change, no migration, no new NestJS module, no new repository query, no change to `invoices.module.ts`.**
- The committed OpenAPI snapshot gains exactly one path with a `get`. Adding a controller route without regenerating it has shipped a stale snapshot before.
- `@repo/ui` stays domain-agnostic — every invoice-specific component lives in app-land (the `ExprField` / `TechnicalDrawingSvg` precedent).
- Follow-ups carried forward unchanged from ADR 0126: the revise-past-re-point reconciliation gap, the invoice `pii()` / privacy-handler slice (ADR 0071), `quote_not_accepted` / `margin_below_floor` context outside `details`, and the missing module `CONTEXT.md` files.
