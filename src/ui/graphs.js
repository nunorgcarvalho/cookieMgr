// The Stats page (page id 'graphs', its name until v3.47): sub-tabs of plots (ui/plot.js) over the
// recorded states, and of statistics cards (ui/statsPage.js — the old Stats page, now merged in).
//
//   Cookies   CpS (production + clicking, unbuffed line, effects, events) with an averages table,
//             Bank flows (everything that moved the bank, by category — "Actual CpS" until the
//             Actual income tab), the Cookie bank (cumulative), and Income outside CpS (ui/eventsPage.js)
//   Actual income  what you really baked a second, by source — the income payback periods count in
//             (features/payback.js: the Actual income window, picked here too), a table of it over
//             spans of play, and its widget (ui/widgetTypes.js)
//   Prestige  the prestige statistics, a target, prestige level if you ascended now, levels gained per hour
//   Golden    what golden cookies and spells pay and the bank it takes, when the next one comes
//   What if   every Pantheon spirit and dragon aura, the CpS each would bring
//   Upgrades & achievements   every one in the game, the ones you have lit up (a chip: only the rest)
//   Misc      timers, wrinklers, what's still to collect
//
// Sources are colored the same everywhere: production, clicking, golden cookies & reindeer, other.

CA.UI = CA.UI || {};

