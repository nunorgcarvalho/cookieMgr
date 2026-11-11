// The **Manager** widget: what the active manager (features/managers.js) is doing, on the left
// panel. You pick the parts in its settings (each a live tile, as the widget draws it):
//
//   stages     its stages in a strip: done ✓, the one it's on (with its name), still to come
//   now        the stage it's on, for how long, its profiles (in ✓, or what they still wait for), and a
//              warning while the Manager macro is switched off (under the strip: only for how long — the
//              strip already names the stage and where it is)
//   until      what moves it on: each condition of the stage's "until", ticked once it holds, a season's
//              drops counted with a bar (Christmas upgrades 12/21) — so you see how far it is — or, with
//              few left, named (the reindeer cookies still to get) (left out on the last stage under the
//              strip: nothing moves it on)
//   watch      the stage's own numbers: its watch list (Managers page, under each stage) — Nunix late
//              game's are the research, the next reindeer, the combo and magic… (not what the "until" counts)
//   buyer      while the stage has the Auto buyer on (itself, or in a group; even with the Manager macro
//              off): the last three things it bought and what it buys next, big — price, payback period, when,
//              a bar (ui/buyerRow.js); hover a picture for more
//   macros     the macros on in this stage (its own and those carried over), pulsing while they work
//              (dim: off now); hover one for what its actions have done
//   activity   the last few things those macros did, newest first
//
// It always follows the active manager; its title is that manager's name. Click the strip or the stage
// to open the Managers page. The Managers page's ☆ puts one on the left panel.

CA.UI = CA.UI || {};

