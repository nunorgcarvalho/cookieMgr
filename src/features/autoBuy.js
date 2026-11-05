// Buying macros, and petting the dragon.
//
//   (Best building and Best upgrade were here until v3.43: the Auto buyer replaced them —
//   features/autoBuyer.js. Their actions cm.buyBuilding / cm.buyUpgrade stay, hidden, for old macros.)
//   Research                         buys research (the Bingo center's tech upgrades) as it comes,
//                                    optionally stopping before one you pick (One mind starts the
//                                    Grandmapocalypse)
//   Cheap upgrades                   buys any upgrade costing less than N seconds (default 1) of
//                                    your unbuffed production
//   Pet the dragon                   the dragon drops one of four upgrades when petted (1 in 20 per
//                                    pet, dragon level 8+, "Pet the dragon" bought); which one
//                                    depends only on the quarter of the hour, in an order fixed per
//                                    run (main.js ClickSpecialPic). It learns that order by petting
//                                    (never from the seed), and in a quarter that can still give one
//                                    you're missing it opens the dragon, pets it until it drops, and
//                                    closes it again.
//
// Payback periods come from features/payback.js (cookieMgr's own, the way Cookie Monster computes
// them — Cookie Monster doesn't have to be loaded).

CA.AutoBuy = (() => {
  const P = () => CA.Payback;

  // ---- candidates ----------------------------------------------------------------------------

  /** Upgrades in the store you could buy with cookies (not seasons/toggles, research, vaulted or lump-priced). */
  const storeUpgrades = (pools) => P().storeUpgrades(pools);
  const priceOf = (u) => (typeof u.getPrice === 'function' ? u.getPrice() : u.basePrice || u.price || 0);

  /** Every building and upgrade the two buyers could pick, lowest PP first: { kind, name, n, label, price, pp, buy() }. */
  // within one pass of a macro the same lists (worked out three times in one): pass → { key → list }
  let memo = null; // { pass, lists: Map }
  /** The candidates, lowest PP first — top: only the first has to be right (what can't beat it isn't measured). */
  function candidates(kinds, opts = {}) {
    const pass = CA.Macros.passKey();
    if (pass == null) return candidatesNow(kinds, opts);
    const key = `${kinds.join(',')}|${!!opts.top}|${!!opts.skip}|${opts.budget}|${CA.Shop.roundUp()}|${CA.Shop.minBulk()}|${Game.cookies}`;
    if (!memo || memo.pass !== pass) memo = { pass, lists: new Map() };
    if (!memo.lists.has(key)) memo.lists.set(key, candidatesNow(kinds, opts));
    return memo.lists.get(key);
  }
  function candidatesNow(kinds, opts = {}) {
    const kind = kinds.length > 1 ? 'all' : kinds[0];
    return P()
      .ranking(kind, { bulk: 'auto', top: !!opts.top, skip: !!opts.skip, budget: opts.budget })
      .map((x) => ({ ...x, buy: () => P().buy(x) }));
  }

  /** The cookies a reserve of `minutes` of unbuffed CpS keeps in the bank (0: none). */
  const reserveOf = (minutes) => Math.max(0, Number(minutes) || 0) * 60 * (Game.cookiesPsRaw || Game.unbuffedCps || 0);
  /** What a buyer may spend: the bank less its reserve. */
  const budgetOf = (minutes) => (Game.cookies || 0) - reserveOf(minutes);

  /** The lowest-PP choice among `kinds` (only ones affordable with `budget` — the bank by default — when `skip`). */
  function best(kinds, skip, budget) {
    const b = Number.isFinite(budget) ? budget : undefined;
    let list = candidates(kinds, { top: true, skip: !!skip, budget: b });
    if (skip) list = list.filter((c) => c.price <= (b !== undefined ? b : Game.cookies));
    return list[0] || null;
  }

  function buyUpgrade(u) {
    if (u.bought || Game.cookies < priceOf(u)) return 0;
    u.buy(1);
    return u.bought ? 1 : 0;
  }

  /** One run of a buyer: buys its pick if it's the best of what's switched on — and leaves its reserve (minutes of unbuffed CpS) in the bank. */
  function runBuyer(kind, skip, reserve) {
    const kinds = [kind];
    const budget = budgetOf(reserve);
    const pick = best(kinds, skip, budget);
    if (!pick || pick.kind !== kind || pick.price > budget) return 0;
    memo = null;
    return pick.buy() > 0 ? 1 : 0;
  }

  /** For buttons: what a buyer would buy next, and whether it can now. */
  function readiness(kind, skip, reserve) {
    const keep = reserveOf(reserve);
    const pick = best([kind], skip, keep > 0 ? budgetOf(reserve) : undefined);
    if (!pick) return { ok: false, text: skip ? (keep > 0 ? 'nothing affordable above the reserve' : 'nothing affordable') : 'nothing to buy' };
    const ok = pick.price + keep <= Game.cookies;
    const wait = P().timeTo(pick.price + keep);
    return { ok, text: `next: ${pick.label}${pick.estimated ? ' (PP from your clicking)' : ''}${!ok && Number.isFinite(wait) ? ` — in ${CA.Format.span(wait)}${keep > 0 ? ' (keeping the reserve)' : ''}` : ''}` };
  }

  // ---- research --------------------------------------------------------------------------

  const RESEARCH = ['Specialized chocolate chips', 'Designer cocoa beans', 'Ritual rolling pins', 'Underworld ovens', 'One mind', 'Exotic nuts', 'Communal brainsweep', 'Arcane sugar', 'Elder Pact'];

  function researchPick(stopBefore) {
    const stop = stopBefore && stopBefore !== 'none' ? RESEARCH.indexOf(stopBefore) : -1;
    return storeUpgrades(['tech']).find((u) => {
      const i = RESEARCH.indexOf(u.name);
      return stop < 0 || i < 0 || i < stop;
    });
  }

  // ---- cheap upgrades ---------------------------------------------------------------------

  /** Upgrades costing less than `secs` seconds of unbuffed production, cheapest first. */
  function cheapUpgrades(secs) {
    const raw = Game.cookiesPsRaw || Game.cookiesPs || 0;
    const limit = raw * Math.max(0, secs);
    return storeUpgrades()
      .map((u) => ({ u, price: priceOf(u) }))
      .filter((x) => x.price <= limit)
      .sort((a, b) => a.price - b.price);
  }

  // ---- the dragon ---------------------------------------------------------------------------

  const DROPS = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'];
  // Which drop a pet can give depends on the quarter of the hour, in an order the game fixes per run.
  // cookieMgr doesn't read that order (it comes from the save's seed): it learns it by petting. Per
  // quarter: the drop that dropped there, OWNED when 200 pets gave nothing (its drop is one you have;
  // at 1 in 20 a pet, 200 misses happen 0.004% of the time), or null — not tried yet. Forgotten when
  // the run changes (an ascension or a new game shuffles the order anew).
  const OWNED = 'owned';
  const PETS = 200;
  let learned = { run: null, quarters: [null, null, null, null] };
  const has = (n) => (typeof Game.Has === 'function' && Game.Has(n)) || (typeof Game.HasUnlocked === 'function' && Game.HasUnlocked(n));
  const missingDrops = () => DROPS.filter((d) => !has(d));
  const canPet = () => Game.dragonLevel >= 8 && typeof Game.Has === 'function' && Game.Has('Pet the dragon');
  const quarterNow = () => Math.floor(new Date().getMinutes() / 15);
  function quarters() {
    const run = `${Game.resets || 0}/${Game.fullDate || ''}`;
    if (learned.run !== run) learned = { run, quarters: [null, null, null, null] };
    return learned.quarters;
  }
  /** Whether petting in quarter q can still give something: not tried yet, or its drop's still missing. */
  const open = (q) => {
    const x = quarters()[q];
    return x === null || (x !== OWNED && !has(x));
  };

  /**
   * The quarters of the hour as learned so far: [{ q, drop (its drop; '' not known yet), open (petting
   * there can still give something), now, inSec (until it starts; 0 now) }] — [] once all four are yours.
   */
  function petSchedule() {
    if (!missingDrops().length) return [];
    const d = new Date();
    const secIntoHour = d.getMinutes() * 60 + d.getSeconds();
    const qs = quarters();
    return qs.map((x, q) => {
      const now = q === quarterNow();
      return { q, drop: x && x !== OWNED ? x : '', open: open(q), now, inSec: now ? 0 : (q * 900 - secIntoHour + 3600) % 3600 };
    });
  }

  /** Pets the dragon if this quarter-hour can still give a drop you're missing; returns 1 when one dropped. */
  function pet() {
    if (!canPet() || !missingDrops().length) return 0;
    const q = quarterNow();
    if (!open(q)) return 0;
    const before = missingDrops();
    const got = () => before.find((n) => has(n));
    // open the dragon (quietly), pet until something drops, put things back
    const prevTab = Game.specialTab;
    const vol = Game.volume;
    const parts = Game.prefs && Game.prefs.particles;
    Game.volume = 0;
    if (Game.prefs) Game.prefs.particles = 0;
    let drop;
    try {
      Game.specialTab = 'dragon';
      if (typeof Game.ToggleSpecialMenu === 'function') Game.ToggleSpecialMenu(1);
      for (let i = 0; i < PETS && !(drop = got()); i++) Game.ClickSpecialPic();
      drop = got();
    } finally {
      // the game's close only acts while a tab is set (it clears Game.specialTab itself): close before
      // restoring '', or the dragon stays on screen, never redrawn and with an × that does nothing
      if (typeof Game.ToggleSpecialMenu !== 'function') Game.specialTab = prevTab;
      else if (prevTab) {
        Game.specialTab = prevTab;
        Game.ToggleSpecialMenu(1);
      } else Game.ToggleSpecialMenu(0);
      Game.volume = vol;
      if (Game.prefs) Game.prefs.particles = parts;
    }
    quarters()[q] = drop || OWNED;
    return drop ? 1 : 0;
  }

  // ---- building blocks -----------------------------------------------------------------------
  //
  //   pp.best(kind, skip)     the lowest payback period of building / upgrade / all ("": nothing);
  //                           skip: only what you can afford now. Its result names a thing to buy:
  //   pp.kind(thing) · pp.price(thing) · pp.of(thing) · pp.buy(thing)
  //                           (cm.best, cm.kind, cm.price, cm.pp, cm.buy: their names before v3.5 —
  //                           still understood, so code written then keeps working)
  //   upgrades()              a list: the store's upgrades, cheapest first
  //   upgrade.price(u) · upgrade.owned(name) · buy.upgrade(u)
  //   research.next(stopBefore)  the next research to buy ("": none — or only what's at / after stopBefore)
  //   dragon.canPet() · dragon.dropNow() (this quarter-hour's drop if you're missing it, "?" not tried yet) · dragon.pet()

  const KINDS = { building: ['building'], upgrade: ['upgrade'], all: ['building', 'upgrade'] };
  const thingKey = (c) => `${c.kind}:${c.name}`;
  /** A thing to buy by its key: from what this pass ranked already (pp.best's pick), else the full ranking. */
  function thingOf(k) {
    if (!k) return null;
    const hit = memo && memo.pass === CA.Macros.passKey() ? [...memo.lists.values()].flat().find((c) => thingKey(c) === String(k)) : null;
    // the Auto buyer's queue (its profile's bulk): what buyer.next() named
    const queued = !hit && CA.AutoBuyer ? CA.AutoBuyer.thingOf(k) : null;
    if (queued)
      return {
        ...queued,
        buy: () => {
          const pre = CA.AutoBuyer.before();
          const got = P().buy(queued);
          if (got > 0) CA.AutoBuyer.noteBought(queued, null, pre);
          return got;
        },
      };
    if (String(k) === 'allUpgrades') {
      const all = P().allUpgrades();
      return all.n ? { ...all, buy: () => P().buy(all) } : null;
    }
    return hit || candidates(['building', 'upgrade']).find((c) => thingKey(c) === String(k)) || null;
  }
  const upgradeNamed = (n) => (Game.UpgradesInStore || []).find((u) => u && u.name === n) || (Game.UpgradesByName && Game.UpgradesByName[n]) || (Game.Upgrades && Game.Upgrades[n]) || null;
  function blocks() {
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, ...(more || {}) });
    // each under its name, and its pre-v3.5 cm.* name (hidden from the library)
    const both = (id, old, desc, get, more) => {
      V(id, desc, get, more);
      V(old, `${desc} — the old name of ${id}`, get, { ...(more || {}), hidden: true });
    };
    const bestOf = (kind, skip, budget) => {
      const b = best(KINDS[kind] || KINDS.all, !!skip && skip !== 'false', budget === undefined || budget === '' ? undefined : Number(budget));
      return b ? thingKey(b) : '';
    };
    both('pp.best', 'cm.best', 'the lowest payback period of a kind: building, upgrade or all ("": none); skip: only what you can afford (with budget cookies, if given — e.g. the bank less a reserve)', bestOf, { params: ['kind', 'skip', 'budget'] });
    both('pp.kind', 'cm.kind', 'what a thing to buy is: "building", "upgrade" or "allUpgrades" (Buy all upgrades, the Auto buyer’s)', (k) => String(k || '').split(':')[0], { params: ['thing'] });
    both('pp.price', 'cm.price', 'cookies a thing to buy costs', (k) => (thingOf(k) || { price: NaN }).price, { params: ['thing'] });
    both('pp.of', 'cm.pp', 'a thing’s payback period (seconds)', (k) => (thingOf(k) || { pp: NaN }).pp, { params: ['thing'] });
    V('upgrades', 'a list: the upgrades in the store, cheapest first', () => storeUpgrades().map((u) => ({ u, price: priceOf(u) })).sort((a, b) => a.price - b.price).map((x) => x.u.name), { list: true });
    V('upgrade.price', 'an upgrade’s price', (n) => {
      const u = upgradeNamed(n);
      return u ? priceOf(u) : NaN;
    }, { params: ['upgrade'] });
    V('upgrade.owned', 'whether you have an upgrade: owned, or unlocked (in the store)', (n) => has(n), { params: ['upgrade'], bool: true });
    V('research.next', 'the next research to buy, stopping before stopBefore ("": none)', (stop) => (researchPick(stop) || {}).name || '', { params: ['stopBefore'] });
    V('dragon.canPet', 'whether you can pet the dragon (level 8, “Pet the dragon”)', () => canPet(), { bool: true });
    V('dragon.dropNow', 'whether petting the dragon this quarter-hour can still give a drop you’re missing (learned by petting: its drop, or "?" not tried yet; "": none)', () => {
      const x = petSchedule().find((y) => y.now);
      return x && x.open ? x.drop || '?' : '';
    });
    const A = CA.Actions.register;
    const buyThing = (hidden) => ({
      id: hidden ? 'cm.buy' : 'pp.buy',
      name: hidden ? 'Buy a building or upgrade (old name of pp.buy)' : 'Buy a building or upgrade (from pp.best)',
      icon: 'building',
      group: 'Buying',
      unit: 'bought',
      hidden,
      params: [{ key: 'thing', label: 'Thing', type: 'select', default: '', options: () => candidates(['building', 'upgrade']).map((c) => ({ v: thingKey(c), label: c.label })) }],
      run: (p) => {
        const c = thingOf(p.thing);
        const ok = c && c.price <= Game.cookies && c.buy() > 0 ? 1 : 0;
        memo = null;
        return ok;
      },
    });
    A(buyThing(false));
    A(buyThing(true));
    A({
      id: 'buy.upgrade',
      name: 'Buy an upgrade',
      icon: 'upgrade',
      group: 'Buying',
      unit: 'bought',
      params: [{ key: 'upgrade', label: 'Upgrade', type: 'select', default: '', options: () => storeUpgrades(null).concat(storeUpgrades(['tech'])).map((u) => ({ v: u.name, label: u.dname || u.name })) }],
      run: (p) => {
        const u = upgradeNamed(p.upgrade);
        memo = null;
        return u ? buyUpgrade(u) : 0;
      },
    });
  }

  // ---- actions and built-in macros -----------------------------------------------------------

  function init() {
    blocks();
    const A = CA.Actions.register;
    const skipParam = { key: 'skip', label: 'Skip what you can’t afford yet', type: 'bool', default: false };
    const reserveParam = { key: 'reserve', label: 'Bank reserve (minutes of unbuffed CpS)', type: 'number', default: 0, min: 0 };
    A({
      id: 'cm.buyBuilding',
      name: 'Buy the best building (lowest payback period)',
      icon: 'building',
      group: 'Buying',
      hidden: true, // v3.43: the Auto buyer's buyer.buyNext
      unit: 'bought',
      params: [skipParam, reserveParam],
      ready: (p) => readiness('building', p.skip, p.reserve),
      run: (p) => runBuyer('building', p.skip, p.reserve),
    });
    A({
      id: 'cm.buyUpgrade',
      name: 'Buy the best upgrade (lowest payback period)',
      icon: 'upgrade',
      group: 'Buying',
      hidden: true, // v3.43: the Auto buyer's buyer.buyNext
      unit: 'bought',
      params: [skipParam, reserveParam],
      ready: (p) => readiness('upgrade', p.skip, p.reserve),
      run: (p) => runBuyer('upgrade', p.skip, p.reserve),
    });
    A({
      id: 'buy.research',
      name: 'Buy research',
      icon: 'sparkle',
      group: 'Buying',
      unit: 'bought',
      params: [
        {
          key: 'stopBefore',
          label: 'Stop before',
          type: 'select',
          default: 'One mind',
          // the research in order, then "never" (all of it) last
          options: () => RESEARCH.map((r) => ({ v: r, label: r === 'One mind' ? 'One mind (starts the Grandmapocalypse)' : r })).concat([{ v: 'none', label: 'never — buy it all' }]),
        },
      ],
      describe: (p) => (p.stopBefore && p.stopBefore !== 'none' ? `Buy research (up to before ${p.stopBefore})` : 'Buy all research'),
      ready: (p) => {
        const u = researchPick(p.stopBefore);
        return u ? { ok: Game.cookies >= priceOf(u), text: `next: ${u.dname || u.name}`, upgrade: u.name } : { ok: false, text: 'no research to buy' };
      },
      run: (p) => {
        const u = researchPick(p.stopBefore);
        return u ? buyUpgrade(u) : 0;
      },
    });
    A({
      id: 'buy.cheapUpgrades',
      name: 'Buy cheap upgrades',
      icon: 'dollar',
      group: 'Buying',
      unit: 'bought',
      params: [{ key: 'secs', label: 'Costing less than (seconds of production)', type: 'number', default: 1, min: 0 }],
      describe: (p) => `Buy upgrades costing under ${p.secs}s of production`,
      ready: (p) => {
        const c = cheapUpgrades(p.secs)[0];
        return c ? { ok: Game.cookies >= c.price, text: `next: ${c.u.dname || c.u.name}`, upgrade: c.u.name } : { ok: false, text: 'nothing that cheap' };
      },
      run: (p) => cheapUpgrades(p.secs).reduce((n, x) => n + buyUpgrade(x.u), 0),
    });
    A({
      id: 'dragon.pet',
      name: 'Pet the dragon for its drops',
      icon: 'sparkle',
      group: 'Other',
      unit: 'drops',
      available: canPet,
      ready: () => {
        if (!canPet()) return { ok: false, text: 'needs dragon level 8 and “Pet the dragon”' };
        const s = petSchedule();
        if (!s.length) return { ok: true, text: 'all four drops found' };
        const now = s.find((x) => x.now && x.open);
        const next = s.filter((x) => x.open).sort((a, b) => a.inSec - b.inSec)[0];
        if (now) return { ok: true, text: now.drop ? `${now.drop} drops this quarter-hour` : 'this quarter-hour’s drop: not tried yet' };
        return { ok: false, text: next ? `${next.drop || 'an untried quarter-hour'} in ${CA.Format.span(next.inSec)}` : 'all four drops found' };
      },
      run: () => pet(),
    });

    const M = CA.Macros;
    M.addBuiltin({
      id: 'research',
      name: 'Research',
      desc: 'Buys the Bingo center’s research as soon as it shows up — stopping before One mind by default, so it never starts the Grandmapocalypse unless you say so.',
      icon: { sprite: [11, 9] },
      mode: 'flow',
      every: 2000,
      defaultSource: "# Buy the Bingo center's research as it shows up — stopping before stopBefore (One mind starts\n# the Grandmapocalypse; \"none\": buy it all).\nforever:\n  r = research.next(stopBefore)\n  if r != \"\" and upgrade.price(r) <= cookies():\n    buy.upgrade(r)\n",
      inputs: [{ key: 'stopBefore', label: 'Stop before', type: 'select', default: 'One mind', options: () => CA.Actions.get('buy.research').params[0].options() }],
      readiness: (ins) => CA.Actions.get('buy.research').ready({ stopBefore: ins.stopBefore }),
      holdRepeat: true,
      section: 'buying',
    });
    M.addBuiltin({
      id: 'cheapUpgrades',
      name: 'Cheap upgrades',
      desc: 'Buys any upgrade costing less than a second (or however many you set) of your unbuffed production — the small stuff, without thinking about it.',
      icon: { ico: 'dollar' },
      mode: 'flow',
      every: 1000,
      defaultSource: "# Buy every upgrade costing less than secs seconds of your unbuffed production — cheapest first.\nforever:\n  for u in upgrades():\n    if upgrade.price(u) <= rawCps() * secs:\n      buy.upgrade(u)\n",
      inputs: [{ key: 'secs', label: 'Costing less than (seconds of production)', type: 'number', default: 1, min: 0 }],
      readiness: (ins) => CA.Actions.get('buy.cheapUpgrades').ready({ secs: ins.secs }),
      holdRepeat: true,
      section: 'buying',
    });
    M.addBuiltin({
      id: 'petDragon',
      name: 'Pet the dragon',
      desc: 'Gets the dragon’s four drops: learns by petting which quarter of the hour gives which, and in a quarter that can still give one you’re missing opens the dragon, pets it until it drops, and closes it. Needs dragon level 8 and the “Pet the dragon” upgrade.',
      icon: { sprite: [30, 12] },
      mode: 'flow',
      every: 30000,
      defaultSource: "# Get the dragon's four drops: in a quarter of the hour that can still give one you're missing (or\n# not tried yet), pet it until it drops (dragon level 8 and the \"Pet the dragon\" upgrade).\nforever:\n  if dragon.canPet() and dragon.dropNow() != \"\":\n    dragon.pet()\n",
      readiness: () => CA.Actions.get('dragon.pet').ready({}),
      section: 'upkeep',
    });
  }

  return { init, best, candidates, readiness, petSchedule, cheapUpgrades, researchPick, RESEARCH, DROPS };
})();
