/* Perimetra configurator — shared chrome parts. Babel JSX. Exports to window. */
(function () {
  const h = React.createElement;
  const UI = window.PerimetraUI;
  const { Badge, Button, IconButton, SegmentedNav, SegmentedNavItem, Separator,
          StatCard, DisclosureSection, Field, Input, Textarea, EnumSelect,
          Switch, Checkbox, DefectList, DisplayLabel, StepNav, Panel } = UI;

  /* ---------- tiny icon set (thin line, currentColor) ---------- */
  const svg = (paths, vb) => (props = {}) =>
    h('svg', { viewBox: vb || '0 0 24 24', width: props.size || 18, height: props.size || 18,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
      strokeLinejoin: 'round', 'aria-hidden': true, style: props.style },
      paths.map((d, i) => h('path', { key: i, d })));

  const Icons = {
    cube: svg(['M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9']),
    draft: svg(['M6 3h9l3 3v15H6z', 'M15 3v3h3', 'M9 11h6M9 14h6M9 17h3']),
    list: svg(['M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01']),
    explode: svg(['M12 3v4M12 17v4M3 12h4M17 12h4', 'M9 9l-3-3M15 9l3-3M9 15l-3 3M15 15l3 3']),
    section: svg(['M4 12h16', 'M8 4v16', 'M4 4l4 4M20 4l-4 4']),
    center: svg(['M12 4v3M12 17v3M4 12h3M17 12h3', 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0']),
    plus: svg(['M12 5v14M5 12h14']),
    ruler: svg(['M3 8h18v8H3z', 'M7 8v3M11 8v4M15 8v3M19 8v4']),
    palette: svg(['M12 3a9 9 0 1 0 0 18c1.7 0 2-1.5 1.2-2.4-.8-.9-.3-2.1 1-2.1H17a4 4 0 0 0 4-4c0-4.4-4-7.5-9-7.5z', 'M7.5 12.5h.01M9.5 8.5h.01M14.5 8.5h.01']),
    layers: svg(['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5', 'M3 16l9 5 9-5']),
    post: svg(['M9 3h6v18H9z', 'M9 8h6M9 13h6M9 18h6']),
    pin: svg(['M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z', 'M12 10m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0']),
    upRight: svg(['M7 17L17 7', 'M8 7h9v9']),
    check: svg(['M4 12l5 5L20 6']),
    warn: svg(['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01']),
    save: svg(['M5 3h11l3 3v15H5z', 'M8 3v5h7', 'M8 14h8v7H8z']),
    chevron: svg(['M9 5l7 7-7 7']),
    reproduce: svg(['M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2', 'M18 4v5h-5M6 20v-5h5']),
    lock: svg(['M6 11h12v9H6z', 'M9 11V8a3 3 0 0 1 6 0v3']),
    scale: svg(['M12 3v18', 'M7 8L3 15h8zM17 8l-4 7h8z', 'M5 8h14']),
  };
  const I = (name, size, style) => h(Icons[name], { size, style });

  /* ---------- shared data ---------- */
  const STEPS = [
    { id: 'produkt', label: 'Produkt' },
    { id: 'lokalita', label: 'Lokalita' },
    { id: 'konfigurace', label: 'Konfigurace' },
    { id: 'barva', label: 'Barva' },
    { id: 'souhrn', label: 'Souhrn' },
  ];
  const RAL = { '7016': { hex: '#383e42', label: 'RAL 7016 — antracitová šedá' },
                '9005': { hex: '#0a0a0a', label: 'RAL 9005 — černá' },
                'pozink': { hex: '#9aa0a6', label: 'Pozink' } };

  /* ---------- controlled wrappers so static frames aren't broken ---------- */
  function Enum({ initial, options, ...rest }) {
    const [v, setV] = React.useState(initial ?? options[0].value);
    return h(EnumSelect, { value: v, onChange: setV, options, ...rest });
  }

  /* ---------- app shell top bar ---------- */
  function AppBar({ status = 'draft', dirty = false, compact = false }) {
    const statusMap = {
      draft: { tone: 'copper', text: 'Koncept' },
      issued: { tone: 'neutral', text: 'Vydáno' },
    };
    const s = statusMap[status] || statusMap.draft;
    return h('header', {
      className: 'bg-chrome',
      style: { display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px 0 16px',
        height: 58, borderBottom: '1px solid var(--color-border)', flex: '0 0 auto' } },
      h(IconButton, { size: 'md', 'aria-label': 'Zpět na nabídku' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16))),
      h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.25 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12 } }, 'N-2026-0428'),
          h(Badge, { tone: s.tone }, s.text)),
        h('span', { style: { fontSize: 13.5, fontWeight: 600 } }, 'Nabídka — Rodinný dům Novákovi')),
      h('div', { style: { flex: 1 } }),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.2, marginRight: 2 } },
        h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'Nabídka celkem · 3 položky'),
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 16, fontWeight: 600 } }, money(132400) + ' Kč bez DPH')),
      h('div', { style: { width: 1, height: 28, background: 'var(--color-border)' } }),
      dirty
        ? h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
            h('span', { style: { width: 6, height: 6, borderRadius: 999, background: 'var(--color-warning)' } }), 'Neuloženo')
        : h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 } },
            I('check', 14), 'Uloženo'),
      h(Button, { variant: 'ghost', size: 'sm' }, 'Náhled nabídky'));
  }

  /* ---------- 3D / 2D viewport placeholder ("scene lives here") ---------- */
  function GateElevation({ exploded }) {
    // schematic sliding-gate front elevation — clearly a placeholder wireframe
    const bars = [];
    const n = 13, x0 = 120, x1 = 560, gap = (x1 - x0) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap + (exploded ? (i - (n - 1) / 2) * 2.2 : 0);
      bars.push(h('line', { key: i, x1: x, y1: 92, x2: x, y2: 300, stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', opacity: 0.55 }));
    }
    return h('g', null,
      // frame
      h('rect', { x: 112, y: 84, width: 456, height: 224, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 4, opacity: 0.85 }),
      ...bars,
      // top & bottom rails
      h('line', { x1: 112, y1: 118, x2: 568, y2: 118, stroke: 'currentColor', strokeWidth: 4, opacity: 0.85 }),
      h('line', { x1: 112, y1: 276, x2: 568, y2: 276, stroke: 'currentColor', strokeWidth: 4, opacity: 0.85 }),
      // counterweight / cantilever tail (sliding gate)
      h('path', { d: 'M112 308 L60 308 L60 292 L112 292', fill: 'none', stroke: 'currentColor', strokeWidth: 3, opacity: 0.7 }),
      // posts
      h('rect', { x: 44, y: 60, width: 16, height: 300, rx: 3, fill: 'currentColor', opacity: 0.14 }),
      h('rect', { x: 596, y: 60, width: 16, height: 300, rx: 3, fill: 'currentColor', opacity: 0.14 }),
      // ground track
      h('line', { x1: 20, y1: 360, x2: 640, y2: 360, stroke: 'currentColor', strokeWidth: 2, opacity: 0.3 }),
      h('line', { x1: 40, y1: 344, x2: 620, y2: 344, stroke: 'currentColor', strokeWidth: 1.5, strokeDasharray: '2 6', opacity: 0.35 }));
  }

  function DimLines() {
    const arrow = (x, y, dir) => h('path', { d: dir === 'l' ? `M${x} ${y} l6 -4 v8 z` : dir === 'r' ? `M${x} ${y} l-6 -4 v8 z` : dir === 'u' ? `M${x} ${y} l-4 6 h8 z` : `M${x} ${y} l-4 -6 h8 z`, fill: 'currentColor', opacity: 0.6 });
    return h('g', { style: { color: 'var(--color-spotlight)' } },
      // width dim (top)
      h('line', { x1: 44, y1: 44, x2: 612, y2: 44, stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.6 }),
      arrow(50, 44, 'l'), arrow(606, 44, 'r'),
      h('text', { x: 328, y: 38, textAnchor: 'middle', fontSize: 15, fill: 'currentColor', fontFamily: 'var(--font-data)' }, '4 000 mm'),
      // height dim (right)
      h('line', { x1: 636, y1: 60, x2: 636, y2: 360, stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.6 }),
      arrow(636, 66, 'd'), arrow(636, 354, 'u'),
      h('text', { x: 648, y: 214, fontSize: 15, fill: 'currentColor', fontFamily: 'var(--font-data)', transform: 'rotate(90 648 214)', textAnchor: 'middle' }, '1 800 mm'));
  }

  function Stage3D({ mode = '3d', ral = '7016', exploded = false, deviation = false, invalid = false, height, minimal = false }) {
    const [view, setView] = React.useState(mode);
    const color = RAL[ral].hex;
    const showDraft = view === '2d';
    return h('div', {
      style: { position: 'relative', flex: '1 1 auto', minHeight: 0, height: height || 'auto',
        borderRadius: 'var(--radius-card)', overflow: 'hidden',
        background: showDraft
          ? 'var(--color-chrome)'
          : 'radial-gradient(120% 90% at 50% 18%, #f3f1ec 0%, #e7e4dd 62%, #dcd8cf 100%)',
        border: '1px solid var(--color-border)' } },
      // subtle floor grid for 3d
      !showDraft && h('div', { style: { position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(0,0,0,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.045) 1px,transparent 1px)',
        backgroundSize: '38px 38px', maskImage: 'linear-gradient(to bottom, transparent 40%, black 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 40%, black 100%)' } }),
      // the gate schematic
      h('svg', { viewBox: '0 0 680 400', preserveAspectRatio: 'xMidYMid meet',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', padding: 40, boxSizing: 'border-box',
          color: showDraft ? 'var(--color-foreground)' : color, opacity: showDraft ? 1 : 0.92,
          filter: showDraft ? 'none' : 'drop-shadow(0 18px 22px rgba(0,0,0,.14))' } },
        h(GateElevation, { exploded }),
        showDraft && h(DimLines)),
      // deviation marker
      deviation && !showDraft && h('div', { style: { position: 'absolute', left: '38%', top: '30%',
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999,
        background: 'var(--color-deviation)', color: 'var(--color-deviation-foreground)',
        fontSize: 11.5, fontWeight: 600, boxShadow: 'var(--shadow-float)' } }, I('warn', 13), 'Odchylka +40 mm'),
      // invalid overlay tint
      invalid && h('div', { style: { position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--color-destructive) 5%, transparent)' } }),
      // HUD — dimension chip (top-left)
      h('div', { style: hudChip('top', 'left') },
        h('span', { className: 'font-data', style: { fontVariantNumeric: 'tabular-nums' } }, '4 000 × 1 800 mm'),
        h('span', { style: { width: 1, height: 12, background: 'var(--color-border)' } }),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
          h('span', { style: { width: 11, height: 11, borderRadius: 3, background: color, border: '1px solid rgba(0,0,0,.2)' } }),
          'RAL ' + ral)),
      // HUD — view switch (top-right)
      !minimal && h('div', { style: { position: 'absolute', top: 14, right: 14 } },
        h(SegmentedNav, { value: view, onValueChange: setView, 'aria-label': 'Zobrazení náhledu' },
          h(SegmentedNavItem, { value: '3d', icon: I('cube', 16), label: '3D' }),
          h(SegmentedNavItem, { value: '2d', icon: I('draft', 16), label: 'Výkres' }),
          h(SegmentedNavItem, { value: 'bom', icon: I('list', 16), label: 'Rozpad' }))),
      // HUD — overlay tools (bottom-left)
      !minimal && h('div', { style: { position: 'absolute', bottom: 14, left: 14, display: 'flex', gap: 8,
        padding: 5, borderRadius: 'var(--radius-control)', background: 'var(--color-chrome)',
        boxShadow: 'var(--shadow-soft)' } },
        h(IconButton, { size: 'md', active: exploded, 'aria-label': 'Rozložený pohled', title: 'Rozložený pohled' }, I('explode', 16)),
        h(IconButton, { size: 'md', 'aria-label': 'Řez rovinou', title: 'Řez rovinou' }, I('section', 16)),
        h(IconButton, { size: 'md', 'aria-label': 'Vycentrovat', title: 'Vycentrovat' }, I('center', 16))),
      // watermark
      h('span', { style: { position: 'absolute', bottom: 16, right: 16, fontSize: 11,
        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)',
        fontWeight: 600 } }, showDraft ? 'Automatický výkres' : 'Živý 3D náhled'));
  }
  function hudChip(v, hz) {
    const s = { position: 'absolute', display: 'inline-flex', alignItems: 'center', gap: 9,
      padding: '7px 11px', borderRadius: 'var(--radius-control)', background: 'var(--color-chrome)',
      boxShadow: 'var(--shadow-soft)', fontSize: 12.5, fontWeight: 500 };
    s[v] = 14; s[hz] = 14; return s;
  }

  /* ---------- price panel ---------- */
  function money(n) { return n.toLocaleString('cs-CZ').replace(/,/g, '\u00a0'); }
  function PricePanel({ mode = 'standard', blocked = false, deviation = false, dense = false, noCta = false, compact = false }) {
    const base = 48250, dph = mode === 'rc' ? 0 : Math.round(base * 0.21), total = base + dph;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      blocked
        ? h('div', { className: 'rounded-card-lg', style: { padding: 18, background: 'var(--color-chrome-subtle)',
            border: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 13, display: 'inline-flex', gap: 7, alignItems: 'center' } }, I('lock', 15), 'Celková cena'),
            h('span', { className: 'font-display', style: { fontSize: 26, color: 'var(--color-muted-foreground)' } }, 'Nelze spočítat'),
            h('span', { className: 'text-destructive', style: { fontSize: 12.5 } }, 'Konfigurace obsahuje chybu.'))
        : h(StatCard, null,
            h(StatCard.Label, null, 'Cena položky bez DPH'),
            h(StatCard.Metric, { className: 'tabular-nums' }, money(base)),
            h(StatCard.Subtitle, null, 'Kč · katalog v2026.3')),
      // internal economics breakdown — cost → margin → sell (bez DPH)
      !blocked && !compact && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, padding: '0 2px' } },
        priceRow('Náklad (nákup)', money(31850) + ' Kč'),
        priceRow('Marže 34 %', money(16400) + ' Kč'),
        h(Separator, {}),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
          h('span', { style: { fontWeight: 600 } }, 'Prodej bez DPH'),
          h('span', { className: 'font-data tabular-nums', style: { fontSize: 17, fontWeight: 600 } }, money(base) + ' Kč'))),
      // margin / deviation strip
      !blocked && h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        deviation
          ? h(Badge, { tone: 'deviation' }, 'Odchylka v ceně — schváleno')
          : h('span', { className: 'text-success', style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 550 } },
              I('check', 14), 'Marže nad limitem 25 %'),
        mode === 'rc' && h(Badge, { tone: 'outline' }, 'Režim §92e')),
      // CTA — add configured item to the quote
      !noCta && h('div', { style: { display: 'flex', flexDirection: dense ? 'row' : 'column', gap: 10, marginTop: 2 } },
        h(Button, { variant: 'copper', disabled: blocked, style: { width: dense ? 'auto' : '100%', flex: dense ? 1 : 'none' } }, 'Přidat do nabídky'),
        h(Button, { variant: 'ghost', style: { width: dense ? 'auto' : '100%' } }, 'Uložit koncept')));
  }
  function priceRow(label, val, kind) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
      h('span', { className: kind === 'rc' ? '' : 'text-muted-foreground', style: { color: kind === 'rc' ? 'var(--color-deviation-foreground)' : undefined } }, label),
      h('span', { className: 'font-data tabular-nums text-muted-foreground' }, val));
  }

  /* ---------- validation list panel ---------- */
  function ValidationPanel({ defects }) {
    const errs = defects.filter(d => d.severity === 'error').length;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { color: errs ? 'var(--color-destructive)' : 'var(--color-warning)', display: 'inline-flex' } }, I('warn', 16)),
        h('span', { style: { fontSize: 13, fontWeight: 600 } }, errs ? `${errs} chyba blokuje vydání` : 'Upozornění')),
      h(DefectList, { defects, onSelect: () => {} }));
  }

  /* ---------- section heading for option rail ---------- */
  function RailHead({ icon, children, aside }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 } },
      h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex' } }, I(icon, 16)),
      h('span', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' } }, children),
      aside && h('div', { style: { marginLeft: 'auto' } }, aside));
  }

  window.PConf = { h, UI, Icons, I, STEPS, RAL, Enum, AppBar, Stage3D, PricePanel, ValidationPanel, RailHead, money };
})();
