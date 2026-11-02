// The Stats page's statistics cards: Cookie Monster's statistics, cookieMgr's way (features/goldenMath.js,
// timers.js, prestige.js, wrinklers.js, whatIf.js, collection.js). Until v3.47 they were a page of their own;
// now they sit on the Stats page's tabs (ui/graphs.js), beside its charts:
//
//   Golden    Next golden cookie (and reindeer), Bank
//   Prestige  Prestige (above the target and the charts)
//   What if   What if
//   Misc      Timers, Wrinklers, Still to collect
//   Upgrades & achievements   every upgrade and achievement in the game
//
//   Bank          what golden cookies and spells pay at their most, and the bank each needs: a meter
//                 per one (your bank against it — wrinklers counted when Payback says so), how long
//                 until you get there, what it pays
//   Next golden   when the next golden cookie (and, at Christmas, reindeer) comes: the distribution of
//   cookie        the wait, drawn and summed up, and what moves it (ui/spawnView.js)
//   Prestige      levels if you ascended now, the next one, the rate, what they'd add to your CpS,
//                 the Lucky digit / number / payout levels
//   Wrinklers     what popping them would give, the fattest, what they eat
//   What if       every spirit in each Pantheon slot, every dragon aura — the CpS each would bring
//   Timers        the sugar lump, magic, the autosave, the effects running
//   Collection    what's left: upgrades, achievements, season drops, the garden's rare drops
//   Upgrades,     everything there is, the ones you have lit up: upgrades bought this ascension (ones in the
//   Achievements  store ringed), achievements won (they stay through ascensions); a chip shows only the
//                 ones you don't have yet. Each icon's info card on hover.

CA.UI = CA.UI || {};

