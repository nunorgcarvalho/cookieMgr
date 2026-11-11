// The Auto buyer's cards — the top of the Payback page (features/autoBuyer.js):
//
//   Auto buyer   its on/off switch (the autoBuyer macro), what it buys next (a bar filling as you save
//                for it), the profiles (click one to make it active), the payback mode, Buy all upgrades
//   Queue        the active profile's queue: place, what (icon, name; an upgrade's info card on hover;
//                Buy all upgrades as one row, the upgrades it buys on hover; what it keeps — Lucky! bank,
//                garden replant… — as rows of their own, in their place), payback period in its color,
//                implied payback period, score (0–100), price, when, the rules that touched it — the first
//                ten (all on "show all"), then what's held back, grayed, with why
//   Purchase history  what the Auto buyer bought, newest first (the last 100, kept in the save; scrolls):
//                when, what, price, the CpS it added, that as a boost to your income, its payback period then,
//                the profile
//   Profile      the active profile: name, what it buys, the bulk, cheap ×100, save up or skip, what it keeps
//                (minutes of CpS and banks) and each one's priority (first, or a score), what it ranks by,
//                and its rules (what → does, when …), reordered with ↑ ↓
//
// The first three follow the game every second (sync); the profile editor redraws only when it changes,
// so typing into it isn't interrupted.

CA.UI = CA.UI || {};

