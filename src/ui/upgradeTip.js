// An upgrade's info card — cookieMgr's own upgrade tooltip, the same wherever the add-on shows an
// upgrade (the Stats page's missing upgrades, the Payback page's tiles, a statistic naming one — the
// store tooltip's next upgrade…): its icon and name, where it stands (owned, in the store, locked,
// heavenly), what it does (the game's own description), what it costs, what it would add and its
// payback period (features/upgradeInfo.js — for a locked one, as if you had it now), the
// achievements it wins, and how the game unlocks it — shown even once it's unlocked, for knowledge's sake.
//
//   html(name)   the card
//   ref(name)    an upgrade as a hoverable name (its icon, its name; the card on hover) — CA.UpgradeInfo.ref
//   attrs(name)  the attributes that make any element show the card on hover
//
// The card shows through ui/tips.js (data-pop-live="upgrade"), refreshed while the mouse stays.

CA.UI = CA.UI || {};

CA.UI.UpgradeTip = (() => {
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.Format;
  const UI = () => CA.UpgradeInfo;
  const STATUS = { owned: 'Owned', store: 'In the store', locked: 'Locked' };

  const named = (name) => (Game.Upgrades || {})[name] || null;
  const sprite = (icon, cls) => UI().sprite(icon, cls);

  /** The game's description (its own HTML). */
  function desc(u) {
    try {
      const d = typeof u.descFunc === 'function' ? u.descFunc('stats') : u.ddesc || u.desc;
      return String(d || '');
    } catch (e) {
      return String(u.ddesc || u.desc || '');
    }
  }

  function card(name) {
    const u = named(name);
    if (!u) return '';
    const st = UI().status(u);
    const heavenly = u.pool === 'prestige';
    const rows = [];
    const row = (k, v, cls) => rows.push(`<div class="ca-uptip-row"><span>${k}</span><b${cls ? ` class="${cls}"` : ''}>${v}</b></div>`);
    const price = UI().price(u);
    if (heavenly) row('Cost', `${F().beautify(price)} heavenly chips`);
    else if (st === 'owned') row('Cost', F().beautify(price));
    else row('Cost', F().beautify(price), CA.Payback.timeTo(price) <= 0 ? 'ca-pp-green' : 'ca-pp-red');
    if (!heavenly && st !== 'owned') {
      const w = UI().worth(u);
      if (w) {
        const share = Game.cookiesPs > 0 && w.bonus > 0 ? ` (${((w.bonus / Game.cookiesPs) * 100).toFixed(2)}%)` : '';
        if (w.bonus > 0) row('Adds', `+${F().beautify(w.bonus)}/s${share}`);
        if (w.mouse > 0) {
          // how much more a click makes, then the income that is at your clicking
          const per = Number.isFinite(Game.computedMouseCps) ? Game.computedMouseCps : 0;
          const r = per > 0 ? w.mouse / per : 0;
          const more = !(per > 0) ? `+${F().beautify(w.mouse)}` : r >= 10 ? `+${F().beautify(r * 100)}%` : `+${(r * 100).toFixed(1)}%`;
          row(w.bonus > 0 ? 'Income by clicking' : 'Income', `${more} per click (+${F().beautify(w.mouse * CA.Payback.clickRate())}/s)`);
        }
        if (!(w.bonus > 0) && !(w.mouse > 0)) row('Adds', 'no CpS');
        row('Payback period', `${F().payback(w.pp)}${st === 'locked' ? ' <small>if you had it now</small>' : ''}`, w.color ? `ca-pp-${w.color}` : '');
        if (w.won && w.won.length) row('Wins', esc(w.won.join(', ')));
      }
    }
    const req = UI().requirement(u);
    if (req) {
      const met = req.need !== undefined && req.have >= req.need;
      const progress = req.need === undefined ? '' : met ? ' <span class="ca-uptip-met">✓</span>' : ` <small>(${F().beautify(req.have)} of ${F().beautify(req.need)})</small>`;
      row(st === 'locked' ? 'Unlocks with' : 'Unlocked by', `${esc(req.text)}${progress}`);
    }
    return (
      '<div class="ca-uptip">' +
      `<div class="ca-uptip-head">${sprite(u.icon, 'ca-uptip-ico')}<div><b>${esc(u.dname || u.name)}</b><small class="ca-uptip-st ${heavenly ? 'heavenly' : st}">${heavenly ? (st === 'owned' ? 'Heavenly · owned' : 'Heavenly') : STATUS[st] || ''}</small></div></div>` +
      `<div class="ca-uptip-desc">${desc(u)}</div>` +
      `<div class="ca-uptip-rows">${rows.join('')}</div>` +
      '</div>'
    );
  }

  function init() {
    CA.UI.Tips.providePop('upgrade', (el) => card(el.dataset.upgrade));
  }

  return { init, html: card, ref: (name) => UI().ref(name), attrs: (name) => UI().attrs(name) };
})();
