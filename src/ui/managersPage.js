// The Managers page (custom group, between Macros and Widgets): managers (features/managers.js)
// play an ascension in stages, switching macros and profiles on and off.
//
//   Manager    the Manager macro's switch, the active manager, and where it is: its stages in a
//              strip (the one it's on lit; click one to go there), what the stage still has to
//              put in, and what moves it on
//   Managers   one row per manager: its name (and id, for manager.use), its scope, Duplicate,
//              Use (In use on the active one) and a trash can (a built-in, like Nunix late game,
//              can't be deleted: once edited, Revert to default instead); New manager
//   Code       what the Manager macro runs: the shown manager as code — written from its stages, or
//              by you (Save makes it yours; the stage editor is then off until Back to stages); its
//              last pass's lines lit while it runs
//   Stages     the manager being edited (the active one unless you pick another): a tab per stage
//              (the one it's on has a dot; + adds one) and the picked stage beside a macro library.
//              Stage 1 sets things up; each stage after it changes things, the rest carries over —
//              so a stage shows what's in force there, with what it changes marked:
//                At work    the macros on (new here: marked; ×: off from this stage on, or undo),
//                           the ones it switches off, and the ones still off; click a library row to
//                           switch one on or off here (the most used first, searchable)
//                Settings   macro settings in force (Research's "stop before": its upgrades as icons,
//                           hover for each one's card); "+ a setting…" adds one
//                Profiles   a card per kind: what the stage puts in (or as before), at a glance —
//                           spirits, auras, what it buys — and a link to its page
//                Moves on   its "until", one line of code whose words hover like the editor's
//                Widget watches   what the Manager widget shows during the stage — folded away
//
// The Manager card's ☆ puts the Manager widget (ui/managerWidget.js) on the left panel.

CA.UI = CA.UI || {};