CA.UI.AutoBuyerCard = (() => {
  const C = () => CA.UI.C;
  const I = (n, s) => CA.UI.Icons.html(n, s);
  const esc = (s) => CA.Util.escapeHtml(s);
  const B = () => CA.AutoBuyer;
  const P = () => CA.Payback;
  const F = () => CA.Format;
  const SHOW = 10;
  let showAll = false;

  const ppText = (v) => F().payback(v);
  const dash = '<span class="ca-hint">—</span>';
  /** A score, 0–100, with a little bar. */
  const scoreHtml = (v) => (Number.isFinite(v) ? `<span class="ca-ab-score"><span class="ca-ab-score-bar"><i style="width:${v.toFixed(0)}%"></i></span>${Math.round(v)}</span>` : dash);
  /** What a threshold of the queue is drawn with. */
  const BANK_ICONS = { cps: 'clock', lucky: 'sparkle', luckyFrenzy: 'bolt', conjure: 'wizard', garden: 'leaf' };
  const bankIcon = (id, size = 13) => I(BANK_ICONS[id] || 'dollar', size);
  /** A threshold's tip: what it is, and why it's where it is. */
  const bankTip = (x) => `${x.detail ? `${x.detail} — ` : ''}keeps ${F().beautify(x.price)} in the bank: ${B().whyText(x)}${x.kept ? ' (kept now)' : ''}`;
  const sprite = (pos) => `<span class="ca-pp-ico" style="background-image:url(${CA.Util.res('img/icons.png')});background-position:${-pos[0] * 48}px ${-pos[1] * 48}px"></span>`;
  /** A seed's picture (the garden's seed sprite). */
  const seedIcon = (icon) => `<span class="ca-pp-ico" style="background-image:url(${CA.Util.res('img/gardenPlants.png')});background-position:-192px ${-(icon || 0) * 48}px"></span>`;
  /** A queue entry's name: a building's icon and name, an upgrade's (hoverable: its info card). */
  function thingName(x) {
    if (x.kind === 'upgrade') return CA.UpgradeInfo.ref(x.name);
    if (x.kind === 'garden') {
      const tip = `${x.round ? 'A new round: the old ones harvested, every tile of it planted' : 'Its tiles without it, planted while its round grows'} — its gain: the golden cookie income the grown plants add`;
      return `<span class="ca-ab-thing" data-tip="${esc(tip)}">${seedIcon(x.icon)}${esc(x.label)}</span>`;
    }
    if (x.kind === 'bank') return `<span class="ca-ab-thing" data-tip="${esc(bankTip(x))}">${bankIcon(x.name)}${esc(x.label)}</span>`;
    if (x.kind === 'allUpgrades') {
      const names = (x.names || []).map((n) => (Game.Upgrades && Game.Upgrades[n] && Game.Upgrades[n].dname) || n);
      const tip = names.length ? `The game’s Buy all upgrades: ${names.join(', ')} — bought at once, their payback period measured together` : 'The game’s Buy all upgrades: every store upgrade the budget affords';
      const box = Game.Upgrades && Game.Upgrades['Inspired checklist'];
      return `<span class="ca-ab-thing" data-tip="${esc(tip)}">${box && box.icon ? sprite(box.icon) : I('upgrade', 14)}${esc(x.label)}</span>`;
    }
    const b = (Game.Objects || {})[x.name];
    return `<span class="ca-ab-thing">${b ? sprite([b.iconColumn || 0, 0]) : ''}${esc(x.label)}</span>`;
  }
  const when = (price) => {
    const s = P().timeTo(price);
    return s <= 0 ? 'now' : Number.isFinite(s) ? F().span(s) : 'not at this income';
  };

  // ---- the Auto buyer card ----

  /** The thresholds kept ahead of a thing in the queue (what it may only spend above). */
  const keptAhead = (q, f) => q.items.slice(0, Math.max(0, q.items.indexOf(f))).filter((y) => B().holdsBack(y, f));
  const bar = (pct) => `<span class="ca-ab-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>`;
  function nextHtml() {
    const q = B().queue();
    const f = q.next;
    const w = q.wait;
    const cookies = Game.cookies || 0;
    // saving up for something it keeps (a Lucky! bank, the garden's replant…): that first, then what's next
    if (w && w.kind === 'bank') {
      const pct = w.price > 0 ? Math.max(0, Math.min(1, cookies / w.price)) : 1;
      return (
        '<div class="ca-ab-next saving">' +
        `<div class="ca-ab-next-text"><b>Saving for: ${thingName(w)}</b>` +
        `<span class="ca-hint">${F().beautify(w.price)} · ${(pct * 100).toFixed(0)}% · in ${when(w.price)} · ${esc(B().whyText(w, q))}${w.detail ? ` · ${esc(w.detail)}` : ''}</span>` +
        `${bar(pct)}${f ? `<span class="ca-hint ca-ab-then">then: ${thingName(f)} · score ${Number.isFinite(f.score) ? Math.round(f.score) : f.first ? 'first' : '—'} · ${F().short(f.price)}</span>` : ''}</div></div>`
      );
    }
    if (!f) {
      const why = B().readiness().text;
      return `<div class="ca-ab-next"><div class="ca-ab-next-text"><b>Nothing to buy</b>${/^nothing to buy$/i.test(why) ? '' : `<span class="ca-hint">${esc(why)}</span>`}</div></div>`;
    }
    const keep = q.keep;
    const ahead = keptAhead(q, f);
    const need = f.price + keep;
    const pct = need > 0 ? Math.max(0, Math.min(1, cookies / need)) : 1;
    return (
      `<div class="ca-ab-next${pct >= 1 ? ' can' : ''}">` +
      `<div class="ca-ab-next-text"><b>Next: ${thingName(f)}</b>` +
      `<span class="ca-hint">${f.first ? '' : `score ${Number.isFinite(f.score) ? Math.round(f.score) : '—'} · `}${esc(B().whyText(f, q))} · PP ${ppText(f.pp)} · +${F().short(f.gain)}/s · ${F().beautify(f.price)} · ${pct >= 1 ? 'affordable now' : `in ${when(need)}`}${keep > 0 ? ` · keeps ${F().short(keep)} in the bank (${esc(ahead.map((y) => y.label.replace(/^Keep /, '')).join(', '))})` : ''}</span>` +
      `${bar(pct)}</div></div>`
    );
  }
  function profileChips() {
    const act = B().activeProfile();
    return (
      B()
        .list()
        .map((p) => `<button type="button" class="ca-chip${p.id === act ? ' on' : ''}" data-ab-use="${esc(p.id)}" data-tip="${esc(`${p.name} (id ${p.id}) — click to make it the active profile; macros: buyer.profile(${p.id})`)}">${esc(p.name)}</button>`)
        .join('') + `<button type="button" class="ca-chip" data-ab-act="new" data-tip="A new profile, a copy of the active one">${I('plus', 11)} New</button>`
    );
  }
  function allUpgradesButton() {
    const all = B().allUpgrades();
    const can = all.filter((x) => x.price <= (Game.cookies || 0)).length;
    return C().button(
      `${I('upgrade', 12)} Buy all upgrades${all.length ? ` <small>${can}/${all.length}</small>` : ''}`,
      `data-ab-act="all"${can ? '' : ' disabled'} data-tip="${esc('Buys every upgrade in the store you can afford, cheapest first — the game’s Inspired checklist button: not switches, research, or what you’ve vaulted. Macros: buy.allUpgrades()')}"`,
      'ca-btn-small'
    );
  }
  /** Buy all upgrades' own payback period, measured as one purchase (the store upgrades the bank affords, together). */
  function allUpgradesPp() {
    const x = P().allUpgrades();
    if (!x.n) return '';
    const t = P().table({ staleMs: 1000 });
    return `<span class="ca-hint" data-tip="${esc('Its payback period in the mode in use: the upgrades it would buy, measured together as one purchase. Macros: payback.allUpgrades()')}"><span class="ca-pp-dot ${t.colourOf(x.pp, x.price)}"></span>PP ${ppText(x.pp)} · +${F().short(x.gain)}/s · ${F().beautify(x.price)}</span>`;
  }
  function buyerHtml() {
    const on = CA.Macros.isOn('autoBuyer');
    const key = CA.Settings.getHotkey('macro.autoBuyer');
    return (
      '<div class="ca-ab-hero">' +
      C().toggle(on, 'data-ab-act="toggle"', 'Auto buyer on/off') +
      (key ? `<span class="ca-ab-state ${on ? 'on' : ''}">${esc(CA.Hotkeys.format(key))}</span>` : '') +
      nextHtml() +
      '</div>' +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Profile</span><span class="ca-pp-chips">${profileChips()}</span></div>` +
      `<div class="ca-ab-row ca-pp-modebar" data-pp-modes>${CA.UI.PaybackPage.modeBar()}</div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl"></span>${allUpgradesButton()}${allUpgradesPp()}</div>`
    );
  }
  function buyerCard() {
    return (
      '<div class="ca-card ca-ab">' +
      C().cardHead('Auto buyer', 'dollar', `<div class="ca-card-meta"><span class="ca-hint">also on the ${C().link('Macros', 'clickers')} page</span></div>`) +
      `<div data-ab-buyer>${buyerHtml()}</div></div>`
    );
  }

  // ---- the queue ----

  function row(x, i, t, q) {
    const held = i < 0;
    const bank = x.kind === 'bank';
    const colour = x.colour || (t ? t.colourOf(x.pp, x.price) : 'gray');
    const can = x.price <= (Game.cookies || 0);
    const score = held ? dash : x.first ? '<span class="ca-ab-first">first</span>' : scoreHtml(x.score);
    // a held row's last rule is the one that held it: its why says it in full
    const rules = held && (x.rules || []).length && x.why.includes(x.rules[x.rules.length - 1]) ? x.rules.slice(0, -1) : x.rules || [];
    const badges = rules.map((r) => `<span class="ca-ab-badge ${badgeClass(r)}">${esc(r)}</span>`).join('') + (held ? `<span class="ca-ab-why">${esc(x.why)}</span>` : '');
    const cls = [q && x === q.next ? 'front' : '', q && x === q.wait && bank ? 'saving' : '', held ? 'held' : '', bank ? 'bank' : '', bank && x.kept ? 'kept' : ''].filter(Boolean).join(' ');
    // when the buyer could buy it: its price above what's kept ahead of it
    const ahead = q && !held ? q.items.slice(0, Math.max(0, i)).reduce((m, y) => (B().holdsBack(y, x) ? Math.max(m, y.price) : m), 0) : 0;
    const whenText = held ? '' : bank && x.kept ? '✓ kept' : when(x.price + (bank ? 0 : ahead));
    return (
      `<tr class="${cls}">` +
      `<td class="n">${held ? '–' : i + 1}</td>` +
      `<td>${thingName(x)}</td>` +
      `<td class="n">${bank ? dash : `<span class="ca-pp-dot ${colour}"></span>${ppText(x.pp)}`}</td>` +
      `<td class="n">${held || !Number.isFinite(x.ipp) ? dash : ppText(x.ipp)}</td>` +
      `<td class="n">${score}</td>` +
      `<td class="n">${F().short(x.price)}</td>` +
      `<td class="${can && x.price + (bank ? 0 : ahead) <= (Game.cookies || 0) ? 'ca-ab-can' : ''}"${ahead > 0 && !bank ? ` data-tip="${esc(`keeping ${F().short(ahead)} in the bank ahead of it`)}"` : ''}>${whenText}</td>` +
      `<td class="ca-ab-badges">${badges}</td></tr>`
    );
  }
  const badgeClass = (r) => (/^priority/.test(r) ? 'prio' : /^buy first|^cheap/.test(r) ? 'first' : /^weight/.test(r) ? 'weight' : /^up to/.test(r) ? 'cap' : 'never');
  function queueHtml() {
    const q = B().queue();
    if (!q.profile) return '<div class="ca-card-note">No profile.</div>';
    const shown = showAll ? q.items : q.items.slice(0, SHOW);
    // the colors: the full table's scale (worked out at most a second ago — the page shows it anyway)
    const t = P().table({ staleMs: 1000 });
    const more = q.items.length - shown.length;
    const tips = {
      pp: 'its payback period: the time to afford it plus the time to earn its price back',
      ipp: 'its implied payback period: the payback period after the rules’ weights — what the queue sorts on. A priority placed at a score: the payback period that score stands for',
      score: 'its score, 0–100: 100 for the best payback period in the queue, 10 points less for each doubling of it (90: twice as long, 80: four times). “first”: ahead of the ranking (a priority, a buy-first rule, cheap ×100)',
    };
    return (
      `<div class="ca-ab-scroll"><table class="ca-ab-queue"><thead><tr><th>#</th><th>What</th><th class="n" data-tip="${esc(tips.pp)}">PP</th><th class="n" data-tip="${esc(tips.ipp)}">Implied PP</th><th class="n" data-tip="${esc(tips.score)}">Score</th><th class="n">Price</th><th>When</th><th>Rules</th></tr></thead><tbody>` +
      (shown.length ? shown.map((x, i) => row(x, i, t, q)).join('') : `<tr><td colspan="8" class="ca-hint">Nothing in the queue${q.profile.skip ? ' you can afford' : ''}.</td></tr>`) +
      (more > 0 ? `<tr><td colspan="8"><a class="ca-link" data-ab-act="all-rows" role="link" tabindex="0">${more} more — show all</a></td></tr>` : showAll && q.items.length > SHOW ? `<tr><td colspan="8"><a class="ca-link" data-ab-act="all-rows" role="link" tabindex="0">show the first ${SHOW}</a></td></tr>` : '') +
      q.held.map((x) => row(x, -1, t, q)).join('') +
      '</tbody></table></div>'
    );
  }
  function queueMeta() {
    const q = B().queue();
    const things = q.items.filter((x) => x.kind !== 'bank').length;
    const banks = q.items.length - things;
    return q.profile ? `${things} in the queue${banks ? `, ${banks} kept in the bank` : ''}${q.held.length ? `, ${q.held.length} held back` : ''}` : '';
  }
  function queueCard() {
    return (
      '<div class="ca-card">' +
      C().cardHead('Queue', 'sortList', `<div class="ca-card-meta"><span class="ca-hint" data-ab-qmeta>${queueMeta()}</span></div>`) +
      `<div data-ab-queue>${queueHtml()}</div></div>`
    );
  }

  // ---- the profile editor ----

  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  function whatOptions(r) {
    const kinds = B().WHATS.map((w) => opt(w, B().whatText({ what: w, secs: r.secs }).replace(/ under .*/, ' under N s of CpS'), r.what));
    const bs = Object.values(Game.Objects || {}).map((b) => opt(`b:${b.name}`, b.dname || b.name, r.what));
    // the store's upgrades, and the one the rule names (it may not be in the store now)
    const names = new Set((Game.UpgradesInStore || []).filter((u) => u && u.pool !== 'toggle').map((u) => u.name));
    if (r.what.startsWith('u:')) names.add(r.what.slice(2));
    const us = [...names].map((n) => opt(`u:${n}`, (Game.Upgrades && Game.Upgrades[n] && Game.Upgrades[n].dname) || n, r.what));
    return `<optgroup label="Kinds">${kinds.join('')}</optgroup><optgroup label="A building">${bs.join('')}</optgroup>${us.length ? `<optgroup label="An upgrade (in the store)">${us.join('')}</optgroup>` : ''}`;
  }
  function ruleRow(p, r, i) {
    const n = p.rules.length;
    const problem = B().whenProblem(r.when);
    const num = (key, v, step, tip) => `<input type="number" class="ca-pp-num" min="0" step="${step}" value="${v}" data-ab-rule="${i}" data-k="${key}" data-tip="${esc(tip)}">`;
    return (
      `<div class="ca-ab-rule${r.on ? '' : ' off'}">` +
      `<span class="ca-ab-rule-mv">` +
      `<button type="button" class="ca-ab-mini" data-ab-mv="${i}" data-d="-1"${i ? '' : ' disabled'} aria-label="Move up">↑</button>` +
      `<button type="button" class="ca-ab-mini" data-ab-mv="${i}" data-d="1"${i < n - 1 ? '' : ' disabled'} aria-label="Move down">↓</button></span>` +
      '<span class="ca-ab-rule-body">' +
      `<select data-ab-rule="${i}" data-k="what">${whatOptions(r)}</select>` +
      (r.what === 'cheap' ? num('secs', r.secs, 1, 'seconds of unbuffed CpS') + '<span class="ca-hint">s</span>' : '') +
      '<span class="ca-ab-arrow">→</span>' +
      `<select data-ab-rule="${i}" data-k="effect">${B()
        .EFFECTS.map((e) => opt(e, { first: 'buy first', weight: 'weight ×', cap: 'up to … owned', never: 'never' }[e], r.effect))
        .join('')}</select>` +
      (r.effect === 'weight' ? num('k', r.k, 0.1, 'multiplies its payback period: below 1 prefers it, above 1 puts it off') : '') +
      (r.effect === 'cap' ? num('n', r.n, 1, 'no more than this many owned (a building)') : '') +
      `<span class="ca-ab-when"><span class="ca-hint">when</span><input type="text" class="ca-ab-code${problem ? ' bad' : ''}" value="${esc(r.when)}" placeholder="always" spellcheck="false" data-ab-rule="${i}" data-k="when" data-tip="${esc(problem ? `Problem: ${problem}` : 'A condition in the macro language — e.g. cookies() > 1e12, buff(Frenzy), pp.price(thing) < cps() * 60 — `thing` is what’s ranked. Empty: always.')}"></span>` +
      '</span>' +
      `<span class="ca-ab-rule-end">${C().toggle(r.on, `data-ab-rule-on="${i}"`, 'Rule on/off')}` +
      C().button('✕', `data-ab-rm="${i}" data-arm-label="Remove?"`, 'ca-btn-small ca-btn-off') +
      '</span></div>'
    );
  }
  /** The reserve's thresholds now, the highest (the most it keeps) in bold. */
  function keepHtml(p) {
    const parts = B().reserveParts(p.id);
    if (!parts.length) return 'no reserve: it may spend the whole bank';
    const list = parts.map((q) => (q.wins ? `<b>${esc(q.label)} ${F().beautify(q.amount)}</b>` : `${esc(q.label)} ${F().beautify(q.amount)}`)).join(' · ');
    return parts.every((q) => q.at === 'first')
      ? `keeps the highest — so the bank never drops below any of them: ${list}`
      : `keeps them in the queue, each in its place — what scores below one waits until the bank covers it: ${list}`;
  }
  const placeLabel = (v) => (v === 'first' ? 'first — before anything' : `after what scores ${v}+`);
  /** Each threshold's priority: where it sits in the queue. */
  function priorityRows(p) {
    const parts = B().reserveParts(p.id);
    if (!parts.length) return '';
    return parts
      .map((t) => {
        const at = t.at;
        const places = B().PLACES.includes(at) ? B().PLACES : B().PLACES.concat([at]);
        const d = t.id === 'garden' && CA.Garden.minigame() ? CA.Garden.layoutSeeds() : [];
        const detail = d.length ? `${d.reduce((m, x) => m + x.n, 0)} seeds: ${d.map((x) => `${x.n} ${x.name}`).join(', ')}` : '';
        return (
          `<div class="ca-ab-row ca-ab-prio"><span class="ca-ab-lbl"></span>${bankIcon(t.id)}<b>${esc(t.label)}</b><span class="ca-hint">${F().beautify(t.amount)}</span>` +
          `<select data-ab-at="${esc(t.id)}" data-tip="${esc('Where it sits in the queue. First: nothing is bought until the bank covers it (and nothing spends into it). After a score: what scores that or more is bought ahead of it — and may spend into it; the rest waits until it’s kept.')}">${places.map((v) => opt(v, placeLabel(v), at)).join('')}</select>` +
          (detail ? `<span class="ca-hint">${esc(detail)}</span>` : '') +
          '</div>'
        );
      })
      .join('');
  }
  function editorHtml() {
    const p = B().find();
    if (!p) return '';
    const chip = (attr, v, label, on, tip = '') => `<button type="button" class="ca-chip${on ? ' on' : ''}" ${attr}="${esc(String(v))}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${label}</button>`;
    const modes = [opt('', `the payback mode in use (${P().mode().label})`, p.mode)].concat(P().modes().map((m) => opt(m.id, m.label, p.mode))).join('');
    return (
      '<div class="ca-list">' +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Name</span><input type="text" class="ca-gname" maxlength="40" value="${esc(p.name)}" data-ab-f="name" data-tip="${esc(`macros use its name or its id: ${p.id}`)}"><span class="ca-hint">id ${esc(p.id)}</span></div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Buys</span><span class="ca-pp-chips">${chip('data-ab-kind', 'building', 'Buildings', p.kinds.building)}${chip('data-ab-kind', 'upgrade', 'Upgrades', p.kinds.upgrade)}${chip('data-ab-kind', 'allUpgrades', 'Buy all upgrades', p.kinds.allUpgrades, 'Every store upgrade the budget affords, bought at once — ranked by its own payback period, measured together')}${chip('data-ab-kind', 'garden', 'Garden', p.kinds.garden, 'What the gardener plants next — a seed’s empty tiles while its round grows, or a new round once one is due — ranked by the golden cookie income the grown plants add. It may spend the garden’s own banks (Garden replant, Garden rounds)')}</span></div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Building bulk</span><span class="ca-pp-chips">${B()
        .BULKS.map((b) => chip('data-ab-bulk', b, b === 'auto' ? 'auto' : `×${b}`, p.bulk === b, b === 'auto' ? `The store’s minimum bulk (Options below), rounded up with Round to multiples — now ×${CA.Shop.minBulk()}` : ''))
        .join('')}</span></div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Cheap ×100</span><input type="number" min="0" step="0.5" class="ca-pp-num" value="${p.cheapBulk}" data-ab-f="cheapBulk" data-tip="${esc('A building whose next 100 cost less than this, and the budget affords, is bought 100 at a time ahead of the queue, whatever its payback period. 0: off')}"><span class="ca-hint">s of unbuffed CpS</span></div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Can’t afford</span><span class="ca-pp-chips">${chip('data-ab-skip', 0, 'save up for the front', !p.skip)}${chip('data-ab-skip', 1, 'skip to what I can afford', p.skip)}</span></div>` +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Keeps</span><input type="number" min="0" step="1" class="ca-pp-num" value="${p.reserve}" data-ab-f="reserve"><span class="ca-hint">minutes of unbuffed CpS</span>` +
      `<span class="ca-pp-chips">${B()
        .BANKS.map((b) => chip('data-ab-bank', b.id, esc(b.label), p.banks.includes(b.id), `Also keep ${b.tip}`))
        .join('')}</span></div>` +
      (p.banks.includes('gardenRounds')
        ? `<div class="ca-ab-row"><span class="ca-ab-lbl">Rounds margin</span><input type="number" min="0" step="0.05" class="ca-pp-num" value="${p.roundsMargin}" data-ab-f="roundsMargin" data-tip="${esc('Garden rounds keeps this many rounds of golden clovers, on top of the nursetulips’ round while they aren’t all planted; the buyer spends what’s above it. 1: just one round; 0: the tulips only')}"><span class="ca-hint">× a round of golden clovers</span></div>`
        : '') +
      `<div class="ca-ab-row"><span class="ca-ab-lbl"></span><span class="ca-hint" data-ab-keep>${keepHtml(p)}</span></div>` +
      priorityRows(p) +
      `<div class="ca-ab-row"><span class="ca-ab-lbl">Rank by</span><select data-ab-f="mode">${modes}</select></div>` +
      `<div class="ca-ab-row ca-ab-rules-head"><span class="ca-ab-lbl">Rules</span><span class="ca-hint">top to bottom; “never” and a reached cap stop there</span></div>` +
      `<div class="ca-ab-rules">${p.rules.map((r, i) => ruleRow(p, r, i)).join('') || '<div class="ca-card-note">No rules: the queue is the payback ranking as it is.</div>'}</div>` +
      `<div class="ca-ab-row">${C().button(`${I('plus', 12)} Add rule`, 'data-ab-act="rule"', 'ca-btn-small')}${C().button(`${I('plus', 12)} Cheap first`, 'data-ab-act="rule-cheap"', 'ca-btn-small')}` +
      `<span class="ca-ab-grow"></span>${B().list().length > 1 ? C().trash('data-ab-act="delete"', `Delete ${p.name}?`, 'Delete this profile') : ''}</div>` +
      '</div>'
    );
  }
  function editorCard() {
    const p = B().find();
    return (
      '<div class="ca-card">' +
      C().cardHead(`Profile: ${p ? esc(p.name) : '—'}`, 'settings', '<div class="ca-card-meta"><span class="ca-hint">macros: buyer.next(), buyer.queue(), buyer.profile(id)</span></div>') +
      `<div data-ab-editor>${editorHtml()}</div></div>`
    );
  }

  // ---- what it bought ----

  /** The boost a purchase gave: its gain as a share of the income just before ("+0.42%"). */
  function boostText(x) {
    const r = x.gain / (Number.isFinite(x.income) && x.income > 0 ? x.income : x.cps);
    if (!Number.isFinite(r) || r < 0) return '';
    const pct = r * 100;
    return pct === 0 ? '+0%' : pct < 0.01 ? '<0.01%' : `+${pct < 10 ? pct.toFixed(2) : pct < 100 ? pct.toFixed(1) : F().beautify(Math.round(pct))}%`;
  }
  const modeName = (id) => {
    const m = id ? P().modeOf(id) : null;
    return m ? m.label || m.key || id : id || '';
  };
  const dayOf = (t) => new Date(t).toDateString();
  function historyRow(x) {
    const today = dayOf(Date.now()) === dayOf(x.t);
    const at = `${today ? '' : `${new Date(x.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} `}${F().clock(x.t, true)}`;
    const ago = `${F().span((Date.now() - x.t) / 1000)} ago`;
    const boost = boostText(x);
    const mode = modeName(x.mode);
    const ppTip = `its payback period when bought${mode ? `, in the ${mode} payback mode` : ''}`;
    const boostTip = boost ? `adds ${F().beautify(x.gain)}/s to ${F().beautify(Number.isFinite(x.income) && x.income > 0 ? x.income : x.cps)}/s${mode ? ` (${mode})` : ''}` : '';
    return (
      '<tr>' +
      `<td data-tip="${esc(ago)}">${esc(at)}</td>` +
      `<td>${thingName(x)}</td>` +
      `<td class="n">${Number.isFinite(x.price) ? F().short(x.price) : dash}</td>` +
      `<td class="n">${Number.isFinite(x.gain) ? `+${F().short(x.gain)}/s` : dash}</td>` +
      `<td class="n"${boostTip ? ` data-tip="${esc(boostTip)}"` : ''}>${boost ? esc(boost) : dash}</td>` +
      `<td class="n" data-tip="${esc(ppTip)}">${Number.isFinite(x.pp) || x.pp === Infinity ? esc(ppText(x.pp)) : dash}</td>` +
      `<td class="ca-hint">${esc(x.profile || '')}</td></tr>`
    );
  }
  function historyHtml() {
    const done = B().recentBought();
    const tips = {
      cps: 'the CpS it added when bought (in its payback mode: what that mode counts — the golden cookie income a garden round adds)',
      boost: 'what it added as a share of your income just before',
      pp: 'its payback period when bought: the time to afford it plus the time to earn its price back',
    };
    return (
      `<table class="ca-ab-queue ca-ab-hist"><thead><tr><th>When</th><th>What</th><th class="n">Price</th><th class="n" data-tip="${esc(tips.cps)}">CpS</th><th class="n" data-tip="${esc(tips.boost)}">Boost</th><th class="n" data-tip="${esc(tips.pp)}">PP</th><th>Profile</th></tr></thead><tbody>` +
      (done.length ? done.map(historyRow).join('') : '<tr><td colspan="7" class="ca-hint">Nothing bought yet.</td></tr>') +
      '</tbody></table>'
    );
  }
  function historyMeta() {
    const n = B().recentBought().length;
    return n === B().BOUGHT_MAX ? `the last ${n}` : n ? `${n} bought` : '';
  }
  function historyCard() {
    return (
      '<div class="ca-card">' +
      C().cardHead(
        'Purchase history',
        'clock',
        `<div class="ca-card-meta"><span class="ca-hint" data-ab-hmeta>${historyMeta()}</span>${C().button('Clear', 'data-ab-act="clear-history" data-arm-label="Clear?"', 'ca-btn-small ca-btn-off ca-ab-hist-clear')}</div>`
      ) +
      `<div class="ca-ab-scroll ca-ab-hist-scroll" data-ab-hist>${historyHtml()}</div></div>`
    );
  }

  const html = () => buyerCard() + queueCard() + historyCard() + editorCard();

  function sync(root) {
    [
      ['[data-ab-buyer]', buyerHtml],
      ['[data-ab-queue]', queueHtml],
      ['[data-ab-qmeta]', queueMeta],
      ['[data-ab-hist]', historyHtml],
      ['[data-ab-hmeta]', historyMeta],
      ['[data-ab-keep]', () => (B().find() ? keepHtml(B().find()) : '')],
    ].forEach(([sel, fn]) => {
      const el = root.querySelector(sel);
      if (el) CA.UI.Dom.morph(el, fn());
    });
  }

  const redraw = () => CA.UI.Menu.render();
  const tick = () => CA.Util.sound('snd/tick.mp3');

  /** The page's clicks: true when it was one of these cards'. */
  function onClick(e) {
    const t = e.target.closest('[data-ab-act],[data-ab-use],[data-ab-kind],[data-ab-bulk],[data-ab-skip],[data-ab-bank],[data-ab-mv],[data-ab-rm],[data-ab-rule-on]');
    if (!t) return false;
    e.stopPropagation();
    const d = t.dataset;
    const p = B().find();
    if (d.abUse) {
      tick();
      B().use(d.abUse);
    } else if (d.abKind) {
      B().update(p.id, { kinds: { ...p.kinds, [d.abKind]: !p.kinds[d.abKind] } });
    } else if (d.abBulk) {
      B().update(p.id, { bulk: d.abBulk === 'auto' ? 'auto' : Number(d.abBulk) });
    } else if (d.abSkip !== undefined) {
      B().update(p.id, { skip: d.abSkip === '1' });
    } else if (d.abBank) {
      B().update(p.id, { banks: p.banks.includes(d.abBank) ? p.banks.filter((b) => b !== d.abBank) : p.banks.concat(d.abBank) });
    } else if (d.abMv !== undefined) {
      B().moveRule(p.id, Number(d.abMv), Number(d.abMv) + Number(d.d));
    } else if (d.abRm !== undefined) {
      if (!CA.UI.Dom.armed(t)) return true;
      B().removeRule(p.id, Number(d.abRm));
    } else if (d.abRuleOn !== undefined) {
      const i = Number(d.abRuleOn);
      B().setRule(p.id, i, { on: !p.rules[i].on });
    } else if (d.abAct === 'toggle') {
      CA.Macros.toggle('autoBuyer');
    } else if (d.abAct === 'new') {
      B().use(B().create(null).id);
    } else if (d.abAct === 'delete') {
      if (!CA.UI.Dom.armed(t)) return true;
      B().remove(p.id);
    } else if (d.abAct === 'rule') {
      B().addRule(p.id, { what: 'upgrade', effect: 'weight', k: 1 });
    } else if (d.abAct === 'rule-cheap') {
      B().addRule(p.id, { what: 'cheap', secs: 60, effect: 'first' });
    } else if (d.abAct === 'all') {
      const n = B().buyAllUpgrades();
      CA.Util.sound(n ? 'snd/buy1.mp3' : 'snd/tick.mp3');
    } else if (d.abAct === 'all-rows') {
      showAll = !showAll;
    } else if (d.abAct === 'clear-history') {
      if (!CA.UI.Dom.armed(t)) return true;
      B().clearBought();
    }
    redraw();
    return true;
  }
  /** The editor's fields and selects: true when it was one of them. */
  function onChange(e) {
    const el = e.target;
    const d = el.dataset || {};
    if (d.abF === undefined && d.abRule === undefined && d.abAt === undefined) return false;
    const p = B().find();
    if (!p) return true;
    if (d.abF === 'name') B().update(p.id, { name: el.value.trim() || p.name });
    else if (d.abF === 'cheapBulk') B().update(p.id, { cheapBulk: Math.max(0, Number(el.value) || 0) });
    else if (d.abF === 'reserve') B().update(p.id, { reserve: Math.max(0, Number(el.value) || 0) });
    else if (d.abF === 'roundsMargin') B().update(p.id, { roundsMargin: Math.max(0, Number(el.value) || 0) });
    else if (d.abF === 'mode') B().update(p.id, { mode: el.value });
    else if (d.abAt !== undefined) B().update(p.id, { at: { ...p.at, [d.abAt]: el.value === 'first' ? 'first' : Number(el.value) } });
    else if (d.abRule !== undefined) {
      const v = d.k === 'what' || d.k === 'effect' || d.k === 'when' ? el.value : Number(el.value);
      B().setRule(p.id, Number(d.abRule), { [d.k]: v });
    }
    redraw();
    return true;
  }

  return { html, sync, onClick, onChange, thingName, bankIcon, scoreHtml };
})();
