// The Cast tiers card on the Grimoire page: when "Force the Hand of Fate on combos" casts.
//
//   Profiles    a tab each (the one in use lit; click one to use it), Copy / New / a trash can; the profile
//               in use: its name, its id (for grimoire.profile(id)), and Time left — how long every
//               effect of a combo must still last
//   Magic bar   magic now, the spell's cost (hatched: below it nothing casts), a mark per tier
//   Tiers       lowest threshold first: name, threshold slider (0% the spell's cost, 100% full), the magic
//               that is, how long a cast there takes to refill back to it, whether it's casting or
//               waiting, a trash can; its combos as icons (full names on hover; drag one onto another tier
//               to move it), + Add combo opens the effect picker
//
// The logic and the saved profiles are features/castTiers.js; the Grimoire page (ui/wizardPage.js)
// puts this card in and passes its events here.

CA.UI = CA.UI || {};

CA.UI.CastTiers = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const T = () => CA.CastTiers;
  const COLORS = ['#f2cf73', '#c9a6ff', '#7cc8ff', '#5fd39a', '#ff9f43', '#ff6fae'];

  let picking = null; // the effect picker: { profile, tier: i, picks: [key…] } or null
  let dragging = null; // a combo being dragged: { tier: i, combo: j }

  const sprite = (icon) =>
    `<span class="ca-god-ico" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-icon[0] * 48}px ${-icon[1] * 48}px"></span>`;
  const effectIco = (k) => {
    const e = T().effect(k);
    return `<span class="ca-ct-fx">${sprite(e.icon)}<b>${esc(e.abbr)}</b></span>`;
  };
  const comboIcons = (c) => c.map(effectIco).join('<span class="ca-ct-plus">+</span>');
  const span = (s) => (s === 0 ? 'now' : Number.isFinite(s) ? CA.Format.span(s) : 'never');
  /** A tier's color: by its place, lowest threshold first. */
  function colorOf(p, i) {
    const rank = T()
      .ordered(p)
      .findIndex((x) => x.i === i);
    return COLORS[Math.max(0, rank) % COLORS.length];
  }

  // ---- parts -----------------------------------------------------------------------------------

  function profilesHtml(p) {
    const tabs = T()
      .list()
      .map(
        (x) =>
          `<button type="button" class="ca-ct-prof${x === p ? ' on' : ''}" data-ct-act="use" data-id="${esc(x.id)}" data-tip="${esc(x === p ? 'In use' : 'Use this profile')} · for macros: grimoire.profile(${esc(x.id)})">${esc(x.name)}</button>`
      )
      .join('');
    return (
      `<div class="ca-ct-profiles"><span class="ca-ct-lbl">Profile</span>${tabs}<span class="ca-ct-acts">` +
      C().button(`${I('plus', 12)} Copy`, 'data-ct-act="copy" data-tip="A new profile, a copy of this one"', 'ca-btn-small') +
      C().button(`${I('plus', 12)} New`, 'data-ct-act="new" data-tip="A new profile: the two tiers, no combos yet"', 'ca-btn-small') +
      (T().list().length > 1 ? C().trash(`data-ct-act="delprof" data-id="${esc(p.id)}"`, 'Delete this profile?', 'Delete this profile') : '') +
      '</span></div>' +
      '<div class="ca-ct-setup">' +
      `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-ct-name aria-label="Profile name"><code data-tip="Its id, for macros: grimoire.profile(${esc(p.id)})">${esc(p.id)}</code>` +
      `<label class="ca-ct-left" data-tip="Every effect of a combo must last at least this much longer, so the golden cookie the spell brings still finds them">Time left ≥ <input type="range" min="0" max="${T().MAX_LEFT}" step="1" value="${p.minLeft}" data-ct-left aria-label="Time left"><output data-ct-left-out>${p.minLeft}s</output></label>` +
      '</div>'
    );
  }

  function meterHtml(p) {
    const b = T().bar();
    if (!b) return '<div class="ca-card-note">The Grimoire opens with a level-1 Wizard tower. The tiers are ready for when it does.</div>';
    const pctOf = (m) => Math.max(0, Math.min(100, (m / b.max) * 100));
    const cost = pctOf(b.cost);
    const at = (t) => pctOf(T().magicAt(t.pct));
    const ord = T().ordered(p);
    return (
      '<div class="ca-ct-meter">' +
      `<div class="ca-ct-clip"><div class="ca-ct-fill" style="width:${pctOf(b.magic)}%"></div><div class="ca-ct-cost" style="width:${cost}%"></div></div>` +
      `<div class="ca-ct-text">${Math.floor(b.magic)} / ${Math.floor(b.max)} magic</div>` +
      ord.map(({ tier, i }) => `<div class="ca-ct-tick" style="left:${at(tier)}%;--c:${colorOf(p, i)}"></div>`).join('') +
      '</div>' +
      `<div class="ca-ct-lane">${ord
        .map(({ tier, i }) => {
          const x = at(tier);
          return `<span class="ca-ct-tlabel${x > 85 ? ' left' : x < 12 ? ' right' : ''}" style="left:${x}%;--c:${colorOf(p, i)}">${esc(tier.name)} ${tier.pct}%</span>`;
        })
        .join('')}</div>` +
      `<div class="ca-ct-scale"><span style="left:0">0</span><span class="mid" style="left:${cost}%">cost <b>${b.cost}</b></span><span style="right:0">max <b>${Math.floor(b.max)}</b></span></div>`
    );
  }

  const absText = (pct) => (pct === 0 ? 'when affordable' : pct === 100 ? 'full bar' : T().bar() ? `≥ ${Math.ceil(T().magicAt(pct))} magic` : '');
  const rechargeText = (pct) => {
    const s = T().recharge(pct);
    return s == null ? '' : `↻ back in ${span(s)}`;
  };

  /** A tier's live bits: whether it's casting or waiting, and how long a cast there takes to refill. */
  function statusHtml(p, i, d) {
    if (!d || d.i !== i || !T().isActive(p)) return '';
    if (d.ready) return '<span class="ca-pill on">casting</span>';
    const b = T().bar();
    return `<span class="ca-pill ca-ct-wait">combo on · ${b && b.magic < b.cost ? 'not enough magic' : `waits for ${d.tier.pct}%`}</span>`;
  }

  function tierHtml(p, i, d, on) {
    const t = p.tiers[i];
    const chips = t.combos
      .map(
        (c, j) =>
          `<span class="ca-ct-combo${T().comboOn(c, on) ? ' match' : ''}" draggable="true" data-ct-combo="${i}:${j}" data-tip="${esc(T().comboName(c))}">${comboIcons(c)}` +
          `<button type="button" class="ca-ct-x" data-ct-act="rm" data-tier="${i}" data-combo="${j}" aria-label="Remove ${esc(T().comboName(c))}">×</button></span>`
      )
      .join('');
    return (
      `<div class="ca-ct-tier${d && d.ready && d.i === i ? ' firing' : ''}" style="--c:${colorOf(p, i)}" data-ct-tier="${i}">` +
      '<div class="ca-ct-body"><div class="ca-ct-top">' +
      `<input type="text" class="ca-ct-tname" maxlength="40" value="${esc(t.name)}" data-ct-tname="${i}" aria-label="Tier name">` +
      '<div class="ca-ct-thresh">' +
      `<input type="range" min="0" max="100" step="5" value="${t.pct}" data-ct-pct="${i}" aria-label="${esc(t.name)}: threshold">` +
      `<output data-ct-pct-out>${t.pct}%</output><span class="ca-ct-abs" data-ct-abs>${absText(t.pct)}</span>` +
      `<span class="ca-ct-recharge" data-ct-recharge data-tip="After a cast at ${t.pct}%, how long magic takes to climb back to ${t.pct}% (at today’s maximum)">${rechargeText(t.pct)}</span>` +
      '</div>' +
      `<span class="ca-ct-acts"><span data-ct-status>${statusHtml(p, i, d)}</span>` +
      C().trash(`data-ct-act="deltier" data-tier="${i}"`, 'Delete this tier?', 'Delete this tier') +
      '</span></div>' +
      `<div class="ca-ct-combos">${chips || '<span class="ca-hint">No combos yet — add one, or drag one here.</span>'}` +
      `<button type="button" class="ca-ct-add" data-ct-act="pick" data-tier="${i}">${I('plus', 11)} Add combo</button></div>` +
      (picking && picking.profile === p.id && picking.tier === i ? pickerHtml(p, i) : '') +
      '</div></div>'
    );
  }

  function pickerHtml(p, i) {
    const picks = picking.picks;
    const n = (k) => picks.filter((x) => x === k).length;
    const tiles = T()
      .EFFECTS.map((e) => {
        const c = n(e.key);
        return (
          `<button type="button" class="ca-ct-tile${c ? ' on' : ''}" data-ct-act="toggle" data-key="${esc(e.key)}">` +
          `${sprite(e.icon)}<span class="ca-ct-tile-text"><b>${esc(e.name)}</b>${e.key === 'building special' ? '<small>click again for two</small>' : ''}</span>` +
          `<em>${c > 1 ? `×${c}` : c ? '✓' : ''}</em></button>`
        );
      })
      .join('');
    const where = picks.length ? T().tierOf(p, picks) : -1;
    return (
      '<div class="ca-ct-picker">' +
      `<div class="ca-ct-picker-head"><b>New combo for ${esc(p.tiers[i].name)}</b><span class="ca-hint">the effects that must all be on</span></div>` +
      `<div class="ca-ct-grid">${tiles}</div>` +
      '<div class="ca-ct-picker-foot">' +
      `<span class="ca-ct-preview">${picks.length ? comboIcons(T().EFFECTS.map((e) => e.key).flatMap((k) => picks.filter((x) => x === k))) : '<span class="ca-hint">nothing picked yet</span>'}</span>` +
      (where >= 0 ? `<span class="ca-hint">already in ${esc(p.tiers[where].name)}</span>` : '') +
      '<span class="ca-ct-acts">' +
      C().button('Cancel', 'data-ct-act="cancel"', 'ca-btn-small') +
      C().button('Add combo', `data-ct-act="add"${picks.length && where < 0 ? '' : ' disabled'}`, 'ca-btn-small ca-btn-run') +
      '</span></div></div>'
    );
  }

  function nowText() {
    const b = T().bar();
    if (!b) return '';
    return b.magic < b.cost ? `${Math.floor(b.magic)} magic · not enough yet` : `${Math.floor(T().fill())}% up the bar`;
  }

  function html() {
    const p = T().current();
    if (!p) return '';
    const d = T().decide();
    const on = T().effectsOn(p.minLeft);
    return (
      `<div class="ca-card ca-gardener ca-ct" data-ct data-ct-profile="${esc(p.id)}">` +
      C().cardHead('Cast tiers', 'sparkle', `<div class="ca-card-meta"><span class="ca-pill" data-ct-now>${nowText()}</span><span class="ca-hint">0% = the spell’s cost · 100% = a full bar</span></div>`) +
      profilesHtml(p) +
      `<div class="ca-ct-meter-block" data-ct-meter>${meterHtml(p)}</div>` +
      `<div class="ca-ct-tiers">${T()
        .ordered(p)
        .map(({ i }) => tierHtml(p, i, d, on))
        .join('')}</div>` +
      '<div class="ca-ct-foot">' +
      C().button(`${I('plus', 12)} New tier`, 'data-ct-act="addtier"', 'ca-btn-small') +
      '<span class="ca-hint">Drag a combo onto another tier to move it. A combo is on when at least its effects are (others can be on too); the lowest tier with one on decides.</span>' +
      '</div></div>'
    );
  }

  // ---- live ------------------------------------------------------------------------------------

  function sync(root) {
    const card = root && root.querySelector('[data-ct]');
    const p = T().current();
    if (!card || !p) return;
    const d = T().decide();
    const on = T().effectsOn(p.minLeft);
    const now = card.querySelector('[data-ct-now]');
    if (now) {
      now.textContent = nowText();
      now.classList.toggle('on', !!(d && d.ready));
      now.classList.toggle('ca-ct-wait', !!d && !d.ready);
    }
    const meter = card.querySelector('[data-ct-meter]');
    if (meter && !dragging) CA.UI.Dom.morph(meter, meterHtml(p));
    card.querySelectorAll('[data-ct-tier]').forEach((el) => {
      const i = Number(el.dataset.ctTier);
      const t = p.tiers[i];
      if (!t) return;
      el.classList.toggle('firing', !!(d && d.ready && d.i === i));
      const st = el.querySelector('[data-ct-status]');
      if (st) CA.UI.Dom.morph(st, statusHtml(p, i, d));
      const rc = el.querySelector('[data-ct-recharge]');
      if (rc) rc.textContent = rechargeText(t.pct);
      const abs = el.querySelector('[data-ct-abs]');
      if (abs) abs.textContent = absText(t.pct);
    });
    card.querySelectorAll('[data-ct-combo]').forEach((el) => {
      const [i, j] = el.dataset.ctCombo.split(':').map(Number);
      const c = p.tiers[i] && p.tiers[i].combos[j];
      el.classList.toggle('match', !!c && T().comboOn(c, on));
    });
  }

  // ---- events (the Grimoire page passes them on) -------------------------------------------------

  const rerender = () => CA.UI.Menu.render();

  function onClick(e) {
    const t = e.target.closest('[data-ct-act]');
    if (!t || !t.closest('[data-ct]')) return false;
    e.stopPropagation();
    const d = t.dataset;
    const p = T().current();
    if ((d.ctAct === 'delprof' || d.ctAct === 'deltier') && !CA.UI.Dom.armed(t)) return true;
    switch (d.ctAct) {
      case 'use':
        T().use(d.id);
        picking = null;
        break;
      case 'copy':
        T().add(null, p.id);
        picking = null;
        break;
      case 'new':
        T().add();
        picking = null;
        break;
      case 'delprof':
        T().remove(d.id);
        picking = null;
        break;
      case 'addtier':
        T().addTier(p.id);
        break;
      case 'deltier':
        T().removeTier(p.id, Number(d.tier));
        picking = null;
        break;
      case 'rm':
        T().removeCombo(p.id, Number(d.tier), Number(d.combo));
        break;
      case 'pick':
        picking = picking && picking.profile === p.id && picking.tier === Number(d.tier) ? null : { profile: p.id, tier: Number(d.tier), picks: [] };
        break;
      case 'cancel':
        picking = null;
        break;
      case 'toggle': {
        if (!picking) return true;
        const k = d.key;
        const n = picking.picks.filter((x) => x === k).length;
        if (k === 'building special' && n === 1) picking.picks.push(k);
        else if (n) picking.picks = picking.picks.filter((x) => x !== k);
        else picking.picks.push(k);
        break;
      }
      case 'add':
        if (!picking || !T().addCombo(p.id, picking.tier, picking.picks)) {
          CA.UI.Dom.replay(t, 'ca-shake', 400);
          return true;
        }
        picking = null;
        break;
      default:
        return true;
    }
    CA.Util.sound('snd/tick.mp3');
    rerender();
    return true;
  }

  /** A slider moving: its labels follow at once (saved and redrawn when it's let go). */
  function onInput(e) {
    const el = e.target;
    const p = T().current();
    if (!p || !el.closest || !el.closest('[data-ct]')) return;
    if (el.dataset.ctPct != null) {
      const i = Number(el.dataset.ctPct);
      p.tiers[i].pct = Number(el.value); // live: change() saves it
      const row = el.closest('[data-ct-tier]');
      row.querySelector('[data-ct-pct-out]').textContent = `${el.value}%`;
      row.querySelector('[data-ct-abs]').textContent = absText(Number(el.value));
      row.querySelector('[data-ct-recharge]').textContent = rechargeText(Number(el.value));
      const meter = el.closest('[data-ct]').querySelector('[data-ct-meter]');
      if (meter) CA.UI.Dom.morph(meter, meterHtml(p));
    } else if (el.dataset.ctLeft != null) {
      const out = el.parentNode.querySelector('[data-ct-left-out]');
      if (out) out.textContent = `${el.value}s`;
    }
  }

  function onChange(e) {
    const el = e.target;
    const p = T().current();
    if (!p || !el.closest || !el.closest('[data-ct]')) return;
    const ds = el.dataset;
    if (ds.ctPct != null) {
      T().updateTier(p.id, Number(ds.ctPct), { pct: el.value });
      rerender(); // tiers sort by threshold
    } else if (ds.ctTname != null) T().updateTier(p.id, Number(ds.ctTname), { name: el.value });
    else if (ds.ctName != null) {
      T().update(p.id, { name: el.value });
      rerender();
    } else if (ds.ctLeft != null) T().update(p.id, { minLeft: el.value });
  }

  // dragging a combo onto another tier
  function onDragStart(e) {
    const el = e.target.closest && e.target.closest('[data-ct-combo]');
    if (!el) return;
    const [tier, combo] = el.dataset.ctCombo.split(':').map(Number);
    dragging = { tier, combo };
    el.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.tip || '');
    }
  }
  const tierAt = (e) => (dragging && e.target.closest ? e.target.closest('[data-ct-tier]') : null);
  const clearDrop = (root) => root.querySelectorAll('.ca-ct-tier.drop').forEach((x) => x.classList.remove('drop'));
  function onDragOver(e, root) {
    const t = tierAt(e);
    if (!t) return;
    clearDrop(root);
    if (Number(t.dataset.ctTier) === dragging.tier) return;
    e.preventDefault();
    t.classList.add('drop');
  }
  function onDrop(e, root) {
    const t = tierAt(e);
    const from = dragging;
    dragging = null;
    clearDrop(root);
    if (!t || !from) return;
    e.preventDefault();
    const p = T().current();
    if (T().moveCombo(p.id, from.tier, from.combo, Number(t.dataset.ctTier))) {
      CA.Util.sound('snd/tick.mp3');
      rerender();
    }
  }
  function onDragEnd(root) {
    dragging = null;
    clearDrop(root);
    root.querySelectorAll('.ca-ct-combo.dragging').forEach((x) => x.classList.remove('dragging'));
  }

  /** Hooks the card's events onto a page scope (CA.UI.Pages.scope). */
  function bind(life) {
    const root = life.root;
    life
      .on('input', onInput)
      .on('change', onChange)
      .on('dragstart', onDragStart)
      .on('dragover', (e) => onDragOver(e, root))
      .on('drop', (e) => onDrop(e, root))
      .on('dragend', () => onDragEnd(root));
  }

  return { html, sync, onClick, bind, colorOf };
})();
