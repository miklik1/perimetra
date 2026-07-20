"use client";

import * as React from "react";

import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DisplayLabel,
  EmptyState,
  Field,
  IconButton,
  IconCluster,
  Input,
  Pager,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedNav,
  SegmentedNavItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  Spinner,
  StatCard,
  StepNav,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toast,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui";
import { fieldInputClass, FieldShell, fieldTextareaClass } from "@repo/ui/forms/field-shell";

/**
 * The design-system gallery body (ADR 0111). Renders every token + kit primitive
 * so the whole system can be SEEN in one capture (light + dark). App-land, not a
 * kit export — it is a verification surface, like `/scene-lab`'s canvas host.
 *
 * As the new compound components land (SegmentedNav, StatCard, Field, Tabs,
 * Dialog, …) their sections are added here so the gallery stays the one place the
 * full kit is reviewed.
 */

// ── inline monoline icons (the app has no icon lib; scene-canvas uses inline SVG
//    too). ~2px stroke, rounded caps — the reference's icon grammar.
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden {...stroke}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}
function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden {...stroke}>
      <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
    </svg>
  );
}
function IconCube() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden {...stroke}>
      <path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zM12 20V11M20 6.5L12 11 4 6.5" />
    </svg>
  );
}
function IconPlane() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden {...stroke}>
      <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8L8 11l-3 3H3l2 3 3 2v-2l3-3 3.7 3.7a.5.5 0 0 0 .8-.5z" />
    </svg>
  );
}
function IconSeat() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden {...stroke}>
      <path d="M6 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M9 11V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6" />
    </svg>
  );
}
function IconPanels() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden {...stroke}>
      <rect x="3" y="3" width="7" height="18" rx="1" />
      <rect x="14" y="3" width="7" height="10" rx="1" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden {...stroke}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}
function IconArrowUpRight() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden {...stroke}>
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" />
    </svg>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title">{title}</h2>
        {hint ? <p className="text-muted-foreground max-w-2xl text-sm">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({
  label,
  usage,
  className,
  foreground,
}: {
  label: string;
  usage: string;
  className: string;
  foreground?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("rounded-card shadow-soft-sm flex h-20 items-end p-2", className)}>
        {foreground ? <span className={cn("font-data text-xs", foreground)}>Aa</span> : null}
      </div>
      <div className="flex flex-col">
        <span className="font-data text-xs font-semibold">{label}</span>
        <span className="text-muted-foreground text-xs">{usage}</span>
      </div>
    </div>
  );
}

/**
 * ── Token-family galleries (ADR 0114 §7.6) ───────────────────────────────────
 *
 * The spacing scale, the body-type ramp and the interaction-state ladder are
 * pure token vocabulary — nothing in the kit renders them, so without a surface
 * here they are undiscoverable, which is exactly the failure that let the design
 * canvas improvise 717 hardcoded literals. Each is a compound built on the same
 * idiom as the kit's own StatCard: a context COMPOSITION GUARD (carries no
 * value — it just makes a stray slot throw instead of rendering unstyled),
 * `Object.assign` for the namespace, `data-slot` for the capture harness.
 *
 * Every utility below is written as a LITERAL class string, never assembled from
 * a template. Tailwind's scanner reads source text, so a computed
 * `bg-${base}-hover` would emit no rule and the swatch would render empty.
 */
function useCompositionGuard(context: React.Context<boolean>, part: string): void {
  if (!React.use(context)) {
    throw new Error(`<${part}> must be rendered inside its parent.`);
  }
}

// ── Spacing scale ────────────────────────────────────────────────────────────
const SpacingScaleContext = React.createContext<boolean>(false);

function SpacingScaleRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <SpacingScaleContext value={true}>
      <div data-slot="spacing-scale" className={cn("flex flex-col gap-3", className)} {...props}>
        {children}
      </div>
    </SpacingScaleContext>
  );
}

/**
 * One rung. The bar's width IS the rung (`bar` is the literal `w-*` utility),
 * so the rhythm of the scale — dense 2px half-steps low, opening to 4px steps
 * above 16px — is legible by comparing bar lengths down the column.
 */
