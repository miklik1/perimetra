/* Perimetra — internal Katalog admin (product families + parametric price rules + validation limits + versioning).
   Backstage that every other surface consumes. Desktop + tablet. Prices bez DPH. */
(function () {
  const { h, UI, I, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, Panel, DisplayLabel, Switch, Input, Field, Tabs, TabsList, TabsTrigger, TabsContent, DisclosureSection } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }

  function sideNav() {
    const item = (icon, label, count, on) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--radius-control)', fontSize: 13.5, fontWeight: on ? 600 : 500, cursor: 'pointer', background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-foreground)' } },
      h('span', { style: { display: 'inline-flex', opacity: on ? 1 : 0.7 } }, I(icon, 17)), h('span', null, label),
      count != null && h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: on ? 'rgba(255,255,255,.2)' : 'var(--color-chrome-subtle)', color: on ? 'inherit' : 'var(--color-muted-foreground)' } }, count));
    return h('div', { style: { width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' } },
        h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 } }, 'P'),
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Perimetra')),
      item('layers', 'Přehled'), item('post', 'Poptávky', 2), item('draft', 'Nabídky', 5), item('list', 'Zakázky', 3), item('cube', 'Katalog', null, true),
      h('div', { style: { marginTop: 'auto' } }, item('scale', 'Nastavení')));
  }

  /* family list (left column of catalog) */
  const FAMILIES = [
    { id: 'FIL-BP', name: 'Brána posuvná', icon: 'posuvna', rules: 6, on: true, sel: true },
    { id: 'FIL-BK', name: 'Brána křídlová', icon: 'kridlova', rules: 5, on: true },
    { id: 'FIL-BS', name: 'Samonosná brána', icon: 'posuvna', rules: 7, on: true },
    { id: 'FIL-BR', name: 'Branka', icon: 'branka', rules: 4, on: true },
    { id: 'FIL-PP', name: 'Plotový panel', icon: 'panel', rules: 3, on: true },
    { id: 'FIL-PL', name: 'Pletivo', icon: 'panel', rules: 2, on: false },
  ];
  // small glyphs reused (thin line, currentColor)
  function famGlyph(kind, size) {
    const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
    const bars = (x0, x1, n, y0, y1) => { const a = []; const g = (x1 - x0) / (n - 1); for (let i = 0; i < n; i++) a.push(h('line', { key: 'b' + x0 + '-' + i, x1: x0 + i * g, y1: y0, x2: x0 + i * g, y2: y1, ...st, opacity: 0.6 })); return a; };
    const shell = (kids) => h('svg', { viewBox: '0 0 96 64', width: size, height: size * 0.66, 'aria-hidden': true }, kids);
    if (kind === 'kridlova') return shell(h('g', st, h('rect', { x: 12, y: 20, width: 34, height: 30, rx: 2, ...st }), h('rect', { x: 50, y: 20, width: 34, height: 30, rx: 2, ...st }), ...bars(18, 40, 4, 24, 46), ...bars(56, 78, 4, 24, 46)));
    if (kind === 'branka') return shell(h('g', st, h('rect', { x: 34, y: 14, width: 28, height: 40, rx: 2, ...st }), ...bars(40, 56, 3, 18, 50)));
    if (kind === 'panel') return shell(h('g', st, h('rect', { x: 12, y: 22, width: 72, height: 26, rx: 2, ...st }), h('line', { x1: 12, y1: 30, x2: 84, y2: 30, ...st, opacity: 0.5 }), h('line', { x1: 12, y1: 40, x2: 84, y2: 40, ...st, opacity: 0.5 })));
    return shell(h('g', st, h('rect', { x: 14, y: 20, width: 68, height: 30, rx: 2, ...st }), ...bars(20, 76, 9, 24, 46), h('path', { d: 'M14 50 L6 50 L6 44 L14 44', ...st, opacity: 0.7 })));
  }
  function familyList() {
    return h('div', { style: { width: 300, flex: '0 0 auto', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)', minHeight: 0 } },
      h('div', { style: { flex: '0 0 auto', padding: '18px 18px 12px', display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', { className: 'font-display', style: { fontSize: 16, fontWeight: 600 } }, 'Rodiny produktů'),
        h('div', { style: { marginLeft: 'auto' } }, h(IconButton, { size: 'md', 'aria-label': 'Přidat rodinu' }, I('plus', 16)))),
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } },
        FAMILIES.map(f => h('div', { key: f.id, className: 'ease-brand duration-200', style: {
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-control)', cursor: 'pointer',
          background: f.sel ? 'var(--color-chrome-subtle)' : 'transparent',
          boxShadow: f.sel ? 'inset 2px 0 0 var(--color-copper)' : 'none', opacity: f.on ? 1 : 0.55 } },
          h('span', { className: f.sel ? 'text-copper' : 'text-muted-foreground', style: { display: 'inline-flex', flex: '0 0 auto', width: 40 } }, famGlyph(f.icon, 40)),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, f.name),
            h('div', { className: 'font-mono text-muted-foreground', style: { fontSize: 11.5 } }, f.id + ' · ' + f.rules + ' pravidel')),
          f.on ? h(Badge, { tone: 'success' }, 'Aktivní') : h(Badge, { tone: 'neutral' }, 'Skryto')))));
  }

  /* rule row (price rule) */
  function ruleRow(code, label, kind, val, note) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0' } },
      h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12, width: 92, flex: '0 0 auto' } }, code),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 500 } }, label),
        note && h('div', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, note)),
      h(Badge, { tone: 'outline' }, kind),
      h('span', { className: 'font-data tabular-nums', style: { width: 130, textAlign: 'right', fontSize: 13, fontWeight: 600, flex: '0 0 auto' } }, val));
  }
  function rulesCard() {
    const rows = [
      ['base', 'Základní cena rámu', 'základ', money(18400) + ' Kč', 'Rám + pojezd, do 4 m rozponu'],
      ['span.bm', 'Příplatek za rozpon', 'za bm', money(2650) + ' Kč/m', 'Nad 4 m světlosti'],
      ['fill.90', 'Výplň lamela 90 mm', 'za m²', money(1180) + ' Kč/m²', null],
      ['post.100', 'Sloupek 100 × 100', 'za ks', money(1420) + ' Kč', '2 ks v ceně brány'],
      ['color.ral', 'Komaxit RAL — standard', 'zahrnuto', '0 Kč', '8 odstínů bez příplatku'],
      ['color.spec', 'Komaxit RAL — speciál', 'příplatek', '+8 %', 'Mimo standardní paletu'],
    ];
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: '6px 20px 12px', boxShadow: 'var(--shadow-soft)' } },
      rows.map((r, i) => h('div', { key: i }, ruleRow(...r), i < rows.length - 1 && h(Separator, {}))));
  }

  /* validation limits card */
  function limitRow(param, min, max, unit, hard) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0' } },
      h('span', { style: { flex: 1, fontSize: 13, fontWeight: 500 } }, param),
      h('span', { className: 'font-data tabular-nums text-muted-foreground', style: { fontSize: 12.5 } }, min + ' – ' + max + ' ' + unit),
      hard ? h(Badge, { tone: 'destructive' }, 'Tvrdý limit') : h(Badge, { tone: 'warning' }, 'Doporučeno'));
  }
  function limitsCard() {
    const rows = [
      ['Šířka průjezdu', '1 000', '6 000', 'mm', true],
      ['Výška', '800', '2 000', 'mm', true],
      ['Rozteč výplně', '100', '150', 'mm', false],
      ['Hmotnost křídla', '—', '600', 'kg', true],
    ];
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: '6px 20px 12px', boxShadow: 'var(--shadow-soft)' } },
      rows.map((r, i) => h('div', { key: i }, limitRow(...r), i < rows.length - 1 && h(Separator, {}))),
      h('div', { className: 'rounded-control', style: { marginTop: 10, marginBottom: 6, padding: '10px 13px', background: 'var(--color-chrome-subtle)', fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', gap: 9, alignItems: 'center' } },
        h('span', { style: { display: 'inline-flex', color: 'var(--color-destructive)' } }, I('warn', 15)),
        h('span', null, 'Tvrdé limity blokují vydání nabídky. Doporučené hodnoty jen upozorní.')));
  }

  function editorHeader() {
    return h('div', { style: { flex: '0 0 auto', padding: '20px 28px 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
        h('div', { style: { flex: 1 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12.5 } }, 'FIL-BP'),
            h(Badge, { tone: 'success' }, 'Aktivní'),
            h(Badge, { tone: 'outline' }, 'katalog v2026.3')),
          h('div', { className: 'font-display', style: { fontSize: 23, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 4 } }, 'Brána posuvná')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginRight: 4 } }, h(Switch, { defaultChecked: true }), 'V nabídce'),
          h(Button, { variant: 'ghost', size: 'sm' }, 'Náhled'),
          h(Button, { variant: 'copper', size: 'sm' }, 'Publikovat verzi'))));
  }

  function editorBody(tablet) {
    return h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '18px 28px', maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
      h(Tabs, { defaultValue: 'cenik' },
        h(TabsList, null,
          h(TabsTrigger, { value: 'cenik' }, 'Ceník'),
          h(TabsTrigger, { value: 'limity' }, 'Limity'),
          h(TabsTrigger, { value: 'parametry' }, 'Parametry'),
          h(TabsTrigger, { value: 'verze' }, 'Verze')),
        h(TabsContent, { value: 'cenik' },
          h('div', { style: { paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10 } },
              h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Cenová pravidla'),
              h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'bez DPH · dopočítává konfigurátor'),
              h('div', { style: { marginLeft: 'auto' } }, h(Button, { variant: 'ghost', size: 'sm' }, '+ Pravidlo'))),
            rulesCard(),
            h('div', { className: 'bg-spotlight-subtle rounded-card', style: { padding: 16, display: 'flex', alignItems: 'center', gap: 14 } },
              h('span', { className: 'text-muted-foreground', style: { fontSize: 12.5 } }, 'Modelový příklad — 4 000 × 1 800 mm, lamela 90, RAL 7016:'),
              h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 18, fontWeight: 600 } }, money(48250) + ' Kč')))),
        h(TabsContent, { value: 'limity' },
          h('div', { style: { paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 } },
            h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Validační limity'),
            limitsCard())),
        h(TabsContent, { value: 'parametry' },
          h('div', { style: { paddingTop: 14, display: 'grid', gridTemplateColumns: tablet ? '1fr' : '1fr 1fr', gap: 14 } },
            paramField('Rozpon — rozsah (mm)', '1 000 – 6 000'),
            paramField('Výchozí výška (mm)', '1 800'),
            paramField('Typy výplně', '4 varianty'),
            paramField('Standardní odstíny', '8 RAL'))),
        h(TabsContent, { value: 'verze' },
          h('div', { style: { paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 2 } },
            versionRow('v2026.3', 'aktuální', 'Zvýšen příplatek za rozpon na 2 650 Kč/m', '1. 7. 2026', true),
            versionRow('v2026.2', null, 'Přidán tahokov jako výplň', '2. 5. 2026'),
            versionRow('v2026.1', null, 'Úvodní ceník pro sezónu 2026', '12. 1. 2026')))));
  }
  function paramField(label, val) {
    return h(Field, null, h(Field.Label, null, label), h(Field.Control, null, h(Input, { defaultValue: val })));
  }
  function versionRow(v, tag, note, date, cur) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderTop: '1px solid var(--color-border)' } },
      h('span', { style: { width: 34, height: 34, borderRadius: 999, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: cur ? 'var(--color-copper)' : 'var(--color-chrome-subtle)', color: cur ? '#fff' : 'var(--color-muted-foreground)' } }, I(cur ? 'check' : 'draft', 15)),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'font-mono', style: { fontSize: 13, fontWeight: 600 } }, v),
          tag && h(Badge, { tone: 'success' }, tag)),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12, marginTop: 1 } }, note)),
      h('span', { className: 'font-data tabular-nums text-muted-foreground', style: { fontSize: 12 } }, date),
      !cur && h(Button, { variant: 'ghost', size: 'sm' }, 'Obnovit'));
  }

  function FrameDesktop() {
    return frameShell(1440, 940, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        sideNav(), familyList(),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } }, editorHeader(), editorBody(false)))
    ], 'Katalog — desktop');
  }
  function FrameTablet() {
    return frameShell(1024, 1180, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        familyList(),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } }, editorHeader(), editorBody(true)))
    ], 'Katalog — tablet');
  }

  const FR = { DESKTOP: FrameDesktop, TABLET: FrameTablet };
  window.PConfCatFrames = FR;
  window.PConfCatMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('c-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
