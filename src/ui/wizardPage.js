// The Grimoire page (Wizard tower minigame; page id 'wizard'), plus a small toolbar inside the game's
// own Grimoire.
//
//   Grimoire       magic meter (now / max, refill per second, time to full), spells cast
//   Spells         every spell: cost, backfire chance, Cast button (or how long until it's
//                  affordable), ★ for its own button on the left panel — each is a built-in macro
//   Auto-cast      the built-in "Force the Hand of Fate on combos" macro, and any of your
//                  own repeat/when macros that cast spells
//   Cast tiers     when the auto-cast casts: combos in tiers, each at a share of the magic bar, as
//                  Grimoire profiles (ui/castTiersCard.js)
//   Spell combos   your "once" macros that cast spells — New combo starts one in the editor
//   Magic          magic over time, with every cast marked
//
// The Grimoire toolbar sits under the Grimoire's own info line: the auto-cast switch and a button
// that opens this page. Like the Bank toolbar it reaches into the minigame's DOM (#grimoireInfo)
// and quietly disappears if that markup ever changes.

CA.UI = CA.UI || {};

CA.UI.WizardPage = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const G = () => CA.Grimoire;
  const TOOLBAR_ID = 'cm-grimoire-toolbar';
  const SYNC_MS = 500;

  let root = null;
  let life = null; // the mounted page (CA.UI.Pages.scope)
  let plot = null;

  const usesSpells = (m) => m.steps.some((s) => s.action === 'spell.cast');

  function sprite(icon) {
    return `<span class="ca-spell-ico" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-icon[0] * 48}px ${-icon[1] * 48}px"></span>`;
  }

  // ---- page --------------------------------------------------------------------------------

  function grimoireCard() {
    return (
      '<div class="ca-card">' +
      C().cardHead('Grimoire', 'wizard', `<div class="ca-card-meta"><span class="ca-pill" data-wiz-cast></span>${C().gameLink('Wizard tower')}</div>`) +
      '<div class="ca-magic"><div class="ca-magic-fill" data-wiz-fill></div><div class="ca-magic-text" data-wiz-text></div></div>' +
      '<div class="ca-stats" data-wiz-stats></div>' +
      '</div>'
    );
  }

  function spellsCard() {
    return (
      '<div class="ca-card">' +
      C().cardHead('Spells', 'sparkle', `<div class="ca-card-meta"><span class="ca-hint">★ gives a spell its own button on the left panel · hotkeys on the ${C().link('Macros', 'clickers')} page</span></div>`) +
      '<div class="ca-spells">' +
      G()
        .SPELLS.map(
          (s) =>
            `<div class="ca-spell" data-wiz-spell="${esc(s.key)}">` +
            sprite(s.icon) +
            `<div class="ca-spell-name">${esc(s.name)}</div>` +
            '<div class="ca-spell-meta" data-wiz-meta></div>' +
            '<div class="ca-spell-actions">' +
            C().button(`${I('wizard', 12)} Cast`, `data-ca="macro-run" data-id="${s.id}" data-wiz-cast-btn`, 'ca-btn-small ca-btn-run') +
            `<button type="button" class="ca-iconbtn ca-fav" data-ca="macro-fav" data-id="${s.id}" data-wiz-fav data-tip="Favorite: its own button on the left panel">${I('starOutline', 14)}</button>` +
            '</div></div>'
        )
        .join('') +
      '</div></div>'
    );
  }

  function html() {
    const M = CA.Macros;
    const mine = M.list().filter((m) => !m.builtin && usesSpells(m));
    const auto = [M.get(G().AUTO_ID)].concat(mine.filter((m) => m.mode !== 'once'));
    const combos = mine.filter((m) => m.mode === 'once');
    let h = '';
    if (!G().minigame()) {
      h +=
        '<div class="ca-card ca-card-note-only">' +
        C().cardHead('Grimoire', 'wizard') +
        '<div class="ca-card-note">The Grimoire minigame opens once you have a level-1 Wizard tower (spend a sugar lump on it). Your spell macros are ready for when it does.</div>' +
        '</div>';
    } else h += grimoireCard() + spellsCard();
    h +=
      '<div class="ca-card">' +
      C().cardHead('Auto-cast', 'bolt', '<div class="ca-card-meta"><button type="button" class="ca-btn ca-btn-small" data-ca="open-macros">All macros</button></div>') +
      `<div class="ca-list">${auto.map(CA.UI.MacrosPage.row).join('')}</div>` +
      '</div>' +
      CA.UI.CastTiers.html() +
      '<div class="ca-card">' +
      C().cardHead('Spell combos', 'sparkle', `<div class="ca-card-meta">${C().button(`${I('plus', 12)} New combo`, 'data-wiz-newcombo', 'ca-btn-small')}</div>`) +
      (combos.length
        ? `<div class="ca-list">${combos.map(CA.UI.MacrosPage.row).join('')}</div>`
        : '<div class="ca-card-note">A combo casts several spells in one go — one button, one hotkey, or its own button on the left panel. It casts each spell in order, skipping any you can’t afford yet.</div>') +
      '</div>';
    h += plot.html();
    h += CA.UI.Menu.optionsCard('Options', 'settings', 'grimoire');
    return h;
  }

  function sync() {
    if (!root || !root.isConnected) return;
    const { span, beautify, tile } = CA.UI.Plot.fmt;
    const mg = G().magicNow();
    if (mg) {
      const fill = root.querySelector('[data-wiz-fill]');
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, (mg.magic / mg.max) * 100))}%`;
      const text = root.querySelector('[data-wiz-text]');
      if (text) text.textContent = `${Math.floor(mg.magic)} / ${Math.floor(mg.max)} magic${mg.perSec ? `  (+${mg.perSec.toFixed(2)}/s)` : ''}`;
      const stats = root.querySelector('[data-wiz-stats]');
      if (stats) {
        stats.innerHTML =
          tile('Magic', `${Math.floor(mg.magic)} / ${Math.floor(mg.max)}`) +
          tile('Refill', mg.perSec ? `+${mg.perSec.toFixed(2)}/s` : 'full') +
          tile('Full in', mg.fullIn === 0 ? 'now' : Number.isFinite(mg.fullIn) ? span(mg.fullIn) : '—') +
          tile('Spells cast', beautify(mg.cast, 0), `${beautify(mg.castTotal, 0)} in total`);
      }
      const pill = root.querySelector('[data-wiz-cast]');
      if (pill) pill.textContent = `${Math.floor((mg.magic / mg.max) * 100)}% magic`;
    }
    const live = {};
    G()
      .spells()
      .forEach((s) => (live[s.key] = s));
    root.querySelectorAll('[data-wiz-spell]').forEach((el) => {
      const s = live[el.dataset.wizSpell];
      if (!s) return;
      el.classList.toggle('ready', s.affordable);
      const meta = el.querySelector('[data-wiz-meta]');
      if (meta) {
        const fail = s.fail == null ? '' : ` · ${Math.round(s.fail * 100)}% backfire`;
        meta.textContent = `${Number.isFinite(s.cost) ? s.cost : '—'} magic${fail}${!s.affordable && Number.isFinite(s.wait) && s.wait > 0 ? ` · ready in ${span(s.wait)}` : ''}`;
      }
      const btn = el.querySelector('[data-wiz-cast-btn]');
      if (btn) btn.classList.toggle('ca-unaffordable', !s.affordable);
      const fav = el.querySelector('[data-wiz-fav]');
      if (fav) {
        const on = CA.Macros.isFav(s.id);
        fav.classList.toggle('on', on);
        fav.innerHTML = I(on ? 'star' : 'starOutline', 14);
      }
    });
    const ct = root.querySelector('[data-ct]');
    const p = CA.CastTiers.current();
    if (ct && p && ct.dataset.ctProfile !== p.id) return CA.UI.Menu.render(); // a macro switched profiles
    CA.UI.CastTiers.sync(root);
    CA.UI.MacrosPage.sync(root);
  }

  function onClick(e) {
    if (CA.UI.CastTiers.onClick(e)) return;
    if (!e.target.closest('[data-wiz-newcombo]')) return;
    e.stopPropagation();
    CA.Util.sound('snd/tick.mp3');
    CA.UI.MacrosPage.edit(null, {
      name: 'Spell combo',
      icon: { ico: 'wizard' },
      mode: 'once',
      steps: [
        { action: 'spell.cast', params: { spell: 'hand of fate' } },
        { action: 'spell.cast', params: { spell: 'stretch time' } },
      ],
    });
  }

  function mount(el) {
    unmount();
    root = el;
    life = CA.UI.Pages.scope(el).on('click', onClick).child(plot);
    CA.UI.CastTiers.bind(life);
    life.add(CA.Events.on('grimoire', () => plot.tick())); // tier lines follow a tier/profile change at once
    sync();
    life.every(SYNC_MS, sync);
  }

  function unmount() {
    if (life) life.close();
    life = null;
    root = null;
  }

  /** Cast tiers of the profile in use: a dashed line each at the magic its threshold needs now. */
  function tierLines() {
    const T = CA.CastTiers;
    const p = T && T.current();
    if (!p || !T.bar()) return [];
    return T.ordered(p).map(({ tier, i }) => {
      const c = CA.UI.CastTiers.colorOf(p, i);
      return { v: T.magicAt(tier.pct), label: `${tier.name} ${tier.pct}%`, color: c, labelColor: c };
    });
  }

  function createPlot() {
    plot = CA.UI.Plot.create({
      id: 'magic',
      title: 'Magic',
      icon: 'wizard',
      height: 160,
      log: false,
      windows: [300, 900, 3600, 10800, 43200, 86400, 0],
      window: 900,
      fmt: (v) => CA.UI.Plot.fmt.beautify(v, 0),
      tipFmt: (v) => `${Math.floor(v)} magic`,
      build(v) {
        const bars = v.bucketize(['magic', 'magicMax']);
        return {
          series: [
            { key: 'magic', name: 'Magic', color: '#b388ff', type: 'area', width: 1.8 },
            { key: 'magicMax', name: 'Maximum', color: '#9db4cc', type: 'line', dash: true },
          ],
          lines: {
            magic: CA.UI.Plot.linePoints(bars, (b) => b.v.magic),
            magicMax: CA.UI.Plot.linePoints(bars, (b) => b.v.magicMax),
          },
          hlines: tierLines(),
          markers: CA.EventLog.list(['spell'])
            .filter((ev) => {
              const x = v.active ? ev.a : ev.t;
              return x >= v.x0 && x <= v.x1;
            })
            .map((ev) => ({
              x: v.active ? ev.a : ev.t,
              color: ev.data && ev.data.backfired ? '#e5484d' : '#b388ff',
              tip: () => `<div class="ca-tip-head">${esc(ev.title)}<span>${CA.UI.Plot.fmt.clock(ev.t, true)}</span></div>`,
            })),
          empty: 'Open the Grimoire (Wizard tower minigame) to start recording magic.',
        };
      },
    });
  }

  // ---- toolbar inside the Grimoire -------------------------------------------------------------

  function toolbarSync() {
    const info = G().minigame() ? document.getElementById('grimoireInfo') : null;
    let bar = document.getElementById(TOOLBAR_ID);
    if (!info || !CA.Settings.get('grimoireToolbar')) {
      if (bar) bar.remove();
      return;
    }
    if (bar && bar.previousElementSibling !== info) {
      bar.remove();
      bar = null;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = TOOLBAR_ID;
      bar.innerHTML =
        '<div class="cm-gt-btn" data-cm-gt="auto"></div>' +
        `<div class="cm-gt-btn cm-gt-open" data-cm-gt="open" data-tip="Open the cookieMgr Grimoire page">${I('open', 12)}cookieMgr</div>`;
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cm-gt]');
        if (!b) return;
        if (b.dataset.cmGt === 'auto') {
          CA.Util.sound(CA.Macros.isOn(G().AUTO_ID) ? 'snd/clickOff2.mp3' : 'snd/clickOn2.mp3');
          CA.Macros.toggle(G().AUTO_ID);
        } else CA.UI.Menu.openPage('wizard');
        toolbarSync();
      });
      info.insertAdjacentElement('afterend', bar);
    }
    const on = CA.Macros.isOn(G().AUTO_ID);
    const auto = bar.querySelector('[data-cm-gt="auto"]');
    auto.innerHTML = `${I('bolt', 12)}Auto FtHoF on combos: ${on ? 'on' : 'off'}`;
    auto.classList.toggle('on', on);
    const d = on && CA.CastTiers.decide();
    auto.dataset.tip = `Casts Force the Hand of Fate when a combo is on and magic has reached its tier (Cast tiers on the cookieMgr Grimoire page) — same switch as there${d ? ` · now: ${CA.CastTiers.comboName(d.combo)}, ${d.ready ? 'casting' : `waits for ${d.tier.name} at ${d.tier.pct}%`}` : ''}`;
  }

  function init() {
    CA.Settings.defineOption({
      key: 'grimoireToolbar',
      group: 'grimoire',
      icon: 'toolbar',
      name: 'Toolbar in the Grimoire',
      desc: 'Adds the auto-cast switch and a cookieMgr button under the Grimoire’s own info line.',
      default: true,
    });
    createPlot();
    CA.UI.Pages.register({ id: 'wizard', label: 'Grimoire', icon: 'wizard', order: 60, group: 'minigames', html, mount, unmount, tick: sync });
    CA.Events.on('macros', toolbarSync);
    CA.Events.on('settings', (k) => (k === 'grimoireToolbar' || k === null) && toolbarSync());
    setInterval(toolbarSync, 1000);
  }

  return { init, sync };
})();
