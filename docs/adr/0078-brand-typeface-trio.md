# ADR 0078 — Brand typeface trio (Chillax / Synonym / Amulya)

**Status:** Accepted (2026-06-25 — Martin supplied the typeface pairing).
**Implementation:** Implemented (the real fonts replace the ADR 0072 "one
geometric sans" placeholder; applied configurator-first across `packages/ui` +
the configurator/site surfaces).

## Context

ADR 0072 shipped the brand design system but stood in **Geist Sans** as a "one
geometric sans" typography placeholder, with only a `--text-display` _scale_
token — no font-family tokens. The Bombardier brand-extraction Part-A hierarchy
(vault `2026-06-23 Brand design extraction`) calls for editorial display-scale
type with a clear three-role split: a characterful display face, a humanist body
face, and a mechanical face for data/numerics. Martin chose the Fontshare
pairing and downloaded the complete families.

Constraints:

- **CSP-clean, app origin only** — the same `font-src 'self'` constraint that
  blocks drei's HDR preset CDN (ADR 0074). No external font host, no CDN link.
- **One token source of truth** (ADR 0072/0004) — font roles join the shared
  `@theme` token layer, not a parallel system; web + mobile read the same names.
- The trio must carry **Czech** (full diacritic set: ě š č ř ž ý á í é ú ů ď ť ň).

## Decision

**Self-host three variable woff2 via `next/font/local`** (`apps/web/app/fonts/`,
served from `/_next/static/media/` — app origin, CSP-clean) and bind them to
**role-named font tokens in the shared `@theme` file**:

| Role token       | Face       | Axis      | Where                                        |
| ---------------- | ---------- | --------- | -------------------------------------------- |
| `--font-sans`    | Synonym    | 200 → 700 | body / UI text — the default (`font-sans`)   |
| `--font-display` | Chillax    | 200 → 700 | display / step labels / headings             |
| `--font-data`    | Amulya     | 300 → 700 | data labels / numeric emphasis (`font-data`) |
| `--font-mono`    | Geist Mono | —         | code / mono UI (kept; no brand mono)         |

Each token resolves `var(--font-<face>, "<Face>")` — the next/font CSS variable
when present (web; declared on `<body>` in `layout.tsx`), falling back to the
literal family name otherwise (mobile expo-font / no-JS). Custom-property
substitution is **lazy/contextual**, so the body-scoped next/font variable is in
scope wherever the tokens/utilities are consumed below it — no `@theme inline`
needed, and `--font-mono` now actually resolves to Geist Mono (it previously
fell through to the Tailwind default).

**Application** (configurator-first, the ADR 0072 pattern):

- Body defaults to Synonym (`font-sans` on `<body>`).
- Every heading (`h1`–`h6`) gets Chillax via a `globals.css` base-layer rule;
  `DisplayLabel` sets `font-display` explicitly (it can render as `p`/`span`,
  which the heading rule wouldn't reach).
- `Badge` and the data grids / BOM tables / spec rows / data pills across the
  configurator + site results carry `font-data` (Amulya) — the numeric/label
  role. The brand wordmark in the configurator header takes `font-display`.

## Consequences

- **One variable file per face** (~32–56 KB woff2, ~127 KB total) spans each
  full weight axis — no per-weight static files. next/font emits a
  metric-adjusted `Fallback` face per family for free (reduces CLS).
- Licensed under the **Fontshare Free Font EULA** (ITF FFL — free commercial
  use in any media incl. Web; self-hosting woff2 is the blessed path; no
  modification). License copied to `apps/web/app/fonts/FONT-LICENSE-fontshare-FFL.txt`.
- Verified: a base64-embedded type specimen captured headless (Playwright +
  SwiftShader) confirms all three faces render distinctly with full Czech
  diacritic coverage, and the built web CSS confirms the pipeline (three
  `@font-face` families + `Fallback`s, the `--font-*` variables, and the
  `.font-display`/`.font-data` utilities generated from the shared tokens).
- **Render-taste pass owed to Martin** (not a build blocker): display weight
  (Chillax 300 vs 400), the trio's pairing balance, Amulya's weight at small
  data sizes, and copper-vs-amber once on a lit 3D render. A shareable specimen
  artifact was produced for that pass.

Related: ADR 0072 (the brand system this completes), ADR 0004 (the shared token
file), ADR 0074 (the same CSP `font-src 'self'` constraint); vault
`2026-06-23 Brand design extraction — Bombardier` Part A.
