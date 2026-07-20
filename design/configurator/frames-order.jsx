/* Perimetra — internal order/zakázka tracking (order → cash) for the workshop owner.
   Order detail with state timeline + orders list. Desktop, tablet, mobile. Prices bez DPH. */
(function () {
  const { h, UI, I, RAL, Stage3D, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, StatCard, Panel, DisplayLabel, Tabs, TabsList, TabsTrigger, TabsContent } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }

  /* ---------- order lifecycle ---------- */
  const STAGES = [
    { id: 'confirmed', label: 'Potvrzeno', icon: 'check', date: '14. 7.' },
    { id: 'measured', label: 'Doměřeno', icon: 'ruler', date: '16. 7.' },
    { id: 'production', label: 'Ve výrobě', icon: 'cube', date: '22. 7.' },
    { id: 'ready', label: 'K montáži', icon: 'layers', date: '—' },
    { id: 'installed', label: 'Namontováno', icon: 'pin', date: '—' },
    { id: 'invoiced', label: 'Vyfakturováno', icon: 'scale', date: '—' },
  ];
  const CURRENT = 2; // production

  function horizTimeline() {
    return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 0 } },
      STAGES.map((s, i) => {
        const done = i < CURRENT, active = i === CURRENT;
        return h('div', { key: s.id, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minWidth: 0 } },
          // connector
          i > 0 && h('span', { style: { position: 'absolute', top: 17, right: '50%', width: '100%', height: 2, background: i <= CURRENT ? 'var(--color-copper)' : 'var(--color-border)' } }),
          h('span', { style: { position: 'relative', width: 36, height: 36, borderRadius: 999, display: 'grid', placeItems: 'center', flex: '0 0 auto',
            background: done ? 'var(--color-copper)' : active ? 'var(--color-chrome)' : 'var(--color-chrome-subtle)',
            color: done ? 'var(--color-copper-foreground)' : active ? 'var(--color-copper)' : 'var(--color-muted-foreground)',
            border: active ? '2px solid var(--color-copper)' : 'none', boxShadow: (done || active) ? 'var(--shadow-soft-sm)' : 'none' } }, I(s.icon, 17)),
          h('span', { style: { fontSize: 12, fontWeight: active ? 600 : 500, marginTop: 8, textAlign: 'center', color: (done || active) ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' } }, s.label),
          h('span', { className: 'font-data tabular-nums', style: { fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2 } }, s.date));
      }));
  }

  function kv(k, v, mono) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', fontSize: 13 } },
      h('span', { className: 'text-muted-foreground' }, k),
      h('span', { className: (mono ? 'font-mono' : 'font-data') + ' tabular-nums', style: { fontWeight: 500, textAlign: 'right' } }, v));
  }
  function specRows(rows) {
    return h('div', { style: { display: 'flex', flexDirection: 'column' } },
      rows.map(([k, v, m], i) => h('div', { key: i }, kv(k, v, m), i < rows.length - 1 && h(Separator, {}))));
  }

  /* sidebar (reuse pattern from inbox) */
  function sideNav() {
    const item = (icon, label, count, on) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--radius-control)', fontSize: 13.5, fontWeight: on ? 600 : 500, cursor: 'pointer', background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-foreground)' } },
      h('span', { style: { display: 'inline-flex', opacity: on ? 1 : 0.7 } }, I(icon, 17)), h('span', null, label),
      count != null && h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: on ? 'rgba(255,255,255,.2)' : 'var(--color-chrome-subtle)', color: on ? 'inherit' : 'var(--color-muted-foreground)' } }, count));
    return h('div', { style: { width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' } },
        h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 } }, 'P'),
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Perimetra')),
      item('post', 'Poptávky', 2), item('draft', 'Nabídky', 5), item('list', 'Zakázky', 3, true), item('cube', 'Katalog'),
      h('div', { style: { marginTop: 'auto' } }, item('scale', 'Nastavení')));
  }

  /* ---------- payment / money strip (bez DPH internal) ---------- */
  function moneyStrip() {
    const cell = (lbl, val, sub, tone) => h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 0' } },
      h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, lbl),
      h('span', { className: 'font-data tabular-nums', style: { fontSize: 18, fontWeight: 600, color: tone } }, val),
      sub && h('span', { style: { fontSize: 11, color: 'var(--color-muted-foreground)' } }, sub));
    return h('div', { className: 'bg-chrome rounded-card', style: { display: 'flex', gap: 4, padding: 18, boxShadow: 'var(--shadow-soft)' } },
      cell('Hodnota bez DPH', money(48250) + ' Kč'),
      h('span', { style: { width: 1, background: 'var(--color-border)' } }),
      cell('Záloha 50 %', money(24125) + ' Kč', 'přijato 14. 7.', 'var(--color-success)'),
      h('span', { style: { width: 1, background: 'var(--color-border)' } }),
      cell('Doplatek', money(24125) + ' Kč', 'při předání'));
  }

  /* ---------- DESKTOP order detail ---------- */
  function FrameDetail() {
    return frameShell(1440, 900, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        sideNav(),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } },
          // header
          h('div', { style: { flex: '0 0 auto', padding: '20px 28px 18px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
              h('div', { style: { flex: 1 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  h('span', { className: 'text-muted-foreground', style: { fontSize: 12.5, cursor: 'pointer' } }, 'Zakázky'),
                  h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex' } }, I('chevron', 13)),
                  h('span', { className: 'font-mono', style: { fontSize: 12.5 } }, 'Z-2026-0388')),
                h('div', { className: 'font-display', style: { fontSize: 23, fontWeight: 600, letterSpacing: '-0.01em', marginTop: 4 } }, 'Jan Novák — Brána posuvná')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(Badge, { tone: 'info' }, 'Ve výrobě'),
                h(Button, { variant: 'default', size: 'sm' }, 'Tisk zakázkového listu'),
                h(Button, { variant: 'copper', size: 'sm' }, 'Posunout stav'))),
            // horizontal timeline
            h('div', { style: { marginTop: 20, padding: '0 8px' } }, horizTimeline())),
          // body: two columns
          h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '20px 28px', display: 'flex', gap: 22,
            maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
            // left
            h('div', { style: { width: 320, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 16 } },
              h('div', { style: { height: 200, display: 'flex' } }, h(Stage3D, { mode: '2d', ral: '7016', height: 200, minimal: true })),
              h(Panel, { elevation: 'flush', style: { padding: 16 } },
                h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, 'Zakázková specifikace'),
                specRows([['Produkt', 'Brána posuvná'], ['Rozměr', '4 000 × 1 800 mm'], ['Výplň', 'Lamela 90 mm'], ['Sloupek', '100 × 100 mm'], ['Profil', 'AL-PRF-40', true], ['Odstín', 'RAL 7016']]))),
            // right
            h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 } },
              moneyStrip(),
              h('div', { style: { flex: 1, minHeight: 0 } },
                h(Tabs, { defaultValue: 'aktivita' },
                  h(TabsList, null,
                    h(TabsTrigger, { value: 'aktivita' }, 'Aktivita'),
                    h(TabsTrigger, { value: 'vyroba' }, 'Výroba'),
                    h(TabsTrigger, { value: 'kontakt' }, 'Zákazník')),
                  h(TabsContent, { value: 'aktivita' },
                    h('div', { style: { paddingTop: 12 } },
                      vtl('check', 'Zakázka založena z nabídky N-2026-0512', '14. 7. · 09:12', true),
                      vtl('scale', 'Záloha 24 125 Kč přijata', '14. 7. · 14:30'),
                      vtl('ruler', 'Doměřeno na místě — rozměr potvrzen', '16. 7. · technik P. Horák'),
                      vtl('cube', 'Zadáno do výroby — dávka V-2026-31', '22. 7. · aktuální', false, true))),
                  h(TabsContent, { value: 'vyroba' },
                    h('div', { style: { paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 } },
                      h('div', { className: 'rounded-control', style: { padding: '13px 15px', background: 'var(--color-chrome-subtle)', display: 'flex', alignItems: 'center', gap: 12 } },
                        h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex' } }, I('cube', 18)),
                        h('div', null, h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'Výrobní dávka V-2026-31'), h('div', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'Plánované dokončení 29. 7. · svařovna 2'))),
                      specRows([['Kusovník', '18 položek'], ['Profil', 'AL-PRF-40 · 24 bm', true], ['Komaxit', 'RAL 7016 struktura'], ['Odhad dokončení', '29. 7. 2026']]))),
                  h(TabsContent, { value: 'kontakt' },
                    h('div', { style: { paddingTop: 12 } },
                      specRows([['Zákazník', 'Jan Novák'], ['Telefon', '+420 777 123 456'], ['E-mail', 'jan.novak@email.cz'], ['Montáž', 'K Lesu 214, Průhonice'], ['Přiřazeno', 'P. Horák']])))))))))
    ], 'Zakázka — detail');
  }
  function vtl(icon, title, sub, done, active) {
    return h('div', { style: { display: 'flex', gap: 12, paddingBottom: 16 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' } },
        h('span', { style: { width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flex: '0 0 auto',
          background: active ? 'var(--color-copper)' : done ? 'var(--color-success)' : 'var(--color-chrome-subtle)',
          color: (active || done) ? '#fff' : 'var(--color-muted-foreground)' } }, I(icon, 15)),
        h('span', { style: { flex: 1, width: 2, background: 'var(--color-border)', marginTop: 2, minHeight: 8 } })),
      h('div', { style: { paddingTop: 3 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12, marginTop: 1 } }, sub)));
  }

  /* ---------- DESKTOP orders list ---------- */
  const ORDERS = [
    { id: 'Z-2026-0388', name: 'Jan Novák', product: 'Brána posuvná', stage: 'production', due: '29. 7.', val: 48250, pay: 'záloha', hot: false },
    { id: 'Z-2026-0385', name: 'Lucie Horáková', product: 'Samonosná brána', stage: 'measured', due: '2. 8.', val: 71900, pay: 'záloha' },
    { id: 'Z-2026-0381', name: 'Eva Marešová', product: 'Brána posuvná', stage: 'ready', due: '18. 7.', val: 44100, pay: 'záloha' },
    { id: 'Z-2026-0377', name: 'Karel Němec', product: 'Plotový panel', stage: 'installed', due: '—', val: 52400, pay: 'doplatek' },
    { id: 'Z-2026-0370', name: 'Petra Blažková', product: 'Branka', stage: 'invoiced', due: '—', val: 13200, pay: 'zaplaceno' },
  ];
  const OSTAGE = { measured: { l: 'Doměřeno', t: 'info' }, production: { l: 'Ve výrobě', t: 'info' }, ready: { l: 'K montáži', t: 'warning' }, installed: { l: 'Namontováno', t: 'success' }, invoiced: { l: 'Vyfakturováno', t: 'neutral' } };
  function ostageBadge(s) { const x = OSTAGE[s]; return h(Badge, { tone: x.t === 'warning' ? 'warning' : x.t }, x.l); }
  function FrameList() {
    const head = (t, w) => h('th', { style: { textAlign: t === 'r' ? 'right' : 'left', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', padding: '0 0 10px', width: w } });
    return frameShell(1440, 900, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        sideNav(),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { style: { flex: '0 0 auto', padding: '22px 28px 16px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', alignItems: 'center', gap: 14 } },
            h('div', null, h(DisplayLabel, { as: 'h2' }, 'Zakázky'), h('span', { className: 'text-muted-foreground', style: { fontSize: 13 } }, '3 aktivní · 2 dokončené')),
            h('div', { style: { flex: 1 } }),
            h(Button, { variant: 'ghost', size: 'sm' }, 'Export'),
            h(Button, { variant: 'copper', size: 'sm' }, 'Nová zakázka')),
          // KPI row
          h('div', { style: { flex: '0 0 auto', display: 'flex', gap: 14, padding: '18px 28px 6px' } },
            kpi('Ve výrobě', '3', 'zakázky'), kpi('K montáži tento týden', '1', 'termín 18. 7.'),
            kpi('Čeká na doplatek', money(24125) + ' Kč', '1 zakázka'), kpi('Fakturováno v 7/26', money(213800) + ' Kč', 'bez DPH')),
          // table
          h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '14px 28px', maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              h('thead', null, h('tr', null, head('l'), head('l'), head('l'), head('r', 130), head('r', 120), head('r', 120))),
              h('tbody', null, ORDERS.map((o, i) => h('tr', { key: o.id, style: { borderTop: '1px solid var(--color-border)', cursor: 'pointer', background: i === 0 ? 'var(--color-chrome)' : 'transparent' } },
                cellMain(o), cell(o.product, true), cell(h('span', { className: 'font-mono', style: { fontSize: 12 } }, o.id)),
                cell(ostageBadge(o.stage), false, 'r'),
                cell(h('span', { className: 'font-data tabular-nums' }, o.due), false, 'r'),
                cell(h('span', { className: 'font-data tabular-nums', style: { fontWeight: 600 } }, money(o.val) + ' Kč'), false, 'r'))))))))
    ], 'Zakázky — seznam');
  }
  function kpi(label, val, sub) {
    return h('div', { className: 'bg-chrome rounded-card', style: { flex: 1, padding: '14px 16px', boxShadow: 'var(--shadow-soft-sm)' } },
      h('div', { className: 'text-muted-foreground', style: { fontSize: 12 } }, label),
      h('div', { className: 'font-data tabular-nums', style: { fontSize: 24, fontWeight: 600, marginTop: 4 } }, val),
      h('div', { className: 'text-muted-foreground', style: { fontSize: 11.5, marginTop: 1 } }, sub));
  }
  function cellMain(o) {
    return h('td', { style: { padding: '13px 0' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('span', { style: { width: 8, height: 8, borderRadius: 999, background: o.stage === 'ready' ? 'var(--color-warning)' : 'transparent', flex: '0 0 auto' } }),
        h('span', { style: { fontSize: 13.5, fontWeight: 600 } }, o.name)));
  }
  function cell(content, muted, align) {
    return h('td', { className: muted ? 'text-muted-foreground' : '', style: { padding: '13px 0', fontSize: 13, textAlign: align === 'r' ? 'right' : 'left' } }, content);
  }

  /* ---------- MOBILE order detail ---------- */
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
      keyed(kids, 'z'));
  }
  function vertTimelineMob() {
    return h('div', { style: { display: 'flex', flexDirection: 'column' } },
      STAGES.map((s, i) => {
        const done = i < CURRENT, active = i === CURRENT, last = i === STAGES.length - 1;
        return h('div', { key: s.id, style: { display: 'flex', gap: 12, paddingBottom: last ? 0 : 14 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' } },
            h('span', { style: { width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flex: '0 0 auto',
              background: done ? 'var(--color-copper)' : active ? 'var(--color-chrome)' : 'var(--color-chrome-subtle)',
              color: done ? 'var(--color-copper-foreground)' : active ? 'var(--color-copper)' : 'var(--color-muted-foreground)',
              border: active ? '2px solid var(--color-copper)' : 'none' } }, I(s.icon, 14)),
            !last && h('span', { style: { flex: 1, width: 2, background: i < CURRENT ? 'var(--color-copper)' : 'var(--color-border)', marginTop: 2, minHeight: 8 } })),
          h('div', { style: { paddingTop: 4, display: 'flex', width: '100%', justifyContent: 'space-between' } },
            h('span', { style: { fontSize: 13.5, fontWeight: active ? 600 : 500, color: (done || active) ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' } }, s.label),
            h('span', { className: 'font-data tabular-nums', style: { fontSize: 12, color: 'var(--color-muted-foreground)' } }, s.date)));
      }));
  }
  function FrameMobile() {
    return phone([
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', padding: '8px 12px 12px', borderBottom: '1px solid var(--color-border)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(IconButton, { size: 'md', 'aria-label': 'Zpět' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16))),
          h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12 } }, 'Z-2026-0388'),
          h('div', { style: { marginLeft: 'auto' } }, h(Badge, { tone: 'info' }, 'Ve výrobě'))),
        h('div', { className: 'font-display', style: { fontSize: 20, fontWeight: 600, padding: '10px 4px 0' } }, 'Jan Novák — Brána posuvná')),
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } },
        h('div', { style: { height: 150, display: 'flex' } }, h(Stage3D, { mode: '2d', ral: '7016', height: 150, minimal: true })),
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft-sm)' } },
          h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 12 } }, 'Průběh zakázky'),
          vertTimelineMob()),
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft-sm)' } },
          kv('Hodnota bez DPH', money(48250) + ' Kč'), h(Separator, {}),
          kv('Záloha 50 %', money(24125) + ' Kč'), h(Separator, {}),
          kv('Doplatek při předání', money(24125) + ' Kč')),
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft-sm)' } },
          h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, 'Specifikace'),
          specRows([['Rozměr', '4 000 × 1 800 mm'], ['Výplň', 'Lamela 90 mm'], ['Profil', 'AL-PRF-40', true], ['Odstín', 'RAL 7016']]))),
      h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', gap: 10 } },
        h(Button, { variant: 'default', style: { flex: 1 } }, 'Zakázkový list'),
        h(Button, { variant: 'copper', style: { flex: 1 } }, 'Posunout stav')),
    ], 'Zakázka — mobil');
  }

  const FR = { DETAIL: FrameDetail, LIST: FrameList, MOBILE: FrameMobile };
  window.PConfOrderFrames = FR;
  window.PConfOrderMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('o-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
