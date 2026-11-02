// An achievement's info card — the same look as the upgrade card (ui/upgradeTip.js), wherever the
// add-on shows an achievement (the Stats page's achievements still to collect…): its icon and name,
// won or not (and shadow), what it asks (the game's own description), and for one not won yet: where
// you stand on what it counts (features/achievementInfo.js), what the buildings it takes cost or how
// long the cookies take at your actual income (the
// tooltips' window; your CpS until a minute is recorded), and the milk it adds — with the kitten it brings closer.
//
//   html(name)   the card
//   ref(name)    an achievement as a hoverable name — CA.AchievementInfo.ref
//   attrs(name)  the attributes that make any element show the card on hover
//
// The card shows through ui/tips.js (data-pop-live="achievement"), refreshed while the mouse stays.

CA.UI = CA.UI || {};

CA.UI.AchievementTip = (() => {
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.Format;
  const AI = () => CA.AchievementInfo;
  const MILK = 4; // % milk a regular achievement adds (Game.milkProgress = achievements / 25)

  const named = (name) => (Game.Achievements || {})[name] || null;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** The game's description (its own HTML). */
  const desc = (a) => String(a.ddesc || a.desc || '');

  /** The next kitten the achievements unlock, and how many more achievements it takes: { u, more } or null. */
  function nextKitten() {
    const owned = Game.AchievementsOwned || 0;
    for (const u of (Game.UpgradesByPool || {}).kitten || []) {
      if (u.bought || u.unlocked) continue;
      const req = CA.UpgradeInfo.requirement(u);
      if (req && req.need !== undefined && /achievements/.test(req.text)) return { u, more: Math.max(1, req.need - owned) };
      return null;
    }
    return null;
  }

  function card(name) {
    const a = named(name);
    if (!a) return '';
    const shadow = a.pool === 'shadow';
    const won = AI().status(a) === 'won';
    const rows = [];
    const row = (k, v, cls) => rows.push(`<div class="ca-uptip-row"><span>${k}</span><b${cls ? ` class="${cls}"` : ''}>${v}</b></div>`);
    if (!won) {
      AI()
        .progress(a)
        .forEach((p) => {
          const met = p.have >= p.need;
          row(esc(cap(p.what)), met ? `${F().beautify(p.need)} <span class="ca-uptip-met">✓</span>` : `${F().beautify(p.have)} <small>of</small> ${F().beautify(p.need)}`);
          if (met) return;
          if (p.b) {
            const price = CA.Payback.sumPrice(p.b, p.need - p.have);
            row(`${F().beautify(p.need - p.have)} more cost`, F().beautify(price), CA.Payback.timeTo(price) <= 0 ? 'ca-pp-green' : 'ca-pp-red');
          } else if (p.rate > 0) {
            const left = `${F().units((p.need - p.have) / p.rate)} <small>to go</small>`;
            if (p.actual) row('By actual income', `${left} <small>(${esc(CA.Payback.actualWindowText())})</small>`);
            else row('At your CpS', left);
          }
        });
      if (shadow) row('Milk', 'none <small>(a shadow achievement)</small>');
      else {
        const k = nextKitten();
        const toward = !k ? '' : k.more === 1 ? ` <small>(unlocks ${esc(k.u.dname || k.u.name)})</small>` : ` <small>(${k.more} more for ${esc(k.u.dname || k.u.name)})</small>`;
        row('Milk', `+${MILK}%${toward}`);
      }
    }
    const st = shadow ? (won ? 'Shadow · won' : 'Shadow') : won ? 'Won' : 'Not won yet';
    return (
      '<div class="ca-uptip">' +
      `<div class="ca-uptip-head">${CA.UpgradeInfo.sprite(a.icon, 'ca-uptip-ico')}<div><b>${esc(a.dname || a.name)}</b><small class="ca-uptip-st ${won ? 'owned' : shadow ? 'heavenly' : ''}">${st}</small></div></div>` +
      `<div class="ca-uptip-desc">${desc(a)}</div>` +
      (rows.length ? `<div class="ca-uptip-rows">${rows.join('')}</div>` : '') +
      '</div>'
    );
  }

  function init() {
    CA.UI.Tips.providePop('achievement', (el) => card(el.dataset.achievement));
  }

  return { init, html: card, ref: (name) => AI().ref(name), attrs: (name) => AI().attrs(name) };
})();
