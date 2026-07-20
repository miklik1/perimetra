/* Perimetra — Configurator v2. The 3D scene is the PRIMARY interaction surface
   (direct manipulation: editable dimensions, selectable parts w/ in-scene controls),
   so it dominates; the guided-step + input panels are assistive overlays, and there is
   a true immersive/fullscreen mode. Rep/owner tool: cost + margin + margin-floor + typed
   Czech engine issues + deviation authoring. Desktop (+immersive variant) · tablet · mobile.
   Plain React.createElement. */
(function () {
  const { h, UI, I, RAL, Enum, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, Field, Input, Textarea, Switch, Checkbox,
          EnumSelect, StatCard, DefectList, Panel, Tooltip } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).filter(Boolean).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }

  /* ---------- guided steps (UiSpec-driven) ---------- */
  const STEPS = [
    { id: 'produkt', label: 'Produkt', sub: 'Brána posuvná', done: true },
    { id: 'rozmery', label: 'Rozměry', sub: '4 000 × 1 800', done: true },
    { id: 'vypln', label: 'Výplň', sub: 'Lamela 90 mm', active: true },
    { id: 'sloupky', label: 'Sloupky', sub: '100 × 100' },
    { id: 'povrch', label: 'Povrch a barva', sub: 'RAL 7016' },
    { id: 'motor', label: 'Motorizace', sub: 'Připravujeme', locked: true },
    { id: 'shrnuti', label: 'Shrnutí' },
  ];

  /* ============================================================
     THE SCENE — primary interaction surface
     ============================================================ */
  function GateSchematic({ exploded, selected, color }) {
    const bars = [];
    const n = 13, x0 = 150, x1 = 610, gap = (x1 - x0) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap + (exploded ? (i - (n - 1) / 2) * 2.4 : 0);
      bars.push(h('line', { key: 'b' + i, x1: x, y1: 150, x2: x, y2: 360, stroke: color, strokeWidth: 3, strokeLinecap: 'round', opacity: 0.55 }));
    }
    return h('g', null,
      h('rect', { x: 142, y: 142, width: 476, height: 226, rx: 4, fill: 'none', stroke: color, strokeWidth: 4, opacity: 0.9 }),
      ...bars,
      h('line', { x1: 142, y1: 176, x2: 618, y2: 176, stroke: color, strokeWidth: 4, opacity: 0.9 }),
      h('line', { x1: 142, y1: 334, x2: 618, y2: 334, stroke: color, strokeWidth: 4, opacity: 0.9 }),
      h('path', { d: 'M142 368 L86 368 L86 350 L142 350', fill: 'none', stroke: color, strokeWidth: 3, opacity: 0.7 }),
      h('rect', { x: 70, y: 118, width: 16, height: 300, rx: 3, fill: color, opacity: 0.16 }),
      h('rect', { x: 626, y: 118, width: 16, height: 300, rx: 3, fill: color, opacity: 0.16 }),
      h('line', { x1: 40, y1: 418, x2: 680, y2: 418, stroke: color, strokeWidth: 2, opacity: 0.28 }));
  }

  // vertical in-scene tool dock (direct-manipulation tools)
  function toolDock(active, mini) {
    const tools = [
      { id: 'select', icon: 'center', label: 'Výběr' },
      { id: 'dim', icon: 'ruler', label: 'Kóty' },
      { id: 'section', icon: 'section', label: 'Řez' },
      { id: 'explode', icon: 'explode', label: 'Rozklad' },
      { id: 'measure', icon: 'scale', label: 'Měřit' },
      { id: 'rotate', icon: 'reproduce', label: 'Otočit' },
    ];
    const pos = mini ? { left: '50%', bottom: 12, transform: 'translateX(-50%)' } : { left: 16, top: '50%', transform: 'translateY(-50%)' };
    return h('div', { style: { position: 'absolute', ...pos,
      display: 'flex', flexDirection: mini ? 'row' : 'column', gap: 6, padding: 6, borderRadius: 'var(--radius-control)',
      background: 'var(--color-chrome)', boxShadow: 'var(--shadow-float)' } },
      tools.map(t => h('span', { key: t.id, title: t.label, style: {
        width: 40, height: 40, borderRadius: 'var(--radius-inset)', display: 'grid', placeItems: 'center', cursor: 'pointer',
        background: (active || 'select') === t.id ? 'var(--color-nav-active)' : 'transparent',
        color: (active || 'select') === t.id ? 'var(--color-nav-active-foreground)' : 'var(--color-muted-foreground)' } }, I(t.icon, 18))));
  }

  // editable dimension pill (signals: dimensions are edited IN the scene)
  function dimPill(value, opts) {
    opts = opts || {};
    return h('span', { style: { position: 'absolute', ...opts.pos, display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 9px', borderRadius: 'var(--radius-inset)', background: 'var(--color-chrome)',
      border: '1.5px solid ' + (opts.invalid ? 'var(--color-destructive)' : opts.active ? 'var(--color-ring)' : 'var(--color-input)'),
      boxShadow: opts.active ? '0 0 0 3px color-mix(in srgb, var(--color-ring) 25%, transparent)' : 'var(--shadow-soft-sm)',
      fontFamily: 'var(--font-data)', fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
      color: opts.invalid ? 'var(--color-destructive)' : 'var(--color-foreground)', cursor: opts.active ? 'text' : 'default' } },
      value, opts.unit && h('span', { style: { fontWeight: 400, color: 'var(--color-muted-foreground)' } }, opts.unit));
  }

  // contextual toolbar that appears on a SELECTED part (controls live in the scene)
  function partToolbar(pos) {
    return h('div', { style: { position: 'absolute', ...pos, display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 8px 6px 12px', borderRadius: 'var(--radius-control)', background: 'var(--color-chrome)',
      boxShadow: 'var(--shadow-float)', whiteSpace: 'nowrap' } },
      h('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Výplň'),
      h('span', { style: { width: 1, height: 16, background: 'var(--color-border)' } }),
      h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'Lamela 90'),
      h('span', { style: { display: 'inline-flex', alignItems: 'center', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-inset)', overflow: 'hidden' } },
        h('span', { style: { width: 26, height: 24, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-muted-foreground)' } }, '−'),
        h('span', { className: 'font-data', style: { minWidth: 44, textAlign: 'center', fontSize: 12, fontWeight: 600 } }, '120'),
        h('span', { style: { width: 26, height: 24, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-muted-foreground)' } }, '+')),
      h(IconButton, { size: 'sm', 'aria-label': 'Další možnosti' }, I('layers', 15)));
  }

  // the scene itself — fills its parent
  function Scene(opts) {
    opts = opts || {};
    const ral = opts.ral || '7016';
    const color = RAL[ral].hex;
    const view = opts.view || '3d';
    const showDraft = view === '2d';
    const drawColor = showDraft ? 'var(--color-foreground)' : color;
    return h('div', { style: { position: 'absolute', inset: 0, overflow: 'hidden',
      background: showDraft ? 'var(--color-chrome)' : 'radial-gradient(130% 100% at 50% 12%, #f4f2ed 0%, #e6e3db 60%, #d9d5cc 100%)' } },
      !showDraft && h('div', { style: { position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(0,0,0,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.05) 1px,transparent 1px)',
        backgroundSize: '44px 44px', maskImage: 'linear-gradient(to bottom, transparent 34%, black 100%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 34%, black 100%)' } }),
      // the gate
      h('svg', { viewBox: '0 0 720 460', preserveAspectRatio: 'xMidYMid meet',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '5% 7%', boxSizing: 'border-box',
          opacity: showDraft ? 1 : 0.94, filter: showDraft ? 'none' : 'drop-shadow(0 20px 26px rgba(0,0,0,.16))' } },
        h(GateSchematic, { exploded: opts.exploded, selected: opts.selected, color: drawColor }),
        // selection outline on infill region
        opts.selected && h('rect', { x: 150, y: 150, width: 460, height: 210, rx: 3, fill: 'color-mix(in srgb, var(--color-ring) 8%, transparent)',
          stroke: 'var(--color-ring)', strokeWidth: 2, strokeDasharray: '5 4' }),
        // corner resize handles
        opts.handles && [[142, 142], [618, 142], [142, 368], [618, 368]].map((p, i) =>
          h('rect', { key: 'h' + i, x: p[0] - 5, y: p[1] - 5, width: 10, height: 10, rx: 2, fill: 'var(--color-chrome)', stroke: 'var(--color-ring)', strokeWidth: 2 }))),
      // editable dimension pills (interaction is in the scene)
      !opts.mini && opts.dims !== false && dimPill(opts.width || '4 000', { unit: 'mm', active: !opts.invalid && !opts.preview, invalid: opts.invalid, pos: { top: '9%', left: '50%', transform: 'translateX(-50%)' } }),
      opts.dims !== false && dimPill('1 800', { unit: 'mm', pos: { top: '50%', right: opts.dimRight || '6%', transform: 'translateY(-50%)' } }),
      // selected-part contextual toolbar
      opts.selected && partToolbar({ top: '20%', left: '50%', transform: 'translateX(-50%)' }),
      // deviation marker
      opts.deviation && h('div', { style: { position: 'absolute', left: '40%', top: '30%', display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 9px', borderRadius: 999, background: 'var(--color-deviation)', color: 'var(--color-deviation-foreground)', fontSize: 11.5, fontWeight: 600, boxShadow: 'var(--shadow-float)' } }, I('warn', 13), 'Odchylka +40 mm'),
      opts.invalid && h('div', { style: { position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--color-destructive) 5%, transparent)' } }),
      // HUD chip top-left
      !opts.bareHud && !opts.mini && h('div', { style: { position: 'absolute', top: 14, left: 14, display: 'inline-flex', alignItems: 'center', gap: 9,
        padding: '7px 11px', borderRadius: 'var(--radius-control)', background: 'var(--color-chrome)', boxShadow: 'var(--shadow-soft)', fontSize: 12.5, fontWeight: 500 } },
        h('span', { className: 'font-data', style: { fontVariantNumeric: 'tabular-nums' } }, (opts.width || '4 000') + ' × 1 800 mm'),
        h('span', { style: { width: 1, height: 12, background: 'var(--color-border)' } }),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h('span', { style: { width: 11, height: 11, borderRadius: 3, background: color, border: '1px solid rgba(0,0,0,.2)' } }), 'RAL ' + ral)),
      // view switch + fullscreen (top-right)
      h('div', { style: { position: 'absolute', top: 14, right: 14, display: 'flex', gap: 8 } },
        h('div', { style: { display: 'flex', padding: 3, borderRadius: 'var(--radius-control)', background: 'var(--color-chrome)', boxShadow: 'var(--shadow-soft)', gap: 2 } },
          ['3D', 'Výkres', 'Rozpad'].map((v, i) => h('span', { key: v, style: { padding: '5px 11px', borderRadius: 'var(--radius-inset)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            background: (view === '2d' ? 1 : 0) === i ? 'var(--color-nav-active)' : 'transparent', color: (view === '2d' ? 1 : 0) === i ? 'var(--color-nav-active-foreground)' : 'var(--color-muted-foreground)' } }, v))),
        opts.preview
          ? h('span', { title: 'Celá obrazovka', style: { display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 13px', borderRadius: 'var(--radius-control)', background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', boxShadow: 'var(--shadow-soft)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 } }, I('explode', 16), 'Celá obrazovka')
          : h('span', { title: opts.immersive ? 'Ukončit celou obrazovku' : 'Celá obrazovka', style: { width: 38, height: 38, borderRadius: 'var(--radius-control)', display: 'grid', placeItems: 'center',
          background: opts.immersive ? 'var(--color-primary)' : 'var(--color-chrome)', color: opts.immersive ? 'var(--color-primary-foreground)' : 'var(--color-foreground)', boxShadow: 'var(--shadow-soft)', cursor: 'pointer' } }, I(opts.immersive ? 'center' : 'explode', 17))),
      // tools dock
      !opts.noTools && !opts.preview && toolDock(opts.tool, opts.mini),
      // watermark
      !opts.bareHud && h('span', { style: { position: 'absolute', bottom: 14, right: 16, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', fontWeight: 600 } }, showDraft ? 'Automatický výkres' : 'Živý 3D · přímá manipulace'));
  }

  /* ============================================================
     ASSISTIVE OVERLAY PANELS
     ============================================================ */
  function contextBar(opts) {
    opts = opts || {};
    return h('header', { className: 'bg-chrome', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 14,
      padding: '0 16px', height: opts.tall ? 56 : 52, borderBottom: '1px solid var(--color-border)' } },
      h(IconButton, { size: 'md', 'aria-label': 'Zpět na projekt' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16))),
      h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.2 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
          h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 11.5 } }, 'N-2026-0428'),
          h(Badge, { tone: 'copper' }, 'Koncept')),
        h('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Rodinný dům Novákovi · Vjezd západ')),
      h('div', { style: { flex: 1 } }),
      !opts.compact && h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 11.5 } }, 'katalog v2026.3'),
      !opts.compact && h('span', { style: { width: 1, height: 24, background: 'var(--color-border)' } }),
      h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } }, I('check', 14), 'Uloženo'),
      h(Button, { variant: 'ghost', size: 'sm' }, 'Náhled nabídky'));
  }

  // guided steps — vertical, assistive (navigation + progress + validation)
  function stepsRail(opts) {
    opts = opts || {};
    const compact = opts.compact;
    return h('div', { style: { width: compact ? 60 : 210, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 3,
      padding: compact ? '12px 8px' : '14px 12px', borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      !compact && h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', fontWeight: 600, padding: '2px 8px 8px' } }, 'Konfigurace'),
      STEPS.map((s, i) => {
        const dotBg = s.done ? 'var(--color-copper)' : s.active ? 'var(--color-chrome)' : 'var(--color-chrome-subtle)';
        const dotFg = s.done ? 'var(--color-copper-foreground)' : s.active ? 'var(--color-copper)' : 'var(--color-muted-foreground)';
        return h('div', { key: s.id, title: compact ? s.label : undefined, style: { display: 'flex', alignItems: 'center', gap: 11, padding: compact ? 8 : '9px 10px', borderRadius: 'var(--radius-control)', cursor: s.locked ? 'default' : 'pointer',
          justifyContent: compact ? 'center' : 'flex-start', background: s.active ? 'var(--color-chrome-subtle)' : 'transparent', boxShadow: s.active ? 'inset 2px 0 0 var(--color-copper)' : 'none', opacity: s.locked ? 0.55 : 1 } },
          h('span', { style: { width: 26, height: 26, borderRadius: 999, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: dotBg, color: dotFg, border: s.active ? '2px solid var(--color-copper)' : 'none' } },
            s.locked ? I('lock', 13) : s.done ? I('check', 14) : h('span', { className: 'font-data', style: { fontSize: 12, fontWeight: 600 } }, i + 1)),
          !compact && h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 13, fontWeight: s.active ? 600 : 500 } }, s.label),
            s.sub && h('div', { className: 'text-muted-foreground', style: { fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.sub)),
          !compact && s.locked && h(Badge, { tone: 'outline' }, 'V1'));
      }));
  }

  // current-group inputs (Výplň) — assistive; mirrors in-scene selection
  function F(label, ctrl, extra) {
    return h(Field, (extra && extra.required) ? { required: true } : null,
      h(Field.Label, null, label),
      extra && extra.desc && h(Field.Description, null, extra.desc),
      h(Field.Control, null, ctrl),
      extra && extra.warn && h(Field.Warn, null, extra.warn));
  }
  const infillOpts = [
    { value: 'lamela-90', label: 'Lamela vodorovná 90 mm' },
    { value: 'lamela-40', label: 'Lamela vodorovná 40 mm' },
    { value: 'svisla', label: 'Svislá výplň 20×20' },
    { value: 'tah', label: 'Tahokov' },
  ];
  function groupInputs(opts) {
    opts = opts || {};
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 15 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Výplň'),
        h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'krok 3 ze 7'),
        h('span', { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--color-ring)' } }, I('center', 13), 'Vybráno ve scéně')),
      F('Typ výplně', h(Enum, { initial: 'lamela-90', options: infillOpts })),
      F('Rozteč výplně (mm)', h(Input, { defaultValue: '120' }), { desc: 'Golden-lock zajistí symetrii výplně.' }),
      h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 13 } }, h(Switch, { defaultChecked: true }), 'Symetrické zarovnání (golden-lock)'),
      h('div', { className: 'rounded-control', style: { padding: '10px 12px', background: 'var(--color-chrome-subtle)', fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', gap: 9, alignItems: 'center', lineHeight: 1.4 } },
        h('span', { style: { display: 'inline-flex', flex: '0 0 auto' } }, I('layers', 15)), 'Táhněte přímo ve scéně, nebo upravte hodnoty zde — obojí je propojené.'));
  }

  // margin-floor meter
  function marginMeter(pct, floor, breach) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
        h('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Marže ' + pct + ' %'),
        h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'floor ' + floor + ' %')),
      h('div', { style: { position: 'relative', height: 7, borderRadius: 999, background: 'var(--color-chrome-subtle)', overflow: 'hidden' } },
        h('div', { style: { position: 'absolute', inset: 0, width: Math.min(pct / 50 * 100, 100) + '%', background: breach ? 'var(--color-destructive)' : 'var(--color-success)', borderRadius: 999 } })),
      h('div', { style: { position: 'relative', height: 0 } },
        h('span', { style: { position: 'absolute', top: -13, left: (floor / 50 * 100) + '%', width: 2, height: 11, background: 'var(--color-foreground)', opacity: 0.5 } })));
  }

  // commercial summary (cost + margin + margin-floor + actions) — rep-only
  function commercialPanel(opts) {
    opts = opts || {};
    const blocked = opts.blocked, breach = opts.breach;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      blocked
        ? h('div', { className: 'rounded-card', style: { padding: 16, background: 'var(--color-chrome-subtle)', border: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 12.5, display: 'inline-flex', gap: 7, alignItems: 'center' } }, I('lock', 15), 'Cena položky'),
            h('span', { className: 'font-display', style: { fontSize: 22, color: 'var(--color-muted-foreground)' } }, 'Nelze spočítat'),
            h('span', { className: 'text-destructive', style: { fontSize: 12 } }, 'Konfigurace obsahuje chybu.'))
        : h(StatCard, null,
            h(StatCard.Label, null, 'Cena položky bez DPH'),
            h(StatCard.Metric, { className: 'tabular-nums' }, money(48250)),
            h(StatCard.Subtitle, null, 'Kč · katalog v2026.3')),
      !blocked && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, padding: '0 2px' } },
        priceRow('Náklad (nákup)', money(breach ? 40100 : 31850) + ' Kč'),
        priceRow('Marže', money(breach ? 8150 : 16400) + ' Kč'),
        h(Separator, {}),
        marginMeter(breach ? 17 : 34, 25, breach)),
      // validation / floor state
      blocked
        ? null
        : breach
          ? h('div', { className: 'rounded-control', style: { padding: '11px 13px', background: 'var(--color-warning-subtle, color-mix(in srgb, var(--color-warning) 14%, var(--color-chrome)))', display: 'flex', flexDirection: 'column', gap: 9 } },
              h('span', { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--color-warning)', display: 'inline-flex', gap: 7, alignItems: 'center' } }, I('warn', 15), 'Marže pod limitem'),
              h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5, lineHeight: 1.4 } }, 'Vydání vyžaduje schválení odchylky (zapíše se do knihy odchylek).'),
              h(Button, { variant: 'default', size: 'sm' }, 'Povolit odchylku'))
          : h('span', { className: 'text-success', style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 550 } }, I('check', 14), 'Konfigurace platná · marže nad limitem'),
      // actions
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 } },
        h(Button, { variant: 'copper', disabled: blocked, size: opts.big ? 'lg' : 'md', style: { width: '100%' } }, 'Vytvořit nabídku'),
        h(Button, { variant: 'ghost', size: opts.big ? 'lg' : 'md', style: { width: '100%' } }, 'Uložit do projektu')));
  }
  function priceRow(label, val) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
      h('span', { className: 'text-muted-foreground' }, label),
      h('span', { className: 'font-data tabular-nums', style: { fontWeight: 500 } }, val));
  }

  // form column (PRIMARY) — option-rail inputs scroll + commercial footer. 3D is a preview.
  function formColumn(opts) {
    opts = opts || {};
    return h('div', { style: { width: 400, flex: '0 0 auto', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)', minHeight: 0 } },
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '18px 18px 8px', display: 'flex', flexDirection: 'column', gap: 16, maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } },
        opts.invalid ? invalidForm() : groupInputs()),
      h('div', { style: { flex: '0 0 auto', padding: 16, borderTop: '1px solid var(--color-border)' } },
        commercialPanel({ blocked: opts.invalid })));
  }
  function invalidForm() {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 15 } },
        h('div', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Rozměry'),
        F('Šířka průjezdu (mm)', h(Input, { defaultValue: '6 400', 'aria-invalid': true }), { required: true }),
        h('div', { className: 'text-destructive', style: { fontSize: 12, marginTop: -8 } }, 'Maximum pro tuto rodinu je 6 000 mm.'),
        F('Výška (mm)', h(Input, { defaultValue: '1 800' }), { required: true })),
      h(Separator, {}),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { display: 'inline-flex', color: 'var(--color-destructive)' } }, I('warn', 16)),
        h('span', { style: { fontSize: 13, fontWeight: 600 } }, '2 chyby blokují vydání')),
      h(DefectList, { defects: DEFECTS, onSelect: () => {} }));
  }

  // typed Czech engine issues (invalid state)
  const DEFECTS = [
    { code: 'range.max', where: 'parameters.width', message: 'Šířka průjezdu 6 400 mm přesahuje maximum 6 000 mm pro rodinu „Brána posuvná".', severity: 'error' },
    { code: 'derive.span', where: 'derived.postSpan', message: 'Rozteč sloupků nelze dopočítat — chybí platná šířka.', severity: 'error' },
    { code: 'range.recommended', where: 'parameters.fillSpacing', message: 'Rozteč výplně 148 mm je na hranici doporučené hodnoty.', severity: 'warn' },
  ];

  // floating card wrapper (overlay over the scene)
  function floatCard(children, style) {
    return h('div', { className: 'bg-chrome', style: { position: 'absolute', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-float)', ...style } }, children);
  }

  /* ============================================================
     FRAMES
     ============================================================ */

  /* --- Desktop DEFAULT: form-based. Option-rail forms are primary; guided steps left;
         3D is a companion PREVIEW with a prominent „Celá obrazovka“ toggle. --- */
  function FrameOptimal() {
    return frameShell(1440, 900, [
      contextBar(),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        stepsRail(),
        formColumn(),
        h('div', { style: { flex: 1, position: 'relative', minWidth: 0 } },
          h(Scene, { preview: true })))
    ], 'Desktop — form-based (výchozí)');
  }

  /* --- Desktop VARIANT: IMMERSIVE / fullscreen. Scene edge-to-edge; panels collapse
         to slim triggers; interaction happens in the scene; minimal commercial chip. --- */
  function FrameImmersive() {
    return frameShell(1440, 900, [
      h('div', { style: { flex: 1, position: 'relative', minHeight: 0 } },
        h(Scene, { selected: true, handles: true, immersive: true }),
        // collapsed steps trigger (top-left, below HUD chip)
        floatCard(h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px' } },
          h('span', { style: { width: 24, height: 24, borderRadius: 999, background: 'var(--color-copper)', color: 'var(--color-copper-foreground)', display: 'grid', placeItems: 'center' } }, h('span', { className: 'font-data', style: { fontSize: 12, fontWeight: 600 } }, '3')),
          h('div', { style: { lineHeight: 1.15 } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, 'Výplň · 3 ze 7'),
            h('div', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'Krok konfigurace')),
          h('span', { style: { width: 1, height: 20, background: 'var(--color-border)', margin: '0 2px' } }),
          h(IconButton, { size: 'sm', 'aria-label': 'Předchozí' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 14))),
          h(IconButton, { size: 'sm', 'aria-label': 'Další' }, I('chevron', 14))), { top: 70, left: 14 }),
        // collapsed inputs trigger (right edge)
        floatCard(h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '12px 8px' } },
          h('span', { style: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' } }, 'Nastavení'),
          h(IconButton, { size: 'sm', 'aria-label': 'Otevřít nastavení' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 15)))), { top: '50%', right: 14, transform: 'translateY(-50%)' }),
        // minimal commercial chip (bottom-center)
        floatCard(h('div', { style: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 12px 10px 16px' } },
          h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 10.5 } }, 'Cena bez DPH · marže 34 %'),
            h('span', { className: 'font-data tabular-nums', style: { fontSize: 18, fontWeight: 600 } }, money(48250) + ' Kč')),
          h('span', { className: 'text-success', style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 } }, I('check', 14), 'Platná'),
          h(Button, { variant: 'copper', size: 'sm' }, 'Vytvořit nabídku')), { bottom: 16, left: '50%', transform: 'translateX(-50%)' }))
    ], 'Desktop — immersive / celá obrazovka');
  }

  /* --- Desktop INVALID + margin-floor: typed Czech issues + blocked --- */
  function FrameInvalid() {
    return frameShell(1440, 900, [
      contextBar(),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        stepsRail(),
        formColumn({ invalid: true }),
        h('div', { style: { flex: 1, position: 'relative', minWidth: 0 } },
          h(Scene, { preview: true, invalid: true, width: '6 400' })))
    ], 'Desktop — neplatná konfigurace');
  }

  /* --- Tablet on-site (1194 × 834 landscape): touch, scene dominant,
         bottom sheet inputs, sticky commercial bar with 44px CTA --- */
  function FrameTablet() {
    return frameShell(1194, 834, [
      contextBar({ compact: true, tall: true }),
      // top step chips (horizontal, touch)
      h('div', { style: { flex: '0 0 auto', display: 'flex', gap: 8, padding: '10px 16px', background: 'var(--color-chrome)', borderBottom: '1px solid var(--color-border)', overflow: 'hidden' } },
        STEPS.filter(s => s.id !== 'shrnuti').map((s, i) => h('span', { key: s.id, style: { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999, flex: '0 0 auto',
          background: s.active ? 'var(--color-nav-active)' : 'var(--color-chrome-subtle)', color: s.active ? 'var(--color-nav-active-foreground)' : s.locked ? 'var(--color-muted-foreground)' : 'var(--color-foreground)', opacity: s.locked ? 0.6 : 1, fontSize: 13, fontWeight: s.active ? 600 : 500 } },
          s.done ? I('check', 14) : s.locked ? I('lock', 13) : h('span', { className: 'font-data', style: { fontSize: 12, fontWeight: 600 } }, i + 1), s.label))),
      // forms (touch) + 3D preview
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        h('div', { style: { width: 372, flex: '0 0 auto', overflow: 'hidden', padding: 18, borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', flexDirection: 'column', gap: 16, maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } }, groupInputs()),
        h('div', { style: { flex: 1, position: 'relative', minWidth: 0 } }, h(Scene, { preview: true }))),
      // sticky commercial bar (bottom, 44px CTA)
      h('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 20, padding: '12px 20px', background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 } },
          h('span', { style: { fontSize: 11, opacity: 0.7 } }, 'Cena bez DPH · marže 34 %'),
          h('span', { className: 'font-data tabular-nums', style: { fontSize: 24, fontWeight: 600 } }, money(48250) + ' Kč')),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, opacity: 0.85 } }, I('check', 14), 'Konfigurace platná'),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 12 } },
          h(Button, { variant: 'default', size: 'lg' }, 'Uložit do projektu'),
          h(Button, { variant: 'copper', size: 'lg' }, 'Vytvořit nabídku')))
    ], 'Tablet — on-site (landscape)');
  }

  /* --- Mobile (390 × 844): one-step guided wizard; scene big w/ direct manipulation,
         current group in a draggable bottom sheet, prev/next + price. --- */
  function FrameMobile() {
    return h('div', { 'data-screen-label': 'Mobil — konfigurátor', className: 'font-sans text-foreground', style: {
      width: 390, height: 844, background: 'var(--color-background)', borderRadius: 44, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '10px solid #17140f', outline: '1px solid var(--color-border)' } },
      // status bar
      h('div', { style: { flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', background: 'var(--color-chrome)', fontSize: 13, fontWeight: 600 } },
        h('span', { className: 'font-data tabular-nums' }, '9:41'),
        h('span', { style: { position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', width: 108, height: 26, background: '#17140f', borderRadius: 20 } }),
        h('span', { className: 'font-data', style: { fontSize: 12 } }, '5G')),
      // compact context + step
      h('div', { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px 12px', background: 'var(--color-chrome)', borderBottom: '1px solid var(--color-border)' } },
        h(IconButton, { size: 'md', 'aria-label': 'Zpět' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16))),
        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' } },
          STEPS.filter(s => s.id !== 'shrnuti').map((s, i) => h('span', { key: s.id, style: { height: 4, borderRadius: 999, flex: s.active ? '0 0 22px' : '0 0 7px', background: (s.done || s.active) ? 'var(--color-copper)' : 'var(--color-border)' } }))),
        h('span', { className: 'font-data text-muted-foreground', style: { fontSize: 12 } }, '3/6')),
      // scene (dominant top)
      h('div', { style: { flex: '1 1 auto', position: 'relative', minHeight: 0 } },
        h(Scene, { preview: true, mini: true })),
      // bottom sheet — current group
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', borderTop: '1px solid var(--color-border)', borderRadius: '18px 18px 0 0', boxShadow: 'var(--shadow-float)', padding: '10px 18px calc(12px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 380 } },
        h('div', { style: { width: 36, height: 4, borderRadius: 999, background: 'var(--color-border)', alignSelf: 'center' } }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'font-display', style: { fontSize: 16, fontWeight: 600 } }, 'Výplň'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'krok 3 ze 6')),
        F('Typ výplně', h(Enum, { initial: 'lamela-90', options: infillOpts })),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' } },
          F('Rozteč (mm)', h(Input, { defaultValue: '120', inputMode: 'numeric' })),
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, paddingBottom: 9 } }, h(Switch, { defaultChecked: true }), 'Symetrie')),
        // price row
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'Cena bez DPH · marže 34 %'),
            h('span', { className: 'font-data tabular-nums', style: { fontSize: 18, fontWeight: 600 } }, money(48250) + ' Kč')),
          h('span', { className: 'text-success', style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, marginLeft: 2 } }, I('check', 13), 'Platná')),
        h('div', { style: { display: 'flex', gap: 10 } },
          h(Button, { variant: 'ghost', size: 'lg', style: { flex: '0 0 auto' } }, 'Zpět'),
          h(Button, { variant: 'copper', size: 'lg', style: { flex: 1 } }, 'Další — Sloupky'))));
  }

  const FR = { OPT: FrameOptimal, IMM: FrameImmersive, INV: FrameInvalid, TAB: FrameTablet, MOB: FrameMobile };
  window.PConfV2Frames = FR;
  window.PConfV2Mount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('v2-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
