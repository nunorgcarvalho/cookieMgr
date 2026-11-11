// The Garden page: the auto-gardener, its layers and profiles (features/garden.js, gardenLayers.js).
//
//   Effects         the plants' combined effects over time (the game's Garden information figures)
//   Growth          a stacked bar chart over time: how many of each seed were at each stage (each
//                   seed its own color, young stages darker) — features/gardenHistory.js
//   Garden          your plot as it is now, against the layout: each tile's plant and growth
//                   stage, the layout's seed faded in on empty tiles, a red ring on tiles that don't
//                   match, and the chance a mature plant dies on the coming tick; hover a tile for details
//   (Growth and Effects each have a ☆ that puts the chart on the left panel as a widget.)
//   Auto-gardener   its on/off switch (★ for its button on the left panel); the profile bar (a profile
//                   picks all four layers — features/gardenLayers.js); four slots showing what's picked
//                   — Gardener, Soil rule, Template, Seeds — and the selected one in detail, to pick
//                   another or edit it: code (the macros' language, with the garden's own words; while
//                   it runs, the lines it took light up), a grid of letters, or a seed per letter.
//                   Built-ins can be edited and reverted; Save as new makes one of your own.

CA.UI = CA.UI || {};

CA.UI.GardenPage = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const G = () => CA.Garden;
  const SYNC_MS = 500;

  let root = null;
  let life = null; // the mounted page (CA.UI.Pages.scope)
  let plot = null;
  let effectsPlot = null;
  let draft = null; // { layer, id, data } — a slot's item being edited, not saved yet
  let rulesError = '';

  const stageOf = (me, age) => (age >= me.mature ? 4 : age >= me.mature * 0.666 ? 3 : age >= me.mature * 0.333 ? 2 : 1);
  const STAGE_NAMES = ['seed', 'bud', 'sprout', 'bloom', 'mature'];
  const pct = (v) => `${v >= 0.995 ? 100 : v < 0.005 && v > 0 ? '<1' : Math.round(v * 100)}%`;

  /** A garden sprite (img/gardenPlants.png): column = growth stage (0 = seed), row = the plant's icon. */
  const sprite = (me, stage, cls = '') =>
    `<i class="ca-gs ${cls}" style="background-image:url(${CA.Util.res('img/gardenPlants.png')});background-position:${-stage * 48}px ${-me.icon * 48}px"></i>`;

  // ---- mutation odds: what each empty tile can grow at the next tick ------------------------------
  //
  // From features/mutations.js (CA.Mutations — the Cookie Monster port's engine, read only), with its
  // options: gardenOddsTiles (a badge on each empty tile that can grow something, and the stat) and
  // gardenOddsTips (a "Next tick" section in the tile's details) — the same switches as in the game's
  // own garden.

  const optOn = (k) => !!CA.Settings.get(k);
  const pcOdds = (p) => (p >= 0.9995 ? '100%' : p > 0 && p < 0.0001 ? '<0.01%' : `${(p * 100).toFixed(p < 0.01 ? 2 : p < 0.1 ? 1 : 0)}%`);
  const isLocked = (M, key) => !!(M.plants[key] && !M.plants[key].unlocked);
  let oddsCache = { sig: '', a: null, by: {} };
  /**
   * Every empty tile's odds at the next tick — worked out again only when the plot, the soil or the
   * tick changes (the engine re-reads the whole plot), not on every refresh of the page.
   */
  function oddsNow(M) {
    if (!CA.Mutations || !M || !M.plot || (!optOn('gardenOddsTiles') && !optOn('gardenOddsTips'))) return null;
    const sig = M.plot.map((r) => r.map((t) => `${t[0]}.${t[1]}`).join(',')).join(';') + `|${M.soil}|${M.nextStep}|${M.parent ? M.parent.level : ''}`;
    if (oddsCache.sig !== sig) {
      let a = null;
      try {
        a = CA.Mutations.all();
      } catch (e) {
        a = null;
      }
      const by = {};
      if (a) a.tiles.forEach((t) => (by[`${t.x},${t.y}`] = t));
      oddsCache = { sig, a, by };
    }
    return oddsCache.a ? oddsCache : null;
  }
  const SHOW_ODDS = 6; // plants listed in a tile's details
  /** An empty tile's "Next tick" rows: what can grow, each with its chance (a seed you haven't unlocked marked). */
  function oddsPop(M, o) {
    let h = '<span class="ca-wpop-head ca-gpop-sub"><b>Next tick</b></span>';
    if (!o.plants.length) return h + '<span class="ca-wpop-row"><span class="ca-wpop-name">Grows here</span><span class="ca-wpop-val">nothing can</span></span>';
    o.plants.slice(0, SHOW_ODDS).forEach((p) => {
      h += `<span class="ca-wpop-row"><span class="ca-wpop-name">${esc(p.name)}${isLocked(M, p.key) ? ' <em class="ca-godds-new">★ new seed</em>' : ''}</span><span class="ca-wpop-val">${pcOdds(p.chance)}</span></span>`;
    });
    if (o.plants.length > SHOW_ODDS) h += `<span class="ca-wpop-row"><span class="ca-wpop-name">${o.plants.length - SHOW_ODDS} more</span><span class="ca-wpop-val">${pcOdds(o.plants.slice(SHOW_ODDS).reduce((s, p) => s + p.chance, 0))}</span></span>`;
    return h + `<span class="ca-wpop-row"><span class="ca-wpop-name"><b>Something grows</b></span><span class="ca-wpop-val">${pcOdds(o.any)}</span></span>`;
  }

  // ---- the plot -----------------------------------------------------------------------------

  function tileHtml(t, profile, odds) {
    if (!t.open) return '<div class="ca-gtile locked"></div>';
    const me = t.plant;
    let inner = '';
    let pop = '';
    if (me) {
      const st = stageOf(me, t.age);
      inner += sprite(me, st);
      if (st === 4 && !me.immortal && t.decay > 0) inner += `<b class="ca-gdecay${t.decay >= 0.5 ? ' hi' : ''}">${pct(t.decay)}</b>`;
      if (!me.unlocked) inner += `<b class="ca-gnew">${I('sparkle', 9)}</b>`;
      pop +=
        `<span class="ca-wpop-head"><b>${esc(me.name)}</b></span>` +
        `<span class="ca-wpop-row"><span class="ca-wpop-name">Growth</span><span class="ca-wpop-val">${STAGE_NAMES[st]} · ${t.age} / ${me.mature}</span></span>` +
        (me.immortal
          ? '<span class="ca-wpop-row"><span class="ca-wpop-name">Lifespan</span><span class="ca-wpop-val">immortal</span></span>'
          : `<span class="ca-wpop-row"><span class="ca-wpop-name">Dies next tick</span><span class="ca-wpop-val">${pct(t.decay)}</span></span>`) +
        (!me.unlocked ? '<span class="ca-wpop-row"><span class="ca-wpop-name">New seed</span><span class="ca-wpop-val">harvest when mature to unlock</span></span>' : '');
    } else {
      if (t.want) inner += sprite(t.want, 0, 'ghost');
      pop += '<span class="ca-wpop-head"><b>Empty</b></span>';
    }
    if (profile) pop += `<span class="ca-wpop-row"><span class="ca-wpop-name">Layout</span><span class="ca-wpop-val">${t.want ? esc(t.want.name) : 'empty'}</span></span>`;
    // what this empty tile can grow at the next tick
    const o = !me && odds ? odds.by[`${t.x},${t.y}`] : null;
    if (o) {
      const M = G().minigame();
      if (optOn('gardenOddsTiles') && o.any >= 0.00005) inner += `<b class="ca-godds${o.plants.some((p) => isLocked(M, p.key)) ? ' new' : ''}">${pcOdds(o.any)}</b>`;
      if (optOn('gardenOddsTips')) pop += oddsPop(M, o);
    }
    return `<div class="ca-gtile${t.match ? '' : ' off'}" data-pop>${inner}<span class="ca-wpop ca-gpop">${pop}</span></div>`;
  }

  function plotHtml(v, odds) {
    return v.tiles.map((t) => tileHtml(t, v.profile, odds)).join('');
  }

  function statsHtml(v, odds) {
    const { span, tile } = CA.UI.Plot.fmt;
    // the next tick, over the whole plot: how many plants grow on average, and the chance a new seed is among them
    let grows = '';
    if (odds && optOn('gardenOddsTiles')) {
      const expected = odds.a.tiles.reduce((s, t) => s + t.any, 0);
      const fresh = 1 - odds.a.plants.filter((p) => !p.unlocked).reduce((s, p) => s * (1 - p.chance), 1);
      grows = tile('Grows next tick', expected > 0 && expected < 0.01 ? '<0.01' : String(Math.round(expected * 100) / 100), fresh > 0 ? `new seed: ${pcOdds(fresh)}` : 'plants, on average', 'How many plants spring up on the empty tiles at the next tick, on average — and the chance one of them is a seed you haven’t unlocked');
    }
    const off = v.profile ? v.tiles.filter((t) => t.open && !t.match).length : 0;
    const mature = v.tiles.filter((t) => t.plant && t.age >= t.plant.mature).length;
    return (
      tile('Next tick', Number.isFinite(v.next) ? span(v.next) : '—', v.step ? `every ${span(v.step)}` : '') +
      tile('Soil', v.soil ? esc(v.soil.name) : '—', esc(CA.GardenLayers.get('soil', CA.GardenLayers.picked('soil')).name)) +
      tile('Mature', String(mature), `of ${v.tiles.filter((t) => t.plant).length} plants`) +
      tile('Off-layout', String(off), off ? 'tiles not as planned' : 'all as planned') +
      grows +
      costTile(v)
    );
  }

  /**
   * What planting the layout costs at today's seed prices (they scale with CpS): every planned tile, green if
   * the bank covers it, red if not; under it what the planned tiles still missing their seed would cost.
   */
  function costTile(v) {
    const M = v.M;
    if (!v.profile || typeof M.getCost !== 'function') return '';
    const { beautify, tile } = CA.UI.Plot.fmt;
    const planned = v.tiles.filter((t) => t.open && t.want);
    if (!planned.length) return tile('Garden cost', '—', 'no seeds in the layout');
    const cost = (ts) => ts.reduce((s, t) => s + M.getCost(t.want), 0);
    const full = cost(planned);
    const left = cost(planned.filter((t) => !t.match));
    const ok = Game.cookies >= full;
    return tile(
      'Garden cost',
      `<span class="ca-gcost ${ok ? 'pos' : 'neg'}">${beautify(full)}</span>`,
      left ? `${beautify(left)} left to plant` : 'all planted',
      `Cookies to plant every tile of the layout at today’s seed prices (they go up with your CpS) — green if your bank covers it, red if not. Under it: what the tiles still missing their seed would cost.`
    );
  }

  function gardenCard() {
    return (
      '<div class="ca-card">' +
      C().cardHead('Garden', 'leaf', `<div class="ca-card-meta"><span class="ca-pill" data-gp-profile></span>${C().gameLink('Farm')}</div>`) +
      '<div class="ca-garden-wrap"><div class="ca-gplot" data-gp-plot></div><div class="ca-stats ca-gstats" data-gp-stats></div></div>' +
      '</div>'
    );
  }

  // ---- auto-gardener: a profile, and its four layers -------------------------------------------------
  //
  // The card: the Auto-gardener's switch; the profile bar (load one, save the picks into it, save
  // them as a new one, take one from the garden); four slots — Gardener, Soil rule, Template,
  // Seeds — each showing what's picked; and under them the selected slot in detail: pick another,
  // edit it (code, a grid of letters, or a seed per letter), save, save as new, revert, delete.

  const L = () => CA.GardenLayers;
  const CE = () => CA.UI.CodeEditor;
  const CK = () => CA.UI.CodeKnobs;
  const RULES_HINT = 'runs from the top every second';
  const SOIL_HINT = 'runs when the gardener calls garden.soilRule()';
  const SLOTS = [
    { layer: 'gardener', label: 'Gardener', icon: 'bolt' },
    { layer: 'soil', label: 'Soil rule', icon: 'drop' },
    { layer: 'template', label: 'Template', icon: 'widget' },
    { layer: 'seeds', label: 'Seeds', icon: 'leaf' },
  ];
  const LETTER_COLORS = ['#e8c547', '#6fb7ff', '#ff7a7a', '#8be07a', '#c792ff', '#ffa14f', '#4fd6c7', '#ff8fd0'];
  const letterColor = (l) => LETTER_COLORS[(l.charCodeAt(0) - 65) % LETTER_COLORS.length];
  let slot = 'gardener'; // the slot shown in detail
  let brush = 'A'; // the template's brush ('' rubs out)
  let seedLetter = 'A'; // the Seeds slot's letter being picked for
  let showLocked = false; // the Seeds slot: seeds you haven't unlocked too
  let knobOpen = null; // the variable whose ⚙ (how it shows) is open

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** What the detail shows for a layer's item: the unsaved draft if it's this one's, else its saved data. */
  const dataOf = (layer, it) => (draft && draft.layer === layer && draft.id === it.id ? draft.data : it.data);
  const isDirty = (layer, it) => !!draft && draft.layer === layer && draft.id === it.id && !same(draft.data, it.data);
  const pickedItem = (layer) => L().get(layer, L().picked(layer));

  /** A layer's items as <option>s, grouped (built-ins, their groups, yours). */
  function optionsHtml(layer, cur) {
    const groups = new Map();
    L()
      .list(layer)
      .forEach((x) => {
        const g = x.builtin ? x.group || 'Built-in' : 'Yours';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(x);
      });
    return [...groups]
      .map(
        ([g, xs]) =>
          `<optgroup label="${esc(g)}">` + xs.map((x) => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(x.name)}${x.edited ? ' (edited)' : ''}</option>`).join('') + '</optgroup>'
      )
      .join('');
  }
  const plantOf = (key) => {
    const M = G().minigame();
    return (M && key && M.plants && M.plants[key]) || null;
  };
  const seedName = (key) => (plantOf(key) ? plantOf(key).name : L().NAMES[key] || key || '—');
  /** A letter chip, in its color. */
  const chip = (l) => `<b class="ca-gletter" style="--lc:${letterColor(l)}">${esc(l)}</b>`;
  /** A small grid of a template's letters. */
  function miniLetters(plot) {
    let h = '<div class="ca-gmini ca-gmini-letters">';
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) h += plot[y][x] ? `<span style="background:${letterColor(plot[y][x])}"></span>` : '<span></span>';
    return h + '</div>';
  }
  /** The letters of the picked template (and any the seeds name), in order. */
  function lettersNow(seedsMap) {
    const t = pickedItem('template');
    return [...new Set(L().lettersIn(t.data.plot).concat(Object.keys(seedsMap || {})))].sort();
  }
  const firstSentence = (s) => {
    const m = String(s || '').match(/^.*?[.:;](\s|$)/);
    return (m ? m[0] : String(s || '')).trim();
  };

  /** One slot: what's picked in a layer, at a glance. */
  function slotHtml(s) {
    const it = pickedItem(s.layer);
    let sum = '';
    if (s.layer === 'template') sum = miniLetters(it.data.plot) + `<span>${L().lettersIn(it.data.plot).map(chip).join('') || 'nothing planted'}</span>`;
    else if (s.layer === 'seeds') {
      const map = it.data.map;
      const ls = lettersNow(map);
      sum = ls.length
        ? ls.map((l) => `<span class="ca-gseed-chip">${chip(l)}${plantOf(map[l]) ? sprite(plantOf(map[l]), 4) : ''}${esc(seedName(map[l]))}</span>`).join('')
        : '<span>no letters</span>';
    } else sum = `<span>${esc(firstSentence(it.desc) || 'your code')}</span>`;
    const badge = it.live ? '<span class="ca-pill">live</span>' : it.edited ? '<span class="ca-badge ca-badge-edited">edited</span>' : it.builtin ? '' : '<span class="ca-pill">yours</span>';
    return (
      `<button type="button" class="ca-gslot${slot === s.layer ? ' on' : ''}" data-gp-slot="${s.layer}">` +
      `<span class="ca-gslot-k">${I(s.icon, 12)} ${esc(s.label)}</span>` +
      `<b class="ca-gslot-name">${esc(it.name)} ${badge}</b>` +
      `<span class="ca-gslot-sum">${sum}</span>` +
      '</button>'
    );
  }

  /** The profile bar: load, save into, save as new, from the garden, revert, delete, rename. */
  function profileBar() {
    const p = pickedItem('profile');
    const changed = L().profileChanged();
    return (
      '<div class="ca-gprof">' +
      `<label class="ca-field"><span>${I('save', 12)} Profile</span><select data-gp-pick="profile">${optionsHtml('profile', p.id)}</select></label>` +
      (changed ? '<span class="ca-pill ca-pill-warn">changed</span>' : '') +
      '<span class="ca-controls">' +
      (changed ? C().button(`${I('save', 12)} Save`, 'data-gp-pact="save"', 'ca-btn-small ca-btn-on') : '') +
      C().button(`${I('plus', 12)} Save as new`, 'data-gp-pact="new"', 'ca-btn-small') +
      C().button(`${I('leaf', 12)} From the garden`, 'data-gp-pact="snapshot"', 'ca-btn-small') +
      (p.builtin && p.edited ? C().button(`${I('refresh', 12)} Revert`, 'data-gp-pact="revert" data-arm-label="Back to the built-in?"', 'ca-btn-small') : '') +
      (p.builtin ? '' : C().trash('data-gp-pact="delete"', 'Delete this profile?', 'Delete this profile')) +
      '</span>' +
      (p.builtin ? '' : `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-gp-iname="profile">`) +
      `<div class="ca-hint ca-gprof-desc">${esc(p.desc || 'Yours: a gardener, a soil rule, a template and seeds.')}</div>` +
      '</div>'
    );
  }

  /** The selected slot's head: pick another, its state, its actions. */
  function detailHead(layer, it) {
    const dirty = isDirty(layer, it);
    const noun = L().LAYERS[layer].noun;
    return (
      '<div class="ca-gdetail-head" data-gp-dhead>' +
      `<select data-gp-pick="${layer}">${optionsHtml(layer, it.id)}</select>` +
      (it.live ? '<span class="ca-pill">live</span>' : it.builtin ? (it.edited ? '<span class="ca-badge ca-badge-edited">edited</span>' : '<span class="ca-pill">built-in</span>') : '<span class="ca-pill">yours</span>') +
      (dirty ? '<span class="ca-pill ca-pill-warn">unsaved</span>' : '') +
      '<span class="ca-controls">' +
      (it.live ? C().button(`${I('refresh', 12)} Take it again`, 'data-gp-act="recapture"', 'ca-btn-small') : '') +
      (it.live ? '' : C().button(`${I('save', 12)} Save`, 'data-gp-act="save"', `ca-btn-small${dirty ? ' ca-btn-on' : ''}`)) +
      (dirty ? C().button('Discard', 'data-gp-act="discard"', 'ca-btn-small') : '') +
      C().button(`${I('plus', 12)} Save as new`, 'data-gp-act="new"', 'ca-btn-small') +
      (it.builtin && it.edited ? C().button(`${I('refresh', 12)} Revert to default`, `data-gp-act="revert" data-arm-label="Back to the built-in ${esc(noun)}?"`, 'ca-btn-small') : '') +
      (it.builtin ? '' : C().trash('data-gp-act="delete"', `Delete this ${noun}?`, `Delete this ${noun}`)) +
      '</span>' +
      (it.builtin ? '' : `<input type="text" class="ca-gname" maxlength="40" value="${esc(it.name)}" data-gp-iname="${layer}">`) +
      '</div>'
    );
  }

  function codeBody(layer, it) {
    const d = dataOf(layer, it);
    return (
      '<div class="ca-ed-layout"><div class="ca-editor-body">' +
      CK().html('garden', d.rules, d.knobs, { open: knobOpen }) +
      CE().html('garden', d.rules, { title: 'Code', hint: layer === 'soil' ? SOIL_HINT : RULES_HINT }) +
      '</div>' +
      CE().libraryHtml('garden', { first: ['Garden', 'Values'] }) +
      '</div>'
    );
  }

  /** The template's grid: paint letters with the brush (cells off your plot dimmed). */
  function templateBody(it) {
    const d = dataOf('template', it);
    const M = G().minigame();
    const [ox, oy] = d.abs ? [0, 0] : G().originOf(M);
    const open = (x, y) => !M || typeof M.isTileUnlocked !== 'function' || (x + ox < 6 && y + oy < 6 && M.isTileUnlocked(x + ox, y + oy));
    const used = L().lettersIn(d.plot);
    const next = L().LETTERS.split('').find((l) => !used.includes(l));
    const brushes = used.concat(next ? [next] : []);
    if (brush && !brushes.includes(brush)) brush = brushes[0] || 'A';
    const seeds = pickedItem('seeds').data.map;
    let cells = '';
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        const l = d.plot[y][x];
        const me = l && plantOf(seeds[l]);
        cells +=
          `<button type="button" class="ca-gcell${open(x, y) ? '' : ' off'}"${it.live ? ' disabled' : ''} data-gp-cell="${x},${y}"${l ? ` style="--lc:${letterColor(l)}"` : ''}>` +
          (l ? `${me ? sprite(me, 4) : ''}<b>${esc(l)}</b>` : '') +
          '</button>';
      }
    return (
      (it.live
        ? '<div class="ca-hint">What’s planted now. <b>Save as new</b> keeps it as a template of yours.</div>'
        : '<div class="ca-gbrushes">' +
          '<span class="ca-hint">Paint:</span>' +
          brushes.map((l) => `<button type="button" class="ca-gbrush${brush === l ? ' on' : ''}" data-gp-brush="${l}">${chip(l)}${l === next ? ' new' : ''}</button>`).join('') +
          `<button type="button" class="ca-gbrush${brush === '' ? ' on' : ''}" data-gp-brush="">${I('close', 11)} empty</button>` +
          C().button('Clear', 'data-gp-tact="clear"', 'ca-btn-small') +
          C().button('Fill', 'data-gp-tact="fill"', 'ca-btn-small') +
          '</div>') +
      `<div class="ca-gtemplate">${cells}</div>` +
      (d.abs ? '' : '<div class="ca-hint">Laid on your plot from its top-left unlocked tile; dimmed cells are off your plot.</div>')
    );
  }

  /** A plant's effects, as the game words them (its effsStr, as text), for a tip. */
  const effectsCache = {};
  function effectsOf(me) {
    if (!(me.key in effectsCache)) {
      const d = document.createElement('div');
      d.innerHTML = me.effsStr || '';
      effectsCache[me.key] = d.textContent.replace(/•/g, ' · ').replace(/\s+/g, ' ').replace(/^ · /, '').trim();
    }
    return effectsCache[me.key];
  }

  /**
   * The seeds: a tab per letter of the template (its seed's icon and name), and under the chosen
   * one the seeds to pick from, as the game shows them — the ones you've unlocked, or every one
   * with the toggle. A pick on a live set (As planted) makes a seed set of yours with it.
   */
  function seedsBody(it) {
    const map = dataOf('seeds', it).map;
    const M = G().minigame();
    const plants = M ? M.plantsById || Object.keys(M.plants).map((k) => M.plants[k]) : [];
    const ls = lettersNow(map);
    if (!ls.length) return '<div class="ca-hint">The template has no letters — nothing to plant. Paint some in the Template slot.</div>';
    if (!ls.includes(seedLetter)) seedLetter = ls[0];
    const tabs = ls
      .map((l) => {
        const me = plantOf(map[l]);
        return (
          `<button type="button" class="ca-gseed-tab${l === seedLetter ? ' on' : ''}${me && !me.unlocked ? ' locked' : ''}" data-gp-letter="${l}">` +
          chip(l) +
          `<span class="ca-gseed-sprite">${me ? sprite(me, 4) : ''}</span>` +
          `<span>${map[l] ? esc(seedName(map[l])) : '<em>nothing</em>'}</span>` +
          '</button>'
        );
      })
      .join('');
    const locked = plants.filter((p) => !p.unlocked);
    const shown = plants.filter((p) => p.unlocked || showLocked || p.key === map[seedLetter]);
    const opt = (me) =>
      `<button type="button" class="ca-gseed-opt${me.key === map[seedLetter] ? ' on' : ''}${me.unlocked ? '' : ' locked'}" data-gp-seedpick="${esc(me.key)}" data-tip="${esc(
        `${me.name}${me.unlocked ? '' : ' (not unlocked yet: can’t be planted)'}${effectsOf(me) ? ` — ${effectsOf(me)}` : ''}`
      )}">` +
      sprite(me, 4) +
      `<span>${esc(me.name)}</span>` +
      '</button>';
    return (
      `<div class="ca-gseed-tabs">${tabs}</div>` +
      '<div class="ca-gseed-pick">' +
      '<div class="ca-gseed-pickhead">' +
      `<span>${chip(seedLetter)} is…</span>` +
      (locked.length ? `<label class="ca-check"><input type="checkbox" data-gp-showlocked${showLocked ? ' checked' : ''}> show the ${locked.length} you haven’t unlocked</label>` : '') +
      '</div>' +
      '<div class="ca-gseed-opts">' +
      `<button type="button" class="ca-gseed-opt ca-gseed-none${map[seedLetter] ? '' : ' on'}" data-gp-seedpick="">${I('close', 14)}<span>nothing</span></button>` +
      shown.map(opt).join('') +
      '</div>' +
      '</div>' +
      (it.live ? '<div class="ca-hint">Picking a seed makes a seed set of yours with it.</div>' : '')
    );
  }

  function detailHtml() {
    const it = pickedItem(slot);
    const body = slot === 'template' ? templateBody(it) : slot === 'seeds' ? seedsBody(it) : codeBody(slot, it);
    return (
      `<div class="ca-gdetail" data-gp-detail="${slot}">` +
      detailHead(slot, it) +
      (it.desc ? `<div class="ca-hint">${esc(it.desc)}</div>` : '') +
      (rulesError ? `<div class="ca-editor-error">${esc(rulesError)}</div>` : '') +
      body +
      '</div>'
    );
  }

  function gardenerCard() {
    return (
      `<div class="ca-card ca-editor2 ca-gardener" data-gp-rules data-edits="${G().GARDENER}">` +
      C().cardHead('Auto-gardener', 'bolt', `<div class="ca-card-meta"><span class="ca-hint">also on the ${C().link('Macros', 'clickers')} page</span></div>`) +
      `<div class="ca-list">${CA.UI.MacrosPage.row(CA.Macros.get(G().GARDENER))}</div>` +
      profileBar() +
      `<div class="ca-gslots" data-gp-slots>${SLOTS.map(slotHtml).join('')}</div>` +
      detailHtml() +
      '<div class="ca-card-note" data-gp-last></div>' +
      '</div>'
    );
  }

  /** What the last pass did, under the code (and its lines lit in the gutter). */
  function syncRules() {
    if (slot !== 'gardener' && slot !== 'soil') return;
    const it = pickedItem(slot);
    const lp = slot === 'gardener' ? G().lastPass() : G().soilPass();
    const on = CA.Macros.isOn(G().GARDENER);
    const live = on && lp && (slot === 'gardener' ? lp.gardener : lp.soil) === it.id && !isDirty(slot, it);
    CE().setLive(
      root,
      'garden',
      live
        ? {
            lines: lp.lines,
            html:
              `<div class="ca-code-live-head">${I('play', 11)} last ${slot === 'soil' ? 'run' : 'pass'} · ${CA.UI.Plot.fmt.span(Math.max(0, (Date.now() - lp.t) / 1000))} ago</div>` +
              (lp.error ? `<div class="ca-code-live-at">${esc(lp.error)}</div>` : '') +
              lp.at.map((a) => `<div class="ca-code-live-at">${esc(a)}</div>`).join('') +
              (lp.trace.length ? lp.trace.map((x) => `<div class="ca-code-live-tr">${esc(x.text)}</div>`).join('') : '<div class="ca-code-live-tr">nothing to do</div>'),
          }
        : null
    );
  }

  /** The detail's actions: save, discard, save as new, revert, delete. */
  function detailAct(act) {
    const layer = slot;
    const it = pickedItem(layer);
    const data = dataOf(layer, it);
    rulesError = '';
    if ((act === 'save' || act === 'new') && data.rules != null) {
      const { errors } = G().compileRules(data.rules);
      if (errors.length) {
        rulesError = `Not saved — line ${errors[0].line}: ${errors[0].message}`;
        return;
      }
    }
    const noun = L().LAYERS[layer].noun;
    if (act === 'save') {
      if (it.live) return;
      L().set(layer, it.id, data);
      draft = null;
      CA.Util.notify(`${noun[0].toUpperCase()}${noun.slice(1)} saved`, `“${esc(it.name)}” — the auto-gardener follows it from its next pass.`, CA.ICON, 3);
    } else if (act === 'new') {
      const id = L().add(layer, `${it.name.replace(/ \(copy\)$/, '')}${it.live ? '' : ' (copy)'}`, data);
      draft = null;
      L().pick(layer, id);
      CA.Util.notify(`${noun[0].toUpperCase()}${noun.slice(1)} saved`, `“${esc(L().get(layer, id).name)}” — yours to change.`, CA.ICON, 3);
    } else if (act === 'recapture') G().captureCurrent();
    else if (act === 'discard') draft = null;
    else if (act === 'revert') {
      L().set(layer, it.id, null);
      draft = null;
    } else if (act === 'delete') {
      L().remove(layer, it.id);
      draft = null;
    }
  }

  function profileAct(act) {
    const p = pickedItem('profile');
    if (act === 'save') L().saveProfile();
    else if (act === 'new') L().newProfile(`${p.name.replace(/ \(copy\)$/, '')} (copy)`);
    else if (act === 'snapshot') {
      const made = G().snapshot();
      if (made) CA.Util.notify('Garden profile saved', `“${esc(made.name)}” — what’s planted, as a template and seeds, with the gardener and soil rule you have picked.`, CA.ICON, 3);
    } else if (act === 'revert') {
      L().set('profile', p.id, null);
      L().loadProfile(p.id);
    } else if (act === 'delete') L().remove('profile', p.id);
  }

  /** A template cell painted, cleared or filled (into the draft). */
  function templateAct(cell, act) {
    const it = pickedItem('template');
    if (it.live) return;
    const d = JSON.parse(JSON.stringify(dataOf('template', it)));
    if (cell) {
      const [x, y] = cell.split(',').map(Number);
      d.plot[y][x] = d.plot[y][x] === brush ? null : brush || null;
    } else if (act === 'clear') d.plot = d.plot.map((r) => r.map(() => null));
    else if (act === 'fill') d.plot = d.plot.map((r) => r.map(() => brush || null));
    draft = { layer: 'template', id: it.id, data: d };
  }

  function lastText() {
    const l = G().last();
    if (!l.at) return 'Pick a profile — or a gardener, soil rule, template and seeds — then switch it on.';
    const parts = [];
    if (l.planted) parts.push(`planted ${l.planted}`);
    if (l.harvested) parts.push(`harvested ${l.harvested}`);
    if (l.saved) parts.push(`harvested ${l.saved} about to die`);
    if (l.unlocked) parts.push(`harvested ${l.unlocked} new seed${l.unlocked === 1 ? '' : 's'}`);
    if (l.soil) parts.push('changed the soil');
    return `Last: ${parts.join(', ')} — ${CA.UI.Plot.fmt.span((Date.now() - l.at) / 1000)} ago.`;
  }

  // ---- page ------------------------------------------------------------------------------

  function html() {
    if (!G().minigame())
      return (
        '<div class="ca-card ca-card-note-only">' +
        C().cardHead('Garden', 'leaf') +
        '<div class="ca-card-note">The Garden opens once you have a level-1 Farm (spend a sugar lump on it). The auto-gardener and its profiles will be here.</div>' +
        '</div>'
      );
    return `<div class="ca-garden-row">${gardenCard()}${plot.html()}</div>` + effectsPlot.html() + gardenerCard();
  }

  let liveSig = ''; // the Current garden as last shown (the slots follow it while the page is open)
  /** The Current garden changed (your clicks, Take it again): the slots, and a live item's detail, show it. */
  function syncLive() {
    const sig = JSON.stringify(G().currentPlot());
    if (sig === liveSig) return;
    const first = !liveSig;
    liveSig = sig;
    if (first) return;
    const slots = root.querySelector('[data-gp-slots]');
    if (slots) CA.UI.Dom.morph(slots, SLOTS.map(slotHtml).join(''));
    const detail = root.querySelector('[data-gp-detail]');
    if (detail && (slot === 'template' || slot === 'seeds') && pickedItem(slot).live) {
      const tmp = document.createElement('div');
      tmp.innerHTML = detailHtml();
      detail.replaceWith(tmp.firstChild);
    }
  }

  function sync() {
    if (!root || !root.isConnected) return;
    const v = G().view();
    if (!v) return;
    const odds = oddsNow(v.M);
    const plot = root.querySelector('[data-gp-plot]');
    if (plot) CA.UI.Dom.morph(plot, plotHtml(v, odds));
    const stats = root.querySelector('[data-gp-stats]');
    if (stats) CA.UI.Dom.morph(stats, statsHtml(v, odds));
    const pill = root.querySelector('[data-gp-profile]');
    if (pill) pill.textContent = `layout: ${v.profile.name}`;
    const last = root.querySelector('[data-gp-last]');
    if (last) last.textContent = lastText();
    syncLive();
    syncRules();
    CA.UI.MacrosPage.sync(root);
  }

  /** A seed picked for the chosen letter (on a live set: a seed set of yours with it, picked). */
  function pickSeed(key) {
    const it = pickedItem('seeds');
    const map = { ...dataOf('seeds', it).map };
    if (key) map[seedLetter] = key;
    else delete map[seedLetter];
    if (it.live) {
      L().pick('seeds', L().add('seeds', `${it.name} (copy)`, { map }));
      draft = null;
    } else draft = { layer: 'seeds', id: it.id, data: { map } };
  }

  // ---- knobs: the code's variables as controls (ui/codeKnobs.js) -------------------------------

  /** The head follows the draft (Save lights up, "unsaved" shows) when it turns dirty or clean. */
  function swapHead(it, was) {
    if (was === isDirty(slot, it)) return;
    const head = root.querySelector('[data-gp-dhead]');
    const tmp = document.createElement('div');
    tmp.innerHTML = detailHead(slot, it);
    if (head && tmp.firstChild) head.replaceWith(tmp.firstChild);
  }
  /** The knobs follow the code. */
  function syncKnobs() {
    const kp = root && root.querySelector('[data-knobs]');
    if (!kp || (slot !== 'gardener' && slot !== 'soil')) return;
    const d = dataOf(slot, pickedItem(slot));
    CA.UI.Dom.morph(kp, CK().inner(d.rules, d.knobs, { open: knobOpen }));
    // an input you've moved shows its value, not its attribute: set them as the code has them
    kp.querySelectorAll('input[data-knob], input[data-knob-num]').forEach((el) => {
      if (el !== document.activeElement && el.value !== el.getAttribute('value')) el.value = el.getAttribute('value');
    });
  }
  /** A knob moved: its line of the code takes the value (into the draft, and the editor). */
  function knobSet(name, value) {
    const it = pickedItem(slot);
    const d = dataOf(slot, it);
    const was = isDirty(slot, it);
    const src = CK().setIn(d.rules, name, value);
    draft = { layer: slot, id: it.id, data: { ...d, rules: src } };
    const ta = root.querySelector('[data-code-ed="garden"] [data-code]');
    if (ta && ta.value !== src) {
      ta.value = src;
      CE().refresh(ta);
    }
    swapHead(it, was);
  }
  /** How a variable shows (null: as suits its value) — part of the algorithm, so into the draft. */
  function knobSpec(name, spec) {
    const it = pickedItem(slot);
    const d = dataOf(slot, it);
    const knobs = { ...(d.knobs || {}) };
    if (spec) knobs[name] = spec;
    else delete knobs[name];
    draft = { layer: slot, id: it.id, data: { ...d, knobs } };
  }
  /** A variable's spec as it stands (without the "custom" flag), to change one field of. */
  function specNow(name) {
    const d = dataOf(slot, pickedItem(slot));
    const v = CK().scan(d.rules).find((x) => x.name === name);
    if (!v) return null;
    const sp = { ...CK().specOf(v, d.knobs) };
    delete sp.custom;
    return sp;
  }
  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.knob) return;
    const d = dataOf(slot, pickedItem(slot));
    const v = CK().valueOf(el, d.rules, d.knobs);
    if (v == null) return;
    const num = root.querySelector(`[data-knob-num="${el.dataset.knob}"]`);
    if (num) num.value = el.value;
    knobSet(el.dataset.knob, v);
  }

  function onClick(e) {
    const t = e.target.closest(
      '[data-gp-slot],[data-gp-act],[data-gp-pact],[data-gp-cell],[data-gp-brush],[data-gp-tact],[data-gp-letter],[data-gp-seedpick],[data-knob-toggle],[data-knob-cfg],[data-knob-reset],[data-knob-unhide]'
    );
    if (!t || !root.contains(t)) return;
    e.stopPropagation();
    const d = t.dataset;
    if (d.gpSlot) {
      if (slot !== d.gpSlot) {
        rulesError = '';
        knobOpen = null;
      }
      slot = d.gpSlot;
    } else if (d.gpAct) {
      if ((d.gpAct === 'revert' || d.gpAct === 'delete') && !CA.UI.Dom.armed(t)) return;
      detailAct(d.gpAct);
    } else if (d.gpPact) {
      if ((d.gpPact === 'revert' || d.gpPact === 'delete') && !CA.UI.Dom.armed(t)) return;
      profileAct(d.gpPact);
    } else if (d.gpCell) templateAct(d.gpCell);
    else if ('gpBrush' in d) brush = d.gpBrush;
    else if (d.gpTact) templateAct(null, d.gpTact);
    else if (d.gpLetter) seedLetter = d.gpLetter;
    else if ('gpSeedpick' in d) pickSeed(d.gpSeedpick);
    else if (d.knobToggle) {
      const v = CK()
        .scan(dataOf(slot, pickedItem(slot)).rules)
        .find((x) => x.name === d.knobToggle);
      if (v) knobSet(v.name, !v.value);
    } else if (d.knobCfg) knobOpen = knobOpen === d.knobCfg ? null : d.knobCfg;
    else if (d.knobReset || d.knobUnhide) knobSpec(d.knobReset || d.knobUnhide, null);
    CA.Util.sound('snd/tick.mp3');
    CA.UI.Menu.render();
  }

  function onChange(e) {
    const el = e.target;
    const d = el.dataset || {};
    if (e.type !== 'change') return;
    if (d.gpPick) {
      L().pick(d.gpPick, el.value);
      draft = null;
      rulesError = '';
      knobOpen = null;
    } else if (d.gpIname) {
      L().rename(d.gpIname, L().picked(d.gpIname), el.value);
    } else if ('gpShowlocked' in d) showLocked = el.checked;
    else if (d.knobNum) {
      // a value typed in: into the code, and the slider (its range grows to take it)
      const src = dataOf(slot, pickedItem(slot));
      const v = CK().valueOf(el, src.rules, src.knobs);
      if (v == null) return;
      knobSet(d.knobNum, v);
      syncKnobs();
      return;
    } else if (d.knobKind) knobSpec(d.knobKind, { kind: el.value });
    else if (d.knobField) {
      const sp = specNow(d.knobOf);
      if (!sp) return;
      if (d.knobField === 'unit') sp.unit = el.value.trim();
      else if (el.value.trim() === '' || !Number.isFinite(Number(el.value))) delete sp[d.knobField];
      else sp[d.knobField] = Number(el.value) / (sp.kind === 'percent' ? 100 : 1);
      knobSpec(d.knobOf, sp);
    } else return;
    CA.UI.Menu.render();
  }

  function mount(el) {
    unmount();
    root = el;
    liveSig = '';
    life = CA.UI.Pages.scope(el).on('click', onClick).on('change', onChange).on('input', onInput);
    life.add(
      CE().bind(root, {
        onChange: (key, src) => {
          if (key !== 'garden' || (slot !== 'gardener' && slot !== 'soil')) return;
          const it = pickedItem(slot);
          const was = isDirty(slot, it);
          draft = { layer: slot, id: it.id, data: { ...dataOf(slot, it), rules: src } };
          // the Save button lights up (and the "unsaved" pill shows) on the first change; the knobs follow the code
          swapHead(it, was);
          syncKnobs();
        },
      })
    );
    if (G().minigame()) life.child(plot).child(effectsPlot);
    sync();
    life.every(SYNC_MS, sync);
  }

  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  // ---- charts: growth and effects ---------------------------------------------------------

  const H = () => CA.GardenHistory;
  const STAGE_COLORS = ['#6b8a52', '#8fc25e', '#b5ec6e', '#eaff8a'];
  const AXES = [
    { v: 'time', label: 'Time' },
    { v: 'ticks', label: 'Garden ticks' },
  ];
  const plantName = (key) => {
    const M = G().minigame();
    return (M && M.plants && M.plants[key] && M.plants[key].name) || key;
  };

  /** Index of the snapshot in force at `x` (positions in time order), from `from` on; -1 before the first. */
  function stateAt(pos, x, from) {
    let i = from;
    while (i + 1 < pos.length && pos[i + 1] <= x) i++;
    return i;
  }
  /**
   * Where things that happened at wall-clock time t sit on the chart's x axis: t itself, or with
   * "Active time" on, the recorder's active time then (the clock every chart uses). The garden's
   * own snapshots also carry an active-time stamp, but it was worked out on the side and can be
   * far off — before the recorder loaded, or across time the game was closed — so it isn't used.
   */
  const placeOf = (v) => (v.active && typeof v.xAt === 'function' ? (t) => v.xAt(t) : (t) => t);

  /**
   * The garden over the chart's window as bars, each with the snapshot in force: { x0, x1, c, e }.
   * Time axis: a bar per slot of the window (the garden as it was at the end of it — it only
   * changes at ticks, plantings and harvests). Ticks axis: a bar per garden tick, plus the x axis
   * for it (xAxis — ticks counted back from now).
   */
  function stateBars(v) {
    const place = placeOf(v);
    // Since last ascension: only this run's snapshots (the last run's garden was cleared)
    const all = v.runFrom > -Infinity ? H().list().filter((s) => place(s.t) >= v.runFrom) : H().list();
    if (!all.length) return { bars: [] };
    const pos = all.map((s) => place(s.t));
    if (v.opt('axis') !== 'ticks') {
      const bars = [];
      let i = -1;
      const start = Math.floor(v.x0 / v.bucket) * v.bucket;
      for (let x = start; x < v.x1; x += v.bucket) {
        const end = Math.min(x + v.bucket, v.x1);
        i = stateAt(pos, end, i);
        if (i < 0) continue;
        bars.push({ x0: Math.max(x, v.x0), x1: end, c: all[i].c, e: all[i].e || {} });
      }
      return { bars };
    }
    // garden ticks: which ticks fall in the window, and the snapshot in force in each
    const ticks = H().ticks();
    const inWin = ticks.filter((t) => place(t.t) >= v.x0 && place(t.t) <= v.x1);
    const firstSample = all.find((s, j) => pos[j] >= v.x0) || all[all.length - 1];
    const kEnd = v.live ? H().tickNow() : inWin.length ? inWin[inWin.length - 1].k : firstSample.k || 0;
    const kStart = Math.min(kEnd, inWin.length ? inWin[0].k - 1 : firstSample.k || 0);
    const bars = [];
    let i = -1;
    for (let n = kStart; n <= kEnd; n++) {
      while (i + 1 < all.length && (all[i + 1].k || 0) <= n) i++;
      if (i < 0) continue;
      bars.push({ x0: n, x1: n + 1, c: all[i].c, e: all[i].e || {}, tick: n });
    }
    const span = kEnd + 1 - kStart;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => span / s <= 7) || 10000;
    const labels = [];
    for (let n = kEnd - Math.floor((kEnd - kStart) / step) * step; n <= kEnd; n += step) labels.push({ x: n + 0.5, label: n === kEnd ? 'now' : `−${kEnd - n}` });
    const tickTime = (n) => {
      const t = ticks.find((x) => x.k === n);
      return t ? ` <span>${CA.UI.Plot.fmt.clock(t.t, true)}</span>` : '';
    };
    const xAxis = {
      x0: kStart,
      x1: kEnd + 1,
      labels,
      head: (bar) => (bar ? `${bar.tick === kEnd ? 'This tick' : `${kEnd - bar.tick} tick${kEnd - bar.tick === 1 ? '' : 's'} ago`}${tickTime(bar.tick)}` : 'Garden ticks'),
    };
    // a position on this axis back to the view's time (zooming into a stretch of ticks)
    const tickAt = (n) => {
      const x = ticks.find((tt) => tt.k === n);
      return x ? place(x.t) : null;
    };
    xAxis.timeAt = (x) => {
      const n = Math.floor(x);
      const a = tickAt(n);
      const b = n + 1 > kEnd ? v.x1 : tickAt(n + 1);
      const from = a == null ? v.x0 : a;
      const to = b == null ? v.x1 : b;
      return from + (to - from) * (x - n);
    };
    // things that happened at a time, placed in the tick they happened in
    xAxis.at = (t) => {
      let n = -Infinity; // before every tick: off the axis
      ticks.forEach((x) => x.t <= t && (n = x.k));
      return n + 0.5;
    };
    return { bars, xAxis };
  }

  /** Seed-unlock markers, on either axis. */
  function unlockMarkers(v, xAxis) {
    return CA.EventLog.list(['garden'])
      .map((ev) => ({ ev, x: xAxis ? xAxis.at(ev.t) : v.active ? ev.a : ev.t }))
      .filter((m) => (xAxis ? m.x >= xAxis.x0 && m.x <= xAxis.x1 : m.x >= v.x0 && m.x <= v.x1))
      .map(({ ev, x }) => ({
        x,
        color: '#ffe36a',
        tip: () => `<div class="ca-tip-head">${esc(ev.title)}<span>${CA.UI.Plot.fmt.clock(ev.t, true)}</span></div>`,
      }));
  }

  const axisChoice = { key: 'axis', label: 'X axis', options: AXES, default: 'time' };

  const pctFmt = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.round(Math.abs(v) * 10) / 10}%`;

  /** What the Chart widget can show over the garden's charts (its Stats): each plant effect now, then the plants. */
  function gardenNumbers() {
    const M = () => G().minigame();
    const counts = () => (M() ? Object.entries(H().countsNow(M())) : []);
    const effect = (k) => () => (M() ? pctFmt((H().effectsNow(M())[k] || 0) * 100) : '—');
    return H()
      .EFFECTS.map((ef) => ({ v: ef.k, stat: `garden.${ef.k}`, value: effect(ef.k), page: 'garden', on: ef.k === 'goldenCookieFreq' }))
      .concat([
        { v: 'plants', stat: 'garden.plants', value: () => (M() ? String(counts().reduce((a, [, n]) => a + n, 0)) : '—'), page: 'garden' },
        { v: 'mature', stat: 'garden.mature', value: () => (M() ? String(counts().reduce((a, [k, n]) => a + (k.endsWith(':3') ? n : 0), 0)) : '—'), page: 'garden' },
        { v: 'nextTick', stat: 'garden.nextTick', value: () => (M() && M().nextStep ? CA.Format.span(Math.max(0, (M().nextStep - Date.now()) / 1000)) : '—'), page: 'garden' },
      ]);
  }

  function createPlots() {
    plot = CA.UI.Plot.create({
      id: 'garden',
      title: 'Growth',
      widget: true, // its ☆: a Chart widget on the left panel
      widgetName: 'Garden growth',
      widgetGroup: 'Garden',
      numbers: gardenNumbers(), // the garden's statistics, for the Chart widget (both charts share them)
      icon: 'leaf',
      height: 210,
      windows: [3600, 6 * 3600, 86400, 3 * 86400, 0],
      window: 6 * 3600,
      smooth: false,
      stacked: true,
      choices: [
        {
          key: 'by',
          label: 'Show',
          options: [
            { v: 'both', label: 'Seed × stage' },
            { v: 'seed', label: 'Seeds' },
            { v: 'stage', label: 'Stages' },
          ],
          default: 'both',
        },
        axisChoice,
      ],
      fmt: (v) => CA.UI.Plot.fmt.beautify(v, 0),
      tipFmt: (v) => String(Math.round(v * 10) / 10),
      totalLabel: 'Plants',
      build(v) {
        const by = v.opt('by') || 'both';
        const { bars: raw, xAxis } = stateBars(v);
        const totals = {}; // seed → plant-slots shown, to put the biggest at the bottom
        raw.forEach((b) => Object.keys(b.c).forEach((kk) => (totals[kk.split(':')[0]] = (totals[kk.split(':')[0]] || 0) + b.c[kk])));
        const seeds = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
        let series;
        let partOf;
        if (by === 'stage') {
          series = [3, 2, 1, 0].map((s) => ({ key: `stage:${s}`, name: H().STAGES[s][0].toUpperCase() + H().STAGES[s].slice(1), color: STAGE_COLORS[s], type: 'bar' }));
          partOf = (kk) => `stage:${kk.split(':')[1]}`;
        } else if (by === 'seed') {
          series = seeds.map((s) => ({ key: s, name: plantName(s), color: H().colorOf(s), type: 'bar' }));
          partOf = (kk) => kk.split(':')[0];
        } else {
          // each seed's stages together, mature at the bottom: bars "ripen" upwards
          series = [].concat(
            ...seeds.map((s) =>
              [3, 2, 1, 0].map((st) => ({
                key: `${s}:${st}`,
                name: `${plantName(s)} (${H().STAGES[st]})`,
                color: H().shade(s, st),
                type: 'bar',
                merge: { id: s, name: plantName(s), label: H().STAGES[st], order: st },
              }))
            )
          );
          partOf = (kk) => kk;
        }
        const bars = raw.map((b) => {
          const parts = {};
          Object.keys(b.c).forEach((kk) => {
            const p = partOf(kk);
            parts[p] = (parts[p] || 0) + b.c[kk];
          });
          return { x0: b.x0, x1: b.x1, parts, tick: b.tick };
        });
        const used = new Set([].concat(...bars.map((b) => Object.keys(b.parts))));
        series = series.filter((s) => used.has(s.key));
        const legend =
          by === 'stage'
            ? series
            : seeds.filter((s) => series.some((x) => x.key.split(':')[0] === s)).map((s) => ({ name: plantName(s), color: H().colorOf(s) }));
        return {
          series,
          bars,
          xAxis,
          legend,
          legendExtra:
            by === 'both'
              ? '<span class="ca-legend-item ca-legend-stages">darker = younger: ' +
                H()
                  .STAGES.map((st, i) => `<i class="ca-sw" style="background:${H().shade('bakerWheat', i)}"></i>${st}`)
                  .join(' ') +
                '</span>'
              : '',
          markers: unlockMarkers(v, xAxis),
          empty: 'Recording your garden — the chart fills in as it grows (a snapshot each time the plot changes).',
        };
      },
      stats() {
        const M = G().minigame();
        if (!M) return '';
        const { tile, beautify } = CA.UI.Plot.fmt;
        const c = H().countsNow(M);
        const n = Object.values(c).reduce((a, b) => a + b, 0);
        const mature = Object.keys(c)
          .filter((kk) => kk.endsWith(':3'))
          .reduce((a, kk) => a + c[kk], 0);
        const unlocked = Object.values(M.plants || {}).filter((p) => p.unlocked).length;
        return (
          tile('Plants now', String(n), `${mature} mature`) +
          tile('Seeds unlocked', `${unlocked} / ${Object.keys(M.plants || {}).length}`) +
          tile('Harvests', beautify(M.harvests || 0, 0), `${beautify(M.harvestsTotal || 0, 0)} in total`)
        );
      },
    });

    effectsPlot = CA.UI.Plot.create({
      id: 'gardenEffects',
      settingsOf: 'garden', // same window and x axis as the growth chart
      title: 'Effects',
      widget: true,
      widgetName: 'Garden effects',
      widgetGroup: 'Garden',
      icon: 'sparkle',
      height: 190,
      windows: [3600, 6 * 3600, 86400, 3 * 86400, 0],
      window: 6 * 3600,
      smooth: false,
      choices: [axisChoice],
      fmt: pctFmt,
      tipFmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100) / 100}%`,
      build(v) {
        const { bars, xAxis } = stateBars(v);
        const used = H().EFFECTS.filter((ef) => bars.some((b) => b.e[ef.k]));
        const lines = {};
        used.forEach((ef) => {
          // steps: the value holds from one snapshot to the next
          lines[ef.k] = [].concat(...bars.map((b) => [{ x: b.x0, v: (b.e[ef.k] || 0) * 100 }, { x: b.x1, v: (b.e[ef.k] || 0) * 100 }]));
        });
        return {
          series: used.map((ef) => ({ key: ef.k, name: ef.rev ? `${ef.n} (lower is better)` : ef.n, color: ef.color, type: 'line', width: 1.8 })),
          lines,
          xAxis,
          markers: unlockMarkers(v, xAxis),
          zero: true,
          empty: 'No plant effects in this window — plant something, or wait for the garden to be recorded.',
        };
      },
      stats() {
        const M = G().minigame();
        if (!M) return '';
        const { tile } = CA.UI.Plot.fmt;
        const e = H().effectsNow(M);
        const top = H()
          .EFFECTS.filter((ef) => e[ef.k])
          .sort((a, b) => Math.abs(e[b.k]) - Math.abs(e[a.k]))
          .slice(0, 3);
        if (!top.length) return tile('Effects now', 'none', M.freeze ? 'the garden is frozen' : 'nothing planted gives any');
        return top.map((ef) => tile(ef.n, pctFmt(e[ef.k] * 100))).join('');
      },
    });
  }

  function init() {
    createPlots();
    CA.UI.Pages.register({ id: 'garden', label: 'Garden', icon: 'leaf', order: 30, group: 'minigames', html, mount, unmount, tick: sync });
    // a code card's link leaving an unsaved gardener / soil rule (ui/codeEditor.js): asked about first
    CA.UI.CodeEditor.guard('garden', {
      dirty: () => !!draft && isDirty(draft.layer, pickedItem(draft.layer)),
      name: () => (draft ? pickedItem(draft.layer).name : 'Garden'),
      leave(how) {
        const back = () => CA.UI.Menu.openPage('garden');
        if (how === 'save' && draft) {
          slot = draft.layer;
          detailAct('save');
          if (draft) return { error: rulesError || 'It couldn’t be saved.' };
        } else if (how === 'discard') draft = null;
        return { back };
      },
    });
  }

  return { init, sync };
})();
