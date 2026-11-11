// The minigames' own tooltips, with cookieMgr's additions under them (features/minigameInfo.js) — the
// Grimoire's spells, the Stock market's stocks, the Pantheon's gods. The game's tooltips are wrapped
// as they're asked for (each is built on hover from M.spellTooltip / goodTooltip / godTooltip), so
// nothing of the game's is changed. Option (Settings → Store): minigameTips.

CA.UI = CA.UI || {};

CA.UI.MinigameTips = (() => {
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.Format;
  const I = () => CA.MinigameInfo;
  const when = (s) => (s === null || s === undefined || Number.isNaN(s) ? '—' : !Number.isFinite(s) ? 'never (over the maximum)' : s <= 0 ? 'now' : F().span(s));
  const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.1 ? 2 : 1)}%`;

  function block(rows, note) {
    return (
      '<div class="ca-tt ca-tt-mg">' +
      '<div class="ca-tt-head">cookieMgr</div>' +
      rows.map(([k, v, cls]) => `<div class="ca-tt-row"><span>${k}</span><b${cls ? ` class="${cls}"` : ''}>${v}</b></div>`).join('') +
      (note ? `<div class="ca-tt-note">${note}</div>` : '') +
      '</div>'
    );
  }

  function spellBlock(id) {
    const s = I().spell(id);
    if (!s) return '';
    const rows = [];
    if (!s.affordable) rows.push(['Magic enough in', when(s.waitFor), 'ca-mg-wait']);
    else {
      rows.push(['Magic after casting', `${Math.floor(s.magic - s.cost)} / ${Math.floor(s.max)}`]);
      rows.push(['Back to where it is in', when(s.recover)]);
      rows.push(['Full again in', when(s.refull)]);
    }
    if (s.conjure) {
      rows.push(['Gives now', F().beautify(s.conjure.now)]);
      rows.push(['Gives the most with', `${F().beautify(s.conjure.bank)} banked`]);
    }
    if (s.edifice && s.edifice.building) {
      rows.push(['Can give', esc((Game.Objects[s.edifice.building] || {}).dname || s.edifice.building)]);
      rows.push(['Needs banked', F().beautify(s.edifice.bank), Game.cookies >= s.edifice.bank ? 'ca-mg-ok' : 'ca-mg-bad']);
    }
    return block(rows);
  }

  function goodBlock(id) {
    const s = I().stock(id);
    if (!s) return '';
    const rel = s.ratio - 1;
    const rows = [
      ['Resting value', `$${F().beautify(s.resting)} <small>(price ${Number.isFinite(rel) ? pct(rel) : '—'})</small>`, rel < 0 ? 'ca-mg-ok' : rel > 0 ? 'ca-mg-bad' : ''],
      ['Trend', `${esc(s.mode)}${Number.isFinite(s.delta) ? ` <small>(last ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}%)</small>` : ''}`],
      ['Held', `${F().beautify(s.held)} / ${F().beautify(s.max)}`],
    ];
    if (s.held > 0) rows.push(['Worth', `${F().beautify(s.worth)} cookies`]);
    rows.push(['A share', `${F().beautify(s.perShare)} cookies`]);
    return block(rows, 'below the resting value it tends to rise back to it; above it, to fall');
  }

  function godBlock(id) {
    const g = I().god(id);
    if (!g) return '';
    const rows = g.gains.map((x) => [`${x.name}${x.here ? ' <small>(here now)</small>' : ''}`, x.here ? '—' : `${x.cps >= 0 ? '+' : '−'}${F().beautify(Math.abs(x.cps))}/s <small>(${Number.isFinite(x.pct) ? pct(x.pct) : '—'})</small>`, x.here ? '' : x.cps > 0 ? 'ca-mg-ok' : x.cps < 0 ? 'ca-mg-bad' : '']);
    if (g.slot >= 0) rows.push(['Taken out', `${g.out >= 0 ? '+' : '−'}${F().beautify(Math.abs(g.out))}/s`, g.out > 0 ? 'ca-mg-ok' : g.out < 0 ? 'ca-mg-bad' : '']);
    return block(rows);
  }

  // ---- wrapping the game's tooltips -------------------------------------------------------------

  const WRAPS = [
    ['Wizard tower', 'spellTooltip', spellBlock],
    ['Bank', 'goodTooltip', goodBlock],
    ['Temple', 'godTooltip', godBlock],
  ];
  function wrap() {
    WRAPS.forEach(([building, fn, extra]) => {
      const M = CA.Util.minigame(building);
      if (!M || typeof M[fn] !== 'function' || M[fn].__ca) return;
      const orig = M[fn];
      M[fn] = function (id) {
        const inner = orig.apply(this, arguments);
        return function () {
          const html = inner.apply(this, arguments);
          if (!html || !CA.Settings.get('minigameTips')) return html;
          try {
            return html + extra(id);
          } catch (e) {
            return html;
          }
        };
      };
      M[fn].__ca = true;
    });
  }

  function init() {
    CA.Settings.defineOption({
      key: 'minigameTips',
      group: 'store',
      icon: 'wizard',
      name: 'Minigame tooltips',
      desc: 'Under the minigames’ own tooltips: when you’ll have the magic for a spell and how long it takes to come back; a stock’s resting value, trend and worth; the CpS a god would bring in each slot.',
      default: true,
    });
    setInterval(() => {
      try {
        wrap();
      } catch (e) {
        /* a minigame loading: next time */
      }
    }, 1000);
  }

  return { init, spellBlock, goodBlock, godBlock };
})();