CA.UI.ManagerWidget = (() => {
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const F = () => CA.UI.Plot.fmt;
  const G = () => CA.Managers;
  const HOT_MS = 1500;
  const ACTIVITY = 4;

  const PARTS = [
    { v: 'stages', label: 'Stages', tip: 'Its stages in a strip: done, the one it’s on, still to come' },
    { v: 'buyer', label: 'Auto buyer', tip: 'While the stage has the Auto buyer on: the last three things it bought and what it buys next' },
    { v: 'now', label: 'Now', tip: 'The stage it’s on, for how long, and its profiles: in, or what they still wait for' },
    { v: 'until', label: 'Next stage when', tip: 'What moves it on: each condition of the stage’s “until”, ticked once it holds' },
    { v: 'watch', label: 'Watching', tip: 'The stage’s own numbers (its watch list, on the Managers page)' },
    { v: 'macros', label: 'Macros', tip: 'The macros the stage switched on, pulsing while they work' },
    { v: 'activity', label: 'Lately', tip: 'The last things those macros did' },
  ];
  const DEFAULT_PARTS = ['stages', 'buyer', 'now', 'until', 'watch', 'macros'];
  const partsOf = (inst) => (Array.isArray(inst.stats) ? inst.stats.filter((v) => PARTS.some((p) => p.v === v)) : DEFAULT_PARTS);

  const ago = (t) => (Date.now() - t < 2000 ? 'just now' : `${F().span((Date.now() - t) / 1000)} ago`);
  const bar = (f) => `<span class="ca-mw-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%"></i></span>`;

  // ---- the parts ---------------------------------------------------------------------------------

  function stagesHtml(w) {
    const chips = w.manager.stages
      .map((s, i) => {
        const on = w.started && i === w.index;
        const done = w.started && i < w.index;
        return (
          (i ? `<span class="ca-mw-link${done || on ? ' done' : ''}"></span>` : '') +
          `<span class="ca-mw-st${on ? ' on' : done ? ' done' : ''}" data-tip="${esc(`${i + 1} · ${s.name}`)}">${done ? '✓' : i + 1}${on ? `<em>${esc(s.name)}</em>` : ''}</span>`
        );
      })
      .join('');
    return `<div class="ca-mw-strip" data-w-open="managers">${chips}</div>`;
  }

  function profilesHtml(w) {
    const waiting = {};
    w.pending.forEach((p) => (waiting[p.kind] = p));
    const chips = G()
      .KINDS.filter((k) => now(w).profiles[k])
      .map((k) => {
        const kind = G().P[k];
        const p = waiting[k];
        let name = now(w).profiles[k];
        try {
          const found = kind.list().find((x) => x.id === name);
          if (found) name = found.name;
        } catch (e) {
          // a minigame that isn't there yet: its id
        }
        const tip = p ? `${kind.label}: ${name} — still to put in${p.waits ? `, waits for ${p.waits}` : ''}` : `${kind.label}: ${name} — in`;
        return `<span class="ca-mw-prof${p ? ' wait' : ''}" data-tip="${esc(tip)}">${I(kind.icon, 11)}${esc(name)}${p ? ' <i>⌛</i>' : ''}</span>`;
      })
      .join('');
    return chips ? `<div class="ca-mw-profs">${chips}</div>` : '';
  }

  function nowHtml(w, parts = []) {
    const on = CA.Macros.isOn(G().MACRO);
    const time = F().span(Math.max(0, (Date.now() - w.since) / 1000));
    const wait = w.pending.find((p) => p.waits);
    // under the strip, which names the stage and where it is: only for how long
    const head = parts.includes('stages')
      ? `<span>${esc(w.started ? `On this stage for ${time}` : 'Starts at stage 1 on its next pass')}</span>`
      : `<b>${esc(w.started ? w.stage.name : w.manager.stages[0].name)}</b><span>${esc(w.started ? `stage ${w.index + 1} of ${w.of} · ${time}` : 'starts at stage 1 on its next pass')}</span>`;
    return (
      `<div class="ca-mw-now" data-w-open="managers">${head}</div>` +
      (on ? '' : `<div class="ca-mw-warn">${I('pause', 11)} The Manager macro is off — it isn’t running</div>`) +
      (w.started ? profilesHtml(w) : '') +
      (wait ? `<div class="ca-mw-dim">⌛ ${esc(wait.label)} waits for ${esc(wait.waits)}</div>` : '')
    );
  }

  // a season with this many drops or fewer still to get: named (the reindeer cookies), not counted
  const NAME_LEFT = 8;
  /** The drops still to get, each with its icon (dim: not dropped yet; bright: in the store to buy). */
  function leftHtml(names) {
    const items = names
      .map((n) => {
        const u = Game.Upgrades && Game.Upgrades[n];
        const pic = u && Array.isArray(u.icon) ? u.icon : null;
        const ico = pic ? `<span class="ca-mw-leftico"><span style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-pic[0] * 48}px ${-pic[1] * 48}px"></span></span>` : '';
        const store = !!(u && u.unlocked);
        return `<span class="ca-mw-leftitem${store ? ' store' : ''}" data-tip="${esc(store ? `${n}: in the store, to buy` : `${n}: not dropped yet`)}">${ico}<span>${esc(n)}</span></span>`;
      })
      .join('');
    return `<div class="ca-mw-left">${items}</div>`;
  }

  function untilHtml(w, parts = []) {
    const head = (text, extra = '') => `<div class="ca-mw-head"><span>${text}</span>${extra}</div>`;
    // the last stage: the strip already shows it's the last, and nothing moves it on
    if (w.index >= w.of - 1) return parts.includes('stages') ? '' : head('The last stage') + '<div class="ca-mw-dim">It lasts for good.</div>';
    if (w.coded) return head('Next stage when') + '<div class="ca-mw-dim">Its code (yours) moves it on.</div>';
    const until = w.stage.until || '';
    if (!until.trim()) return head('Next stage when') + '<div class="ca-mw-dim">No “until”: it stays here until you move it on.</div>';
    const u = G().untilParts(until);
    if (!u) return head('Next stage when') + `<div class="ca-mw-warn">${esc(G().untilProblem(until) || 'its “until” has a problem')}</div>`;
    const met = u.parts.filter((p) => p.ok).length;
    const rows = u.parts
      .map((p) => {
        const named = !p.ok && p.missing && p.missing.length && p.missing.length <= NAME_LEFT;
        return (
          `<div class="ca-mw-cond${p.ok ? ' ok' : ''}"><b>${p.ok ? '✓' : '○'}</b><span>${esc(p.text.replace(/ \(\d+\/\d+\)$/, ''))}</span>` +
          (named ? `<em>${p.missing.length} left</em>${leftHtml(p.missing)}` : p.of ? `<em>${p.have}/${p.of}</em>${bar(p.have / p.of)}` : '') +
          '</div>'
        );
      })
      .join('');
    const count = u.parts.length > 1 ? `<em>${u.join === 'or' ? 'any of' : `${met} of ${u.parts.length}`}</em>` : '';
    return head('Next stage when', count) + rows;
  }

  function watchValue(x) {
    if (x.error) return { text: `<i>${esc(x.error)}</i>` };
    const v = x.value;
    const num = (n) => (Number.isFinite(n) ? F().beautify(n, Number.isInteger(n) ? 0 : 2) : '—');
    if (x.format === 'progress') {
      const [have, of] = Array.isArray(v) ? v.map(Number) : [Number(v), 100];
      if (!Number.isFinite(have) || !Number.isFinite(of) || of <= 0) return { text: '—' };
      return { text: Array.isArray(v) ? `${num(have)} / ${num(of)}` : `${Math.round((have / of) * 100)}%`, bar: have / of };
    }
    if (x.format === 'time') return { text: Number.isFinite(Number(v)) ? (Number(v) <= 0 ? 'now' : F().span(Number(v))) : '—' };
    if (x.format === 'percent') return { text: Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)}%` : '—' };
    if (typeof v === 'boolean') return { text: v ? 'yes' : 'no' };
    if (typeof v === 'number') return { text: num(v) };
    if (Array.isArray(v)) return { text: esc(v.join(', ') || '—') };
    return { text: v === undefined || v === '' ? '—' : esc(String(v)) };
  }

  function watchHtml(w) {
    const list = G().watchOf(w.stage);
    if (!list.length) return '<div class="ca-mw-dim">Nothing watched in this stage — add some on the Managers page.</div>';
    return list
      .map((x) => {
        const v = watchValue(x);
        return `<div class="ca-w-stat ca-mw-watch"><span>${esc(x.label || x.value)}</span><b>${v.text}</b>${v.bar != null ? bar(v.bar) : ''}</div>`;
      })
      .join('');
  }

  /** What the stage runs with: its own changes and those of the stages before it (they carry over). */
  const now = (w) => G().effective(w.manager, w.index);
  /** The macros the stage has on (a group: itself), that exist. */
  const stageOn = (st) => Object.keys(st.macros).filter((id) => st.macros[id] === 'on' && CA.Macros.get(id));
  const what = (r) => `${CA.Actions.describe({ action: r.action, params: r.params })}${r.k > 1 ? ` ×${F().beautify(r.k, 0)}` : ''}`;

  /** A macro's popup: its name, how long it's been on, and the last things it did. */
  function macroPop(m, on) {
    const done = CA.Macros.recent(m.id).slice(0, 4);
    return (
      '<span class="ca-wpop ca-wt">' +
      `<span class="ca-wpop-head">${CA.UI.MacrosPage.icon(m, true)}<b>${esc(m.name)}</b></span>` +
      `<span class="ca-wpop-sub">${on ? `on for ${F().span((Date.now() - (CA.Macros.since(m.id) || Date.now())) / 1000)}` : 'switched off since the stage began'}</span>` +
      (done.length
        ? done.map((r) => `<span class="ca-wpop-row">${I((CA.Actions.get(r.action) || {}).icon || 'bolt', 11)}<span class="ca-wpop-name">${esc(what(r))}</span><span class="ca-wpop-val">${ago(r.t)}</span></span>`).join('')
        : '<span class="ca-wpop-row"><span class="ca-wpop-name">nothing done yet</span></span>') +
      '</span>'
    );
  }

  function macrosHtml(w) {
    const ids = stageOn(now(w));
    if (!ids.length) return '<div class="ca-mw-dim">This stage switches no macros on.</div>';
    const items = ids
      .map((id) => {
        const m = CA.Macros.get(id);
        const on = CA.Macros.isOn(id);
        const last = CA.Macros.recent(id)[0];
        const hot = on && !!last && Date.now() - last.t < HOT_MS;
        return `<span class="ca-wbar-item ca-mw-mac${hot ? ' hot' : ''}${on ? '' : ' off'}" data-w-open="clickers" data-pop aria-label="${esc(m.name)}">${CA.UI.MacrosPage.icon(m, true)}${macroPop(m, on)}</span>`;
      })
      .join('');
    return `<div class="ca-mw-macros">${items}</div>`;
  }

  function activityHtml(w) {
    const seen = new Set();
    const rows = [];
    stageOn(now(w)).forEach((id) => {
      const m = CA.Macros.get(id);
      (m.mode === 'group' ? m.members.map((x) => CA.Macros.get(x)).filter(Boolean) : [m]).forEach((x) => {
        if (seen.has(x.id)) return;
        seen.add(x.id);
        CA.Macros.recent(x.id).forEach((r) => rows.push({ ...r, m: x }));
      });
    });
    rows.sort((a, b) => b.t - a.t);
    if (!rows.length) return '<div class="ca-mw-dim">Its macros haven’t done anything yet.</div>';
    return rows
      .slice(0, ACTIVITY)
      .map((r) => `<div class="ca-mw-act${Date.now() - r.t < HOT_MS ? ' hot' : ''}">${CA.UI.MacrosPage.icon(r.m, true)}<span data-tip="${esc(`${r.m.name}: ${what(r)}`)}">${esc(what(r))}</span><em>${ago(r.t)}</em></div>`)
      .join('');
  }

  /** Whether the stage it's on (or starts at) switches the Auto buyer on (itself, or a group with it) —
   *  shown even while the Manager macro is off: what the buyer would buy. */
  function runsBuyer() {
    const w = G().where();
    if (!w) return false;
    return stageOn(now(w)).some((id) => {
      const m = CA.Macros.get(id);
      return id === 'autoBuyer' || (m.mode === 'group' && (m.members || []).includes('autoBuyer'));
    });
  }

  /** The Auto buyer row ("" while the stage doesn't run it: the part isn't drawn). */
  const buyerHtml = () => (runsBuyer() ? CA.UI.BuyerRow.html() : '');

  const PART_HTML = { stages: stagesHtml, buyer: buyerHtml, now: nowHtml, until: untilHtml, watch: watchHtml, macros: macrosHtml, activity: activityHtml };
  const NONE = '<div class="ca-mw-dim">No manager is active — pick one on the Managers page.</div>';

  function html(inst) {
    const w = G().where();
    if (!w) return `<div class="ca-mw" data-w-open="managers">${NONE}</div>`;
    const parts = partsOf(inst);
    // each part leaves out what another part shown already says (the stage's name, that it's the last)
    const h = parts
      .map((p) => [p, PART_HTML[p](w, parts)])
      .filter(([, x]) => x)
      .map(([p, x]) => `<div class="ca-mw-part ca-mw-p-${p}">${x}</div>`)
      .join('');
    return `<div class="ca-mw">${h || '<div class="ca-mw-dim">Pick what to show in its settings.</div>'}</div>`;
  }

  // the settings' samples: each part as the widget draws it now
  const sample = (p) => () => {
    const w = G().where();
    const x = w ? PART_HTML[p](w) : NONE;
    return `<div class="ca-mw"><div class="ca-mw-part ca-mw-p-${p}">${x || '<div class="ca-mw-dim">Shows while the stage has the Auto buyer on.</div>'}</div></div>`;
  };

  /** The Managers page's ☆: the widget with its default parts. */
  const PRESET = { type: 'manager' };

  function init() {
    CA.UI.Widgets.defineType({
      id: 'manager',
      name: 'Manager',
      icon: 'ascend',
      desc: 'What the active manager is doing: its stages, the one it’s on and for how long, what moves it on (each condition ticked as it holds), the stage’s own numbers, and its macros at work. Pick the parts in its settings.',
      group: 'macros',
      sprite: [19, 7],
      short: 'Its stage, what moves it on, its macros',
      width: 260,
      resize: 'free',
      html,
      nameOf: () => (G().current() ? G().current().name : 'Manager'),
      settings: [{ key: 'stats', label: 'Show', type: 'multi', default: DEFAULT_PARTS, options: () => PARTS.map((p) => ({ ...p, sample: sample(p.v) })) }],
    });
  }

  /** A watched value as the widget writes it (HTML): "7 / 21", "12 min", "yes". */
  const watchText = (x) => watchValue(x).text;

  return { init, html, runsBuyer, watchText, PARTS, DEFAULT_PARTS, PRESET };
})();