CA.UI.StatsPage = (() => {
  const C = () => CA.UI.C;
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.Format;
  const SYNC_MS = 1000;
  let root = null;
  let life = null;

  const sprite = (pos, cls = '') => `<span class="ca-pp-ico ${cls}" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-pos[0] * 48}px ${-pos[1] * 48}px"></span>`;
  const when = (s) =>
    s === null || s === undefined || Number.isNaN(s) ? '—' : !Number.isFinite(s) ? 'never at this rate' : s <= 0 ? 'now' : s > 3.15e9 ? '100+ years' : s > 3.15e7 ? `${Math.round(s / 3.15e7)} years` : F().span(s);
  const bankNow = () => (Game.cookies || 0) + (CA.Wrinklers ? CA.Wrinklers.bank(CA.Settings.get('ppWrinklers')) : 0);

  // ---- bank -------------------------------------------------------------------------------------------

  function meter(name, bank, reward, tip) {
    const have = bankNow();
    const pct = bank > 0 ? Math.min(1, have / bank) : 1;
    const ok = have >= bank;
    const wait = ok ? 0 : Game.cookiesPs > 0 ? (bank - have) / Game.cookiesPs : Infinity;
    return (
      `<div class="ca-meter${ok ? ' ok' : ''}" data-tip="${esc(tip)}">` +
      `<div class="ca-meter-top"><b>${esc(name)}</b><span>${F().beautify(bank)}</span></div>` +
      `<div class="ca-meter-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>` +
      `<div class="ca-meter-sub"><span>${ok ? 'covered' : `in ${when(wait)}`}</span><span>pays ${F().beautify(reward)}</span></div>` +
      '</div>'
    );
  }
  function bankHtml() {
    const G = CA.GoldenMath;
    const l = G.lucky();
    const lf = G.lucky(true);
    const c = G.conjure();
    const ch = G.chain();
    const chf = G.chain(false, true);
    const ed = G.edifice();
    return (
      meter('Lucky!', l.bank, l.reward, 'A Lucky! golden cookie pays 15% of your bank, up to 15 minutes of CpS: this bank lets it pay the most.') +
      meter('Lucky! in a Frenzy', lf.bank, lf.reward, 'In a Frenzy CpS is ×7 — so is what a Lucky! can pay, and the bank it takes.') +
      meter('Cookie chain', ch.bank, ch.total, 'A chain pays more and more until it hits 6 hours of CpS (or half your bank): this bank lets it run to the CpS cap.') +
      meter('Chain in a Frenzy', chf.bank, chf.total, 'A cookie chain while a Frenzy runs.') +
      meter('Conjure Baked Goods', c.bank, c.reward, 'The spell pays 15% of your bank, up to 30 minutes of CpS.') +
      (ed ? meter(`Spontaneous Edifice: ${(Game.Objects[ed.building] || {}).dname || ed.building}`, ed.bank, ed.price, 'The spell gives a random building you have fewer than 400 of (and fewer than your most-owned) costing up to twice your bank — this bank covers the most expensive one.') : '')
    );
  }

  // ---- prestige, wrinklers, timers ---------------------------------------------------------------------

  function prestigeHtml() {
    const P = CA.Prestige;
    const { tile } = CA.UI.Plot.fmt;
    const ph = P.perSecond() * 3600;
    const lucky = P.lucky()
      .map((x) => `${x.owned ? '✓ ' : ''}${x.name.replace('Lucky ', '')} ${F().beautify(x.level)}`)
      .join(' · ');
    return (
      tile('If you ascended now', `+${F().beautify(P.gain())}`, `levels (${F().beautify(P.total())} in all)`) +
      tile('Next level', when(P.secondsTo(P.total() + 1)), `${F().beautify(P.toNext())} cookies to bake`) +
      tile('Rate', ph >= 1 ? `${ph >= 10 ? F().beautify(ph) : ph.toFixed(1)}/h` : ph > 0 ? `1 every ${when(3600 / ph)}` : '—', ph >= 1 ? 'levels an hour at this rate' : 'a level, at this rate') +
      tile('CpS they’d add', `+${F().beautify(P.cpsGain())}`, 'with the levels you’d gain') +
      tile('Lucky upgrades', '', lucky, 'The total prestige level each heavenly upgrade needs (ending in 7, 777, 777777)')
    );
  }
  function wrinklersHtml() {
    const s = CA.Wrinklers.summary();
    const { tile } = CA.UI.Plot.fmt;
    if (!s.count) return tile('Wrinklers', 'none', Game.elderWrath > 0 ? 'none attached yet' : 'they come with the Grandmapocalypse');
    return (
      tile('Pop them all', F().beautify(s.total), `${s.count} wrinkler${s.count === 1 ? '' : 's'}${s.shinies ? `, ${s.shinies} shiny` : ''}`) +
      tile('The fattest', s.fattest ? F().beautify(s.fattest.reward) : '—', 'non-shiny') +
      tile('Eating', `${F().beautify(CA.Wrinklers.eatingRate())}/s`, `${s.eating} attached`)
    );
  }
  function timersHtml() {
    const { tile } = CA.UI.Plot.fmt;
    const L = CA.Timers.lump();
    const m = CA.Timers.magicFull();
    const a = CA.Timers.autosave();
    const buffs = CA.Timers.buffs();
    return (
      (L ? tile('Sugar lump', L.ripeIn > 0 ? `ripe in ${when(L.ripeIn)}` : 'ripe', `${L.type}${L.matureIn > 0 ? ` · mature in ${when(L.matureIn)}` : ''}`) : '') +
      (m !== null ? tile('Magic', m > 0 ? `full in ${when(m)}` : 'full', 'the Grimoire') : '') +
      (a !== null ? tile('Autosave', when(a), 'the game saves itself') : '') +
      buffs.map((b) => tile(esc(b.name), when(b.secs), [b.cps !== 1 ? `CpS ×${b.cps}` : '', b.click !== 1 ? `clicks ×${b.click}` : ''].filter(Boolean).join(' · ') || 'effect')).join('')
    );
  }

  // ---- what if -------------------------------------------------------------------------------------------

  const SLOTS = ['Diamond', 'Ruby', 'Jade'];
  function whatIfHtml() {
    const M = CA.Util.minigame('Temple');
    let h = '';
    const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    const pct = (v) => (Game.cookiesPs > 0 ? `${v >= 0 ? '+' : '−'}${Math.abs((v / Game.cookiesPs) * 100).toFixed(2)}%` : '');
    if (M && M.godsById) {
      const rows = M.godsById
        .map((g) => {
          const vals = [0, 1, 2].map((s) => (M.slot[s] === g.id ? null : CA.WhatIf.godGain(g.key || Object.keys(M.gods).find((k) => M.gods[k] === g), s)));
          return { g, vals };
        })
        .filter((r) => r.vals.some((v) => v))
        .map(
          (r) =>
            `<tr><th>${sprite(r.g.icon)}<span>${esc(String(r.g.name).split(',')[0])}</span></th>` +
            r.vals.map((v, s) => (v === null ? `<td class="here">${SLOTS[s]}: here</td>` : `<td class="${cls(v)}" data-tip="${esc(`${F().signed(v)}/s in the ${SLOTS[s]} slot`)}">${pct(v)}</td>`)).join('') +
            '</tr>'
        )
        .join('');
      h += rows ? `<div class="ca-wi-head">Pantheon: the CpS a spirit would bring in each slot</div><table class="ca-wi-table"><thead><tr><th></th>${SLOTS.map((s) => `<th>${s}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : '';
    }
    if (Game.dragonLevel >= 5 && Game.dragonAuras) {
      const cost = CA.WhatIf.auraCost();
      const auras = Object.values(Game.dragonAuras)
        .filter((a) => a.id > 0 && Game.dragonLevel >= a.id + 4)
        .map((a) => ({ a, v1: CA.WhatIf.auraGain(a.name, 1), v2: Game.dragonLevel >= 27 ? CA.WhatIf.auraGain(a.name, 2) : null }))
        .filter((x) => x.v1 || x.v2)
        .sort((x, y) => Math.max(y.v1, y.v2 || -Infinity) - Math.max(x.v1, x.v2 || -Infinity));
      if (auras.length)
        h +=
          `<div class="ca-wi-head">Dragon auras: the CpS switching would bring${cost ? ` (it costs one ${esc(cost.dname || cost.name)})` : ''}</div><div class="ca-wi-auras">` +
          auras
            .map((x) => `<span class="ca-wi-aura ${cls(Math.max(x.v1, x.v2 || -Infinity))}" data-tip="${esc(`${x.a.name}: slot 1 ${F().signed(x.v1)}/s${x.v2 !== null ? ` · slot 2 ${F().signed(x.v2)}/s` : ''}`)}">${esc(x.a.name)} <b>${pct(Math.max(x.v1, x.v2 === null ? -Infinity : x.v2))}</b></span>`)
            .join('') +
          '</div>';
    }
    return h || '<div class="ca-card-note">Nothing to compare yet — the Pantheon (a level-1 Temple) and dragon auras (a dragon level 5 and up) show here.</div>';
  }

  // ---- collection --------------------------------------------------------------------------------------

  function iconsOf(names, kind) {
    return names
      .map((n) => {
        const it = ((kind === 'achievement' ? Game.Achievements : Game.Upgrades) || {})[n];
        if (!it || !it.icon) return '';
        // its info card on hover (ui/upgradeTip.js, ui/achievementTip.js)
        return `<span class="ca-col-ico" ${kind === 'achievement' ? CA.AchievementInfo.attrs(it.name) : CA.UpgradeInfo.attrs(it.name)}>${sprite(it.icon)}</span>`;
      })
      .join('');
  }
  function collectionHtml() {
    const Co = CA.Collection;
    const mu = Co.missingUpgrades();
    const ma = Co.missingAchievements();
    const sd = Co.missingSeasonDrops();
    const pd = Co.missingPlantDrops();
    const block = (title, names, kind) => (names.length ? `<details class="ca-col"><summary>${esc(title)} <b>${names.length}</b></summary><div class="ca-col-grid">${iconsOf(names, kind)}</div></details>` : `<div class="ca-col done">${esc(title)} <b>✓ all</b></div>`);
    return (
      block('Upgrades', mu.regular, 'upgrade') +
      block('Cookies', mu.cookie, 'upgrade') +
      block('Heavenly upgrades', mu.prestige, 'upgrade') +
      block('Achievements', ma, 'achievement') +
      ['christmas', 'halloween', 'easter', 'valentines'].map((s) => block(`${s[0].toUpperCase()}${s.slice(1)} drops`, sd[s], 'upgrade')).join('') +
      block('Rare plant drops', pd, 'upgrade')
    );
  }

  // ---- upgrades & achievements ------------------------------------------------------------------------

  const ALL_SEEN = 'collectionMissing'; // the option: only the ones you don't have yet
  const STATE_TIP = { owned: '', store: ' in-store', locked: ' off' };
  function allIcon(it, kind) {
    const sheet = typeof it.icon[2] === 'string' ? it.icon[2] : CA.Util.res('img/icons.png');
    const pos = `${-it.icon[0] * 48}px ${-it.icon[1] * 48}px`;
    return (
      `<span class="ca-all-ico${STATE_TIP[it.state]}" data-all-state="${it.state}" ${kind === 'achievement' ? CA.AchievementInfo.attrs(it.name) : CA.UpgradeInfo.attrs(it.name)}>` +
      `<span class="ca-pp-ico" style="background-image:url(${sheet});background-position:${pos}"></span></span>`
    );
  }
  function allGroup(title, items, kind, note) {
    const owned = items.filter((x) => x.state === 'owned').length;
    const shown = CA.Settings.get(ALL_SEEN) ? items.filter((x) => x.state !== 'owned') : items;
    const all = owned === items.length;
    return (
      `<div class="ca-all-group" data-all-group="${esc(title)}">` +
      `<div class="ca-all-head"><b>${esc(title)}</b><span class="ca-all-count${all ? ' done' : ''}">${owned} of ${items.length}${all ? ' ✓' : ''}</span>` +
      (note ? `<span class="ca-hint">${esc(note)}</span>` : '') +
      '</div>' +
      (shown.length ? `<div class="ca-all-grid">${shown.map((x) => allIcon(x, kind)).join('')}</div>` : `<div class="ca-card-note">${items.length ? 'All of them — nothing left here.' : 'None in this game.'}</div>`) +
      '</div>'
    );
  }
  function allUpgradesHtml() {
    const u = CA.Collection.everything().upgrades;
    return allGroup('Upgrades', u.regular, 'upgrade') + allGroup('Cookies', u.cookie, 'upgrade') + allGroup('Heavenly upgrades', u.prestige, 'upgrade', 'bought with heavenly chips, kept through ascensions');
  }
  function allAchievementsHtml() {
    const a = CA.Collection.everything().achievements;
    return allGroup('Achievements', a.normal, 'achievement') + allGroup('Shadow achievements', a.shadow, 'achievement', 'no milk');
  }
  function allBarHtml() {
    const on = !!CA.Settings.get(ALL_SEEN);
    const e = CA.Collection.everything();
    const n = (groups) => {
      const l = [].concat(...Object.values(groups));
      return `${l.filter((x) => x.state === 'owned').length} of ${l.length}`;
    };
    return (
      `<button type="button" class="ca-chip${on ? ' on' : ''}" aria-pressed="${on}" data-ca="option" data-key="${ALL_SEEN}" data-pressed-key="${ALL_SEEN}" data-tip="Hide the upgrades you bought and the achievements you won">` +
      `${CA.UI.Icons.html('check', 12)} Only ones not unlocked yet</button>` +
      `<span class="ca-all-sum">Upgrades <b>${n(e.upgrades)}</b> · Achievements <b>${n(e.achievements)}</b></span>` +
      '<span class="ca-all-key"><span class="ca-all-sw"></span>owned<span class="ca-all-sw in-store"></span>in the store<span class="ca-all-sw off"></span>not yet</span>'
    );
  }
  /** What the tab shows depends on: what you own, what's in the store, the filter. */
  const allSig = () =>
    [Game.UpgradesOwned, Game.AchievementsOwned, (Game.UpgradesInStore || []).length, CA.Settings.get(ALL_SEEN), Object.keys(Game.Upgrades || {}).length, Object.keys(Game.Achievements || {}).length].join();
  let allSeen = null;
  const ALL_PARTS = [
    ['data-st-all-bar', allBarHtml],
    ['data-st-all-upgrades', allUpgradesHtml],
    ['data-st-all-achievements', allAchievementsHtml],
  ];
  function syncAll(force) {
    if (!root || !root.querySelector('[data-st-all-bar]')) return;
    const sig = allSig();
    if (!force && sig === allSeen) return;
    allSeen = sig;
    ALL_PARTS.forEach(([attr, fn]) => {
      const el = root.querySelector(`[${attr}]`);
      if (el) CA.UI.Dom.morph(el, fn());
    });
  }

  // ---- page ------------------------------------------------------------------------------------------

  function card(title, icon, body, attr, meta = '') {
    return `<div class="ca-card">${C().cardHead(title, icon, meta)}<div ${attr}>${body}</div></div>`;
  }
  const PARTS = [
    ['data-st-bank', bankHtml],
    ['data-st-spawn', () => CA.UI.SpawnView.html('golden')],
    ['data-st-reindeer', () => CA.UI.SpawnView.html('reindeer')],
    ['data-st-prestige', prestigeHtml],
    ['data-st-wrinklers', wrinklersHtml],
    ['data-st-timers', timersHtml],
  ];
  const meta = (t) => `<div class="ca-card-meta"><span class="ca-hint">${t}</span></div>`;
  // each Stats tab's cards (a tab without any draws none)
  const CARDS = {
    golden: () =>
      card('Next golden cookie', 'sparkle', CA.UI.SpawnView.html('golden'), 'class="ca-sp" data-st-spawn', meta('exact, from the game’s own odds — hover the chart')) +
      (Game.season === 'christmas' ? card('Next reindeer', 'sparkle', CA.UI.SpawnView.html('reindeer'), 'class="ca-sp" data-st-reindeer') : '') +
      card('Bank', 'dollar', bankHtml(), 'class="ca-meters" data-st-bank', meta('what golden cookies and spells pay at their most — and the bank it takes')),
    prestige: () => card('Prestige statistics', 'ascend', prestigeHtml(), 'class="ca-stats" data-st-prestige'),
    whatif: () => card('What if', 'pantheon', whatIfHtml(), 'data-st-whatif', meta('measured on the game itself, then put back')),
    misc: () =>
      card('Timers', 'clock', timersHtml(), 'class="ca-stats" data-st-timers') +
      card('Wrinklers', 'wrinkler', wrinklersHtml(), 'class="ca-stats" data-st-wrinklers') +
      card('Still to collect', 'trophy', collectionHtml(), 'class="ca-cols" data-st-collection'),
    collection: () => {
      allSeen = allSig();
      return (
        `<div class="ca-card"><div class="ca-all-bar" data-st-all-bar>${allBarHtml()}</div></div>` +
        card('Upgrades', 'upgrade', allUpgradesHtml(), 'class="ca-all" data-st-all-upgrades', meta('bought this ascension — hover one for its card')) +
        card('Achievements', 'trophy', allAchievementsHtml(), 'class="ca-all" data-st-all-achievements', meta('won for good: they stay through ascensions'))
      );
    },
  };
  /** The cards of Stats tab `tab` ('golden' | 'prestige' | 'whatif' | 'misc' | 'collection'). */
  const html = (tab) => (CARDS[tab] ? CARDS[tab]() : '');

  function sync() {
    if (!root || !root.isConnected) return;
    PARTS.forEach(([attr, fn]) => {
      const el = root.querySelector(`[${attr}]`);
      if (el) CA.UI.Dom.morph(el, fn());
    });
    syncAll();
  }

  function mount(el) {
    unmount();
    root = el;
    const spawnNow = () => ['data-st-spawn', 'data-st-reindeer'].forEach((attr) => {
      const p = root && root.querySelector(`[${attr}]`);
      if (p) CA.UI.Dom.morph(p, CA.UI.SpawnView.html(attr === 'data-st-spawn' ? 'golden' : 'reindeer'));
    });
    life = CA.UI.Pages.scope(el)
      .every(SYNC_MS, sync)
      .add(CA.Events.on('settings', (key) => key === ALL_SEEN && syncAll(true)))
      .on('mousemove', (e) => CA.UI.SpawnView.onMove(e) && spawnNow())
      .on('mouseout', (e) => {
        CA.UI.SpawnView.onLeave(e);
        spawnNow();
      })
      .on('click', (e) => {
        if (CA.UI.SpawnView.onClick(e)) {
          e.stopPropagation();
          spawnNow();
        }
      });
  }
  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  return { html, mount, unmount, sync, ALL_SEEN };
})();