function SpacingScaleRung({
  token,
  px,
  bar,
  note,
}: {
  token: string;
  px: number;
  bar: string;
  note?: string;
}) {
  useCompositionGuard(SpacingScaleContext, "SpacingScale.Rung");
  return (
    <div data-slot="spacing-scale-rung" className="flex items-center gap-4">
      <span className="font-data w-24 shrink-0 text-xs font-semibold">{token}</span>
      <div className="flex w-24 shrink-0 items-center">
        <div className={cn("bg-copper h-3 rounded-full", bar)} />
      </div>
      <span className="font-data text-muted-foreground w-12 shrink-0 text-xs">{px}px</span>
      {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}
    </div>
  );
}

const SpacingScale = Object.assign(SpacingScaleRoot, { Rung: SpacingScaleRung });

// ── Body-type ramp ───────────────────────────────────────────────────────────
const TypeRampContext = React.createContext<boolean>(false);

function TypeRampRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <TypeRampContext value={true}>
      <div data-slot="type-ramp" className={cn("flex flex-col gap-4", className)} {...props}>
        {children}
      </div>
    </TypeRampContext>
  );
}

/**
 * One rung of the body ramp. `token` doubles as the applied `text-*` utility, so
 * the specimen is rendered AT the size it names. The specimen itself is a slot
 * (children) — every line is Czech and diacritic-dense on purpose: the brand
 * constraint is "Czech typography, diacritics at all weights", and háčky/čárky
 * are where a ramp's line-heights actually fail.
 */
function TypeRampSpecimen({
  token,
  size,
  children,
}: {
  token: string;
  size: string;
  children: React.ReactNode;
}) {
  useCompositionGuard(TypeRampContext, "TypeRamp.Specimen");
  return (
    <div
      data-slot="type-ramp-specimen"
      className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
    >
      <span className="font-data text-muted-foreground w-32 shrink-0 text-xs">
        <span className="text-foreground font-semibold">{token}</span> · {size}
      </span>
      <p className={cn("min-w-0", token)}>{children}</p>
    </div>
  );
}

const TypeRamp = Object.assign(TypeRampRoot, { Specimen: TypeRampSpecimen });

// ── Interaction states ───────────────────────────────────────────────────────
const StateLadderContext = React.createContext<boolean>(false);

function StateLadderRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <StateLadderContext value={true}>
      <div
        data-slot="state-ladder"
        className={cn("grid gap-5 sm:grid-cols-2", className)}
        {...props}
      >
        {children}
      </div>
    </StateLadderContext>
  );
}

