---
type: design-handout
created: 2026-07-14
updated: 2026-07-14 (v2 — full product + feature rewrite; grounded in code at HEAD `f6ca707` + the release corpus)
audience: the Claude Design project — paste this whole doc as product context
---

# Design handout — Perimetra

## How to read this doc

- **The feature inventory is the truth.** Everything tagged is engineering-verified (code or the release plan), not aspiration.
- **The current implemented UI, routes, and layouts carry NO design authority.** They are low-fi/throwaway. Do not fit new screens to existing ones — design from the product, domain, and features below. **Design owns IA, navigation, layout, flows' presentation, and interaction entirely.**
- What design must NOT change: domain truths (states, price-blindness rules, legal fixtures, what data exists), the settled brand tokens, and the constraints section.
- Status legend: **NOW** = works today (end-to-end unless noted) · **BUILDING** = current build cycle · **V1** = planned before first paying use · **LATER** = post-v1 · **NO** = deliberately not planned · **(open)** = undecided, do not pre-empt.

## What Perimetra is

A vertical **CPQ (configure–price–quote) SaaS for SMB fence/gate/garage-door fabricators** (CZ/SK first, DACH later): the path from "customer wants a gate" → valid-only configuration with a live 3D preview and live price → legally sound Czech quote (nabídka) → order → invoice → cash — plus the price-blind production documents the workshop builds from.

- **The wedge vs the status quo (Excel + manual quoting + paper travelers):** an opinionated **model-as-data engine** — product families are authored as data (no six-figure CAD-automation projects), configurations are valid-only by construction, and every quote is **byte-identically reproducible forever** (invariant "I3": a frozen quote re-derives the same totals, tax, and drawing years later). Reproducibility is a *trust feature* — it is what makes the quote a document a fabricator can stand behind.
- **Positioning:** category king of perimeter fabrication for the SMB segment. Enterprise CPQ (Tacton, Configit, DriveWorks, KBMax, Salesforce CPQ) is calibration, not the identity — no SMB-affordable competitor combines data-authored models + reproducibility + production documents.
- **Tenant #1: FIL** (Bartek Vrata s.r.o., CZ gate/fence fabricator) — domain/design partner, not yet paying. First revenue = FIL running real quotes through the daily loop. Pipeline: KRUZIK + others.
- **Money model (v1):** no payment gateway — Czech SMB reality is **bank transfer + QR platba + manual "mark paid"**. Perimetra invoices are the fabricator's invoices to *their* customers (product billing), separate from Perimetra's own SaaS subscription (a stub today).
- v1 ships **standalone** (own auth); joining the wider product family (Cardo single sign-on) is explicitly post-v1.

## Brand state — SETTLED (unlike the feature UI, this is fixed)

**The repo design system is the brand truth:** Chillax (display) / Synonym (body) / Amulya (data) + Geist Mono, as font-role tokens; tokens in `tooling/tailwind-config/theme.css`; kit in `packages/ui` (16 components). Canonical design-system project: **"Perimetra Design System"** on claude.ai (synced via /design-sync 2026-07-14 — real components, verified previews). The old IBM Plex "Perimetra" project is deprecated reference only. Prototype/click-through work goes in a separate NEW project. Design works WITH these tokens/components — gaps get filled (spacing/state colors), not replaced.

## Users

- **Sales rep / owner** (fabricator staff): configures with or for a customer, issues quotes, watches margins, manages orders. Desk AND on-site — **tablet in the field is a real context**.
- **Workshop staff:** consume **price-blind** production documents (traveler, cut list, technical drawings). Print-first. Price-blindness is a hard product rule, not a permission toggle — no price exists on these surfaces for anyone.
- **End customer:** receives the branded quote via a public share link (accept/decline online), later the quote PDF; pays by transfer/QR.
- **Admin/owner:** margin-floor overrides (audited), cancellations/exceptions, mark-paid, org/team settings.
- **Platform operator** (Martin, cross-tenant): authors product-model releases in a structured editor and assigns them to tenants — a real authoring console, see below.

## Domain vocabulary (design will meet these words)

