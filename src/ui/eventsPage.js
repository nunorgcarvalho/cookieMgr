// The Events page: everything in the central event log (core/eventLog.js).
//
//   Event log            newest first, filter chips per event type (with counts), "income only",
//                        a search box, and a CSV download of whatever the filters show
//
// It also builds the "Income outside CpS" card, shown on the Stats page's Cookies tab since v3.48
// (CA.UI.EventsPage.income, a part with html/mount/unmount/tick): per source for the chosen span —
// golden & wrath cookies, reindeer, wrinklers, sugar lumps, stock trades (net), golden-effect boosts
// (Frenzy & co.) and anything else — counts, cookies, average, share of everything baked, last seen.

CA.UI = CA.UI || {};

CA.UI.EventsPage = (() => {
  const S = () => CA.Settings;
  const F = () => CA.UI.Plot.fmt;
  const esc = (s) => CA.Util.escapeHtml(s);
  const PAGE_ROWS = 100;
  const RENDER_MS = 400;

  const SPANS = [
    { v: 'session', label: 'This session' },
    { v: '900', label: '15m' },
    { v: '3600', label: '1h' },
    { v: '86400', label: '1d' },
    { v: 'all', label: 'All' },
  ];

  let root = null;
  let shown = PAGE_ROWS;
  let query = '';
  let pending = null;

  const hidden = () => new Set(String(S().get('eventHidden') || '').split(',').filter(Boolean));
  const typeInfo = (type) => CA.EventLog.types()[type] || { name: type, icon: 'events', color: '#ccc' };

  function spanStart() {
    const v = S().get('eventSpan');
    if (v === 'all') return -Infinity;
    if (v === 'session') return CA.UI.Plot.SESSION_START;
    return Date.now() - Number(v) * 1000;
  }

  // ---- income table ----------------------------------------------------------------------

  function incomeRows() {
    const from = spanStart();
    const by = {};
    const add = (key, e, cookies) => {
      const r = by[key] || (by[key] = { count: 0, cookies: 0, last: 0, in: 0, out: 0 });
      r.count++;
      r.cookies += cookies;
      if (cookies >= 0) r.in += cookies;
      else r.out -= cookies;
      r.last = Math.max(r.last, e.t);
    };
    let instant = 0;
    let wrinkLump = 0;
    CA.EventLog.list().forEach((e) => {
      if (e.t < from) return;
      if (e.type === 'golden' || e.type === 'wrath' || e.type === 'reindeer') {
        add(e.type, e, e.cookies || 0);
        if (e.cookies > 0) instant += e.cookies;
      } else if (e.type === 'wrinkler' || e.type === 'lump') {
        add(e.type, e, e.cookies || 0);
        wrinkLump += Math.max(0, e.cookies || 0);
      } else if (e.type === 'trade') add('trade', e, e.cookies || 0);
    });
    let baked = 0;
    let golden = 0;
    let other = 0;
    CA.Recorder.frames().forEach((f) => {
      if (f.t < from) return;
      baked += f.earned || 0;
      golden += f.earnGolden || 0;
      other += f.earnOther || 0;
    });
    const t = CA.EventLog.types();
    const rows = ['golden', 'wrath', 'reindeer', 'wrinkler', 'lump', 'trade'].map((k) => ({
      key: k,
      label: k === 'trade' ? 'Stock trades (−bought · +sold)' : (t[k] || {}).name || k,
      split: k === 'trade', // one row, both directions
      icon: (t[k] || {}).icon,
      color: (t[k] || {}).color,
      ...(by[k] || { count: 0, cookies: 0, last: 0, in: 0, out: 0 }),
    }));
    rows.push({ key: 'boost', label: 'Golden effect boosts', icon: 'sparkle', color: '#ff9f43', count: null, cookies: Math.max(0, golden - instant), last: 0, title: 'Extra production from Frenzy, Dragon Harvest and other CpS effects, on top of unbuffed CpS' });
    rows.push({ key: 'other', label: 'Everything else', icon: 'puzzle', color: '#b39ddb', count: null, cookies: Math.max(0, other - wrinkLump), last: 0, title: 'Baked cookies not explained by production, clicking or the sources above' });
    return { rows, baked };
  }

  function incomeHtml() {
    const { beautify, signed, clock } = F();
    const { rows, baked } = incomeRows();
    const total = rows.reduce((n, r) => n + r.cookies, 0);
    let h = '<div class="ca-table-wrap"><table class="ca-table"><thead><tr><th>Source</th><th>Count</th><th>Cookies</th><th>Average</th><th>Of baked</th><th>Last</th></tr></thead><tbody>';
    rows.forEach((r) => {
      const muted = !r.count && !r.cookies;
      h +=
        `<tr${muted ? ' class="muted"' : ''}><td${r.title ? ` data-tip="${esc(r.title)}"` : ''}>` +
        `<span class="ca-ev-dot" style="color:${r.color}">${CA.UI.Icons.html(r.icon, 13)}</span>${esc(r.label)}</td>` +
        `<td>${r.count == null ? '' : r.count.toLocaleString()}</td>` +
        (r.split
          ? `<td>${r.count ? `<span class="neg">−${beautify(r.out)}</span> · <span class="pos">+${beautify(r.in)}</span>` : '—'}</td>`
          : `<td class="${r.cookies < 0 ? 'neg' : r.cookies > 0 ? 'pos' : ''}">${r.cookies ? signed(r.cookies) : '—'}</td>`) +
        `<td>${r.count ? beautify(r.cookies / r.count) : ''}</td>` +
        `<td>${baked > 0 && r.cookies ? ((r.cookies / baked) * 100).toFixed(r.cookies / baked < 0.1 ? 2 : 1) + '%' : ''}</td>` +
        `<td>${r.last ? clock(r.last, true) : ''}</td></tr>`;
    });
    h +=
      `<tr class="strong"><td>Total outside CpS & clicking</td><td></td><td>${signed(total)}</td><td></td>` +
      `<td>${baked > 0 ? ((total / baked) * 100).toFixed(1) + '%' : ''}</td><td></td></tr>`;
    h += '</tbody></table></div>';
    return h;
  }

  // The card, a part of the Stats page's Cookies tab (ui/graphs.js).
  const income = (() => {
    let el = null;
    let life = null;
    const refresh = () => {
      const box = el && el.isConnected && el.querySelector('[data-ev-income]');
      if (box) box.innerHTML = incomeHtml();
    };
    function onClick(e) {
      const t = e.target.closest('[data-ev-span]');
      if (!t) return;
      e.stopPropagation();
      CA.Util.sound('snd/tick.mp3');
      S().set('eventSpan', t.dataset.evSpan);
      el.querySelectorAll('[data-ev-span]').forEach((b) => b.classList.toggle('on', b.dataset.evSpan === t.dataset.evSpan));
      refresh();
    }
    return {
      html() {
        const span = S().get('eventSpan');
        return (
          '<div class="ca-card" data-ev-income-card>' +
          CA.UI.C.cardHead('Income outside CpS', 'dollar') +
          '<div class="ca-toolbar"><div class="ca-chipgroup">' +
          SPANS.map((s) => `<button type="button" class="ca-chip${s.v === span ? ' on' : ''}" data-ev-span="${s.v}">${s.label}</button>`).join('') +
          '</div></div>' +
          '<div data-ev-income></div>' +
          '</div>'
        );
      },
      mount(root) {
        this.unmount();
        el = root.querySelector('[data-ev-income-card]');
        if (!el) return;
        life = CA.UI.Pages.scope(el).on('click', onClick);
        refresh();
      },
      unmount() {
        if (life) life.close();
        life = null;
        el = null;
      },
      tick: refresh,
    };
  })();

  // ---- event log -------------------------------------------------------------------------

  function filtered() {
    const hide = hidden();
    const incomeOnly = S().get('eventIncomeOnly');
    const q = query.trim().toLowerCase();
    const types = CA.EventLog.types();
    return CA.EventLog.list().filter((e) => {
      if (hide.has(e.type)) return false;
      if (incomeOnly && !((types[e.type] || {}).income || e.type === 'trade')) return false;
      if (q && !`${e.title} ${e.text}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function chipsHtml() {
    const counts = {};
    CA.EventLog.list().forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    const hide = hidden();
    return Object.keys(CA.EventLog.types())
      .map((type) => {
        const t = typeInfo(type);
        const on = !hide.has(type);
        return (
          `<button type="button" class="ca-chip ca-ev-chip${on ? ' on' : ''}" data-ev-type="${esc(type)}" style="--c:${t.color}" data-tip="Show or hide ${esc(t.name)} events">` +
          `${CA.UI.Icons.html(t.icon, 12)}${esc(t.name)} <em>${(counts[type] || 0).toLocaleString()}</em></button>`
        );
      })
      .join('');
  }

  /** What an event did, for its right-hand column: cookies gained/lost, or — for a golden cookie
   *  that granted an effect instead of a drop — the effect and what it multiplies: "Frenzy ×7",
   *  "Clot ×0.5", "Click frenzy ×777 clicks". */
  function effectOf(e) {
    const { signed } = F();
    const c = e.cookies || 0;
    if (Math.abs(c) >= 1) return { cls: c < 0 ? 'neg' : 'pos', text: signed(c) };
    const effects = (e.data && e.data.effects) || [];
    if (!effects.length) return { cls: '', text: '' };
    const times = (m) => `×${Math.round(m * 100) / 100}`;
    let product = 1;
    const text = effects
      .map((ef) => {
        if (Number.isFinite(ef.multCps) && ef.multCps !== 1) {
          product *= ef.multCps;
          return `${ef.name} ${times(ef.multCps)}`;
        }
        if (Number.isFinite(ef.multClick) && ef.multClick !== 1) {
          product *= ef.multClick;
          return `${ef.name} ${times(ef.multClick)} clicks`;
        }
        return ef.name;
      })
      .join(' · ');
    return { cls: product > 1 ? 'pos' : product < 1 ? 'neg' : '', text };
  }

  function rowHtml(e) {
    const t = typeInfo(e.type);
    const { clock } = F();
    const eff = effectOf(e);
    return (
      `<div class="ca-ev-row" style="--c:${t.color}">` +
      `<span class="ca-ev-ico">${CA.UI.Icons.html(t.icon, 14)}</span>` +
      `<span class="ca-ev-time">${clock(e.t, true)}</span>` +
      `<span class="ca-ev-text"><b>${CA.UI.C.withUpgrade(e.title, e.data && e.data.upgrade)}</b>${e.text ? ` <span>${esc(e.text)}</span>` : ''}</span>` +
      `<span class="ca-ev-cookies ${eff.cls}">${eff.text}</span>` +
      '</div>'
    );
  }

  function listHtml() {
    const list = filtered();
    const rows = list.slice(-shown).reverse();
    let h = rows.length ? rows.map(rowHtml).join('') : '<div class="ca-legend-empty ca-ev-empty">No events match.</div>';
    if (list.length > shown) h += `<button type="button" class="ca-btn ca-btn-small ca-ev-more" data-ev-more>Show ${Math.min(PAGE_ROWS, list.length - shown)} more (${(list.length - shown).toLocaleString()} older)</button>`;
    return h;
  }

  // ---- page -----------------------------------------------------------------------------

  function html() {
    const C = CA.UI.C;
    return (
      '<div class="ca-card">' +
      C.cardHead('Event log', 'events', '<div class="ca-card-meta"><span class="ca-pill" data-ev-count></span></div>') +
      '<div class="ca-toolbar ca-ev-filters">' +
      '<div class="ca-chipgroup" data-ev-chips></div>' +
      '</div>' +
      '<div class="ca-toolbar">' +
      `<label class="ca-search">${CA.UI.Icons.html('search', 13)}<input type="search" placeholder="Search events…" data-ev-search value="${esc(query)}"></label>` +
      '<div class="ca-chipgroup">' +
      `<button type="button" class="ca-chip${S().get('eventIncomeOnly') ? ' on' : ''}" data-ev-income-only data-tip="Only events that brought in (or cost) cookies">${CA.UI.Icons.html('dollar', 12)} Income only</button>` +
      `<button type="button" class="ca-chip" data-ev-csv data-tip="Download the events shown as a CSV file">${CA.UI.Icons.html('download', 12)} CSV</button>` +
      '</div></div>' +
      '<div class="ca-ev-list" data-ev-list></div>' +
      '</div>' +
      CA.UI.Menu.optionsCard('Options', 'settings', 'events')
    );
  }

  function render() {
    if (!root || !root.isConnected) return;
    const chips = root.querySelector('[data-ev-chips]');
    if (chips) chips.innerHTML = chipsHtml();
    const list = root.querySelector('[data-ev-list]');
    if (list) list.innerHTML = listHtml();
    const count = root.querySelector('[data-ev-count]');
    if (count) {
      const n = filtered().length;
      const all = CA.EventLog.list().length;
      count.textContent = n === all ? `${all.toLocaleString()} events` : `${n.toLocaleString()} of ${all.toLocaleString()}`;
    }
  }

  function schedule() {
    if (pending || !root) return;
    pending = setTimeout(() => {
      pending = null;
      render();
    }, RENDER_MS);
  }

  function csv() {
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['time', 'type', 'title', 'text', 'cookies'].join(',')];
    filtered().forEach((e) => lines.push([new Date(e.t).toISOString(), e.type, e.title, e.text, e.cookies || 0].map(cell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cookiemgr-events-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function onClick(e) {
    const t = e.target.closest('[data-ev-type],[data-ev-income-only],[data-ev-csv],[data-ev-more]');
    if (!t) return;
    e.stopPropagation();
    CA.Util.sound('snd/tick.mp3');
    if ('evType' in t.dataset) {
      const hide = hidden();
      if (hide.has(t.dataset.evType)) hide.delete(t.dataset.evType);
      else hide.add(t.dataset.evType);
      S().set('eventHidden', [...hide].join(','));
      shown = PAGE_ROWS;
    } else if ('evIncomeOnly' in t.dataset) {
      S().set('eventIncomeOnly', !S().get('eventIncomeOnly'));
      t.classList.toggle('on', S().get('eventIncomeOnly'));
      shown = PAGE_ROWS;
    } else if ('evCsv' in t.dataset) {
      csv();
      return;
    } else if ('evMore' in t.dataset) {
      shown += PAGE_ROWS;
    }
    render();
  }

  function onInput(e) {
    if (!e.target.matches('[data-ev-search]')) return;
    query = e.target.value;
    shown = PAGE_ROWS;
    const list = root.querySelector('[data-ev-list]');
    if (list) list.innerHTML = listHtml();
  }

  let life = null; // the mounted page (CA.UI.Pages.scope)

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el).on('click', onClick).on('input', onInput);
    shown = PAGE_ROWS;
    render();
  }

  function unmount() {
    if (life) life.close();
    life = null;
    clearTimeout(pending);
    pending = null;
    root = null;
  }

  function init() {
    S().defineOption({ key: 'eventHidden', group: 'ui', name: 'Hidden event types', desc: '', default: '' });
    S().defineOption({ key: 'eventIncomeOnly', group: 'ui', name: 'Income events only', desc: '', default: false });
    S().defineOption({ key: 'eventSpan', group: 'ui', name: 'Income table span', desc: '', default: 'session' });
    CA.UI.Pages.register({
      id: 'events',
      label: 'Events',
      icon: 'events',
      order: 5, // top of the sidebar
      group: 'data',
      html,
      mount,
      unmount,
    });
    CA.Events.on('eventLogged', schedule);
  }

  return { init, incomeRows, income, filtered, rowHtml };
})();
