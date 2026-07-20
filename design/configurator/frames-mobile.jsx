/* Perimetra — MOBILE public lead catcher (poptávka), portrait phone frames.
   Produkt · Rozměry · Vzhled · Poptávka. Plain React.createElement. */
(function () {
  const { h, UI, I, RAL, Enum, Stage3D, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, StepNav, Field, Input, Textarea,
          Switch, Checkbox, DisplayLabel, Panel } = UI;

  const BASE = 48250;
  const INCL = Math.round(BASE * 1.21 / 100) * 100;
  const W = 390, HGT = 844;                 // iPhone-ish logical size

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }

  /* ---------- phone shell ---------- */
  function phone(kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: W, height: HGT, background: 'var(--color-background)', borderRadius: 44, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', position: 'relative',
      boxShadow: 'var(--shadow-soft-lg)', border: '10px solid #17140f', outline: '1px solid var(--color-border)' } },
      // status bar
      h('div', { style: { flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 26px', background: 'var(--color-chrome)', fontSize: 13, fontWeight: 600 } },
        h('span', { className: 'font-data tabular-nums' }, '9:41'),
        h('span', { style: { position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', width: 108, height: 26, background: '#17140f', borderRadius: 20 } }),
        h('span', { className: 'font-data', style: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 } }, '5G', h('span', { style: { display: 'inline-block', width: 22, height: 11, border: '1px solid currentColor', borderRadius: 3, position: 'relative' } },
          h('span', { style: { position: 'absolute', inset: 1.5, right: 5, background: 'currentColor', borderRadius: 1 } })))),
      keyed(kids, 'm'));
  }

  /* ---------- app top bar ---------- */
  function topBar(step) {
    return h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 18px 12px', borderBottom: '1px solid var(--color-border)' } },
      step > 0
        ? h(IconButton, { size: 'md', 'aria-label': 'Zpět' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16)))
        : h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('div', { style: { width: 24, height: 24, borderRadius: 6, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 } }, 'P'),
            h('span', { className: 'font-display', style: { fontSize: 14, fontWeight: 600 } }, 'Perimetra')),
      // progress dots
      h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' } },
        [0, 1, 2, 3].map(i => h('span', { key: i, style: { height: 4, borderRadius: 999, flex: i === step ? '0 0 22px' : '0 0 7px',
          background: i <= step ? 'var(--color-copper)' : 'var(--color-border)', transition: 'all .2s' } }))),
      h('span', { className: 'font-data text-muted-foreground', style: { fontSize: 12, minWidth: 30, textAlign: 'right' } }, (step + 1) + '/4'));
  }

  function scroll(kids) {
    return h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '18px 18px 8px', display: 'flex', flexDirection: 'column', gap: 16,
      maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } }, kids);
  }
  function h2(title, sub) {
    return h('div', null,
      h('div', { className: 'font-display', style: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 } }, title),
      sub && h('div', { className: 'text-muted-foreground', style: { fontSize: 13.5, marginTop: 6, lineHeight: 1.4 } }, sub));
  }
  // sticky bottom bar: indicative price + CTA
  function bottomBar(label, opts) {
    return h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)',
      display: 'flex', alignItems: 'center', gap: 14 } },
      !(opts && opts.hidePrice) && h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 } },
        h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'Orientačně od'),
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 19, fontWeight: 600 } }, money(INCL) + ' Kč')),
      h(Button, { variant: 'copper', size: 'lg', style: { flex: 1 } }, label));
  }

  /* ---------- family glyphs (shared shape) ---------- */
  function glyph(kind, size) {
    const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
    const bars = (x0, x1, n, y0, y1) => { const a = []; const g = (x1 - x0) / (n - 1);
      for (let i = 0; i < n; i++) a.push(h('line', { key: 'b' + x0 + '-' + i, x1: x0 + i * g, y1: y0, x2: x0 + i * g, y2: y1, ...st, opacity: 0.6 })); return a; };
    const shell = (kids) => h('svg', { viewBox: '0 0 96 64', width: size || 64, height: (size || 64) * 0.66, 'aria-hidden': true }, kids);
    switch (kind) {
      case 'posuvna': return shell(h('g', st, h('rect', { x: 14, y: 20, width: 68, height: 30, rx: 2, ...st }), ...bars(20, 76, 9, 24, 46),
        h('path', { d: 'M14 50 L6 50 L6 44 L14 44', ...st, opacity: 0.7 }), h('line', { x1: 6, y1: 56, x2: 90, y2: 56, ...st, opacity: 0.3 })));
      case 'kridlova': return shell(h('g', st, h('rect', { x: 12, y: 20, width: 34, height: 30, rx: 2, ...st }),
        h('rect', { x: 50, y: 20, width: 34, height: 30, rx: 2, ...st }), ...bars(18, 40, 4, 24, 46), ...bars(56, 78, 4, 24, 46)));
      case 'branka': return shell(h('g', st, h('rect', { x: 34, y: 14, width: 28, height: 40, rx: 2, ...st }),
        ...bars(40, 56, 3, 18, 50), h('circle', { cx: 57, cy: 34, r: 1.6, fill: 'currentColor' })));
      case 'panel': return shell(h('g', st, h('rect', { x: 12, y: 22, width: 72, height: 26, rx: 2, ...st }),
        h('line', { x1: 12, y1: 30, x2: 84, y2: 30, ...st, opacity: 0.5 }), h('line', { x1: 12, y1: 40, x2: 84, y2: 40, ...st, opacity: 0.5 }),
        h('line', { x1: 20, y1: 48, x2: 20, y2: 56, ...st, opacity: 0.6 }), h('line', { x1: 76, y1: 48, x2: 76, y2: 56, ...st, opacity: 0.6 })));
      default: return shell(h('g', st, h('rect', { x: 16, y: 20, width: 64, height: 28, rx: 2, ...st })));
    }
  }
  const FAMILIES = [
    { id: 'posuvna', name: 'Brána posuvná', span: 'Rozpon 3–6 m', from: 41200, tag: 'Nejoblíbenější', sel: true },
    { id: 'kridlova', name: 'Brána křídlová', span: 'Rozpon 2–4,5 m', from: 36800 },
    { id: 'samonosna', name: 'Samonosná brána', span: 'Rozpon 4–8 m', from: 58900 },
    { id: 'branka', name: 'Branka', span: 'Šířka 0,9–1,2 m', from: 12400 },
    { id: 'panel', name: 'Plotový panel', span: 'Cena za bm', from: 1980, unit: ' / bm' },
  ];
  function familyRow(f) {
    return h('button', { key: f.id, className: 'ease-brand duration-200', style: {
      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%',
      display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 'var(--radius-card)',
      background: 'var(--color-chrome)',
      border: f.sel ? '1.5px solid var(--color-copper)' : '1px solid var(--color-border)',
      boxShadow: f.sel ? 'var(--shadow-soft)' : 'var(--shadow-soft-sm)' } },
      h('span', { className: f.sel ? 'text-copper' : 'text-muted-foreground', style: { display: 'inline-flex', flex: '0 0 auto', width: 56 } }, glyph(f.id, 56)),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, f.name),
          f.tag && h(Badge, { tone: 'copper' }, f.tag)),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginTop: 2 } }, f.span),
        h('div', { style: { marginTop: 4 } },
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'od '),
          h('span', { className: 'font-data tabular-nums', style: { fontSize: 13, fontWeight: 600 } }, money(f.from) + ' Kč' + (f.unit || '')))),
      f.sel && h('span', { className: 'text-copper', style: { flex: '0 0 auto' } }, I('check', 18)));
  }

  /* ---------- STEP 1 — Produkt ---------- */
  function MProdukt() {
    return phone([
      topBar(0),
      scroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h2('Co pro vás vyrobíme?', 'Vyberte typ a hned uvidíte orientační cenu. Nezávazně, bez registrace.'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, FAMILIES.map(familyRow)))),
      bottomBar('Pokračovat', { hidePrice: true }),
    ], 'Mobil — Produkt');
  }

  /* ---------- STEP 2 — Rozměry ---------- */
  const infillOpts = [
    { value: 'lamela-90', label: 'Lamela vodorovná 90 mm' },
    { value: 'lamela-40', label: 'Lamela vodorovná 40 mm' },
    { value: 'svisla', label: 'Svislá výplň 20×20' },
    { value: 'tah', label: 'Tahokov' },
  ];
  function F(label, ctrl, extra) {
    return h(Field, (extra && extra.required) ? { required: true } : null,
      h(Field.Label, null, label),
      extra && extra.desc && h(Field.Description, null, extra.desc),
      h(Field.Control, null, ctrl));
  }
  function MRozmery() {
    return phone([
      topBar(1),
      scroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h2('Jaké rozměry?'),
        h('div', { style: { height: 176, display: 'flex' } }, h(Stage3D, { mode: '3d', height: 176, minimal: true })),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          F('Šířka vjezdu (mm)', h(Input, { defaultValue: '4 000', inputMode: 'numeric' }), { required: true }),
          F('Výška (mm)', h(Input, { defaultValue: '1 800', inputMode: 'numeric' }), { required: true })),
        F('Typ výplně', h(Enum, { initial: 'lamela-90', options: infillOpts })),
        h('div', { className: 'rounded-control', style: { display: 'flex', gap: 10, padding: '12px 14px',
          background: 'var(--color-chrome-subtle)', fontSize: 12.5, color: 'var(--color-muted-foreground)', lineHeight: 1.45 } },
          h('span', { style: { display: 'inline-flex', flex: '0 0 auto' } }, I('ruler', 16)),
          h('span', null, 'Nevíte přesně? Zadejte přibližně — doměříme zdarma při obhlídce.')))),
      bottomBar('Pokračovat'),
    ], 'Mobil — Rozměry');
  }

  /* ---------- STEP 3 — Vzhled ---------- */
  const SWATCHES = [
    { ral: '7016', hex: '#383e42', name: 'Antracit' }, { ral: '9005', hex: '#0a0a0a', name: 'Černá' },
    { ral: '9016', hex: '#f1f0ea', name: 'Bílá' }, { ral: '8017', hex: '#45322e', name: 'Hnědá' },
    { ral: '6005', hex: '#2f4538', name: 'Zelená' }, { ral: '7040', hex: '#9da3a6', name: 'Šedá' },
    { ral: '3005', hex: '#5e2129', name: 'Vínová' }, { ral: 'pozink', hex: '#9aa0a6', name: 'Pozink' },
  ];
  function Swatches() {
    const [sel, setSel] = React.useState('7016');
    return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 } },
      SWATCHES.map(s => h('button', { key: s.ral, onClick: () => setSel(s.ral), title: 'RAL ' + s.ral, style: {
        cursor: 'pointer', font: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: 7, borderRadius: 'var(--radius-inset)', background: 'transparent',
        border: sel === s.ral ? '1.5px solid var(--color-copper)' : '1px solid var(--color-border)' } },
        h('span', { style: { width: '100%', height: 40, borderRadius: 6, background: s.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' } }),
        h('span', { style: { fontSize: 10.5, color: 'var(--color-muted-foreground)' } }, s.name))));
  }
  function MVzhled() {
    return phone([
      topBar(2),
      scroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h2('Jak má vypadat?'),
        h('div', { style: { height: 176, display: 'flex' } }, h(Stage3D, { mode: '3d', ral: '7016', height: 176, minimal: true })),
        h('div', null,
          h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', fontWeight: 600, marginBottom: 10 } }, 'Oblíbené odstíny — bez příplatku'),
          h(Swatches)),
        F('Povrchová úprava', h(Enum, { initial: 'struktur', options: [
          { value: 'struktur', label: 'Komaxit — struktura mat' },
          { value: 'jemna', label: 'Komaxit — jemná struktura' },
          { value: 'lesk', label: 'Komaxit — lesk' }] })))),
      bottomBar('Chci nabídku'),
    ], 'Mobil — Vzhled');
  }

  /* ---------- STEP 4 — Poptávka ---------- */
  function sumRow(k, v) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '7px 0' } },
      h('span', { className: 'text-muted-foreground' }, k),
      h('span', { className: 'font-data tabular-nums', style: { fontWeight: 500, textAlign: 'right' } }, v));
  }
  function MPoptavka() {
    return phone([
      topBar(3),
      scroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
        h2('Kam pošleme nabídku?', 'Ozveme se do 24 h s přesnou cenou. Nezávazně a zdarma.'),
        // summary + price
        h('div', { className: 'bg-spotlight-subtle rounded-card', style: { padding: 14 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'Orientačně od'),
            h('span', { className: 'font-data tabular-nums', style: { fontSize: 22, fontWeight: 600 } }, money(INCL) + ' Kč'),
            h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'vč. DPH')),
          sumRow('Brána posuvná', '4 000 × 1 800 mm'),
          h(Separator, {}), sumRow('Výplň', 'Lamela 90 mm'),
          h(Separator, {}), sumRow('Barva', 'RAL 7016 — antracit')),
        // contact form
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
          F('Jméno a příjmení', h(Input, { placeholder: 'Jan Novák' }), { required: true }),
          F('Telefon', h(Input, { type: 'tel', placeholder: '+420 777 123 456', inputMode: 'tel' }), { required: true }),
          F('E-mail', h(Input, { type: 'email', placeholder: 'jan.novak@email.cz', inputMode: 'email' }), { required: true }),
          F('Obec montáže', h(Input, { placeholder: 'Průhonice' })),
          h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 11.5, color: 'var(--color-muted-foreground)', lineHeight: 1.4 } },
            h(Checkbox, { style: { marginTop: 1 } }),
            h('span', null, 'Souhlasím se zpracováním osobních údajů za účelem vyřízení poptávky.'))))),
      h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', flexDirection: 'column', gap: 7 } },
        h(Button, { variant: 'copper', size: 'lg', style: { width: '100%' } }, 'Odeslat nezávaznou poptávku'),
        h('span', { className: 'text-muted-foreground', style: { fontSize: 11, textAlign: 'center', display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' } },
          I('check', 13), 'Odpovídáme obvykle do 2 hodin')),
    ], 'Mobil — Poptávka');
  }

  const FR = { PRODUKT: MProdukt, ROZMERY: MRozmery, VZHLED: MVzhled, POPTAVKA: MPoptavka };
  window.PConfMobileFrames = FR;
  window.PConfMobileMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('m-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
