// The **Auto buyer row**: the Manager widget's "Auto buyer" part (ui/managerWidget.js), shown while the stage has
// the Auto buyer (features/autoBuyer.js) on — even with the Manager macro off, as what it would buy. Live:
//
//   AUTO BUYER                                   Payback profile
//   ▫ ▫ ▫ ›  ▣  10 × Farm
//              2.4 M · PP 8.5 min
//              ▬▬▬▬▬▬▬▭▭▭ in 7s  (the bank's way to it, green once affordable)
//
// The last three things it bought (oldest left; the newest flashes as it lands), then what it buys next,
// big, with its price, payback period, score, when you can afford it and a bar. Hover a picture for its card
// (price, payback period, score, why it's next, +CpS, when / how long ago, what's kept ahead of it, the rules);
// click anything for the Payback page. While it saves up for something it keeps first (a Lucky! bank, the
// garden's replant…), that's what's shown — "Saving: Garden replant", how far along, why it comes first —
// with what it buys after it.

CA.UI = CA.UI || {};

CA.UI.BuyerRow = (() => {
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const B = () => CA.AutoBuyer;
  const P = () => CA.Payback;
  const F = () => CA.Format;
  const PAST = 3;
  const HOT_MS = 1500;

  const ago = (t) => (Date.now() - t < 2000 ? 'just now' : `${F().span((Date.now() - t) / 1000)} ago`);
  const cell = (pos, sheet) => `<span class="ca-wbuy-spr" style="background-image:url(${sheet || CA.Util.res('img/icons.png')});background-position:${-pos[0] * 48}px ${-pos[1] * 48}px"></span>`;

  /** A thing's picture: a building's icon, an upgrade's, Buy all upgrades' (the Inspired checklist). */
  function picture(x) {
    const up = (n) => (Game.Upgrades && Game.Upgrades[n]) || null;
    if (x.kind === 'building') {
      const b = (Game.Objects || {})[x.name];
      return b ? cell([b.iconColumn || 0, 0]) : I('building', 12);
    }
    if (x.kind === 'garden') return cell([4, x.icon || 0], CA.Util.res('img/gardenPlants.png'));
    const u = up(x.kind === 'allUpgrades' ? 'Inspired checklist' : x.name);
    return u && u.icon ? cell(u.icon, u.icon[2]) : I('upgrade', 12);
  }
  /** Its name as the game writes it (a building's dname, n of them). */
  function nameOf(x) {
    if (x.kind === 'allUpgrades') return `Buy all upgrades (${(x.names || []).length || x.n || 0})`;
    if (x.kind === 'upgrade') return (Game.Upgrades && Game.Upgrades[x.name] && Game.Upgrades[x.name].dname) || x.name;
    return x.label || x.name;
  }
  const count = (x) => (x.kind === 'building' && x.n > 1 ? `<em>${x.n}</em>` : '');
  const row = (k, v, cls = '') => `<span class="ca-wpop-row${cls}"><span class="ca-wpop-name">${k}</span><span class="ca-wpop-val">${v}</span></span>`;
  const head = (x, sub) => `<span class="ca-wpop-head">${picture(x)}<b>${esc(nameOf(x))}</b></span><span class="ca-wpop-sub">${esc(sub)}</span>`;
  const pop = (inner) => `<span class="ca-wpop ca-wt">${inner}</span>`;
  /** The upgrades Buy all upgrades covers, by name: the first few, wrapping in the card, then how many more. */
  const COVERS = 4;
  function covers(x) {
    const names = x.kind === 'allUpgrades' ? (x.names || []).map((n) => (Game.Upgrades && Game.Upgrades[n] && Game.Upgrades[n].dname) || n) : [];
    if (!names.length) return '';
    const more = names.length - COVERS;
    return row('upgrades', esc(names.slice(0, more > 1 ? COVERS : names.length).join(', ')) + (more > 1 ? ` <i>and ${more} more</i>` : ''), ' ca-wbuy-covers');
  }

  /** A threshold's picture (what the Payback page's queue draws it with). */
  const bankPicture = (x) => `<span class="ca-wbuy-ico">${CA.UI.AutoBuyerCard.bankIcon(x.name, 18)}</span>`;
  const scoreText = (x) => (x.first ? 'first' : Number.isFinite(x.score) ? String(Math.round(x.score)) : '—');

  /** Saving up for a threshold the bank doesn't cover yet: that, how far along, why it comes first, and what's after it. */
  function savingHtml(p, q, w) {
    const f = q.next;
    const cookies = Game.cookies || 0;
    const pct = w.price > 0 ? Math.max(0, Math.min(1, cookies / w.price)) : 1;
    const wait = P().timeTo(w.price);
    const when = Number.isFinite(wait) ? `in ${F().span(wait)}` : 'not at this income';
    const title = `Saving: ${w.label.replace(/^Keep /, '')}`;
    const rows =
      row('keeps', F().beautify(w.price)) +
      row('saved', `${(pct * 100).toFixed(0)}%`) +
      row('kept', when) +
      row('why first', esc(B().whyText(w, q))) +
      (w.detail ? row('plants', esc(w.detail), ' ca-wbuy-covers') : '') +
      (f ? row('then', `${esc(nameOf(f))} <i>(${F().short(f.price)} · score ${scoreText(f)})</i>`) : '');
    return (
      `<span class="ca-wbuy-item ca-wbuy-next saving" data-pop aria-label="${esc(title)}">${bankPicture(w)}` +
      `<span class="ca-wpop ca-wt"><span class="ca-wpop-head">${bankPicture(w)}<b>${esc(title)}</b></span><span class="ca-wpop-sub">${esc(`Kept before buying more · ${p.name} profile`)}</span>${rows}</span>` +
      '</span>' +
      `<span class="ca-wbuy-text"><b data-tip="${esc(title)}">${esc(title)}</b>` +
      `<span>${F().short(w.price)} · ${w.at === 'first' ? 'kept first' : `before scores under ${w.at}`}${f ? ` · then ${esc(nameOf(f))}` : ''}</span>` +
      `<span class="ca-wbuy-when"><span class="ca-wbuy-bar saving"><i style="width:${(pct * 100).toFixed(1)}%"></i></span><i>${esc(when)}</i></span></span>`
    );
  }

  function nextHtml(p) {
    const q = B().queue();
    if (q.wait && q.wait.kind === 'bank') return savingHtml(p, q, q.wait);
    const f = B().next();
    if (!f) return `<span class="ca-wbuy-item ca-wbuy-next none">${I('dollar', 14)}</span><span class="ca-wbuy-text"><b>Nothing to buy</b><span>${esc(B().readiness().text)}</span></span>`;
    const keep = q.keep;
    const ahead = q.items.slice(0, Math.max(0, q.items.indexOf(f))).filter((y) => CA.AutoBuyer.holdsBack(y, f));
    const need = f.price + keep;
    const pct = need > 0 ? Math.max(0, Math.min(1, (Game.cookies || 0) / need)) : 1;
    const wait = P().timeTo(need);
    const when = pct >= 1 ? 'now' : Number.isFinite(wait) ? `in ${F().span(wait)}` : 'not at this income';
    const rows =
      row('price', F().beautify(f.price)) +
      row('payback period', esc(F().payback(f.pp))) +
      row('score', `${scoreText(f)}${Number.isFinite(f.ipp) && f.ipp !== f.pp ? ` <i>(implied PP ${esc(F().payback(f.ipp))})</i>` : ''}`) +
      row('why next', esc(B().whyText(f, q))) +
      (Number.isFinite(f.gain) ? row('CpS', `+${F().short(f.gain)}/s`) : '') +
      row('affordable', when) +
      (keep > 0 ? row('keeps in the bank', `${F().short(keep)}${ahead.length ? ` <i>(${esc(ahead.map((y) => y.label.replace(/^Keep /, '')).join(', '))})</i>` : ''}`) : '') +
      (f.rules && f.rules.length ? row('rules', esc(f.rules.join(', '))) : '') +
      covers(f);
    return (
      `<span class="ca-wbuy-item ca-wbuy-next${pct >= 1 ? ' can' : ''}" data-pop aria-label="${esc(`Next: ${nameOf(f)}`)}">${picture(f)}${count(f)}` +
      pop(head(f, `Next · ${p.name} profile`) + rows) +
      '</span>' +
      `<span class="ca-wbuy-text"><b data-tip="${esc(nameOf(f))}">${esc(nameOf(f))}</b>` +
      `<span>${F().short(f.price)} · PP ${esc(F().payback(f.pp))} · score ${scoreText(f)}</span>` +
      `<span class="ca-wbuy-when"><span class="ca-wbuy-bar${pct >= 1 ? ' can' : ''}"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>` +
      `${pct >= 1 ? '<i class="ok">affordable now</i>' : `<i>${esc(when)}${keep > 0 ? ' (after what it keeps)' : ''}</i>`}</span></span>`
    );
  }

  function pastHtml() {
    const done = B().recentBought().slice(0, PAST).reverse();
    if (!done.length) return '<span class="ca-wbuy-none">nothing bought yet</span>';
    return done
      .map((x) => {
        const rows = row('paid', F().beautify(x.price)) + row('payback period', esc(F().payback(x.pp))) + (Number.isFinite(x.gain) ? row('CpS', `+${F().short(x.gain)}/s`) : '') + covers(x);
        return (
          `<span class="ca-wbuy-item ca-wbuy-past${Date.now() - x.t < HOT_MS ? ' hot' : ''}" data-pop aria-label="${esc(`Bought ${nameOf(x)}`)}">` +
          `${picture(x)}${count(x)}` +
          pop(head(x, `Bought ${ago(x.t)}${x.profile ? ` · ${x.profile} profile` : ''}`) + rows) +
          '</span>'
        );
      })
      .join('');
  }

  /** The row's HTML. */
  function html() {
    try {
      const p = B().find();
      return (
        `<div class="ca-wbuy" data-w-open="payback">` +
        `<div class="ca-mw-head"><span>Auto buyer</span><em>${esc(p ? `${p.name} profile` : '')}</em></div>` +
        `<div class="ca-wbuy-line"><span class="ca-wbuy-past-list" data-tip="What it bought last (newest on the right)">${pastHtml()}</span><span class="ca-wbuy-arrow">›</span>${p ? nextHtml(p) : ''}</div>` +
        '</div>'
      );
    } catch (e) {
      return ''; // the game isn't ready yet: drawn on the next refresh
    }
  }

  return { html, PAST };
})();
