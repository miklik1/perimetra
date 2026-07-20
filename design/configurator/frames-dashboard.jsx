/* Perimetra — internal owner dashboard (přehled). Ties the pipeline together.
   Pipeline funnel, KPIs, revenue, upcoming, recent activity. Desktop + tablet. Prices bez DPH. */
(function () {
  const { h, UI, I, money } = window.PConf;
  const { Badge, Button, IconButton, Separator, StatCard, Panel, DisplayLabel } = UI;

  function keyed(kids, p) {
    return (Array.isArray(kids) ? kids : [kids]).map((c, i) =>
      c && typeof c === 'object' && c.key == null ? React.cloneElement(c, { key: p + i }) : c);
  }
  function frameShell(w, hgt, kids, label) {
    return h('div', { 'data-screen-label': label, className: 'font-sans text-foreground', style: {
      width: w, height: hgt, background: 'var(--color-background)', borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-soft-lg)', border: '1px solid var(--color-border)' } }, keyed(kids, 's'));
  }

  function sideNav(collapsed) {
    if (collapsed) {
      const it = (icon, on) => h('div', { style: { width: 44, height: 44, borderRadius: 'var(--radius-control)', display: 'grid', placeItems: 'center', cursor: 'pointer', background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-muted-foreground)' } }, I(icon, 20));
      return h('div', { style: { width: 68, flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '16px 0', borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
        h('div', { style: { width: 30, height: 30, borderRadius: 8, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, marginBottom: 8 } }, 'P'),
        it('layers', true), it('post'), it('draft'), it('list'), it('cube'), h('div', { style: { marginTop: 'auto' } }, it('scale')));
    }
    const item = (icon, label, count, on) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 'var(--radius-control)', fontSize: 13.5, fontWeight: on ? 600 : 500, cursor: 'pointer', background: on ? 'var(--color-nav-active)' : 'transparent', color: on ? 'var(--color-nav-active-foreground)' : 'var(--color-foreground)' } },
      h('span', { style: { display: 'inline-flex', opacity: on ? 1 : 0.7 } }, I(icon, 17)), h('span', null, label),
      count != null && h('span', { className: 'font-data tabular-nums', style: { marginLeft: 'auto', fontSize: 12, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: on ? 'rgba(255,255,255,.2)' : 'var(--color-chrome-subtle)', color: on ? 'inherit' : 'var(--color-muted-foreground)' } }, count));
    return h('div', { style: { width: 220, flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRight: '1px solid var(--color-border)', background: 'var(--color-chrome)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 14px' } },
        h('div', { style: { width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 } }, 'P'),
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Perimetra')),
      item('layers', 'Přehled', null, true), item('post', 'Poptávky', 2), item('draft', 'Nabídky', 5), item('list', 'Zakázky', 3), item('cube', 'Katalog'),
      h('div', { style: { marginTop: 'auto' } }, item('scale', 'Nastavení')));
  }

  /* KPI tile */
  function kpi(label, val, delta, up) {
    return h('div', { className: 'bg-chrome rounded-card', style: { flex: 1, padding: '16px 18px', boxShadow: 'var(--shadow-soft-sm)' } },
      h('div', { className: 'text-muted-foreground', style: { fontSize: 12.5 } }, label),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 5 } },
        h('span', { className: 'font-data tabular-nums', style: { fontSize: 26, fontWeight: 600 } }, val),
        delta && h('span', { style: { fontSize: 12, fontWeight: 600, color: up ? 'var(--color-success)' : 'var(--color-muted-foreground)' } }, delta)));
  }

  /* pipeline funnel */
  const FUNNEL = [
    { label: 'Poptávky', n: 24, val: 1180, tone: 'var(--color-copper)' },
    { label: 'Nabídky', n: 14, val: 812, tone: 'var(--color-spotlight)' },
    { label: 'Objednáno', n: 7, val: 402, tone: 'var(--color-info)' },
    { label: 'Vyfakturováno', n: 5, val: 214, tone: 'var(--color-success)' },
  ];
  function funnel() {
    const max = FUNNEL[0].n;
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: 20, boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column', gap: 14 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Prodejní trychtýř'),
        h('span', { className: 'text-muted-foreground', style: { fontSize: 12 } }, 'červenec 2026')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        FUNNEL.map((f, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 14 } },
          h('span', { style: { width: 96, fontSize: 12.5, flex: '0 0 auto' } }, f.label),
          h('div', { style: { flex: 1, height: 30, borderRadius: 'var(--radius-inset)', background: 'var(--color-chrome-subtle)', overflow: 'hidden', position: 'relative' } },
            h('div', { style: { width: (f.n / max * 100) + '%', height: '100%', background: f.tone, borderRadius: 'var(--radius-inset)', display: 'flex', alignItems: 'center', paddingLeft: 10 } },
              h('span', { className: 'font-data tabular-nums', style: { fontSize: 12.5, fontWeight: 600, color: '#fff' } }, f.n))),
          h('span', { className: 'font-data tabular-nums', style: { width: 96, textAlign: 'right', fontSize: 12.5, flex: '0 0 auto', fontWeight: 500 } }, money(f.val) + ' tis.')))));
  }

  /* revenue bars (last 6 months) */
  const REV = [[176, 'úno'], [203, 'bře'], [188, 'dub'], [231, 'kvě'], [209, 'čvn'], [214, 'čvc']];
  function revenue() {
    const max = 240;
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: 20, boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
        h('div', null,
          h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Tržby'),
          h('div', { className: 'font-data tabular-nums', style: { fontSize: 22, fontWeight: 600, marginTop: 4 } }, money(1221000) + ' Kč'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5 } }, 'posledních 6 měsíců · bez DPH')),
        h(Badge, { tone: 'success' }, '+11 %')),
      h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 12, height: 110, paddingTop: 6 } },
        REV.map(([v, m], i) => h('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' } },
          h('div', { style: { width: '100%', maxWidth: 34, height: (v / max * 100) + '%', borderRadius: '6px 6px 3px 3px', background: i === REV.length - 1 ? 'var(--color-copper)' : 'var(--color-spotlight)' } }),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11 } }, m)))));
  }

  /* upcoming list */
  const UPCOMING = [
    { icon: 'ruler', title: 'Doměření — L. Horáková', sub: 'zítra 9:00 · Jesenice', tone: 'info' },
    { icon: 'pin', title: 'Montáž — E. Marešová', sub: 'pá 18. 7. · Vestec', tone: 'warning' },
    { icon: 'scale', title: 'Doplatek — K. Němec', sub: 'splatnost 20. 7.', tone: 'neutral' },
    { icon: 'draft', title: 'Nabídka vyprší — P. Svoboda', sub: 'za 3 dny', tone: 'neutral' },
  ];
  function upcoming() {
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: 20, boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Nadcházející'),
        h(Button, { variant: 'link', size: 'sm' }, 'Kalendář')),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        UPCOMING.map((u, i) => h('div', { key: i },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0' } },
            h('span', { style: { width: 32, height: 32, borderRadius: 9, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--color-chrome-subtle)', color: 'var(--color-copper)' } }, I(u.icon, 16)),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, u.title),
              h('div', { className: 'text-muted-foreground', style: { fontSize: 12 } }, u.sub))),
          i < UPCOMING.length - 1 && h(Separator, {})))));
  }

  /* recent activity */
  const ACT = [
    ['post', 'Nová poptávka — M. Dvořáková', 'před 1 h'],
    ['check', 'Objednávka přijata — J. Novák', 'dnes 9:12'],
    ['scale', 'Záloha 24 125 Kč přijata', 'dnes 14:30'],
    ['draft', 'Nabídka N-2026-0511 odeslána', 'včera'],
  ];
  function activity() {
    return h('div', { className: 'bg-chrome rounded-card', style: { padding: 20, boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column', gap: 12 } },
      h('span', { className: 'font-display', style: { fontSize: 15, fontWeight: 600 } }, 'Poslední aktivita'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        ACT.map(([icon, title, ago], i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('span', { style: { width: 28, height: 28, borderRadius: 999, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--color-chrome-subtle)', color: 'var(--color-muted-foreground)' } }, I(icon, 14)),
          h('span', { style: { flex: 1, fontSize: 13 } }, title),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 11.5, whiteSpace: 'nowrap' } }, ago)))));
  }

  function content(tablet) {
    return h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 } },
      // topbar
      h('div', { style: { flex: '0 0 auto', padding: '20px 28px 18px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-chrome)', display: 'flex', alignItems: 'center', gap: 14 } },
        h('div', null,
          h(DisplayLabel, { as: 'h2' }, 'Dobré ráno, Pavle'),
          h('span', { className: 'text-muted-foreground', style: { fontSize: 13 } }, 'úterý 14. července 2026 · přehled dílny')),
        h('div', { style: { flex: 1 } }),
        h(Button, { variant: 'ghost', size: 'sm' }, 'Report'),
        h(Button, { variant: 'copper', size: 'sm' }, 'Nová nabídka')),
      // scroll
      h('div', { style: { flex: '1 1 auto', overflow: 'hidden', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16,
        maskImage: 'linear-gradient(to bottom, black calc(100% - 16px), transparent)' } },
        // KPI row
        h('div', { style: { display: 'flex', gap: 14 } },
          kpi('Nové poptávky', '2', '+2 dnes', true),
          kpi('Aktivní zakázky', '3', null),
          kpi('Čeká na doplatek', money(24125) + ' Kč', null),
          kpi('Tržby 7/26', money(214000) + ' Kč', '+11 %', true)),
        // two-col: funnel + revenue
        h('div', { style: { display: 'grid', gridTemplateColumns: tablet ? '1fr' : '1.25fr 1fr', gap: 16 } }, funnel(), revenue()),
        // two-col: upcoming + activity
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } }, upcoming(), activity())));
  }

  function FrameDesktop() {
    return frameShell(1440, 940, [h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } }, sideNav(false), content(false))], 'Přehled — desktop');
  }
  function FrameTablet() {
    return frameShell(1024, 1180, [h('div', { style: { flex: 1, display: 'flex', minHeight: 0 } }, sideNav(true), content(true))], 'Přehled — tablet');
  }

  const FR = { DESKTOP: FrameDesktop, TABLET: FrameTablet };
  window.PConfDashFrames = FR;
  window.PConfDashMount = () => {
    Object.keys(FR).forEach(k => { const el = document.getElementById('d-' + k); if (el) ReactDOM.createRoot(el).render(h(FR[k])); });
  };
})();
