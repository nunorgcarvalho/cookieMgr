// The Statistics page (page id 'tooltips', its old name): every statistic — the store tooltip's lines,
// the warnings, the payback modes, yours — to browse, edit and write. The store tooltip's layout is a
// card on the Settings page (layoutCard; this module's handlers run there too).
//
//   In the store tooltip   (Settings) the layouts (ui/storeInsight.js profiles): the built-in Default
//                          (Revert to default once changed) and yours — Use / In use, rename, trash, Save
//                          as a new layout. Then the lines of the one in use, in order — a row per line in fixed
//                          columns: its name, what it's about, its value now, how a word reads, ↑ ↓ ✕
//                          (or drag a row); add a built-in, one of yours or any value word; Reset — and
//                          two live previews drawn by the tooltip's own code: a building you pick, and
//                          the best upgrade. The block's switch (Payback in tooltips); the warnings
//                          (ui/storeInsight.js): a switch, and which warning statistics, in order.
//   Statistics             the catalog (features/stats.js): a card per statistic with its value for the
//                          previewed item, what it is, its code; add it to the tooltip (a warning: to
//                          the warnings) in one click,
//                          duplicate it (yours, to change), ☆ put it on the left
//                          panel as a Statistic widget. Filter by group, yours, on screen; search.
//                          New, Edit / Customize, Paste: the statistic editor (ui/statEditor.js) opens
//                          in place of the catalog.
//   Values                 every value word a statistic can use (CA.Script.library, as the code editor
//                          lists them), with its signature, what it is and its value now.

CA.UI = CA.UI || {};

