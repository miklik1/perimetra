/**
 * The inline print stylesheet every printable document shares — the nabídka
 * (ADR 0087) and the workshop traveler (ADR 0108).
 *
 * Inline is deliberate: the strict CSP allows `style-src 'self' 'unsafe-inline'`,
 * and `@page` cannot be expressed as a Tailwind utility.
 */

/** Light-theme values of every design token a printed sheet paints with, lifted
 *  from `tooling/tailwind-config/theme.css`'s `:root` block. Kept in lockstep with
 *  it: a token that gains a new light value there must gain it here, or a
 *  dark-themed print silently reverts to the dark value for that one token. */
const LIGHT_TOKENS = `
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.21 0.006 285.885);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.21 0.006 285.885);
  --color-muted-foreground: oklch(0.552 0.016 285.938);
  --color-border: oklch(0.92 0.004 286.32);
  --color-field: oklch(0.9461 0 89.88);
  --color-field-raised: oklch(0.9551 0 89.88);
  --color-chrome: oklch(1 0 0);
  --color-chrome-foreground: oklch(0.21 0.006 285.885);
  --color-chrome-subtle: oklch(0.9791 0 89.88);
  --color-copper: oklch(0.618 0.1171 60.4);
  --color-copper-foreground: oklch(0.99 0 0);
`;

export interface PrintSheetStyleProps {
  /** The `@page` margin shorthand, e.g. `"16mm 14mm"`. */
  margin: string;
  /** Document-specific print rules (e.g. per-row break-inside), appended verbatim
   *  INSIDE the `@media print` block. */
  extra?: string;
}

/**
 * `@page` geometry, the screen-only toolbar toggle, and the dark-theme reset.
 *
 * The dark reset is load-bearing, not cosmetic. The no-FOUC script in the root
 * layout stamps `.dark` on `<html>` from `localStorage.theme` or, under the
 * default `system` setting, from `prefers-color-scheme: dark` — and that class
 * survives into the print DOM. Browsers honour a printed element's CSS `color`
 * but suppress its background, so a sheet rendered under the dark tokens prints
 * near-white ink onto white paper: a blank-looking page. Restoring the light
 * token values for print (and pinning `color-scheme`) keeps the sheet legible
 * regardless of the operator's theme. Screen rendering is untouched.
 */
export function PrintSheetStyle({ margin, extra }: PrintSheetStyleProps) {
  return (
    <style>{`
@page { size: A4; margin: ${margin}; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff; }
  :root, .dark { color-scheme: light; }
  .dark {${LIGHT_TOKENS}  }
${extra ?? ""}
}
`}</style>
  );
}
