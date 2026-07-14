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
            <StepNav steps={steps} activeIndex={step} onSelect={setStep} aria-label="Demo steps" />
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
