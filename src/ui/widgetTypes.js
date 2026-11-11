// The built-in widget types (ui/widgets.js is the engine that places, drags, sizes and saves them).
//
//   macro      one per ★ favorite macro: a round icon button (on/off or run); name on hover
//   status     "Running now" as a status bar: an icon per running macro, details on hover
//   stats      Quick stats — you pick which (see STATS below)
//   events     the latest events — how many and which types; as many of these as you like
//   chart      a page's chart on the left panel (its ☆ — the Garden's growth and effects): a live copy
//              of it, sharing the page chart's window and choices (ui/plot.js mini())
//   income     the Stats page's Actual income chart, the same way (its ☆ on Stats → Actual income)
//   grimoire / garden / market / pantheon
//              one compact round widget per minigame: a ring for its timer (magic, next tick,
//              next worship swap), a short label under it, details on hover; click to open it
//
// A type can declare `settings` — fields the widget settings editor (Widgets page) shows for it:
//   { key, label, type: 'number' | 'multi', min, max, default, options: () => [{ v, label, icon, color }] }

CA.UI = CA.UI || {};

CA.UI.WidgetTypes = (() => {
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.UI.Plot.fmt;
  const HOT_MS = 1500;

  // ---- macro buttons ------------------------------------------------------------------------

  /** "20/s", "3/min", "1 per 12m" — how often a macro has been doing things lately. */
  function rateText(r) {
    if (r >= 1) return `${r >= 10 ? Math.round(r) : r.toFixed(1)}/s`;
    if (r * 60 >= 1) return `${Math.round(r * 60)}/min`;
    return `1 per ${F().span(1 / r)}`;
  }

  /**
   * For a once macro that casts spells: whether there's magic for all of them right now
   * ('can' / 'cant'), or '' when it casts none (or the Grimoire isn't open).
   */
  function spellState(m) {
    if (m.mode !== 'once') return '';
    const keys = CA.Macros.stepsOf(m).filter((s) => s.action === 'spell.cast').map((s) => s.params && s.params.spell);
    const mg = keys.length && CA.Grimoire.magicNow();
    if (!mg) return '';
    const cost = CA.Grimoire.spells()
      .filter((s) => keys.includes(s.key))
      .reduce((sum, s) => sum + (Number.isFinite(s.cost) ? s.cost : Infinity), 0);
    return mg.magic >= cost ? 'can' : 'cant';
  }

  /**
   * Whether a macro's button could do something right now: { cls: 'can' | 'cant', text } — spells
   * by magic, others through their first action's ready() (the buying macros: can the next
   * purchase be afforded). Null when the macro doesn't say.
   */
  function readyState(m) {
    const spell = spellState(m);
    if (spell) return { cls: spell, text: spell === 'can' ? 'enough magic' : 'not enough magic yet' };
    let r = null;
    if (m.readiness) {
      // a built-in written as code: its own (with its inputs)
      try {
        r = m.readiness(CA.Macros.inputsOf(m));
      } catch (e) {
        r = null;
      }
      return r ? { cls: r.ok ? 'can' : 'cant', text: r.text || '', upgrade: r.upgrade || '' } : null;
    }
    const step = CA.Macros.stepsOf(m)[0];
    const a = step && CA.Actions.get(step.action);
    if (!a || typeof a.ready !== 'function') return null;
    try {
      r = a.ready(CA.Actions.paramsFor(step.action, step.params));
    } catch (e) {
      r = null;
    }
    return r ? { cls: r.ok ? 'can' : 'cant', text: r.text || '', upgrade: r.upgrade || '' } : null;
  }

  function macroHtml(inst) {
    const m = CA.Macros.get(inst.macro);
    if (!m) return '';
    const on = CA.Macros.isOn(m.id);
    const key = CA.Settings.getHotkey(`macro.${m.id}`);
    const state = m.mode === 'once' ? 'click to run' : on ? 'on' : 'off';
    // the ring around the button: thicker and warmer the more it has been doing lately
    const heat = CA.Macros.activityLevel(m.id);
    const rate = CA.Macros.rate(m.id);
    const ready = readyState(m);
    return (
      `<button type="button" class="ca-wb${on ? ' on' : ''}${m.mode === 'once' ? ' once' : ''}${ready ? ` spell-${ready.cls}` : ''}" data-w-trigger="${esc(m.id)}" aria-label="${esc(m.name)}">` +
      `<span class="ca-wb-heat h${heat}"></span>${CA.UI.MacrosPage.icon(m, true)}</button>` +
      `<span class="ca-wb-label ca-wt"><b>${esc(m.name)}</b><em class="${on ? 'on' : ''}">${state}${key ? ` · ${esc(CA.Hotkeys.format(key))}` : ''}</em>` +
      (heat ? `<em>lately ${rateText(rate)}</em>` : '') +
      (ready && ready.text ? `<em class="${ready.cls === 'can' ? 'on' : 'off'}">${CA.UI.C.withUpgrade(ready.text, ready.upgrade)}</em>` : '') +
      (m.shift ? `<em class="${CA.Macros.shiftValue(m.id) ? '' : 'off'}">${esc(CA.Macros.shiftValue(m.id) ? m.shift.on : m.shift.off)} · shift-click to switch</em>` : '') +
      '</span>'
    );
  }

  // ---- running now ---------------------------------------------------------------------------

  function statusPop(m) {
    const st = CA.Macros.status(m.id);
    const { beautify, span } = F();
    let h =
      '<span class="ca-wpop ca-wt">' +
      `<span class="ca-wpop-head">${CA.UI.MacrosPage.icon(m, true)}<b>${esc(m.name)}</b></span>` +
      `<span class="ca-wpop-sub">${esc(CA.Macros.triggerText(m))} · on for ${span((Date.now() - CA.Macros.since(m.id)) / 1000)}</span>`;
    CA.Macros.stepsOf(m).forEach((step, i) => {
      const s = (st && st.steps[i]) || {};
      const a = CA.Actions.get(step.action) || {};
      const hot = s.lastAt && Date.now() - s.lastAt < HOT_MS;
      const val = s.error ? esc(s.error) : `${beautify(s.total || 0, 0)}${a.unit ? ' ' + esc(a.unit) : ''} · ${s.lastAt ? `${span((Date.now() - s.lastAt) / 1000)} ago` : 'nothing yet'}`;
      h += `<span class="ca-wpop-row${hot ? ' hot' : ''}${s.error ? ' err' : ''}">${I(a.icon || 'close', 11)}<span class="ca-wpop-name">${esc(CA.Actions.describe(step))}</span><span class="ca-wpop-val">${val}</span></span>`;
    });
    return h + '</span>';
  }

  function statusHtml() {
    const ids = CA.Macros.runningIds();
    let h = `<span class="ca-wbar-lead">${I('play', 11)}</span>`;
    if (!ids.length) return `${h}<span class="ca-wbar-idle ca-wt">idle</span>`;
    ids.forEach((id) => {
      const m = CA.Macros.get(id);
      if (!m) return;
      const st = CA.Macros.status(id);
      const hot = st && st.steps.some((s) => s.lastAt && Date.now() - s.lastAt < HOT_MS);
      const err = st && st.steps.some((s) => s.error);
      h += `<span class="ca-wbar-item${hot ? ' hot' : ''}${err ? ' err' : ''}" data-w-open="clickers" data-pop aria-label="${esc(m.name)}">${CA.UI.MacrosPage.icon(m, true)}${statusPop(m)}</span>`;
    });
    return h;
  }

  // ---- quick stats ------------------------------------------------------------------------------

  // totals counted with the game's own rules (the same ones behind UpgradesOwned / AchievementsOwned);
  // UpgradesById / AchievementsById are plain objects keyed by id, not arrays
  let upTotal = 0;
  let achTotal = 0;
  function upgradesTotal() {
    if (!upTotal && Game.UpgradesById && Game.CountsAsUpgradeOwned) upTotal = Object.values(Game.UpgradesById).filter((u) => u && Game.CountsAsUpgradeOwned(u.pool)).length;
    return upTotal;
  }
  function achievementsTotal() {
    if (!achTotal && Game.AchievementsById && Game.CountsAsAchievementOwned) achTotal = Object.values(Game.AchievementsById).filter((a) => a && Game.CountsAsAchievementOwned(a.pool)).length;
    return achTotal;
  }

  const lastFrame = () => {
    const fr = CA.Recorder.frames();
    return fr[fr.length - 1];
  };
  const allTime = () => (Game.cookiesReset || 0) + (Game.cookiesEarned || 0);
  const count = (owned, total) => (Number.isFinite(owned) ? `${F().beautify(owned, 0)}${total ? ` <em>/ ${F().beautify(total, 0)}</em>` : ''}` : '—');
  const perS = (v) => (Number.isFinite(v) ? `${F().beautify(v)}/s` : '—');

  /** Every stat Quick stats can show, in display order. */
  const STATS = [
    { id: 'cpsClick', label: 'CpS + clicking', value: () => { const f = lastFrame(); return f ? perS((f.cps || 0) + (f.click || 0)) : '—'; } },
    { id: 'cps', label: 'CpS', value: () => perS(Game.cookiesPs) },
    { id: 'actual', label: 'Actual income', value: () => { const r = CA.Recorder.recent(60); return r ? `${perS(r.actual)} <em>last min</em>` : '—'; } },
    { id: 'clickRate', label: 'Clicks / second', value: () => { const r = CA.Recorder.recent(10); return r && Number.isFinite(r.clickRate) ? r.clickRate.toFixed(1) : '—'; } },
    { id: 'bank', label: 'Bank', value: () => F().beautify(Game.cookies || 0) },
    { id: 'runStarted', label: 'Run started', value: () => (Game.startDate ? `${F().span((Date.now() - Game.startDate) / 1000)} <em>ago</em>` : '—') },
    { id: 'upgrades', label: 'Upgrades', value: () => count(Game.UpgradesOwned, upgradesTotal()) },
    { id: 'buildings', label: 'Buildings', value: () => count(Game.BuildingsOwned) },
    { id: 'prestige', label: 'Prestige level', value: () => `${F().beautify(Game.prestige || 0, 0)} <em>(max ${F().beautify(Math.floor(Game.HowMuchPrestige(allTime())), 0)})</em>` },
    { id: 'prestigeGain', label: 'Prestige this run', value: () => `+${F().beautify(Math.floor(Game.HowMuchPrestige(allTime())) - (Game.prestige || 0), 0)}` },
    {
      id: 'nextLevel',
      label: 'Next level in',
      value: () => {
        const lvl = Math.floor(Game.HowMuchPrestige(allTime()));
        const need = typeof Game.HowManyCookiesReset === 'function' ? Game.HowManyCookiesReset(lvl + 1) - allTime() : NaN;
        const r = CA.Recorder.recent(60);
        return r && r.actual > 0 && need > 0 ? F().span(need / r.actual) : '—';
      },
    },
    { id: 'chips', label: 'Heavenly chips', value: () => F().beautify(Game.heavenlyChips || 0, 0) },
    { id: 'achievements', label: 'Achievements', value: () => count(Game.AchievementsOwned, achievementsTotal()) },
    { id: 'lumps', label: 'Sugar lumps', value: () => count(Game.lumps) },
    { id: 'goldenClicks', label: 'Golden cookies clicked', value: () => count(Game.goldenClicks) },
    { id: 'wrinklers', label: 'Wrinklers', value: () => count((Game.wrinklers || []).filter((w) => w.phase > 0).length) },
    { id: 'allTime', label: 'All time baked', value: () => F().beautify(allTime()) },
  ];
  const DEFAULT_STATS = ['cpsClick', 'actual', 'runStarted', 'upgrades', 'prestige', 'achievements', 'allTime'];

  const statValue = (s) => {
    try {
      return s.value();
    } catch (e) {
      return '—';
    }
  };
  function statsHtml(inst) {
    const chosen = new Set(Array.isArray(inst.stats) && inst.stats.length ? inst.stats : DEFAULT_STATS);
    return STATS.filter((s) => chosen.has(s.id))
      .map((s) => `<div class="ca-w-stat"><span>${s.label}</span><b>${statValue(s)}</b></div>`)
      .join('');
  }
  // its settings' tiles (ui/widgets.js): each number's value now, as its row shows it
  const statSample = (s) => () => `<div class="ca-w-stat"><b>${statValue(s)}</b></div>`;

  // ---- latest events ------------------------------------------------------------------------

  const DEFAULT_EVENTS = 8;
  const eventCount = (inst) => Math.max(1, Math.min(200, Math.round(inst.count || DEFAULT_EVENTS)));
  // its settings' tiles (ui/widgets.js): the newest event of each type, as its row shows it
  const typeSample = (k) => () => {
    const e = CA.EventLog.list([k]).slice(-1)[0];
    return e ? `<div class="ca-w-events">${CA.UI.EventsPage.rowHtml(e)}</div>` : '<div class="ca-w-empty">None yet.</div>';
  };

  function eventsHtml(inst) {
    const kinds = Array.isArray(inst.types) && inst.types.length ? inst.types : null;
    const list = CA.EventLog.list(kinds).slice(-eventCount(inst)).reverse();
    if (!list.length) return `<div class="ca-w-empty">${kinds ? 'No events of the chosen types yet.' : 'Nothing has happened yet.'}</div>`;
    return `<div class="ca-w-events">${list.map((e) => CA.UI.EventsPage.rowHtml(e)).join('')}</div>`;
  }

  // ---- minigames: compact round widgets ---------------------------------------------------------

  /** Opens a building's minigame in the game and scrolls to it. */
  function openMinigame(building) {
    const b = Game.Objects && Game.Objects[building];
    if (!b || !b.minigame || typeof b.switchMinigame !== 'function') {
      CA.Util.notify(building, 'This minigame isn’t unlocked yet (the building needs level 1 — a sugar lump).', CA.ICON, 3);
      return;
    }
    // the building rows are hidden while a menu (ours, Stats, Options…) is open: close it first
    if (Game.onMenu && typeof Game.ShowMenu === 'function') Game.ShowMenu(Game.onMenu);
    if (!b.onMinigame) b.switchMinigame(1);
    // after the rows are back on screen: the minigame sits at the top of its building's row
    // scroll only the middle panel's own scroll area (scrollIntoView would also shove the whole
    // page past the screen's edge), clamped to what it can scroll
    setTimeout(() => CA.Util.scrollInPanel(document.getElementById(`row${b.id}`), 'start'), 50);
  }

  const RING_R = 19;
  const RING_C = 2 * Math.PI * RING_R;

  /**
   * One round widget: a ring filled to `frac`, an icon in the middle, a short label under it, and
   * a styled popup (rows of [label, value]) on hover. Clicking opens `building`'s minigame.
   */
  function orb({ theme, building, page, icon, frac, label, extra, pop, mark, ready }) {
    const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
    return (
      `<div class="ca-orb ca-orb-${theme}${ready ? ' ready' : ''}" ${page ? `data-w-open="${esc(page)}"` : `data-w-open-mg="${esc(building)}"`} data-pop>` +
      '<svg class="ca-orb-ring" viewBox="0 0 44 44" aria-hidden="true">' +
      `<circle class="ca-orb-track" cx="22" cy="22" r="${RING_R}"/>` +
      `<circle class="ca-orb-fill" cx="22" cy="22" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${(RING_C * (1 - f)).toFixed(2)}"/>` +
      // a tick on the ring where a target sits (the Grimoire's chosen amount of magic)
      (Number.isFinite(mark) ? `<circle class="ca-orb-mark" cx="22" cy="22" r="${RING_R}" stroke-dasharray="1.6 ${RING_C.toFixed(2)}" stroke-dashoffset="${(-RING_C * mark + 0.8).toFixed(2)}"/>` : '') +
      '</svg>' +
      `<span class="ca-orb-ico">${icon}</span>` +
      (extra || '') +
      `<span class="ca-orb-label ca-wt">${label}</span>` +
      `<span class="ca-wpop ca-orb-pop ca-wt">${pop.map(([k, v]) => (k === null ? `<span class="ca-wpop-head">${v}</span>` : `<span class="ca-wpop-row"><span class="ca-wpop-name">${k}</span><span class="ca-wpop-val">${v}</span></span>`)).join('')}</span>` +
      '</div>'
    );
  }

  const lockedOrb = (theme, building, icon, name) =>
    orb({ theme, building, icon: I(icon, 18), frac: 0, label: 'locked', pop: [[null, `<b>${name}</b>`], ['', 'not unlocked yet']] });

  /** What the Grimoire widget counts down to: { magic, name } (full by default; its settings). */
  function grimoireTarget(inst, mg) {
    const t = inst.target || 'full';
    if (t === 'custom') {
      const n = Math.max(1, Number(inst.targetMagic) || 80);
      return { magic: n, name: `${n} magic` };
    }
    const s = t !== 'full' && CA.Grimoire.spells().find((x) => x.key === t);
    if (s && Number.isFinite(s.cost)) return { magic: s.cost, name: s.name };
    return { magic: mg.max, name: 'full' };
  }

  function grimoireHtml(inst) {
    const { span } = F();
    const mg = CA.Grimoire.magicNow();
    if (!mg) return lockedOrb('grimoire', 'Wizard tower', 'wizard', 'Grimoire');
    const target = grimoireTarget(inst, mg);
    const isFull = target.name === 'full';
    const wait = mg.magic >= target.magic ? 0 : CA.Grimoire.secondsUntil(target.magic);
    const ready = wait === 0;
    const label = ready ? (isFull ? 'full' : 'ready') : Number.isFinite(wait) ? span(wait) : 'never';
    return orb({
      theme: 'grimoire',
      building: 'Wizard tower',
      icon: I('wizard', 18),
      frac: mg.magic / mg.max,
      mark: isFull ? null : Math.min(1, target.magic / mg.max),
      ready: ready && !isFull,
      label,
      pop: [
        [null, '<b>Grimoire</b>'],
        ['Magic', `${Math.floor(mg.magic)} / ${Math.floor(mg.max)}`],
        ['Refill', mg.perSec ? `+${mg.perSec.toFixed(2)}/s` : 'full'],
      ].concat(
        isFull
          ? [['Full in', ready ? 'now' : label]]
          : [
              ['Target', `${esc(target.name)} (${Math.ceil(target.magic)})`],
              ['Ready in', ready ? 'now' : target.magic > mg.max ? 'over your maximum' : label],
              ['Full in', mg.fullIn === 0 ? 'now' : Number.isFinite(mg.fullIn) ? span(mg.fullIn) : '—'],
            ]
      ),
    });
  }

  const STAGES = ['bud', 'sprout', 'bloom', 'mature'];

  /** Plants per growth stage — the game's own thresholds: ⅓, ⅔ and all of a plant's maturity. */
  function gardenInfo() {
    const farm = Game.Objects && Game.Objects.Farm;
    const M = farm && farm.minigame;
    if (!M || !M.plot || !M.plantsById) return null;
    const counts = [0, 0, 0, 0];
    M.plot.forEach((rowTiles) =>
      (rowTiles || []).forEach((tile) => {
        if (!tile || !tile[0]) return;
        const me = M.plantsById[tile[0] - 1];
        if (!me) return;
        const age = tile[1];
        counts[age >= me.mature ? 3 : age >= me.mature * 0.666 ? 2 : age >= me.mature * 0.333 ? 1 : 0]++;
      })
    );
    const next = M.nextStep ? Math.max(0, (M.nextStep - Date.now()) / 1000) : null;
    return { counts, next, step: M.stepT || 0 };
  }

  function gardenHtml() {
    const { span } = F();
    const g = gardenInfo();
    if (!g) return lockedOrb('garden', 'Farm', 'leaf', 'Garden');
    // four small dots under the ring, one per growth stage, each with its count
    const dots = `<span class="ca-orb-dots ca-wt">${STAGES.map((st, i) => `<span class="s${i}"><i></i>${g.counts[i]}</span>`).join('')}</span>`;
    return orb({
      theme: 'garden',
      building: 'Farm',
      icon: I('leaf', 18),
      frac: g.next != null && g.step ? 1 - g.next / g.step : 0,
      label: g.next == null ? '—' : span(g.next),
      extra: dots,
      pop: [[null, '<b>Garden</b>']].concat(STAGES.map((st, i) => [st[0].toUpperCase() + st.slice(1), String(g.counts[i])]), [['Next tick', g.next == null ? '—' : span(g.next)]]),
    });
  }

  function marketHtml() {
    const { span, beautify } = F();
    const m = CA.Stocks.minigame();
    if (!m) return lockedOrb('market', 'Bank', 'stocks', 'Stock market');
    const owned = m.goodsById.filter((g) => g.stock > 0).length;
    const last = CA.Stocks.lastTick();
    const next = CA.Stocks.nextTickIn();
    const moved = last && last.held;
    const signed = (v, unit, d) => `${v < 0 ? '−' : '+'}${unit}${beautify(Math.abs(v), d)}`;
    return orb({
      theme: 'market',
      building: 'Bank',
      icon: I('stocks', 18),
      frac: next != null && m.secondsPerTick ? 1 - next / m.secondsPerTick : 0,
      label: moved ? `<span class="${last.dollars < 0 ? 'neg' : 'pos'}">${signed(last.dollars, '$', Math.abs(last.dollars) < 10 ? 2 : 0)}</span>` : `${owned} held`,
      pop: [
        [null, '<b>Stock market</b>'],
        ['Holding', `${owned} of ${m.goodsById.length} stocks`],
        ['Last tick', moved ? `${signed(last.dollars, '$', 2)} (${signed(last.cookies, '', 1)} cookies)` : 'no stocks held into it'],
        ['Next tick', next == null ? '—' : span(next)],
      ],
    });
  }

  /** The Pantheon (Temple minigame): the three slotted spirits and the next worship swap. */
  function pantheonInfo() {
    const temple = Game.Objects && Game.Objects.Temple;
    const M = temple && temple.minigame;
    if (!M || !Array.isArray(M.slot) || !M.godsById) return null;
    const gods = M.slot.map((id) => (id >= 0 ? M.godsById[id] : null));
    // main.js: a swap refills 1 h after the last one with 2 left, 4 h with 1, 16 h with 0
    const wait = M.swaps === 0 ? 16 * 3600 : M.swaps === 1 ? 4 * 3600 : 3600;
    const next = M.swaps < 3 ? Math.max(0, (M.swapT + wait * 1000 - Date.now()) / 1000) : null;
    return { gods, swaps: M.swaps, next, wait };
  }

  const SLOTS = ['Diamond', 'Ruby', 'Jade'];

  function pantheonHtml() {
    const { span } = F();
    const p = pantheonInfo();
    if (!p) return lockedOrb('pantheon', 'Temple', 'pantheon', 'Pantheon');
    const sprite = (g) =>
      g && g.icon
        ? `<i class="ca-orb-god" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-g.icon[0] * 48}px ${-g.icon[1] * 48}px"></i>`
        : '<i class="ca-orb-god empty"></i>';
    return orb({
      theme: 'pantheon',
      building: 'Temple',
      icon: I('pantheon', 18),
      frac: p.next == null ? 1 : 1 - p.next / p.wait,
      label: p.next == null ? `${p.swaps} swaps` : span(p.next),
      extra: `<span class="ca-orb-gods">${p.gods.map(sprite).join('')}</span>`,
      pop: [[null, '<b>Pantheon</b>']].concat(
        p.gods.map((g, i) => [SLOTS[i], g ? esc(g.name) : '<em>empty</em>']),
        [
          ['Swaps', `${p.swaps} / 3`],
          ['Next swap in', p.next == null ? 'all 3 ready' : span(p.next)],
        ]
      ),
    });
  }

  // ---- a page's charts, and their statistics --------------------------------------------------
  // Show (`stats`): Stats and/or the charts (the Garden's growth and effects), stacked; Stats (`nums`): the
  // charts' statistics you tick (CA.UI.Plot's `numbers`: each garden effect now, plants…); `legend` 'hide' (v3.46.0)
  // leaves out the legends under the charts. Before v3.42 it
  // showed one chart (`plot`, still what a ☆ sets): a widget saved without `stats` shows that one.

  const DEFAULT_PLOT = 'garden';
  const shownPlots = {}; // widget id → the charts it last drew (to let go of the ones it no longer shows)
  const plotOf = (inst) => (CA.UI.Plot.get(inst.plot) ? inst.plot : DEFAULT_PLOT);
  const chartPartsOf = (inst) => (Array.isArray(inst.stats) ? inst.stats : [plotOf(inst)]);
  const plotsOf = (inst) => chartPartsOf(inst).filter((v) => v !== 'numbers' && CA.UI.Plot.get(v));
  /** Every widgetable chart's statistics, each once. */
  function chartNumbers() {
    const seen = new Set();
    return [].concat(...CA.UI.Plot.widgetable().map((p) => p.numbers)).filter((n) => !seen.has(n.v) && seen.add(n.v));
  }
  const chartNumsOf = (inst) => (Array.isArray(inst.nums) ? inst.nums : chartNumbers().filter((n) => n.on).map((n) => n.v));
  const numCell = (n, val) => `<span data-tip="${esc(CA.StatInfo.desc(n.stat))}"${n.page ? ` data-w-open="${esc(n.page)}"` : ''}><em>${esc(CA.StatInfo.label(n.stat))}</em><b>${val}</b></span>`;

  function chartNumbersHtml(inst) {
    const on = new Set(chartNumsOf(inst));
    const cells = chartNumbers()
      .filter((n) => on.has(n.v))
      .map((n) => numCell(n, n.value()))
      .join('');
    return cells ? `<div class="ca-tl-nums">${cells}</div>` : '';
  }

  function chartHtml(inst) {
    const plots = plotsOf(inst);
    (shownPlots[inst.id] || []).filter((id) => !plots.includes(id)).forEach((id) => CA.UI.Plot.dropMini(id, inst.id));
    shownPlots[inst.id] = plots;
    let h = chartPartsOf(inst).includes('numbers') ? chartNumbersHtml(inst) || '<div class="ca-w-empty">None ticked under Stats.</div>' : '';
    h += plots
      .map((id) => {
        const p = CA.UI.Plot.mini(id, inst.id);
        return p ? p.html() : '<div class="ca-w-empty">This chart isn’t available.</div>';
      })
      .join('');
    return `<div class="ca-wcharts${plots.length > 1 ? ' two' : ''}${inst.legend === 'hide' ? ' no-legend' : ''}">${h || '<div class="ca-w-empty">Pick what to show in its settings.</div>'}</div>`;
  }
  /** After each refresh: draws each chart's copy into the widget (mounting it again after a re-render). */
  function chartLive(inst, body) {
    plotsOf(inst).forEach((id) => {
      const p = CA.UI.Plot.mini(id, inst.id);
      if (!p) return;
      if (p.isMounted()) p.tick(); // (lets go of a canvas that's no longer on screen)
      if (!p.isMounted()) p.mount(body);
    });
  }
  function chartRemoved(inst) {
    (shownPlots[inst.id] || plotsOf(inst)).forEach((id) => CA.UI.Plot.dropMini(id, inst.id));
    delete shownPlots[inst.id];
  }
  /** Its name: the chart's ("Garden growth"); with more than one, what they're of ("Garden"). */
  function chartName(inst) {
    const all = CA.UI.Plot.widgetable();
    const shown = plotsOf(inst).map((id) => all.find((p) => p.id === id)).filter(Boolean);
    if (shown.length === 1) return shown[0].title;
    const group = (shown[0] || all.find((p) => p.id === plotOf(inst)) || {}).group;
    return group && shown.every((p) => p.group === group) ? group : '';
  }

  // the settings' samples: a chart as the widget draws it (a picture), a statistic's value now
  const SAMPLE_W = 200;
  const chartSample = (id) => () => {
    const url = CA.UI.Plot.snapshot(id, SAMPLE_W, 84);
    return url ? `<img class="ca-wchart-shot" src="${url}" alt="">` : '<div class="ca-w-empty">—</div>';
  };
  const chartNumSample = (n) => () => `<div class="ca-tl-nums"><span><b>${n.value()}</b></span></div>`;
  const chartShowOptions = () =>
    [{ v: 'numbers', label: 'Stats', tip: 'The statistics you tick under Stats', sample: (inst) => chartNumbersHtml(inst) || '<div class="ca-w-empty">None ticked under Stats.</div>' }].concat(
      CA.UI.Plot.widgetable().map((p) => ({ v: p.id, label: p.title, tip: `The ${p.title.toLowerCase()} chart, live — the same window as on its page`, sample: chartSample(p.id) }))
    );

  function register() {
    const D = CA.UI.Widgets.defineType;
    D({ id: 'macro', name: 'Macro button', icon: 'star', bare: true, hidden: true, resize: 'scale', html: macroHtml });
    D({ id: 'status', group: 'macros', sprite: [12, 0], short: 'An icon per macro at work', ring: '#9be15d', name: 'Running now', icon: 'play', desc: 'A status bar: an icon for each running macro, pulsing while it works. Hover an icon for what its actions have done.', bare: true, resize: 'scale', html: statusHtml });
    D({
      id: 'stats',
      group: 'game',
      sprite: [18, 7],
      short: 'The numbers you pick, at a glance',
      name: 'Quick stats',
      icon: 'graphs',
      desc: 'The numbers you care about at a glance — pick which in its settings.',
      width: 190,
      resize: 'free',
      html: statsHtml,
      settings: [{ key: 'stats', label: 'Show', type: 'multi', default: DEFAULT_STATS, options: () => STATS.map((s) => ({ v: s.id, label: s.label, sample: statSample(s) })), tile: 'small' }],
    });
    D({
      id: 'events',
      group: 'game',
      sprite: [27, 7],
      short: 'The newest log entries, filtered',
      name: 'Latest events',
      icon: 'events',
      desc: 'The newest entries in the event log, scrollable. Choose how many and which types in its settings; add as many as you like (one for golden cookies, one for trades…).',
      width: 260,
      resize: 'free',
      html: eventsHtml,
      settings: [
        { key: 'count', label: 'Keep the last', type: 'number', min: 1, max: 200, default: DEFAULT_EVENTS, unit: 'events' },
        {
          key: 'types',
          label: 'Show (none ticked = all)',
          type: 'multi',
          default: [],
          options: () => {
            const t = CA.EventLog.types();
            return Object.keys(t).map((k) => ({ v: k, label: t[k].name, icon: t[k].icon, color: t[k].color, sample: typeSample(k) }));
          },
        },
      ],
    });
    D({
      id: 'grimoire',
      group: 'minigames',
      sprite: [17, 0],
      short: 'Magic ring; time to full or to a spell',
      ring: '#d9c4ff',
      name: 'Grimoire',
      icon: 'wizard',
      desc: 'A small round meter: the ring is your magic, the label the time until it’s full — or until there’s enough for a spell you pick in its settings. Click it to open the Grimoire.',
      bare: true,
      resize: 'scale',
      html: grimoireHtml,
      settings: [
        {
          key: 'target',
          label: 'Count down to',
          type: 'select',
          default: 'full',
          options: () =>
            [{ v: 'full', label: 'Full magic' }]
              .concat(CA.Grimoire.spells().map((s) => ({ v: s.key, label: `${s.name}${Number.isFinite(s.cost) ? ` (${s.cost} magic now)` : ''}` })))
              .concat([{ v: 'custom', label: 'A fixed amount…' }]),
        },
        { key: 'targetMagic', label: 'Fixed amount', type: 'number', min: 1, max: 5000, default: 80, unit: 'magic (when “A fixed amount” is picked)' },
      ],
    });
    D({
      id: 'chart',
      name: 'Chart',
      icon: 'graphs',
      group: 'minigames',
      sprite: { sheet: 'img/gardenPlants.png', pos: [4, 3] },
      short: 'The Garden’s charts and stats, live',
      desc: 'The Garden page’s charts, live on the left panel — its growth, its effects or both — with the statistics you pick over them (each plant effect now, such as golden cookie frequency). The charts show the same window as on the Garden page; hover them for the details.',
      width: 300,
      resize: 'free',
      html: chartHtml,
      iconOf: (inst) => (CA.UI.Plot.get(plotsOf(inst)[0] || plotOf(inst)) || { spec: {} }).spec.icon || 'graphs',
      nameOf: chartName,
      live: chartLive,
      removed: chartRemoved,
      settings: [
        { key: 'stats', label: 'Show', type: 'multi', default: (inst) => [plotOf(inst)], options: chartShowOptions },
        {
          key: 'nums',
          label: 'Stats',
          type: 'multi',
          default: () => chartNumbers().filter((n) => n.on).map((n) => n.v),
          options: () => chartNumbers().map((n) => ({ v: n.v, label: CA.StatInfo.label(n.stat), tip: CA.StatInfo.desc(n.stat), sample: chartNumSample(n) })),
          when: (inst) => chartPartsOf(inst).includes('numbers'),
          tile: 'small',
        },
        {
          key: 'legend',
          label: 'Legend',
          type: 'select',
          default: 'show',
          options: () => [
            { v: 'show', label: 'Shown under each chart' },
            { v: 'hide', label: 'Hidden (hover a chart for the names)' },
          ],
          when: (inst) => plotsOf(inst).length > 0,
        },
      ],
    });
    // the Stats page's Actual income chart, live: a Chart widget showing just it (its ☆ on the page)
    const incomeOf = (inst) => ({ ...inst, stats: ['income'] });
    D({
      id: 'income',
      name: 'Actual income',
      icon: 'bolt',
      group: 'game',
      short: 'What you really bake, the payback line',
      desc: 'The Stats page’s Actual income chart, live on the left panel: what you really baked a second by source, with the income payback periods count in as a line. It shows the window, smoothing and scale you pick on Stats → Actual income; hover it for the details.',
      width: 300,
      resize: 'free',
      html: (inst) => chartHtml(incomeOf(inst)),
      live: (inst, body) => chartLive(incomeOf(inst), body),
      removed: (inst) => chartRemoved(incomeOf(inst)),
      settings: [
        {
          key: 'legend',
          label: 'Legend',
          type: 'select',
          default: 'show',
          options: () => [
            { v: 'show', label: 'Shown under the chart' },
            { v: 'hide', label: 'Hidden (hover the chart for the names)' },
          ],
        },
      ],
    });
    D({ id: 'garden', group: 'minigames', sprite: [2, 0], short: 'Next tick; your plants by stage', ring: '#a8f06a', name: 'Garden', icon: 'leaf', desc: 'The ring counts down to the next garden tick; the dots under it are your plants by stage (bud, sprout, bloom, mature). Click it to open the Garden.', bare: true, resize: 'scale', html: gardenHtml });
    D({ id: 'market', group: 'minigames', sprite: [15, 0], short: 'Next tick; what the last did', ring: '#6fe6ef', name: 'Stock market', icon: 'stocks', desc: 'The ring counts down to the next market tick; the label is what the last tick did to the stocks you held. Click it to open the Stock market.', bare: true, resize: 'scale', html: marketHtml });
    D({ id: 'pantheon', group: 'minigames', sprite: [16, 0], short: 'Slotted spirits; next swap', ring: '#ffd36a', name: 'Pantheon', icon: 'pantheon', desc: 'Your three slotted spirits, and a ring counting down to the next worship swap. Click it to open the Pantheon.', bare: true, resize: 'scale', html: pantheonHtml });
  }

  return { register, openMinigame, readyState, STATS, DEFAULT_STATS };
})();