/** A labelled group of adjacent state swatches for one base token. */
function StateLadderRow({ token, children }: { token: string; children: React.ReactNode }) {
  useCompositionGuard(StateLadderContext, "StateLadder.Row");
  return (
    <div data-slot="state-ladder-row" className="flex flex-col gap-2">
      <span className="font-data text-xs font-semibold">{token}</span>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

/**
 * One step of the ladder. Adjacent (gap-1) on purpose — hover sits 88% and
 * active 78% toward `--color-foreground`, and a separation that small only
 * reads when the swatches touch.
 */
function StateLadderStep({ state, className }: { state: string; className: string }) {
  useCompositionGuard(StateLadderContext, "StateLadder.Step");
  return (
    <div
      data-slot="state-ladder-step"
      className={cn("rounded-inset flex h-14 flex-1 items-end p-2", className)}
    >
      <span className="font-data text-ui-2xs">{state}</span>
    </div>
  );
}

const StateLadder = Object.assign(StateLadderRoot, {
  Row: StateLadderRow,
  Step: StateLadderStep,
});

/**
 * The spacing rungs — the utility suffix, px, the literal width utility, and the
 * role the theme file documents for it.
 *
 * These are NOT custom tokens: there is no `--spacing-*` in the theme file, by
 * design. Tailwind's built-in `--spacing: 0.25rem` base already generates every
 * rung the canvas needs, half-steps included, so the gallery documents the SNAP
 * RULE (canvas px → the utility you type) rather than a token vocabulary.
 * Naming them `--spacing-md` etc. would shadow Tailwind's `--container-*` scale
 * and collapse every `max-w-md`/`basis-lg` in the app — see the long warning in
 * tooling/tailwind-config/theme.css.
 */
const SPACING_RUNGS = [
  { token: "0.5", px: 2, bar: "w-0.5", note: "hairline · icon-to-label" },
  { token: "1", px: 4, bar: "w-1", note: "the base unit" },
  { token: "1.5", px: 6, bar: "w-1.5" },
  { token: "2", px: 8, bar: "w-2" },
  { token: "2.5", px: 10, bar: "w-2.5" },
  { token: "3", px: 12, bar: "w-3" },
  { token: "3.5", px: 14, bar: "w-3.5" },
  { token: "4", px: 16, bar: "w-4", note: "default panel/card inset" },
  { token: "5", px: 20, bar: "w-5" },
  { token: "6", px: 24, bar: "w-6" },
  { token: "7", px: 28, bar: "w-7" },
  { token: "8", px: 32, bar: "w-8", note: "section separation · top of scale" },
] as const;

/** The body ramp — token (= the applied utility), size/line-height, specimen. */
const TYPE_RUNGS = [
  ["text-ui-2xs", "10 / 14", "Příliš žluťoučký kůň úpěl ďábelské ódy"],
  ["text-ui-xs", "11 / 16", "Odchylka §6 — rozměr mimo standardní řadu"],
  ["text-ui-sm", "12 / 16", "Zákazník: Kovářství Ryšánek, Přeštice"],
  ["text-ui-base", "13 / 18", "Povrchová úprava: RAL 7016 — antracitová šeď"],
  ["text-ui-md", "14 / 20", "Montáž včetně dopravy, záruka 24 měsíců"],
  ["text-ui-lg", "15 / 20", "Technický výkres pro dílnu — čísla dílců"],
  ["text-ui-xl", "16 / 24", "Nabídka č. 4 — křídlová vrata, šířka 3 200 mm"],
  ["text-ui-2xl", "18 / 24", "Výrobní dávka připravena k expedici"],
  ["text-ui-3xl", "20 / 28", "Cena celkem 129 891,50 Kč bez DPH"],
  ["text-ui-4xl", "22 / 28", "Šablona kusovníku"],
  ["text-ui-5xl", "28 / 34", "Přehled zakázek"],
] as const;

/**
 * The bases that got hover/active tokens. The two ink bases (primary,
 * nav-active) are ordered LAST: they derive toward --color-background rather
 * than --color-foreground, so they read as the documented exception after the
 * uniform cases have established the pattern.
 */
const STATE_LADDERS = [
  [
    "secondary",
    "text-secondary-foreground",
    "bg-secondary",
    "bg-secondary-hover",
    "bg-secondary-active",
  ],
  ["chrome", "text-chrome-foreground", "bg-chrome", "bg-chrome-hover", "bg-chrome-active"],
  [
    "destructive",
    "text-destructive-foreground",
    "bg-destructive",
    "bg-destructive-hover",
    "bg-destructive-active",
  ],
  ["success", "text-success-foreground", "bg-success", "bg-success-hover", "bg-success-active"],
  ["warning", "text-warning-foreground", "bg-warning", "bg-warning-hover", "bg-warning-active"],
  ["info", "text-info-foreground", "bg-info", "bg-info-hover", "bg-info-active"],
  ["primary", "text-primary-foreground", "bg-primary", "bg-primary-hover", "bg-primary-active"],
  [
    "nav-active",
    "text-nav-active-foreground",
    "bg-nav-active",
    "bg-nav-active-hover",
    "bg-nav-active-active",
  ],
] as const;

export function BrandLabClient({ theme }: { theme: "light" | "dark" }) {
  const [step, setStep] = React.useState(1);
  const [seg, setSeg] = React.useState("interior");
  const [page, setPage] = React.useState(1);
  const steps = [
    { id: "aircraft", label: "Aircraft" },
    { id: "interior", label: "Interior" },
    { id: "exterior", label: "Exterior" },
    { id: "summary", label: "Summary" },
  ];

  return (
    <div
      className={cn(theme === "dark" && "dark", "bg-field text-foreground min-h-screen")}
      data-slot="brand-lab"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-8 py-16">
        {/* Masthead */}
        <header className="flex flex-col gap-3">
          <span className="font-data text-muted-foreground text-xs font-semibold uppercase tracking-widest">
            Perimetra · ADR 0111
          </span>
          <DisplayLabel as="h1">Design system</DisplayLabel>
          <p className="text-muted-foreground max-w-2xl text-base">
            The Bombardier-derived editorial foundation — warm-grey field, flat-matte chrome, one
            copper accent, soft geometry. Tokens and primitives, rendered in the {theme} variant.
          </p>
        </header>

        {/* Color */}
        <Section
          title="Color"
          hint="Monochrome-first: an ink/chrome/field spine, one copper accent, one steel-blue spotlight, and the status + §6 deviation planes kept apart."
        >
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-6">
            <Swatch
              label="field"
              usage="page canvas"
              className="bg-field ring-border/60 ring-1 ring-inset"
            />
            <Swatch
              label="chrome"
              usage="card surface"
              className="bg-chrome ring-border/60 ring-1 ring-inset"
            />
            <Swatch
              label="chrome-subtle"
              usage="recessed"
              className="bg-chrome-subtle ring-border/60 ring-1 ring-inset"
            />
            <Swatch
              label="primary"
              usage="ink · default action"
              className="bg-primary"
              foreground="text-primary-foreground"
            />
            <Swatch
              label="copper"
              usage="accent CTA"
              className="bg-copper"
              foreground="text-copper-foreground"
            />
            <Swatch
              label="spotlight"
              usage="summary card"
              className="bg-spotlight"
              foreground="text-spotlight-foreground"
            />
            <Swatch
              label="deviation"
              usage="§6 signal"
              className="bg-deviation"
              foreground="text-deviation-foreground"
            />
            <Swatch
              label="success"
              usage="status"
              className="bg-success"
              foreground="text-success-foreground"
            />
            <Swatch
              label="warning"
              usage="status"
              className="bg-warning"
              foreground="text-warning-foreground"
            />
            <Swatch
              label="info"
              usage="status"
              className="bg-info"
              foreground="text-info-foreground"
            />
            <Swatch
              label="destructive"
              usage="error"
              className="bg-destructive"
              foreground="text-destructive-foreground"
            />
            <Swatch
              label="muted"
              usage="quiet fill"
              className="bg-muted"
              foreground="text-muted-foreground"
            />
          </div>
        </Section>

        {/* Interaction states (ADR 0114 §7.3) */}
        <Section
          title="Interaction states"
          hint="Derived, never hand-authored per theme: each state mixes its base toward --color-foreground (hover 88 %, active 78 %), so ONE declaration is correct in both themes. Active sits at twice hover's distance so the press reads as a continuation of the same gesture."
        >
          <Panel className="flex flex-col gap-8">
            <StateLadder>
              {STATE_LADDERS.map(([token, fg, base, hover, active]) => (
                <StateLadder.Row key={token} token={token}>
                  <StateLadder.Step state="base" className={cn(base, fg)} />
                  <StateLadder.Step state="hover" className={cn(hover, fg)} />
                  <StateLadder.Step state="active" className={cn(active, fg)} />
                </StateLadder.Row>
              ))}
            </StateLadder>
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground max-w-3xl text-sm">
                <span className="font-data text-foreground font-semibold">primary</span> and{" "}
                <span className="font-data text-foreground font-semibold">nav-active</span> are
                ALREADY <code className="font-data">--color-foreground</code> (the same ink in
                light, the same near-white in dark), so mixing them toward it was an exact no-op and
                their states had no feedback at all. They mix toward{" "}
                <code className="font-data">--color-background</code> instead — the only pole with
                contrast when a base equals the foreground — measuring ΔL 0.094 light / 0.092 dark
                at hover. Every other base mixes toward the foreground and separates cleanly.
              </p>
            </div>
            <Separator />
            <div className="flex flex-col gap-3">
              <span className="font-data text-xs font-semibold">opacity-disabled · 0.45</span>
              <p className="text-muted-foreground max-w-3xl text-sm">
                Disabled is opacity-shaped, not hue-shaped: the same control turned down, which is
                honest against every base tone in both themes where a per-token muted hue would need
                sixteen hand-tuned values.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="bg-primary text-primary-foreground rounded-inset flex h-14 w-28 items-end p-2">
                  <span className="font-data text-ui-2xs">enabled</span>
                </div>
                <div className="bg-primary text-primary-foreground rounded-inset opacity-disabled flex h-14 w-28 items-end p-2">
                  <span className="font-data text-ui-2xs">disabled</span>
                </div>
                <Separator orientation="vertical" className="h-10" />
                <Button>Enabled</Button>
                <Button disabled>Disabled</Button>
                <Button variant="copper">Enabled</Button>
                <Button variant="copper" disabled>
                  Disabled
                </Button>
              </div>
            </div>
          </Panel>
        </Section>

        {/* Radius + Elevation */}
        <div className="grid gap-16 lg:grid-cols-2">
          <Section
            title="Radius"
            hint="Semantic soft-geometry scale — never Tailwind's numeric rounded-*."
          >
            <div className="flex flex-wrap gap-5">
              {[
                ["rounded-inset", "inset · 8"],
                ["rounded-control", "control · 12"],
                ["rounded-card", "card · 20"],
                ["rounded-card-lg", "card-lg · 24"],
                ["rounded-full", "pill"],
              ].map(([cls, label]) => (
                <div key={cls} className="flex flex-col items-center gap-2">
                  <div className={cn("bg-chrome ring-border/60 size-16 ring-1 ring-inset", cls)} />
                  <span className="font-data text-xs">{label}</span>
                </div>
              ))}
            </div>
          </Section>
          <Section
            title="Elevation"
            hint="Soft shadow is the only depth cue over flat chrome — never glass."
          >
            <div className="flex flex-wrap gap-6">
              {[
                ["shadow-soft-sm", "soft-sm · pill"],
                ["shadow-soft", "soft · card"],
                ["shadow-soft-lg", "soft-lg · raised"],
                ["shadow-float", "float · dialog"],
              ].map(([cls, label]) => (
                <div key={cls} className="flex flex-col items-center gap-2">
                  <div className={cn("bg-chrome rounded-card size-16", cls)} />
                  <span className="font-data text-xs">{label}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Spacing (ADR 0114 §7.1) */}
        <Section
          title="Spacing"
          hint="A 4px base with 2px half-steps through the dense low range, opening to 4px steps above 16px where the eye stops resolving 2px. Each bar's width IS its rung. These are Tailwind's built-in fractional rungs, NOT custom tokens — p-2.5 is 10px and gap-3.5 is 14px out of the box, so the scale needs no --spacing-* tokens (naming them would shadow the --container-* scale and collapse every max-w-md in the app). Read the left column as the suffix you type."
        >
          <Panel>
            <SpacingScale>
              {SPACING_RUNGS.map((rung) => (
                <SpacingScale.Rung
                  key={rung.token}
                  token={rung.token}
                  px={rung.px}
                  bar={rung.bar}
                  note={"note" in rung ? rung.note : undefined}
                />
              ))}
            </SpacingScale>
          </Panel>
        </Section>

        {/* Typography */}
        <Section
          title="Typography"
          hint="Chillax display · Synonym body · Amulya data. Editorial hierarchy, sentence case."
        >
          <Panel className="flex flex-col gap-4">
            <DisplayLabel as="p">Display · Chillax</DisplayLabel>
            <p className="font-display text-title">Title · Floorplan</p>
            <p className="font-data text-metric">40 · metric</p>
            <p className="text-base">
              Body — Synonym, the default UI face. The quick brown fox jumps over the lazy dog.
              Příliš žluťoučký kůň úpěl ďábelské ódy.
            </p>
            <p className="font-data text-sm">Data — Amulya · 129 891.504 CZK · N381G</p>
          </Panel>
        </Section>

        {/* Body-type ramp (ADR 0114 §7.2) */}
        <Section
          title="Body-type ramp"
          hint="Eleven rungs, each carrying its own line-height so vertical rhythm travels with the size and no call site pairs them by hand. Specimens are Czech and diacritic-dense — háčky and čárky are where a ramp's leading actually fails. The rungs live under their own text-ui-* namespace so all eleven generate while every stock text-* class keeps Tailwind's meaning — text-ui-base is the 13px body default, text-base is still 16px. A dense instrument panel, not a document."
        >
          <Panel>
            <TypeRamp>
              {TYPE_RUNGS.map(([token, size, specimen]) => (
                <TypeRamp.Specimen key={token} token={token} size={size}>
                  {specimen}
                </TypeRamp.Specimen>
              ))}
            </TypeRamp>
          </Panel>
        </Section>

        {/* Buttons */}
        <Section
          title="Buttons"
          hint="Ink default (was shadcn blue), copper accent CTA, opt-in pill shape, copper focus ring."
        >
          <Panel className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="copper">Copper CTA</Button>
              <Button variant="copper-outline">Copper ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button shape="pill">Pill</Button>
              <Button shape="pill" variant="copper">
                Pill copper
              </Button>
              <Button disabled>Disabled</Button>
              <Button size="icon" aria-label="add">
                <IconPlus />
              </Button>
            </div>
          </Panel>
        </Section>

        {/* Badges */}
        <Section
          title="Badges"
          hint="Amulya data face. Deviation is the §6 signal; warning is generic UI status."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Neutral</Badge>
            <Badge tone="copper">Copper</Badge>
            <Badge tone="outline">Outline</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="deviation">Deviation §6</Badge>
          </div>
        </Section>

        {/* Panels */}
        <Section title="Panels" hint="Flat-matte chrome lifted by soft shadow — three elevations.">
          <div className="grid gap-5 sm:grid-cols-3">
            <Panel>
              <p className="font-display text-title">Flat</p>
              <p className="text-muted-foreground text-sm">Default card elevation.</p>
            </Panel>
            <Panel elevation="raised">
              <p className="font-display text-title">Raised</p>
              <p className="text-muted-foreground text-sm">Lifted, hovering.</p>
            </Panel>
            <Panel elevation="flush">
              <p className="font-display text-title">Flush</p>
              <p className="text-muted-foreground text-sm">Recessed, subtle fill.</p>
            </Panel>
          </div>
        </Section>

        {/* Nav + controls */}
        <Section
          title="Navigation & controls"
          hint="Pill step-nav (near-black active) and the circular icon-button cluster."
        >
          <Panel className="flex flex-col gap-8">
            <StepNav
              value={steps[step]?.id}
              onValueChange={(id) => {
                const next = steps.findIndex((s) => s.id === id);
                if (next !== -1) setStep(next);
              }}
              aria-label="Demo steps"
              className="max-w-[210px]"
            >
              <StepNav.Heading>Konfigurace</StepNav.Heading>
              {steps.map((s, i) => (
                <StepNav.Item key={s.id} value={s.id} state={i < step ? "done" : undefined}>
                  <StepNav.Label>{s.label}</StepNav.Label>
                  <StepNav.Sub>{i === step ? "Probíhá" : i < step ? "Hotovo" : "Čeká"}</StepNav.Sub>
                </StepNav.Item>
              ))}
            </StepNav>
            <div className="flex items-center gap-8">
              <IconCluster orientation="horizontal">
                <IconButton aria-label="add">
                  <IconPlus />
                </IconButton>
                <IconButton aria-label="layers">
                  <IconLayers />
                </IconButton>
                <IconButton aria-label="rotate" active>
                  <IconCube />
                </IconButton>
                <IconButton aria-label="settings">
                  <IconGear />
                </IconButton>
              </IconCluster>
              <IconCluster>
                <IconButton size="sm" aria-label="add small">
                  <IconPlus />
                </IconButton>
                <IconButton size="lg" aria-label="settings large">
                  <IconGear />
                </IconButton>
              </IconCluster>
            </div>
          </Panel>
        </Section>

        {/* Toasts */}
        <Section
          title="Toasts"
          hint="Flat-matte chrome with a distinct status rail per severity (they were identical before ADR 0111)."
        >
          <div className="grid max-w-md gap-3">
            <Toast variant="success" title="Saved" dismissLabel="Dismiss" onDismiss={() => {}}>
              Project written to the site.
            </Toast>
            <Toast variant="info" title="Heads up" actionLabel="View" onAction={() => {}}>
              A newer release version is available.
            </Toast>
            <Toast variant="warning" title="Check margin">
              This quote sits below the org floor.
            </Toast>
            <Toast variant="error" title="Engine rejected">
              The site graph is invalid at instance 3.
            </Toast>
          </div>
        </Section>

        {/* Fields */}
        <Section
          title="Form fields"
          hint="Recessed-chrome controls, copper focus ring, no hard borders."
        >
          <Panel className="grid max-w-lg gap-5">
            <FieldShell label="Width (mm)" description="The clear opening width.">
              {({ fieldId, describedById, invalid }) => (
                <input
                  id={fieldId}
                  aria-describedby={describedById}
                  aria-invalid={invalid}
                  className={fieldInputClass}
                  defaultValue="3200"
                />
              )}
            </FieldShell>
            <FieldShell label="Notes">
              {({ fieldId, describedById, invalid }) => (
                <textarea
                  id={fieldId}
                  aria-describedby={describedById}
                  aria-invalid={invalid}
                  className={fieldTextareaClass}
                  rows={2}
                  defaultValue={'{ "note": "example" }'}
                />
              )}
            </FieldShell>
            <FieldShell label="Height (mm)" required error="Must be a positive number.">
              {({ fieldId, describedById, invalid }) => (
                <input
                  id={fieldId}
                  aria-describedby={describedById}
                  aria-invalid={invalid}
                  className={fieldInputClass}
                  defaultValue="-5"
                />
              )}
            </FieldShell>
            <FieldShell label="Depth (mm)" warn="Unusually large — please confirm.">
              {({ fieldId, describedById, invalid }) => (
                <input
                  id={fieldId}
                  aria-describedby={describedById}
                  aria-invalid={invalid}
                  className={fieldInputClass}
                  defaultValue="9000"
                />
              )}
            </FieldShell>
          </Panel>
        </Section>

        {/* Segmented nav (ADR 0111) */}
        <Section
          title="Segmented navigation"
          hint="The reference top nav — icon + label pills, one active (ink fill). Compound + React.use() context."
        >
          <SegmentedNav value={seg} onValueChange={setSeg} aria-label="Configurator steps">
            <SegmentedNavItem value="aircraft" icon={<IconPlane />} label="Aircraft" />
            <SegmentedNavItem value="interior" icon={<IconSeat />} label="Interior" />
            <SegmentedNavItem value="exterior" icon={<IconPanels />} label="Exterior" />
            <SegmentedNavItem value="summary" icon={<IconDoc />} label="Summary" />
          </SegmentedNav>
        </Section>

        {/* Stat cards (ADR 0111) */}
        <Section
          title="Stat cards"
          hint="The reference summary card — the steel-blue spotlight accent, editorial numerals, circular action."
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:max-w-2xl">
            <StatCard>
              <StatCard.Action aria-label="Open aircraft">
                <IconArrowUpRight />
              </StatCard.Action>
              <StatCard.Metric>13</StatCard.Metric>
              <StatCard.Label>Passengers</StatCard.Label>
              <div className="mt-8">
                <StatCard.Title>Bombardier</StatCard.Title>
                <StatCard.Subtitle>Global 6000</StatCard.Subtitle>
              </div>
            </StatCard>
            <StatCard>
              <StatCard.Label>Nabídka celkem</StatCard.Label>
              <StatCard.Metric className="font-data">129 891</StatCard.Metric>
              <StatCard.Subtitle>CZK · 4 položky · marže 34 %</StatCard.Subtitle>
            </StatCard>
          </div>
        </Section>

        {/* Tabs (ADR 0111) */}
        <Section
          title="Tabs"
          hint="Pill tabs (radix) — the segmented look with tab semantics + panels."
        >
          <Panel>
            <Tabs defaultValue="bom">
              <TabsList>
                <TabsTrigger value="bom">Kusovník</TabsTrigger>
                <TabsTrigger value="price">Cena</TabsTrigger>
                <TabsTrigger value="drawing">Výkres</TabsTrigger>
              </TabsList>
              <TabsContent value="bom" className="text-muted-foreground text-sm">
                Rozpad materiálu — profily, kování, výplně.
              </TabsContent>
              <TabsContent value="price" className="text-muted-foreground text-sm">
                Cenový rozpad podle ceníku a marže.
              </TabsContent>
              <TabsContent value="drawing" className="text-muted-foreground text-sm">
                Technický výkres pro dílnu.
              </TabsContent>
            </Tabs>
          </Panel>
        </Section>

        {/* Compound field + controls (ADR 0111) */}
        <Section
          title="Compound field & controls"
          hint="The compound <Field> successor to the render-prop shell, plus branded Select / Switch / Checkbox."
        >
          <Panel className="grid max-w-lg gap-5">
            <Field>
              <Field.Label>Šířka (mm)</Field.Label>
              <Field.Description>Světlá šířka otvoru.</Field.Description>
              <Field.Control>
                <Input defaultValue="3200" />
              </Field.Control>
            </Field>
            <Field required>
              <Field.Label>Výška (mm)</Field.Label>
              <Field.Control>
                <Input defaultValue="-5" aria-invalid />
              </Field.Control>
              <Field.Error>Musí být kladné číslo.</Field.Error>
            </Field>
            <Field>
              <Field.Label>Povrchová úprava</Field.Label>
              <Field.Control>
                <Select defaultValue="ral7016">
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ral7016">RAL 7016 — antracit</SelectItem>
                    <SelectItem value="ral9006">RAL 9006 — stříbrná</SelectItem>
                    <SelectItem value="elox">Elox přírodní</SelectItem>
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
            <div className="flex items-center gap-8">
              <span className="flex items-center gap-2 text-sm">
                <Switch defaultChecked aria-label="Automatika" /> Automatika
              </span>
              <span className="flex items-center gap-2 text-sm">
                <Checkbox defaultChecked aria-label="Montáž" /> Montáž
              </span>
            </div>
          </Panel>
        </Section>

        {/* Overlays (ADR 0111) */}
        <Section
          title="Overlays"
          hint="Dialog / Sheet / Tooltip / Popover on radix, brand-styled. Tooltip + Popover shown open."
        >
          <Panel className="flex flex-wrap items-start gap-4">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Otevřít dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Zrušit objednávku?</DialogTitle>
                <DialogDescription>Tato akce zapíše výjimku do knihy odchylek.</DialogDescription>
                <div className="mt-5 flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="ghost">Zpět</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Zrušit</Button>
                  </DialogClose>
                </div>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Otevřít panel</Button>
              </SheetTrigger>
              <SheetContent side="right">
                <p className="font-display text-title">Detail instance</p>
                <p className="text-muted-foreground mt-2 text-sm">Boční panel (Sheet).</p>
              </SheetContent>
            </Sheet>
            <TooltipProvider>
              <Tooltip defaultOpen>
                <TooltipTrigger asChild>
                  <Button variant="outline">Tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>Světlá šířka otvoru</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Popover defaultOpen>
              <PopoverTrigger asChild>
                <Button variant="outline">Popover</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="font-display text-title">Odchylka</p>
                <p className="text-muted-foreground mt-1 text-sm">RAL 7016 mimo standard.</p>
              </PopoverContent>
            </Popover>
          </Panel>
        </Section>

        {/* Feedback & loading (ADR 0111) */}
        <Section
          title="Feedback & loading"
          hint="Skeleton, spinner, separator, and the circular pager."
        >
          <Panel className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-2/3 max-w-md" />
            </div>
            <div className="flex items-center gap-4">
              <Spinner />
              <span className="text-muted-foreground text-sm">Načítání…</span>
              <Separator orientation="vertical" className="h-6" />
              <Pager
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(4, p + 1))}
                canPrev={page > 1}
                canNext={page < 4}
                label={`${page} / 4`}
              />
            </div>
            <Separator />
          </Panel>
        </Section>

        {/* Empty state (ADR 0111) */}
        <Section
          title="Empty state"
          hint="The 'nothing here yet' surface — compound, with icon / title / description / action."
        >
          <Panel>
            <EmptyState>
              <EmptyState.Icon>
                <IconInbox />
              </EmptyState.Icon>
              <EmptyState.Title>Zatím žádné nabídky</EmptyState.Title>
              <EmptyState.Description>
                Vytvořte první nabídku z konfigurátoru nebo ze site plánu.
              </EmptyState.Description>
              <EmptyState.Action>
                <Button variant="copper">Nová nabídka</Button>
              </EmptyState.Action>
            </EmptyState>
          </Panel>
        </Section>
      </div>
    </div>
  );
}
