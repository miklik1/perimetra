/* Perimetra — internal Leads inbox (poptávky) for the workshop owner.
   Master list + triage detail. Prices bez DPH (workshop-facing internal tool). */
(function () {
  const { h, UI, I, RAL, Stage3D, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, Field, Input, Textarea, StatCard,
          Tabs, TabsList, TabsTrigger, TabsContent, Panel, DisplayLabel, EmptyState, Select } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }

  /* ---------- lead data ---------- */
  const LEADS = [
    { id: 'P-2026-0512', name: 'Jan Novák', obec: 'Průhonice', product: 'Brána posuvná', dim: '4 000 × 1 800 mm', ral: '7016',
      from: 48250, ago: 'před 12 min', src: 'web', stage: 'new', phone: '+420 777 123 456', email: 'jan.novak@email.cz',
      note: 'Stávající sloupek zůstává, potřebuji přizpůsobit šířku. Přístup autem z ulice.', sel: true, hot: true },
    { id: 'P-2026-0511', name: 'Marie Dvořáková', obec: 'Říčany', product: 'Brána křídlová', dim: '3 200 × 1 600 mm', ral: '9005',
      from: 39400, ago: 'před 1 h', src: 'mobil', stage: 'new', phone: '+420 606 222 118', email: 'm.dvorakova@seznam.cz', note: '' },
    { id: 'P-2026-0509', name: 'Petr Svoboda', obec: 'Černošice', product: 'Plotový panel', dim: '24 bm × 1 500 mm', ral: '7016',
      from: 47520, ago: 'před 3 h', src: 'web', stage: 'contacted', phone: '+420 725 900 431', email: 'svoboda.p@email.cz', note: 'Svažitý terén.' },
    { id: 'P-2026-0505', name: 'Lucie Horáková', obec: 'Jesenice', product: 'Samonosná brána', dim: '5 500 × 1 800 mm', ral: '6005',
      from: 71900, ago: 'včera', src: 'mobil', stage: 'quoted', phone: '+420 608 771 200', email: 'l.horakova@email.cz', note: 'Chce pohon Nice.' },
    { id: 'P-2026-0498', name: 'Tomáš Král', obec: 'Dobřejovice', product: 'Branka', dim: '1 000 × 1 800 mm', ral: '9005',
      from: 13200, ago: 'včera', src: 'web', stage: 'contacted', phone: '+420 604 118 552', email: 'kral.t@email.cz', note: '' },
    { id: 'P-2026-0490', name: 'Eva Marešová', obec: 'Vestec', product: 'Brána posuvná', dim: '3 600 × 1 800 mm', ral: '7040',
      from: 44100, ago: '2 dny', src: 'web', stage: 'won', phone: '+420 777 654 321', email: 'e.maresova@email.cz', note: 'Objednáno.' },
    { id: 'P-2026-0486', name: 'Josef Beneš', obec: 'Psáry', product: 'Brána křídlová', dim: '3 000 × 1 500 mm', ral: '8017',
      from: 37800, ago: '3 dny', src: 'mobil', stage: 'lost', phone: '+420 720 445 110', email: 'j.benes@email.cz', note: 'Vybral konkurenci.' },
  ];
  const STAGE = {
    new: { label: 'Nová', tone: 'copper' },
    contacted: { label: 'Kontaktováno', tone: 'info' },
    quoted: { label: 'Nabídka odeslána', tone: 'spotlight' },
    won: { label: 'Objednáno', tone: 'success' },
    lost: { label: 'Ztraceno', tone: 'neutral' },
  };
  function stageBadge(stage) {
    const s = STAGE[stage];
    return h(Badge, { tone: s.tone === 'spotlight' ? 'info' : s.tone }, s.label);
  }
  function srcBadge(src) {
    return h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5 } },
      I(src === 'mobil' ? 'post' : 'upRight', 13), src === 'mobil' ? 'Mobil' : 'Web');
  }

  /* ---------- sidebar nav ---------- */
  function sideNav(active) {
    const item = (icon, label, count, on) => h('div', { style: {
      display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--radius-control)',
      fontSize: 13.5, fontWeight: on ? 600 : 500, cursor: 'pointer',
      background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-foreground)' } },
      h('span', { style: { display: 'inline-flex', opacity: on ? 1 : 0.7 } }, I(icon, 17)), h('span', null, label),
      count != null && h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12, fontWeight: 600,
        padding: '1px 7px', borderRadius: 999, background: on ? 'rgba(255,255,255,.2)' : 'var(--color-chrome-subtle)',
        color: on ? 'inherit' : 'var(--color-muted-foreground)' } }, count));
    return h('div', { style: { width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 16,
      borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' } },
        h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 } }, 'P'),
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Perimetra')),
      item('post', 'Poptávky', 2, active === 'leads'),
      item('draft', 'Nabídky', 5),
      item('list', 'Zakázky', 3),
      item('cube', 'Katalog'),
      h('div', { style: { marginTop: 'auto' } }, item('scale', 'Nastavení')));
  }

  /* ---------- master list ---------- */
  function leadRow(l) {
    return h('div', { key: l.id, style: {
      display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', cursor: 'pointer',
      borderLeft: '3px solid ' + (l.sel ? 'var(--color-copper)' : 'transparent'),
      background: l.sel ? 'var(--color-chrome)' : 'transparent',
      boxShadow: l.sel ? 'inset 0 0 0 1px var(--color-border)' : 'none' } },
      // unread dot
      h('span', { style: { width: 8, height: 8, borderRadius: 999, flex: '0 0 auto',
        background: l.stage === 'new' ? 'var(--color-copper)' : 'transparent' } }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap' } }, l.name),
          l.hot && h(Badge, { tone: 'deviation' }, 'Horký'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' } }, l.ago)),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
          l.product + ' · ' + l.dim),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 } },
          stageBadge(l.stage), srcBadge(l.src),
          h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12.5, fontWeight: 600 } }, 'od ' + money(l.from) + ' Kč'))));
  }
  function masterList(filter) {
    return h('div', { style: { width: 384, flex: '0 0 auto', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--color-border)', background: 'var(--color-background)', minHeight: 0 } },
      // header + search
      h('div', { style: { flex: '0 0 auto', padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--color-border)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { className: 'font-display', style: { fontSize: 17, fontWeight: 600 } }, 'Poptávky'),
          h('span', { className: 'font-data tabular-nums text-muted-foreground', style: { fontSize: 13 } }, LEADS.length),
          h('div', { style: { marginLeft: 'auto' } }, h(IconButton, { size: 'md', 'aria-label': 'Filtr' }, I('list', 16)))),
        h(Input, { placeholder: 'Hledat jméno, obec, číslo…' }),
        h('div', { style: { display: 'flex', gap: 6 } },
          chip('Vše', filter === 'all'), chip('Nové', filter === 'new'), chip('Rozpracované', false), chip('Uzavřené', false))),
      // rows
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
        LEADS.map((l, i) => h(React.Fragment, { key: l.id }, leadRow(l), i < LEADS.length - 1 && h('div', { style: { height: 1, background: 'var(--color-border)', margin: '0 16px' } })))));
  }
  function chip(label, on) {
    return h('span', { style: { fontSize: 12, fontWeight: on ? 600 : 500, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
      background: on ? 'var(--color-primary)' : 'var(--color-chrome-subtle)',
      color: on ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)' } }, label);
  }

  /* ---------- detail pane ---------- */
  function kv(k, v, mono) {
    return h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', fontSize: 13 } },
      h('span', { className: 'text-muted-foreground' }, k),
      h('span', { className: (mono ? 'font-mono' : 'font-data') + ' tabular-nums', style: { fontWeight: 500, textAlign: 'right' } }, v));
  }
  function detailPane(l) {
    return h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--color-background)' } },
      // header
      h('div', { style: { flex: '0 0 auto', padding: '20px 26px 16px', borderBottom: '1px solid var(--color-border)' } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
          h('div', { style: { flex: 1 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              h('span', { className: 'font-display', style: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' } }, l.name),
              stageBadge(l.stage), l.hot && h(Badge, { tone: 'deviation' }, 'Horký')),
            h('div', { className: 'text-muted-foreground', style: { fontSize: 13, marginTop: 4, display: 'flex', gap: 12, alignItems: 'center' } },
              h('span', { className: 'font-mono' }, l.id),
              h('span', null, '·'), srcBadge(l.src),
              h('span', null, '·'), h('span', null, l.ago))),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(Button, { variant: 'ghost', size: 'sm' }, 'Volat'),
            h(Button, { variant: 'copper' }, 'Vytvořit nabídku'))),
        // quick contact strip
        h('div', { style: { display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' } },
          contact('post', l.phone), contact('draft', l.email), contact('pin', l.obec))),
      // body
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '18px 26px', display: 'flex', gap: 22,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
        // left: config summary
        h('div', { style: { width: 300, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 14 } },
          h('div', { style: { height: 200, display: 'flex' } }, h(Stage3D, { mode: '3d', ral: l.ral, height: 200, minimal: true })),
          h('div', { className: 'bg-chrome rounded-card', style: { padding: 16, boxShadow: 'var(--shadow-soft)' } },
            h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, 'Poptávaná sestava'),
            kv('Produkt', l.product), h(Separator, {}),
            kv('Rozměr', l.dim), h(Separator, {}),
            kv('Odstín', 'RAL ' + l.ral), h(Separator, {}),
            kv('Orientačně od', money(l.from) + ' Kč bez DPH'))),
        // right: tabs
        h('div', { style: { flex: 1, minWidth: 0 } },
          h(Tabs, { defaultValue: 'prehled' },
            h(TabsList, null,
              h(TabsTrigger, { value: 'prehled' }, 'Přehled'),
              h(TabsTrigger, { value: 'aktivita' }, 'Aktivita'),
              h(TabsTrigger, { value: 'poznamky' }, 'Poznámky')),
            h(TabsContent, { value: 'prehled' },
              h('div', { style: { paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 16 } },
                l.note
                  ? h('div', { className: 'rounded-control', style: { padding: '13px 15px', background: 'var(--color-chrome-subtle)', fontSize: 13, lineHeight: 1.5 } },
                      h('div', { className: 'text-muted-foreground', style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 5 } }, 'Zpráva od zákazníka'), l.note)
                  : h('div', { className: 'text-muted-foreground', style: { fontSize: 13, fontStyle: 'italic' } }, 'Bez poznámky od zákazníka.'),
                h('div', null,
                  h('div', { style: { fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', fontWeight: 600, marginBottom: 6 } }, 'Triáž'),
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                    kv('Zdroj', l.src === 'mobil' ? 'Mobilní konfigurátor' : 'Web konfigurátor'), h(Separator, {}),
                    kv('Dojezd z dílny', l.obec + ' · ~28 min'), h(Separator, {}),
                    kv('Odhad marže', '32 %'), h(Separator, {}),
                    kv('Přiřazeno', 'Nepřiřazeno'))),
                h('div', { style: { display: 'flex', gap: 10 } },
                  h(Button, { variant: 'default' }, 'Označit kontaktováno'),
                  h(Button, { variant: 'ghost' }, 'Přiřadit sobě')))),
            h(TabsContent, { value: 'aktivita' },
              h('div', { style: { paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 0 } },
                timeline('upRight', 'Poptávka přijata', l.ago + ' · ' + (l.src === 'mobil' ? 'mobilní konfigurátor' : 'web konfigurátor')),
                timeline('draft', 'Odeslán automatický e-mail', l.ago + ' · potvrzení příjmu'),
                timeline('check', 'Čeká na triáž', 'nyní', true))),
            h(TabsContent, { value: 'poznamky' },
              h('div', { style: { paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
                h(Textarea, { rows: 4, placeholder: 'Interní poznámka k poptávce…' }),
                h('div', { style: { display: 'flex' } }, h(Button, { variant: 'default', size: 'sm' }, 'Uložit poznámku')))))))); 
  }
  function contact(icon, val) {
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13 } },
      h('span', { className: 'text-muted-foreground', style: { display: 'inline-flex' } }, I(icon, 15)),
      h('span', { className: 'font-data' }, val));
  }
  function timeline(icon, title, sub, last) {
    return h('div', { style: { display: 'flex', gap: 12, position: 'relative', paddingBottom: last ? 0 : 18 } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' } },
        h('span', { style: { width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', flex: '0 0 auto',
          background: last ? 'var(--color-copper)' : 'var(--color-chrome-subtle)', color: last ? 'var(--color-copper-foreground)' : 'var(--color-muted-foreground)' } }, I(icon, 15)),
        !last && h('span', { style: { flex: 1, width: 2, background: 'var(--color-border)', marginTop: 2 } })),
      h('div', { style: { paddingTop: 3 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, title),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12, marginTop: 1 } }, sub)));
  }

  /* ---------- FRAME — inbox (list + detail) ---------- */
  function FrameInbox() {
    const sel = LEADS.find(l => l.sel);
    return frameShell(1440, 900, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        sideNav('leads'),
        masterList('all'),
        detailPane(sel)),
    ], 'Inbox — Poptávky');
  }

  /* ---------- FRAME — empty state ---------- */
  function FrameEmpty() {
    return frameShell(1440, 900, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        sideNav('leads'),
        masterList('new'),
        h('div', { style: { flex: 1, minWidth: 0, display: 'grid', placeItems: 'center', padding: 40, background: 'var(--color-background)' } },
          h('div', { style: { maxWidth: 360, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 } },
            h('span', { style: { width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--color-chrome)', boxShadow: 'var(--shadow-soft)', color: 'var(--color-muted-foreground)' } }, I('post', 26)),
            h('div', { className: 'font-display', style: { fontSize: 19, fontWeight: 600 } }, 'Vyberte poptávku'),
            h('p', { className: 'text-muted-foreground', style: { margin: 0, fontSize: 13.5, lineHeight: 1.5 } },
              'Zvolte poptávku ze seznamu vlevo pro zobrazení sestavy, kontaktu a triáže. Nové poptávky z konfigurátoru sem chodí automaticky.'),
            h(Button, { variant: 'ghost', size: 'sm' }, 'Nastavit pravidla přiřazení')))),
    ], 'Inbox — prázdný detail');
  }

  /* ============================================================
     TABLET — landscape triage (icon sidenav, list + detail)
     ============================================================ */
  function tabletSideNav() {
    const item = (icon, on, count) => h('div', { title: '', style: { position: 'relative', width: 44, height: 44, borderRadius: 'var(--radius-control)',
      display: 'grid', placeItems: 'center', cursor: 'pointer',
      background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-muted-foreground)' } },
      I(icon, 20),
      count != null && h('span', { className: 'font-data', style: { position: 'absolute', top: 4, right: 4, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 999, fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', background: 'var(--color-copper)', color: 'var(--color-copper-foreground)' } }, count));
    return h('div', { style: { width: 68, flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 0',
      borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { width: 30, height: 30, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, marginBottom: 8 } }, 'P'),
      item('post', true, 2), item('draft', false, null), item('list', false), item('cube', false),
      h('div', { style: { marginTop: 'auto' } }, item('scale', false)));
  }
  function FrameTablet() {
    const sel = LEADS.find(l => l.sel);
    return frameShell(1194, 834, [
      h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } },
        tabletSideNav(),
        masterList('all'),
        detailPane(sel)),
    ], 'Inbox tablet — triáž');
  }

  /* ============================================================
     MOBILE — master list screen + detail screen (phone frames)
     ============================================================ */
  const MW = 390, MH = 844;
  function phone(kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: MW, height: MH, background: 'var(--color-background)', borderRadius: 44, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', position: 'relative',
      boxShadow: 'var(--shadow-soft-lg)', border: '10px solid #17140f', outline: '1px solid var(--color-border)' } },
      h('div', { style: { flex: '0 0 auto', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 26px', background: 'var(--color-chrome)', fontSize: 13, fontWeight: 600 } },
        h('span', { className: 'font-data tabular-nums' }, '9:41'),
        h('span', { style: { position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)', width: 108, height: 26, background: '#17140f', borderRadius: 20 } }),
        h('span', { className: 'font-data', style: { fontSize: 12 } }, '5G')),
      keyed(kids, 'mob'));
  }
  // compact list row for phone
  function mobRow(l) {
    return h('div', { key: l.id, style: { display: 'flex', alignItems: 'flex-start', gap: 11, padding: '13px 4px',
      borderBottom: '1px solid var(--color-border)' } },
      h('span', { style: { width: 8, height: 8, borderRadius: 999, flex: '0 0 auto', marginTop: 5, background: l.stage === 'new' ? 'var(--color-copper)' : 'transparent' } }),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 14, fontWeight: 600 } }, l.name),
          l.hot && h(Badge, { tone: 'deviation' }, 'Horký'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5, marginLeft: 'auto', whiteSpace: 'nowrap' } }, l.ago)),
        h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.product + ' · ' + l.dim),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
          stageBadge(l.stage), srcBadge(l.src),
          h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12.5, fontWeight: 600 } }, 'od ' + money(l.from) + ' Kč'))),
      h('span', { className: 'text-muted-foreground', style: { flex: '0 0 auto', marginTop: 6 } }, I('chevron', 15)));
  }
  function FrameMobileList() {
    return phone([
      // app header
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', padding: '10px 18px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 } }, 'P'),
          h('span', { className: 'font-display', style: { fontSize: 17, fontWeight: 600 } }, 'Poptávky'),
          h('span', { className: 'font-data tabular-nums text-muted-foreground', style: { fontSize: 13 } }, LEADS.length),
          h('div', { style: { marginLeft: 'auto' } }, h(IconButton, { size: 'md', 'aria-label': 'Filtr' }, I('list', 16)))),
        h(Input, { placeholder: 'Hledat…' }),
        h('div', { style: { display: 'flex', gap: 6, overflow: 'hidden' } }, chip('Vše', true), chip('Nové', false), chip('Rozpracované', false))),
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '0 18px', maskImage: 'linear-gradient(to bottom, black calc(100% - 14px), transparent)' } },
        LEADS.map(mobRow)),
      // bottom tab bar
      mobTabBar('post'),
    ], 'Mobil inbox — seznam');
  }
  function mobTabBar(active) {
    const t = (icon, label, on) => h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: on ? 600 : 500, color: on ? 'var(--color-copper)' : 'var(--color-muted-foreground)' } }, I(icon, 20), label);
    return h('div', { style: { flex: '0 0 auto', display: 'flex', padding: '10px 8px calc(10px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      t('post', 'Poptávky', active === 'post'), t('draft', 'Nabídky', false), t('list', 'Zakázky', false), t('cube', 'Katalog', false));
  }
  function FrameMobileDetail() {
    const l = LEADS.find(x => x.sel);
    return phone([
      // detail header w/ back
      h('div', { className: 'bg-chrome', style: { flex: '0 0 auto', padding: '8px 12px 12px', borderBottom: '1px solid var(--color-border)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(IconButton, { size: 'md', 'aria-label': 'Zpět' }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, I('chevron', 16))),
          h('span', { className: 'font-mono text-muted-foreground', style: { fontSize: 12 } }, l.id),
          h('div', { style: { marginLeft: 'auto' } }, srcBadge(l.src))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, padding: '10px 4px 0' } },
          h('span', { className: 'font-display', style: { fontSize: 21, fontWeight: 600 } }, l.name),
          stageBadge(l.stage), l.hot && h(Badge, { tone: 'deviation' }, 'Horký'))),
      // scroll body
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 12px), transparent)' } },
        h('div', { style: { height: 160, display: 'flex' } }, h(Stage3D, { mode: '3d', ral: l.ral, height: 160, minimal: true })),
        h('div', { className: 'bg-chrome rounded-card', style: { padding: 14, boxShadow: 'var(--shadow-soft)' } },
          h('div', { className: 'font-display', style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, 'Poptávaná sestava'),
          kv('Produkt', l.product), h(Separator, {}), kv('Rozměr', l.dim), h(Separator, {}), kv('Odstín', 'RAL ' + l.ral), h(Separator, {}), kv('Orientačně od', money(l.from) + ' Kč bez DPH')),
        // contact quick-actions
        h('div', { style: { display: 'flex', gap: 10 } },
          h(Button, { variant: 'default', size: 'sm', style: { flex: 1 } }, 'Volat'),
          h(Button, { variant: 'default', size: 'sm', style: { flex: 1 } }, 'E-mail'),
          h(Button, { variant: 'default', size: 'sm', style: { flex: 1 } }, 'Mapa')),
        l.note && h('div', { className: 'rounded-control', style: { padding: '12px 14px', background: 'var(--color-chrome-subtle)', fontSize: 12.5, lineHeight: 1.5 } },
          h('div', { className: 'text-muted-foreground', style: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 5 } }, 'Zpráva od zákazníka'), l.note),
        h('div', null,
          h('div', { style: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', fontWeight: 600, marginBottom: 4 } }, 'Triáž'),
          kv('Dojezd z dílny', l.obec + ' · ~28 min'), h(Separator, {}), kv('Odhad marže', '32 %'), h(Separator, {}), kv('Přiřazeno', 'Nepřiřazeno'))),
      // sticky action
      h('div', { style: { flex: '0 0 auto', padding: '12px 18px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', gap: 10 } },
        h(Button, { variant: 'ghost' }, 'Kontaktováno'),
        h(Button, { variant: 'copper', style: { flex: 1 } }, 'Vytvořit nabídku')),
    ], 'Mobil inbox — detail');
  }

  const FR = { INBOX: FrameInbox, EMPTY: FrameEmpty, TABLET: FrameTablet, MOBLIST: FrameMobileList, MOBDETAIL: FrameMobileDetail };
  window.PConfInboxFrames = FR;
  window.PConfInboxMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('inbox-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
