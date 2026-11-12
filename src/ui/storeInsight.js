// The store, with what each purchase is worth (features/payback.js) — what Cookie Monster adds to it:
//
//   colors    each building's price in its payback color, for what a click buys now (×1, ×10,
//              ×100, or to the next multiple), and a small dot in each upgrade's corner
//   tooltips   under the game's own building and upgrade tooltips, a cookieMgr block — by default
//              Cookie Monster's: the CpS it adds (and what share of your CpS that is), its payback period
//              and color (and by actual income), when you can afford it, the achievements it wins; a
//              building's share of your production, and how many more win its next achievement. Every
//              line is a statistic (features/stats.js); which, in what order — any value word too — is
//              chosen on the Payback page.
//   warnings   warning statistics (features/stats.js, warn) — by default, buying it would take your bank
//              below what a Lucky! (Conjure Baked Goods, a Lucky! in a Frenzy) needs to pay its most:
//              a small mark on the item in the store, in the color of the first that warns, and one
//              line in the block with a tag for each (option storeWarningList: which, in what order)
//
//   sort       optionally, the upgrades in payback order (color group, then payback period)
//
// Options (Settings → Store): storeColors, storeTooltips, storeWarnings, storeUpgradeSort (and,
// chosen on the Tooltips page: storeTooltipLines, storeWarningList).

CA.UI = CA.UI || {};

