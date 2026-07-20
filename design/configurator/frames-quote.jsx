/* Perimetra — customer-facing online nabídka (quote) view + acceptance.
   Digital twin of the PDF: desktop + mobile. Prices s DPH. Accept / Ask actions. */
(function () {
  const { h, UI, I, RAL, Stage3D, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, StatCard, Panel, DisplayLabel } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }

  const BASE = 48250, DPH = 10132.5, TOTAL = 58382.5;
  const money2 = (n) => n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00a0/g, '\u00a0').replace(/,/g, ',').replace(/(\d)(?=(\d{3})+,)/g, '$1\u00a0');
  function kc(n, dec) { return (dec ? money2(n) : money(n)) + ' Kč'; }

  /* ---------- shared content pieces ---------- */
  function brand(small) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      h('div', { style: { width: small ? 26 : 30, height: small ? 26 : 30, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: small ? 15 : 17 } }, 'P'),
      h('div', { style: { lineHeight: 1.2 } },
        h('div', { className: 'font-display', style: { fontSize: small ? 14 : 15, fontWeight: 600 } }, 'Perimetra'),
        !small && h('div', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'Ploty a brány na míru')));
  }
  function drawing(height) {
    return h('div', { className: 'bg-chrome rounded-card', style: { overflow: 'hidden', border: '1px solid var(--color-border)' } },
      h('div', { style: { height: height || 260, display: 'flex' } }, h(Stage3D, { mode: '3d', ral: '7016', height: height || 260, minimal: true })),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderTop: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-muted-foreground)' } },
        h('span', null, 'Vizualizace vaší brány'), h('span', { className: 'font-mono' }, 'RAL 7016 · antracit')));
  }
  const SPEC = [
    ['Produkt', 'Brána posuvná (samonosná)'], ['Rozměr (Š × V)', '4 000 × 1 800 mm'],
    ['Výplň', 'Lamela vodorovná 90 mm'], ['Sloupky', '100 × 100 mm'],
    ['Odstín', 'RAL 7016 — antracit'], ['Povrch', 'Komaxit struktura mat'], ['Záruka', '5 let na konstrukci'],
  ];
  function specList(compact) {
    return h('div', { style: { display: 'flex', flexDirection: 'column' } },
      SPEC.map(([k, v], i) => h('div', { key: i },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: (compact ? '8px' : '9px') + ' 0', fontSize: compact ? 13 : 13.5 } },
          h('span', { className: 'text-muted-foreground' }, k),
          h('span', { className: 'font-data tabular-nums', style: { fontWeight: 500, textAlign: 'right' } }, v)),
        i < SPEC.length - 1 && h(Separator, {}))));
  }
  function priceBlock() {
    const row = (k, v, muted) => h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13.5 } },
      h('span', { className: muted ? 'text-muted-foreground' : '' }, k),
      h('span', { className: 'font-data tabular-nums', style: { fontWeight: muted ? 400 : 500, color: muted ? 'var(--color-muted-foreground)' : undefined } }, v));
    return h('div', { className: 'bg-spotlight-subtle rounded-card', style: { padding: 18, display: 'flex', flexDirection: 'column', gap: 10 } },
      row('Základ bez DPH', kc(BASE), true),
      row('DPH 21 %', kc(DPH, true), true),
      h(Separator, {}),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Celkem k úhradě'),
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 22, fontWeight: 600 } }, kc(TOTAL, true))));
  }
  function perks(items) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      items.map((t, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13 } },
        h('span', { className: 'text-success', style: { display: 'inline-flex', flex: '0 0 auto', marginTop: 1 } }, I('check', 15)), t)));
  }
  const PERKS = ['Výroba na míru vašemu vjezdu', 'Bezplatné doměření před výrobou', 'Doprava a montáž po celé ČR', 'Záruka 5 let na konstrukci', 'Dodání za 4–6 týdnů'];
  function validityPill() {
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--color-copper)', color: 'var(--color-copper-foreground)', fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999 } },
      I('reproduce', 14), 'Platí ještě 30 dní');
  }

  /* ---------- DESKTOP ---------- */
  function FrameDesktop() {
    return h('div', { 'data-screen-label': 'Nabídka online — desktop', className: 'font-sans text-foreground', style: {
      width: 1280, height: 980, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } },
      // top bar
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '0 28px', height: 60, borderBottom: '1px solid var(--color-border)' } },
        brand(),
        h('div', { style: { flex: 1 } }),
        h('span', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginRight: 14 } }, 'Nabídka ', h('span', { className: 'font-mono', style: { color: 'var(--color-foreground)' } }, 'N-2026-0512')),
        h(Button, { variant: 'ghost', size: 'sm' }, 'Stáhnout PDF')),
      // scroll body
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '26px 28px', maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
        h('div', { style: { maxWidth: 1120, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 } },
          // hero
          h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 } },
            h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } },
                h(Badge, { tone: 'copper' }, 'Vaše nabídka je připravena'), validityPill()),
              h(DisplayLabel, { as: 'h1' }, 'Dobrý den, Jane Nováku'),
              h('p', { className: 'text-muted-foreground', style: { margin: '8px 0 0', fontSize: 14.5, maxWidth: 560, lineHeight: 1.5 } },
                'Podle vaší poptávky jsme připravili nabídku na bránu posuvnou na míru. Vše si můžete projít níže a jedním kliknutím potvrdit.'))),
          // two columns
          h('div', { style: { display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 20, alignItems: 'start' } },
            // left: drawing + spec
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
              drawing(300),
              h(Panel, { elevation: 'flush', style: { padding: 18 } },
                h('div', { className: 'font-display', style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, 'Specifikace'),
                specList())),
            // right: price + accept card (sticky feel)
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
              priceBlock(),
              h('div', { className: 'bg-chrome rounded-card', style: { padding: 18, boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column', gap: 12 } },
                h(Button, { variant: 'copper', size: 'lg', style: { width: '100%' } }, 'Závazně objednat'),
                h('div', { style: { display: 'flex', gap: 10 } },
                  h(Button, { variant: 'default', style: { flex: 1 } }, 'Mám dotaz'),
                  h(Button, { variant: 'ghost', style: { flex: 1 } }, 'Upravit')),
                h('div', { className: 'text-muted-foreground', style: { fontSize: 11.5, textAlign: 'center', display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' } },
                  I('lock', 13), 'Objednáním nevzniká platba předem')),
              h('div', { className: 'bg-chrome rounded-card', style: { padding: 18, boxShadow: 'var(--shadow-soft-sm)' } },
                h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 10 } }, 'V ceně je'),
                perks(PERKS)),
              h('div', { className: 'rounded-card', style: { padding: 16, background: 'var(--color-chrome-subtle)', display: 'flex', gap: 12, alignItems: 'center' } },
                h('div', { style: { width: 40, height: 40, borderRadius: 999, background: 'var(--color-chrome)', display: 'grid', placeItems: 'center', color: 'var(--color-muted-foreground)', flex: '0 0 auto' } }, I('post', 18)),
                h('div', null,
                  h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Ing. Pavel Horák'),
                  h('div', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'Váš obchodní zástupce · +420 800 100 200'))))))));
  }

  /* ---------- MOBILE ---------- */
  const MW = 390, MH = 844;
  function phone(kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: MW, height: MH, background: 'var(--color-background)', borderRadius: 44, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: 'var(--shadow-soft-lg)',
      border: '10px solid #17140f', outline: '1px solid var(--color-border)' } },
      h('div', { style: { flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', background: 'var(--color-chrome)', fontSize: 13, fontWeight: 600 } },
        h('span', { className: 'font-data tabular-nums' }, '9:41'),
        h('span', { style: { position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', width: 108, height: 26, background: '#17140f', borderRadius: 20 } }),
        h('span', { className: 'font-data', style: { fontSize: 12 } }, '5G')),
      keyed(kids, 'q'));
  }
  function FrameMobile() {
    return phone([
      // header
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '10px 18px 12px', borderBottom: '1px solid var(--color-border)' } },
        brand(true),
        h('div', { style: { flex: 1 } }),
        h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12 } }, 'N-2026-0512')),
      // scroll
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } },
        h('div', null,
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } }, h(Badge, { tone: 'copper' }, 'Nabídka připravena'), validityPill()),
          h('div', { className: 'font-display', style: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 } }, 'Dobrý den, Jane'),
          h('p', { className: 'text-muted-foreground', style: { margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.45 } }, 'Vaše brána posuvná na míru. Projděte a potvrďte.')),
        drawing(180),
        priceBlock(),
        h(Panel, { elevation: 'flush', style: { padding: 16 } },
          h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, 'Specifikace'),
          specList(true)),
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft-sm)' } },
          h('div', { className: 'font-display', style: { fontSize: 13.5, fontWeight: 600, marginBottom: 10 } }, 'V ceně je'),
          perks(PERKS))),
      // sticky accept
      h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.1 } },
            h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, 'Celkem s DPH'),
            h('span', { className: 'font-data tabular-nums', style: { fontSize: 18, fontWeight: 600 } }, kc(TOTAL, true))),
          h(Button, { variant: 'copper', size: 'lg', style: { flex: 1 } }, 'Objednat')),
        h('div', { style: { display: 'flex', justifyContent: 'center', gap: 18 } },
          h(Button, { variant: 'link', size: 'sm' }, 'Mám dotaz'),
          h(Button, { variant: 'link', size: 'sm' }, 'Stáhnout PDF'))),
    ], 'Nabídka online — mobil');
  }

  /* ---------- MOBILE — accepted (confirmation) ---------- */
  function FrameAccepted() {
    return phone([
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', padding: '10px 18px 12px', borderBottom: '1px solid var(--color-border)' } },
        brand(true), h('div', { style: { flex: 1 } }), h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12 } }, 'N-2026-0512')),
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 } },
        h('div', { style: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 8 } },
          h('span', { style: { width: 60, height: 60, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--color-success)', color: 'var(--color-success-foreground, #fff)' } }, I('check', 30)),
          h('div', { className: 'font-display', style: { fontSize: 22, fontWeight: 600 } }, 'Objednávka přijata'),
          h('p', { className: 'text-muted-foreground', style: { margin: 0, fontSize: 13.5, lineHeight: 1.5 } }, 'Děkujeme, Jane. Zakázka ', h('span', { className: 'font-mono', style: { color: 'var(--color-foreground)' } }, 'Z-2026-0388'), ' je založena. Ozveme se do 2 dnů kvůli doměření.')),
        // next steps timeline
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft-sm)' } },
          h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 12 } }, 'Co bude následovat'),
          [['check', 'Objednávka potvrzena', 'právě teď', true],
           ['ruler', 'Doměření na místě', 'do 2 dnů', false],
           ['cube', 'Výroba', '4–6 týdnů', false],
           ['pin', 'Montáž', 'dle domluvy', false]].map((s, i, arr) => step(s, i === arr.length - 1))),
        h('div', { className: 'rounded-card', style: { padding: 16, background: 'var(--color-chrome-subtle)', display: 'flex', gap: 12, alignItems: 'center' } },
          h('div', { style: { width: 40, height: 40, borderRadius: 999, background: 'var(--color-chrome)', display: 'grid', placeItems: 'center', color: 'var(--color-muted-foreground)', flex: '0 0 auto' } }, I('post', 18)),
          h('div', null, h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Ing. Pavel Horák'), h('div', { className: 'text-muted-foreground', style: { fontSize: 12 } }, '+420 800 100 200')))),
      h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
        h(Button, { variant: 'default', size: 'lg', style: { width: '100%' } }, 'Zobrazit zakázku')),
    ], 'Nabídka online — potvrzeno');
  }
  function step(s, last) {
    const [icon, title, sub, done] = s;
    return h('div', { key: title, style: { display: 'flex', gap: 12, paddingBottom: last ? 0 : 14 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' } },
        h('span', { style: { width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flex: '0 0 auto',
          background: done ? 'var(--color-success)' : 'var(--color-chrome-subtle)', color: done ? '#fff' : 'var(--color-muted-foreground)' } }, I(icon, 15)),
        !last && h('span', { style: { flex: 1, width: 2, background: 'var(--color-border)', marginTop: 2 } })),
      h('div', { style: { paddingTop: 3 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12, marginTop: 1 } }, sub)));
  }

  const FR = { DESKTOP: FrameDesktop, MOBILE: FrameMobile, ACCEPTED: FrameAccepted };
  window.PConfQuoteFrames = FR;
  window.PConfQuoteMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('q-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