CA.UI.Graphs = (() => {
  const P = () => CA.UI.Plot;
  const F = () => CA.UI.Plot.fmt;
  const S = () => CA.Settings;
  const esc = (s) => CA.Util.escapeHtml(s);
  const SEC = 1000;
  const SESSION_START = CA.UI.Plot.SESSION_START;

  const WINDOWS = [60, 300, 900, 3600, 10800, 43200, 86400, 604800, 0];
  const LONG_WINDOWS = [900, 3600, 10800, 43200, 86400, 604800, 0];

  const SOURCES = [
    { key: 'earnProduction', name: 'Production', color: '#f5c451' },
    { key: 'earnClick', name: 'Clicking', color: '#7fe08b' },
    { key: 'earnGolden', name: 'Golden cookies & reindeer', color: '#ff9f43' },
    { key: 'earnOther', name: 'Other', color: '#b39ddb' },
  ];

  // The ledger categories (features/gameStates.js): every change to the bank, in and out. Building
  // CpS and clicking also have a "boost" part — the extra from CpS effects (Frenzy, Click frenzy…).
  const CATS = [
    { id: 'build', name: 'Building CpS', icon: 'building', color: '#f5c451', boostColor: '#fff0b0', in: 'lBuild', boost: 'lBuildBoost' },
    { id: 'click', name: 'Clicking', icon: 'cookie', color: '#7fe08b', boostColor: '#d2ffd8', in: 'lClick', boost: 'lClickBoost' },
    { id: 'drops', name: 'Drops', icon: 'sparkle', color: '#ff9f43', boostColor: '#ffd9ae', outColor: '#b8651b', in: 'lDropsIn', boost: 'lDropsBoost', out: 'lDropsOut', words: ['lost'] },
    { id: 'stocks', name: 'Stock trades', icon: 'stocks', color: '#4fd6e0', outColor: '#2a8a93', in: 'lStocksIn', out: 'lStocksOut', words: ['bought', 'sold'] },
    { id: 'buildings', name: 'Buildings', icon: 'building', color: '#ff7a59', outColor: '#b8442a', in: 'lBldIn', out: 'lBldOut', words: ['bought', 'sold'] },
    { id: 'upgrades', name: 'Upgrades', icon: 'upgrade', color: '#c77dff', outColor: '#8a46c4', out: 'lUpgOut', words: ['bought'] },
    { id: 'other', name: 'Other', icon: 'puzzle', color: '#9db4cc', outColor: '#5f7590', in: 'lOtherIn', out: 'lOtherOut', words: ['out', 'in'] },
    // outside the bank — what your stocks would sell for now; off by default so the Cookie bank
    // chart stays the bank (turn it on and it becomes bank + stocks)
    { id: 'equity', name: 'Stock equity', icon: 'stocks', color: '#a6e35a', outColor: '#5e8a2a', in: 'lEquityUp', out: 'lEquityDown', words: ['down', 'up'], offByDefault: true },
  ];
  const LEDGER_FIELDS = [].concat(...CATS.map((c) => [c.in, c.boost, c.out].filter(Boolean)));
  const C_CPS = '#f5c451';
  const C_CLICK = '#7fe08b';
  const C_BASE = '#9db4cc';
  const C_SHOWN = '#ffffff';

  // `plots`: its charts (and then the chart options); `top`: cards above them (statistics from ui/statsPage.js —
  // not loaded where the page is hosted without the game, the simulator's GUI: its tabs then don't show)
  const SP = () => CA.UI.StatsPage;
  const cards = (tab) => (SP() ? SP().html(tab) : '');
  // `parts`: cards below the charts, each with html/mount/unmount/tick
  const INCOME = () => CA.UI.EventsPage && CA.UI.EventsPage.income;
  const ALL_TABS = [
    { id: 'cookies', label: 'Cookies', icon: 'cookie', plots: ['cps', 'actual', 'ledgerCum'], parts: () => [INCOME()].filter(Boolean) },
    { id: 'income', label: 'Actual income', icon: 'bolt', plots: ['income'], top: () => paybackCardHtml() },
    { id: 'prestige', label: 'Prestige', icon: 'ascend', plots: ['prestige', 'prestigeRate'], top: () => cards('prestige') + targetCardHtml() },
    { id: 'golden', label: 'Golden cookies', icon: 'sparkle', plots: [], top: () => cards('golden') },
    { id: 'whatif', label: 'What if', icon: 'pantheon', plots: [], top: () => cards('whatif') },
    { id: 'collection', label: 'Upgrades & achievements', icon: 'trophy', plots: [], top: () => cards('collection') },
    { id: 'misc', label: 'Misc', icon: 'puzzle', plots: [], top: () => cards('misc') },
  ];
  const tabs = () => ALL_TABS.filter((t) => t.plots.length || SP());

  // ---- shared overlays --------------------------------------------------------------------

  function intervalTip(iv) {
    const { span, clock, row, swatch } = F();
    const end = iv.end || Date.now();
    let h = `<div class="ca-tip-head">${swatch(CA.History.colorFor(iv.name))}${esc(iv.label)}<span>${iv.end ? '' : 'active'}</span></div>`;
    if (iv.desc) h += `<div class="ca-tip-note">${esc(iv.desc)}</div>`;
    h += row('transparent', 'Effect', mults(iv));
    h += row('transparent', 'Lasted', span((end - iv.start) / SEC) + (iv.end ? '' : ' so far'));
    h += row('transparent', 'Started', clock(iv.start, true));
    if (iv.end) h += row('transparent', 'Ended', clock(iv.end, true));
    return h;
  }
  const trim = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);
  function mults(iv) {
    const bits = [];
    if (Math.abs(iv.multCps - 1) > 0.001) bits.push(`×${trim(iv.multCps)} CpS`);
    if (Math.abs(iv.multClick - 1) > 0.001) bits.push(`×${trim(iv.multClick)} clicks`);
    return bits.length ? bits.join(', ') : 'no CpS change';
  }

  /** Golden cookie effects active in the view, as plot intervals (shading + lanes). */
  function effects(v) {
    if (!S().get('graphEffects')) return [];
    const now = Date.now();
    return CA.History.intervalsIn(v.tAt(v.x0), v.tAt(v.x1)).map((iv) => ({
      x0: v.xAt(iv.start),
      x1: v.xAt(iv.end || now),
      color: CA.History.colorFor(iv.name),
      label: iv.label,
      icon: iv.icon,
      tip: () => intervalTip(iv),
      // what it multiplies, for the hover readout (combined with the others active there)
      mults: { CpS: iv.multCps, clicks: iv.multClick },
      iv,
    }));
  }

  function eventTip(ev) {
    const { swatch, clock, row, beautify } = F();
    const type = CA.EventLog.types()[ev.type] || {};
    let h = `<div class="ca-tip-head">${swatch(type.color || '#fff')}${CA.UI.C.withUpgrade(ev.title, ev.data && ev.data.upgrade)}<span>${clock(ev.t, true)}</span></div>`;
    if (ev.text) h += `<div class="ca-tip-note">${esc(ev.text)}</div>`;
    if (Math.abs(ev.cookies) >= 1)
      h += row('transparent', ev.cookies >= 0 ? 'Cookies gained' : 'Cookies spent', (ev.cookies >= 0 ? '+' : '−') + beautify(Math.abs(ev.cookies)));
    return h;
  }

  /** Event markers for `types`; golden/wrath pops already visible as an effect band are skipped. */
  function markers(v, types, ivs) {
    if (!S().get('graphEvents')) return [];
    const TOL = 3 * SEC;
    return CA.EventLog.list(types)
      .filter((e) => {
        const x = v.active ? e.a : e.t;
        if (x < v.x0 || x > v.x1) return false;
        return !((e.type === 'golden' || e.type === 'wrath') && (ivs || []).some((iv) => Math.abs(iv.iv.start - e.t) < TOL));
      })
      .map((e) => ({
        x: v.active ? e.a : e.t,
        color: (CA.EventLog.types()[e.type] || {}).color || '#fff',
        tip: () => eventTip(e),
      }));
  }

  /** A flow as a per-second rate over the seconds it was actually measured. */
  const coverOf = (b, k) => (b.cover && b.cover[k] > 0 ? b.cover[k] : b.secs);
  const rate = (b, k) => (Number.isFinite(b.v[k]) && coverOf(b, k) > 0 ? b.v[k] / coverOf(b, k) : 0);

  function cumulativeStart(v) {
    return v.opt('from') === 'session' ? Math.max(v.x0, v.xAt(SESSION_START)) : v.x0;
  }
  const FROM = {
    key: 'from',
    label: 'From',
    default: 'session',
    options: [
      { v: 'session', label: 'This session', title: 'Since cookieMgr was loaded in this tab' },
      { v: 'window', label: 'Window start', title: 'From the left edge of the chart' },
    ],
  };

  const recent = (seconds) => CA.Recorder.recent(seconds); // core/recorder.js

  // ---- Cookies tab --------------------------------------------------------------------------

  const cpsPlot = () =>
    P().create({
      id: 'cps',
      title: 'Cookies per second',
      icon: 'graphs',
      windows: WINDOWS,
      window: 300,
      stacked: true,
      unit: '/s',
      smooth: 5,
      build(v) {
        const bars = v.bucketize(['cps', 'click', 'base']);
        const ivs = effects(v);
        let w = 0;
        let sum = 0;
        bars.forEach((b) => {
          if (Number.isFinite(b.v.cps)) {
            sum += b.v.cps * b.secs;
            w += b.secs;
          }
        });
        const avg = w ? sum / w : NaN;
        return {
          series: [
            { key: 'cps', name: 'Production', color: C_CPS, type: 'bar' },
            { key: 'click', name: 'Clicking', color: C_CLICK, type: 'bar' },
            { key: 'base', name: 'Unbuffed CpS', color: C_BASE, type: 'line', dash: true, width: 1.4 },
          ],
          bars: bars.map((b) => ({ x0: b.x0, x1: b.x1, parts: { cps: b.v.cps || 0, click: b.v.click || 0 }, raw: b })),
          lines: { base: P().linePoints(bars, (b) => b.v.base) },
          hlines: Number.isFinite(avg) ? [{ v: avg, label: `avg ${F().beautify(avg)}/s` }] : [],
          intervals: ivs,
          markers: markers(v, ['golden', 'wrath', 'reindeer'], ivs),
          legendExtra: effectLegend(ivs),
          avg,
        };
      },
      stats(v, data) {
        const { tile, beautify, clock } = F();
        const frames = v.frames.filter((f) => f[v.key] > v.x0 && f[v.key] <= v.x1);
        let peak = 0;
        let peakT = 0;
        let w = 0;
        let click = 0;
        frames.forEach((f) => {
          if ((f.cps || 0) >= peak) {
            peak = f.cps || 0;
            peakT = f.t;
          }
          click += (f.click || 0) * (f.dt || 0);
          w += f.dt || 0;
        });
        const last = CA.Recorder.frames()[CA.Recorder.frames().length - 1];
        const avg = data.avg || 0;
        const avgClick = w ? click / w : 0;
        return (
          tile('Now', beautify(last ? last.cps : 0) + '/s', last && last.click > 0.01 ? '+' + beautify(last.click) + ' from clicks' : '') +
          tile('Average', beautify(avg) + '/s', 'this window') +
          tile('Peak', beautify(peak) + '/s', peakT ? clock(peakT, true) : '') +
          tile('Clicking', beautify(avgClick) + '/s', avg + avgClick > 0 ? Math.round((avgClick / (avg + avgClick)) * 100) + '% of income' : '')
        );
      },
      footer: () => averagesTable(),
    });

  function effectLegend(ivs) {
    const counts = new Map();
    ivs.forEach(({ iv }) => counts.set(iv.name, { iv, n: (counts.get(iv.name) || { n: 0 }).n + 1 }));
    if (!counts.size) return '<span class="ca-legend-empty">Golden cookie effects will show up here.</span>';
    return [...counts.values()]
      .map(({ iv, n }) => `<span class="ca-legend-item">${F().swatch(CA.History.colorFor(iv.name))}${esc(iv.label)}${n > 1 ? ` <em>×${n}</em>` : ''}</span>`)
      .join('');
  }

  const TABLE_COLS = [
    { s: 0, label: 'Now' },
    { s: 60, label: '1 min' },
    { s: 300, label: '5 min' },
    { s: 900, label: '15 min' },
    { s: 3600, label: '1 h' },
    { s: 10800, label: '3 h' },
  ];

  /** A table of measures × time spans; rows: { n?, x?, label, desc, color, fn(r), strong, mult, sign, cls, attrs }
   *  (cls: more row classes, attrs: row attributes, e.g. what clicking it does). */
  function spansTable(rows, vals, cols = TABLE_COLS, cls = '') {
    let h = `<div class="ca-table-wrap"><table class="ca-table ca-stages${cls ? ' ' + cls : ''}"><thead><tr><th>Average over the last…</th>`;
    cols.forEach((c) => (h += `<th>${c.label}</th>`));
    h += '</tr></thead><tbody>';
    rows.forEach((r) => {
      const cls = [r.strong ? 'strong' : '', r.mult ? 'mult' : '', r.sep ? 'sep' : '', r.desc ? '' : 'thin', r.cls || ''].filter(Boolean).join(' ');
      const badge = r.n
        ? `<span class="ca-stage-n" style="background:${r.color}">${r.n}</span>`
        : r.mult
          ? '<span class="ca-stage-n ca-stage-x">×</span>'
          : r.sign
            ? `<span class="ca-stage-n ca-stage-x">${r.sign}</span>`
            : `<span class="ca-stage-n" style="background:${r.color || 'transparent'}"></span>`;
      h += `<tr${cls ? ` class="${cls}"` : ''}${r.attrs ? ' ' + r.attrs : ''}><td>${badge}${esc(r.label)}${r.desc ? `<span class="ca-row-sub">${esc(r.desc)}</span>` : ''}</td>`;
      vals.forEach((val) => (h += `<td>${val ? esc(r.fn(val)) : '—'}</td>`));
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="ca-card-note">Averages always cover the newest stretch of active play, whatever the chart is showing.</div>';
    return h;
  }

  /**
   * The CpS table, as three stages that build on each other:
   *   1 raw production         unbuffed CpS — no golden-cookie effects
   *   2 + raw clicking         plus your clicks per second × what a click is worth with no effects
   *                            (so neither Click frenzy nor a Frenzy's boost to clicks counts)
   *   3 actual                 everything that really got baked: buffed production, buffed
   *                            clicking, golden cookie payouts, wrinklers…
   * and the multipliers between them: what clicking adds, what effects & golden cookies add, total.
   */
  function averagesTable() {
    const { beautify } = F();
    // "Now" = the last 3 seconds: one frame alone is too jumpy (and may be a just-resumed one)
    const vals = TABLE_COLS.map((c) => recent(c.s || 3));
    const stage1 = (r) => r.base;
    const stage2 = (r) => r.base + r.clickRaw;
    const stage3 = (r) => r.actual;
    const times = (a, b) => (b > 0 && Number.isFinite(a) ? `×${(a / b).toFixed(a / b >= 10 ? 1 : 2)}` : '—');
    return spansTable(
      [
        { n: 1, label: 'Raw production', desc: 'CpS with every temporary effect removed', fn: (r) => beautify(stage1(r)) + '/s', color: C_BASE },
        { n: 2, label: '+ raw clicking', desc: 'your clicks per second × a click’s worth with no effects', fn: (r) => beautify(stage2(r)) + '/s', color: C_CLICK },
        { n: 3, label: 'Actual', desc: 'everything really baked: effects, golden cookies, wrinklers…', fn: (r) => beautify(stage3(r)) + '/s', color: SOURCES[2].color, strong: true },
        { label: 'Clicking adds (2 ÷ 1)', fn: (r) => times(stage2(r), stage1(r)), mult: true, sep: true },
        { label: 'Effects & golden add (3 ÷ 2)', fn: (r) => times(stage3(r), stage2(r)), mult: true },
        { label: 'Total (3 ÷ 1)', fn: (r) => times(stage3(r), stage1(r)), mult: true, strong: true },
        { label: 'Clicks per second', fn: (r) => (Number.isFinite(r.clickRate) ? r.clickRate.toFixed(r.clickRate < 10 ? 1 : 0) : '—'), sep: true, color: C_CLICK },
      ],
      vals
    );
  }

  /** Per-second averages of flows over the newest `seconds` of active play, over the seconds
   *  they were actually measured (frames where `gate` is known). */
  function recentFlows(seconds, keys, gate) {
    const frames = CA.Recorder.frames();
    const from = CA.Recorder.activeNow() - seconds * SEC;
    const sum = {};
    keys.forEach((k) => (sum[k] = 0));
    let secs = 0;
    for (let i = frames.length - 1; i >= 0 && frames[i].a > from; i--) {
      const f = frames[i];
      if (!Number.isFinite(f[gate])) continue; // first frame after a gap, or recorded before this existed
      secs += f.dt || 0;
      keys.forEach((k) => (sum[k] += f[k] || 0));
    }
    if (!secs) return null;
    const out = {};
    keys.forEach((k) => (out[k] = sum[k] / secs));
    return out;
  }

  // ---- the ledger: Bank flows and the cookie bank ------------------------------------------
  // One chart of everything that moves the bank, by category — pick which categories, gains
  // and/or losses, and whether the CpS-boosted extra is shown on top of building CpS and
  // clicking — and below it the same, accumulated: the bank. Both share every setting.

  function ledgerView() {
    return {
      cats: CATS.filter((c) => S().get(`cat.${c.id}`) !== false),
      gains: S().get('actualGains') !== false,
      losses: !!S().get('actualLosses'),
      boosted: S().get('cpsBoosted') !== false,
    };
  }

  /** The bar series for what's selected: { key, field, sign, name, color } (key = part key). */
  function ledgerParts() {
    const { cats, gains, losses, boosted } = ledgerView();
    const out = [];
    cats.forEach((c) => {
      // merge: one tooltip row per category, labeled like the tables ("−bought / +sold", "raw / boosted")
      const words = c.words || [];
      if (gains && c.in)
        out.push({
          key: c.id,
          field: c.in,
          sign: 1,
          name: c.boost ? `${c.name}${boosted ? ' (unboosted)' : ''}` : c.name,
          color: c.color,
          merge: { id: c.id, name: c.name, label: c.boost || !words[1] ? 'raw' : `+${words[1]}`, order: 1 },
        });
      if (gains && boosted && c.boost)
        out.push({ key: `${c.id}Boost`, field: c.boost, sign: 1, name: `${c.name}: CpS boost`, color: c.boostColor, boost: true, merge: { id: c.id, name: c.name, label: 'boosted', order: 2, add: c.id } });
      if (losses && c.out)
        out.push({ key: `${c.id}Out`, field: c.out, sign: -1, name: `${c.name} (out)`, color: c.outColor || c.color, merge: { id: c.id, name: c.name, label: `−${words[0] || 'out'}`, order: 0 } });
    });
    return out;
  }

  // `shown`: the Bank flows chart's dashed line of the CpS the game shows can be switched off
  const LEDGER_TOGGLES = (shown) => [
    {
      label: 'Include',
      toggles: CATS.map((c) => ({ setting: `cat.${c.id}`, label: c.name, color: c.color, title: `Include ${c.name.toLowerCase()}` })),
    },
    {
      label: '',
      toggles: [
        { setting: 'actualGains', label: '▲ Gains', title: 'Cookies coming into the bank' },
        { setting: 'actualLosses', label: '▼ Losses', title: 'Cookies leaving the bank' },
        { setting: 'cpsBoosted', label: '✦ CpS-boosted', title: 'Show the extra that CpS effects (Frenzy, Click frenzy…) add to building CpS and clicking, on top of the unboosted part' },
      ].concat(shown ? [{ setting: 'actualShown', label: 'Game’s CpS', color: C_SHOWN, dash: true, title: 'The dashed line: the CpS the game shows, plus clicking (it counts every effect and your clicks). Off: only the bars, e.g. building CpS alone' }] : []),
    },
  ];
  const ledgerEmpty = () => (ledgerParts().length ? 'Collecting data…' : 'Pick some categories, and Gains and/or Losses.');

  /**
   * One row per category, its figures side by side: "(raw/boosted)" for categories a CpS effect
   * can boost — unboosted, then with the boost — "(−bought / +sold)"-style for ones that go both
   * ways, and just "(raw)" otherwise. Then thin In / Out / Net rows.
   */
  function ledgerTable() {
    const { beautify, signed } = F();
    const { cats, gains, losses, boosted } = ledgerView();
    const vals = TABLE_COLS.map((c) => recentFlows(c.s || 3, LEDGER_FIELDS, 'lBuild'));
    const rows = [];
    cats.forEach((c) => {
      const labels = [];
      const cells = [];
      const words = c.words || [];
      if (losses && c.out) {
        labels.push(`−${words[0] || 'out'}`);
        cells.push((r) => '−' + beautify(r[c.out]));
      }
      if (gains && c.in) {
        if (c.boost) {
          labels.push('raw');
          cells.push((r) => beautify(r[c.in]));
          if (boosted) {
            labels.push('boosted');
            cells.push((r) => beautify(r[c.in] + r[c.boost]));
          }
        } else {
          labels.push(words[1] ? `+${words[1]}` : 'raw');
          cells.push((r) => (c.out && losses ? '+' : '') + beautify(r[c.in]));
        }
      }
      if (!cells.length) return;
      rows.push({
        label: `${c.name} (${labels.join(' · ')})`,
        fn: (r) => cells.map((f) => f(r)).join(' · ') + '/s',
        color: c.color,
      });
    });
    if (!rows.length) return '<div class="ca-card-note">Pick some categories, and Gains and/or Losses.</div>';
    const shown = ledgerParts();
    const total = (r, sign) => shown.filter((x) => x.sign === sign).reduce((n, x) => n + (r[x.field] || 0), 0);
    if (gains) rows.push({ label: 'In', fn: (r) => beautify(total(r, 1)) + '/s', strong: true, sign: '=', sep: true });
    if (losses) rows.push({ label: 'Out', fn: (r) => '−' + beautify(total(r, -1)) + '/s', strong: true, sign: '=', sep: !gains });
    if (gains && losses) rows.push({ label: 'Net', fn: (r) => signed(total(r, 1) - total(r, -1)) + '/s', strong: true, sign: '=' });
    return spansTable(rows, vals);
  }

  const actualPlot = () =>
    P().create({
      id: 'actual',
      title: 'Bank flows',
      icon: 'bolt',
      note: 'Everything that moved the bank each second, by category — spending too (for what you baked, the income payback periods count in, see the Actual income tab). Building CpS and clicking can show the extra that CpS effects add (✦ CpS-boosted) on top of their unboosted part. Losses show below the line.',
      windows: WINDOWS,
      window: 900,
      smooth: 15,
      stacked: true,
      unit: '/s',
      totalLabel: 'Net',
      tipFmt: (val) => (val < 0 ? '−' : '') + F().beautify(Math.abs(val)) + '/s',
      toggleGroups: LEDGER_TOGGLES(true),
      build(v) {
        const parts = ledgerParts();
        const { gains, losses, cats } = ledgerView();
        const raw = v.bucketize(LEDGER_FIELDS.concat(['cps', 'click']));
        const ivs = effects(v);
        const bars = raw.map((b) => {
          const o = {};
          parts.forEach((x) => (o[x.key] = x.sign * rate(b, x.field)));
          return { x0: b.x0, x1: b.x1, parts: o, raw: b };
        });
        let sum = 0;
        let secs = 0;
        raw.forEach((b) => {
          if (!Number.isFinite(b.v.lBuild)) return;
          parts.forEach((x) => (sum += x.sign * (b.v[x.field] || 0)));
          secs += coverOf(b, 'lBuild');
        });
        const avg = secs ? sum / secs : NaN;
        const showShown = gains && S().get('actualShown') !== false && cats.some((c) => c.id === 'build' || c.id === 'click');
        return {
          series: parts
            .map((x) => ({ key: x.key, name: x.name, color: x.color, type: 'bar', merge: x.merge }))
            .concat(showShown ? [{ key: 'shown', name: 'CpS the game shows (+ clicking)', color: C_SHOWN, type: 'line', dash: true, width: 1.2 }] : [])
            .concat(gains && losses ? [{ key: 'net', name: 'Net', color: '#ffd98a', type: 'line', width: 1.4 }] : []),
          bars,
          lines: {
            shown: P().linePoints(raw, (b) => (Number.isFinite(b.v.cps) ? b.v.cps + (b.v.click || 0) : undefined)),
            net: bars.map((b) => ({ x: (b.x0 + b.x1) / 2, x0: b.x0, x1: b.x1, bar: b.raw, v: Object.values(b.parts).reduce((n, y) => n + (y || 0), 0) })),
          },
          hlines: Number.isFinite(avg) && parts.length ? [{ v: avg, label: `avg ${F().signed(avg)}/s`, color: 'rgba(255,200,120,0.7)' }] : [],
          intervals: ivs,
          markers: markers(v, ['golden', 'wrath', 'reindeer'], ivs),
          empty: ledgerEmpty(),
          raw,
          parts,
        };
      },
      stats(v, data) {
        const { tile, beautify, signed } = F();
        let inn = 0;
        let out = 0;
        let boost = 0;
        let secs = 0;
        data.raw.forEach((b) => {
          if (!Number.isFinite(b.v.lBuild)) return;
          secs += coverOf(b, 'lBuild');
          data.parts.forEach((x) => {
            const val = b.v[x.field] || 0;
            if (x.sign > 0) inn += val;
            else out += val;
            if (x.boost) boost += val;
          });
        });
        const per = (n) => (secs ? n / secs : 0);
        return (
          tile('In', beautify(per(inn)) + '/s', 'average, this window') +
          tile('Out', beautify(per(out)) + '/s', 'average, this window') +
          tile('Net', signed(per(inn - out)) + '/s') +
          tile('CpS boost', inn > 0 ? Math.round((boost / inn) * 100) + '%' : '—', 'of what came in')
        );
      },
      footer: () => ledgerTable(),
    });

  const ledgerCumPlot = () =>
    P().create({
      id: 'ledgerCum',
      settingsOf: 'actual', // same window, log scale and choices as Bank flows
      title: 'Cookie bank',
      icon: 'dollar',
      note: 'The same categories, added up from the start: how the bank got to where it is. With everything included it traces the real bank (dashed).',
      windows: WINDOWS,
      window: 900,
      smooth: false,
      stacked: true,
      choices: [FROM],
      totalLabel: 'Net',
      tipFmt: (val) => F().signed(val),
      toggleGroups: LEDGER_TOGGLES(),
      build(v) {
        const parts = ledgerParts();
        const { gains, losses } = ledgerView();
        const start = cumulativeStart(v);
        const raw = v.bucketize(LEDGER_FIELDS.concat(['cookies']));
        const run = {};
        parts.forEach((x) => (run[x.key] = 0));
        // the bank where the chart starts: the last frame at or before the start (else the first one)
        const before = v.frames.filter((f) => f[v.key] <= start && Number.isFinite(f.cookies)).pop();
        let bank0 = before ? before.cookies : null;
        const bars = [];
        const actual = [];
        raw.forEach((b) => {
          if (b.x1 <= start) return;
          const o = {};
          parts.forEach((x) => {
            run[x.key] += x.sign * (b.v[x.field] || 0);
            o[x.key] = run[x.key];
          });
          bars.push({ x0: b.x0, x1: b.x1, parts: o, raw: b });
          if (bank0 === null && Number.isFinite(b.first.cookies)) bank0 = b.first.cookies;
          if (bank0 !== null && Number.isFinite(b.v.cookies)) actual.push({ x: b.x1, x0: b.x0, x1: b.x1, bar: b, v: b.v.cookies - bank0 });
        });
        return {
          series: parts
            .map((x) => ({ key: x.key, name: x.name, color: x.color, type: 'bar', merge: x.merge }))
            .concat(gains && losses ? [{ key: 'net', name: 'Net (selected)', color: '#ffd98a', type: 'line', width: 1.4 }] : [])
            .concat([{ key: 'bank', name: 'Bank, actual change', color: C_SHOWN, type: 'line', dash: true, width: 1.2 }]),
          bars,
          lines: {
            net: bars.map((b) => ({ x: b.x1, x0: b.x0, x1: b.x1, v: Object.values(b.parts).reduce((n, y) => n + (y || 0), 0) })),
            bank: actual,
          },
          markers: [],
          empty: ledgerEmpty(),
          bank0,
          bars0: bars,
        };
      },
      stats(v, data) {
        const { tile, beautify, signed } = F();
        const last = data.bars0[data.bars0.length - 1];
        const sel = last ? Object.values(last.parts).reduce((n, y) => n + (y || 0), 0) : 0;
        return (
          tile('Bank at start', data.bank0 === null ? '—' : beautify(data.bank0)) +
          tile('Bank now', beautify(Game.cookies || 0)) +
          tile('Change', data.bank0 === null ? '—' : signed((Game.cookies || 0) - data.bank0), 'actual') +
          tile('Selected categories', signed(sel), 'added up')
        );
      },
    });

  // ---- Actual income tab ------------------------------------------------------------------------
  // What you really baked a second (the Recorder's `earned`: cookies baked, by source) — exactly what
  // the Actual income payback mode and payback.actualIncome() average over the Actual income window.
  // The chart has every window (Since last ascension too); a line marks the income payback periods
  // use now. Its ☆ puts it on the left panel as the Actual income widget, drawn the way it is here.

  const INCOME_FIELDS = SOURCES.map((x) => x.key);
  const PB = () => CA.Payback;
  /** The actual income payback periods use now: { actual, secs, window } or null (under a minute recorded). */
  const paybackIncome = () => (PB() ? PB().incomeOver(PB().actualWindow()) : null);
  const paybackWindowText = () => (PB() ? PB().actualWindowText() : '');
  /** The source the chart shows alone (a click on its row in the table below), else null: all of them. */
  const incomeOnly = () => SOURCES.find((x) => x.key === S().get('incomeOnly')) || null;
  /** Seconds of play since the last ascension (all recorded play before the first one). */
  function runSecs() {
    const run = CA.Ascension && CA.Ascension.runStart();
    return run ? Math.max(1, (CA.Recorder.activeNow() - run.a) / SEC) : 1e10;
  }

  const incomePlot = () =>
    P().create({
      id: 'income',
      title: 'Actual income',
      icon: 'bolt',
      note: 'What you really baked each second, by where it came from: buildings with every effect on, clicking, golden cookies and reindeer, and the rest (wrinklers, spells…). Payback periods by actual income count in its average over the window you pick above (the line).',
      windows: WINDOWS,
      window: 3600,
      smooth: 60,
      stacked: true,
      unit: '/s',
      widgetType: 'income', // its ☆: the Actual income widget
      widgetName: 'Actual income',
      build(v) {
        const raw = v.bucketize(INCOME_FIELDS.concat(['earned', 'base']));
        const ivs = effects(v);
        // one source alone: only its bars, so the axis fits it, and its own average
        const only = incomeOnly();
        const shown = only ? [only] : SOURCES;
        const bars = raw.map((b) => {
          const o = {};
          shown.forEach((x) => (o[x.key] = rate(b, x.key)));
          return { x0: b.x0, x1: b.x1, parts: o, raw: b };
        });
        let sum = 0;
        let sumOnly = 0;
        let secs = 0;
        let base = 0;
        let baseSecs = 0;
        raw.forEach((b) => {
          if (Number.isFinite(b.v.earned)) {
            sum += b.v.earned;
            if (only) sumOnly += b.v[only.key] || 0;
            secs += coverOf(b, 'earned');
          }
          if (Number.isFinite(b.v.base)) {
            base += b.v.base * b.secs;
            baseSecs += b.secs;
          }
        });
        const avg = secs ? sum / secs : NaN;
        const pb = paybackIncome();
        const hlines = [];
        // (the payback line is all of the income: it'd squash one source alone)
        if (!only && pb && Number.isFinite(pb.actual)) hlines.push({ v: pb.actual, label: `payback ${F().beautify(pb.actual)}/s · ${paybackWindowText()}`, color: 'rgba(120,220,255,0.85)' });
        // the window's average, unless it's (about) the payback line
        if (only) {
          if (secs) hlines.push({ v: sumOnly / secs, label: `avg ${F().beautify(sumOnly / secs)}/s`, color: 'rgba(255,200,120,0.7)' });
        } else if (Number.isFinite(avg) && !(pb && Math.abs(avg - pb.actual) <= 0.01 * Math.abs(pb.actual)))
          hlines.push({ v: avg, label: `avg ${F().beautify(avg)}/s`, color: 'rgba(255,200,120,0.7)' });
        // unbuffed CpS is what production is measured against; beside the other sources alone it'd only squash them
        const withBase = !only || only.key === 'earnProduction';
        return {
          series: shown
            .map((x) => ({ key: x.key, name: x.name, color: x.color, type: 'bar' }))
            .concat(withBase ? [{ key: 'base', name: 'Unbuffed CpS', color: C_BASE, type: 'line', dash: true, width: 1.4 }] : []),
          bars,
          lines: withBase ? { base: P().linePoints(raw, (b) => b.v.base) } : {},
          hlines,
          intervals: ivs,
          markers: markers(v, ['golden', 'wrath', 'reindeer'], ivs),
          legendExtra: (only ? `<span class="ca-legend-item ca-legend-only">Only ${esc(only.name.toLowerCase())} · its row in the table shows all again</span>` : '') + effectLegend(ivs),
          raw,
          avg,
          base: baseSecs ? base / baseSecs : NaN,
          pb,
        };
      },
      stats(v, data) {
        const { tile, beautify } = F();
        let golden = 0;
        let all = 0;
        data.raw.forEach((b) => {
          golden += b.v.earnGolden || 0;
          all += Number.isFinite(b.v.earned) ? b.v.earned : 0;
        });
        const pb = data.pb;
        return (
          tile('For payback', pb ? beautify(pb.actual) + '/s' : '—', pb ? `over ${paybackWindowText() === 'since ascension' ? 'play since ascension' : `the last ${paybackWindowText()}`}` : 'a minute of play first') +
          tile('Average', Number.isFinite(data.avg) ? beautify(data.avg) + '/s' : '—', 'this window') +
          tile('× raw CpS', Number.isFinite(data.avg) && data.base > 0 ? '×' + (data.avg / data.base).toFixed(data.avg / data.base >= 10 ? 1 : 2) : '—', 'average ÷ unbuffed CpS') +
          tile('Golden cookies', all > 0 ? Math.round((golden / all) * 100) + '%' : '—', 'of it, this window')
        );
      },
      footer: () => incomeTable(),
    });

  const INCOME_COLS = [
    { s: 60, label: '1m' },
    { s: 300, label: '5m' },
    { s: 900, label: '15m' },
    { s: 3600, label: '1h' },
    { s: 10800, label: '3h' },
    { s: 43200, label: '12h' },
    { s: 'run', label: 'This run' },
  ];

  /** The actual income over spans of play, by source, and as a multiple of raw CpS. */
  function incomeTable() {
    const { beautify } = F();
    const vals = INCOME_COLS.map((c) => {
      const secs = c.s === 'run' ? runSecs() : c.s;
      const fl = recentFlows(secs, INCOME_FIELDS.concat(['earned']), 'earned');
      const r = recent(secs);
      return fl && r ? { ...fl, base: r.base } : null;
    });
    const times = (a, b) => (b > 0 && Number.isFinite(a) ? `×${(a / b).toFixed(a / b >= 10 ? 1 : 2)}` : '—');
    // a source's row shows it alone on the chart (again: all of them); the total's row, all of them
    const only = incomeOnly();
    const pick = (k, tip) => `data-income-only="${k}" data-tip="${esc(tip)}"`;
    return spansTable(
      SOURCES.map((x) => ({
        label: x.name,
        fn: (r) => beautify(r[x.key]) + '/s',
        color: x.color,
        cls: 'ca-pick' + (only ? (only === x ? ' on' : ' off') : ''),
        attrs: only === x ? pick('', 'Show every source on the chart again') : pick(x.key, `Show only ${x.name.toLowerCase()} on the chart, its axis fitted to it`),
      })).concat([
        { label: 'Actual income', fn: (r) => beautify(r.earned) + '/s', strong: true, sign: '=', sep: true, cls: 'ca-pick', attrs: pick('', 'Show every source on the chart') },
        { label: '× raw CpS', desc: 'actual income ÷ unbuffed CpS', fn: (r) => times(r.earned, r.base), mult: true },
      ]),
      vals,
      INCOME_COLS,
      'ca-spans-units' // 1m, 1h: not upper case (1M reads as a million)
    );
  }

  /** The card above the chart: the income payback periods count in, and its window (the Payback page's option). */
  function paybackCardHtml() {
    if (!PB()) return '';
    const { beautify } = F();
    const set = S().get('ppActualWindow');
    const choices = (S().definitions().find((d) => d.key === 'ppActualWindow') || { choices: [] }).choices;
    const pb = paybackIncome();
    const ratio = PB().actualRatio();
    const chips = choices
      .map((c) => `<button type="button" class="ca-chip${set === c.v ? ' on' : ''}" data-income-window="${esc(c.v)}">${esc(c.v === PB().SINCE_ASCENSION ? 'Since ascension' : c.label)}</button>`)
      .join('');
    return (
      '<div class="ca-card" data-income-card>' +
      CA.UI.C.cardHead('Actual income for payback periods', 'dollar') +
      '<div class="ca-row ca-row-option"><div class="ca-row-text">' +
      `<div class="ca-row-name">Averaged over</div><div class="ca-row-desc">Every actual income — the Actual income payback mode, the tooltips’ income lines, payback.actualIncome() — counts what you baked over this much of your latest play${
        pb ? `: now <b data-income-now>${beautify(pb.actual)}/s</b>${Number.isFinite(ratio) ? `, ×${ratio.toFixed(2)} your raw CpS` : ''}` : ' (once a minute is recorded)'
      }. Also on the ${CA.UI.C.link('Payback', 'payback')} page.</div></div>` +
      `<span class="ca-pp-chips">${chips}</span></div>` +
      '</div>'
    );
  }

  // ---- Prestige tab ---------------------------------------------------------------------------

  const prestigePlot = () =>
    P().create({
      id: 'prestige',
      title: 'Prestige',
      icon: 'ascend',
      windows: LONG_WINDOWS,
      window: 10800,
      log: false,
      fmt: (val) => F().beautify(val, 0),
      tipFmt: (val) => F().beautify(Math.floor(val), 0),
      build(v) {
        const bars = v.bucketize(['prestigeTotal', 'prestige']);
        const totals = P().linePoints(bars, (b) => b.v.prestigeTotal);
        // the target as a line, when it's close enough not to squash the chart
        const target = prestigeTarget();
        const top = totals.reduce((m, p) => Math.max(m, p.v), 0);
        const showTarget = target > 0 && top > 0 && target <= top * 1.5;
        return {
          series: [
            { key: 'prestigeTotal', name: 'Level if you ascended now', color: '#c9bcff', type: 'area', width: 1.8 },
            { key: 'prestige', name: 'Current level', color: C_BASE, type: 'line', dash: true },
          ],
          lines: {
            prestigeTotal: totals,
            prestige: P().linePoints(bars, (b) => b.v.prestige),
          },
          hlines: showTarget ? [{ v: target, label: `target ${F().beautify(target, 0)}`, color: 'rgba(201,188,255,0.85)' }] : [],
          markers: [],
          zero: false,
        };
      },
      stats() {
        const { tile, beautify, span } = F();
        const cur = Game.prestige || 0;
        const total = Math.floor(Game.HowMuchPrestige((Game.cookiesReset || 0) + (Game.cookiesEarned || 0)));
        const next = total + 1;
        const need = typeof Game.HowManyCookiesReset === 'function' ? Game.HowManyCookiesReset(next) - ((Game.cookiesReset || 0) + (Game.cookiesEarned || 0)) : NaN;
        const r = etaRate();
        const eta = r && r.actual > 0 && need > 0 ? need / r.actual : NaN;
        return (
          tile('Level', beautify(cur, 0)) +
          tile('If you ascended now', beautify(total, 0), `+${beautify(total - cur, 0)} this run`) +
          tile('Next level', Number.isFinite(need) ? beautify(Math.max(0, need)) : '—', 'cookies to go') +
          tile('Next level in', Number.isFinite(eta) ? span(eta) : '—', r ? r.label : '')
        );
      },
    });

  const prestigeRatePlot = () =>
    P().create({
      id: 'prestigeRate',
      title: 'Prestige gained per hour',
      icon: 'sparkle',
      windows: LONG_WINDOWS,
      window: 10800,
      smooth: 900,
      unit: '/h',
      tipFmt: (val) => F().beautify(val, 1) + ' levels/h',
      build(v) {
        const bars = v.bucketize(['prestigeTotal']);
        let prev = null;
        let gained = 0;
        let secs = 0;
        const out = bars.map((b) => {
          const from = prev && b.x0 - prev.x1 <= Math.max(5 * SEC, v.bucket) ? prev.v.prestigeTotal : b.first.prestigeTotal;
          const d = Number.isFinite(b.v.prestigeTotal) && Number.isFinite(from) ? Math.max(0, b.v.prestigeTotal - from) : 0;
          prev = b;
          gained += d;
          secs += b.secs;
          return { x0: b.x0, x1: b.x1, parts: { gain: b.secs > 0 ? (d / b.secs) * 3600 : 0 }, raw: b };
        });
        return {
          series: [{ key: 'gain', name: 'Levels per hour', color: '#c9bcff', type: 'bar' }],
          bars: out,
          markers: [],
          gained,
          secs,
        };
      },
      stats(v, data) {
        const { tile, beautify, span } = F();
        return (
          tile('Gained', beautify(data.gained, 0), data.secs ? `in ${span(data.secs)} of play` : '') +
          tile('Per hour', data.secs ? beautify((data.gained / data.secs) * 3600, 1) : '—', 'average, this window')
        );
      },
    });

  /** The CpS prestige ETAs use: your actual CpS over the Prestige chart's window (its chips),
   *  in active play — the whole recorded history when the window is All. */
  function etaRate() {
    const w = Number(S().get('plot.prestige.win')) || 0;
    const asc = w === P().SINCE_ASCENSION && CA.Ascension ? CA.Ascension.runStart() : null;
    if (asc) {
      const r = recent(Math.max(1, (CA.Recorder.activeNow() - asc.a) / SEC));
      return r && { actual: r.actual, label: 'at the actual CpS since your last ascension' };
    }
    const r = recent(w > 0 ? w : 1e10);
    if (!r) return null;
    return { actual: r.actual, label: w > 0 ? `at the actual CpS of the last ${F().windowLabel(w)}` : 'at the actual CpS of all recorded play' };
  }

  // ---- prestige target --------------------------------------------------------------------
  // A target prestige level, entered as a number from 1–999 and a magnitude (thousand, million…),
  // with how far there is to go and when you'll get there at your recent actual CpS.

  const UNITS = [
    { e: 0, label: 'levels' },
    { e: 3, label: 'thousand' },
    { e: 6, label: 'million' },
    { e: 9, label: 'billion' },
    { e: 12, label: 'trillion' },
    { e: 15, label: 'quadrillion' },
    { e: 18, label: 'quintillion' },
  ];

  /** The target level, or 0 when none is set. */
  function prestigeTarget() {
    const n = Number(S().get('prestigeTargetNum')) || 0;
    return n > 0 ? n * Math.pow(10, Number(S().get('prestigeTargetUnit')) || 0) : 0;
  }

  function targetCardHtml() {
    const n = Number(S().get('prestigeTargetNum')) || 0;
    const u = Number(S().get('prestigeTargetUnit')) || 0;
    return (
      '<div class="ca-card" data-ptarget>' +
      CA.UI.C.cardHead('Prestige target', 'marker') +
      '<div class="ca-target">' +
      '<span class="ca-field-label">Reach level</span>' +
      `<input type="number" min="1" max="999" step="1" placeholder="e.g. 250" value="${n > 0 ? n : ''}" data-ptarget-num>` +
      `<select data-ptarget-unit>${UNITS.map((x) => `<option value="${x.e}"${x.e === u ? ' selected' : ''}>${x.label}</option>`).join('')}</select>` +
      '</div>' +
      '<div data-ptarget-out></div>' +
      '</div>'
    );
  }

  function targetOutHtml() {
    const { tile, beautify, span } = F();
    const target = prestigeTarget();
    if (!target) return '<div class="ca-card-note">Pick a level to aim for — how far it is and when you’ll get there show up here.</div>';
    const baked = (Game.cookiesReset || 0) + (Game.cookiesEarned || 0);
    const now = Math.floor(Game.HowMuchPrestige(baked));
    const start = Game.prestige || 0;
    if (target <= start) return `<div class="ca-card-note">You’re already at prestige ${beautify(start, 0)} — past this target.</div>`;
    const need = typeof Game.HowManyCookiesReset === 'function' ? Math.max(0, Game.HowManyCookiesReset(target) - baked) : NaN;
    const r = etaRate();
    const eta = need > 0 && r && r.actual > 0 ? need / r.actual : need === 0 ? 0 : NaN;
    const pct = Math.max(0, Math.min(100, ((now - start) / (target - start)) * 100));
    const reached = now >= target;
    return (
      `<div class="ca-progress"><div class="ca-progress-fill" style="width:${pct}%"></div><div class="ca-progress-text">${reached ? 'Reached — ascend any time' : `${pct.toFixed(pct < 10 ? 2 : 1)}% of the way this run`}</div></div>` +
      '<div class="ca-stats">' +
      tile('Target', beautify(target, 0), `+${beautify(target - start, 0)} on this ascension`) +
      tile('Levels to go', reached ? '0' : beautify(target - now, 0), `at ${beautify(now, 0)} if you ascended now`) +
      tile('Cookies to go', Number.isFinite(need) ? beautify(need) : '—', 'baked, all time') +
      tile('Reached in', reached ? 'now' : Number.isFinite(eta) ? span(eta) : '—', r ? r.label : '') +
      '</div>'
    );
  }

  function onTargetInput(e) {
    const el = e.target;
    if (!el.matches || !el.matches('[data-ptarget-num],[data-ptarget-unit]')) return;
    if (el.matches('[data-ptarget-num]')) {
      const n = Math.round(Number(el.value));
      S().set('prestigeTargetNum', Number.isFinite(n) && n > 0 ? Math.min(999, n) : 0);
    } else S().set('prestigeTargetUnit', Number(el.value) || 0);
    refreshTarget();
    if (plots.prestige) plots.prestige.tick();
  }

  function refreshTarget() {
    const out = mountedRoot && mountedRoot.querySelector('[data-ptarget-out]');
    if (out) out.innerHTML = targetOutHtml();
  }

  // ---- the page ---------------------------------------------------------------------------

  const plots = {};
  let mountedRoot = null;
  let life = null; // the mounted page (CA.UI.Pages.scope)

  const partsOf = (t) => (t.parts ? t.parts() : []);
  const currentTab = () => {
    const t = S().get('graphTab');
    return tabs().find((x) => x.id === t) || tabs()[0];
  };

  function html() {
    const cur = currentTab();
    return (
      '<div class="ca-subtabs" role="tablist">' +
      tabs().map(
        (t) =>
          `<button type="button" class="ca-subtab${t === cur ? ' on' : ''}" role="tab" aria-selected="${t === cur}" data-graph-tab="${t.id}">` +
          `${CA.UI.Icons.html(t.icon, 14)}<span>${t.label}</span></button>`
      ).join('') +
      '</div>' +
      (cur.top ? cur.top() : '') +
      cur.plots.map((id) => plots[id].html()).join('') +
      partsOf(cur).map((p) => p.html()).join('') +
      (cur.plots.length ? CA.UI.Menu.optionsCard('Options', 'settings', 'graph') : '')
    );
  }

  function onClick(e) {
    const only = e.target.closest('[data-income-only]');
    if (only) {
      e.stopPropagation();
      CA.Util.sound('snd/tick.mp3');
      S().set('incomeOnly', only.dataset.incomeOnly);
      if (plots.income) plots.income.tick();
      return;
    }
    const win = e.target.closest('[data-income-window]');
    if (win && PB()) {
      e.stopPropagation();
      CA.Util.sound('snd/tick.mp3');
      PB().setActualWindow(win.dataset.incomeWindow);
      CA.UI.Menu.render();
      return;
    }
    const tab = e.target.closest('[data-graph-tab]');
    if (!tab) return;
    e.stopPropagation();
    CA.Util.sound('snd/tick.mp3');
    S().set('graphTab', tab.dataset.graphTab);
    CA.UI.Menu.render();
  }

  /** Opens on tab `id` (the panel's openPage, and links to the old Stats page: 'stats' → Golden cookies). */
  function open(id) {
    if (tabs().some((t) => t.id === id)) S().set('graphTab', id);
  }

  function mount(root) {
    unmount();
    mountedRoot = root;
    life = CA.UI.Pages.scope(root).on('click', onClick).on('input', onTargetInput).on('change', onTargetInput);
    currentTab().plots.forEach((id) => plots[id].mount(root));
    partsOf(currentTab()).forEach((p) => p.mount(root));
    if (SP()) SP().mount(root);
    refreshTarget();
  }

  function unmount() {
    ALL_TABS.forEach((t) => t.plots.forEach((id) => plots[id] && plots[id].unmount()));
    ALL_TABS.forEach((t) => partsOf(t).forEach((p) => p.unmount()));
    if (SP()) SP().unmount();
    if (life) life.close();
    life = null;
    mountedRoot = null;
  }

  function tick() {
    currentTab().plots.forEach((id) => plots[id].tick());
    partsOf(currentTab()).forEach((p) => p.tick());
    refreshTarget();
    refreshIncomeCard();
  }

  /** The Actual income tab's card, its figures kept current. */
  function refreshIncomeCard() {
    const card = mountedRoot && mountedRoot.querySelector('[data-income-card]');
    if (!card) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = paybackCardHtml();
    if (fresh.firstElementChild) CA.UI.Dom.morph(card, fresh.firstElementChild.innerHTML);
  }

  function init() {
    CA.Format.notation(); // defines the Numbers setting (Settings → General) before the Settings page draws
    S().defineOption({ key: 'graphTab', group: 'ui', name: 'Stats tab', desc: '', default: 'cookies' });
    S().defineOption({ key: 'collectionMissing', group: 'ui', name: 'Upgrades & achievements: only ones not unlocked yet', desc: '', default: false });
    S().defineOption({ key: 'prestigeTargetNum', group: 'ui', name: 'Prestige target (number)', desc: '', default: 0 });
    S().defineOption({ key: 'prestigeTargetUnit', group: 'ui', name: 'Prestige target (magnitude)', desc: '', default: 0 });
    S().defineOption({ key: 'actualGains', group: 'plot', name: 'Bank flows: gains', desc: '', default: true });
    S().defineOption({ key: 'actualLosses', group: 'plot', name: 'Bank flows: losses', desc: '', default: false });
    S().defineOption({ key: 'cpsBoosted', group: 'plot', name: 'Bank flows: CpS-boosted', desc: '', default: true });
    S().defineOption({ key: 'actualShown', group: 'plot', name: 'Bank flows: game’s CpS line', desc: '', default: true });
    S().defineOption({ key: 'incomeOnly', group: 'plot', name: 'Actual income: only this source', desc: '', default: '' });
    CATS.forEach((c) => S().defineOption({ key: `cat.${c.id}`, group: 'plot', name: `Bank flows: ${c.name}`, desc: '', default: !c.offByDefault }));
    S().defineOption({
      key: 'graphEffects',
      group: 'graph',
      icon: 'shade',
      name: 'Effect shading',
      desc: 'Shade the periods when golden cookie effects are active.',
      default: true,
    });
    S().defineOption({
      key: 'graphEvents',
      group: 'graph',
      icon: 'marker',
      name: 'Event markers',
      desc: 'Mark golden cookie pops, reindeer, stock trades and ascensions.',
      default: true,
    });
    P().init();
    plots.cps = cpsPlot();
    plots.actual = actualPlot();
    plots.ledgerCum = ledgerCumPlot();
    plots.income = incomePlot();
    plots.prestige = prestigePlot();
    plots.prestigeRate = prestigeRatePlot();
    CA.Events.on('history', (why) => {
      if (mountedRoot && why === 'sample') tick();
    });
  }

  return { init, html, mount, unmount, tick, open, recent, TABS: ALL_TABS, SOURCES, CATS, plots };
})();