CA.UI.ManagersPage = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const G = () => CA.Managers;
  const SYNC_MS = 1000;
  let root = null;
  let life = null;
  let editing = ''; // the manager whose stages are shown ('' : the active one)
  let draft = null; // code being edited: { id, code }
  let codeError = '';
  let tabAt = null; // the stage shown in the tabs (null: the one it's on, else the first)
  let libQuery = ''; // the macro library's search
  let libScroll = 0; // …and where it was scrolled to, across redraws
  let watchOpen = false; // Widget watches: folded away unless opened

  const SECTION_TITLES = {
    autoclickers: 'Autoclickers',
    buying: 'Buying',
    upkeep: 'Seasons, lumps & the dragon',
    garden: 'Garden',
    grimoire: 'Grimoire',
    stocks: 'Stock market',
    alerts: 'Alerts',
    '': 'Your macros',
  };
  const SECTION_ORDER = ['autoclickers', 'buying', 'upkeep', 'garden', 'grimoire', 'stocks', 'alerts', ''];

  const shown = () => G().find(editing) || G().current() || G().list()[0] || null;

  // ---- the manager -----------------------------------------------------------------------------

  function stripHtml() {
    const w = G().where();
    if (!w) return '<div class="ca-card-note">No manager is active — pick one below (Use).</div>';
    const on = CA.Macros.isOn(G().MACRO);
    const chips = w.manager.stages
      .map((s, i) => {
        const cls = i === w.index && w.started ? ' on' : i < w.index && w.started ? ' done' : '';
        return (
          (i ? `<span class="ca-mgr-arrow" data-tip="${esc(w.manager.stages[i - 1].until ? `until ${w.manager.stages[i - 1].until}` : 'no “until”: stays here')}">›</span>` : '') +
          `<button type="button" class="ca-mgr-stage${cls}" data-mgr-act="goto" data-i="${i}" data-tip="Go to this stage (switches its macros and profiles now)"><b>${i + 1}</b> ${esc(s.name)}</button>`
        );
      })
      .join('');
    const pending = w.pending.length
      ? `<div class="ca-mgr-now"><em>Still to put in:</em> ${w.pending.map((p) => `<span class="ca-step">${esc(p.label)}: ${esc(p.name)}${p.waits ? ` <i>(waits for ${esc(p.waits)})</i>` : ''}</span>`).join(' ')}</div>`
      : '';
    const last = w.index >= w.of - 1;
    const until = last ? 'the last stage — it lasts for good' : w.stage.until ? `moves on once <code>${esc(w.stage.until)}</code>` : 'no “until” — it stays here until you move it on';
    const state = !on ? 'switched off — switch the Manager macro on to run it' : w.started ? `on stage ${w.index + 1} of ${w.of} since ${CA.UI.Plot.fmt.span(Math.max(0, (Date.now() - w.since) / 1000))} ago` : 'starts at stage 1 on its next pass';
    return (
      `<div class="ca-mgr-strip">${chips}</div>` +
      `<div class="ca-mgr-now"><em>${esc(w.manager.name)}:</em> ${esc(state)} · ${until}</div>` +
      pending
    );
  }

  function managerCard() {
    const m = CA.Macros.get(G().MACRO);
    const opts = G()
      .list()
      .map((x) => `<option value="${esc(x.id)}"${G().current() === x ? ' selected' : ''}>${esc(x.name)}</option>`)
      .join('');
    return (
      '<div class="ca-card">' +
      C().cardHead('Manager', 'ascend', `<div class="ca-card-meta">${C().widgetStar(CA.UI.ManagerWidget.PRESET, 'Manager')}<label class="ca-field"><span>Active</span><select data-mgr-active>${opts}</select></label></div>`) +
      (m ? `<div class="ca-list">${CA.UI.MacrosPage.row(m)}</div>` : '') +
      `<div class="ca-mgr-live" data-mgr-live>${stripHtml()}</div>` +
      '</div>'
    );
  }

  // ---- managers --------------------------------------------------------------------------------

  function managerRow(m) {
    const isActive = G().current() === m;
    const isShown = shown() === m;
    const scope = G()
      .SCOPES.map((s) => `<option value="${s.v}"${m.scope === s.v ? ' selected' : ''}>${esc(s.label)}</option>`)
      .join('');
    return (
      `<div class="ca-row ca-dprof ca-mgr-row${isActive ? ' on' : ''}${isShown ? ' ca-mgr-shown' : ''}">` +
      `<div class="ca-dprof-name"><input type="text" class="ca-gname" maxlength="40" value="${esc(m.name)}" data-mgr-name="${esc(m.id)}" aria-label="Manager name"><code data-tip="Its id, for macros: manager.use(${esc(m.id)})">${esc(m.id)}</code></div>` +
      `<label class="ca-field" data-tip="Legacy managers, which carry on across ascensions, come later"><span>Scope</span><select data-mgr-scope="${esc(m.id)}">${scope}</select></label>` +
      `<span class="ca-hint">${m.stages.length} stage${m.stages.length === 1 ? '' : 's'}</span>` +
      (G().isBuiltin(m) ? `<span class="ca-pill" data-tip="Comes with cookieMgr: always here, can't be deleted${G().isEdited(m) ? '; you changed it' : ''}">built-in${G().isEdited(m) ? ' · edited' : ''}</span>` : '') +
      '<span class="ca-dprof-acts">' +
      C().button('Stages', `data-mgr-act="show" data-id="${esc(m.id)}"`, `ca-btn-small${isShown ? ' on' : ''}`) +
      C().button('Duplicate', `data-mgr-act="dup" data-id="${esc(m.id)}"`, 'ca-btn-small') +
      C().useButton(isActive, `data-mgr-act="use" data-id="${esc(m.id)}"`, isActive ? 'The active manager' : 'Make it the active manager (and switch the Manager macro on)') +
      (isActive ? C().button(`${I('refresh', 12)} Set up again`, `data-mgr-act="setup" data-id="${esc(m.id)}" data-tip="Its stage set up again on the next pass, as it is: the macros it switches, its settings and profiles (what you flipped by hand since too), and the Manager macro on"`, 'ca-btn-small') : '') +
      (G().isBuiltin(m)
        ? G().isEdited(m)
          ? C().button(`${I('refresh', 12)} Revert to default`, `data-mgr-act="revert" data-id="${esc(m.id)}" data-arm-label="Back to the built-in?" data-tip="Undo your changes: back to how it comes with cookieMgr"`, 'ca-btn-small')
          : ''
        : C().trash(`data-mgr-act="delete" data-id="${esc(m.id)}"`, 'Delete this manager?', 'Delete this manager')) +
      '</span>' +
      (m.desc ? `<div class="ca-mgr-desc">${esc(m.desc)}</div>` : '') +
      '</div>'
    );
  }

  function managersCard() {
    const list = G().list();
    return (
      '<div class="ca-card ca-gardener">' +
      C().cardHead('Managers', 'save', '<div class="ca-card-meta"><span class="ca-hint">ascension managers start over each time you ascend</span></div>') +
      (list.length ? `<div class="ca-list">${list.map(managerRow).join('')}</div>` : '<div class="ca-card-note">No managers — make one below.</div>') +
      '<div class="ca-dprof-foot">' +
      C().button(`${I('plus', 12)} New manager`, 'data-mgr-act="new"', 'ca-btn-small') +
      '</div></div>'
    );
  }

  // ---- stages -------------------------------------------------------------------------------------

  const macroList = () => CA.Macros.list().filter((x) => x.mode !== 'once' && x.id !== G().MACRO);
  const sectionOf = (x) => (SECTION_TITLES[x.section || ''] != null ? x.section || '' : '');
  const x = (act, attrs, tip) => `<button type="button" class="ca-mgr-x" data-mgr-act="${act}" ${attrs} data-tip="${esc(tip)}">×</button>`;
  const PAGES = { buyer: 'payback', pantheon: 'pantheon', dragon: 'dragon', grimoire: 'wizard', garden: 'garden', stocks: 'stocks' };

  /** The stage shown in the tabs: the one picked, else the one the manager is on, else the first. */
  function selected(m) {
    let i = tabAt;
    if (i == null) {
      const w = G().where();
      i = w && w.manager === m && w.started ? w.index : 0;
    }
    return Math.max(0, Math.min(m.stages.length - 1, i));
  }

  function tabsHtml(m, at) {
    const w = G().where();
    const running = w && w.manager === m && w.started ? w.index : -1;
    const tabs = m.stages
      .map(
        (s, i) =>
          `<button type="button" role="tab" class="ca-mgr-tab${i === at ? ' sel' : ''}${i === running ? ' run' : ''}" data-mgr-act="tab" data-i="${i}" data-tip="${esc(i === running ? 'The stage it is on now' : `Show stage ${i + 1}`)}">` +
          `<b>${i + 1}</b><span>${esc(s.name)}</span>${i === running ? '<i class="ca-mgr-dot"></i>' : ''}</button>`
      )
      .join('');
    const add = typeof m.code === 'string' ? '' : `<button type="button" class="ca-mgr-tab ca-mgr-tabadd" data-mgr-act="addStage" data-id="${esc(m.id)}" data-i="${m.stages.length - 1}" data-tip="A new stage at the end (it changes nothing until you add to it)">${I('plus', 12)}</button>`;
    return `<div class="ca-mgr-tabs" role="tablist" data-mgr-tabs>${tabs}${add}</div>`;
  }

  /** A macro chip: its icon and name (click: the other way, in this stage) and its × (tip: what × does). */
  function chip(m, i, mc, cls, badge, drop) {
    const at = `data-id="${esc(m.id)}" data-i="${i}" data-macro="${esc(mc.id)}"`;
    return (
      `<span class="ca-mgr-chip ${cls}">` +
      `<button type="button" class="ca-mgr-chipbody" data-mgr-act="flip" ${at} data-tip="${esc(`${mc.name}: ${mc.desc || ''}`)}">${CA.UI.MacrosPage.icon(mc, true)}<span>${esc(mc.name)}</span>${badge ? `<i class="ca-mgr-badge">${badge}</i>` : ''}</button>` +
      (drop ? x('drop', at, drop) : '') +
      '</span>'
    );
  }

  /** The macros at work in a stage (× takes one out from here on), the ones it switches off, the ones still off. */
  function macrosHtml(m, i) {
    const s = m.stages[i];
    const e = G().effective(m, i).macros;
    const list = macroList();
    const on = list.filter((mc) => e[mc.id] === 'on');
    const offHere = list.filter((mc) => s.macros[mc.id] === 'off');
    const stillOff = list.filter((mc) => e[mc.id] === 'off' && s.macros[mc.id] !== 'off');
    const onChips = on.map((mc) => (s.macros[mc.id] === 'on' ? chip(m, i, mc, i ? 'on new' : 'on', i ? 'new' : '', i ? 'Undo: not switched on here' : 'Don’t switch it on') : chip(m, i, mc, 'on', '', 'Switch it off from this stage on'))).join('');
    const offChips = offHere.map((mc) => chip(m, i, mc, 'off', '', i ? 'Undo: not switched off here' : 'Don’t switch it off')).join('');
    return (
      `<div class="ca-mgr-sec"><div class="ca-mgr-sechead">${I('bolt', 11)} At work</div>` +
      `<div class="ca-mgr-chips">${onChips || '<span class="ca-hint">None yet — pick from the library.</span>'}</div>` +
      (offChips ? `<div class="ca-mgr-sechead small">${i ? 'Switched off here' : 'Kept off'}</div><div class="ca-mgr-chips">${offChips}</div>` : '') +
      (stillOff.length ? `<div class="ca-mgr-still">Still off: ${stillOff.map((mc) => `<button type="button" class="ca-mgr-link" data-mgr-act="flip" data-id="${esc(m.id)}" data-i="${i}" data-macro="${esc(mc.id)}" data-tip="Switch it on from here">${esc(mc.name)}</button>`).join(' · ')}</div>` : '') +
      '</div>'
    );
  }

  /** How often each macro is switched on across the managers (and whether it's on now): the library's "Most used". */
  function usage() {
    const n = {};
    G()
      .list()
      .forEach((mg) => mg.stages.forEach((s) => Object.keys(s.macros).forEach((id) => s.macros[id] === 'on' && (n[id] = (n[id] || 0) + 1))));
    macroList().forEach((mc) => CA.Macros.isOn(mc.id) && (n[mc.id] = (n[mc.id] || 0) + 1));
    return n;
  }
  const matches = (mc) => !libQuery || `${mc.name} ${mc.desc || ''}`.toLowerCase().includes(libQuery);

  /** Beside the stage: every macro, the most used first — click one: on (or off) from this stage. */
  function libraryHtml(m, i) {
    const e = G().effective(m, i).macros;
    const row = (mc) => {
      const st = e[mc.id] === 'on' ? 'on' : e[mc.id] === 'off' ? 'off' : '';
      return (
        `<button type="button" class="ca-mgr-librow ${st}${matches(mc) ? '' : ' hidden'}" data-mgr-act="lib" data-id="${esc(m.id)}" data-i="${i}" data-macro="${esc(mc.id)}" data-lib-text="${esc(`${mc.name} ${mc.desc || ''}`.toLowerCase())}" data-tip="${esc(`${st === 'on' ? 'Click: switch it off here' : 'Click: switch it on here'} — ${mc.desc || mc.name}`)}">` +
        `${CA.UI.MacrosPage.icon(mc, true)}<span class="ca-mgr-libname">${esc(mc.name)}</span><span class="ca-mgr-libstate">${st || '—'}</span></button>`
      );
    };
    const group = (title, items, cls = '') => (items.length ? `<div class="ca-mgr-libgroup${cls}"><div class="ca-lib-ghead">${esc(title)}</div>${items.map(row).join('')}</div>` : '');
    const used = usage();
    const top = macroList()
      .filter((mc) => used[mc.id])
      .sort((a, b) => used[b.id] - used[a.id])
      .slice(0, 8);
    const bySection = {};
    macroList().forEach((mc) => (bySection[sectionOf(mc)] = bySection[sectionOf(mc)] || []).push(mc));
    return (
      '<div class="ca-mgr-lib">' +
      `<div class="ca-lib-head">${I('search', 12)}<input type="text" placeholder="Macros…" value="${esc(libQuery)}" data-mgr-libsearch aria-label="Search the macros"></div>` +
      `<div class="ca-mgr-libbody">${group('Most used', top, ' ca-mgr-libtop')}${SECTION_ORDER.map((k) => group(SECTION_TITLES[k], bySection[k] || [])).join('')}</div>` +
      '</div>'
    );
  }

  /** A setting's choices (yes / no for a switch). */
  const choices = (p) => (p.type === 'bool' ? [{ v: 'true', label: 'yes' }, { v: 'false', label: 'no' }] : typeof p.options === 'function' ? p.options() : p.options || []);
  const settable = (mc) => (mc.inputs || []).filter((p) => typeof p.get !== 'function');
  const upgradeOf = (v) => (Game.Upgrades && v !== 'none' && Game.Upgrades[v]) || null;
  /** Whether a setting picks an upgrade (Research's "stop before"): its choices are upgrades. */
  const picksUpgrade = (p) => p.type !== 'number' && p.type !== 'bool' && choices(p).filter((o) => o.v !== 'none').length > 1 && choices(p).every((o) => o.v === 'none' || upgradeOf(o.v));

  /** An upgrade pick: the upgrades in order as icons (hover: the upgrade's card), then "all"; the picked one and those after it are skipped. */
  function upgradePicker(m, i, id, p, cur) {
    const list = choices(p);
    const at = list.findIndex((o) => String(o.v) === String(cur));
    const stops = at >= 0 && !!upgradeOf(list[at].v); // stops at an upgrade (not "all")
    const tiles = list
      .map((o, j) => {
        const u = upgradeOf(o.v);
        const attrs = `data-mgr-act="pick" data-id="${esc(m.id)}" data-i="${i}" data-macro="${esc(id)}" data-key="${esc(p.key)}" data-v="${esc(o.v)}"`;
        const cls = `ca-mgr-uptile${j === at ? ' sel' : ''}${u && stops && j >= at ? ' skip' : ''}`;
        return u ? `<button type="button" class="${cls}" ${attrs} ${CA.UpgradeInfo.attrs(u.name)}>${CA.UpgradeInfo.sprite(u.icon, 'ca-mgr-upico')}</button>` : `<button type="button" class="${cls} all" ${attrs} data-tip="${esc(o.label)}">all</button>`;
      })
      .join('');
    const name = stops ? list[at].label : '';
    return `<div class="ca-mgr-uppick">${tiles}</div><div class="ca-mgr-upcap">${name ? `Up to, not including, <b>${esc(name)}</b> — click another to stop there (hover one for what it does)` : 'All of it — click one to stop before it'}</div>`;
  }

  /** A macro setting's control: its value, as the stage has it. */
  function control(m, i, id, p, cur) {
    if (picksUpgrade(p)) return upgradePicker(m, i, id, p, cur);
    const attrs = `data-mgr-input="${esc(m.id)}" data-i="${i}" data-macro="${esc(id)}" data-key="${esc(p.key)}" data-type="${p.type || 'select'}"`;
    if (p.type === 'number') return `<input type="number" step="any" ${attrs} value="${esc(cur)}">`;
    const list = choices(p);
    const missing = !list.some((o) => String(o.v) === String(cur)) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
    return `<select ${attrs}>${missing}${list.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(cur) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  }

  /** The macro settings in force in a stage: set here (× undoes) or as before; a list to add one. */
  function settingsHtml(m, i) {
    const s = m.stages[i];
    const e = G().effective(m, i).inputs;
    const rows = [];
    Object.keys(e).forEach((id) => {
      const mc = CA.Macros.get(id);
      if (!mc) return;
      Object.keys(e[id]).forEach((k) => {
        const p = settable(mc).find((q) => q.key === k);
        if (!p) return;
        const here = !!s.inputs[id] && s.inputs[id][k] !== undefined;
        rows.push(
          `<div class="ca-mgr-set${here ? ' here' : ''}"><div class="ca-mgr-sethead">${CA.UI.MacrosPage.icon(mc, true)}<b>${esc(mc.name)}</b><span>${esc(p.label)}</span>` +
            (here ? x('uninput', `data-id="${esc(m.id)}" data-i="${i}" data-macro="${esc(id)}" data-key="${esc(k)}"`, i ? 'Undo: as the stage before has it' : 'Drop this setting') : '<em>as before</em>') +
            `</div>${control(m, i, id, p, e[id][k])}</div>`
        );
      });
    });
    const items = [];
    macroList().forEach((mc) => settable(mc).forEach((p) => !(e[mc.id] && e[mc.id][p.key] !== undefined) && items.push(`<option value="${esc(`${mc.id}|${p.key}`)}">${esc(`${mc.name} · ${p.label}`)}</option>`)));
    const add = items.length ? `<select class="ca-mgr-add" data-mgr-addinput="${esc(m.id)}" data-i="${i}"><option value="">+ a setting…</option>${items.join('')}</select>` : '';
    return `<div class="ca-mgr-sec"><div class="ca-mgr-sechead">${I('settings', 11)} Settings</div>${rows.join('') || '<div class="ca-hint">The macros run as they are set on the Macros page.</div>'}${add}</div>`;
  }

  const profilesOf = (k) => {
    try {
      return G().P[k].list();
    } catch (e) {
      return [];
    }
  };
  const ico = (pic, tip) => `<span class="ca-mgr-snapico" data-tip="${esc(tip)}"><span style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-pic[0] * 48}px ${-pic[1] * 48}px"></span></span>`;
  /** A profile at a glance, borrowed from its own page: spirits, auras, what it buys… */
  function snapshot(k, p) {
    if (!p) return '';
    if (k === 'pantheon') {
      const M = Game.Objects && Game.Objects.Temple && Game.Objects.Temple.minigame;
      return (p.slots || [])
        .map((g, j) => {
          const god = g && M && M.gods && M.gods[g];
          const slot = ['Diamond', 'Ruby', 'Jade'][j];
          return `<span class="ca-mgr-snapit">${god ? ico(god.icon, god.name) : ''}<small>${esc(slot)}</small> ${esc(god ? god.name.split(',')[0] : g ? g[0].toUpperCase() + g.slice(1) : 'empty')}</span>`;
        })
        .join('');
    }
    if (k === 'dragon')
      return (p.auras || [])
        .filter(Boolean)
        .map((n) => {
          const a = Object.values(Game.dragonAuras || {}).find((x) => x.name === n);
          return `<span class="ca-mgr-snapit">${a && a.pic ? ico(a.pic, n) : ''}${esc(n)}</span>`;
        })
        .join('');
    if (k === 'buyer') {
      const kinds = Object.keys(p.kinds || {}).filter((x) => p.kinds[x]);
      const what = kinds.map((x) => (x === 'allUpgrades' ? 'all upgrades at once' : `${x}s`)).join(', ') || 'nothing';
      const bank = p.reserve ? `keeps ${p.reserve} min of CpS` : (p.banks || []).length ? `keeps ${p.banks.length} bank${p.banks.length === 1 ? '' : 's'}` : 'spends freely';
      return `<span class="ca-mgr-snapit">Buys ${esc(what)}</span><span class="ca-mgr-snapit">${esc(bank)}</span>`;
    }
    if (k === 'grimoire') return (p.tiers || []).map((t) => `<span class="ca-mgr-snapit">${esc(t.name)}${t.pct ? ` · ${t.pct}%` : ''}</span>`).join('');
    if (k === 'garden' || k === 'stocks') return `<span class="ca-mgr-snapit">${esc(p.desc || p.name)}</span>`;
    return '';
  }

  /** One card per kind of profile: what the stage puts in (or as before), at a glance, and a link to its page. */
  function profilesHtml(m, i) {
    const s = m.stages[i];
    const prev = i ? G().effective(m, i - 1).profiles : {};
    const cards = G()
      .KINDS.map((k) => {
        const kind = G().P[k];
        const list = profilesOf(k);
        const nameOf = (id) => (list.find((p) => p.id === id) || { name: `${id} (missing)` }).name;
        const here = s.profiles[k] || '';
        const eff = here || prev[k] || '';
        const first = i ? (prev[k] ? `as before · ${nameOf(prev[k])}` : 'as before · left alone') : 'left alone';
        const missing = here && !list.some((p) => p.id === here) ? `<option value="${esc(here)}" selected>${esc(here)} (missing)</option>` : '';
        const opts = `<option value="">${esc(first)}</option>${missing}${list.map((p) => `<option value="${esc(p.id)}"${p.id === here ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
        return (
          `<div class="ca-mgr-pcard${here ? ' here' : ''}${eff ? '' : ' none'}">` +
          `<div class="ca-mgr-phead">${I(kind.icon, 13)}<b>${esc(kind.label)}</b>${here && i ? '<i class="ca-mgr-badge">new</i>' : ''}` +
          `<button type="button" class="ca-iconbtn ca-mgr-open" data-mgr-act="open" data-page="${PAGES[k]}" data-tip="Open the ${esc(pageName(PAGES[k]))} page">${I('open', 11)}</button></div>` +
          `<select data-mgr-profile="${esc(m.id)}" data-i="${i}" data-kind="${k}" aria-label="${esc(kind.label)}">${opts}</select>` +
          `<div class="ca-mgr-snap">${eff ? snapshot(k, list.find((p) => p.id === eff)) : '<span class="ca-hint">not touched</span>'}</div>` +
          '</div>'
        );
      })
      .join('');
    return `<div class="ca-mgr-sec"><div class="ca-mgr-sechead">${I('save', 11)} Profiles</div><div class="ca-mgr-pcards">${cards}</div></div>`;
  }
  const pageName = (id) => (((CA.UI.Pages.resolve && CA.UI.Pages.resolve(id)) || {}).page || {}).label || id;

  const untilStatus = (s) => {
    const problem = G().untilProblem(s.until);
    return problem ? `<em class="ca-mgr-problem">${esc(problem)}</em>` : s.until ? `<em>${G().untilHolds(s.until) ? 'holds now' : 'not yet'}</em>` : '<em>no “until”: it stays here</em>';
  };
  /** What moves it on: a condition in the macro language (its words hover like the code's). */
  function untilHtml(m, i) {
    const s = m.stages[i];
    if (i === m.stages.length - 1) return `<div class="ca-mgr-sec"><div class="ca-mgr-sechead">${I('ascend', 11)} Moves on when</div><div class="ca-hint">Never: the last stage lasts for good.</div></div>`;
    return (
      `<div class="ca-mgr-sec"><div class="ca-mgr-sechead">${I('ascend', 11)} Moves on to stage ${i + 2} when</div>` +
      `<div class="ca-mgr-until">${CA.UI.CodeEditor.lineHtml(`until:${i}`, s.until, { placeholder: 'a condition, e.g. season.complete(christmas)', bad: !!G().untilProblem(s.until) })}<span data-mgr-until-status>${untilStatus(s)}</span></div></div>`
    );
  }

  const watchNow = (v) => (v.error ? `<em class="ca-mgr-problem">${esc(v.error)}</em>` : `<em>now ${CA.UI.ManagerWidget.watchText(v)}</em>`);
  /** What the Manager widget watches during the stage: label, value (code), format, its value now — folded away unless opened. */
  function watchHtml(m, i) {
    const s = m.stages[i];
    const now = G().watchOf(s);
    const at = (j) => `data-mgr-watch="${esc(m.id)}" data-i="${i}" data-j="${j}"`;
    const rows = s.watch
      .map((w, j) => {
        const fmts = G()
          .FORMATS.map((f) => `<option value="${f.v}"${w.format === f.v ? ' selected' : ''}>${esc(f.label)}</option>`)
          .join('');
        const v = now[j] || {};
        return (
          '<div class="ca-mgr-watch">' +
          `<input type="text" class="ca-gname" maxlength="40" placeholder="label" value="${esc(w.label)}" ${at(j)} data-field="label" aria-label="Label">` +
          CA.UI.CodeEditor.lineHtml(`watch:${i}:${j}`, w.value, { placeholder: 'a value, e.g. santaLevel()', bad: !!v.error && !!w.value }) +
          `<select ${at(j)} data-field="format" aria-label="Shown as" data-tip="${esc(`Shown as ${(G().FORMATS.find((f) => f.v === w.format) || G().FORMATS[0]).tip}`)}">${fmts}</select>` +
          `<span data-mgr-watch-now="${j}">${watchNow(v)}</span>` +
          x('delWatch', `data-id="${esc(m.id)}" data-i="${i}" data-j="${j}"`, 'Stop watching it') +
          '</div>'
        );
      })
      .join('');
    const add = s.watch.length < 8 ? C().button(`${I('plus', 12)} Watch a value`, `data-mgr-act="addWatch" data-id="${esc(m.id)}" data-i="${i}"`, 'ca-btn-small') : '';
    return (
      `<details class="ca-mgr-watchbox" data-mgr-watchbox${watchOpen ? ' open' : ''}><summary>${I('widget', 11)} Widget watches <span class="ca-hint">${s.watch.length}</span></summary>` +
      `<div class="ca-mgr-watches">${rows}<div class="ca-mgr-watchfoot">${add}<span class="ca-mgr-watchstar">${C().widgetStar(CA.UI.ManagerWidget.PRESET, 'Manager')}</span></div></div></details>`
    );
  }

  function panelHtml(m, i) {
    const s = m.stages[i];
    const last = i === m.stages.length - 1;
    const id = esc(m.id);
    return (
      '<div class="ca-mgr-panelhead">' +
      `<b class="ca-mgr-num">${i + 1}</b><input type="text" class="ca-gname" maxlength="40" value="${esc(s.name)}" data-mgr-stage-name="${id}" data-i="${i}" aria-label="Stage name">` +
      '<span class="ca-dprof-acts">' +
      C().button('◀', `data-mgr-act="up" data-id="${id}" data-i="${i}" data-tip="Move it earlier"${i ? '' : ' disabled'}`, 'ca-btn-small') +
      C().button('▶', `data-mgr-act="down" data-id="${id}" data-i="${i}" data-tip="Move it later"${last ? ' disabled' : ''}`, 'ca-btn-small') +
      C().button(`${I('plus', 12)} After`, `data-mgr-act="addStage" data-id="${id}" data-i="${i}" data-tip="A new stage after this one (it changes nothing until you add to it)"`, 'ca-btn-small') +
      C().trash(`data-mgr-act="delStage" data-id="${id}" data-i="${i}"${m.stages.length > 1 ? '' : ' disabled'}`, 'Delete this stage?', 'Delete this stage') +
      '</span></div>' +
      macrosHtml(m, i) +
      settingsHtml(m, i) +
      profilesHtml(m, i) +
      untilHtml(m, i) +
      watchHtml(m, i)
    );
  }

  function stagesCard() {
    const m = shown();
    if (!m) return '';
    const i = selected(m);
    tabAt = i; // kept while the page is open (it doesn't jump when the manager moves on)
    const mine = typeof m.code === 'string';
    const body = mine
      ? '<div class="ca-mgr-ed one"><div class="ca-mgr-panel">' +
        `<div class="ca-card-note">Its code is yours (the Code card below), so these stages are only names, and what the widget watches. ${C().button(`${I('refresh', 12)} Back to stages`, `data-mgr-act="uncode" data-id="${esc(m.id)}" data-arm-label="Drop your code, back to the stages’ own?"`, 'ca-btn-small')}</div>` +
        watchHtml(m, i) +
        '</div></div>'
      : `<div class="ca-mgr-ed"><div class="ca-mgr-panel">${panelHtml(m, i)}</div>${libraryHtml(m, i)}</div>`;
    return (
      '<div class="ca-card ca-mgr-edcard" data-mgr-stages>' +
      C().cardHead(`Stages · ${esc(m.name)}`, 'sortList', `<div class="ca-card-meta">${mine ? '' : '<span class="ca-hint">stage 1 sets things up; each after it changes things, the rest carries over</span>'}${C().widgetStar(CA.UI.ManagerWidget.PRESET, 'Manager')}</div>`) +
      tabsHtml(m, i) +
      body +
      '</div>'
    );
  }

  // ---- its code ----------------------------------------------------------------------------------

  /** The code card's head: whose code it is, and Save / Discard while it's changed. */
  function codeMeta(m) {
    const mine = typeof m.code === 'string';
    return (
      '<div class="ca-card-meta">' +
      `<span class="ca-pill${mine ? ' on' : ''}">${mine ? 'your code' : 'written from its stages'}</span>` +
      (isDirty(m) ? C().button(`${I('save', 12)} Save`, `data-mgr-act="saveCode" data-id="${esc(m.id)}"`, 'ca-btn-small ca-btn-on') + C().button('Discard', 'data-mgr-act="discardCode"', 'ca-btn-small') : '') +
      '</div>'
    );
  }
  const isDirty = (m) => !!draft && draft.id === m.id && draft.code !== G().sourceOf(m);
  function codeCard() {
    const m = shown();
    if (!m) return '';
    const mine = typeof m.code === 'string';
    const src = draft && draft.id === m.id ? draft.code : G().sourceOf(m);
    const head = codeMeta(m);
    return (
      `<div class="ca-card ca-editor2" data-edits="${G().MACRO}" data-mgr-code>` +
      C().cardHead(`Code · ${esc(m.name)}`, 'edit', head) +
      `<div class="ca-hint ca-mgr-codehint">What the Manager macro runs each second. ${mine ? 'The stage editor is off until you go back to the stages.' : 'Change it and Save to make it yours.'}</div>` +
      (codeError ? `<div class="ca-editor-error">${esc(codeError)}</div>` : '') +
      '<div class="ca-ed-layout"><div class="ca-editor-body">' +
      CA.UI.CodeEditor.html('manager', src, { title: 'Code', hint: 'a block per stage · manager.arriving(N): stage N’s first pass · manager.profile(kind, id) · manager.next()' }) +
      '</div>' +
      CA.UI.CodeEditor.libraryHtml('manager', { first: ['Managers', 'Macros', 'Values'] }) +
      '</div></div>'
    );
  }

  /** The lines its last pass went through, lit, when the shown manager is the one running. */
  function syncCode() {
    if (!root) return;
    const m = shown();
    const lp = G().lastPass();
    const live = m && G().current() === m && CA.Macros.isOn(G().MACRO) && lp && !isDirty(m);
    CA.UI.CodeEditor.setLive(
      root,
      'manager',
      live
        ? {
            lines: lp.lines,
            html:
              `<div class="ca-code-live-head">${I('play', 11)} last pass · ${CA.UI.Plot.fmt.span(Math.max(0, (Date.now() - lp.t) / 1000))} ago</div>` +
              (lp.error ? `<div class="ca-code-live-at">${esc(lp.error)}</div>` : '') +
              (lp.trace.length ? lp.trace.slice(-12).map((x) => `<div class="ca-code-live-tr">${esc(x.text)}</div>`).join('') : '<div class="ca-code-live-tr">nothing to do</div>'),
          }
        : null
    );
  }

  const html = () => `<div class="ca-mgr-page">${managerCard() + managersCard() + stagesCard() + codeCard()}</div>`;

  // ---- live --------------------------------------------------------------------------------------

  function sync() {
    if (!root || !root.isConnected) return;
    const live = root.querySelector('[data-mgr-live]');
    if (live) CA.UI.Dom.morph(live, stripHtml());
    // which stage it's on (the tabs' dot)
    const tabs = root.querySelector('[data-mgr-tabs]');
    const m = shown();
    if (tabs && m) {
      const tmp = document.createElement('div');
      tmp.innerHTML = tabsHtml(m, selected(m));
      if (tmp.firstChild.innerHTML !== tabs.innerHTML) CA.UI.Dom.morph(tabs, tmp.firstChild.innerHTML);
    }
    CA.UI.MacrosPage.sync(root);
    syncCode();
  }

  function act(t) {
    const d = t.dataset;
    if ((d.mgrAct === 'delete' || d.mgrAct === 'delStage' || d.mgrAct === 'revert' || d.mgrAct === 'uncode') && !CA.UI.Dom.armed(t)) return;
    const i = Number(d.i);
    const m = d.id ? G().find(d.id) : null;
    const st = m && m.stages[i];
    switch (d.mgrAct) {
      case 'tab':
        tabAt = i;
        break;
      case 'open':
        CA.UI.Menu.openPage(d.page);
        return;
      case 'goto':
        G().goTo(i + 1);
        break;
      case 'use':
        if (!G().use(d.id)) {
          CA.UI.Dom.replay(t, 'ca-shake', 400);
          return;
        }
        editing = '';
        tabAt = null;
        break;
      case 'show':
        editing = d.id;
        tabAt = null;
        draft = null;
        codeError = '';
        break;
      case 'dup':
        editing = G().add(null, d.id).id;
        tabAt = null;
        break;
      case 'new':
        editing = G().add().id;
        tabAt = null;
        break;
      case 'delete':
        G().remove(d.id);
        if (editing === d.id) editing = '';
        break;
      case 'revert':
        G().revert(d.id);
        break;
      case 'setup':
        G().setUp();
        break;
      case 'flip':
        // a chip: the other way in this stage
        if (st) G().setStageMacro(d.id, i, d.macro, G().effective(m, i).macros[d.macro] === 'on' ? 'off' : 'on');
        break;
      case 'lib':
      case 'drop':
        if (!st) return;
        if (G().effective(m, i).macros[d.macro] === 'on') G().setStageMacro(d.id, i, d.macro, st.macros[d.macro] === 'on' ? '' : 'off');
        else if (d.mgrAct === 'drop') G().setStageMacro(d.id, i, d.macro, '');
        else G().setStageMacro(d.id, i, d.macro, 'on');
        break;
      case 'uninput':
        G().setStageInput(d.id, i, d.macro, d.key, '');
        break;
      case 'pick':
        G().setStageInput(d.id, i, d.macro, d.key, d.v);
        break;
      case 'up':
        G().moveStage(d.id, i, -1);
        tabAt = Math.max(0, i - 1);
        break;
      case 'down':
        G().moveStage(d.id, i, 1);
        tabAt = i + 1;
        break;
      case 'addStage':
        G().addStage(d.id, i);
        tabAt = i + 1;
        break;
      case 'delStage':
        G().removeStage(d.id, i);
        tabAt = Math.max(0, i - 1);
        break;
      case 'addWatch':
        if (st) G().setStageWatch(d.id, i, st.watch.concat([{ label: '', value: '', format: 'auto' }]));
        watchOpen = true;
        break;
      case 'delWatch':
        if (st) G().setStageWatch(d.id, i, st.watch.filter((x, j) => j !== Number(d.j)));
        break;
      case 'saveCode': {
        if (!draft || draft.id !== d.id) return;
        codeError = G().setCode(d.id, draft.code);
        if (codeError) codeError = `Not saved — ${codeError}`;
        else draft = null;
        break;
      }
      case 'discardCode':
        draft = null;
        codeError = '';
        break;
      case 'uncode':
        G().setCode(d.id, null);
        draft = null;
        codeError = '';
        break;
      default:
        return;
    }
    CA.Util.sound('snd/tick.mp3');
    CA.UI.Menu.render();
  }

  function onClick(e) {
    const sum = e.target.closest && e.target.closest('[data-mgr-watchbox] > summary');
    if (sum) watchOpen = !sum.parentElement.open; // it opens / folds after this click
    const t = e.target.closest('[data-mgr-act]');
    if (!t || !root || !root.contains(t) || t.disabled) return;
    e.stopPropagation();
    act(t);
  }

  function onChange(e) {
    const t = e.target;
    const d = t.dataset || {};
    if (d.mgrActive != null) {
      G().use(t.value);
      editing = '';
      tabAt = null;
    } else if (t.closest && t.closest('[data-code-line]')) {
      // a one-line editor left: its stage was kept up with as you typed; the code follows now
      redrawCode();
      return;
    } else if (d.mgrName) G().update(d.mgrName, { name: t.value });
    else if (d.mgrScope) G().update(d.mgrScope, { scope: t.value });
    else if (d.mgrStageName) G().updateStage(d.mgrStageName, Number(d.i), { name: t.value });
    else if (d.mgrProfile) G().setStageProfile(d.mgrProfile, Number(d.i), d.kind, t.value);
    else if (d.mgrAddinput) {
      if (!t.value) return;
      // a new setting starts at what the stage would have anyway (or the macro's own value)
      const [id, key] = t.value.split('|');
      const mgr = G().find(d.mgrAddinput);
      const i = Number(d.i);
      const was = i ? (G().effective(mgr, i - 1).inputs[id] || {})[key] : undefined;
      const mc = CA.Macros.get(id);
      G().setStageInput(d.mgrAddinput, i, id, key, was !== undefined ? was : CA.Macros.inputsOf(mc)[key]);
    } else if (d.mgrWatch) {
      const st = G().find(d.mgrWatch) && G().find(d.mgrWatch).stages[Number(d.i)];
      if (!st) return;
      G().setStageWatch(d.mgrWatch, Number(d.i), st.watch.map((x, j) => (j === Number(d.j) ? { ...x, [d.field]: t.value } : x)));
    } else if (d.mgrInput) {
      const v = t.value === '' ? '' : d.type === 'bool' ? t.value === 'true' : d.type === 'number' ? Number(t.value) : t.value;
      G().setStageInput(d.mgrInput, Number(d.i), d.macro, d.key, v);
    }
    else return;
    CA.UI.Menu.render();
  }

  /** The Code card, written again from the stages (after a one-line edit), unless it's being edited. */
  function redrawCode() {
    const el = root && root.querySelector('[data-mgr-code]');
    const m = shown();
    if (!el || !m || isDirty(m)) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = codeCard();
    el.replaceWith(tmp.firstChild);
    syncCode();
  }

  /** As you type in a one-line editor: an "until" or a watched value, kept up with (what it makes of it, beside it). */
  function onLine(key, src) {
    const m = shown();
    const [what, a, b] = key.split(':');
    const i = Number(a);
    const st = m && m.stages[i];
    if (!st) return;
    const ed = [...root.querySelectorAll('[data-code-line]')].find((x) => x.dataset.codeEd === key);
    if (what === 'until') {
      G().updateStage(m.id, i, { until: src });
      const out = root.querySelector('[data-mgr-until-status]');
      if (out) out.innerHTML = untilStatus(st);
      if (ed) ed.classList.toggle('bad', !!G().untilProblem(src));
    } else if (what === 'watch') {
      const j = Number(b);
      G().setStageWatch(m.id, i, st.watch.map((w, k) => (k === j ? { ...w, value: src } : w)));
      const v = G().watchOf(m.stages[i])[j] || {};
      const out = root.querySelector(`[data-mgr-watch-now="${j}"]`);
      if (out) out.innerHTML = watchNow(v);
      if (ed) ed.classList.toggle('bad', !!v.error && !!src.trim());
    }
  }

  /** The macro library's search: rows (and groups) that don't match fold away. */
  function onInput(e) {
    const t = e.target;
    if (t.dataset.mgrLibsearch === undefined) return;
    libQuery = t.value.trim().toLowerCase();
    const lib = t.closest('.ca-mgr-lib');
    lib.querySelectorAll('.ca-mgr-librow').forEach((r) => r.classList.toggle('hidden', !!libQuery && !r.dataset.libText.includes(libQuery)));
    lib.querySelectorAll('.ca-mgr-libgroup').forEach((g) => g.classList.toggle('hidden', !g.querySelector('.ca-mgr-librow:not(.hidden)')));
  }

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el).on('click', onClick).on('change', onChange).on('input', onInput);
    const lib = root.querySelector('.ca-mgr-libbody');
    if (lib) lib.scrollTop = libScroll;
    root.querySelectorAll('.ca-mgr-libgroup').forEach((g) => g.classList.toggle('hidden', !g.querySelector('.ca-mgr-librow:not(.hidden)')));
    life.add(
      CA.UI.CodeEditor.bind(root, {
        onChange: (key, src) => {
          const m = shown();
          if (key !== 'manager') return onLine(key, src);
          if (!m) return;
          const was = isDirty(m);
          draft = { id: m.id, code: src };
          // the Save button shows on the first change
          if (was !== isDirty(m)) {
            const meta = root.querySelector('[data-mgr-code] .ca-card-meta');
            if (meta) meta.outerHTML = codeMeta(m);
          }
        },
      })
    );
    sync();
    life.every(SYNC_MS, sync);
  }
  function unmount() {
    const lib = root && root.querySelector('.ca-mgr-libbody');
    if (lib) libScroll = lib.scrollTop;
    if (life) life.close();
    life = null;
    root = null;
  }

  function init() {
    CA.UI.Pages.register({ id: 'managers', label: 'Managers', icon: 'ascend', order: 72, group: 'custom', html, mount, unmount, tick: sync });
    // a hover card's link from any code (manager.use(nunixLateGame)): this page, that manager shown
    const reopen = (fn) => () => {
      fn();
      CA.UI.Menu.openPage('managers');
      CA.UI.Menu.render();
    };
    CA.UI.CodeEditor.defineOpen('manager', (id) => {
      const m = G().find(id);
      return m ? { label: 'Open it on the Managers page', go: reopen(() => (editing = m.id)), focus: '[data-mgr-code]' } : null;
    });
    CA.UI.CodeEditor.defineOpen('profile.garden', () => ({ label: 'Open the Garden page', page: 'garden' }));
    // leaving the Code card with unsaved changes: asked first (ui/codeEditor.js)
    CA.UI.CodeEditor.guard('managers', {
      dirty: () => !!draft && !!G().find(draft.id) && isDirty(G().find(draft.id)),
      name: () => (draft && G().find(draft.id) ? G().find(draft.id).name : 'Managers'),
      leave(how) {
        const d = draft;
        if (!d) return { back: reopen(() => {}) };
        if (how === 'save') {
          const err = G().setCode(d.id, d.code);
          if (err) return { error: err };
          draft = null;
          return { back: reopen(() => (editing = d.id)) };
        }
        if (how === 'discard') {
          draft = null;
          return { back: reopen(() => (editing = d.id)) };
        }
        return { back: reopen(() => ((editing = d.id), (draft = d))) };
      },
    });
  }

  return { init, html };
})();
