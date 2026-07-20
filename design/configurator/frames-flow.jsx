/* Perimetra — public instant-price lead catcher (poptávka).
   Prospect-facing: Produkt · Rozměry · Vzhled · Poptávka. Plain React.createElement. */
(function () {
  const { h, UI, I, RAL, Enum, Stage3D, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, StepNav, Field, Input, Textarea,
          Switch, Checkbox, StatCard, DisplayLabel, Panel } = UI;

  const LEAD_STEPS = [
    { id: 'produkt', label: 'Produkt' },
    { id: 'rozmery', label: 'Rozměry' },
    { id: 'vzhled', label: 'Vzhled' },
    { id: 'poptavka', label: 'Poptávka' },
  ];
  const BASE = 48250;                       // Kč bez DPH
  const INCL = Math.round(BASE * 1.21 / 100) * 100; // ~ od, incl VAT, rounded

  /* ---------- helpers ---------- */
  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)',
      border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }
  function F(label, ctrl, extra) {
    return h(Field, (extra && extra.required) ? { required: true } : null,
      h(Field.Label, null, label),
      extra && extra.desc && h(Field.Description, null, extra.desc),
      h(Field.Control, null, ctrl));
  }

  /* ---------- public brand header (NOT an internal order bar) ---------- */
  function PublicBar() {
    return h('header', { className: 'bg-chrome', style: { display: 'flex', alignItems: 'center', gap: 16,
      padding: '0 28px', height: 64, borderBottom: '1px solid var(--color-border)', flex: '0 0 auto' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 11 } },
        h('div', { style: { width: 28, height: 28, borderRadius: 7, background: 'var(--color-primary)',
          color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 } }, 'P'),
        h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.2 } },
          h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' } }, 'Perimetra'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'Konfigurátor plotů a bran'))),
      h('div', { style: { flex: 1 } }),
      h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 } },
        I('check', 14), 'Nezávazně a zdarma'),
      h('span', { style: { width: 1, height: 24, background: 'var(--color-border)' } }),
      h('a', { href: 'tel:+420800100200', className: 'font-data tabular-nums', style: { fontSize: 13.5, fontWeight: 600, textDecoration: 'none' } }, '+420 800 100 200'),
      h(Button, { variant: 'ghost', size: 'sm' }, 'Potřebuji poradit'));
  }

  function stepsBar(activeIndex) {
    return h('div', { className: 'bg-chrome', style: { display: 'flex', justifyContent: 'center', alignItems: 'center',
      padding: '12px 24px', borderBottom: '1px solid var(--color-border)', flex: '0 0 auto' } },
      h('div', { style: { width: 520 } },
        h(StepNav, { steps: LEAD_STEPS, activeIndex, maxReachable: 3, onSelect: () => {}, 'aria-label': 'Kroky konfigurace' })));
  }
  function railTitle(title, sub) {
    return h('div', { style: { marginBottom: 4 } },
      h('div', { className: 'font-display', style: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' } }, title),
      sub && h('div', { className: 'text-muted-foreground', style: { fontSize: 13, marginTop: 3 } }, sub));
  }
  function rail(children) {
    return h('div', { style: { width: 396, flex: '0 0 auto', display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--color-border)', background: 'var(--color-chrome)', minHeight: 0 } }, keyed(children, 'r'));
  }
  function railScroll(children) {
    return h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '18px 22px', display: 'flex',
      flexDirection: 'column', gap: 16, maskImage: 'linear-gradient(to bottom, black calc(100% - 14px), transparent)' } }, children);
  }

  /* ---------- indicative price (public, non-binding) ---------- */
  function LeadPrice() {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
      h('span', { className: 'text-muted-foreground', style: { fontSize: 12.5 } }, 'Orientační cena'),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
        h('span', { className: 'text-muted-foreground', style: { fontSize: 15 } }, 'od'),
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 30, fontWeight: 600, lineHeight: 1 } }, money(INCL)),
        h('span', { className: 'font-data', style: { fontSize: 15, fontWeight: 600 } }, 'Kč')),
      h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'vč. DPH · nezávazné, upřesníme v nabídce'));
  }
  // mid-flow footer: indicative price + Pokračovat
  function flowFooter(label) {
    return h('div', { style: { flex: '0 0 auto', padding: '16px 22px', borderTop: '1px solid var(--color-border)',
      background: 'var(--color-chrome)', display: 'flex', flexDirection: 'column', gap: 14 } },
      h(LeadPrice),
      h('div', { style: { display: 'flex', gap: 10 } },
        h(Button, { variant: 'ghost' }, 'Zpět'),
        h(Button, { variant: 'copper', style: { flex: 1 } }, label || 'Pokračovat')));
  }

  /* ---------- family glyphs ---------- */
  function glyph(kind) {
    const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
    const bars = (x0, x1, n, y0, y1) => { const a = []; const g = (x1 - x0) / (n - 1);
      for (let i = 0; i < n; i++) a.push(h('line', { key: 'b' + x0 + '-' + i, x1: x0 + i * g, y1: y0, x2: x0 + i * g, y2: y1, ...st, opacity: 0.6 })); return a; };
    const shell = (kids) => h('svg', { viewBox: '0 0 96 64', width: 96, height: 64, 'aria-hidden': true }, kids);
    switch (kind) {
      case 'posuvna': return shell(h('g', st,
        h('rect', { x: 14, y: 20, width: 68, height: 30, rx: 2, ...st }), ...bars(20, 76, 9, 24, 46),
        h('path', { d: 'M14 50 L6 50 L6 44 L14 44', ...st, opacity: 0.7 }),
        h('line', { x1: 6, y1: 56, x2: 90, y2: 56, ...st, opacity: 0.3 })));
      case 'kridlova': return shell(h('g', st,
        h('rect', { x: 12, y: 20, width: 34, height: 30, rx: 2, ...st }),
        h('rect', { x: 50, y: 20, width: 34, height: 30, rx: 2, ...st }),
        ...bars(18, 40, 4, 24, 46), ...bars(56, 78, 4, 24, 46)));
      case 'branka': return shell(h('g', st,
        h('rect', { x: 34, y: 14, width: 28, height: 40, rx: 2, ...st }),
        ...bars(40, 56, 3, 18, 50), h('circle', { cx: 57, cy: 34, r: 1.6, fill: 'currentColor' })));
      case 'panel': return shell(h('g', st,
        h('rect', { x: 12, y: 22, width: 72, height: 26, rx: 2, ...st }),
        h('line', { x1: 12, y1: 30, x2: 84, y2: 30, ...st, opacity: 0.5 }),
        h('line', { x1: 12, y1: 40, x2: 84, y2: 40, ...st, opacity: 0.5 }),
        h('line', { x1: 20, y1: 48, x2: 20, y2: 56, ...st, opacity: 0.6 }),
        h('line', { x1: 76, y1: 48, x2: 76, y2: 56, ...st, opacity: 0.6 })));
      case 'samonosna': return shell(h('g', st,
        h('rect', { x: 16, y: 18, width: 64, height: 30, rx: 2, ...st }), ...bars(22, 74, 8, 22, 44),
        h('path', { d: 'M16 48 L4 48 L4 40', ...st, opacity: 0.7 }),
        h('path', { d: 'M12 36 l4 -4 l4 4', ...st, opacity: 0.6 })));
      default: return shell(h('g', st, h('rect', { x: 16, y: 20, width: 64, height: 28, rx: 2, ...st })));
    }
  }
  const FAMILIES = [
    { id: 'posuvna', name: 'Brána posuvná', span: 'Rozpon 3–6 m', from: 41200, tag: 'Nejoblíbenější', sel: true },
    { id: 'kridlova', name: 'Brána křídlová', span: 'Rozpon 2–4,5 m', from: 36800 },
    { id: 'samonosna', name: 'Samonosná brána', span: 'Rozpon 4–8 m', from: 58900 },
    { id: 'branka', name: 'Branka', span: 'Šířka 0,9–1,2 m', from: 12400 },
    { id: 'panel', name: 'Plotový panel', span: 'Cena za běžný metr', from: 1980, unit: ' / bm' },
    { id: 'kridlova2', name: 'Křídlová průmyslová', span: 'Rozpon do 6 m', from: 72500, soon: true },
  ];
  function familyCard(f) {
    return h('button', { key: f.id, className: 'ease-brand duration-200', style: {
      textAlign: 'left', cursor: f.soon ? 'default' : 'pointer', font: 'inherit', color: 'inherit',
      display: 'flex', flexDirection: 'column', gap: 14, padding: 18, borderRadius: 'var(--radius-card)',
      background: 'var(--color-chrome)',
      border: f.sel ? '1.5px solid var(--color-copper)' : '1px solid var(--color-border)',
      boxShadow: f.sel ? 'var(--shadow-soft-lg)' : 'var(--shadow-soft-sm)',
      opacity: f.soon ? 0.55 : 1 } },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' } },
        h('div', { className: f.sel ? 'text-copper' : 'text-muted-foreground', style: { display: 'inline-flex' } }, glyph(f.id.replace(/2$/, ''))),
        f.tag ? h(Badge, { tone: 'copper' }, f.tag) : f.soon ? h(Badge, { tone: 'outline' }, 'Připravujeme') : null),
      h('div', null,
        h('div', { className: 'font-display', style: { fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' } }, f.name),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginTop: 3 } }, f.span)),
      h('div', { style: { marginTop: 'auto' } },
        h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'od '),
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 14, fontWeight: 600 } }, money(f.from) + ' Kč' + (f.unit || ''))));
  }

  /* ---------- STEP 1 — Produkt ---------- */
  function FrameProdukt() {
    const sel = FAMILIES.find(f => f.sel);
    return frameShell(1440, 900, [
      h(PublicBar),
      stepsBar(0),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        h('div', { style: { flex: 1, minWidth: 0, padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' } },
          h('div', null,
            h(DisplayLabel, { as: 'h2' }, 'Co pro vás vyrobíme?'),
            h('p', { className: 'text-muted-foreground', style: { margin: '8px 0 0', fontSize: 14 } },
              'Vyberte typ a během chvíle uvidíte orientační cenu. Bez registrace, nezávazně.')),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '176px', gap: 16 } },
            FAMILIES.map(familyCard))),
        rail([
          h('div', { style: { padding: '20px 22px 0' } }, railTitle('Vaše volba', 'Upřesníte v dalším kroku')),
          railScroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            h(Panel, { elevation: 'flush', style: { padding: 16 } },
              h('div', { className: 'text-copper', style: { display: 'inline-flex', marginBottom: 6 } }, glyph('posuvna')),
              h('div', { className: 'font-display', style: { fontSize: 16, fontWeight: 600 } }, sel.name),
              h('p', { className: 'text-muted-foreground', style: { fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.5 } },
                'Pojezdová brána pro rovný terén. Tichý chod, spolehlivá i pro široké vjezdy.')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              perk('Výroba na míru vašemu vjezdu'),
              perk('Montáž po celé ČR'),
              perk('Záruka 5 let na konstrukci')))),
          flowFooter('Pokračovat na rozměry'),
        ])),
    ], 'Lead — Produkt');
  }
  function perk(text) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 } },
      h('span', { className: 'text-success', style: { display: 'inline-flex' } }, I('check', 16)), text);
  }

  /* ---------- STEP 2 — Rozměry ---------- */
  const infillOpts = [
    { value: 'lamela-90', label: 'Lamela vodorovná 90 mm' },
    { value: 'lamela-40', label: 'Lamela vodorovná 40 mm' },
    { value: 'svisla', label: 'Svislá výplň 20×20' },
    { value: 'tah', label: 'Tahokov' },
  ];
  function FrameRozmery() {
    return frameShell(1440, 900, [
      h(PublicBar),
      stepsBar(1),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        h('div', { style: { flex: 1, minWidth: 0, padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 14 } },
          railTitle('Jaké rozměry potřebujete?', 'Náhled se překresluje podle vašich hodnot'),
          h(Stage3D, { mode: '3d' })),
        rail([
          h('div', { style: { padding: '20px 22px 0' } }, railTitle('Rozměry a výplň')),
          railScroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
              F('Šířka vjezdu (mm)', h(Input, { defaultValue: '4 000' }), { required: true }),
              F('Výška (mm)', h(Input, { defaultValue: '1 800' }), { required: true })),
            F('Typ výplně', h(Enum, { initial: 'lamela-90', options: infillOpts })),
            F('Rozteč výplně (mm)', h(Input, { defaultValue: '120' }), { desc: 'Menší rozteč = větší soukromí.' }),
            h('div', { className: 'rounded-control', style: { display: 'flex', gap: 10, padding: '12px 14px',
              background: 'var(--color-chrome-subtle)', fontSize: 12.5, color: 'var(--color-muted-foreground)', lineHeight: 1.5 } },
              h('span', { style: { display: 'inline-flex', flex: '0 0 auto' } }, I('ruler', 16)),
              h('span', null, 'Nevíte přesně? Zadejte přibližně — přesné rozměry doměříme zdarma při obhlídce.')))),
          flowFooter('Pokračovat na vzhled'),
        ])),
    ], 'Lead — Rozměry');
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
      SWATCHES.map(s => h('button', { key: s.ral, onClick: () => setSel(s.ral), title: 'RAL ' + s.ral + ' — ' + s.name, style: {
        cursor: 'pointer', font: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: 8, borderRadius: 'var(--radius-inset)', background: 'transparent',
        border: sel === s.ral ? '1.5px solid var(--color-copper)' : '1px solid var(--color-border)' } },
        h('span', { style: { width: '100%', height: 38, borderRadius: 6, background: s.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' } }),
        h('span', { style: { fontSize: 11, color: 'var(--color-muted-foreground)' } }, s.name))));
  }
  function FrameVzhled() {
    return frameShell(1440, 900, [
      h(PublicBar),
      stepsBar(2),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        h('div', { style: { flex: 1, minWidth: 0, padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 14 } },
          railTitle('Jak má vypadat?', 'Barvu vidíte na náhledu okamžitě'),
          h(Stage3D, { mode: '3d', ral: '7016' })),
        rail([
          h('div', { style: { padding: '20px 22px 0' } }, railTitle('Barva a povrch')),
          railScroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
            h('div', null,
              h('div', { style: { fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', fontWeight: 600, marginBottom: 10 } }, 'Oblíbené odstíny — bez příplatku'),
              h(Swatches)),
            h(Separator, {}),
            F('Povrchová úprava', h(Enum, { initial: 'struktur', options: [
              { value: 'struktur', label: 'Komaxit — struktura mat' },
              { value: 'jemna', label: 'Komaxit — jemná struktura' },
              { value: 'lesk', label: 'Komaxit — lesk' }] })),
            h('div', { className: 'rounded-control', style: { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'var(--color-chrome-subtle)', fontSize: 12.5 } },
              h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex' } }, I('palette', 15)),
              h('span', { className: 'text-muted-foreground' }, 'Chcete jiný odstín RAL?'),
              h('span', { className: 'font-data tabular-nums', style: { fontWeight: 600, marginLeft: 'auto' } }, '+ 2 400 Kč')))),
          flowFooter('Chci cenovou nabídku'),
        ])),
    ], 'Lead — Vzhled');
  }

  /* ---------- STEP 4 — Poptávka (lead capture) ---------- */
  function sumRow(k, v) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, padding: '8px 0' } },
      h('span', { className: 'text-muted-foreground' }, k),
      h('span', { className: 'font-data tabular-nums', style: { fontWeight: 500, textAlign: 'right' } }, v));
  }
  function FramePoptavka() {
    return frameShell(1440, 900, [
      h(PublicBar),
      stepsBar(3),
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        // left: what they configured + reassurance
        h('div', { style: { flex: 1, minWidth: 0, padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: 18, overflow: 'hidden' } },
          h('div', null,
            h(DisplayLabel, { as: 'h2' }, 'Kam vám pošleme nabídku?'),
            h('p', { className: 'text-muted-foreground', style: { margin: '8px 0 0', fontSize: 14, maxWidth: 460 } },
              'Ozveme se do 24 hodin s přesnou cenou. Nic tím neplatíte a k ničemu se nezavazujete.')),
          h('div', { style: { display: 'flex', gap: 22, flex: 1, minHeight: 0 } },
            // mini preview
            h('div', { style: { width: 300, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 12 } },
              h('div', { style: { flex: '0 0 auto', height: 220, display: 'flex' } }, h(Stage3D, { mode: '3d', ral: '7016', height: 220 })),
              h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft)' } },
                h('div', { className: 'font-display', style: { fontSize: 15, fontWeight: 600, marginBottom: 4 } }, 'Vaše sestava'),
                sumRow('Typ', 'Brána posuvná'),
                h(Separator, {}), sumRow('Rozměr', '4 000 × 1 800 mm'),
                h(Separator, {}), sumRow('Výplň', 'Lamela 90 mm'),
                h(Separator, {}), sumRow('Barva', 'RAL 7016 — antracit'))),
            // trust column
            h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 } },
              h('div', { className: 'bg-spotlight-subtle rounded-card', style: { padding: 18 } },
                h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                  h('span', { className: 'text-muted-foreground', style: { fontSize: 13 } }, 'Orientační cena od'),
                  h('span', { className: 'font-data tabular-nums', style: { fontSize: 26, fontWeight: 600 } }, money(INCL) + ' Kč')),
                h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'vč. DPH · přesnou cenu potvrdíme v nabídce')),
              trust('reproduce', 'Doměření zdarma', 'Technik ověří rozměry přímo u vás.'),
              trust('save', 'Přesná nabídka do 24 h', 'S výkresem a konečnou cenou e-mailem.'),
              trust('check', 'Bez závazků', 'Poptávka je nezávazná a zdarma.')))),
        // right: contact form
        rail([
          h('div', { style: { padding: '20px 22px 0' } }, railTitle('Kontaktní údaje')),
          railScroll(h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
            F('Jméno a příjmení', h(Input, { placeholder: 'Jan Novák' }), { required: true }),
            F('E-mail', h(Input, { type: 'email', placeholder: 'jan.novak@email.cz' }), { required: true }),
            F('Telefon', h(Input, { type: 'tel', placeholder: '+420 777 123 456' }), { required: true }),
            F('Obec montáže', h(Input, { placeholder: 'Průhonice' })),
            F('Poznámka', h(Textarea, { rows: 2, placeholder: 'Termín, přístup na pozemek…' })),
            h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--color-muted-foreground)', lineHeight: 1.45 } },
              h(Checkbox, { style: { marginTop: 1 } }),
              h('span', null, 'Souhlasím se zpracováním osobních údajů za účelem vyřízení poptávky.')))),
          h('div', { style: { flex: '0 0 auto', padding: '16px 22px', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', flexDirection: 'column', gap: 8 } },
            h(Button, { variant: 'copper', size: 'lg', style: { width: '100%' } }, 'Odeslat nezávaznou poptávku'),
            h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5, textAlign: 'center', display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' } },
              I('check', 13), 'Odpovídáme obvykle do 2 hodin')),
        ])),
    ], 'Lead — Poptávka');
  }
  function trust(icon, title, sub) {
    return h('div', { className: 'bg-chrome rounded-card', style: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, boxShadow: 'var(--shadow-soft-sm)' } },
      h('span', { style: { width: 34, height: 34, borderRadius: 9, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--color-chrome-subtle)', color: 'var(--color-copper)' } }, I(icon, 17)),
      h('div', null,
        h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, title),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginTop: 1 } }, sub)));
  }

  const FR = { PRODUKT: FrameProdukt, ROZMERY: FrameRozmery, VZHLED: FrameVzhled, POPTAVKA: FramePoptavka };
  window.PConfFlowFrames = FR;
  window.PConfFlowMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('flow-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