CA.UI.TooltipsPage = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const SI = () => CA.UI.StoreInsight;
  const ST = () => CA.Stats;
  const P = () => CA.Payback;
  const SYNC_MS = 1000;
  const CODE_LINES = 6; // a card shows this much of its code, the rest behind "more"
  let root = null;
  let life = null;
  let previewOf = ''; // the building previewed ('': the best building)
  let tab = 'stats'; // 'stats' | 'values'
  let filter = 'all'; // 'all', a group, 'yours', 'onscreen'
  let query = '';
  let dragFrom = -1;
  let pasting = false; // the Paste panel open
  let pasteError = '';
  const SE = () => CA.UI.StatEditor;

  const KIND = { item: 'either', building: 'building', upgrade: 'upgrade', game: 'game' };
  const kindTag = (scope) => `<span class="ca-tl-kind ${scope}">${KIND[scope] || scope}</span>`;

  // ---- what's previewed: a building you pick, the best upgrade -------------------------------------

  function previewBuilding() {
    const open = Object.values(Game.Objects || {}).filter((b) => !b.locked || b.amount > 0);
    const best = ST().bestOf('building');
    const b = (previewOf && Game.Objects[previewOf]) || (best && Game.Objects[best.name]) || open[0];
    return { b, open };
  }
  function bestUpgrade() {
    const c = ST().bestOf('upgrade');
    return c ? (Game.Upgrades && Game.Upgrades[c.name]) || (Game.UpgradesInStore || []).find((x) => x.name === c.name) || null : null;
  }
  /** What a statistic of this scope shows about here: the previewed building (the best upgrade for an upgrade's). */
  function ctxFor(scope) {
    if (scope === 'game') return null;
    if (scope === 'upgrade') return ST().bestOf('upgrade');
    const { b } = previewBuilding();
    return b ? ST().contextOf(b.name, 'building') : null;
  }
  /** What a statistic is about, as HTML: a building's name, an upgrade's with its icon and info card. */
  const aboutHtml = (c) => (c && c.kind !== 'building' ? CA.UpgradeInfo.ref(c.name) : esc(aboutName(c)));
  const aboutName = (c) => (c ? (c.kind === 'building' ? (Game.Objects[c.name] || {}).dname || c.name : c.name) : '');

  /** A statistic's value now, as its tooltip line has it: [html, class] ('—' when it shows nothing). */
  function valueNow(s) {
    if (!s) return ['—', ''];
    try {
      const row = ST().line(s, ctxFor(s.scope));
      return row ? [row[1], row[2]] : ['—', 'ca-st-none'];
    } catch (e) {
      return ['—', 'ca-st-none'];
    }
  }

  // ---- the layout ---------------------------------------------------------------------------------

  const statOf = (e) => SI().statOf(e);
  const isWord = (e) => !!e && typeof e === 'object' && !!e.word;
  const lineName = (e) =>
    typeof e === 'string'
      ? (SI().LINES.find((l) => l.id === e) || { name: e }).name
      : isWord(e)
        ? e.label || e.word
        : (statOf(e) || { label: 'a deleted statistic' }).label;
  function lineScope(e) {
    const s = statOf(e);
    return s ? s.scope : 'item';
  }

  function linesHtml() {
    const list = SI().lines();
    const btn = (attr, i, icon, tip, off) =>
      `<button type="button" class="ca-tl-btn" ${attr}="${i}" data-tip="${tip}"${off ? ' disabled' : ''}>${icon}</button>`;
    const fmtSel = (e, i) =>
      `<select class="ca-tl-fmt" data-tl-fmt="${i}" data-tip="How its value reads">${SI()
        .FORMATS.map((f) => `<option value="${f.id}"${(e.fmt || 'auto') === f.id ? ' selected' : ''}>${esc(f.name)}</option>`)
        .join('')}</select>`;
    const rows = list
      .map((e, i) => {
        const word = isWord(e);
        const s = statOf(e);
        const desc = word ? (CA.Script.VALUES.find((v) => v.id === e.word) || {}).desc || 'not a word (any more)' : (s || {}).desc || '';
        const [v, cls] = valueNow(s);
        return (
          `<div class="ca-tl-row" draggable="true" data-tl-row="${i}" data-tip="${esc(word ? `${e.word}: ${desc}` : desc)}">` +
          `<span class="ca-tl-grip">${I('grip', 10)}</span>` +
          `<span class="ca-tl-n">${i + 1}</span>` +
          (word
            ? `<input class="ca-tl-label" data-tl-label="${i}" value="${esc(e.label || e.word)}" spellcheck="false">`
            : `<span class="ca-tl-name">${esc(lineName(e))}</span>`) +
          kindTag(word ? lineScope(e) : (s || { scope: 'item' }).scope) +
          `<span class="ca-tl-val ${cls}" data-tl-val="${i}">${v}</span>` +
          (word ? fmtSel(e, i) : '<span></span>') +
          btn('data-tl-up', i, '↑', 'Move up', i === 0) +
          btn('data-tl-down', i, '↓', 'Move down', i === list.length - 1) +
          btn('data-tl-del', i, '✕', 'Remove') +
          '</div>'
        );
      })
      .join('');
    const used = new Set(list.map((e) => (statOf(e) || {}).id).filter(Boolean));
    const free = SI().LINES.filter((l) => !used.has(l.id));
    const yours = ST()
      .all()
      .filter((s) => !s.builtin && !s.warn && !used.has(s.id));
    const add =
      '<select class="ca-tl-add" data-tl-add><option value="">+ add a line…</option>' +
      (free.length
        ? `<optgroup label="Lines">${free.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</optgroup>`
        : '') +
      (yours.length
        ? `<optgroup label="Your statistics">${yours.map((s) => `<option value="s:${esc(s.id)}">${esc(s.label)}</option>`).join('')}</optgroup>`
        : '') +
      `<optgroup label="Value words (of the building / upgrade, or of the game)">${SI()
        .words(null)
        .map((v) => `<option value="w:${esc(v.id)}">${esc(v.id)}</option>`)
        .join('')}</optgroup></select>`;
    const pb = previewBuilding().b;
    return (
      `<div class="ca-tl-cols"><span></span><span>#</span><span>line</span><span>about</span><span>now <em>${esc(pb ? pb.dname || pb.name : '')}</em></span><span></span><span></span><span></span><span></span></div>` +
      `<div class="ca-tl-list">${rows || '<div class="ca-card-note">No lines: the block is left out.</div>'}</div>` +
      `<div class="ca-tl-tools">${add}${SI().isDefault() ? '' : '<button type="button" class="ca-btn ca-btn-small" data-tl-reset data-tip="Back to the Default’s lines as they come">Reset</button>'}</div>`
    );
  }

  // ---- the layouts: the lines saved under a name, the built-in Default first ----------------------

  function profileRow(p) {
    const on = SI().profileActive(p.id);
    const edited = p.builtin && SI().defaultEdited();
    const n = p.lines.length;
    return (
      `<div class="ca-row ca-dprof ca-ttprof${on ? ' on' : ''}" data-tp-row="${esc(p.id)}">` +
      '<div class="ca-dprof-name">' +
      (p.builtin
        ? `<span class="ca-ttprof-fixed">${esc(p.name)}</span>`
        : `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-tp-name="${esc(p.id)}" aria-label="Layout name" data-tip="the layout’s name — macros use it, or its id: ${esc(p.id)}">`) +
      `<code>${n} line${n === 1 ? '' : 's'}</code></div>` +
      (p.builtin
        ? `<span class="ca-pill" data-tip="Comes with cookieMgr: always here, can’t be deleted${edited ? '; you changed it' : ''}">built-in${edited ? ' · edited' : ''}</span>`
        : '') +
      '<span class="ca-dprof-acts">' +
      C().useButton(on, `data-tp-act="use" data-id="${esc(p.id)}"`, on ? 'The layout the store’s tooltips show — the lines below are its' : 'Show this layout in the store’s tooltips') +
      (p.builtin
        ? edited
          ? C().button(`${I('refresh', 12)} Revert to default`, `data-tp-act="revert" data-id="${esc(p.id)}" data-arm-label="Back to the built-in?" data-tip="Undo your changes: back to the lines it comes with"`, 'ca-btn-small')
          : ''
        : C().trash(`data-tp-act="delete" data-id="${esc(p.id)}"`, 'Delete this layout?', 'Delete this layout')) +
      '</span></div>'
    );
  }
  function profilesHtml() {
    return (
      `<div class="ca-list">${SI().profiles().map(profileRow).join('')}</div>` +
      '<div class="ca-dprof-foot">' +
      C().button(`${I('plus', 12)} Save as a new layout`, 'data-tp-act="new" data-tip="A copy of the lines in use, under a name of its own — then change it"', 'ca-btn-small') +
      '<span class="ca-hint">A change below saves to the layout in use · macros: tooltips.profile(name)</span>' +
      '</div>'
    );
  }

  function previewHtml() {
    const { b, open } = previewBuilding();
    const u = bestUpgrade();
    const sel = `<select class="ca-tl-pick" data-tl-b>${open.map((x) => `<option value="${esc(x.name)}"${b && x.name === b.name ? ' selected' : ''}>${esc(x.dname || x.name)}</option>`).join('')}</select>`;
    return (
      `<div class="ca-tl-pv"><div class="ca-tl-pvhead">${sel}</div>${b ? SI().buildingBlock(b, { force: true }) : ''}</div>` +
      (u
        ? `<div class="ca-tl-pv"><div class="ca-tl-pvhead">${CA.UpgradeInfo.ref(u.name)} <em>the best upgrade</em></div>${SI().upgradeBlock(u, { force: true })}</div>`
        : '')
    );
  }

  // ---- the warnings ---------------------------------------------------------------------------------

  /** A warning's color: its own, the item's payback color, or red. */
  const warnColor = (s) => (s.color === 'payback' ? 'payback' : ST().COLORS.includes(s.color) ? s.color : 'red');
  const COLOR_TAG = (s) =>
    `<span class="ca-tl-kind ca-tl-color ${warnColor(s)}" data-tip="Its color (the store’s “!” takes the first warning’s)">${warnColor(s) === 'payback' ? 'payback color' : warnColor(s)}</span>`;
  function warnsHtml() {
    const list = SI().warningList();
    const btn = (attr, i, icon, tip, off) =>
      `<button type="button" class="ca-tl-btn" ${attr}="${i}" data-tip="${tip}"${off ? ' disabled' : ''}>${icon}</button>`;
    const rows = list
      .map((id, i) => {
        const s = ST().get(id);
        const [v, cls] = valueNow(s);
        return (
          `<div class="ca-tl-row ca-tw-row" data-tw-row="${i}" data-tip="${esc(s.desc || '')}">` +
          '<span></span>' +
          `<span class="ca-tl-n">${i + 1}</span>` +
          `<span class="ca-tl-name">${esc(s.label)}</span>` +
          COLOR_TAG(s) +
          `<span class="ca-tl-val ${cls}" data-tw-val="${i}">${v}</span>` +
          '<span></span>' +
          btn('data-tw-up', i, '↑', 'Move up', i === 0) +
          btn('data-tw-down', i, '↓', 'Move down', i === list.length - 1) +
          btn('data-tw-del', i, '✕', 'Remove') +
          '</div>'
        );
      })
      .join('');
    const free = ST()
      .all()
      .filter((s) => s.warn && !list.includes(s.id));
    const add = free.length
      ? `<select class="ca-tl-add" data-tw-add><option value="">+ add a warning…</option>${free.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}${s.builtin ? '' : ' (yours)'}</option>`).join('')}</select>`
      : '<span class="ca-hint">Every warning is in. Write your own: New, then “Shows as: a warning”.</span>';
    return (
      `<div class="ca-tl-list">${rows || '<div class="ca-card-note">No warnings: nothing is marked.</div>'}</div>` +
      `<div class="ca-tl-tools">${add}${SI().warningsDefault() ? '' : '<button type="button" class="ca-btn ca-btn-small" data-tw-reset data-tip="Back to the three bank warnings">Reset</button>'}</div>`
    );
  }
  /** A change to the warnings: a new list (null: the default), then the page again. */
  function editWarnings(fn) {
    const list = SI().warningList();
    const next = fn(list);
    SI().setWarnings(next === undefined ? list : next);
    CA.Util.sound('snd/tick.mp3');
    refresh();
  }
  const isWarning = (id) => SI().warningList().includes(id);

  function layoutCard() {
    const S = CA.Settings;
    return (
      '<div class="ca-card">' +
      C().cardHead('In the store tooltip', 'search') +
      `<div class="ca-ttprofs" data-tp-list>${profilesHtml()}</div>` +
      '<div class="ca-tl">' +
      `<div data-tl-lines>${linesHtml()}</div>` +
      `<div class="ca-tl-preview" data-tl-preview>${previewHtml()}</div>` +
      '</div>' +
      '<div class="ca-list">' +
      `<div class="ca-row ca-row-option"><span class="ca-row-ico">${I('search', 16)}</span><div class="ca-row-text"><div class="ca-row-name">Payback in tooltips</div><div class="ca-row-desc">The block at all (off: the game’s tooltips as they are).</div></div>${C().toggle(!!S.get('storeTooltips'), 'data-tl-opt="storeTooltips"', 'Payback in tooltips')}</div>` +
      `<div class="ca-row ca-row-option"><span class="ca-row-ico">${I('bell', 16)}</span><div class="ca-row-text"><div class="ca-row-name">Warnings</div><div class="ca-row-desc">A colored “!” on the store’s items a warning is about (in the first one’s color), and a ⚠ line in their tooltips with a tag for each. Warnings are statistics too: by default, a purchase that would take your bank below what a Lucky! (red), Conjure (orange) or a Frenzy Lucky! (yellow) needs.</div></div>${C().toggle(!!S.get('storeWarnings'), 'data-tl-opt="storeWarnings"', 'Warnings')}</div>` +
      '</div>' +
      `<div class="ca-tl-warns${S.get('storeWarnings') ? '' : ' off'}" data-tl-warns>${warnsHtml()}</div>` +
      '</div>'
    );
  }

  /** A change to the lines: a new list, then the layout again. */
  function editLines(fn) {
    const list = SI().lines();
    const next = fn(list);
    SI().setLines(next === undefined ? list : next); // null: back to the default
    CA.Util.sound('snd/tick.mp3');
    refresh();
  }
  const inTooltip = (id) =>
    SI()
      .lines()
      .some((e) => (statOf(e) || {}).id === id);
  const entryFor = (s) => (s.builtin ? s.id : { stat: s.id });

  // ---- the catalog --------------------------------------------------------------------------------

  const widgetPreset = (s) => ({ type: 'statistic', stat: s.id });
  const onScreen = (s) => CA.UI.Widgets.hasPreset(widgetPreset(s));
  const matchesQuery = (hay) => !query || hay.toLowerCase().includes(query.toLowerCase());

  function statsShown() {
    return ST()
      .all()
      .filter((s) => {
        if (filter === 'yours' && s.builtin) return false;
        if (filter === 'onscreen' && !onScreen(s)) return false;
        if (filter === 'warnings' && !s.warn) return false;
        if (filter === 'modes' && !s.mode) return false;
        if (ST().GROUPS.includes(filter) && s.group !== filter) return false;
        return matchesQuery(`${s.label} ${s.key} ${s.desc} ${s.source}`);
      });
  }

  function codeHtml(src) {
    const lines = String(src).split('\n');
    const all = CA.UI.CodeEditor.highlightCode(src, ['item']);
    const hl = (ls, first = 0) => all.slice(first, first + ls.length).join('\n');
    // data-code-view: hovering a word shows what it is (ui/codeEditor.js); the whole code, for its variables
    const pre = (ls, first = 0) => `<pre class="ca-code-hl ca-st-code" data-code-view="${esc(src)}" data-code-vars="item"${first ? ` data-code-first="${first}"` : ''}>${hl(ls, first)}</pre>`;
    if (lines.length <= CODE_LINES) return pre(lines);
    return `<details class="ca-st-more"><summary>${pre(lines.slice(0, CODE_LINES - 1))}<span>${lines.length - CODE_LINES + 1} more lines</span></summary>${pre(lines.slice(CODE_LINES - 1), CODE_LINES - 1)}</details>`;
  }

  function cardHtml(s) {
    const [v, cls] = valueNow(s);
    const c = ctxFor(s.scope);
    const inTt = s.warn ? isWarning(s.id) : inTooltip(s.id);
    const usedMode = s.mode && CA.Settings.get('ppMode') === s.id;
    const star = C().widgetStar(widgetPreset(s), s.label);
    const call = `stat.${s.key}(${s.scope === 'game' ? '' : 'item'})`;
    return (
      `<div class="ca-st-card${s.builtin ? '' : ' yours'}" data-st-card="${esc(s.id)}">` +
      `<div class="ca-st-head"><b class="ca-st-name">${esc(s.label)}</b>${kindTag(s.scope)}${s.warn ? `<span class="ca-tl-kind ca-tl-color ${warnColor(s)}" data-tip="A warning: it marks items in the store">⚠ warning</span>` : ''}${s.mode ? '<span class="ca-tl-kind ca-st-modetag" data-tip="A payback mode: it sets income (what payback periods count in) and returns what the item adds to it">payback mode</span>' : ''}${s.builtin ? (s.customized ? '<span class="ca-tl-kind yours" data-tip="A built-in you’ve changed (Edit → Reset brings back the original)">changed</span>' : '') : '<span class="ca-tl-kind yours">yours</span>'}${star}</div>` +
      `<div class="ca-st-live"><span>${c ? aboutHtml(c) : 'the game'}</span><b class="${cls}" data-st-val="${esc(s.id)}">${v}</b></div>` +
      `<div class="ca-st-desc">${esc(s.desc || '')}</div>` +
      codeHtml(s.source) +
      '<div class="ca-st-actions">' +
      (s.mode
        ? `<button type="button" class="ca-chip${usedMode ? ' on' : ''}" data-st-mode="${esc(s.id)}" data-tip="${usedMode ? 'The payback mode in use (the Payback page’s)' : 'Make it the payback mode: every payback period counts in it'}">${usedMode ? '✓ the payback mode' : '+ use as the payback mode'}</button>`
        : s.warn
        ? `<button type="button" class="ca-chip${inTt ? ' on' : ''}" data-st-tt="${esc(s.id)}" data-tip="${inTt ? 'Stop this warning' : 'Use this warning (at the end of the list)'}">${inTt ? '✓ warning on' : '+ use as a warning'}</button>`
        : `<button type="button" class="ca-chip${inTt ? ' on' : ''}" data-st-tt="${esc(s.id)}" data-tip="${inTt ? 'Take it out of the store tooltip' : 'Add it to the store tooltip, at the end'}">${inTt ? '✓ in the tooltip' : '+ add to the tooltip'}</button>`) +
      `<button type="button" class="ca-chip" data-st-edit="${esc(s.id)}" data-tip="${s.builtin ? 'Change it: its label, code, how it reads (Reset brings back the original)' : 'Change it'}">${I('edit', 11)} ${s.builtin ? 'Customize' : 'Edit'}</button>` +
      `<button type="button" class="ca-chip" data-st-dup="${esc(s.id)}" data-tip="A copy that’s yours to change">${I('plus', 11)} Duplicate</button>` +
      (s.builtin
        ? ''
        : `<button type="button" class="ca-chip ca-chip-danger" data-st-del="${esc(s.id)}" data-arm-label="Delete it?" data-tip="Delete this statistic (its tooltip lines go too)">${I('trash', 11)} Delete</button>`) +
      `<code class="ca-st-call ca-hl" data-code-view="${esc(call)}" data-code-vars="item">${CA.UI.CodeEditor.highlightLine(call, { vars: ['item'] })}</code>` +
      '</div></div>'
    );
  }

  function chipsHtml() {
    const all = ST().all();
    const n = (f) => all.filter(f).length;
    const chip = (id, label, count, tip) =>
      `<button type="button" class="ca-chip${filter === id ? ' on' : ''}" data-st-filter="${id}"${tip ? ` data-tip="${tip}"` : ''}>${label} <em>${count}</em></button>`;
    return (
      chip('all', 'All', all.length) +
      ST()
        .GROUPS.filter((g) => g !== 'Payback modes')
        .map((g) =>
          chip(
            g,
            g,
            n((s) => s.group === g)
          )
        )
        .join('') +
      chip(
        'warnings',
        'Warnings',
        n((s) => s.warn),
        'Statistics that mark items in the store'
      ) +
      chip(
        'modes',
        'Payback modes',
        n((s) => s.mode),
        'What payback periods count in: each sets an income and returns what an item adds to it'
      ) +
      chip(
        'yours',
        'Yours',
        n((s) => !s.builtin)
      ) +
      chip('onscreen', `${I('star', 11)} On screen`, n(onScreen), 'Statistics on the left panel as widgets')
    );
  }

  function catalogHtml() {
    const list = statsShown();
    if (!list.length)
      return `<div class="ca-card-note">${filter === 'yours' && !query ? 'None of yours yet: + New, or duplicate a statistic.' : filter === 'warnings' && !query ? 'No warnings.' : filter === 'onscreen' && !query ? 'None on the left panel: ☆ a statistic to put it there.' : 'No statistic matches.'}</div>`;
    return `<div class="ca-st-grid">${list.map(cardHtml).join('')}</div>`;
  }

  // ---- values: every word a statistic can read -----------------------------------------------------

  const valueGroup = (v) => v.group || (v.id.includes('.') ? v.id.split('.')[0].replace(/^./, (x) => x.toUpperCase()) : 'The game');
  /** A word's value now: about the previewed building (or the best upgrade), when it takes one. */
  function wordNow(v) {
    const ps = v.params || [];
    try {
      let x;
      if (v.context) x = ST().about(ctxFor('item'), () => v.get());
      else if (!ps.length) x = v.get();
      else if (ps.length === 1 && ps[0] === 'building') x = v.get((previewBuilding().b || {}).name);
      else if (ps.length === 1 && ps[0] === 'upgrade') x = v.get((bestUpgrade() || {}).name);
      else return '';
      if (Array.isArray(x)) return `${x.length} items`;
      return ST().format(x, 'auto', v.desc);
    } catch (e) {
      return '—';
    }
  }
  function valuesShown() {
    return CA.Script.library({ mode: 'stat' })
      .filter((x) => x.kind === 'value')
      .map((x) => CA.Script.VALUES.find((v) => v.id === x.id))
      .filter((v) => v && matchesQuery(`${v.id} ${v.desc}`));
  }
  const sigOf = (v) => `${v.id}(${(v.params || []).join(', ')})`;
  function valuesHtml() {
    const by = {};
    valuesShown().forEach((v) => (by[valueGroup(v)] = by[valueGroup(v)] || []).push(v));
    const names = Object.keys(by);
    if (!names.length) return '<div class="ca-card-note">No value matches.</div>';
    const order = ['This item', 'Statistics', 'Text', 'Numbers'];
    names.sort((a, b) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99) || a.localeCompare(b));
    return (
      '<div class="ca-vl">' +
      names
        .map(
          (g) =>
            `<div class="ca-vl-group">${esc(g)} <em>${by[g].length}</em></div>` +
            by[g]
              .map(
                (v) =>
                  `<div class="ca-vl-row"><code class="ca-hl" data-code-view="${esc(sigOf(v))}">${CA.UI.CodeEditor.highlightLine(sigOf(v))}</code><span class="ca-vl-desc">${esc(v.desc || '')}</span><b data-vl-val="${esc(v.id)}">${wordNow(v)}</b></div>`
              )
              .join('')
        )
        .join('') +
      '</div>'
    );
  }

  function pasteHtml() {
    return (
      '<div class="ca-se-share ca-st-paste">' +
      '<textarea spellcheck="false" placeholder="Paste a statistic copied as text (or just its code)…" data-st-pastetext></textarea>' +
      (pasteError ? `<div class="ca-editor-error">${esc(pasteError)}</div>` : '') +
      `<div class="ca-st-actions">${C().button(`${I('edit', 12)} Open in the editor`, 'data-st-pasteopen', 'ca-btn-small ca-btn-on')}${C().button('Cancel', 'data-st-paste', 'ca-btn-small')}</div>` +
      '</div>'
    );
  }

  function browseCard() {
    if (SE().isOpen()) return SE().html();
    const tabChip = (id, label, icon) =>
      `<button type="button" class="ca-chip${tab === id ? ' on' : ''}" data-st-tab="${id}">${I(icon, 11)} ${label}</button>`;
    return (
      '<div class="ca-card">' +
      C().cardHead(
        'Statistics',
        'graphs',
        '<div class="ca-card-meta">' +
          `<span class="ca-chipgroup">${tabChip('stats', 'Statistics', 'graphs')}${tabChip('values', 'Values', 'tag')}</span>` +
          C().button(`${I('plus', 12)} New`, 'data-st-new data-tip="Write a statistic of your own"', 'ca-btn-small ca-btn-on') +
          C().button(
            `${I('download', 12)} Paste`,
            'data-st-paste data-tip="Add a statistic copied as text"',
            `ca-btn-small${pasting ? ' ca-btn-on' : ''}`
          ) +
          '</div>'
      ) +
      (pasting ? pasteHtml() : '') +
      '<div class="ca-toolbar">' +
      (tab === 'stats' ? `<div class="ca-chipgroup" data-st-chips>${chipsHtml()}</div>` : '') +
      `<label class="ca-search">${I('search', 13)}<input type="search" placeholder="${tab === 'stats' ? 'Search statistics…' : 'Search values…'}" data-st-search value="${esc(query)}"></label>` +
      '</div>' +
      `<div class="ca-card-note">${
        tab === 'stats'
          ? 'Values are for the previewed building (an upgrade’s: the best upgrade).'
          : 'Values now are for the previewed building.'
      }</div>` +
      CA.UI.CodeEditor.legendHtml() +
      `<div data-st-body>${tab === 'stats' ? catalogHtml() : valuesHtml()}</div>` +
      '</div>'
    );
  }

  // ---- the page ---------------------------------------------------------------------------------

  /** Where the tooltip's layout is now: a note under the catalog. */
  const layoutNote = () =>
    `<div class="ca-card-note">The store tooltip’s lines and warnings are set on ${C().link('Settings', 'settings:store')}.</div>`;
  const html = () => browseCard() + layoutNote();
  /** Opens the page on a shelf: 'modes' (or 'Payback modes'), 'warnings', a group… */
  function showGroup(g) {
    filter = g === 'Payback modes' ? 'modes' : g;
    tab = 'stats';
    query = '';
    if (SE().isOpen()) SE().close();
    CA.UI.Menu.openPage('tooltips');
  }

  /** Everything again (after a change): morphed, so focus and open menus stay. */
  function refresh() {
    if (!root || !root.isConnected) return;
    [
      ['[data-tp-list]', profilesHtml],
      ['[data-tl-lines]', linesHtml],
      ['[data-tl-preview]', previewHtml],
      ['[data-tl-warns]', warnsHtml],
      ['[data-st-chips]', chipsHtml],
      ['[data-st-body]', () => (tab === 'stats' ? catalogHtml() : valuesHtml())],
    ].forEach(([sel, fn]) => {
      const el = root.querySelector(sel);
      if (el) CA.UI.Dom.morph(el, fn());
    });
  }
  /** The live parts: values and previews (not the selects or inputs). */
  function sync() {
    if (!root || !root.isConnected) return;
    SE().sync(root);
    const pv = root.querySelector('[data-tl-preview]');
    if (pv && !pv.contains(document.activeElement)) CA.UI.Dom.morph(pv, previewHtml());
    const list = SI().lines();
    root.querySelectorAll('[data-tl-val]').forEach((el) => {
      const [v, cls] = valueNow(statOf(list[Number(el.dataset.tlVal)]));
      if (el.innerHTML !== v) el.innerHTML = v;
      el.className = `ca-tl-val ${cls}`;
    });
    const wl = SI().warningList();
    root.querySelectorAll('[data-tw-val]').forEach((el) => {
      const [v, cls] = valueNow(ST().get(wl[Number(el.dataset.twVal)]));
      if (el.innerHTML !== v) el.innerHTML = v;
      el.className = `ca-tl-val ${cls}`;
    });
    root.querySelectorAll('[data-st-val]').forEach((el) => {
      const [v, cls] = valueNow(ST().get(el.dataset.stVal));
      if (el.innerHTML !== v) el.innerHTML = v;
      el.className = cls;
    });
    if (tab === 'values') {
      const by = Object.fromEntries(CA.Script.VALUES.map((v) => [v.id, v]));
      root.querySelectorAll('[data-vl-val]').forEach((el) => {
        const v = by[el.dataset.vlVal];
        const t = v ? wordNow(v) : '';
        if (el.innerHTML !== t) el.innerHTML = t;
      });
    }
  }

  function onClick(e) {
    const tw = e.target.closest('[data-tw-up],[data-tw-down],[data-tw-del],[data-tw-reset]');
    if (tw) {
      e.stopPropagation();
      const d = tw.dataset;
      if (d.twReset !== undefined) return editWarnings(() => null);
      const i = Number(d.twUp ?? d.twDown ?? d.twDel);
      return editWarnings((list) => {
        if (d.twDel !== undefined) list.splice(i, 1);
        else {
          const j = d.twUp !== undefined ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return list;
          [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
      });
    }
    const tp = e.target.closest('[data-tp-act]');
    if (tp) {
      e.stopPropagation();
      const { tpAct: act, id } = tp.dataset;
      if ((act === 'delete' || act === 'revert') && !CA.UI.Dom.armed(tp)) return;
      if (act === 'use') SI().useProfile(id);
      else if (act === 'new') SI().addProfile();
      else if (act === 'delete') SI().removeProfile(id);
      else if (act === 'revert') SI().revertDefault();
      CA.Util.sound('snd/tick.mp3');
      return refresh();
    }
    const tl = e.target.closest('[data-tl-up],[data-tl-down],[data-tl-del],[data-tl-reset]');
    if (tl) {
      e.stopPropagation();
      const d = tl.dataset;
      if (d.tlReset !== undefined) return editLines(() => null);
      const i = Number(d.tlUp ?? d.tlDown ?? d.tlDel);
      return editLines((list) => {
        if (d.tlDel !== undefined) list.splice(i, 1);
        else {
          const j = d.tlUp !== undefined ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return list;
          [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
      });
    }
    const b = e.target.closest(
      '[data-tl-opt],[data-st-mode],[data-st-tab],[data-st-filter],[data-st-tt],[data-st-dup],[data-st-del],[data-st-edit],[data-st-new],[data-st-paste],[data-st-pasteopen]'
    );
    if (!b) return;
    e.stopPropagation();
    const d = b.dataset;
    if (d.tlOpt) {
      CA.Settings.set(d.tlOpt, !CA.Settings.get(d.tlOpt));
      CA.UI.Menu.render();
      return;
    }
    CA.Util.sound('snd/tick.mp3');
    if (d.stMode) {
      CA.Settings.set('ppMode', d.stMode);
      refresh();
      return;
    }
    if (d.stTab) {
      tab = d.stTab;
      CA.UI.Menu.render();
      return;
    }
    // the editor (ui/statEditor.js), in place of the catalog
    if (d.stEdit !== undefined || d.stNew !== undefined || d.stPasteopen !== undefined) {
      if (d.stEdit !== undefined) SE().open(d.stEdit);
      else if (d.stNew !== undefined) SE().openNew();
      else {
        const def = ST().fromText((root.querySelector('[data-st-pastetext]') || {}).value);
        if (!def) {
          pasteError = 'Nothing to add: paste a statistic copied as text, or some code.';
          CA.UI.Menu.render();
          return;
        }
        SE().openNew(def);
      }
      pasting = false;
      pasteError = '';
      CA.UI.Menu.render();
      CA.Util.scrollInPanel(root.querySelector('[data-stat-editor]'), 'start');
      return;
    }
    if (d.stPaste !== undefined) {
      pasting = !pasting;
      pasteError = '';
      CA.UI.Menu.render();
      return;
    }
    if (d.stFilter) filter = d.stFilter;
    else if (d.stTt) {
      const s = ST().get(d.stTt);
      if (!s) return;
      if (s.warn) return editWarnings((list) => (list.includes(s.id) ? list.filter((x) => x !== s.id) : list.concat([s.id])));
      const on = inTooltip(s.id);
      return editLines((list) => (on ? list.filter((x) => (statOf(x) || {}).id !== s.id) : list.concat([entryFor(s)])));
    } else if (d.stDup) {
      const s = ST().duplicate(d.stDup);
      if (s) {
        filter = 'yours';
        query = '';
        const search = root.querySelector('[data-st-search]');
        if (search) search.value = '';
      }
    } else if (d.stDel) {
      if (!CA.UI.Dom.armed(b)) return;
      SI().setLines(
        SI()
          .lines()
          .filter((x) => (statOf(x) || {}).id !== d.stDel || isWord(x))
      );
      if (isWarning(d.stDel)) SI().setWarnings(SI().warningList().filter((x) => x !== d.stDel));
      ST().remove(d.stDel);
    }
    refresh();
  }

  function onChange(e) {
    const el = e.target;
    const d = el.dataset || {};
    if (d.twAdd !== undefined) {
      const v = el.value;
      if (!v) return;
      return editWarnings((list) => list.concat([v]));
    }
    if (d.tlAdd !== undefined) {
      const v = el.value;
      if (!v) return;
      return editLines((list) =>
        list.concat([v.startsWith('w:') ? { word: v.slice(2), fmt: 'auto' } : v.startsWith('s:') ? { stat: v.slice(2) } : v])
      );
    }
    if (d.tpName !== undefined) {
      SI().renameProfile(d.tpName, el.value);
      return refresh();
    }
    if (d.tlFmt !== undefined) {
      const i = Number(d.tlFmt);
      return editLines((list) => {
        if (isWord(list[i])) list[i] = { ...list[i], fmt: el.value };
        return list;
      });
    }
    if (d.tlLabel !== undefined) {
      const i = Number(d.tlLabel);
      return editLines((list) => {
        if (isWord(list[i])) list[i] = { ...list[i], label: el.value.trim() || list[i].word };
        return list;
      });
    }
    if (d.tlB !== undefined) {
      previewOf = el.value;
      refresh();
    }
  }

  function onInput(e) {
    if (!e.target.dataset || e.target.dataset.stSearch === undefined) return;
    query = e.target.value.trim();
    const body = root.querySelector('[data-st-body]');
    if (body) body.innerHTML = tab === 'stats' ? catalogHtml() : valuesHtml();
  }

  // drag a row to reorder the lines
  function rowOf(e) {
    const r = e.target.closest && e.target.closest('[data-tl-row]');
    return r ? Number(r.dataset.tlRow) : -1;
  }
  function clearDrop() {
    if (root)
      root
        .querySelectorAll('.ca-tl-row.drop-above,.ca-tl-row.drop-below,.ca-tl-row.dragging')
        .forEach((x) => x.classList.remove('drop-above', 'drop-below', 'dragging'));
  }
  function onDragStart(e) {
    if (e.target.closest && e.target.closest('input,select')) return;
    dragFrom = rowOf(e);
    if (dragFrom < 0) return;
    e.target.closest('[data-tl-row]').classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFrom));
    }
  }
  function onDragOver(e) {
    const i = rowOf(e);
    if (dragFrom < 0 || i < 0) return;
    e.preventDefault();
    const row = e.target.closest('[data-tl-row]');
    const r = row.getBoundingClientRect();
    const below = e.clientY > r.top + r.height / 2;
    clearDrop();
    root.querySelector(`[data-tl-row="${dragFrom}"]`).classList.add('dragging');
    row.classList.add(below ? 'drop-below' : 'drop-above');
  }
  function onDrop(e) {
    const i = rowOf(e);
    const from = dragFrom;
    dragFrom = -1;
    if (from < 0 || i < 0) return clearDrop();
    e.preventDefault();
    const row = e.target.closest('[data-tl-row]');
    const r = row.getBoundingClientRect();
    let to = e.clientY > r.top + r.height / 2 ? i + 1 : i;
    clearDrop();
    if (to > from) to--;
    if (to === from) return;
    editLines((list) => {
      const [x] = list.splice(from, 1);
      list.splice(to, 0, x);
      return list;
    });
  }
  function onDragEnd() {
    dragFrom = -1;
    clearDrop();
  }

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el)
      .on('click', onClick)
      .on('change', onChange)
      .on('input', onInput)
      .on('dragstart', onDragStart)
      .on('dragover', onDragOver)
      .on('drop', onDrop)
      .on('dragend', onDragEnd)
      .every(SYNC_MS, sync);
    life.add(CA.Events.on('stats', refresh));
    life.add(SE().bind(el));
    // a ☆ clicked (here, or a widget taken away on the panel): the On screen count, and its list
    life.add(
      CA.Events.on('widgets', () => {
        const chips = root && root.querySelector('[data-st-chips]');
        if (chips) CA.UI.Dom.morph(chips, chipsHtml());
        if (filter === 'onscreen') refresh();
      })
    );
  }
  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  // ---- the Statistic widget: one statistic's line, live, on the left panel -------------------------
  //
  // { stat: id, item }: item is 'best' (the best of the statistic's kind: building, upgrade or either),
  // 'b:<building>' or 'u:<upgrade>'; a statistic about the game needs none.

  function widgetHtml(w) {
    const s = ST().get(w.stat || 'payback');
    if (!s) return '<div class="ca-w-stat ca-st-gone"><span>This statistic is gone (deleted).</span></div>';
    const c = ST().pick(s.scope, w.item);
    let row = null;
    try {
      row = ST().line(s, c);
    } catch (e) {
      row = null;
    }
    const about =
      s.scope === 'game' ? '' : c ? `${(w.item || 'best') === 'best' ? 'the best: ' : ''}${aboutHtml(c)}` : 'nothing to show it about';
    return (
      `<div class="ca-w-stat"><span>${row ? row[0] : esc(s.label)}</span><b class="${row ? row[2] : ''}">${row ? row[1] : '—'}</b></div>` +
      (about ? `<div class="ca-w-stat-about">${about}</div>` : '')
    );
  }
  function itemOptions() {
    const bs = Object.values(Game.Objects || {}).filter((b) => !b.locked || b.amount > 0);
    return [{ v: 'best', label: 'The best (lowest payback period)' }]
      .concat(bs.map((b) => ({ v: `b:${b.name}`, label: b.dname || b.name })))
      .concat(
        (Game.UpgradesInStore || [])
          .filter((u) => !P().isSwitch(u))
          .map((u) => ({ v: `u:${u.name}`, label: `${u.dname || u.name} (upgrade)` }))
      );
  }
  function defineWidget() {
    CA.UI.Widgets.defineType({
      id: 'statistic',
      group: 'game',
      sprite: [10, 10],
      short: 'One statistic, live — yours or a built-in',
      name: 'Statistic',
      icon: 'graphs',
      desc: 'One statistic from the Tooltips page — a tooltip line, or one of yours — live: about the best building, the best upgrade or the best buy, or an item you pick. Add as many as you like; ☆ one on the Tooltips page for the quickest way.',
      width: 200,
      resize: 'free',
      nameOf: (w) => (ST().get(w.stat || 'payback') || {}).label,
      html: widgetHtml,
      settings: [
        {
          key: 'stat',
          label: 'Statistic',
          type: 'select',
          default: 'payback',
          options: () =>
            ST()
              .all()
              .map((s) => ({ v: s.id, label: `${s.label}${s.builtin ? '' : ' (yours)'}` })),
        },
        { key: 'item', label: 'About (not for one about the game)', type: 'select', default: 'best', options: itemOptions },
      ],
    });
  }

  function init() {
    defineWidget();
    CA.UI.Pages.register({ id: 'tooltips', label: 'Statistics', icon: 'tag', order: 68, group: 'custom', html, mount, unmount, tick: sync });
    // a code card's link leaving the statistic editor (ui/codeEditor.js): unsaved changes are asked about first
    const reopen = (fn) => () => {
      fn();
      CA.UI.Menu.openPage('tooltips');
      CA.UI.Menu.render();
    };
    CA.UI.CodeEditor.guard('tooltips', {
      dirty: () => SE().dirty(),
      name: () => (SE().draft() ? SE().draft().label : 'Statistics'),
      leave(how) {
        const d = SE().draft();
        if (!d) return { back: reopen(() => {}) };
        if (how === 'save') {
          const err = SE().saveNow();
          if (err) return { error: err };
          const st = (d.id && ST().get(d.id)) || ST().all().find((x) => x.key === d.key);
          return { back: reopen(() => st && SE().open(st.id)) };
        }
        if (how === 'discard') {
          SE().close();
          return { back: reopen(() => d.id && SE().open(d.id)) };
        }
        return { back: reopen(() => (d.id ? SE().open(d.id) : SE().openNew(d))) };
      },
    });
  }

  return { init, sync, mount, unmount, layoutCard, showGroup };
})();