CA.UI.StoreInsight = (() => {
  const P = () => CA.Payback;
  const COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'gray'];
  const S = (k) => CA.Settings.get(k);

  // ---- colors -----------------------------------------------------------------------------------

  /** How many a click on a building buys now. */
  const clickAmount = (b) => CA.Shop.amountFor(b, Game.buyBulk === 10 || Game.buyBulk === 100 ? Game.buyBulk : 1) || 1;
  /** A building's row for what a click on it buys now. */
  function rowFor(b, t) {
    const n = clickAmount(b);
    if (t.buildings[n] && t.buildings[n][b.name]) return t.buildings[n][b.name];
    const price = P().sumPrice(b, n);
    const worth = P().buildingWorth(b.name, n);
    const x = P().parts(price, worth);
    return { name: b.name, n, price, bonus: worth.bonus, gain: x.gain, afford: x.afford, earn: x.earn, mode: x.mode, worth, pp: x.pp, color: t.colorOf(x.pp, price), won: worth.won };
  }

  /** An item's mark in the store: the color of its first warning (or none). */
  function mark(host, warns) {
    let el = host.querySelector(':scope > .ca-bank-mark');
    if (!warns.length) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      host.appendChild(el);
    }
    el.className = `ca-bank-mark ca-pp-bg-${warns[0].color}`;
    el.textContent = '!';
  }

  function paint() {
    const on = S('storeColors') && Game.buyMode === 1;
    const warn = Game.buyMode === 1 && warningsOn();
    const t = on || warn ? P().table({ staleMs: 2000 }) : null;
    Object.values(Game.Objects || {}).forEach((b) => {
      const el = document.getElementById(`productPrice${b.id}`);
      if (!el) return;
      COLORS.forEach((c) => el.classList.remove(`ca-pp-${c}`));
      if (on) el.classList.add(`ca-pp-${rowFor(b, t).color}`);
      const host = document.getElementById(`product${b.id}`);
      if (host) mark(host, warn ? warnings({ kind: 'building', name: b.name, r: rowFor(b, t), t }) : []);
    });
    // the upgrades in payback order (color group, then payback period) — or the game's
    const sorted = S('storeUpgradeSort') && Game.buyMode === 1;
    const tu = sorted ? t || P().table() : null;
    const rank = sorted
      ? (Game.UpgradesInStore || [])
          .map((u) => ({ u, r: tu.upgrades[u.name] }))
          .sort((a, b) => {
            const ca = COLORS.indexOf(a.r ? a.r.color : 'gray');
            const cb = COLORS.indexOf(b.r ? b.r.color : 'gray');
            return ca - cb || (a.r ? a.r.pp : Infinity) - (b.r ? b.r.pp : Infinity);
          })
          .map((x) => x.u)
      : null;
    (Game.UpgradesInStore || []).forEach((u, i) => {
      const el = document.getElementById(`upgrade${i}`);
      if (!el) return;
      if (sorted) el.style.order = String(rank.indexOf(u) + 1);
      else if (el.style.order) el.style.removeProperty('order');
      const ur = warn && t.upgrades[u.name];
      mark(el, ur ? warnings({ kind: 'upgrade', name: u.name, r: ur, t }) : []);
      let dot = el.querySelector('.ca-pp-updot');
      if (!on) {
        if (dot) dot.remove();
        return;
      }
      const r = t.upgrades[u.name];
      if (!r) return;
      if (!dot) {
        dot = document.createElement('div');
        el.appendChild(dot);
      }
      dot.className = `ca-pp-updot ca-pp-bg-${r.color}`;
    });
  }

  // ---- tooltips ----------------------------------------------------------------------------------

  // Warnings: warning statistics (features/stats.js), in the order chosen (option storeWarningList,
  // ids — by default the three bank warnings, smallest bank first: the one you'd most want to keep).
  const DEFAULT_WARNINGS = ['warnLucky', 'warnConjure', 'warnFrenzy'];
  /** The warnings, in order: statistic ids (only warning statistics that still exist). */
  function warningList() {
    const v = S('storeWarningList');
    return (Array.isArray(v) ? v : DEFAULT_WARNINGS).filter((id) => typeof id === 'string' && (ST().get(id) || {}).warn);
  }
  function setWarnings(list) {
    CA.Settings.set('storeWarningList', Array.isArray(list) ? list.slice() : null);
  }
  const warningsDefault = () => !Array.isArray(S('storeWarningList'));
  const warningsOn = () => !!S('storeWarnings') && warningList().length > 0;
  /**
   * The warnings about an item (a context: { kind, name, r, t }), in order: [{ id, label, html,
   * color }] — none with the option off (opts.force: whatever the option).
   */
  function warnings(c, opts = {}) {
    if (!c || (!opts.force && !S('storeWarnings'))) return [];
    const out = [];
    warningList().forEach((id) => {
      try {
        const w = ST().warning(ST().get(id), c);
        if (w) out.push(w);
      } catch (e) {
        /* a warning that fails here: left out */
      }
    });
    return out;
  }

  /** The tooltip's one warning line: a colored tag for each warning, with what it shows. */
  function warnLine(warns) {
    if (!warns.length) return '';
    const tags = warns.map((w) => `<span class="ca-tt-bank ca-tt-bank-${w.color}">${w.label} <small>${w.html}</small></span>`);
    return `<div class="ca-tt-row ca-tt-warn"><span>⚠</span><b>${tags.join('')}</b></div>`;
  }

  function block(rows, warns) {
    return (
      '<div class="ca-tt">' +
      '<div class="ca-tt-head">cookieMgr</div>' +
      rows.map(([k, v, cls]) => `<div class="ca-tt-row"><span>${k}</span><b${cls ? ` class="${cls}"` : ''}>${v}</b></div>`).join('') +
      warnLine(warns) +
      '</div>'
    );
  }
  // ---- the block's lines ------------------------------------------------------------------------
  //
  // Which lines the block shows, in what order, is yours to choose (the Payback page's Store tooltips
  // card; option storeTooltipLines): a list of statistics (features/stats.js) — the built-in ones by
  // id ('payback'…), yours as { stat: id } — and value words as { word, fmt, label } (one taking the
  // building / an upgrade, or nothing: a statistic that is just that word). Each line is worked out
  // about the building or upgrade hovered; one with nothing to say (no wins, nothing recorded yet), or
  // about the other kind, is left out. The default: DEFAULT_LINES.
  const ST = () => CA.Stats;
  /** The built-in lines, for the editor: [{ id, name, desc, scope }]. */
  const LINES = CA.Stats.BUILTINS.filter((b) => !b.warn).map((b) => ({ id: b.id, name: b.name, desc: b.desc, scope: b.scope }));
  const LINE = Object.fromEntries(LINES.map((l) => [l.id, l]));
  /** The Default layout (the bank warnings are their own option): what it adds and how soon it pays back —
   *  by raw CpS, then by actual income — its share of production, then what's next. */
  const DEFAULT_LINES = ['bonus', 'paybackRaw', 'actualGain', 'actual', 'share', 'nextUpgrade', 'next'];
  /** How a word's value is shown. */
  const FORMATS = CA.Stats.FORMATS.filter((f) => ['auto', 'number', 'time', 'chance'].includes(f.id));

  const entryOk = (x) => (typeof x === 'string' ? !!LINE[x] : !!x && (typeof x.word === 'string' || typeof x.stat === 'string'));
  const cleanLines = (v) => (Array.isArray(v) ? v.filter(entryOk) : DEFAULT_LINES.slice());
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- layouts: the lines saved under a name --------------------------------------------------
  //
  // The built-in Default is always there and can't be deleted: DEFAULT_LINES as it comes,
  // or as you changed it (option storeTooltipLines, null as it comes) — Revert to default undoes that.
  // Yours: option storeTooltipProfiles ([{ id, name, lines }]). The one in use: storeTooltipProfile
  // (its id; 'default' or gone: the Default). Editing the lines edits the layout in use.
  const DEFAULT_ID = 'default';
  const profileName = (n, fallback) => String(n == null ? '' : n).trim().slice(0, 40) || fallback;
  function savedProfiles() {
    const v = S('storeTooltipProfiles');
    return (Array.isArray(v) ? v : [])
      .filter((p) => p && typeof p.id === 'string' && p.id && p.id !== DEFAULT_ID)
      .map((p) => ({ id: p.id, name: profileName(p.name, 'Layout'), lines: cleanLines(p.lines) }));
  }
  const saveProfiles = (list) => CA.Settings.set('storeTooltipProfiles', list.map((p) => ({ id: p.id, name: p.name, lines: p.lines.slice() })));
  /** Every layout, the Default first: [{ id, name, lines, builtin }]. */
  const profiles = () => [{ id: DEFAULT_ID, name: 'Default', lines: cleanLines(S('storeTooltipLines')), builtin: true }, ...savedProfiles()];
  /** A layout from its id or its name (any case), or null. */
  function profileOf(x) {
    if (x == null || x === '') return null;
    const all = profiles();
    const k = String(x).trim().toLowerCase();
    return all.find((p) => p.id === String(x)) || all.find((p) => p.name.toLowerCase() === k) || null;
  }
  /** The id of the layout in use. */
  function activeProfile() {
    const id = S('storeTooltipProfile');
    return savedProfiles().some((p) => p.id === id) ? id : DEFAULT_ID;
  }
  const profileActive = (x) => {
    const p = profileOf(x);
    return !!p && p.id === activeProfile();
  };
  /** Uses a layout (its id or its name): whether it changed anything. */
  function useProfile(x) {
    const p = profileOf(x);
    if (!p || p.id === activeProfile()) return false;
    CA.Settings.set('storeTooltipProfile', p.id);
    return true;
  }
  /** A new layout of the lines in use, now in use itself: its id. */
  function addProfile(name) {
    const list = savedProfiles();
    let id = `tt${Date.now().toString(36)}`;
    while (list.some((p) => p.id === id)) id += 'x';
    let n = list.length + 1;
    while (list.some((p) => p.name === `Layout ${n}`)) n++;
    list.push({ id, name: profileName(name, `Layout ${n}`), lines: lines() });
    saveProfiles(list);
    CA.Settings.set('storeTooltipProfile', id);
    return id;
  }
  function renameProfile(id, name) {
    const list = savedProfiles();
    const p = list.find((x) => x.id === id);
    if (!p) return false;
    p.name = profileName(name, p.name);
    saveProfiles(list);
    return true;
  }
  /** Deletes one of yours (the Default can't be): the one in use goes back to the Default. */
  function removeProfile(id) {
    const list = savedProfiles();
    if (!list.some((p) => p.id === id)) return false;
    const was = activeProfile();
    saveProfiles(list.filter((p) => p.id !== id));
    if (was === id) CA.Settings.set('storeTooltipProfile', DEFAULT_ID);
    return true;
  }
  /** Whether the Default isn't as it comes any more. */
  const defaultEdited = () => !same(cleanLines(S('storeTooltipLines')), DEFAULT_LINES);
  /** The Default back as it comes (DEFAULT_LINES). */
  function revertDefault() {
    CA.Settings.set('storeTooltipLines', null);
  }

  /** The block's lines (the layout in use's), in order: built-in ids, { stat } and { word, fmt, label } entries. */
  function lines() {
    const id = activeProfile();
    if (id === DEFAULT_ID) return cleanLines(S('storeTooltipLines'));
    return savedProfiles().find((p) => p.id === id).lines;
  }
  /** New lines for the layout in use (null: the Default's DEFAULT_LINES). */
  function setLines(list) {
    const id = activeProfile();
    if (id === DEFAULT_ID) return CA.Settings.set('storeTooltipLines', Array.isArray(list) ? list.slice() : null);
    saveProfiles(savedProfiles().map((p) => (p.id === id ? { ...p, lines: cleanLines(list) } : p)));
  }
  /** Whether the lines in use are the Default's as it comes. */
  const isDefault = () => same(lines(), DEFAULT_LINES);

  /** Whether a word can be a line in a tooltip of this kind: it takes a building / an upgrade, or nothing. */
  function wordFits(v, kind) {
    const ps = v.params || [];
    return !v.context && (ps.length === 0 || (ps.length === 1 && ps[0] === kind));
  }
  /** The words a line could be, for a kind ('building' | 'upgrade' | null: either). */
  function words(kind) {
    return ((CA.Script && CA.Script.VALUES) || []).filter((v) => !/^stat\./.test(v.id) && (kind ? wordFits(v, kind) : wordFits(v, 'building') || wordFits(v, 'upgrade'))).sort((a, b) => a.id.localeCompare(b.id));
  }
  /** The statistic a line entry stands for (or null). */
  function statOf(entry) {
    if (typeof entry === 'string') return ST().get(entry);
    if (entry && typeof entry.stat === 'string') return ST().get(entry.stat);
    return entry ? ST().fromWord(entry) : null;
  }
  function rowsFor(c) {
    const out = [];
    lines().forEach((e) => {
      try {
        const row = ST().line(statOf(e), c);
        if (row) out.push(row);
      } catch (err) {
        /* a line that fails here: left out */
      }
    });
    return out;
  }

  /** The block under a building's tooltip (opts.force: whatever the options and buy mode — the editor's preview). */
  function buildingBlock(b, opts = {}) {
    if (!opts.force && (!S('storeTooltips') || Game.buyMode !== 1)) return '';
    const t = P().table();
    const c = { kind: 'building', name: b.name, r: rowFor(b, t), t };
    return block(rowsFor(c), warnings(c, opts));
  }
  function upgradeBlock(u, opts = {}) {
    if (!opts.force && !S('storeTooltips')) return '';
    const t = P().table();
    const r = t.upgrades[u.name];
    if (!r) return '';
    const c = { kind: 'upgrade', name: u.name, r, t };
    return block(rowsFor(c), warnings(c, opts));
  }

  const wrapped = new WeakSet();
  function wrapTooltips() {
    Object.values(Game.Objects || {}).forEach((b) => {
      if (!b || wrapped.has(b) || typeof b.tooltip !== 'function') return;
      const orig = b.tooltip;
      b.tooltip = function () {
        const html = orig.apply(this, arguments);
        try {
          return html + buildingBlock(this);
        } catch (e) {
          return html;
        }
      };
      wrapped.add(b);
    });
    if (typeof Game.crateTooltip === 'function' && !Game.crateTooltip.__ca) {
      const orig = Game.crateTooltip;
      Game.crateTooltip = function (me, context) {
        const html = orig.apply(this, arguments);
        try {
          return context === 'store' && me && me.type === 'upgrade' && !me.bought ? html + upgradeBlock(me) : html;
        } catch (e) {
          return html;
        }
      };
      Game.crateTooltip.__ca = true;
    }
  }

  function init() {
    const D = (key, icon, name, desc) => CA.Settings.defineOption({ key, group: 'store', icon, name, desc, default: true });
    D('storeColors', 'drop', 'Payback colors', 'Each building’s price in its payback color (for what a click buys), and a dot in each upgrade’s corner — blue better than the best building, green the best, then yellow, orange, red, purple; gray never pays back.');
    D('storeTooltips', 'search', 'Payback in tooltips', 'Under the game’s building and upgrade tooltips: the CpS it adds, its payback period, when you can afford it, its share of production, the next achievement.');
    CA.Settings.defineOption({ key: 'storeUpgradeSort', group: 'store', icon: 'sortList', name: 'Upgrades: best first', desc: 'The store lists its upgrades by payback period (best first, in color groups) instead of by price.', default: false });
    CA.Settings.defineOption({ key: 'storeTooltipLines', group: 'store-hidden', name: 'Tooltip lines', desc: '', default: null });
    CA.Settings.defineOption({ key: 'storeTooltipProfiles', group: 'store-hidden', name: 'Tooltip layouts', desc: '', default: null });
    CA.Settings.defineOption({ key: 'storeTooltipProfile', group: 'store-hidden', name: 'Tooltip layout in use', desc: '', default: 'default' });
    // off by default since the tooltip's lines became yours to choose: Cookie Monster's layout, without them)
    CA.Settings.defineOption({ key: 'storeWarnings', group: 'store', icon: 'bell', name: 'Warnings', desc: 'A small colored “!” on anything a warning is about — by default, whose purchase would take your bank below what a Lucky! (red), Conjure Baked Goods (orange) or a Lucky! in a Frenzy (yellow) needs to pay its most — and one line in its tooltip saying which, and by how much. Which warnings: the Tooltips page.', default: false });
    CA.Settings.defineOption({ key: 'storeWarningList', group: 'store-hidden', name: 'Warnings', desc: '', default: null });
    wrapTooltips();
    setInterval(() => {
      try {
        wrapTooltips();
        paint();
      } catch (e) {
        /* a store mid-rebuild: next time */
      }
    }, 500);
    CA.Events.on('settings', (k) => (k === 'storeColors' || k === 'storeUpgradeSort' || k === 'storeWarnings' || k === 'storeWarningList' || k === null) && paint());
    CA.Events.on('stats', () => paint());

    // code: tooltips.profile(name) puts a saved tooltip layout in use
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, ...(more || {}) });
    V('tooltips.profiles', 'a list: every store tooltip layout (its id), the Default first', () => profiles().map((p) => p.id), { list: true });
    V('tooltips.activeProfile', 'the store tooltip layout in use (its id: "default" for the Default)', () => activeProfile());
    V('tooltips.profileActive', 'whether a store tooltip layout is the one in use (its id or name)', (x) => profileActive(x), { params: ['profile'], bool: true });
    CA.Actions.register({
      id: 'tooltips.profile',
      name: 'Use a tooltip layout',
      icon: 'search',
      group: 'Store',
      unit: 'switched',
      params: [{ key: 'profile', label: 'Layout', type: 'select', default: DEFAULT_ID, options: () => profiles().map((p) => ({ v: p.id, label: p.name })) }],
      run: (p) => (useProfile(p.profile) ? 1 : 0),
    });
  }

  return { init, paint, buildingBlock, upgradeBlock, warnings, warningList, setWarnings, warningsDefault, DEFAULT_WARNINGS, LINES, DEFAULT_LINES, FORMATS, lines, setLines, isDefault, words, statOf,
    DEFAULT_ID, profiles, profileOf, activeProfile, profileActive, useProfile, addProfile, renameProfile, removeProfile, defaultEdited, revertDefault };
})();
