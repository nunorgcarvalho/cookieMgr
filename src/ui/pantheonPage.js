// The Pantheon page (Temple minigame):
//
//   Spirits      the three slots — Diamond, Ruby, Jade — with the spirit in each and what it does in
//                that slot
//   Profiles     named combinations of the three slots (features/pantheon.js): one row each —
//                its name, a spirit per slot, Use (In use when it's on; the swaps
//                it takes on hover), a trash can —
//                and New profile / From current
//   Worship      swaps left, when the next one comes back, how long a swap takes to refill
//   All spirits  every spirit, the slot it's in (if any), and on hover what it does in each slot
//
// The effect texts are the game's own (M.gods[…].desc1–3, descBefore/After); their green/red
// highlights are restyled for the panel.

CA.UI = CA.UI || {};

CA.UI.PantheonPage = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const SLOTS = ['Diamond', 'Ruby', 'Jade'];
  const SYNC_MS = 1000;
  let root = null;
  let life = null; // the mounted page (CA.UI.Pages.scope)
  let slotSig = ''; // the slots when the page was drawn

  function minigame() {
    const t = Game.Objects && Game.Objects.Temple;
    const M = t && t.minigame;
    return M && Array.isArray(M.slot) && M.godsById ? M : null;
  }

  const sprite = (g, cls = '') =>
    `<span class="ca-god-ico ${cls}" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-g.icon[0] * 48}px ${-g.icon[1] * 48}px"></span>`;

  /** "Holobore, Spirit of Asceticism" → ["Holobore", "Spirit of Asceticism"] */
  const nameParts = (g) => {
    const i = String(g.name).indexOf(',');
    return i < 0 ? [g.name, ''] : [g.name.slice(0, i), g.name.slice(i + 1).trim()];
  };

  /** What a spirit does in slot `i` (0–2): the game's own text. */
  const effect = (g, i) => [g.descBefore, g[`desc${i + 1}`], g.descAfter].filter(Boolean).join('<br>');

  function slotsCard(M) {
    let h = '<div class="ca-card">' + C().cardHead('Spirits', 'pantheon', `<div class="ca-card-meta">${C().button(`${I('widget', 12)} Widget`, 'data-ca="widget-add" data-type="pantheon"', 'ca-btn-small')}${C().gameLink('Temple')}</div>`) + '<div class="ca-slots">';
    M.slot.forEach((id, i) => {
      const g = id >= 0 ? M.godsById[id] : null;
      const [name, title] = g ? nameParts(g) : ['', ''];
      h +=
        `<div class="ca-slot ca-slot-${i}">` +
        `<div class="ca-slot-gem">${SLOTS[i]}</div>` +
        (g
          ? `${sprite(g, 'big')}<div class="ca-slot-name">${esc(name)}</div><div class="ca-slot-title">${esc(title)}</div><div class="ca-god-desc">${effect(g, i)}</div>`
          : '<span class="ca-god-ico big empty"></span><div class="ca-slot-name">Empty</div>') +
        '</div>';
    });
    return h + '</div></div>';
  }

  // ---- profiles ----

  const P = () => CA.Pantheon;
  /** A profile's Use button (an "In use" badge when it's slotted); its tip says the swaps it takes. */
  function useHtml(M, p) {
    const on = P().isActive(p.id);
    const n = on ? 0 : P().swapsFor(p.id);
    const tip = on ? '' : !n ? 'Slot it in — free: no worship swap' : `Slot it in — ${n} worship swap${n === 1 ? '' : 's'}${n > M.swaps ? `, ${M.swaps} left now: it waits for the rest` : ''}`;
    return C().useButton(on, `data-pp-act="use" data-id="${esc(p.id)}"`, tip);
  }
  function slotPick(M, p, i) {
    const k = p.slots[i];
    const g = k ? P().godOf(k) : null;
    const opts =
      `<option value=""${k ? '' : ' selected'}>— empty —</option>` +
      M.godsById.map((x) => {
        const key = Object.keys(M.gods || {}).find((y) => M.gods[y] === x) || String(x.id);
        return `<option value="${esc(key)}"${g === x ? ' selected' : ''}>${esc(nameParts(x)[0])}</option>`;
      }).join('');
    return (
      `<label class="ca-pprof-slot ca-slot-${i}" data-tip="${esc(g ? g.name : `${SLOTS[i]}: empty`)}">` +
      (g ? sprite(g) : '<span class="ca-god-ico empty"></span>') +
      `<select data-pp-slot="${esc(p.id)}" data-i="${i}">${opts}</select>` +
      '</label>'
    );
  }
  function profileRow(M, p) {
    const on = P().isActive(p.id);
    return (
      `<div class="ca-pprof${on ? ' on' : ''}" data-pp-row="${esc(p.id)}">` +
      `<input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-pp-name="${esc(p.id)}" data-tip="the profile’s name — macros use it, or its id: ${esc(p.id)}">` +
      `<div class="ca-pprof-slots">${[0, 1, 2].map((i) => slotPick(M, p, i)).join('')}</div>` +
      '<span class="ca-pprof-end">' +
      `<span class="ca-use-slot" data-pp-status="${esc(p.id)}">${useHtml(M, p)}</span>` +
      C().trash(`data-pp-act="delete" data-id="${esc(p.id)}"`, 'Delete it?', 'Delete this profile') +
      '</span></div>'
    );
  }
  function profilesCard(M) {
    const ps = P().profiles();
    return (
      '<div class="ca-card ca-pprofs">' +
      C().cardHead('Profiles', 'save', '<div class="ca-card-meta"><span class="ca-hint">macros: pantheon.profile(golden)</span></div>') +
      (ps.length ? ps.map((p) => profileRow(M, p)).join('') : '<div class="ca-card-note">No profiles. Make one from what’s slotted now, or a new one to fill in.</div>') +
      '<div class="ca-pprof-foot">' +
      C().button(`${I('plus', 12)} New profile`, 'data-pp-act="new"', 'ca-btn-small') +
      C().button(`${I('pantheon', 12)} From current`, 'data-pp-act="current"', 'ca-btn-small') +
      '<span class="ca-hint">Use swaps in what differs, a worship swap each; without swaps it waits.</span>' +
      '</div></div>'
    );
  }

  function swapInfo(M) {
    const wait = M.swaps === 0 ? 16 * 3600 : M.swaps === 1 ? 4 * 3600 : 3600;
    const next = M.swaps < 3 ? Math.max(0, (M.swapT + wait * 1000 - Date.now()) / 1000) : null;
    return { wait, next };
  }

  function worshipHtml(M) {
    const { span, tile } = CA.UI.Plot.fmt;
    const { wait, next } = swapInfo(M);
    const pips = [0, 1, 2].map((i) => `<i class="${i < M.swaps ? 'on' : ''}"></i>`).join('');
    return (
      tile('Worship swaps', `<span class="ca-pips">${pips}</span> ${M.swaps} / 3`) +
      tile('Next swap in', next == null ? 'all ready' : span(next), next == null ? '' : `refills ${span(wait)} after a swap with ${M.swaps} left`) +
      tile('Refill times', '1h · 4h · 16h', 'with 2 · 1 · 0 swaps left')
    );
  }

  function worshipCard(M) {
    return '<div class="ca-card">' + C().cardHead('Worship', 'clock') + `<div class="ca-stats" data-pan-worship>${worshipHtml(M)}</div></div>`;
  }

  function godsCard(M) {
    let h = '<div class="ca-card">' + C().cardHead('All spirits', 'sparkle') + '<div class="ca-gods">';
    M.godsById.forEach((g, id) => {
      const at = M.slot.indexOf(id);
      const [name] = nameParts(g);
      h +=
        `<div class="ca-god${at >= 0 ? ` in slot-${at}` : ''}" data-pop>${sprite(g)}<span class="ca-god-name">${esc(name)}</span>` +
        (at >= 0 ? `<span class="ca-god-slot">${SLOTS[at]}</span>` : '') +
        `<span class="ca-gpop"><span class="ca-wpop-head"><b>${esc(g.name)}</b></span>` +
        SLOTS.map((s, i) => `<span class="ca-god-row"><em>${s}</em><span class="ca-god-desc">${effect(g, i)}</span></span>`).join('') +
        (g.quote ? `<span class="ca-god-quote">${esc(g.quote)}</span>` : '') +
        '</span></div>';
    });
    return h + '</div></div>';
  }

  function html() {
    const M = minigame();
    if (!M)
      return (
        '<div class="ca-card ca-card-note-only">' +
        C().cardHead('Pantheon', 'pantheon') +
        '<div class="ca-card-note">The Pantheon opens once you have a level-1 Temple (spend a sugar lump on it).</div>' +
        '</div>'
      );
    return slotsCard(M) + profilesCard(M) + worshipCard(M) + godsCard(M);
  }

  function sync() {
    if (!root || !root.isConnected) return;
    const M = minigame();
    const el = M && root.querySelector('[data-pan-worship]');
    if (el) CA.UI.Dom.morph(el, worshipHtml(M));
    // the slots changed (in the Temple, or by a macro): the page again; else the profiles' states
    const sig = M ? M.slot.join() : '';
    if (sig !== slotSig) return CA.UI.Menu.render();
    if (!M) return;
    root.querySelectorAll('[data-pp-status]').forEach((st) => {
      const p = P().profileOf(st.dataset.ppStatus);
      if (p) CA.UI.Dom.morph(st, useHtml(M, p));
    });
  }

  function onClick(e) {
    const t = e.target.closest('[data-pp-act]');
    if (!t || !root.contains(t)) return;
    e.stopPropagation();
    const { ppAct: act, id } = t.dataset;
    if (act === 'delete') {
      if (!CA.UI.Dom.armed(t)) return;
      P().remove(id);
    } else if (act === 'use') P().apply(id);
    else if (act === 'new') P().add('New profile', ['', '', '']);
    else if (act === 'current') P().add('From current');
    CA.Util.sound('snd/tick.mp3');
    CA.UI.Menu.render();
  }
  function onChange(e) {
    const d = e.target.dataset || {};
    if (d.ppSlot) P().setSlot(d.ppSlot, Number(d.i), e.target.value);
    else if (d.ppName) P().rename(d.ppName, e.target.value);
    else return;
    CA.UI.Menu.render();
  }

  function mount(el) {
    unmount();
    root = el;
    const M = minigame();
    slotSig = M ? M.slot.join() : '';
    sync();
    life = CA.UI.Pages.scope(el).on('click', onClick).on('change', onChange).every(SYNC_MS, sync);
  }
  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  function init() {
    CA.UI.Pages.register({ id: 'pantheon', label: 'Pantheon', icon: 'pantheon', order: 50, group: 'minigames', html, mount, unmount, tick: sync });
  }

  return { init };
})();