**nabídka** (quote) · **poptávka** (lead/inquiry) · **release / catalog / price table** (the versioned, immutable model trio every price derives from) · **UiSpec** (the authored wizard definition driving the configurator) · **frozen snapshot** (an issued quote's complete, immutable derivation record) · **I3 reproducibility** (byte-identical re-derivation) · **margin floor** (min-margin guard with audited override) · **deviation / exception ledger** (recorded departures from the catalog — sell-time overrides, margin overrides, order exceptions) · **traveler / průvodka** (workshop job sheet) · **§92e** (construction reverse-charge VAT) · **DUZP, DPH, QR platba/SPAYD, zálohová faktura** (CZ invoicing terms).

## Feature inventory

### Configurator + 3D (the signature surface)
- **NOW:** UiSpec-driven guided wizard (steps/groups, conditional visibility); **four modeled product families** — swing gate, sliding gate, branka (wicket), fence run; live price on every input against versioned catalog+price data; **live 3D preview** (R3F) with exploded view, section-plane cut, deviation markers, real profile geometry and finishes; **auto-derived 2D dimensioned technical drawing**; sell-time deviation/override authoring with reasons; save-configuration-into-project (site); engine rejections rendered as typed, human-readable **Czech** issues at the point of sale.
- **BUILDING (v1 scope, data-blocked):** motorization (CAR-189) and multi-material (CAR-190) — waiting on FIL's motor/material catalogs; do not design around guessed data.
- **V1:** výplet (infill) spacing golden-lock (CAR-69). **LATER:** garage-door family (v1.1), tablet-optimized on-site mode, compatible add-on upsell, static photo-composite visualization. **NO:** camera-based AR (affirmed do-not-build).
- Design owns the **chrome** around the 3D viewport (option rails, steps, price display, validation feedback) — never the scene's geometry/materials (model-truth, separately taste-gated).

### Vendor authoring console (platform-operator surface — exists, rarely seen)
- **NOW:** structured release editor with workbenches (identity/parameters/parts/constraints/derived values), autosaving drafts, and a live preview tab running the real engine in a web worker; immutable publish with validation gates; versioned immutable catalogs and price tables (CZK/EUR, effective-date windows); cross-tenant release assignment + version pinning.

### Pricing
- **NOW:** catalog-resolved BOM pricing with separate price/cost overlays (cost never leaks into sell totals); **gross-margin floor** blocking quote issue below the org's floor, with an audited admin override; org-configurable rounding policy; per-VAT-rate tax breakdown incl. **§92e reverse-charge** modeled as a distinct document mode; **ARES/VIES lookup** (IČO → identity autofill, DIČ validity).
- **V1:** VAT rates as catalog data via the shared CZ tax kernel (CAR-192); fuller free-form price flexibility (partial today — an Excel-parity adoption risk). **LATER:** tiered dealer pricing.

### Quotes
- **NOW:** issue → immutable frozen snapshot; states draft/issued/accepted/declined (+ derived expiry); **revision/supersession chains** (a revision supersedes its predecessor atomically; superseded quotes still render, with actions gated); public **buyer share link** — customer views, accepts, or declines online without an account; reproducibility verification (re-derive and byte-compare any frozen quote).
- **V1 (missing today, hard floor gap):** the **branded customer-facing quote PDF** (CAR-191) — the signature artifact the fabricator's customer holds: customer prices, org branding, validity, the technical drawing. **LATER:** e-signature (deposit/handshake substitutes in v1).

### Order → cash
- **NOW (fresh — shipped this cycle):** **order** as a thin reference over the accepted quote's frozen snapshot; state machine `confirmed → in_production → completed` (+ admin cancel with reason); order re-point to a newer quote revision (pre-production only — once in production, changes go through the exception ledger, never a silent swap); **deviation/exception ledger** with a recurrence report (recurring one-off deviations surface as candidates to become real catalog options); shared gapless document numbering.
- **BUILDING:** invoicing domain (invoice entity + lifecycle + mark-paid) — the CZ tax math comes from a **shared platform tax kernel**, deliberately not re-derived here; workshop web surfaces re-keyed from quotes to orders.
- **V1:** §29 invoice; **deposit/proforma flow** (zálohová faktura — today unrepresentable, an accountant must-answer shaping it); correction-document rule; §92e invoicing; **QR platba (SPAYD)**; manual mark-paid. **(open):** ISDOC export (conditional on the accountant). **LATER:** Pohoda export, SK e-invoicing (2027, second-tenant driver), discount-approval workflow.

### Production documents (price-blind, print-first)
- **NOW:** printable **workshop traveler** projected off the frozen snapshot through an allowlist that strips every commercial field; **cut list**; frozen **technical drawings** with spec + dimension tables.
- **V1 (stretch):** cut-list JSON/CSV export. **LATER:** live shop-floor status board, capacity/material planning. **NO:** barcode/per-station MES (over-scoped for 5–50-person shops).

### Site canvas (differentiator — ahead of every direct competitor found)
- **NOW:** a plan editor: place multiple configured instances on a site, connect them port-to-port (a shared post between two fence runs is deduplicated), stepped terrain per segment, **aggregate BOM + price across the whole site**, and issue a quote directly from the plan. Planner-tool interaction patterns apply (kitchen/floor planners).

### Leads & public funnel
- **ABSENT today — nothing is deployed and the old stub was deliberately removed.** The only public surface is the post-quote buyer link.
- **V1:** leads inbox (**poptávky**) + convert-to-project (CAR-125); the public embeddable instant-price configurator for the fabricator's own website (engine ready; deployment-gated). **v1.1:** the `/k` guided-selling funnel (design-double-gated). **LATER:** CRM pipeline + quote analytics.

### Customers & projects
- **NOW:** customer management with per-rep ownership (admin sees org-wide), GDPR-wrapped PII with anonymize-only erasure (issued quotes must keep re-deriving), DIČ-driven tax-mode decisions; projects = customer + a site plan, with archive/soft-delete.

### Tenancy, settings, platform
- **NOW:** per-org legal/tax profile (the fabricator's invoicing identity); auto org provisioning on first user; team invites/roles; two-factor auth; roles **admin / sales / workshop** (workshop = price-blind, no member management) + the cross-tenant platform-operator tier; GDPR export/erasure; audit log + retention sweep; realtime updates.
- **ABSENT today → LATER:** org branding settings, notification preferences/inbox, default quote-validity setting (validity is per-quote input now).
- **BUILDING (next):** the deploy spine — a hosted instance, backups, observability, FIL's org ("localhost is not v1"). **(open):** self-serve vs operator-provisioned onboarding. **LATER:** Sign-in-with-Cardo.

## Open product decisions — design must not pre-empt
Motors + multi-material model data (FIL catalogs pending) · the accountant pass shaping deposit/proforma representability, correction documents, DUZP, ISDOC · hosting/region (blocks deploy) · onboarding model · anonymous public catalog entry · model-truth review of gate geometry (Martin's eye) · the production-cutover flip (an explicit, non-removable go-gate).

## Constraints (non-negotiable)

- **Brand tokens + fonts are FIXED** (see Brand state); own component kit — no shadcn/ui, no generic AI look; components feed the shared portfolio kit.
- **3D scene contents are out of design scope** — chrome/HUD only.
- **Price-blindness on workshop surfaces is a hard rule** — no design may surface price, margin, or commercial deviation fields there.
- Print surfaces (traveler, drawings, quote PDF) must work monochrome and paginate cleanly; they carry the brand quietly.
- Responsive with a serious tablet layout (on-site reps); 44 px coarse-pointer floors enforced in code.
- Czech typography (diacritics at all weights), cs-first labels; accessibility (focus, contrast, semantics).
- Legal/invoice wording comes from the statutory kernel + lawyer track — design the layout shell, never the copy.

## Suggested design coverage order (gaps first)
1. Order→cash surfaces (order detail + state timeline, quote revisions/supersession, exceptions/ledger) — **being built right now, zero design coverage**
2. The branded customer quote PDF (V1 signature artifact)
3. Configurator chrome (option rail, steps, price, validation) — the signature interactive surface
4. Site canvas chrome (no coverage at all)
5. Leads inbox + public configurator (V1, greenfield)

---

## Per-feature addendum template (fill one per design request)

```
Product: Perimetra (master handout attached)
Surface/feature: <name, e.g. "order detail — state timeline">
User + moment: <who, doing what, device (desk / tablet-on-site / print)>
Domain truth (FIXED): <states/fields/price-blindness/legal fixtures that must exist>
Data on screen: <real field list + realistic Czech example values>
States: <empty / loading / invalid-config / error / edge>
References: <the curated shots for THIS surface>
Constraints: <brand tokens, viewport boundaries, print rules>
Deliverable: <direction board | tokens | screen(s) | component spec>
```
