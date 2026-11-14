// CookieSimMgr — the simulator in a page. Built from the add-on's own UI pieces (window.CA, from
// /cm.js: components, icons, DOM helpers, tooltips, chart helpers, the code editor and its
// library) and talking to sim/gui/server.mjs, which runs the simulations.
//
//   Simulate      start a game (a new one, a scenario, or your own save) with a strategy, watch it
//                 play — the add-on's own Graphs and Events pages (its charts: zoom, windows,
//                 smoothing, effect bands, markers…) on what cookieMgr records in the simulated game,
//                 buildings, upgrades, effects, the garden, cookieMgr's macros, every action it takes
//                 — and take part: switch macros, do actions, run code, export the save
//   Compare       strategies side by side over several seeds, in parallel
//   Strategies    the .cmgr files: cookieMgr's code editor, with its library
//   Garden        golden cookie frequency over game time, gardener by gardener: a histogram each
//   Grimoire      spell plans (Force the Hand of Fate's cast tiers, other spells) scored with each golden
//                 cookie garden, from the fast computed model: the best play per garden, with charts
//   Experiments   the fast models, run with their output
//   Vocabulary    every word a strategy can use (cookieMgr's library)

(() => {
  const C = CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = CA.Format;
  const CE = CA.UI.CodeEditor;
  const morph = (el, html) => el && CA.UI.Dom.morph(el, html);
  const $ = (sel, root = document) => root.querySelector(sel);
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`CookieSimMgr.${k}`);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`CookieSimMgr.${k}`, JSON.stringify(v));
      } catch (e) {
        /* private mode */
      }
    },
  };

  // ---- the server ---------------------------------------------------------------------------------

  async function call(method, url, data) {
    const res = await fetch(url, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    const ct = res.headers.get('Content-Type') || '';
    const out = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((out && out.error) || `HTTP ${res.status}`);
    return out;
  }
  const api = {
    get: (u) => call('GET', u),
    post: (u, d) => call('POST', u, d || {}),
    put: (u, d) => call('PUT', u, d || {}),
    del: (u) => call('DELETE', u),
  };

  function toast(msg, bad) {
    let box = $('#sim-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sim-toast';
      document.body.appendChild(box);
    }
    const d = document.createElement('div');
    d.className = bad ? 'bad' : '';
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.remove(), bad ? 7000 : 3500);
  }
  const guard = (fn) => (...a) =>
    Promise.resolve()
      .then(() => fn(...a))
      .catch((e) => toast(e.message || String(e), true));

  // ---- shared bits ------------------------------------------------------------------------------------

  let meta = null;
  const tile = (label, value, sub, tip) =>
    `<div class="ca-stat"${tip ? ` data-tip="${esc(tip)}"` : ''}><div class="ca-stat-label">${label}</div><div class="ca-stat-value">${value}</div><div class="ca-stat-sub">${sub || '&nbsp;'}</div></div>`;
  const span = (s) => (s < 1 ? '0s' : F.span(s));
  const short = (n) => (Number.isFinite(n) ? F.short(n) : '—');
  /** A macro's picture, as the add-on's macro cards draw it. */
  function macroIcon(icon) {
    const ic = icon || {};
    if (ic.ico) return `<span class="ca-icon ca-icon-ico">${I(ic.ico, 24)}</span>`;
    return C.icon({ img: ic.img, icon: ic.sprite, sheet: ic.sheet });
  }
  const iconAt = (xy, tip) => (Array.isArray(xy) ? `<span${tip ? ` data-tip="${esc(tip)}"` : ''}>${C.icon({ icon: xy })}</span>` : '');
  const plantSprite = (icon, stage, cls = '') => `<i class="ca-gs ${cls}" style="background-image:url(${CA.Util.res('img/gardenPlants.png')});background-position:${-stage * 48}px ${-icon * 48}px"></i>`;
  const stageOf = (mature, age) => (age >= mature ? 4 : age >= mature * 0.666 ? 3 : age >= mature * 0.333 ? 2 : 1);
  const chips = (list, attr, current) =>
    `<span class="ca-chipgroup">${list.map(([v, label, tip]) => `<button type="button" class="ca-chip${String(v) === String(current) ? ' on' : ''}" ${attr}="${esc(v)}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</button>`).join('')}</span>`;
  const SPANS = [
    ['10m', '10 min'],
    ['30m', '30 min'],
    ['1h', '1 h'],
    ['4h', '4 h'],
    ['8h', '8 h'],
    ['24h', '1 day'],
  ];

  /** The words, registered in the page's own registries — so the add-on's code editor colors, checks and lists them as in the game. */
  function installVocab(v) {
    v.actions.forEach((a) => CA.Actions.get(a.id) || CA.Actions.register({ ...a, run: () => 0 }));
    v.conditions.forEach((c) => CA.Conditions.get(c.id) || CA.Conditions.register({ ...c, test: () => false, describe: () => c.name }));
    v.values.forEach((x) => CA.Script.defineValue({ ...x, get: () => NaN }));
    CA.Script.library = () => v.library;
    CA.Script.lookups = () => v.lookups;
  }

  // ---- pages ---------------------------------------------------------------------------------------

  const PAGES = [
    { id: 'sim', label: 'Simulate', icon: 'play' },
    { id: 'compare', label: 'Compare', icon: 'graphs' },
    { id: 'strategies', label: 'Strategies', icon: 'edit' },
    { id: 'garden', label: 'Garden', icon: 'leaf' },
    { id: 'grimoire', label: 'Grimoire', icon: 'wizard' },
    { id: 'experiments', label: 'Experiments', icon: 'puzzle' },
    { id: 'vocab', label: 'Vocabulary', icon: 'log' },
  ];
  const pages = {};
  let current = null;
  const main = () => $('[data-sim-main]');

  function nav() {
    $('[data-sim-nav]').innerHTML = PAGES.map(
      (p) =>
        `<div class="ca-tab-item${current === p.id ? ' selected' : ''}" data-nav="${p.id}" role="button" tabindex="0">` +
        `<span class="ca-tab-label">${esc(p.label)}</span><span class="ca-tab-icon">${I(p.icon, 18)}</span></div>`
    ).join('');
  }
  function go(id) {
    // #sim/<id>: that simulation
    const m = String(id || '').match(/^sim\/(\w+)$/);
    if (m) {
      id = 'sim';
      if (S.id !== m[1]) connect(m[1]);
    }
    if (!pages[id]) id = 'sim';
    if (current && pages[current].unmount) pages[current].unmount();
    current = id;
    store.set('page', id);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    nav();
    render();
  }
  function render() {
    const root = main();
    root.innerHTML = pages[current].html();
    if (pages[current].mount) pages[current].mount(root);
  }

  // =====================================================================================================
  // Simulate
  // =====================================================================================================

  const TEMPLATE = `# My strategy — cookieMgr's algorithmic code, run from the top every pass.
# with: golden, bigCookie
# every: 500
# Buy whatever pays itself back the quickest:
buy.best(all)
`;
  const S = {
    id: store.get('session', null),
    setup: Object.assign({ start: 'fresh', scenario: 'garden6', save: '', strategy: 'payback', custom: TEMPLATE, seed: 1 }, store.get('setup', {})),
    snap: null,
    es: null,
    samples: [],
    actions: [],
    events: [],
    tally: {},
    gardenOpen: true,
    doAction: '',
    consoleSrc: 'for s in shimmers():\n  shimmer.pop(s)\n',
    consoleOut: '',
    sessions: [],
    lastSnapAt: 0,
  };
  const saveSetup = () => store.set('setup', { ...S.setup, save: S.setup.save.length < 200000 ? S.setup.save : '' });

  function connect(id) {
    disconnect();
    S.id = id;
    store.set('session', id);
    S.samples = [];
    S.actions = [];
    S.events = [];
    S.tally = {};
    S.snap = null;
    S.feeding = CA.SimData.reset();
    if (!id) return;
    const es = new EventSource(`/api/sessions/${id}/stream`);
    S.es = es;
    es.addEventListener('snap', (e) => {
      const s = JSON.parse(e.data);
      S.snap = s;
      S.lastSnapAt = Date.now();
      s.samples.forEach((x) => S.samples.push(x));
      s.actions.forEach((a) => {
        S.actions.push(a);
        S.tally[a.id] = (S.tally[a.id] || 0) + (a.n || 0);
      });
      if (S.actions.length > 3000) S.actions.splice(0, S.actions.length - 3000);
      s.events.forEach((x) => S.events.push(x));
      if (S.events.length > 3000) S.events.splice(0, S.events.length - 3000);
      // the add-on's pages: what cookieMgr recorded there, in place (one snapshot after another)
      S.feeding = S.feeding.then(() => CA.SimData.feed(s)).catch((err) => console.error(err));
      if (current === 'sim') live();
      topRun();
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        disconnect();
        S.id = null;
        store.set('session', null);
        if (current === 'sim') render();
      }
    };
  }
  function disconnect() {
    if (S.es) S.es.close();
    S.es = null;
  }

  pages.sim = {
    html() {
      if (!S.id) return setupHtml();
      return (
        `<div class="sim-runbar" data-sim-runbar>${runbarHtml()}</div>` +
        (S.snap && S.snap.error ? `<div class="sim-err">${esc(S.snap.error)}</div>` : '') +
        `<div class="ca-card"><div class="ca-stats" data-sim-stats>${statsHtml()}</div></div>` +
        `<div class="sim-h2">${I('graphs', 16)} Graphs <small>cookieMgr’s own — drag across a chart to zoom in, the chips for windows and smoothing, hover for the details</small></div>` +
        '<div class="sim-host" data-host="graphs"></div>' +
        '<div class="sim-cols"><div>' +
        `<div class="ca-card">${C.cardHead('Buildings', 'building', '<span class="ca-hint" data-sim-bldsum></span>')}<div data-sim-bld></div></div>` +
        `<div class="ca-card">${C.cardHead('Effects', 'sparkle', '<span class="ca-hint">golden cookie buffs, as the game has them</span>')}<div data-sim-buffs></div></div>` +
        `<div class="ca-card">${C.cardHead('Upgrades', 'upgrade', '<span class="ca-hint" data-sim-upgsum></span>')}<div data-sim-upg></div></div>` +
        '<div data-sim-garden></div>' +
        '</div><div>' +
        `<div class="ca-card">${C.cardHead("cookieMgr's macros", 'bolt', '<span class="ca-hint">switch them while it plays</span>')}<div data-sim-macros></div></div>` +
        `<div class="ca-card ca-editor2">${C.cardHead('Do something', 'play', '<span class="ca-hint">any cookieMgr action, or code — now</span>')}${doHtml()}</div>` +
        `<div class="ca-card">${C.cardHead('Actions', 'bolt', '<span class="ca-hint">what cookieMgr did, by its action ids</span>')}<div data-sim-actions></div></div>` +
        '</div></div>' +
        `<div class="sim-h2">${I('events', 16)} Events <small>cookieMgr’s Events page — everything its event log recorded in the simulated game</small></div>` +
        '<div class="sim-host" data-host="events"></div>'
      );
    },
    mount(root) {
      if (!S.id) return mountSetup(root);
      if (!S.es) connect(S.id);
      host(root);
      root.addEventListener('click', onSimClick);
      root.addEventListener('change', onSimChange);
      S.unbindCE = CE.bind(root, {
        onChange: (key, src) => {
          if (key === 'console') S.consoleSrc = src;
        },
      });
      live(true);
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onSimClick);
      root.removeEventListener('change', onSimChange);
      root.removeEventListener('click', onSetupClick);
      root.removeEventListener('change', onSetupChange);
      root.removeEventListener('input', onSetupChange);
      if (S.unbindCE) S.unbindCE();
      S.unbindCE = null;
      unhost();
    },
  };

  // ---- the add-on's pages, hosted: its Graphs page and its Events page (their own html / mount /
  // unmount / tick — the data comes from mirrors.js) ------------------------------------------------
  const HOSTS = {
    graphs: () => CA.UI.Graphs,
    events: () => CA.UI.Pages.get('events'),
  };
  function host(root) {
    root.querySelectorAll('[data-host]').forEach((el) => {
      const p = HOSTS[el.dataset.host]();
      if (!p) return;
      p.unmount();
      el.innerHTML = p.html();
      p.mount(el);
    });
  }
  function unhost() {
    Object.values(HOSTS).forEach((get) => {
      const p = get();
      if (p) p.unmount();
    });
  }
  /** What the pages ask for with CA.UI.Menu.render(): drawn again (a tab, an option…), keeping the scroll. */
  function rehost() {
    if (current !== 'sim' || !S.id) return;
    const y = window.scrollY;
    host(main());
    window.scrollTo(0, y);
  }

  // ---- setup -------------------------------------------------------------------------------------------

  function setupHtml() {
    const st = S.setup;
    const startTile = (k, icon, title, desc, extra = '') =>
      `<button type="button" class="sim-tile${st.start === k ? ' on' : ''}" data-start="${k}"><b>${I(icon, 14)} ${title}</b><span class="ca-hint">${desc}</span>${extra}</button>`;
    const sc = meta.scenarios.filter((x) => x.name !== 'fresh');
    const strat = (s) =>
      `<button type="button" class="sim-tile${st.strategy === s.name ? ' on' : ''}" data-strategy="${esc(s.name)}"><b>${I(s.kind === 'cmgr' ? 'edit' : 'puzzle', 13)} ${esc(s.name)}</b><span class="ca-hint">${esc(s.desc)}</span>` +
      (s.header && (s.header.with.length || s.header.profile)
        ? `<span class="sim-tile-tags">${s.header.with.map((w) => `<span class="ca-pill">${esc(w)}</span>`).join('')}${s.header.profile ? `<span class="ca-pill">${I('leaf', 10)} ${esc(s.header.profile)}</span>` : ''}</span>`
        : '') +
      '</button>';
    return (
      `<div class="sim-h1">Simulate <small>the real game, with cookieMgr playing it — ${esc(meta.gameVersion)} · cookieMgr ${esc(meta.addonVersion)}</small></div>` +
      sessionsHtml() +
      `<div class="ca-card">${C.cardHead('1 · Start from', 'save')}<div class="sim-tiles">` +
      startTile('fresh', 'cookie', 'A new game', 'Nothing baked, nothing owned — the very start.') +
      startTile(
        'scenario',
        'puzzle',
        'A scenario',
        'A prepared state from sim/scenarios/.',
        `<select class="sim-input" data-scenario>${sc.map((x) => `<option value="${esc(x.name)}"${st.scenario === x.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select><span class="ca-hint">${esc((sc.find((x) => x.name === st.scenario) || sc[0] || {}).desc || '')}</span>`
      ) +
      startTile('save', 'upload', 'Your own game', 'Options → Export save in the game, then paste it below. cookieMgr’s settings, macros and gardeners come with it.') +
      '</div>' +
      (st.start === 'save' ? `<textarea class="sim-save" data-save placeholder="Paste your exported save here…">${esc(st.save)}</textarea>` : '') +
      '</div>' +
      `<div class="ca-card ca-editor2">${C.cardHead('2 · Strategy', 'bolt', '<span class="ca-hint">what cookieMgr does while it plays</span>')}<div class="sim-tiles">` +
      meta.strategies.map(strat).join('') +
      `<button type="button" class="sim-tile${st.strategy === ':custom' ? ' on' : ''}" data-strategy=":custom"><b>${I('plus', 13)} Your own code</b><span class="ca-hint">Write it here, in cookieMgr’s language — the same code works in an algorithmic macro in the add-on.</span></button>` +
      `<button type="button" class="sim-tile${st.strategy === ':none' ? ' on' : ''}" data-strategy=":none"><b>${I('pause', 13)} Nothing yet</b><span class="ca-hint">Start idle; switch macros on and do things yourself once it runs.</span></button>` +
      '</div>' +
      (st.strategy === ':custom' ? `<div class="ca-ed-layout sim-ed"><div class="ca-editor-body">${CE.html('setup', st.custom, { title: 'Your strategy', hint: '# with: / # every: lines set it up · Tab indents · click the library to insert' })}</div>${CE.libraryHtml('setup')}</div>` : '') +
      '</div>' +
      `<div class="ca-card">${C.cardHead('3 · Go', 'play')}<div class="sim-form">` +
      `<label class="ca-field"><span class="ca-field-label">Seed</span><input type="number" min="1" value="${esc(st.seed)}" data-seed> <em>same seed + same strategy = the same game</em></label>` +
      C.button(`${I('play', 14)} Start simulation`, 'data-go', 'ca-btn-on sim-go') +
      '</div></div>'
    );
  }
  function sessionsHtml() {
    if (!S.sessions.length) return '';
    return (
      `<div class="ca-card">${C.cardHead('Running', 'play', '<span class="ca-hint">simulations the server is holding</span>')}<div class="ca-list">` +
      S.sessions
        .map(
          (x) =>
            `<div class="ca-row"><div class="ca-row-text"><b>${esc(x.label)}</b> <span class="ca-hint">from ${esc(x.start)} · seed ${x.seed} · ${span(x.t)} simulated · ${short(x.cookies)} baked${x.playing ? ' · playing' : ''}</span></div>` +
            `<div class="ca-controls">${C.button(`${I('open', 11)} Open`, `data-open="${x.id}"`, 'ca-btn-small')}${C.button('Close', `data-close="${x.id}" data-arm-label="Close it?"`, 'ca-btn-small ca-btn-off')}</div></div>`
        )
        .join('') +
      '</div></div>'
    );
  }
  function mountSetup(root) {
    root.addEventListener('click', onSetupClick);
    root.addEventListener('change', onSetupChange);
    root.addEventListener('input', onSetupChange);
    S.unbindCE = CE.bind(root, {
      onChange: (key, src) => {
        if (key === 'setup') {
          S.setup.custom = src;
          saveSetup();
        }
      },
    });
    api
      .get('/api/sessions')
      .then((list) => {
        const had = S.sessions.length;
        S.sessions = list;
        if (list.length !== had && current === 'sim' && !S.id) {
          const el = root.querySelector('.sim-h1');
          if (el && !root.querySelector('[data-open]') && list.length) render();
        }
      })
      .catch(() => {});
  }
  const onSetupClick = guard(async (e) => {
    const t = e.target.closest('[data-start],[data-strategy],[data-go],[data-open],[data-close]');
    if (!t || e.target.closest('select,textarea,input')) return;
    const d = t.dataset;
    if (d.start) S.setup.start = d.start;
    else if (d.strategy) S.setup.strategy = d.strategy;
    else if (d.open) {
      connect(d.open);
      return render();
    } else if (d.close) {
      if (!CA.UI.Dom.armed(t)) return;
      await api.del(`/api/sessions/${d.close}`);
      S.sessions = S.sessions.filter((x) => x.id !== d.close);
    } else if ('go' in d) {
      t.disabled = true;
      t.innerHTML = `${I('refresh', 14)} Starting…`;
      const st = S.setup;
      const strategy = st.strategy === ':none' ? null : st.strategy === ':custom' ? { source: st.custom, name: 'Your code' } : { file: st.strategy };
      try {
        const { id } = await api.post('/api/sessions', { start: { kind: st.start, scenario: st.scenario, save: st.save }, strategy, seed: st.seed });
        connect(id);
        await api.post(`/api/sessions/${id}/control`, { playing: true, speed: store.get('speed', 60) });
      } catch (err) {
        t.disabled = false;
        throw err;
      }
    }
    saveSetup();
    render();
  });
  function onSetupChange(e) {
    const el = e.target;
    const d = el.dataset;
    if ('scenario' in d) {
      S.setup.scenario = el.value;
      S.setup.start = 'scenario';
      if (e.type === 'change') render();
    } else if ('save' in d) S.setup.save = el.value;
    else if ('seed' in d) S.setup.seed = Math.max(1, Number(el.value) || 1);
    else return;
    saveSetup();
  }

  // ---- the live view -----------------------------------------------------------------------------------

  const SPEEDS = [
    [1, '1×', 'Real time'],
    [10, '10×'],
    [60, '60×', 'A minute a second'],
    [600, '600×', 'Ten minutes a second'],
    [0, 'Max', 'As fast as the computer goes (a few hundred × real time)'],
  ];
  function runbarHtml() {
    const s = S.snap;
    if (!s) return `<span class="ca-hint">${I('refresh', 12)} Connecting…</span>`;
    const date = new Date(s.clock);
    return (
      C.button(I(s.playing ? 'pause' : 'play', 18), `data-ctl="${s.playing ? 'pause' : 'play'}" data-tip="${s.playing ? 'Pause' : 'Play'}"`, `sim-play${s.playing ? '' : ' ca-btn-on'}`) +
      `<div class="sim-clock"><b>${span(s.t)}</b><span>${esc(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} ${esc(date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))} in the game · ${s.ratio ? `${Math.round(s.ratio)}× real time` : '—'}</span></div>` +
      `<span class="ca-chipgroup"><span class="ca-chip-label">Speed</span>${SPEEDS.map(([v, l, tip]) => `<button type="button" class="ca-chip${s.speed === v ? ' on' : ''}" data-speed="${v}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${l}</button>`).join('')}</span>` +
      `<span class="ca-chipgroup"><span class="ca-chip-label">Play for</span>${SPANS.map(([v, l]) => `<button type="button" class="ca-chip" data-runfor="${v}" data-tip="Play ${esc(l)} more, then pause">${l}</button>`).join('')}</span>` +
      (s.until ? `<span class="ca-pill">until ${span(s.until)}</span>` : '') +
      '<span class="sim-spacer"></span>' +
      `<span class="ca-hint">${esc(s.strategy || 'no strategy')} · from ${esc(s.start)} · seed ${s.seed}</span>` +
      `<a class="ca-btn ca-btn-small" href="/api/sessions/${s.id}/save" data-tip="The game's save as it is now (cookieMgr's part in it) — import it in the game, or start another simulation from it">${I('download', 12)} Export save</a>` +
      C.button(`${I('plus', 12)} New`, 'data-ctl="new"', 'ca-btn-small') +
      C.button('Close', 'data-ctl="close" data-arm-label="Close it?"', 'ca-btn-small ca-btn-off')
    );
  }
  function statsHtml() {
    const s = S.snap;
    if (!s) return '';
    const st = s.stats;
    const buffed = st.unbuffedCps && st.cps !== st.unbuffedCps ? `×${(st.cps / st.unbuffedCps).toFixed(st.cps / st.unbuffedCps < 10 ? 1 : 0)} now` : 'unbuffed';
    return (
      tile('Cookies', short(st.cookies), 'in the bank') +
      tile('CpS', short(st.cps), buffed) +
      tile('Baked', short(st.cookiesEarned), 'this ascension') +
      tile('Buildings', String(st.buildings), `${st.upgrades} upgrades`) +
      tile('Golden cookies', String(st.goldenClicks || 0), s.shimmers.length ? `${s.shimmers.length} on screen` : '&nbsp;') +
      tile('Clicks', short(st.clicks), `${short(st.handmade)} handmade`) +
      tile('Achievements', String(st.achievements), st.lumps >= 0 ? `${st.lumps} sugar lumps` : 'no lumps yet') +
      (st.magicM ? tile('Magic', `${Math.floor(st.magic)}/${Math.floor(st.magicM)}`, 'Grimoire') : '')
    );
  }
  function buildingsHtml() {
    const s = S.snap;
    if (!s) return '';
    const total = s.buildings.reduce((a, b) => a + b.cps, 0) || 1;
    let locked = 0;
    return s.buildings
      .filter((b) => !b.locked || locked++ < 1)
      .map(
        (b) =>
          `<div class="sim-bld${b.locked ? ' locked' : ''}">${C.icon({ icon: b.icon })}<span>${esc(b.name)}${b.level ? ` <span class="ca-hint">lv ${b.level}</span>` : ''}</span><b>${b.amount}</b>` +
          `<span class="sim-bar" data-tip="${esc(`${short(b.cps)}/s — ${((b.cps / total) * 100).toFixed(1)}% of the buildings' CpS`)}"><i style="width:${((b.cps / total) * 100).toFixed(1)}%"></i></span><span class="sim-num" data-tip="Price of the next one">${short(b.price)}</span></div>`
      )
      .join('');
  }
  function buffsHtml() {
    const s = S.snap;
    if (!s || !s.buffs.length) return `<div class="ca-card-note">No effect running${s && s.shimmers.length ? ` — ${s.shimmers.length} golden cookie${s.shimmers.length > 1 ? 's' : ''} on screen` : ''}.</div>`;
    return s.buffs
      .map(
        (b) =>
          `<div class="sim-buff">${C.icon({ icon: b.icon })}<b>${esc(b.name)}</b><span class="ca-hint">${b.multCpS && b.multCpS !== 1 ? `CpS ×${b.multCpS}` : ''}${b.multClick && b.multClick !== 1 ? ` clicks ×${b.multClick}` : ''}</span>` +
          `<span class="sim-bar"><i style="width:${Math.max(0, Math.min(100, (b.time / (b.maxTime || 1)) * 100)).toFixed(1)}%"></i></span><span class="sim-num">${span(b.time)}</span></div>`
      )
      .join('');
  }
  function upgradesHtml() {
    const s = S.snap;
    if (!s) return '';
    return (
      `<div class="sim-icons">${s.upgrades.length ? s.upgrades.map((u) => iconAt(u.icon, u.name)).join('') : '<span class="ca-hint">None bought yet.</span>'}</div>` +
      (s.store.length ? `<div class="ca-card-note">In the store: </div><div class="sim-icons">${s.store.map((u) => iconAt(u.icon, `${u.name} — ${short(u.price)}`)).join('')}</div>` : '')
    );
  }
  function gardenHtml() {
    const g = S.snap && S.snap.garden;
    if (!g) return '';
    const tiles = g.tiles
      .map((t) => {
        if (!t.open) return '<div class="ca-gtile locked"></div>';
        let inner = '';
        let tip = '';
        if (t.plant) {
          const st = stageOf(t.plant.mature, t.age);
          inner += plantSprite(t.plant.icon, st);
          if (st === 4 && !t.plant.immortal && t.decay > 0) inner += `<b class="ca-gdecay${t.decay >= 0.5 ? ' hi' : ''}">${Math.round(t.decay * 100)}%</b>`;
          if (!t.plant.unlocked) inner += `<b class="ca-gnew">${I('sparkle', 9)}</b>`;
          tip = `${t.plant.name} — ${['', 'bud', 'sprout', 'bloom', 'mature'][st]} (${t.age}/${t.plant.mature})${t.want && t.want.key !== t.plant.key ? ` · the layout wants ${t.want.name}` : ''}`;
        } else {
          if (t.want) inner += plantSprite(t.want.icon, 0, 'ghost');
          tip = t.want ? `Empty — the layout wants ${t.want.name}` : 'Empty';
        }
        const off = (t.plant ? t.plant.key : null) !== (t.want ? t.want.key : null);
        return `<div class="ca-gtile${off ? ' off' : ''}" data-tip="${esc(tip)}">${inner}</div>`;
      })
      .join('');
    const freq = g.effs && g.effs.goldenCookieFreq ? `+${((g.effs.goldenCookieFreq - 1) * 100).toFixed(1)}%` : '—';
    return (
      `<div class="ca-card">${C.cardHead(`Garden · level ${g.level}`, 'leaf', `<span class="ca-pill">${esc(g.layout || 'no layout')}</span>`)}` +
      `<div class="ca-garden-wrap"><div class="ca-gplot">${tiles}</div><div class="ca-stats ca-gstats">${tile('Soil', esc(g.soil), `ticks every ${span(g.tick)}`)}${tile('Next tick', span(g.nextTick))}${tile('Golden cookies', freq, 'more often, from the garden')}${tile('Seeds', String(g.seeds), 'unlocked')}</div></div></div>`
    );
  }
  function macrosHtml() {
    const s = S.snap;
    if (!s) return '';
    const list = s.macros.filter((m) => m.on || !m.builtin || ['golden', 'bigCookie', 'wrath', 'reindeer', 'wrinklers', 'lumps', 'gardener', 'autoBuyer', 'research', 'cheapUpgrades', 'petDragon', 'autoDragon', 'seasonCompletion', 'fthofOnClickFrenzy', 'stockTrader'].includes(m.id));
    return list
      .map(
        (m) =>
          `<div class="sim-macro${m.on ? ' on' : ''}">${macroIcon(m.icon)}<div class="sim-macro-name"><b>${esc(m.name)}</b>${!m.builtin ? ' <span class="ca-pill">yours</span>' : ''}` +
          `<span class="${m.problem ? 'bad' : ''}">${m.problem ? esc(m.problem) : `${m.mode === 'repeat' || m.mode === 'flow' ? `every ${m.every >= 1000 ? `${m.every / 1000}s` : `${m.every}ms`}` : esc(m.mode)}${m.runs ? ` · ran ${short(m.runs)}×` : ''}`}</span></div>` +
          C.toggle(m.on, `data-macro="${esc(m.id)}"`, m.name) +
          '</div>'
      )
      .join('');
  }
  function doHtml() {
    const acts = meta.vocab.actions;
    const groups = {};
    acts.forEach((a) => (groups[a.group] = groups[a.group] || []).push(a));
    const a = acts.find((x) => x.id === S.doAction) || acts[0];
    S.doAction = a.id;
    const field = (p) => {
      if (p.type === 'bool') return `<label class="ca-field"><input type="checkbox" data-param="${esc(p.key)}" data-type="bool"${p.default ? ' checked' : ''}> ${esc(p.label)}</label>`;
      if (p.type === 'number') return `<label class="ca-field">${esc(p.label)} <input type="number" step="any" data-param="${esc(p.key)}" data-type="number" value="${esc(p.default != null ? p.default : '')}"></label>`;
      if (p.type === 'select' || (p.options && p.options.length)) return `<label class="ca-field">${esc(p.label)} <select data-param="${esc(p.key)}">${(p.options || []).map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(p.default) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
      return `<label class="ca-field">${esc(p.label)} <input type="text" data-param="${esc(p.key)}" value="${esc(p.default != null ? p.default : '')}"></label>`;
    };
    return (
      `<div class="sim-do"><select data-doaction>${Object.keys(groups)
        .map((g) => `<optgroup label="${esc(g)}">${groups[g].map((x) => `<option value="${esc(x.id)}"${x.id === a.id ? ' selected' : ''}>${esc(x.name)}${x.staging ? ' [staging]' : ''}</option>`).join('')}</optgroup>`)
        .join('')}</select><span data-doparams>${a.params.map(field).join('')}</span>${C.button(`${I('play', 11)} Do it`, 'data-do', 'ca-btn-small ca-btn-on')}</div>` +
      `<div class="ca-ed-layout sim-ed"><div class="ca-editor-body">${CE.html('console', S.consoleSrc, { title: 'Code', hint: 'one pass from the top, now — or keep it running as a macro' })}</div></div>` +
      `<div class="sim-do">${C.button(`${I('play', 11)} Run once`, 'data-console="run"', 'ca-btn-small ca-btn-on')}${C.button(`${I('plus', 11)} Keep running as a macro`, 'data-console="macro"', 'ca-btn-small')}<label class="ca-field">every <input type="number" min="50" step="50" value="1000" data-console-every> ms</label></div>` +
      `<pre class="sim-out" data-console-out>${esc(S.consoleOut)}</pre>`
    );
  }
  function actionsHtml() {
    const entries = Object.entries(S.tally).sort((a, b) => b[1] - a[1]);
    const t0 = S.snap ? S.snap.clock - S.snap.t * 1000 : 0;
    const rows = S.actions
      .slice(-150)
      .reverse()
      .map((a) => `<div class="sim-act-row"><span>${span((a.t - t0) / 1000)}</span><span>${esc(a.id)}${a.params ? `(${esc(Object.values(a.params).join(', '))})` : '()'}</span><span>${a.n}</span></div>`)
      .join('');
    return (
      `<div class="sim-tally">${entries.length ? entries.map(([k, v]) => `<span class="ca-chip" data-tip="Since this page connected">${esc(k)} <b>×${short(v)}</b></span>`).join('') : '<span class="ca-hint">No actions yet.</span>'}</div>` +
      `<div class="sim-log">${rows}</div>`
    );
  }
  /** Refreshes everything live (morphing, so hovers and inputs survive). */
  let snaps = 0;
  function live(force) {
    const root = main();
    if (!S.id || !root) return;
    const bar = $('[data-sim-runbar]', root);
    if (!bar) return;
    morph(bar, runbarHtml());
    morph($('[data-sim-stats]', root), statsHtml());
    // the heavier panels every other snapshot (they come ~3 times a second)
    if (!force && snaps++ % 2) return;
    morph($('[data-sim-bld]', root), buildingsHtml());
    const bs = $('[data-sim-bldsum]', root);
    if (bs && S.snap) bs.textContent = `${S.snap.stats.buildings} owned`;
    morph($('[data-sim-buffs]', root), buffsHtml());
    morph($('[data-sim-upg]', root), upgradesHtml());
    const us = $('[data-sim-upgsum]', root);
    if (us && S.snap) us.textContent = `${S.snap.stats.upgrades} bought`;
    morph($('[data-sim-garden]', root), gardenHtml());
    morph($('[data-sim-macros]', root), macrosHtml());
    morph($('[data-sim-actions]', root), actionsHtml());
  }
  function topRun() {
    const el = $('[data-sim-toprun]');
    if (!el) return;
    const s = S.snap;
    el.innerHTML = s ? `${I(s.playing ? 'play' : 'pause', 12)} <b>${span(s.t)}</b> · ${short(s.stats.cookiesEarned)} baked · ${short(s.stats.cps)}/s` : '';
  }

  const ctl = (body) => api.post(`/api/sessions/${S.id}/control`, body);
  const onSimClick = guard(async (e) => {
    const t = e.target.closest('[data-ctl],[data-speed],[data-runfor],[data-macro],[data-do],[data-console],[data-ca="option"]');
    if (!t) return;
    const d = t.dataset;
    if (d.ctl === 'play') await ctl({ playing: true });
    else if (d.ctl === 'pause') await ctl({ playing: false });
    else if (d.ctl === 'new') {
      disconnect();
      S.id = null;
      store.set('session', null);
      return render();
    } else if (d.ctl === 'close') {
      if (!CA.UI.Dom.armed(t)) return;
      await api.del(`/api/sessions/${S.id}`);
      disconnect();
      S.id = null;
      store.set('session', null);
      return render();
    } else if (d.speed != null) {
      store.set('speed', Number(d.speed));
      await ctl({ speed: Number(d.speed), playing: true });
    } else if (d.runfor) await ctl({ run: d.runfor });
    else if (d.ca === 'option') {
      // an option card on a hosted page (Effect shading, Event markers, Active time only…)
      CA.Settings.set(d.key, !CA.Settings.get(d.key));
      rehost();
    } else if (d.macro) {
      const on = !t.classList.contains('on');
      t.classList.toggle('on', on);
      await api.post(`/api/sessions/${S.id}/macro`, { id: d.macro, on });
    } else if ('do' in d) {
      const params = {};
      main()
        .querySelectorAll('[data-doparams] [data-param]')
        .forEach((el) => (params[el.dataset.param] = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value));
      const a = meta.vocab.actions.find((x) => x.id === S.doAction);
      const r = await api.post(`/api/sessions/${S.id}/act`, { id: S.doAction, params });
      toast(`${a ? a.name : S.doAction}: ${r.n ? `${r.n} ${a && a.unit ? a.unit : 'done'}` : 'nothing to do'}`);
    } else if (d.console === 'run') {
      const r = await api.post(`/api/sessions/${S.id}/code`, { source: S.consoleSrc });
      S.consoleOut = `${r.done} thing${r.done === 1 ? '' : 's'} done${r.error ? ` · ${r.error}` : ''}\n${r.trace.join('\n')}`;
      morph($('[data-console-out]'), esc(S.consoleOut));
    } else if (d.console === 'macro') {
      const every = Number(($('[data-console-every]') || {}).value) || 1000;
      await api.post(`/api/sessions/${S.id}/macro`, { source: S.consoleSrc, every, name: 'From the console' });
      toast(`Running as a macro, every ${every} ms — it's in cookieMgr's macros, switch it off there`);
    }
  });
  function onSimChange(e) {
    const el = e.target;
    // an option with choices on a hosted page (its dropdown), as the add-on's panel handles it
    if (el.dataset && el.dataset.caChoice) {
      CA.Settings.set(el.dataset.caChoice, el.value);
      return rehost();
    }
    if ('doaction' in el.dataset) {
      S.doAction = el.value;
      const card = el.closest('.ca-card');
      const tmp = document.createElement('div');
      tmp.innerHTML = doHtml();
      const fresh = tmp.querySelector('[data-doparams]');
      const old = card.querySelector('[data-doparams]');
      if (fresh && old) old.replaceWith(fresh);
    }
  }

  // =====================================================================================================
  // Compare
  // =====================================================================================================

  const CMP = {
    pick: new Set(store.get('cmpPick', ['payback', 'cheapest'])),
    seeds: store.get('cmpSeeds', 3),
    span: store.get('cmpSpan', '1h'),
    start: store.get('cmpStart', 'fresh'),
    scenario: store.get('cmpScenario', 'garden6'),
    save: '',
    combo: '',
    job: null, // { id, state, meta, progress, results }
    es: null,
    metric: 'cookiesEarned',
  };
  const COLORS = ['#ffd36a', '#6fc3ff', '#9be15d', '#ff8a65', '#c77dff', '#4fd6c7', '#ff8fd0', '#e8c547'];
  function watchJob(id) {
    if (CMP.es) CMP.es.close();
    CMP.job = { id, state: 'running', progress: { done: 0, total: 0 }, results: [] };
    const es = new EventSource(`/api/jobs/${id}/stream`);
    CMP.es = es;
    es.addEventListener('state', (e) => {
      Object.assign(CMP.job, JSON.parse(e.data));
      cmpLive();
    });
    es.addEventListener('result', (e) => {
      CMP.job.results.push(JSON.parse(e.data));
      cmpLive();
    });
    es.addEventListener('progress', (e) => {
      CMP.job.progress = JSON.parse(e.data);
      cmpLive();
    });
    es.addEventListener('done', () => {
      CMP.job.state = 'done';
      es.close();
      cmpLive();
    });
    es.onerror = () => es.readyState === EventSource.CLOSED && cmpLive();
  }
  pages.compare = {
    html() {
      const opts = meta.strategies.map((s) => `<button type="button" class="sim-tile${CMP.pick.has(s.name) ? ' on' : ''}" data-cpick="${esc(s.name)}"><b>${I(CMP.pick.has(s.name) ? 'star' : 'starOutline', 12)} ${esc(s.name)}</b><span class="ca-hint">${esc(s.desc)}</span></button>`).join('');
      return (
        '<div class="sim-h1">Compare <small>strategies side by side, over several seeds — each a separate game, run in parallel</small></div>' +
        `<div class="ca-card">${C.cardHead('Strategies', 'bolt', '<span class="ca-hint">pick two or more</span>')}<div class="sim-tiles">${opts}</div>` +
        `<div class="sim-form"><label class="ca-field"><span class="ca-field-label">Or a combination</span><input type="text" size="34" placeholder="golden+payback, bigCookie+cheapest…" value="${esc(CMP.combo)}" data-combo></label><span class="ca-hint">strategies and built-in macros joined with +</span></div></div>` +
        `<div class="ca-card">${C.cardHead('How', 'settings')}<div class="sim-form">` +
        `<span class="ca-chipgroup"><span class="ca-chip-label">Each plays</span>${chips(SPANS, 'data-cspan', CMP.span)}</span>` +
        `<label class="ca-field"><span class="ca-field-label">Seeds</span><input type="number" min="1" max="50" value="${CMP.seeds}" data-cseeds> <em>games per strategy</em></label>` +
        `<span class="ca-chipgroup"><span class="ca-chip-label">From</span>${chips(
          [
            ['fresh', 'a new game'],
            ['scenario', 'a scenario'],
            ['save', 'your save'],
          ],
          'data-cstart',
          CMP.start
        )}</span>` +
        (CMP.start === 'scenario' ? `<select class="sim-input" data-cscenario>${meta.scenarios.filter((x) => x.name !== 'fresh').map((x) => `<option${x.name === CMP.scenario ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '') +
        C.button(`${I('play', 13)} Compare`, 'data-cgo', 'ca-btn-on sim-go') +
        '</div>' +
        (CMP.start === 'save' ? `<textarea class="sim-save" data-csave placeholder="Paste your exported save here…">${esc(CMP.save)}</textarea>` : '') +
        '</div>' +
        '<div data-cresult></div>'
      );
    },
    mount(root) {
      root.addEventListener('click', onCmpClick);
      root.addEventListener('change', onCmpChange);
      root.addEventListener('input', onCmpChange);
      const keep = store.get('cmpJob', null);
      if (!CMP.job && keep) watchJob(keep);
      cmpLive();
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onCmpClick);
      root.removeEventListener('change', onCmpChange);
      root.removeEventListener('input', onCmpChange);
      if (CMP.chart) CMP.chart.destroy();
      CMP.chart = null;
    },
  };
  function stats(xs) {
    const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
    return { m, sd, min: Math.min(...xs), max: Math.max(...xs) };
  }
  function cmpRows() {
    const by = new Map();
    CMP.job.results.forEach((r) => {
      if (!by.has(r.strategy)) by.set(r.strategy, []);
      by.get(r.strategy).push(r);
    });
    return [...by].map(([name, rs], i) => {
      const ok = rs.filter((r) => !r.failed);
      return {
        name,
        color: COLORS[i % COLORS.length],
        runs: ok,
        failed: rs.length - ok.length,
        baked: stats(ok.map((r) => r.final.cookiesEarned)),
        cps: stats(ok.map((r) => r.final.cps)),
        golden: stats(ok.map((r) => r.final.goldenClicks || 0)),
        buildings: stats(ok.map((r) => r.final.buildings)),
        speed: stats(ok.map((r) => r.simSeconds / (r.wallMs / 1000))),
      };
    });
  }
  function cmpLive() {
    const box = $('[data-cresult]');
    if (!box || current !== 'compare') return;
    const j = CMP.job;
    if (!j) return morph(box, '');
    const rows = cmpRows().sort((a, b) => b.baked.m - a.baked.m);
    const pct = j.progress.total ? (j.progress.done / j.progress.total) * 100 : 0;
    const m = j.meta || {};
    if (!box.querySelector('[data-cchart]')) {
      box.innerHTML =
        `<div class="ca-card">${C.cardHead('Result', 'graphs', '<span class="ca-hint" data-cmeta></span>')}<div class="sim-progress" data-cprog><i></i></div><div data-ctable></div>` +
        `<div class="ca-toolbar">${chips(
          [
            ['cookiesEarned', 'Cookies baked'],
            ['cps', 'CpS'],
          ],
          'data-cmetric',
          CMP.metric
        )}<span class="ca-hint">the mean of the seeds, and the range between the worst and the best</span></div>` +
        '<div class="sim-chart"><canvas data-cchart></canvas></div><div data-cfail></div></div>';
      CMP.chart = SimChart.create($('[data-cchart]', box));
    }
    $('[data-cmeta]', box).textContent = `${(m.strategies || []).length} strategies × ${m.seeds || '?'} seeds · ${m.span || ''} each · from ${m.start || 'a new game'}${j.state === 'running' ? ` · ${j.progress.done}/${j.progress.total} done` : ' · done'}`;
    const prog = $('[data-cprog]', box);
    prog.style.display = j.state === 'running' ? '' : 'none';
    prog.firstChild.style.width = `${pct}%`;
    const best = rows.length ? rows[0].name : null;
    morph(
      $('[data-ctable]', box),
      rows.length
        ? '<table class="sim-table"><tr><th>Strategy</th><th>Games</th><th>Baked (mean)</th><th>± sd</th><th>Worst … best</th><th>Final CpS</th><th>Golden cookies</th><th>Buildings</th><th>Speed</th></tr>' +
            rows
              .map(
                (r) =>
                  `<tr class="${r.name === best && rows.length > 1 && j.state !== 'running' ? 'best' : ''}"><td><i class="ca-sw" style="background:${r.color}"></i> <b>${esc(r.name)}</b></td><td>${r.runs.length}${r.failed ? ` <span class="ca-pill ca-pill-warn">${r.failed} failed</span>` : ''}</td><td><b>${short(r.baked.m)}</b></td><td>${short(r.baked.sd)}</td><td>${short(r.baked.min)} … ${short(r.baked.max)}</td><td>${short(r.cps.m)}/s</td><td>${r.golden.m.toFixed(1)}</td><td>${Math.round(r.buildings.m)}</td><td>${Math.round(r.speed.m)}×</td></tr>`
              )
              .join('') +
            '</table>'
        : '<div class="ca-card-note">The first games are playing…</div>'
    );
    // the chart: per strategy, the mean over its seeds at each sampled minute, with the min–max range
    const series = rows.map((r) => {
      const n = Math.min(...r.runs.map((x) => x.samples.length));
      const pts = [];
      const band = [];
      for (let i = 0; i < n; i++) {
        const vs = r.runs.map((x) => x.samples[i][CMP.metric]);
        const s = stats(vs);
        const t = r.runs[0].samples[i].t;
        pts.push([t, s.m]);
        band.push([t, s.min, s.max]);
      }
      return { name: r.name, color: r.color, points: pts, band, fmt: CMP.metric === 'cps' ? (v) => `${short(v)}/s` : short };
    });
    CMP.chart.draw({ series, log: true, xFmt: span, empty: 'Waiting for the first results…' });
    const failed = j.results.filter((r) => r.failed);
    morph($('[data-cfail]', box), failed.length ? `<div class="sim-err">${esc(failed[0].strategy)} (seed ${failed[0].seed}) failed:\n${esc(failed[0].error || '')}</div>` : '');
  }
  const onCmpClick = guard(async (e) => {
    const t = e.target.closest('[data-cpick],[data-cspan],[data-cstart],[data-cgo],[data-cmetric]');
    if (!t) return;
    const d = t.dataset;
    if (d.cpick) {
      if (CMP.pick.has(d.cpick)) CMP.pick.delete(d.cpick);
      else CMP.pick.add(d.cpick);
      store.set('cmpPick', [...CMP.pick]);
    } else if (d.cspan) {
      CMP.span = d.cspan;
      store.set('cmpSpan', CMP.span);
    } else if (d.cstart) {
      CMP.start = d.cstart;
      store.set('cmpStart', CMP.start);
    } else if (d.cmetric) {
      CMP.metric = d.cmetric;
      t.parentNode.querySelectorAll('[data-cmetric]').forEach((b) => b.classList.toggle('on', b === t));
      return cmpLive();
    } else if ('cgo' in d) {
      const strategies = [...CMP.pick].concat(CMP.combo.split(/[,\s]+/).filter(Boolean));
      if (!strategies.length) throw new Error('Pick at least one strategy');
      const { id } = await api.post('/api/compare', { strategies, seeds: CMP.seeds, span: CMP.span, start: { kind: CMP.start, scenario: CMP.scenario, save: CMP.save } });
      store.set('cmpJob', id);
      if (CMP.chart) CMP.chart.destroy();
      CMP.chart = null;
      const box = $('[data-cresult]');
      if (box) box.innerHTML = '';
      watchJob(id);
      toast(`${strategies.length * CMP.seeds} games started`);
      return;
    }
    const y = window.scrollY;
    const res = $('[data-cresult]');
    const kept = res ? [...res.childNodes] : [];
    render();
    const box = $('[data-cresult]');
    if (box && kept.length) {
      box.replaceChildren(...kept);
    }
    window.scrollTo(0, y);
  });
  function onCmpChange(e) {
    const el = e.target;
    const d = el.dataset;
    if ('cseeds' in d) store.set('cmpSeeds', (CMP.seeds = Math.max(1, Math.min(50, Number(el.value) || 1))));
    else if ('combo' in d) CMP.combo = el.value;
    else if ('csave' in d) CMP.save = el.value;
    else if ('cscenario' in d) store.set('cmpScenario', (CMP.scenario = el.value));
  }

  // =====================================================================================================
  // Strategies
  // =====================================================================================================

  const ST = { file: store.get('stratFile', null), draft: null, error: '', newName: '' };
  const builtinMacros = () => meta.vocab.macros.filter((m) => m.mode !== 'group');
  /** The # with: / # every: / # profile: lines of a .cmgr, read and written. */
  function headerOf(src) {
    const h = { every: 1000, with: [], profile: '' };
    for (const line of String(src).split('\n')) {
      const m = line.match(/^#\s*(every|with|profile)\s*:\s*(.*?)\s*$/i);
      if (m) {
        const k = m[1].toLowerCase();
        if (k === 'every') h.every = Number(m[2].replace(/ms$/, '')) || 1000;
        else if (k === 'with') h.with = m[2].split(/[,\s]+/).filter(Boolean);
        else h.profile = m[2];
      } else if (line.trim() && !line.trim().startsWith('#')) break;
    }
    return h;
  }
  function withHeader(src, h) {
    const lines = String(src).split('\n');
    let firstCode = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
    if (firstCode < 0) firstCode = lines.length;
    const head = lines.slice(0, firstCode).filter((l) => !/^#\s*(every|with|profile)\s*:/i.test(l));
    const rest = lines.slice(firstCode);
    const add = [];
    if (h.with.length) add.push(`# with: ${h.with.join(', ')}`);
    if (h.every && h.every !== 1000) add.push(`# every: ${h.every}`);
    if (h.profile) add.push(`# profile: ${h.profile}`);
    const at = head.length && head[0].startsWith('#') ? 1 : 0;
    head.splice(at, 0, ...add);
    return head.concat(rest).join('\n');
  }
  pages.strategies = {
    html() {
      const list = meta.strategies;
      if (!ST.file || !list.some((s) => s.file === ST.file)) ST.file = (list[0] || {}).file || null;
      const s = list.find((x) => x.file === ST.file);
      const src = ST.draft != null ? ST.draft : s ? s.source : '';
      const dirty = s && ST.draft != null && ST.draft !== s.source;
      const h = headerOf(src);
      return (
        '<div class="sim-h1">Strategies <small>sim/strategies/ — cookieMgr’s algorithmic code: paste one into an algorithmic macro in the add-on and it does the same there</small></div>' +
        '<div class="sim-strats"><div>' +
        `<div class="ca-card">${C.cardHead('Files', 'save')}${list
          .map((x) => `<button type="button" class="sim-strat-item${x.file === ST.file ? ' on' : ''}" data-sfile="${esc(x.file)}"><b>${I(x.kind === 'cmgr' ? 'edit' : 'puzzle', 11)} ${esc(x.name)}</b><span>${esc(x.desc || x.file)}</span></button>`)
          .join('')}` +
        `<div class="sim-do"><input type="text" class="sim-input" size="14" placeholder="new-name" value="${esc(ST.newName)}" data-snew>${C.button(`${I('plus', 11)} New`, 'data-sact="new"', 'ca-btn-small')}</div></div>` +
        '</div><div>' +
        (!s
          ? '<div class="ca-card"><div class="ca-card-note">No strategy yet — make one on the left.</div></div>'
          : s.kind === 'mjs'
            ? `<div class="ca-card">${C.cardHead(esc(s.file), 'puzzle', '<span class="ca-pill">JavaScript</span>')}<div class="ca-card-note">A .mjs strategy sets the simulation up in code (sim.* — see sim/README.md). Edit it in your editor; it runs here as it is.</div><pre class="sim-term">${esc(s.source)}</pre>` +
              `<div class="sim-do">${C.button(`${I('play', 11)} Simulate it`, 'data-sact="run"', 'ca-btn-small ca-btn-on')}</div></div>`
            : `<div class="ca-card ca-editor2">${C.cardHead(
                esc(s.file),
                'edit',
                `<div class="ca-card-meta">${dirty ? '<span class="ca-pill ca-pill-warn">unsaved</span>' : ''}` +
                  C.button(`${I('save', 12)} Save`, 'data-sact="save"', `ca-btn-small${dirty ? ' ca-btn-on' : ''}`) +
                  (dirty ? C.button('Discard', 'data-sact="discard"', 'ca-btn-small') : '') +
                  C.button(`${I('play', 12)} Simulate it`, 'data-sact="run"', 'ca-btn-small') +
                  C.button(`${I('graphs', 12)} Compare`, 'data-sact="compare"', 'ca-btn-small') +
                  C.button(`${I('open', 12)} Copy for the add-on`, 'data-sact="copy"', 'ca-btn-small', '') +
                  C.button('Delete', 'data-sact="delete" data-arm-label="Delete the file?"', 'ca-btn-small ca-btn-off') +
                  '</div>'
              )}` +
              (ST.error ? `<div class="ca-editor-error">${esc(ST.error)}</div>` : '') +
              `<div class="sim-form"><span class="ca-chipgroup"><span class="ca-chip-label">With</span>${builtinMacros()
                .filter((m) => ['golden', 'bigCookie', 'wrath', 'reindeer', 'wrinklers', 'lumps', 'gardener', 'fortune', 'research', 'cheapUpgrades', 'petDragon', 'autoDragon', 'fthofOnClickFrenzy', 'stockTrader', 'elderPledge'].includes(m.id) || h.with.includes(m.id))
                .map((m) => `<button type="button" class="ca-chip${h.with.includes(m.id) ? ' on' : ''}" data-swith="${esc(m.id)}" data-tip="${esc(m.desc || m.name)}">${esc(m.name)}</button>`)
                .join('')}</span>` +
              `<label class="ca-field"><span class="ca-field-label">A pass every</span><input type="number" min="50" step="50" value="${h.every}" data-severy> ms</label>` +
              `<label class="ca-field"><span class="ca-field-label">Garden profile</span><select data-sprofile><option value="">—</option>${meta.vocab.profiles.map((p) => `<option value="${esc(p.id)}"${h.profile === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>` +
              (CA.UI.CodeKnobs ? CA.UI.CodeKnobs.html('strat', src, {}) : '') +
              `<div class="ca-ed-layout sim-ed"><div class="ca-editor-body">${CE.html('strat', src, { title: 'Its code', hint: 'the # lines at the top set it up · Tab indents · click the library to insert' })}</div>${CE.libraryHtml('strat')}</div></div>`) +
        '</div></div>'
      );
    },
    mount(root) {
      root.addEventListener('click', onStratClick);
      root.addEventListener('change', onStratChange);
      root.addEventListener('input', onStratChange);
      root.addEventListener('input', onKnob);
      ST.unbind = CE.bind(root, {
        onChange: (key, src) => {
          if (key !== 'strat') return;
          const s = meta.strategies.find((x) => x.file === ST.file);
          const was = ST.draft != null && s && ST.draft !== s.source;
          ST.draft = src;
          const kp = root.querySelector('[data-knobs="strat"]');
          if (kp && CA.UI.CodeKnobs) morph(kp, CA.UI.CodeKnobs.inner(src, {}));
          if (was !== (s && src !== s.source)) {
            // the header's Save / "unsaved" follow the first change
            const head = root.querySelector('.ca-editor2 .ca-card-head');
            const tmp = document.createElement('div');
            tmp.innerHTML = pages.strategies.html();
            const fresh = tmp.querySelector('.ca-editor2 .ca-card-head');
            if (head && fresh) head.replaceWith(fresh);
          }
        },
      });
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onStratClick);
      root.removeEventListener('change', onStratChange);
      root.removeEventListener('input', onStratChange);
      root.removeEventListener('input', onKnob);
      if (ST.unbind) ST.unbind();
    },
  };
  /** A knob moved (or its number typed, or its switch flipped): the variable's line in the code follows. */
  function setVar(name, value, from) {
    const s = meta.strategies.find((x) => x.file === ST.file);
    const src = ST.draft != null ? ST.draft : s ? s.source : '';
    const next = CA.UI.CodeKnobs.setIn(src, name, value);
    if (next === src) return;
    ST.draft = next;
    const root = main();
    const ta = root.querySelector('[data-code-ed="strat"] [data-code]');
    if (ta) {
      ta.value = next;
      CE.refresh(ta);
    }
    // the knob's other half (slider ↔ number box) shows the same number
    if (from) root.querySelectorAll(`[data-knob="${name}"], [data-knob-num="${name}"]`).forEach((el) => el !== from && (el.value = from.value));
    const head = root.querySelector('.ca-editor2 .ca-card-head');
    const tmp = document.createElement('div');
    tmp.innerHTML = pages.strategies.html();
    const fresh = tmp.querySelector('.ca-editor2 .ca-card-head');
    if (head && fresh) head.replaceWith(fresh);
  }
  function onKnob(e) {
    const el = e.target;
    if (!CA.UI.CodeKnobs || !(el.dataset.knob || el.dataset.knobNum)) return;
    const s = meta.strategies.find((x) => x.file === ST.file);
    const src = ST.draft != null ? ST.draft : s ? s.source : '';
    const v = CA.UI.CodeKnobs.valueOf(el, src, {});
    if (v != null) setVar(el.dataset.knob || el.dataset.knobNum, v, el);
  }
  async function refreshMeta() {
    const m = await api.get('/api/meta');
    meta.strategies = m.strategies;
  }
  const onStratClick = guard(async (e) => {
    const t = e.target.closest('[data-sfile],[data-sact],[data-swith],[data-knob-toggle]');
    if (!t) return;
    const d = t.dataset;
    const s = meta.strategies.find((x) => x.file === ST.file);
    const src = ST.draft != null ? ST.draft : s ? s.source : '';
    if (d.knobToggle) {
      const v = CA.UI.CodeKnobs.scan(src).find((x) => x.name === d.knobToggle);
      if (v) setVar(v.name, !v.value);
      const kp = main().querySelector('[data-knobs="strat"]');
      if (kp) morph(kp, CA.UI.CodeKnobs.inner(ST.draft, {}));
      return;
    }
    if (d.sfile) {
      if (ST.draft != null && s && ST.draft !== s.source && !confirm('Leave this strategy without saving?')) return;
      ST.file = d.sfile;
      ST.draft = null;
      ST.error = '';
      store.set('stratFile', ST.file);
    } else if (d.swith) {
      const h = headerOf(src);
      h.with = h.with.includes(d.swith) ? h.with.filter((x) => x !== d.swith) : h.with.concat(d.swith);
      ST.draft = withHeader(src, h);
    } else if (d.sact === 'save') {
      ST.error = '';
      try {
        await api.put(`/api/strategies/${ST.file}`, { source: src });
      } catch (err) {
        ST.error = err.message;
        return render();
      }
      await refreshMeta();
      ST.draft = null;
      toast(`${ST.file} saved`);
    } else if (d.sact === 'discard') {
      ST.draft = null;
      ST.error = '';
    } else if (d.sact === 'delete') {
      if (!CA.UI.Dom.armed(t)) return;
      await api.del(`/api/strategies/${ST.file}`);
      await refreshMeta();
      ST.file = null;
      ST.draft = null;
    } else if (d.sact === 'new') {
      const name = (ST.newName || '').trim().replace(/\.cmgr$/, '');
      if (!/^[\w-]+$/.test(name)) throw new Error('A name of letters, digits, - and _');
      if (meta.strategies.some((x) => x.name === name)) throw new Error(`${name} exists already`);
      await api.put(`/api/strategies/${name}.cmgr`, { source: TEMPLATE.replace('My strategy', name) });
      await refreshMeta();
      ST.file = `${name}.cmgr`;
      ST.newName = '';
      ST.draft = null;
      store.set('stratFile', ST.file);
    } else if (d.sact === 'copy') {
      await navigator.clipboard.writeText(src);
      toast('Copied — in the add-on: Macros → New → Algorithmic, and paste. The “# with:” lines are just comments there: switch those built-ins on yourself.');
      return;
    } else if (d.sact === 'run') {
      if (ST.draft != null && s.kind === 'cmgr' && ST.draft !== s.source) {
        S.setup.strategy = ':custom';
        S.setup.custom = ST.draft;
      } else S.setup.strategy = s.name;
      saveSetup();
      disconnect();
      S.id = null;
      return go('sim');
    } else if (d.sact === 'compare') {
      CMP.pick.add(s.name);
      store.set('cmpPick', [...CMP.pick]);
      return go('compare');
    }
    render();
  });
  function onStratChange(e) {
    const el = e.target;
    const d = el.dataset;
    if ('snew' in d) {
      ST.newName = el.value;
      return;
    }
    if (e.type !== 'change') return;
    const s = meta.strategies.find((x) => x.file === ST.file);
    const src = ST.draft != null ? ST.draft : s ? s.source : '';
    const h = headerOf(src);
    if ('severy' in d) h.every = Math.max(50, Number(el.value) || 1000);
    else if ('sprofile' in d) h.profile = el.value;
    else return;
    ST.draft = withHeader(src, h);
    render();
  }

  // =====================================================================================================
  // Experiments
  // =====================================================================================================

  const EX = { name: store.get('exName', null), args: {}, job: null, out: '', es: null, state: '' };
  const defaultsOf = (usage) =>
    (usage.match(/\[([^\]]+)\]/g) || [])
      .map((x) => x.slice(1, -1))
      .join(' ');
  pages.experiments = {
    html() {
      const list = meta.experiments;
      if (!EX.name || !list.some((x) => x.name === EX.name)) EX.name = (list[0] || {}).name;
      const x = list.find((y) => y.name === EX.name);
      if (x && EX.args[x.name] == null) EX.args[x.name] = defaultsOf(x.usage);
      return (
        '<div class="sim-h1">Experiments <small>sim/experiments/ — questions answered with the fast models and the simulator</small></div>' +
        `<div class="ca-card"><div class="sim-tiles">${list.map((y) => `<button type="button" class="sim-tile${y.name === EX.name ? ' on' : ''}" data-ex="${esc(y.name)}"><b>${I('puzzle', 13)} ${esc(y.name)}</b><span class="ca-hint">${esc(y.desc)}</span></button>`).join('')}</div></div>` +
        (x
          ? `<div class="ca-card">${C.cardHead(esc(x.name), 'puzzle')}` +
            (x.about ? `<div class="ca-card-note" style="white-space:pre-wrap">${esc(x.about)}</div>` : '') +
            `<div class="sim-form"><label class="ca-field"><span class="ca-field-label">Arguments</span><input type="text" size="48" value="${esc(EX.args[x.name])}" data-exargs></label>` +
            C.button(EX.state === 'running' ? `${I('refresh', 13)} Running…` : `${I('play', 13)} Run`, `data-exrun${EX.state === 'running' ? ' disabled' : ''}`, 'ca-btn-on sim-go') +
            (EX.state === 'running' ? C.button('Stop', 'data-exstop', 'ca-btn-small ca-btn-off') : '') +
            `<span class="ca-hint">${esc(x.usage)}</span></div>` +
            `<pre class="sim-term" data-exout>${esc(EX.out || 'Its output shows here as it runs.')}</pre></div>`
          : '')
      );
    },
    mount(root) {
      root.addEventListener('click', onExClick);
      root.addEventListener('input', onExInput);
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onExClick);
      root.removeEventListener('input', onExInput);
    },
  };
  const onExClick = guard(async (e) => {
    const t = e.target.closest('[data-ex],[data-exrun],[data-exstop]');
    if (!t) return;
    const d = t.dataset;
    if (d.ex) {
      EX.name = d.ex;
      store.set('exName', EX.name);
    } else if ('exrun' in d) {
      const { id } = await api.post(`/api/experiments/${EX.name}`, { args: EX.args[EX.name] });
      EX.job = id;
      EX.out = '';
      EX.state = 'running';
      if (EX.es) EX.es.close();
      const es = new EventSource(`/api/jobs/${id}/stream`);
      EX.es = es;
      const show = () => {
        const pre = $('[data-exout]');
        if (pre && current === 'experiments') {
          pre.textContent = EX.out;
          pre.scrollTop = pre.scrollHeight;
        }
      };
      es.addEventListener('out', (ev) => {
        // progress lines rewrite themselves with \r: keep the last version of a line
        EX.out = (EX.out + JSON.parse(ev.data)).replace(/[^\n]*\r(?!\n)/g, '');
        show();
      });
      es.addEventListener('done', (ev) => {
        EX.state = JSON.parse(ev.data).code === 0 ? 'done' : 'failed';
        es.close();
        if (current === 'experiments') render();
      });
    } else if ('exstop' in d) {
      await api.del(`/api/jobs/${EX.job}`);
      EX.state = 'stopped';
      EX.out += '\n(stopped)';
    }
    render();
  });
  function onExInput(e) {
    if ('exargs' in e.target.dataset) EX.args[EX.name] = e.target.value;
  }

  // =====================================================================================================
  // Garden: golden cookie frequency over game time, gardener by gardener (experiments/garden-frequency.mjs)
  // =====================================================================================================

  const GD = Object.assign({ level: 8, tulips: [4, 8], hours: 1000, seeds: 3 }, store.get('garden', {}), { study: null, error: '', loading: false, at: null });
  // the scores: a save, its game state (as read, and as edited), its income curve
  const SC = { save: store.get('gardenSave', ''), saved: null, state: null, options: null, hours: store.get('scoreHow', 0), job: null, progress: '', curve: null, error: '', reading: false };
  const PLANT_ICON = { G: 5, N: 13 }; // gardenPlants.png rows: golden clover, nursetulip
  const PLOTS = { 1: '2×2', 2: '3×2', 3: '3×3', 4: '4×3', 5: '4×4', 6: '5×4', 7: '5×5', 8: '6×5', 9: '6×6' };
  const pc = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
  const bonus = (x) => `+${Math.round(x * 100)}%`;
  const hrs = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`);
  /** The share of the time at `x` or more. */
  const atLeast = (r, x, bin) => r.bins.reduce((a, v, k) => a + (k * bin >= x - 1e-9 ? v : 0), 0);

  function gardenLayoutHtml(layout, w) {
    return (
      `<div class="sim-mini-plot" style="grid-template-columns:repeat(${w},22px)">` +
      layout
        .split('')
        .map((k) => `<div class="ca-gtile">${PLANT_ICON[k] != null ? plantSprite(PLANT_ICON[k], 4, 'sim-mini') : ''}</div>`)
        .join('') +
      '</div>'
    );
  }

  /** One gardener's histogram: an SVG on the shared scales (x: bonus, y: share of the time). */
  const HW = 460;
  const HH = 190;
  const HP = { l: 40, r: 10, t: 14, b: 26 };
  function histogramSvg(r, scale, bin) {
    const iw = HW - HP.l - HP.r;
    const ih = HH - HP.t - HP.b;
    const X = (v) => HP.l + (v / scale.x) * iw;
    const Y = (v) => HP.t + ih - (v / scale.y) * ih;
    let g = '';
    for (const t of scale.yTicks) g += `<line class="sim-h-grid" x1="${HP.l}" x2="${HW - HP.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="sim-h-tick" x="${HP.l - 5}" y="${Y(t) + 3}" text-anchor="end">${Math.round(t * 100)}%</text>`;
    scale.xTicks.forEach((t, i) => (g += `<text class="sim-h-tick" x="${X(t)}" y="${HH - HP.b + 15}" text-anchor="${i === scale.xTicks.length - 1 ? 'end' : 'middle'}">${bonus(t)}</text>`));
    let bars = '';
    r.bins.forEach((v, k) => {
      if (v < 1e-6) return;
      const x0 = X(k * bin) + 1;
      const w = Math.max(1, X((k + 1) * bin) - X(k * bin) - 2);
      const y = Y(Math.min(v, scale.y));
      bars += `<rect class="sim-h-bar" data-k="${k}" x="${x0.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(HP.t + ih - y).toFixed(1)}" rx="1.5"/>`;
    });
    const mx = X(r.mean);
    return (
      `<svg class="sim-hist" viewBox="0 0 ${HW} ${HH}" preserveAspectRatio="xMidYMid meet" data-hist="${esc(r.id)}">` +
      g +
      `<line class="sim-h-axis" x1="${HP.l}" x2="${HW - HP.r}" y1="${HP.t + ih}" y2="${HP.t + ih}"/>` +
      `<rect class="sim-h-shade" data-shade x="${HW - HP.r}" y="${HP.t}" width="0" height="${ih}"/>` +
      `<g data-bars>${bars}</g>` +
      `<line class="sim-h-mean" x1="${mx}" x2="${mx}" y1="${HP.t - 4}" y2="${HP.t + ih}"/>` +
      `<text class="sim-h-meanlabel" x="${mx + (mx > HW - 110 ? -4 : 4)}" y="${HP.t + 6}" text-anchor="${mx > HW - 110 ? 'end' : 'start'}">mean ${bonus(r.mean)}</text>` +
      `<line class="sim-h-cursor" data-cursor x1="0" x2="0" y1="${HP.t - 4}" y2="${HP.t + ih}" style="display:none"/>` +
      `<rect class="sim-h-hit" x="${HP.l}" y="0" width="${iw}" height="${HH}" data-hit/>` +
      '</svg>'
    );
  }
  function gardenScale(results, bin) {
    const top = Math.max(...results.map((r) => r.bins.length)) * bin;
    const x = Math.max(0.5, Math.ceil(top / 0.25) * 0.25);
    const ymax = Math.max(...results.map((r) => Math.max(...r.bins)));
    const step = [0.02, 0.05, 0.1, 0.2, 0.25].find((s) => ymax / s <= 5) || 0.25;
    const y = Math.ceil(ymax / step) * step;
    const yTicks = [];
    for (let t = step; t <= y + 1e-9; t += step) yTicks.push(t);
    const xTicks = [];
    const xs = x > 1.5 ? 0.5 : 0.25;
    for (let t = 0; t <= x + 1e-9; t += xs) xTicks.push(t);
    return { x, y, yTicks, xTicks };
  }

  function gardenCardHtml(r, st, scale) {
    const z = r.zone;
    return (
      `<div class="ca-card sim-gcard" data-gcard="${esc(r.id)}">${C.cardHead(esc(r.name), 'leaf')}` +
      `<div class="sim-gcard-top">${gardenLayoutHtml(r.layout, st.w)}<div class="ca-hint">${esc(r.desc)}</div></div>` +
      histogramSvg(r, scale, st.bin) +
      `<div class="sim-h-read" data-read>${gardenReadHtml(r, null, st.bin)}</div>` +
      `<div class="ca-stats sim-gstats">` +
      (SC.curve ? tile('Income', `×${mult(scoreOf(r, SC.curve))}`, `×${(scoreOf(r, SC.curve) / curveAt(SC.curve, 1)).toFixed(1)} no garden’s`, 'Expected income over any long stretch of play, in multiples of the baseline (unbuffed CpS + clicks), for the game scored above') : '') +
      tile('Mean', bonus(r.mean), `best ${bonus(r.peak)}`, 'The golden cookie frequency bonus, averaged over game time') +
      tile('≥ +100%', pc(atLeast(r, 1, st.bin), 0), 'of the time', 'Golden cookies at least twice as often') +
      tile('CpS', `×${r.cps.toFixed(3)}`, r.cps < 1 ? 'the nursetulips' : 'nothing taken', 'The CpS multiplier, averaged over game time: a grown nursetulip takes 2% (on clay, 2.5%)') +
      (z
        ? tile('Golden zone', pc(z.share, 0), `${hrs(z.stretch)} at a stretch`, `Every nursetulip fully grown — the clovers around them boosted all they can be. The first after ${hrs(z.first)}; every clover mature as well ${pc(z.cloversMax, 0)} of that time.`) +
          tile('Clovers at max', pc(z.cloversMax, 0), 'of the zone', 'Of the golden zone, the share with every golden clover mature too')
        : tile('Fertilizer', pc(r.fert, 0), 'of the time', 'Quicker ticks, but plant effects ×0.75')) +
      '</div></div>'
    );
  }
  /** Under a histogram: at the hovered bonus, the share of the time at it or above (and in its bar). */
  function gardenReadHtml(r, x, bin) {
    if (x == null) return `<span class="ca-hint">Hover the chart: the share of the time at that bonus or more.</span> <b>${pc(atLeast(r, 1, bin), 0)}</b> of the time at +100% or more.`;
    const k = Math.round(x / bin);
    return `<b>${pc(atLeast(r, x, bin))}</b> of the time at <b>${bonus(x)}</b> or more <span class="ca-hint">· ${bonus(k * bin)} to ${bonus((k + 1) * bin)}: ${pc(r.bins[k] || 0)}</span>`;
  }

  function gardenSummaryHtml(st) {
    const c = SC.curve;
    const key = (r) => (c ? scoreOf(r, c) : r.mean);
    const best = Math.max(...st.results.map(key));
    return (
      `<table class="sim-table"><tr><th>Gardener</th>${c ? '<th data-tip="Expected income over any long stretch of play (24 h or more), in multiples of the baseline: unbuffed CpS + the clicks a second">Income</th><th>vs no garden</th>' : ''}<th>Mean</th><th>≥ +50%</th><th>≥ +100%</th><th>≥ +125%</th><th>CpS</th><th>Golden zone</th><th>Plantings / h</th></tr>` +
      st.results
        .map(
          (r) =>
            `<tr class="${key(r) === best ? 'best' : ''}"><td><b>${esc(r.name)}</b></td>${c ? `<td>×${mult(scoreOf(r, c))}</td><td>×${(scoreOf(r, c) / curveAt(c, 1)).toFixed(1)}</td>` : ''}<td>${bonus(r.mean)}</td><td>${pc(atLeast(r, 0.5, st.bin), 0)}</td><td>${pc(atLeast(r, 1, st.bin), 0)}</td><td>${pc(atLeast(r, 1.25, st.bin), 0)}</td><td>×${r.cps.toFixed(3)}</td>` +
            `<td>${r.zone ? `${pc(r.zone.share, 0)} · ${hrs(r.zone.stretch)} at a stretch` : '—'}</td><td>${(r.plantings.G + r.plantings.N).toFixed(1)}</td></tr>`
        )
        .join('') +
      '</table>'
    );
  }

  // ---- scores: the income a gardener implies for a game (models/gardenScore.mjs, as the page does it)
  // a computed curve comes with its interpolation tabled (ln income every 0.01 of f); a played one is a fit
  const tableLn = (t, f) => {
    const x = Math.max(0, Math.min(t.ln.length - 1.000001, (f - t.f0) / t.step));
    const i = Math.floor(x);
    return t.ln[i] + (t.ln[i + 1] - t.ln[i]) * (x - i);
  };
  const curveAt = (c, f) => (c.table ? Math.exp(tableLn(c.table, f)) : Math.exp(c.a + c.b * Math.log(f) + c.c * Math.log(f) ** 2));
  const curveSlope = (c, f) => (c.table ? (tableLn(c.table, f * 1.01) - tableLn(c.table, f / 1.01)) / (2 * Math.log(1.01)) : c.b + 2 * c.c * Math.log(f));
  /** A gardener's income ÷ baseline: its 1-point bins (time × CpS multiplier) through the curve. */
  const scoreOf = (r, c) => (r.fine || []).reduce((a, w, k) => a + (w ? w * curveAt(c, 1 + (k + 0.5) / 100) : 0), 0);
  const mult = (x) => (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(1));
  const WRATH = ['Pledged', 'Awoken', 'Displeased', 'Angered'];
  const SLOTS = ['Diamond', 'Ruby', 'Jade'];

  /** The variables that differ from the save's own: what the score's run is told to change. */
  function stateChanges() {
    const a = SC.state;
    const b = SC.saved;
    if (!a || !b) return {};
    const out = {};
    for (const k of ['clicks', 'elderWrath', 'season']) if (a[k] !== b[k]) out[k] = a[k];
    if (Math.abs(a.clickVsCps - b.clickVsCps) > 1e-9) out.clickVsCps = a.clickVsCps;
    if (a.auras.join('|') !== b.auras.join('|')) out.auras = a.auras;
    if (a.gods.join('|') !== b.gods.join('|')) out.gods = a.gods;
    for (const k of ['buildings', 'upgrades']) {
      const d = Object.fromEntries(Object.entries(a[k]).filter(([n, v]) => v !== b[k][n]));
      if (Object.keys(d).length) out[k] = d;
    }
    return out;
  }

  function scoreCardHtml() {
    const st = SC.state;
    const o = SC.options;
    const sel = (attr, list, cur) => `<select data-gs="${attr}">${list.map(([v, label]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    const changed = stateChanges();
    let form = '';
    if (st) {
      const auras = [['', 'No aura'], ...o.auras.map((n) => [n, n])];
      const gods = [['', '—'], ...o.gods.map((g) => [g.id, g.name])];
      form =
        `<div class="sim-form sim-gstate">` +
        `<label class="ca-field"><span class="ca-field-label">Clicks a second</span><input type="number" min="0" step="1" value="${esc(st.clicks)}" data-gs="clicks"></label>` +
        `<label class="ca-field" data-tip="A click's cookies as a share of unbuffed CpS (the save's: ${pc(SC.saved.clickVsCps)}) — the mouse upgrades decide it"><span class="ca-field-label">A click is</span><input type="number" min="0" step="0.1" value="${(st.clickVsCps * 100).toFixed(2)}" data-gs="clickVsCps"> % of CpS</label>` +
        `<label class="ca-field"><span class="ca-field-label">Grandmapocalypse</span>${chips(WRATH.map((w, i) => [i, w]), 'data-gwrath', st.elderWrath)}</label>` +
        `<label class="ca-field"><span class="ca-field-label">Season</span>${sel('season', o.seasons.map((x) => [x.id, x.name]), st.season)}</label>` +
        `<label class="ca-field"><span class="ca-field-label">Dragon auras</span>${sel('aura0', auras, st.auras[0])}${sel('aura1', auras, st.auras[1])}</label>` +
        `<label class="ca-field"><span class="ca-field-label">Pantheon</span>${SLOTS.map((name, i) => `<span data-tip="${name}">${sel(`god${i}`, gods, st.gods[i] || '')}</span>`).join('')}</label>` +
        '</div>' +
        `<div class="sim-gbuildings">${Object.entries(st.buildings)
          .map(([n, v]) => `<label class="ca-field${changed.buildings && n in changed.buildings ? ' sim-changed' : ''}"><span class="ca-field-label">${esc(n)}</span><input type="number" min="0" step="10" value="${v}" data-gb="${esc(n)}"></label>`)
          .join('')}</div>` +
        `<div class="sim-form"><span class="ca-field-label">Golden cookie upgrades</span><span class="ca-chipgroup">${Object.entries(st.upgrades)
          .map(([n, on]) => `<button type="button" class="ca-chip${on ? ' on' : ''}" data-gu="${esc(n)}">${esc(n)}</button>`)
          .join('')}</span></div>` +
        `<div class="sim-form">` +
        `<label class="ca-field"><span class="ca-field-label">Income curve</span>${chips([[0, 'Computed', 'Seconds: every golden cookie credited its expected payoff, ±0.5%'], [2000, 'Played 2,000 h', 'A few minutes: the game played at each frequency, ±5%'], [8000, 'Played 8,000 h', 'Ten minutes or more, ±2–3%']], 'data-ghrs', SC.hours)}</label>` +
        C.button(`${I('play', 14)} Score the gardens`, 'data-gscore', 'ca-btn-on') +
        (Object.keys(changed).length ? C.button('Back to the save', 'data-greset', 'ca-btn-small') : '') +
        (SC.job ? `<span class="ca-hint">${I('refresh', 12)} ${esc(SC.progress || 'Starting…')}</span>` : '') +
        '</div>';
    }
    return (
      `<div class="ca-card">${C.cardHead('Score for your game', 'cookie', SC.curve ? `<span class="ca-pill">no garden ×${mult(curveAt(SC.curve, 1))}</span>` : '')}` +
      `<div class="ca-card-note">Each gardener’s expected income for one game, in multiples of unbuffed CpS + its clicks: an income curve from the game’s own golden cookies at steady frequencies (${SC.hours ? `played, ${SC.hours.toLocaleString()} h each: a few minutes` : 'each one’s expected payoff, computed: seconds'}), then each gardener’s time at each frequency, CpS cost included, through it. Paste a save, then change any variable.</div>` +
      `<textarea class="sim-save" data-gsave placeholder="Paste your exported save here…">${esc(SC.save)}</textarea>` +
      (st ? '' : `<div class="sim-form">${C.button(SC.reading ? 'Reading…' : 'Read the save', 'data-gread', 'ca-btn-on')}</div>`) +
      (SC.error ? `<div class="sim-err">${esc(SC.error)}</div>` : '') +
      form +
      (SC.curve ? curveHtml(SC.curve) : '') +
      '</div>'
    );
  }

  /** The income curve: each frequency's run (± its standard error) and the fit, on a log scale. */
  function curveHtml(c) {
    const W = 560;
    const H = 220;
    const P = { l: 54, r: 14, t: 12, b: 28 };
    const fs = c.points.map((p) => p.f);
    const f0 = Math.min(1, ...fs);
    const f1 = Math.max(...fs);
    const lo = Math.log10(Math.min(...c.points.map((p) => Math.max(1, p.mult - p.se)), curveAt(c, f0)));
    const hi = Math.log10(Math.max(...c.points.map((p) => p.mult + p.se), curveAt(c, f1)));
    const y0 = Math.floor(lo);
    const y1 = Math.ceil(hi);
    const X = (f) => P.l + ((f - f0) / (f1 - f0)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (Math.log10(Math.max(v, 1e-9)) - y0) / (y1 - y0)) * (H - P.t - P.b);
    let g = '';
    for (let e = y0; e <= y1; e++) g += `<line class="sim-h-grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}"/><text class="sim-h-tick" x="${P.l - 5}" y="${Y(10 ** e) + 3}" text-anchor="end">×${mult(10 ** e)}</text>`;
    for (let f = f0; f <= f1 + 1e-9; f += 0.5) g += `<text class="sim-h-tick" x="${X(f)}" y="${H - P.b + 15}" text-anchor="middle">${bonus(f - 1)}</text>`;
    let line = '';
    for (let i = 0; i <= 60; i++) {
      const f = f0 + ((f1 - f0) * i) / 60;
      line += `${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(curveAt(c, f)).toFixed(1)}`;
    }
    const dots = c.points
      .map(
        (p) =>
          `<line class="sim-c-err" x1="${X(p.f)}" x2="${X(p.f)}" y1="${Y(p.mult + p.se)}" y2="${Y(Math.max(1, p.mult - p.se))}"/><circle class="sim-c-dot" cx="${X(p.f)}" cy="${Y(p.mult)}" r="3.5"><title>${bonus(p.f - 1)}: ×${mult(p.mult)} ± ${mult(p.se)} · ${p.golden.toFixed(1)} golden cookies an hour · ${pc(p.parts.clicks / p.mult, 0)} from clicks</title></circle>`
      )
      .join('');
    const ks = [1, 1.5, 2, 2.5].filter((f) => f <= f1).map((f) => `${bonus(f - 1)}: f^${curveSlope(c, f).toFixed(1)}`);
    const s = c.state;
    return (
      `<svg class="sim-hist sim-curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}<line class="sim-h-axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/><path class="sim-c-fit" d="${line}"/>${dots}</svg>` +
      `<div class="sim-h-read">Income against the golden cookie frequency bonus (log scale; hover a dot). Steepness, income ∝ f^k: ${ks.join(' · ')}.` +
      ` <span class="ca-hint">${s.auras.filter(Boolean).join(' + ') || 'no auras'} · ${s.season ? `season ${esc(s.season)}` : 'no season'} · ${WRATH[s.elderWrath]} · ${s.clicks} clicks/s · a click ${pc(s.clickVsCps)} of CpS${c.cached ? ' · kept from an earlier run' : ''}</span></div>`
    );
  }

  pages.garden = {
    html() {
      const st = GD.study;
      const controls =
        `<div class="sim-form">` +
        `<label class="ca-field"><span class="ca-field-label">Farm level</span>${chips([6, 7, 8, 9].map((l) => [l, `${l} <small>${PLOTS[l]}</small>`]), 'data-glevel', GD.level)}</label>` +
        `<label class="ca-field"><span class="ca-field-label">Nursetulips</span><span class="ca-chipgroup">${[2, 4, 6, 8]
          .map((k) => `<button type="button" class="ca-chip${GD.tulips.includes(k) ? ' on' : ''}" data-gtulips="${k}">${k}</button>`)
          .join('')}</span></label>` +
        `<label class="ca-field"><span class="ca-field-label">Game time</span>${chips([[250, '250 h'], [1000, '1,000 h'], [4000, '4,000 h']], 'data-ghours', GD.hours)}</label>` +
        `<label class="ca-field"><span class="ca-field-label">Gardens</span>${chips([[1, '1'], [3, '3'], [10, '10']], 'data-gseeds', GD.seeds)}</label>` +
        (GD.loading ? `<span class="ca-hint">${I('refresh', 12)} Growing gardens…</span>` : '') +
        '</div>';
      const scale = st && st.results.length ? gardenScale(st.results, st.bin) : null;
      return (
        `<div class="sim-h1">Garden <small>golden cookie frequency over game time, gardener by gardener</small></div>` +
        `<div class="ca-card">${C.cardHead('Golden clovers and nursetulips', 'leaf', st ? `<span class="ca-pill">level ${st.level} · ${st.w}×${st.h}</span>` : '')}` +
        `<div class="ca-card-note">Each gardener keeps a golden clover garden the way cookieMgr’s built-in gardeners do, for ${GD.hours.toLocaleString()} hours of game time × ${GD.seeds} garden${GD.seeds > 1 ? 's' : ''}; each histogram is how that time splits by the garden’s golden cookie frequency bonus (5-point bars), the line is its mean. All the charts share their scales, so they compare side by side; hover one to read the share of the time at that bonus or more — on every chart at once. The garden’s rules are the game’s, run in a fast model (models/gardenFrequency.mjs) rather than the whole game.</div>` +
        controls +
        (GD.error ? `<div class="sim-err">${esc(GD.error)}</div>` : '') +
        (st ? gardenSummaryHtml(st) : '') +
        '</div>' +
        `<div data-gscorecard>${scoreCardHtml()}</div>` +
        (st ? `<div class="sim-gcards">${st.results.map((r) => gardenCardHtml(r, st, scale)).join('')}</div>` : '')
      );
    },
    mount(root) {
      root.addEventListener('click', onGardenClick);
      root.addEventListener('click', onScoreClick);
      root.addEventListener('change', onScoreInput);
      root.addEventListener('input', onScoreInput);
      root.addEventListener('mousemove', onGardenHover);
      root.addEventListener('mouseleave', onGardenHover);
      if (!GD.study && !GD.loading && !GD.error) loadGarden();
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onGardenClick);
      root.removeEventListener('click', onScoreClick);
      root.removeEventListener('change', onScoreInput);
      root.removeEventListener('input', onScoreInput);
      root.removeEventListener('mousemove', onGardenHover);
      root.removeEventListener('mouseleave', onGardenHover);
    },
  };
  async function loadGarden() {
    const ask = { level: GD.level, tulips: GD.tulips.slice().sort((a, b) => a - b), hours: GD.hours, seeds: GD.seeds };
    store.set('garden', ask);
    GD.loading = true;
    GD.error = '';
    if (current === 'garden') render();
    try {
      const st = await api.post('/api/garden/frequency', ask);
      if (JSON.stringify(ask) !== JSON.stringify({ level: GD.level, tulips: GD.tulips.slice().sort((a, b) => a - b), hours: GD.hours, seeds: GD.seeds })) return;
      GD.study = st;
    } catch (e) {
      GD.error = e.message;
    } finally {
      GD.loading = false;
      if (current === 'garden') render();
    }
  }
  const onGardenClick = guard((e) => {
    const t = e.target.closest('[data-glevel],[data-gtulips],[data-ghours],[data-gseeds]');
    if (!t) return;
    const d = t.dataset;
    if (d.glevel) GD.level = Number(d.glevel);
    if (d.gtulips) {
      const k = Number(d.gtulips);
      GD.tulips = GD.tulips.includes(k) ? GD.tulips.filter((x) => x !== k) : [...GD.tulips, k];
    }
    if (d.ghours) GD.hours = Number(d.ghours);
    if (d.gseeds) GD.seeds = Number(d.gseeds);
    loadGarden();
  });
  const onScoreClick = guard(async (e) => {
    const t = e.target.closest('[data-gread],[data-gwrath],[data-gu],[data-ghrs],[data-gscore],[data-greset]');
    if (!t) return;
    const d = t.dataset;
    if (d.gread != null) return readSave();
    if (d.greset != null) SC.state = JSON.parse(JSON.stringify(SC.saved));
    if (d.gwrath != null) SC.state.elderWrath = Number(d.gwrath);
    if (d.gu != null) SC.state.upgrades[d.gu] = !SC.state.upgrades[d.gu];
    if (d.ghrs != null) store.set('scoreHow', (SC.hours = Number(d.ghrs)));
    if (d.gscore != null) return scoreGardens();
    renderScore();
  });
  function onScoreInput(e) {
    const t = e.target;
    if (t.matches('[data-gsave]')) {
      if (e.type !== 'input') return;
      SC.save = t.value.trim();
      store.set('gardenSave', SC.save);
      // a new save: read it again
      if (SC.state) {
        SC.state = SC.saved = null;
        renderScore();
      }
      return;
    }
    if (!SC.state || e.type !== 'change') return;
    const d = t.dataset;
    if (d.gs === 'clicks') SC.state.clicks = Math.max(0, Number(t.value) || 0);
    else if (d.gs === 'clickVsCps') SC.state.clickVsCps = Math.max(0, Number(t.value) || 0) / 100;
    else if (d.gs === 'season') SC.state.season = t.value;
    else if (d.gs === 'aura0' || d.gs === 'aura1') SC.state.auras[Number(d.gs.slice(-1))] = t.value;
    else if (d.gs && d.gs.startsWith('god')) SC.state.gods[Number(d.gs.slice(3))] = t.value;
    else if (d.gb) SC.state.buildings[d.gb] = Math.max(0, Math.round(Number(t.value) || 0));
    else return;
    renderScore();
  }
  function renderScore() {
    if (current !== 'garden') return;
    const box = $('[data-gscorecard]', main());
    if (box) morph(box, scoreCardHtml());
  }
  async function readSave() {
    SC.reading = true;
    SC.error = '';
    renderScore();
    try {
      const r = await api.post('/api/garden/state', { save: SC.save });
      SC.saved = r.state;
      SC.state = JSON.parse(JSON.stringify(r.state));
      SC.options = r.options;
    } catch (e) {
      SC.error = e.message;
    } finally {
      SC.reading = false;
      renderScore();
    }
  }
  async function scoreGardens() {
    if (SC.job) return;
    SC.error = '';
    SC.progress = '';
    const { id } = await api.post('/api/garden/income', { save: SC.save, state: stateChanges(), hours: SC.hours });
    SC.job = id;
    renderScore();
    const es = new EventSource(`/api/jobs/${id}/stream`);
    const take = (j) => {
      if (j.state === 'running') {
        const lines = String(j.out || '').trim().split('\n');
        SC.progress = lines[lines.length - 1] || '';
        return renderScore();
      }
      es.close();
      SC.job = null;
      if (j.state === 'done' && j.results && j.results[0]) SC.curve = j.results[0];
      else SC.error = String(j.out || 'The score failed').trim().split('\n').pop();
      if (current === 'garden') render();
    };
    let out = '';
    es.addEventListener('state', (ev) => {
      const j = JSON.parse(ev.data);
      out = j.out || '';
      take(j);
    });
    es.addEventListener('out', (ev) => {
      out += JSON.parse(ev.data);
      take({ state: 'running', out });
    });
    es.addEventListener('done', (ev) => take(JSON.parse(ev.data)));
  }

  /** Hovering a histogram: the same bonus marked on every one, each saying its share of the time at it or more. */
  function onGardenHover(e) {
    const st = GD.study;
    if (!st) return;
    const hit = e.type === 'mousemove' && e.target.closest && e.target.closest('[data-hit]');
    let x = null;
    // off the charts (or out of the page): no bonus marked
    if (hit) {
      const svg = hit.ownerSVGElement;
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const sx = ((e.clientX - box.left) / box.width) * HW;
      const scale = gardenScale(st.results, st.bin);
      x = Math.max(0, Math.min(scale.x, Math.round((((sx - HP.l) / (HW - HP.l - HP.r)) * scale.x) / st.bin) * st.bin));
    }
    if (x === GD.hover) return;
    GD.hover = x;
    showGardenHover(x);
  }
  function showGardenHover(x) {
    const st = GD.study;
    const scale = gardenScale(st.results, st.bin);
    const X = (v) => HP.l + (v / scale.x) * (HW - HP.l - HP.r);
    st.results.forEach((r) => {
      const card = main().querySelector(`[data-gcard="${CSS.escape(r.id)}"]`);
      if (!card) return;
      const cur = card.querySelector('[data-cursor]');
      const shade = card.querySelector('[data-shade]');
      if (x == null) {
        cur.style.display = 'none';
        shade.setAttribute('width', 0);
      } else {
        cur.style.display = '';
        cur.setAttribute('x1', X(x));
        cur.setAttribute('x2', X(x));
        shade.setAttribute('x', X(x));
        shade.setAttribute('width', Math.max(0, HW - HP.r - X(x)));
      }
      card.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', x != null && Number(b.dataset.k) * st.bin >= x - 1e-9));
      card.querySelector('[data-read]').innerHTML = gardenReadHtml(r, x, st.bin);
    });
  }

  // =====================================================================================================
  // Grimoire
  // =====================================================================================================

  // spell plans × the add-on's golden cookie gardens (experiments/grimoire-plans.mjs): the save is the
  // Garden page's (SC.save), its variables as edited there
  const GR = Object.assign({ sweep: false, pops: 300000, follow: false, garden: 'goldenCombos', shown: null }, store.get('grimoire', {}), { job: null, progress: '', result: null, error: '', pick: null, hover: null });
  const saveGR = () => store.set('grimoire', { sweep: GR.sweep, pops: GR.pops, follow: GR.follow, garden: GR.garden, shown: GR.shown });
  // a plan's group, its color on the charts (the add-on's palette)
  const GROUP_COLOR = { Baseline: '#a99f8c', 'Force the Hand of Fate': '#6fb4e8', 'Cast tiers': '#ffd36a', 'Other spells': '#c58cf0', Sweep: '#6fbf4a' };
  const PLAN_COLORS = ['#ffd36a', '#6fb4e8', '#e8766f', '#6fbf4a', '#c58cf0', '#f0a35e', '#5fd1c4', '#e86fb4'];
  const EFFECT_NAMES = { frenzy: 'Frenzy', 'multiply cookies': 'Lucky', 'click frenzy': 'Click frenzy', 'building special': 'Building special', 'cookie storm': 'Cookie storm', 'cookie storm drop': 'Storm drop', 'dragon harvest': 'Dragon Harvest', dragonflight: 'Dragonflight', blab: 'Nothing (blab)', 'free sugar lump': 'Sugar lump', clot: 'Clot (backfire)', 'ruin cookies': 'Ruin (backfire)', 'cursed finger': 'Cursed finger (backfire)', 'blood frenzy': 'Elder frenzy (backfire)', 'chain cookie': 'Chain' };
  const SPELL_NAMES = { fthof: 'Force the Hand of Fate', stretch: 'Stretch Time', adept: 'Diminish Ineptitude', conjure: 'Conjure Baked Goods' };
  const PART_NAMES = { cps: 'CpS', clicks: 'Clicks', lucky: 'Lucky', chain: 'Chains', storm: 'Storms', spell: 'Spells (Conjure)' };

  /** A plan's income at frequency f: its computed points joined in log–log (the page's drawing; scores come from the model). */
  function planAt(plan, f) {
    const pts = plan.points;
    if (f <= pts[0].f) return pts[0].mult;
    for (let i = 1; i < pts.length; i++)
      if (f <= pts[i].f) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = (Math.log(f) - Math.log(a.f)) / (Math.log(b.f) - Math.log(a.f));
        return Math.exp(Math.log(a.mult) + t * (Math.log(b.mult) - Math.log(a.mult)));
      }
    return pts[pts.length - 1].mult;
  }
  /** A plan's score for a garden: the walk that followed the garden over time when there is one, else its curve's. */
  const sc = (p, id) => (p.scores[id].followed != null ? p.scores[id].followed : p.scores[id].income);
  const grGarden = (r, id) => r.gardens.find((g) => g.id === id) || r.gardens[0];
  const byScore = (r, id) => [...r.plans].sort((a, b) => sc(b, id) - sc(a, id));
  const refPlan = (r) => r.plans.find((p) => p.id === 'default') || r.plans[0];
  const noSpells = (r) => r.plans.find((p) => p.id === 'none');
  const vsRef = (r, p, id) => sc(p, id) / sc(refPlan(r), id) - 1;
  const signed = (x, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;
  /** The plans the curves chart draws: picked, else the garden's best 4, Default and No spells. */
  function shownPlans(r) {
    const ids = GR.shown && GR.shown.filter((id) => r.plans.some((p) => p.id === id));
    if (ids && ids.length) return ids;
    const out = byScore(r, GR.garden)
      .slice(0, 4)
      .map((p) => p.id);
    for (const id of ['default', 'none']) if (!out.includes(id) && r.plans.some((p) => p.id === id)) out.push(id);
    return out;
  }
  /** The point a plan's details read: the frequency nearest the garden's mean. */
  const detailPoint = (plan, g) => plan.points.reduce((a, p) => (Math.abs(p.f - (1 + g.mean)) < Math.abs(a.f - (1 + g.mean)) ? p : a), plan.points[0]);

  function grimoireSetupHtml() {
    return (
      `<div class="ca-card">${C.cardHead('Compare spell plans', 'wizard', GR.result ? `<span class="ca-pill">${GR.result.plans.length} plans · ${GR.result.expected ? `${(GR.result.pops / 1000).toLocaleString()}k golden cookies a point` : 'played'}</span>` : '')}` +
      `<div class="ca-card-note">What the Grimoire is worth with each of the add-on’s golden cookie gardens, plan by plan: Force the Hand of Fate on cookieMgr’s cast tiers (combos, and how full the bar must be for each tier), other thresholds, and other spells. All of it from the fast computed model: the Grimoire runs inside it, magic refilling as the game refills it, each spell’s outcome at its odds, backfires included. Each plan gets its own income curve against golden cookie frequency, then each garden’s time at each frequency, CpS cost included, goes through it. The save is the one on the Garden page.</div>` +
      `<textarea class="sim-save" data-grsave placeholder="Paste your exported save here…">${esc(SC.save)}</textarea>` +
      `<div class="sim-form">` +
      `<label class="ca-field"><span class="ca-field-label">Plans</span>${chips([[0, 'Named plans', 'Cookie Clicker’s usual plays and cookieMgr’s tiers: 14 plans'], [1, 'Named + a tier sweep', 'Also Regular combos at 0/25/50/75/100%, single effects, Dragon Harvest pairs, anything at a full bar: 66 plans']], 'data-grsweep', GR.sweep ? 1 : 0)}</label>` +
      `<label class="ca-field"><span class="ca-field-label">Precision</span>${chips([[100000, '100k', '±3%, about 4 s a point'], [300000, '300k', '±1.5%, about 12 s a point'], [1000000, '1M', '±1%, about 40 s a point']], 'data-grpops', GR.pops)}</label>` +
      `<label class="ca-field"><span class="ca-field-label">Scores</span>${chips([[0, 'From the curves', 'Each garden’s time at each frequency through the plan’s income curve: quick'], [1, 'Garden followed', 'Also a walk that follows each garden over game time with the plan casting — the garden and the Grimoire together, no shortcut (2M golden cookies × 3 seeds, kept once run): slow the first time, and the scores shown']], 'data-grfollow', GR.follow ? 1 : 0)}</label>` +
      C.button(`${I('play', 14)} Compare`, 'data-grrun', 'ca-btn-on') +
      (GR.job ? `<span class="ca-hint">${I('refresh', 12)} ${esc(GR.progress || 'Starting…')}</span>` : '') +
      '</div>' +
      (GR.error ? `<div class="sim-err">${esc(GR.error)}</div>` : '') +
      '</div>'
    );
  }

  function grimoireBestHtml(r) {
    const tiles = r.gardens
      .map((g) => {
        const best = byScore(r, g.id)[0];
        const none = noSpells(r);
        return tile(
          esc(g.name),
          esc(best.name),
          `×${mult(sc(best, g.id))} · ${signed(vsRef(r, best, g.id))} vs Default${none ? ` · ×${(sc(best, g.id) / sc(none, g.id)).toFixed(1)} no spells` : ''}`,
          `${g.mean ? `Golden cookies +${Math.round(g.mean * 100)}% on average, +140% or more ${pc(g.at140, 0)} of the time, CpS ×${g.cps.toFixed(3)}. ` : ''}The best plan's expected income, in multiples of the baseline (unbuffed CpS + clicks)`
        );
      })
      .join('');
    const gm = r.grimoire;
    return (
      `<div class="ca-card">${C.cardHead('The best play, garden by garden', 'trophy')}<div class="ca-stats">${tiles}</div>` +
      `<div class="ca-card-note">The Grimoire in this game: ${Math.floor(gm.magicM)} magic, a full bar from empty in ${span(gm.refill)}. Force the Hand of Fate costs ${gm.costs.fthof} (backfires ${pc(gm.fail, 0)} of the time), Stretch Time ${gm.costs.stretch}, Diminish Ineptitude ${gm.costs.adept}, Conjure Baked Goods ${gm.costs.conjure}.</div></div>`
    );
  }

  /** Income by plan for one garden: a bar each, sorted, Default marked. */
  function grimoireBarsHtml(r) {
    const g = grGarden(r, GR.garden);
    const rows = byScore(r, g.id);
    const top = sc(rows[0], g.id);
    const W = 640;
    const rowH = 20;
    const L = 210;
    const H = rows.length * rowH + 8;
    const X = (v) => L + (v / top) * (W - L - 120);
    const bars = rows
      .map((p, i) => {
        const y = 4 + i * rowH;
        const v = sc(p, g.id);
        const on = GR.pick === p.id;
        return (
          `<g class="sim-gr-row${on ? ' on' : ''}" data-grpick="${esc(p.id)}"><rect class="sim-gr-hit" x="0" y="${y}" width="${W}" height="${rowH}"/>` +
          `<text class="sim-gr-name" x="${L - 8}" y="${y + 14}" text-anchor="end">${esc(p.name.length > 34 ? `${p.name.slice(0, 33)}…` : p.name)}</text>` +
          `<rect x="${L}" y="${y + 3}" width="${Math.max(1, X(v) - L).toFixed(1)}" height="${rowH - 6}" rx="2" fill="${GROUP_COLOR[p.group] || '#d9a531'}"${p.id === 'default' ? ' stroke="#fff" stroke-width="1.5"' : ''}/>` +
          `<text class="sim-gr-val" x="${X(v) + 6}" y="${y + 14}">×${mult(v)} <tspan class="sim-gr-pct">${p.id === 'default' ? 'Default' : signed(vsRef(r, p, g.id))}</tspan></text></g>`
        );
      })
      .join('');
    const legend = [...new Set(r.plans.map((p) => p.group))].map((k) => `<span class="sim-gr-key"><i style="background:${GROUP_COLOR[k] || '#d9a531'}"></i>${esc(k)}</span>`).join('');
    return (
      `<div class="ca-card">${C.cardHead('Income by plan', 'graphs', chips(r.gardens.map((x) => [x.id, esc(x.name.replace(/ \(.*\)$/, ''))]), 'data-grgarden', g.id))}` +
      `<div class="ca-card-note">Expected income over any long stretch of play with ${esc(g.name)}, in multiples of the baseline (unbuffed CpS + clicks), each plan against cookieMgr’s Default${r.plans[0].scores[g.id].followed != null ? ', from a walk that followed the garden over game time with the plan casting' : ', from the plan’s income curve'}. Click a plan for what it casts and what that brings.</div>` +
      `<svg class="sim-hist sim-gr-bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${bars}</svg>` +
      `<div class="sim-gr-legend">${legend}</div></div>`
    );
  }

  /** Income against the golden cookie frequency bonus, a line per plan shown (log scale), the garden's time behind it. */
  function grimoireCurvesHtml(r) {
    const g = grGarden(r, GR.garden);
    const ids = shownPlans(r);
    const plans = ids.map((id) => r.plans.find((p) => p.id === id));
    const W = 640;
    const H = 260;
    const P = { l: 58, r: 14, t: 12, b: 30 };
    const f0 = Math.min(...r.fs);
    const f1 = Math.max(...r.fs);
    const vals = plans.flatMap((p) => p.points.map((x) => x.mult));
    const y0 = Math.floor(Math.log10(Math.min(...vals)));
    const y1 = Math.ceil(Math.log10(Math.max(...vals)));
    const X = (f) => P.l + ((f - f0) / (f1 - f0)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (Math.log10(Math.max(v, 1e-9)) - y0) / (y1 - y0)) * (H - P.t - P.b);
    let grid = '';
    for (let e = y0; e <= y1; e++) grid += `<line class="sim-h-grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}"/><text class="sim-h-tick" x="${P.l - 5}" y="${Y(10 ** e) + 3}" text-anchor="end">×${mult(10 ** e)}</text>`;
    for (let f = f0; f <= f1 + 1e-9; f += 0.25) grid += `<text class="sim-h-tick" x="${X(f)}" y="${H - P.b + 15}" text-anchor="middle">${bonus(f - 1)}</text>`;
    // the garden's time at each bonus, as a faint histogram along the bottom
    let time = '';
    if (g.bins) {
      const bin = 0.05;
      const ymax = Math.max(...g.bins);
      g.bins.forEach((v, k) => {
        const fa = 1 + k * bin;
        if (v < 1e-6 || fa > f1) return;
        const h = (v / ymax) * 50;
        time += `<rect class="sim-gr-time" x="${X(fa)}" y="${H - P.b - h}" width="${Math.max(1, X(Math.min(f1, fa + bin)) - X(fa) - 1)}" height="${h}"/>`;
      });
    }
    const lines = plans
      .map((p, i) => {
        const color = PLAN_COLORS[i % PLAN_COLORS.length];
        let d = '';
        for (let k = 0; k <= 80; k++) {
          const f = f0 + ((f1 - f0) * k) / 80;
          d += `${k ? 'L' : 'M'}${X(f).toFixed(1)},${Y(planAt(p, f)).toFixed(1)}`;
        }
        const dots = p.points.map((x) => `<circle cx="${X(x.f)}" cy="${Y(x.mult)}" r="2.5" fill="${color}"><title>${esc(p.name)} at ${bonus(x.f - 1)}: ×${mult(x.mult)} ± ${mult(x.se || 0)}</title></circle>`).join('');
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${p.id === 'default' ? 2.5 : 1.8}"${p.id === 'none' ? ' stroke-dasharray="5 4"' : ''}/>${dots}`;
      })
      .join('');
    const hover = GR.hover != null ? `<line class="sim-h-cursor" x1="${X(GR.hover)}" x2="${X(GR.hover)}" y1="${P.t}" y2="${H - P.b}"/>` : '';
    const keys = plans.map((p, i) => `<span class="sim-gr-key" data-grshow="${esc(p.id)}" data-tip="Click to hide"><i style="background:${PLAN_COLORS[i % PLAN_COLORS.length]}"></i>${esc(p.name)}${GR.hover != null ? ` <b>×${mult(planAt(p, GR.hover))}</b>` : ''}</span>`).join('');
    const more = r.plans.filter((p) => !ids.includes(p.id));
    return (
      `<div class="ca-card" data-grcurves>${C.cardHead('Income against golden cookie frequency', 'timeline')}` +
      `<div class="ca-card-note">Each plan’s income at a steady golden cookie frequency bonus (log scale), as the model computed it at each dot; behind them, the share of the time ${esc(g.name)} spends at each bonus. A plan that waits for combos gains more as golden cookies come more often. Hover for the values.</div>` +
      `<svg class="sim-hist sim-gr-curves" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-grsvg data-f0="${f0}" data-f1="${f1}" data-l="${P.l}" data-r="${P.r}" data-w="${W}">${grid}${time}<line class="sim-h-axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>${lines}${hover}<rect class="sim-h-hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" data-grhit/></svg>` +
      `<div class="sim-gr-legend">${keys}</div>` +
      (more.length ? `<div class="sim-form"><label class="ca-field"><span class="ca-field-label">Add a plan</span><select data-gradd><option value="">…</option>${more.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>${GR.shown ? C.button('Best ones', 'data-grbest', 'ca-btn-small') : ''}</div>` : '') +
      '</div>'
    );
  }

  /** One plan: what it casts, on what, what comes of it, and where its income comes from. */
  function grimoireDetailHtml(r) {
    const g = grGarden(r, GR.garden);
    const plan = r.plans.find((p) => p.id === GR.pick) || byScore(r, g.id)[0];
    // what the walk that followed the garden saw, when there is one; else the curve's nearest point
    const fo = plan.scores[g.id];
    const pt = fo.followedParts ? { f: null, mult: fo.followed, casts: fo.followedCasts, spells: fo.followedSpells, parts: fo.followedParts } : detailPoint(plan, g);
    const casts = pt.casts || {};
    const sp = pt.spells || {};
    const why = Object.entries(sp)
      .filter(([k]) => k.startsWith('why:'))
      .map(([k, v]) => [k.slice(4), v])
      .sort((a, b) => b[1] - a[1]);
    const totalWhy = why.reduce((a, [, v]) => a + v, 0);
    const outs = Object.entries(sp)
      .filter(([k]) => k.startsWith('fthof:'))
      .map(([k, v]) => [k.slice(6), v])
      .sort((a, b) => b[1] - a[1]);
    const totalOut = outs.reduce((a, [, v]) => a + v, 0);
    const parts = Object.entries(pt.parts || {}).filter(([, v]) => v > 0);
    const totalParts = parts.reduce((a, [, v]) => a + v, 0);
    const row = (label, v, of) => `<tr><td><b>${esc(label)}</b></td><td>${v.toFixed(2)} / h</td><td>${pc(v / of, 0)}</td></tr>`;
    const specLines = [];
    const s = plan.spec || {};
    (s.tiers || []).forEach((t) => specLines.push(`${esc(t.name)} at ${t.pct}%: ${t.combos.map((c) => c.map((k) => EFFECT_NAMES[k] || k).join(' + ')).join(' · ')}`));
    if (s.any != null) specLines.push(`Force the Hand of Fate at ${s.any}% whatever’s on`);
    if (s.adept) specLines.push('Diminish Ineptitude first when there’s magic for both');
    if (s.stretch) specLines.push('Stretch Time right after, on a combo');
    if (s.conjure) specLines.push(`Conjure Baked Goods at ${s.conjure.pct}%${s.conjure.combos ? ' on a combo' : ''}`);
    if (!plan.spec) specLines.push('No spells');
    return (
      `<div class="ca-card">${C.cardHead(esc(plan.name), 'wizard', `<span class="ca-pill">${pt.f == null ? esc(g.name.replace(/ \(.*\)$/, '')) : `at ${bonus(pt.f - 1)}`}: ×${mult(pt.mult)}</span>`)}` +
      `<div class="ca-card-note">${esc(plan.desc || '')} ${pt.f == null ? `As the walk that followed ${esc(g.name)} over game time saw it.` : `Read at ${bonus(pt.f - 1)} golden cookie frequency, the nearest computed point to ${esc(g.name)}’s mean.`}</div>` +
      `<div class="ca-hint sim-gr-spec">${specLines.join('<br>')}</div>` +
      `<div class="ca-stats">${r.gardens.map((x) => tile(esc(x.name.replace(/ \(.*\)$/, '')), `×${mult(sc(plan, x.id))}`, plan.id === 'default' ? 'Default' : `${signed(vsRef(r, plan, x.id))} vs Default`)).join('')}${Object.entries(casts)
        .map(([k, v]) => tile(SPELL_NAMES[k] || k, `${v.toFixed(2)} / h`, `every ${span(3600 / v)}`))
        .join('')}</div>` +
      `<div class="sim-gr-tables">` +
      (why.length ? `<table class="sim-table"><tr><th>Cast on</th><th>Casts</th><th>Share</th></tr>${why.map(([k, v]) => row(k === 'any' ? 'Nothing in particular' : k, v, totalWhy)).join('')}</table>` : '') +
      (outs.length ? `<table class="sim-table"><tr><th>Force the Hand of Fate brought</th><th>Rate</th><th>Share</th></tr>${outs.map(([k, v]) => row(EFFECT_NAMES[k] || k, v, totalOut)).join('')}</table>` : '') +
      `<table class="sim-table"><tr><th>Income from</th><th>×baseline</th><th>Share</th></tr>${parts.map(([k, v]) => `<tr><td><b>${esc(PART_NAMES[k] || k)}</b></td><td>×${mult(v)}</td><td>${pc(v / totalParts, 0)}</td></tr>`).join('')}</table>` +
      '</div></div>'
    );
  }

  /** Every plan, every garden. */
  function grimoireTableHtml(r) {
    const best = Object.fromEntries(r.gardens.map((g) => [g.id, byScore(r, g.id)[0].id]));
    return (
      `<div class="ca-card">${C.cardHead('All plans', 'sortList')}<table class="sim-table"><tr><th>Plan</th>${r.gardens.map((g) => `<th data-tip="${esc(g.name)}">${esc(g.name.replace(/ \(.*\)$/, ''))}</th>`).join('')}<th>Force the Hand of Fate</th><th>Other spells</th></tr>` +
      byScore(r, GR.garden)
        .map((p) => {
          const c = p.points[0].casts || {};
          const others = Object.entries(c).filter(([k]) => k !== 'fthof');
          return (
            `<tr class="sim-gr-tr${GR.pick === p.id ? ' on' : ''}" data-grpick="${esc(p.id)}"><td><b data-tip="${esc(p.desc || '')}">${esc(p.name)}</b></td>` +
            r.gardens.map((g) => `<td class="${best[g.id] === p.id ? 'sim-gr-best' : ''}">×${mult(sc(p, g.id))} <span class="ca-hint">${p.id === 'default' ? '' : signed(vsRef(r, p, g.id), 0)}</span></td>`).join('') +
            `<td>${c.fthof ? `${c.fthof.toFixed(2)} / h` : '—'}</td><td>${others.length ? others.map(([k, v]) => `${esc(SPELL_NAMES[k] || k)} ${v.toFixed(2)} / h`).join(', ') : '—'}</td></tr>`
          );
        })
        .join('') +
      '</table><div class="ca-card-note">Casts an hour at no garden’s frequency. ★ marks each garden’s best.</div></div>'
    );
  }

  pages.grimoire = {
    html() {
      const r = GR.result;
      return (
        `<div class="sim-h1">Grimoire <small>the best spell plan for your garden, from the fast computed model</small></div>` +
        `<div data-grsetup>${grimoireSetupHtml()}</div>` +
        (r ? grimoireBestHtml(r) + grimoireBarsHtml(r) + `<div data-grcurvebox>${grimoireCurvesHtml(r)}</div>` + grimoireDetailHtml(r) + grimoireTableHtml(r) : '')
      );
    },
    mount(root) {
      root.addEventListener('click', onGrimoireClick);
      root.addEventListener('input', onGrimoireInput);
      root.addEventListener('change', onGrimoireInput);
      root.addEventListener('mousemove', onGrimoireHover);
      root.addEventListener('mouseleave', onGrimoireHover);
    },
    unmount() {
      const root = main();
      root.removeEventListener('click', onGrimoireClick);
      root.removeEventListener('input', onGrimoireInput);
      root.removeEventListener('change', onGrimoireInput);
      root.removeEventListener('mousemove', onGrimoireHover);
      root.removeEventListener('mouseleave', onGrimoireHover);
    },
  };
  const renderGR = () => current === 'grimoire' && render();
  const onGrimoireClick = guard(async (e) => {
    const t = e.target.closest('[data-grsweep],[data-grfollow],[data-grpops],[data-grrun],[data-grgarden],[data-grpick],[data-grshow],[data-grbest]');
    if (!t) return;
    const d = t.dataset;
    if (d.grsweep != null) GR.sweep = d.grsweep === '1';
    if (d.grpops != null) GR.pops = Number(d.grpops);
    if (d.grfollow != null) GR.follow = d.grfollow === '1';
    if (d.grgarden != null) GR.garden = d.grgarden;
    if (d.grpick != null) GR.pick = d.grpick;
    if (d.grshow != null && GR.result) GR.shown = shownPlans(GR.result).filter((id) => id !== d.grshow);
    if (d.grbest != null) GR.shown = null;
    saveGR();
    if (d.grrun != null) return comparePlans();
    renderGR();
  });
  function onGrimoireInput(e) {
    const t = e.target;
    if (t.matches('[data-grsave]') && e.type === 'input') {
      SC.save = t.value.trim();
      store.set('gardenSave', SC.save);
      SC.state = SC.saved = null;
      return;
    }
    if (t.matches('[data-gradd]') && e.type === 'change' && t.value && GR.result) {
      GR.shown = [...shownPlans(GR.result), t.value];
      saveGR();
      renderGR();
    }
  }
  function onGrimoireHover(e) {
    const r = GR.result;
    if (!r) return;
    const hit = e.type === 'mousemove' && e.target.closest && e.target.closest('[data-grhit]');
    let f = null;
    if (hit) {
      const svg = hit.ownerSVGElement;
      const box = svg.getBoundingClientRect();
      const d = svg.dataset;
      const sx = ((e.clientX - box.left) / box.width) * Number(d.w);
      f = Number(d.f0) + ((sx - Number(d.l)) / (Number(d.w) - Number(d.l) - Number(d.r))) * (Number(d.f1) - Number(d.f0));
      f = Math.max(Number(d.f0), Math.min(Number(d.f1), Math.round(f * 50) / 50));
    }
    if (f === GR.hover) return;
    GR.hover = f;
    const box = $('[data-grcurvebox]', main());
    if (box) morph(box, grimoireCurvesHtml(r));
  }
  async function comparePlans() {
    if (GR.job) return;
    GR.error = '';
    GR.progress = '';
    const { id } = await api.post('/api/grimoire/plans', { save: SC.save, state: SC.state ? stateChanges() : undefined, sweep: GR.sweep, pops: GR.pops, follow: GR.follow });
    GR.job = id;
    renderGR();
    const es = new EventSource(`/api/jobs/${id}/stream`);
    const setup = () => {
      const box = $('[data-grsetup]', main());
      if (current === 'grimoire' && box) morph(box, grimoireSetupHtml());
    };
    const take = (j) => {
      if (j.state === 'running') {
        const lines = String(j.out || '').trim().split('\n');
        GR.progress = lines[lines.length - 1] || '';
        return setup();
      }
      es.close();
      GR.job = null;
      if (j.state === 'done' && j.results && j.results[0]) GR.result = j.results[0];
      else GR.error = String(j.out || 'The comparison failed').trim().split('\n').pop();
      renderGR();
    };
    let out = '';
    es.addEventListener('state', (ev) => {
      const j = JSON.parse(ev.data);
      out = j.out || '';
      take(j);
    });
    es.addEventListener('out', (ev) => {
      out += JSON.parse(ev.data);
      take({ state: 'running', out });
    });
    es.addEventListener('done', (ev) => take(JSON.parse(ev.data)));
  }

  // =====================================================================================================
  // Vocabulary
  // =====================================================================================================

  pages.vocab = {
    html() {
      const v = meta.vocab;
      const staged = v.library.filter((x) => x.staging).length;
      return (
        '<div class="sim-h1">Vocabulary <small>the words a strategy is written in — cookieMgr’s own, as its code editor lists them</small></div>' +
        `<div class="ca-card"><div class="ca-stats">${tile('Actions', String(v.actions.length), 'things it can do')}${tile('Values', String(v.values.length), 'things it can read')}${tile('Conditions', String(v.conditions.length), 'things it can check')}${tile('Built-in macros', String(v.macros.length), 'ready to switch on')}${tile('Staging', String(staged), 'sim-only words, on their way into the add-on')}</div>` +
        '<div class="ca-card-note">Click a word to copy it. Words marked <span class="ca-pill">staging</span> come from sim/mgr/staging/ — the simulator has them; the add-on gets them when they’re promoted.</div></div>' +
        `<div class="ca-card sim-vocab">${CE.libraryHtml('vocab')}</div>` +
        `<div class="ca-card">${C.cardHead('Built-in macros', 'bolt')}<div class="ca-list">${v.macros
          .map((m) => `<div class="ca-row">${macroIcon(m.icon)}<div class="ca-row-text"><b>${esc(m.name)}</b> <code class="ca-hint">${esc(m.id)}</code><div class="ca-hint">${esc(m.desc || '')}</div></div>${m.needsCM ? '<span class="ca-pill">needs Cookie Monster</span>' : ''}</div>`)
          .join('')}</div></div>`
      );
    },
    mount(root) {
      // mark the staging words in the library
      const v = meta.vocab;
      root.querySelectorAll('[data-lib-insert]').forEach((b) => {
        const it = v.library[Number(b.dataset.libInsert)];
        if (it && it.staging) b.insertAdjacentHTML('beforeend', ' <span class="ca-pill">staging</span>');
      });
      pages.vocab.unbind = CE.bind(root, {
        onPick: (key, it) => {
          navigator.clipboard.writeText(it.insert || it.sig).then(() => toast(`Copied ${it.insert || it.sig}`));
          return true;
        },
      });
    },
    unmount() {
      if (pages.vocab.unbind) pages.vocab.unbind();
    },
  };

  // ---- start ---------------------------------------------------------------------------------------

  async function start() {
    // anything that goes wrong in the page says so (once per message)
    const seen = new Set();
    const report = (msg) => {
      if (seen.has(msg)) return;
      seen.add(msg);
      toast(`Page error: ${msg}`, true);
    };
    window.addEventListener('error', (e) => report(e.message || String(e.error)));
    window.addEventListener('unhandledrejection', (e) => report((e.reason && e.reason.message) || String(e.reason)));
    try {
      meta = await api.get('/api/meta');
    } catch (e) {
      main().innerHTML = `<div class="ca-card"><div class="sim-err">Couldn't reach the simulator: ${esc(e.message)}</div></div>`;
      return;
    }
    installVocab(meta.vocab);
    CA.SimData.setup(meta, { render: () => rehost() });
    CE.init();
    CA.UI.Tips.init();
    $('[data-sim-versions]').textContent = `the simulator ${meta.simVersion} · cookieMgr ${meta.addonVersion} · Cookie Clicker ${meta.gameVersion}`;
    $('[data-sim-nav]').addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t) go(t.dataset.nav);
    });
    window.addEventListener('hashchange', () => go(location.hash.slice(1)));
    go(location.hash.slice(1) || store.get('page', 'sim'));
  }
  start();
})();
