// The **Auto buyer**: one buyer for buildings and upgrades (and, later, other things you buy), driven
// by profiles. It supersedes the Best building and Best upgrade macros (v3.44).
//
// A profile ranks everything it may buy into one **queue**, and the buyer buys the front:
//
//   rank by     a payback mode's payback period ("": the mode in use — features/payback.js)
//   buys        buildings and/or upgrades, and "Buy all upgrades" as one thing (the game's button:
//               every store upgrade the budget affords, cheapest first, measured as one purchase —
//               features/payback.js allUpgrades); buildings in a bulk (auto: the store's minimum bulk,
//               rounded up with Round to multiples — what the old buyers bought) or ×1 / ×10 / ×100;
//               and the garden: what the gardener plants next (features/garden.js plantings — a
//               seed's empty tiles while its round grows, or a new round once one is due), its gain
//               the golden cookie income the grown plants add (Actual income less CpS + clicking,
//               × the garden's golden cookie frequency gain) — bought by planting it
//   cheap ×100  seconds of unbuffed CpS (0: off; default 1): a building whose next 100 cost less than
//               that, and that the budget affords, is bought 100 at a time ahead of the queue — no
//               ranking by payback period for what costs next to nothing
//   skip        only what it can afford now (else it saves up for the front)
//   reserve     minutes of unbuffed CpS it keeps
//   banks       more banks it keeps, each picked on or off: lucky, conjure, luckyFrenzy (what a
//               golden cookie or the spell needs to pay its most), garden (replanting the whole
//               layout) and gardenRounds (the garden's rounds: the nursetulips' while not all planted,
//               plus roundsMargin × the golden clovers' — features/garden.js roundsReserve). The highest of these and the minutes is the most it keeps (buyer.reserve).
//   at          where each of those thresholds sits in the queue (its **priority**): "first" (the
//               default — ahead of everything: nothing is bought into it, as before) or a score
//               0–100 (what scores at least that may go ahead of it and spend into it; what scores
//               less waits until it's kept). Thresholds are things the queue "buys" by saving up:
//               one the bank already covers is kept, and the buyer moves on below it.
//   rules       top to bottom, each { what it applies to, what it does, when (code, optional) }:
//                 first   jumps the queue (the ones that do are ordered by payback period)
//                 weight  multiplies its payback period by k (below 1: preferred; above: put off)
//                 cap     a building: no more than n owned (a bulk that would pass it buys up to it)
//                 never   held back
//               "when" is a condition in the macro language (features/script.js), with `thing`
//               standing for what's ranked — so any statistic can switch a rule on.
// A thing's **implied payback period** is its payback period after the weights; the queue is sorted by it
// ("first" ones ahead). Its **score** puts that on one standard scale: 100 for the best payback period
// in the queue, 10 points less for each doubling (90: twice as long, 80: four times, 0: 1024 times
// or worse) — so a weight ×2 costs 10 points. A threshold placed at a score is the other way round:
// its implied payback period is the one that score stands for. What never pays back is held back,
// unless a "first" rule takes it.
//
// The buyer walks the queue from the front: a threshold the bank covers is kept (what's below it may
// only spend above it); one it doesn't yet is what it's **waiting for** — saving up, nothing below
// is bought; otherwise the first thing is what it buys next (skip: the first it can afford above
// what's kept). buyer.waitingFor() names what it's saving for.
//
// Profiles are saved in the settings section 'buyer' ({ profiles, active }), seeded with stable ids:
// payback (both kinds — the old two buyers together), buildings, upgrades.
//
// Script (the macro language):
//   buyer.queue(profile)          a list: the queue's things, front first (profile: id or name; none: the active one)
//   buyer.next(profile)           the front ("": nothing)
//   buyer.rank(thing, profile)    its place: 1 the front, 0 not in the queue (held back, or not there)
//   buyer.score(thing, profile)   its score: 0–100, 100 the best payback period (NaN: not ranked)
//   buyer.impliedPayback(thing, profile)  its implied payback period (seconds; NaN: not ranked, or first)
//   buyer.waitingFor(profile)     what the buyer is saving up for ("": it can buy now) — a thing, or a
//                                 threshold ("bank:lucky", "bank:garden", "bank:cps"…)
//   buyer.budget(profile)         what the buyer may spend on what it buys next: the bank less what's kept ahead of it
//   buyer.reserve(profile)        the most the profile keeps: the highest of its thresholds (cookies)
//   buyer.activeProfile()  buyer.profiles()  buyer.profileActive(profile)
//   buyer.buyNext(profile)        (action) buys the front when the budget covers it
//   buyer.profile(profile)        (action) makes a profile the active one
//   buy.allUpgrades()             (action) the game's "Buy all upgrades" (Inspired checklist), without needing it
// What it bought (buyer.buyNext, or pp.buy of what buyer.next named) is kept, the last 100, in the save:
// recentBought(), newest first — the Manager widget's Auto buyer row (ui/buyerRow.js) and the Payback page's
// Purchase history (ui/autoBuyerCard.js).
// A thing is "building:Cursor", "upgrade:Kitten helpers" or "allUpgrades" — what pp.best returns; pp.kind, pp.price,
// pp.of and pp.buy take it (features/autoBuy.js). A threshold in the queue is "bank:<id>": pp.price gives what
// it keeps; it can't be bought.

CA.AutoBuyer = (() => {
  const P = () => CA.Payback;
  const BULKS = ['auto', 1, 10, 100];
  const WHATS = ['any', 'building', 'upgrade', 'allUpgrades', 'cheap', 'achievement', 'cookie', 'kitten', 'synergy', 'clicking'];
  const EFFECTS = ['first', 'weight', 'cap', 'never'];
  const GM = () => CA.GoldenMath;
  /** The Garden rounds bank's default margin (features/garden.js roundsReserve): × a golden clover round. */
  const ROUNDS_MARGIN = 1.25;
  /** The thresholds kept for the garden: what garden things may spend into (none kept while a short effect runs). */
  const GARDEN_BANKS = ['garden', 'gardenRounds'];
  /** The banks a profile may keep on top of its minutes of CpS (the bank warnings' own banks, and the garden's). */
  const BANKS = [
    { id: 'lucky', label: 'Lucky!', tip: 'what a Lucky! needs to pay its most (bank.lucky)', get: () => GM().lucky().bank },
    { id: 'conjure', label: 'Conjure', tip: 'what Conjure Baked Goods needs to pay its most (bank.conjure)', get: () => GM().conjure().bank },
    { id: 'luckyFrenzy', label: 'Frenzy Lucky!', tip: 'what a Lucky! in a Frenzy needs to pay its most (bank.luckyFrenzy)', get: () => GM().lucky(true).bank },
    { id: 'garden', label: 'Garden replant', tip: 'what replanting the whole garden layout costs (garden.layoutCost)', get: () => (CA.Garden.minigame() ? CA.Garden.layoutCost() : 0), detail: gardenDetail },
    {
      id: 'gardenRounds',
      label: 'Garden rounds',
      tip: 'what the garden’s rounds need, at unbuffed prices: the nursetulips’ round while they aren’t all planted, plus the margin × a round of the other seeds (golden clovers) — seeds cost minutes of CpS, so CpS bought doesn’t bring a round closer; the buyer spends what’s above (garden.roundsReserve)',
      get: (p) => (CA.Garden.minigame() ? CA.Garden.roundsReserve(p && p.roundsMargin) : 0),
      detail: roundsDetail,
    },
  ];
  /** What a garden replant plants: "30 seeds: 22 Golden clover, 8 Nursetulip · 3 to plant now". */
  function gardenDetail() {
    const seeds = CA.Garden.minigame() ? CA.Garden.layoutSeeds() : [];
    if (!seeds.length) return '';
    const n = seeds.reduce((m, x) => m + x.n, 0);
    const missing = seeds.reduce((m, x) => m + x.missing, 0);
    return `${n} seed${n === 1 ? '' : 's'}: ${seeds.map((x) => `${x.n} ${x.name}`).join(', ')}${missing ? ` · ${missing} to plant now` : ' · all planted'}`;
  }
  /** What the Garden rounds bank keeps: "8 Nursetulip (all planted) + 1.25 × 22 Golden clover". */
  function roundsDetail() {
    const seeds = CA.Garden.minigame() ? CA.Garden.layoutSeeds() : [];
    if (!seeds.length) return '';
    const p = find();
    const m = p && p.roundsMargin !== undefined ? p.roundsMargin : ROUNDS_MARGIN;
    return seeds
      .map((x) => (x.key === 'nursetulip' ? `${x.n} ${x.name} (${x.missing ? `${x.missing} to plant` : 'all planted: not kept'})` : `${m} × ${x.n} ${x.name}`))
      .join(' + ');
  }
  /** Every threshold's id: the minutes of CpS ('cps') and the banks. */
  const THRESHOLDS = ['cps'].concat(BANKS.map((b) => b.id));
  /** The places a threshold may take: first, or among the ranked things at a score. */
  const PLACES = ['first', 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];
  /** A threshold's place: 'first', or a score 0–100. */
  const cleanAt = (v) => (v === undefined || v === null || v === '' || v === 'first' || !Number.isFinite(Number(v)) ? 'first' : Math.max(0, Math.min(100, Math.round(Number(v)))));

  /** The rule profiles that buy upgrades come with (v3.50): lots of upgrades affordable → buy them all at once. */
  const BULK_RULE = { what: 'allUpgrades', effect: 'first', when: 'payback.allUpgradesCount(buyer.budget()) >= 20' };
  const SEEDS = [
    { id: 'payback', name: 'Payback', kinds: { building: true, upgrade: true, allUpgrades: true }, bulk: 'auto', cheapBulk: 1, skip: false, reserve: 0, banks: [], mode: '', rules: [cleanRule(BULK_RULE)] },
    { id: 'buildings', name: 'Buildings only', kinds: { building: true, upgrade: false, allUpgrades: false }, bulk: 'auto', cheapBulk: 1, skip: false, reserve: 0, banks: [], mode: '', rules: [] },
    { id: 'upgrades', name: 'Upgrades only', kinds: { building: false, upgrade: true, allUpgrades: true }, bulk: 'auto', cheapBulk: 1, skip: false, reserve: 0, banks: [], mode: '', rules: [cleanRule(BULK_RULE)] },
    // v4.0: what Nunix late game buys with once it plays for golden cookie combos — ranked by actual
    // income, never below what a Lucky! and the garden's rounds need (the tulips first, the clovers'
    // round with a quarter on top: CpS bought only raises their price)
    { id: 'combos', name: 'Golden cookie combos', kinds: { building: true, upgrade: true, allUpgrades: true, garden: true }, bulk: 'auto', cheapBulk: 1, skip: false, reserve: 0, banks: ['lucky', 'gardenRounds'], roundsMargin: 1.25, mode: 'actualIncome', rules: [cleanRule(BULK_RULE)] },
  ].map(cleanProfile);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  let profiles = copy(SEEDS);
  let active = 'payback';
  let rev = 0; // bumped on every change: the queue's memo key

  // ---- profiles ------------------------------------------------------------------------------

  function cleanRule(r) {
    const x = r && typeof r === 'object' ? r : {};
    const what = typeof x.what === 'string' && (WHATS.includes(x.what) || /^(b|u):.+/.test(x.what)) ? x.what : 'any';
    return {
      on: x.on !== false,
      what,
      secs: Math.max(0, Number(x.secs) || 60),
      effect: EFFECTS.includes(x.effect) ? x.effect : 'first',
      k: Number(x.k) > 0 ? Number(x.k) : 1,
      n: Math.max(0, Math.floor(Number(x.n) || 0)),
      when: typeof x.when === 'string' ? x.when.slice(0, 500) : '',
    };
  }
  function cleanProfile(p, i) {
    const x = p && typeof p === 'object' ? p : {};
    const kinds = x.kinds && typeof x.kinds === 'object' ? x.kinds : {};
    return {
      id: String(x.id || `p${i + 1}`).slice(0, 40),
      name: String(x.name || `Profile ${i + 1}`).slice(0, 40),
      // Buy all upgrades (v3.50): a profile saved before it buys it when it buys upgrades
      kinds: { building: kinds.building !== false, upgrade: kinds.upgrade !== false, allUpgrades: kinds.allUpgrades === undefined ? kinds.upgrade !== false : !!kinds.allUpgrades,
        // the garden: Golden cookie combos saved before it plants (its Garden rounds bank is for it)
        garden: kinds.garden === undefined ? x.id === 'combos' && Array.isArray(x.banks) && x.banks.includes('gardenRounds') : !!kinds.garden,
      },
      bulk: BULKS.includes(x.bulk) ? x.bulk : BULKS.includes(Number(x.bulk)) ? Number(x.bulk) : 'auto',
      // cheap ×100: a profile saved before it gets the default (1 s)
      cheapBulk: x.cheapBulk === undefined ? 1 : Math.max(0, Number(x.cheapBulk) || 0),
      skip: !!x.skip,
      reserve: Math.max(0, Number(x.reserve) || 0),
      banks: BANKS.map((b) => b.id).filter((id) => Array.isArray(x.banks) && x.banks.includes(id)),
      // where each threshold sits in the queue (saved before priorities: first, as they all were)
      at: Object.fromEntries(THRESHOLDS.map((id) => [id, cleanAt(x.at && typeof x.at === 'object' ? x.at[id] : undefined)])),
      // the Garden rounds bank's margin: × a round of the golden clovers (the default: a quarter on top)
      roundsMargin: x.roundsMargin === undefined || !Number.isFinite(Number(x.roundsMargin)) ? ROUNDS_MARGIN : Math.max(0, Number(x.roundsMargin)),
      // the Actual 15 min / 1 h / 3 h modes are one Actual income now (its window: core/settings.js)
      mode: typeof x.mode !== 'string' ? '' : /^actualIncome(15m|1h|3h)$/.test(x.mode) ? 'actualIncome' : x.mode,
      rules: (Array.isArray(x.rules) ? x.rules : []).slice(0, 50).map(cleanRule),
    };
  }

  const list = () => profiles.slice();
  /** A profile by id or name (any case); none / "": the active one. */
  function find(x) {
    if (x === undefined || x === null || x === '') return profiles.find((p) => p.id === active) || profiles[0] || null;
    const k = String(x).toLowerCase();
    return profiles.find((p) => p.id === String(x)) || profiles.find((p) => p.name.toLowerCase() === k) || null;
  }
  const activeProfile = () => (find() || { id: '' }).id;
  function changed() {
    rev++;
    memo = null;
    CA.Events.emit('buyer', null);
  }
  /** Makes a profile the active one: 1 when it changed, 0 when it already was (or there's no such profile). */
  function use(x) {
    const p = find(x);
    if (!p || p.id === active) return 0;
    active = p.id;
    changed();
    return 1;
  }
  function newId() {
    let i = profiles.length + 1;
    while (profiles.some((p) => p.id === `p${i}`)) i++;
    return `p${i}`;
  }
  /** A new profile, a copy of `from` (none: the active one); returns it. */
  function create(name, from) {
    const base = find(from) || SEEDS[0];
    const p = cleanProfile({ ...copy(base), id: newId(), name: name || `${base.name} (copy)` }, profiles.length);
    profiles.push(p);
    changed();
    return p;
  }
  /** Changes a profile's fields (name, kinds, bulk, cheapBulk, skip, reserve, banks, at, roundsMargin, mode, rules); returns it. */
  function update(id, fields) {
    const i = profiles.findIndex((p) => p.id === id);
    if (i < 0) return null;
    profiles[i] = cleanProfile({ ...profiles[i], ...fields, id }, i);
    changed();
    return profiles[i];
  }
  function remove(id) {
    if (profiles.length <= 1) return false;
    const i = profiles.findIndex((p) => p.id === id);
    if (i < 0) return false;
    profiles.splice(i, 1);
    if (active === id) active = profiles[0].id;
    changed();
    return true;
  }
  const addRule = (id, rule) => {
    const p = find(id);
    return p ? update(p.id, { rules: p.rules.concat([cleanRule(rule)]) }) : null;
  };
  function setRule(id, i, fields) {
    const p = find(id);
    if (!p || !p.rules[i]) return null;
    const rules = p.rules.slice();
    rules[i] = cleanRule({ ...rules[i], ...fields });
    return update(p.id, { rules });
  }
  function removeRule(id, i) {
    const p = find(id);
    if (!p || !p.rules[i]) return null;
    return update(p.id, { rules: p.rules.filter((_, j) => j !== i) });
  }
  function moveRule(id, from, to) {
    const p = find(id);
    if (!p || !p.rules[from] || to < 0 || to >= p.rules.length) return null;
    const rules = p.rules.slice();
    rules.splice(to, 0, rules.splice(from, 1)[0]);
    return update(p.id, { rules });
  }

  // ---- rules ------------------------------------------------------------------------------

  const upgradeNamed = (n) => (Game.Upgrades && Game.Upgrades[n]) || (Game.UpgradesInStore || []).find((u) => u && u.name === n) || null;
  const buildingNamed = (n) => (Game.Objects || {})[n] || null;
  const rawCps = () => Game.cookiesPsRaw || Game.unbuffedCps || Game.cookiesPs || 0;

  /** What a rule applies to, in words. */
  function whatText(r) {
    if (r.what.startsWith('b:')) return (buildingNamed(r.what.slice(2)) || { dname: r.what.slice(2) }).dname || r.what.slice(2);
    if (r.what.startsWith('u:')) return (upgradeNamed(r.what.slice(2)) || { dname: r.what.slice(2) }).dname || r.what.slice(2);
    return {
      any: 'Anything',
      building: 'Buildings',
      upgrade: 'Upgrades',
      allUpgrades: 'Buy all upgrades',
      cheap: `Anything costing under ${r.secs} s of CpS`,
      achievement: 'Anything that wins an achievement',
      cookie: 'Cookie upgrades',
      kitten: 'Kittens',
      synergy: 'Synergy upgrades',
      clicking: 'Clicking upgrades',
    }[r.what];
  }
  /** What a rule does, in words. */
  function effectText(r) {
    if (r.effect === 'first') return 'buy first';
    if (r.effect === 'never') return 'never';
    if (r.effect === 'cap') return `up to ${r.n} owned`;
    return `weight ×${r.k}`;
  }
  /** The cheap ×100 badge a building it takes gets. */
  const cheapBulkText = (p) => `cheap: ×100 under ${p.cheapBulk} s`;
  const ruleText = (r) => `${whatText(r)} → ${effectText(r)}${r.when ? ` when ${r.when}` : ''}`;

  function matches(r, x) {
    const w = r.what;
    if (w === 'any') return true;
    if (w === 'building' || w === 'upgrade' || w === 'allUpgrades') return x.kind === w;
    if (w.startsWith('b:')) return x.kind === 'building' && x.name === w.slice(2);
    if (w.startsWith('u:')) return x.kind === 'upgrade' && x.name === w.slice(2);
    if (w === 'cheap') return x.price <= rawCps() * r.secs;
    if (w === 'achievement') return x.kind === 'building' ? P().nextAchievement(x.name).n <= x.n : !!(x.won && x.won.length);
    if (x.kind !== 'upgrade') return false;
    const u = upgradeNamed(x.name);
    if (!u) return false;
    if (w === 'cookie') return u.pool === 'cookie';
    if (w === 'kitten') return !!u.kitten;
    if (w === 'synergy') return !!(u.buildingTie1 && u.buildingTie2);
    if (w === 'clicking') return !!x.estimated;
    return false;
  }

  // a rule's "when": compiled once per text (a statistic's language: `return <condition>`)
  const compiled = new Map();
  /** A "when" condition's problem ("": none). */
  function whenProblem(code) {
    if (!code) return '';
    const c = compileWhen(code);
    return c.errors.length ? c.errors[0].message : '';
  }
  function compileWhen(code) {
    if (!compiled.has(code)) {
      if (compiled.size > 200) compiled.clear();
      compiled.set(code, CA.Script.compile(`return ${code}`, { mode: 'stat', vars: ['thing'] }));
    }
    return compiled.get(code);
  }
  /** Whether a rule's "when" holds for a thing (no "when": always; one with a problem: never). */
  function when(r, key) {
    if (!r.when) return true;
    const c = compileWhen(r.when);
    if (c.errors.length) return false;
    const out = CA.Script.runStat(c.flow, { thing: key });
    return !out.error && !!out.value && !(typeof out.value === 'number' && !Number.isFinite(out.value));
  }

  // ---- the queue -------------------------------------------------------------------------------

  const thingKey = (x) => (x.kind === 'allUpgrades' ? 'allUpgrades' : `${x.kind}:${x.name}`);
  const kindsOf = (p) => ['building', 'upgrade'].filter((k) => p.kinds[k]);
  /** The cookies a reserve of `minutes` of unbuffed CpS keeps in the bank. */
  const reserveOf = (minutes) => Math.max(0, Number(minutes) || 0) * 60 * rawCps();
  /**
   * A profile's thresholds, each { id, label, amount, at } (cookies): its minutes of CpS (id 'cps', when
   * above 0) and the banks it picked; `at` its place in the queue ('first' or a score). `wins` marks the
   * highest — the most it keeps.
   */
  function reserveParts(x) {
    const p = find(x);
    if (!p) return [];
    const at = (id) => cleanAt((p.at || {})[id]);
    const parts = [];
    if (p.reserve > 0) parts.push({ id: 'cps', label: `${p.reserve} min of CpS`, amount: reserveOf(p.reserve), at: at('cps') });
    // while a short effect runs nothing goes into the garden (seeds wait it out), so its banks keep nothing
    const shortEffect = P().waitingOut();
    BANKS.filter((b) => p.banks.includes(b.id) && !(shortEffect && GARDEN_BANKS.includes(b.id))).forEach((b) => {
      const v = Number(b.get(p));
      parts.push({ id: b.id, label: b.label, amount: Number.isFinite(v) ? Math.max(0, v) : 0, at: at(b.id) });
    });
    const top = parts.reduce((m, q) => (!m || q.amount > m.amount ? q : m), null);
    if (top) top.wins = true;
    return parts;
  }
  /** The most a profile keeps: the highest of its thresholds. */
  const keepOf = (x) => reserveParts(x).reduce((m, q) => Math.max(m, q.amount), 0);
  /** What its thresholds placed first keep: what nothing in the queue may spend. */
  const keepFirst = (x) => reserveParts(x).reduce((m, q) => (q.at === 'first' ? Math.max(m, q.amount) : m), 0);
  /** What a profile's buyer may spend on what it buys next: the bank less what's kept ahead of it. */
  const budget = (x) => (Game.cookies || 0) - (find(x) ? queue(x).keep : 0);

  /** n of a building, re-priced and re-measured (a cap that cuts a bulk short). */
  function resized(x, n, p) {
    const b = buildingNamed(x.name);
    const price = P().sumPrice(b, n);
    const worth = P().buildingWorth(x.name, n);
    const parts = P().parts(price, worth, p.mode);
    return { ...x, n, label: n > 1 ? `${n} × ${b.dname || x.name}` : b.dname || x.name, price, bonus: worth.bonus, gain: parts.gain, pp: parts.pp, color: null };
  }

  // ---- the score ------------------------------------------------------------------------------

  /** Points a doubling of the payback period costs. */
  const PER_DOUBLING = 10;
  /** The score of an implied payback period, against the best one (100 — and 10 points less a doubling, 0 at the least). */
  const scoreOf = (ipp, best) => (Number.isFinite(ipp) && ipp > 0 && best > 0 ? Math.max(0, Math.min(100, 100 - PER_DOUBLING * Math.log2(ipp / best))) : ipp === 0 && best >= 0 ? 100 : NaN);
  /** The implied payback period a score stands for, against the best one. */
  const ippOf = (score, best) => (best > 0 && Number.isFinite(score) ? best * Math.pow(2, (100 - score) / PER_DOUBLING) : NaN);

  /**
   * A profile's queue: { profile, items: [{ key, kind, name, n, label, price, pp, ipp, score, first, rules: [text], … }]
   * front first — thresholds among them as { kind 'bank', key 'bank:<id>', price: what it keeps, kept, at } —
   * held: [{ …, why }], best (the best implied payback period: score 100), and the walk: next (what it buys next),
   * wait (what it's saving for: a threshold or next; null: it can buy now), keep (what's kept ahead of next) }
   * — memoized for a moment (same bank, same profiles, same macro pass).
   */
  let memo = null; // { k, t, q }
  function queue(x) {
    const p = find(x);
    if (!p) return { profile: null, items: [], held: [], best: NaN, next: null, wait: null, keep: 0 };
    const pass = CA.Macros && CA.Macros.passKey ? CA.Macros.passKey() : null;
    const k = `${p.id}|${rev}|${Game.cookies}|${Game.cookiesPs}|${P().mode().id}|${pass}|${(Game.UpgradesInStore || []).length}`;
    const now = Date.now();
    if (memo && memo.k === k && now - memo.t < 1000) return memo.q;
    const q = build(p);
    memo = { k, t: now, q };
    last = q;
    return q;
  }
  let last = null; // the latest queue worked out (pp.price / pp.buy find its things)

  function build(p) {
    const kinds = kindsOf(p);
    const kind = kinds.length === 2 ? 'all' : kinds[0];
    const thresholds = reserveParts(p.id).filter((t) => t.amount > 0);
    if (!kind && !p.kinds.allUpgrades && !p.kinds.garden) return walk(p, thresholds.map((t) => bankItem(t, NaN)), [], NaN);
    // a mode that isn't there (deleted) or not ready yet (actual income, under a minute recorded): the one in use
    const mode = p.mode && P().modeOf(p.mode) && Number.isFinite(P().income(p.mode)) ? p.mode : undefined;
    // what anything may spend at most: the bank less the thresholds placed first (one placed at a
    // score holds back only what's below it — the walk sees to that)
    const b = (Game.cookies || 0) - keepFirst(p.id);
    const ranked = kind ? P().ranking(kind, { bulk: p.bulk, mode, all: true, skip: p.skip, budget: b }) : [];
    const items = [];
    const held = [];
    // Buy all upgrades: what the budget affords now, as one thing — fewer than two is just buying that one
    if (p.kinds.allUpgrades) {
      const all = P().allUpgrades({ budget: b, mode });
      if (all.n >= 2) ranked.push(all);
      else held.push({ ...all, key: thingKey(all), ipp: NaN, score: NaN, first: false, rules: [], why: all.n ? 'affords only one upgrade: the same as buying it' : 'affords no upgrades', color: 'gray' });
    }
    if (p.kinds.garden) gardenThings().forEach((g) => (g.why ? held : ranked).push(g));
    const rules = p.rules.filter((r) => r.on);
    // cheap ×100: what the next 100 of a building may cost at most (0: off)
    const cheap = p.cheapBulk > 0 ? rawCps() * p.cheapBulk : 0;
    ranked.forEach((r0) => {
      let r = { ...r0, key: thingKey(r0), ipp: r0.pp, first: false, rules: [] };
      if (cheap > 0 && r.kind === 'building') {
        const price = P().sumPrice(buildingNamed(r.name), 100);
        if (price <= cheap && price <= b) r = { ...(r.n === 100 ? r : resized(r, 100, p)), key: r.key, first: true, rules: [cheapBulkText(p)], why: 'cheap' };
      }
      // a CpS-scaled upgrade while a short effect runs: priced as once it's over, and waited out
      let why = r.waits ? 'an effect makes it more expensive: waits it out' : Number.isFinite(r.pp) ? '' : 'never pays back';
      for (const rule of rules) {
        if (!matches(rule, r) || !when(rule, r.key)) continue;
        if (rule.effect === 'never') {
          why = ruleText(rule);
          r.rules.push(effectText(rule));
          break;
        }
        if (rule.effect === 'cap') {
          if (r.kind !== 'building') continue;
          const room = rule.n - (buildingNamed(r.name) || { amount: 0 }).amount;
          if (room <= 0) {
            why = `${effectText(rule)} (${whatText(rule)})`;
            r.rules.push(effectText(rule));
            break;
          }
          if (room < r.n) r = { ...resized(r, room, p), key: r.key, ipp: NaN, first: r.first, rules: r.rules, why: r.why };
          r.rules.push(effectText(rule));
        } else if (rule.effect === 'first') {
          r.first = true;
          r.rules.push(rule.what === 'cheap' ? `cheap: under ${rule.secs} s` : effectText(rule));
        } else if (rule.effect === 'weight') {
          r.weight = (r.weight || 1) * rule.k;
          r.rules.push(effectText(rule));
        }
      }
      r.ipp = r.pp * (r.weight || 1);
      if (why && !(r.first && why === 'never pays back')) held.push({ ...r, score: NaN, why });
      else items.push(r);
    });
    const order = (a, b2) => (a.ipp === b2.ipp ? a.pp - b2.pp || 0 : a.ipp - b2.ipp);
    items.sort((a, b2) => (a.first !== b2.first ? (a.first ? -1 : 1) : a.first ? (a.pp === b2.pp ? 0 : a.pp - b2.pp) : order(a, b2)));
    if (p.skip) {
      // a capped bulk may have grown more expensive than the budget; skip still means "only what it can afford"
      for (let i = items.length - 1; i >= 0; i--) if (items[i].price > b) held.push({ ...items.splice(i, 1)[0], score: NaN, why: 'can’t afford it yet' });
    }
    // the score: against the best implied payback period of what's ranked by it (not "first")
    const best = items.reduce((m, x) => (!x.first && Number.isFinite(x.ipp) && x.ipp >= 0 ? Math.min(m, x.ipp) : m), Infinity);
    const bestOk = Number.isFinite(best) ? best : NaN;
    items.forEach((x) => (x.score = scoreOf(x.ipp, bestOk)));
    // the thresholds, each in its place: first ones ahead of everything (the smallest first: the
    // one the bank reaches first), one at a score right after what scores at least that
    const out = items.slice();
    thresholds
      .filter((t) => t.at === 'first')
      .sort((a, c) => c.amount - a.amount)
      .forEach((t) => out.unshift(bankItem(t, bestOk)));
    thresholds
      .filter((t) => t.at !== 'first')
      .sort((a, c) => c.at - a.at)
      .forEach((t) => {
        let i = out.length;
        for (let j = 0; j < out.length; j++) {
          const y = out[j];
          if (y.kind === 'bank' || y.first) continue;
          if (!(y.score >= t.at)) {
            i = j;
            break;
          }
        }
        // after the other thresholds at the same place, too
        while (i < out.length && out[i].kind === 'bank' && out[i].at !== 'first' && out[i].at >= t.at) i++;
        out.splice(i, 0, bankItem(t, bestOk));
      });
    return walk(p, out, held, bestOk);
  }
  /** Whether a threshold row of the queue holds a thing back (the garden's own banks don't hold garden things). */
  const holdsBack = (bank, x) => bank.kind === 'bank' && !(x && x.kind === 'garden' && GARDEN_BANKS.includes(bank.name));
  /**
   * What the gardener plants next, as things to buy (garden:<seed>): its price today, its gain the
   * income its grown plants add — the golden cookie part of the Actual income (less CpS + clicking, unbuffed)
   * × the frequency gain, and CpS + clicking × the CpS change (nursetulips: −2% each). Held while
   * there's no Actual income yet, while an effect makes seeds more expensive and ends soon (payback.waitingOut:
   * priced as once it's over), and (clovers) while the nursetulips have planting to do: they go first.
   */
  function gardenThings() {
    const G = CA.Garden;
    if (!G.minigame()) return [];
    const list = G.plantings();
    // CpS + clicking without the effects running now (a Frenzy's ×7 is golden cookie income too)
    const base = P().income('cpsClicking') / G.priceBoost();
    const golden = Math.max(0, P().income('actualIncome') - base);
    // a short effect (ending within "Wait out effects up to", even beside a long one): seeds wait it out
    const dear = P().waitingOut();
    const tulips = list.some((x) => x.first);
    return list.map((x) => {
      const gain = golden * (x.freq - 1) + base * (x.cps - 1);
      // an effect that ends soon: priced as once it's over (it's waited out)
      const price = dear ? x.price / P().shortBoost() : x.price;
      const t = { kind: 'garden', name: x.seed, n: x.n, label: `${x.round ? 'Replant' : 'Plant'} ${x.n} ${x.name}`, icon: x.icon, round: x.round, price, gain, bonus: gain, pp: gain > 0 ? price / gain : Infinity };
      t.key = thingKey(t);
      const why = !Number.isFinite(golden) ? 'waits for a minute of Actual income (what golden cookies bring in)' : dear ? 'an effect makes seeds more expensive: waits it out' : tulips && !x.first ? 'the nursetulips go first' : '';
      return why ? { ...t, ipp: NaN, score: NaN, first: false, rules: [], why } : t;
    });
  }
  /** A threshold as a thing in the queue: what it keeps as its price, kept once the bank covers it. */
  function bankItem(t, best) {
    const first = t.at === 'first';
    return {
      key: `bank:${t.id}`,
      kind: 'bank',
      name: t.id,
      n: 1,
      label: t.id === 'cps' || t.id === 'garden' ? `Keep ${t.label}` : `Keep ${t.label} bank`,
      price: t.amount,
      pp: NaN,
      gain: NaN,
      at: t.at,
      first,
      score: first ? NaN : t.at,
      ipp: first ? NaN : ippOf(t.at, best),
      kept: (Game.cookies || 0) >= t.amount,
      detail: (BANKS.find((x) => x.id === t.id) || {}).detail ? BANKS.find((x) => x.id === t.id).detail() : t.id === 'cps' ? `${t.label}, unbuffed` : '',
      rules: [first ? 'priority: first' : `priority: after ${t.at}+`],
    };
  }
  /** Walks a queue from the front: what's kept, what it's saving for, what it buys next (see the top). */
  function walk(p, items, held, best) {
    let keep = 0;
    let keepG = 0; // what's kept ahead of a garden thing: the garden's own banks are for it
    let wait = null;
    let nextOne = null;
    const cookies = Game.cookies || 0;
    for (const x of items) {
      if (x.kind === 'bank') {
        if (!wait && cookies < x.price) wait = x;
        keep = Math.max(keep, x.price);
        if (!GARDEN_BANKS.includes(x.name)) keepG = Math.max(keepG, x.price);
        continue;
      }
      if (p.skip && x.price + (x.kind === 'garden' ? keepG : keep) > cookies) continue;
      nextOne = x;
      break;
    }
    if (nextOne && nextOne.kind === 'garden') {
      keep = keepG;
      if (wait && wait.kind === 'bank' && GARDEN_BANKS.includes(wait.name)) wait = null;
    }
    if (!wait && nextOne && nextOne.price + keep > cookies) wait = nextOne;
    // what's kept ahead of next (or of all, when nothing is next)
    if (!nextOne) keep = items.reduce((m, x) => (x.kind === 'bank' ? Math.max(m, x.price) : m), 0);
    return { profile: p, items, held, best, next: nextOne, wait, keep };
  }

  /** What the buyer buys next with a profile: the first thing past the thresholds (skip: the first it can afford above what's kept). */
  const next = (x) => queue(x).next || null;
  /** What it's saving up for: a threshold the bank doesn't cover yet, or what it buys next (null: it can buy now). */
  const waitingFor = (x) => queue(x).wait || null;
  /** A thing of the latest queue worked out (any profile), by key. */
  const thingOf = (k) => (last ? last.items.concat(last.held).find((x) => x.key === String(k)) || null : null);
  /** Buys what's next in a profile's queue when the budget covers it: how many things it bought. */
  function buyNext(x) {
    const p = find(x);
    const f = next(x);
    if (!p || !f || f.price > budget(p.id) || f.price > (Game.cookies || 0)) return 0;
    const pre = before(p);
    const got = P().buy(f);
    memo = null;
    if (got > 0) noteBought(f, p, pre);
    return got > 0 ? 1 : 0;
  }
  /** Why a thing is where it is in the queue, in words: its score, a rule, cheap ×100, a threshold's place. */
  function whyText(f, q) {
    if (!f) return '';
    if (f.kind === 'bank') return f.at === 'first' ? 'a priority: kept before anything is bought' : `a priority: only what scores ${f.at} or more is bought before it`;
    if (f.why === 'cheap') return 'cheap ×100: costs next to nothing';
    if (f.first) return `a rule: ${(f.rules || []).filter((r) => !/^up to/.test(r)).join(', ') || 'buy first'}`;
    const best = q && q.items.find((y) => y.kind !== 'bank' && !y.first) === f;
    return best ? 'the best payback period in the queue' : 'the best score of what it may buy now';
  }
  // what it bought, newest first — the widgets' corner (the last three) and the Payback page's Purchase history
  // (all of it): [{ t, key, kind, name, n, label, names, icon, round, price, pp, gain, cps, income, mode, profile }].
  // Kept in the save (section 'buyerHistory'), so a refresh doesn't wipe it. cps and income are just before
  // buying: the game's CpS and the income of the payback mode (mode) its pp and gain were worked out in —
  // gain ÷ income is the boost it gave.
  const BOUGHT_MAX = 100;
  let bought = [];
  /** Keeps a thing of its queue as just bought (buyer.buyNext, or pp.buy of what buyer.next named). */
  function noteBought(f, p0, pre) {
    const p = p0 || find();
    const { key, kind, name, n, label, names, icon, round, price, pp, gain } = f;
    const { cps, income, mode } = pre || before(p);
    const x = { t: Date.now(), key, kind, name, n, label, names, icon, round, price, pp, gain, cps, income, mode, profile: p ? p.name : '' };
    bought = [x].concat(bought).slice(0, BOUGHT_MAX);
  }
  /** Just before buying with a profile (none: the active one): CpS, the income of its payback mode and that mode's id — noteBought's `pre`. */
  function before(x) {
    const p = find(x);
    const m = P().modeOf(p && p.mode ? p.mode : '');
    return { cps: Game.cookiesPs || 0, income: m ? P().income(m.id) : NaN, mode: m ? m.id : '' };
  }
  /** What the Auto buyer bought last, newest first (the last 100, kept across refreshes). */
  const recentBought = () => bought.slice();
  /** Forgets what it bought (the Purchase history's Clear). */
  function clearBought() {
    bought = [];
  }
  // the save keeps numbers as JSON can: Infinity (never pays back) as null, NaN (not known) left out
  const NUMS = ['price', 'pp', 'gain', 'cps', 'income'];
  const num = (v) => (typeof v === 'number' ? v : v === null ? Infinity : NaN);
  function loadBought(data) {
    bought = (Array.isArray(data) ? data : [])
      .filter((x) => x && typeof x === 'object' && typeof x.key === 'string' && Number.isFinite(x.t))
      .map((x) => ({ ...x, ...Object.fromEntries(NUMS.map((k) => [k, num(x[k])])), names: Array.isArray(x.names) ? x.names : undefined }))
      .slice(0, BOUGHT_MAX);
  }
  function serializeBought() {
    return bought.map((x) => {
      const o = { ...x };
      NUMS.forEach((k) => {
        if (x[k] === Infinity) o[k] = null;
        else if (!Number.isFinite(x[k])) delete o[k];
      });
      return o;
    });
  }
  /** For buttons: what the buyer buys next, and whether it can now (`upgrade`: the upgrade it names, to show with its icon). */
  function readiness(x) {
    const p = find(x);
    if (!p) return { ok: false, text: 'no such profile' };
    const q = queue(p.id);
    const f = q.next;
    const w = q.wait;
    if (w && w.kind === 'bank') {
      const t = P().timeTo(w.price);
      return { ok: false, text: `saving for: ${w.label}${Number.isFinite(t) ? ` — in ${CA.Format.span(t)}` : ''}${f ? `, then ${f.label}` : ''}` };
    }
    if (!f) return { ok: false, text: p.skip ? (q.keep > 0 ? 'nothing affordable above what it keeps' : 'nothing affordable') : 'nothing to buy' };
    const ok = f.price + q.keep <= (Game.cookies || 0);
    const wait = P().timeTo(f.price + q.keep);
    return {
      ok,
      text: `next: ${f.label}${f.estimated ? ' (PP from your clicking)' : ''}${!ok && Number.isFinite(wait) ? ` — in ${CA.Format.span(wait)}${q.keep > 0 ? ' (keeping the reserve)' : ''}` : ''}`,
      upgrade: f.kind === 'upgrade' ? f.name : '',
    };
  }

  // ---- buy all upgrades ------------------------------------------------------------------------

  /**
   * What "Buy all upgrades" buys — the game's own button (Inspired checklist, main.js storeBuyAll):
   * every upgrade in the store but switches, research and what you've vaulted, cheapest first.
   * Lump-priced ones are left too. Returns [{ u, price }].
   */
  function allUpgrades() {
    const priceOf = (u) => (typeof u.getPrice === 'function' ? u.getPrice() : u.basePrice || u.price || 0);
    return (Game.UpgradesInStore || [])
      .filter((u) => u && !u.bought && u.pool !== 'toggle' && u.pool !== 'tech' && !(u.priceLumps > 0) && !(typeof u.isVaulted === 'function' && u.isVaulted()))
      .map((u) => ({ u, price: priceOf(u) }))
      .sort((a, b) => a.price - b.price);
  }
  /** Buys every upgrade "Buy all upgrades" covers that the bank affords, cheapest first: how many it bought. */
  function buyAllUpgrades() {
    let n = 0;
    allUpgrades().forEach(({ u, price }) => {
      if (u.bought || price > (Game.cookies || 0)) return;
      u.buy(1);
      if (u.bought) n++;
    });
    if (n) memo = null;
    return n;
  }

  // ---- save, and moving over from Best building / Best upgrade ----------------------------------------

  function load(data, whole) {
    if (data && Array.isArray(data.profiles) && data.profiles.length) {
      profiles = data.profiles.map((raw, i) => {
        const p = cleanProfile(raw, i);
        // Golden cookie combos saved before the Garden rounds bank: its garden replant becomes that
        if (p.id === 'combos' && raw && raw.roundsMargin === undefined && p.banks.join() === 'lucky,garden') {
          p.banks = ['lucky', 'gardenRounds'];
          p.at = { ...p.at, gardenRounds: p.at.garden };
        }
        // saved before Buy all upgrades (v3.50): one that buys upgrades gets its rule
        const old = !(raw && raw.kinds && typeof raw.kinds === 'object' && 'allUpgrades' in raw.kinds);
        if (old && p.kinds.upgrade && p.rules.length < 50) p.rules.push(cleanRule(BULK_RULE));
        return p;
      });
      active = profiles.some((p) => p.id === data.active) ? data.active : profiles[0].id;
      // seeds added since the save was made (one you deleted stays deleted: the save lists what it was given)
      const given = Array.isArray(data.seeded) ? data.seeded : ['payback', 'buildings', 'upgrades'];
      SEEDS.forEach((s) => !given.includes(s.id) && !profiles.some((p) => p.id === s.id) && profiles.push(copy(s)));
    } else {
      profiles = copy(SEEDS);
      active = 'payback';
      migrate(whole || {});
    }
    changed();
  }
  /**
   * A save from before v3.44: Best building (cmBuildings) and Best upgrade (cmUpgrades). Which
   * were on picks the profile (both or neither: payback; one: buildings / upgrades only), their
   * skip and reserve become its; their hotkeys the Auto buyer's. Whether it runs: the running
   * list (CA.Macros.rename maps the old ids).
   */
  function migrate(whole) {
    const prefs = (whole.macros && whole.macros.prefs) || {};
    const running = Array.isArray(whole.running) ? whole.running : [];
    const bOn = running.includes('cmBuildings');
    const uOn = running.includes('cmUpgrades');
    const pick = bOn && !uOn ? 'buildings' : uOn && !bOn ? 'upgrades' : 'payback';
    const ins = (id) => (prefs[id] && prefs[id].inputs) || {};
    const from = pick === 'upgrades' ? ins('cmUpgrades') : { ...ins('cmUpgrades'), ...ins('cmBuildings') };
    const p = profiles.find((x) => x.id === pick);
    if (from.skip !== undefined) p.skip = !!from.skip && from.skip !== 'false';
    if (Number(from.reserve) > 0) p.reserve = Number(from.reserve);
    active = pick;
    // a ★ on either: the Auto buyer's (its left-panel button) — the macros' section loads before this one
    if ((prefs.cmBuildings && prefs.cmBuildings.fav) || (prefs.cmUpgrades && prefs.cmUpgrades.fav)) CA.Macros.setFav('autoBuyer', true);
    const keys = (whole.hotkeys && typeof whole.hotkeys === 'object' && whole.hotkeys) || {};
    const old = keys['macro.cmBuildings'] || keys['macro.cmUpgrades'];
    if (old && !keys['macro.autoBuyer'] && CA.Settings.setHotkey) CA.Settings.setHotkey('macro.autoBuyer', old);
  }

  // ---- building blocks -----------------------------------------------------------------------

  const profileOptions = () => [{ v: '', label: 'the active profile' }].concat(profiles.map((p) => ({ v: p.id, label: p.name })));

  function init() {
    CA.Settings.registerSection('buyer', { serialize: () => ({ profiles, active, seeded: SEEDS.map((s) => s.id) }), load, event: 'buyer' });
    // what it bought: mirrored with the rest every 30 s and as the page goes (a refresh), not on each purchase
    CA.Settings.registerSection('buyerHistory', { serialize: serializeBought, load: loadBought });
    const V = (id, desc, params, get, more) => CA.Script.defineValue({ id, desc, params, get, group: 'Auto buyer', ...(more || {}) });
    V('buyer.queue', 'a list: the Auto buyer’s queue, front first — what a profile (id or name; none: the active one) would buy, in order', ['profile'], (x) => queue(x).items.map((i) => i.key), { list: true });
    V('buyer.next', 'the front of a profile’s queue (none: the active one): what the Auto buyer buys next ("": nothing)', ['profile'], (x) => (next(x) || { key: '' }).key);
    V('buyer.rank', 'a thing’s place in a profile’s queue: 1 the front, 0 not in it (held back by a rule, or not for sale)', ['thing', 'profile'], (t, x) => queue(x).items.findIndex((i) => i.key === String(t)) + 1);
    const inQueue = (t, x) => {
      const q = queue(x);
      return q.items.concat(q.held).find((y) => y.key === String(t)) || null;
    };
    V('buyer.score', 'a thing’s score in a profile’s queue, 0–100: 100 for the best payback period, 10 less for each doubling of it (a threshold: the score it’s placed at; NaN: not ranked, or first)', ['thing', 'profile'], (t, x) => (inQueue(t, x) || { score: NaN }).score);
    V('buyer.impliedPayback', 'a thing’s implied payback period in a profile’s queue: its payback period after the rules’ weights — a threshold placed at a score: the one that score stands for (seconds; NaN: not ranked, or first)', ['thing', 'profile'], (t, x) => (inQueue(t, x) || { ipp: NaN }).ipp);
    V('buyer.waitingFor', 'what the Auto buyer is saving up for with a profile: a threshold the bank doesn’t cover yet ("bank:lucky", "bank:garden"…) or what it buys next ("": it can buy now)', ['profile'], (x) => (waitingFor(x) || { key: '' }).key);
    V('buyer.budget', 'what the Auto buyer may spend on what it buys next with a profile: the bank less what’s kept ahead of it', ['profile'], (x) => budget(x));
    V('buyer.reserve', 'the most the Auto buyer keeps in the bank with a profile: the highest of its thresholds (minutes of CpS, Lucky!, Conjure, Frenzy Lucky!, garden replant)', ['profile'], (x) => keepOf(x));
    V('buyer.activeProfile', 'the id of the Auto buyer’s active profile', [], () => activeProfile());
    V('buyer.profiles', 'a list: the Auto buyer’s profiles’ ids', [], () => profiles.map((p) => p.id), { list: true });
    V('buyer.profileActive', 'whether a profile (its id or name) is the Auto buyer’s active one', ['profile'], (x) => !!find(x) && find(x).id === active, { bool: true });

    const A = CA.Actions.register;
    A({
      id: 'buyer.buyNext',
      name: 'Buy the front of the Auto buyer’s queue',
      icon: 'dollar',
      group: 'Buying',
      unit: 'bought',
      params: [{ key: 'profile', label: 'Profile', type: 'select', default: '', options: profileOptions }],
      ready: (p) => readiness(p.profile),
      run: (p) => buyNext(p.profile),
    });
    A({
      id: 'buyer.profile',
      name: 'Use an Auto buyer profile',
      icon: 'dollar',
      group: 'Buying',
      unit: 'switched',
      params: [{ key: 'profile', label: 'Profile', type: 'select', default: 'payback', options: () => profiles.map((p) => ({ v: p.id, label: p.name })) }],
      describe: (p) => `Use the Auto buyer profile ${(find(p.profile) || { name: p.profile }).name}`,
      run: (p) => use(p.profile),
    });

    A({
      id: 'buy.allUpgrades',
      name: 'Buy all upgrades',
      icon: 'upgrade',
      group: 'Buying',
      unit: 'bought',
      ready: () => {
        const all = allUpgrades();
        const can = all.filter((x) => x.price <= (Game.cookies || 0)).length;
        return all.length ? { ok: can > 0, text: `${can} of ${all.length} affordable` } : { ok: false, text: 'no upgrades in the store' };
      },
      run: () => buyAllUpgrades(),
    });
    CA.Macros.addBuiltin({
      id: 'autoBuyer',
      name: 'Auto buyer',
      desc: 'Buys what’s next in the queue on the Payback page: its active profile scores every building and upgrade by payback period (100: the best), then its rules (buy first, weights, caps, never) — with what it keeps (Lucky! bank, garden replant…) in the queue as priorities it saves up for. Replaces Best building and Best upgrade.',
      icon: { ico: 'dollar' },
      mode: 'flow',
      every: 50,
      defaultSource: '# Buy the front of the Auto buyer’s queue (the Payback page): the active profile ranks every\n# building and upgrade by payback period, then by its rules. buyer.budget(): the bank less\n# the profile’s reserve.\nforever:\n  pick = buyer.next()\n  if pick != "" and pp.price(pick) <= buyer.budget():\n    pp.buy(pick)\n',
      readiness: () => readiness(),
      holdRepeat: true,
      section: 'buying',
    });
    // the two it replaces: their ids (left-panel buttons, groups, code, the running list) now mean it
    CA.Macros.rename('cmBuildings', 'autoBuyer');
    CA.Macros.rename('cmUpgrades', 'autoBuyer');
  }

  // a profile's id in code (buyer.profile(payback), buyer.queue(buildings)…): the code editors' hover cards
  CA.Words.defineKind('profile.buyer', {
    name: 'Auto buyer profile',
    info: (id) => {
      const p = find(id);
      if (!p) return null;
      const mode = p.mode ? (P().modes().find((m) => m.id === p.mode || m.key === p.mode) || { label: p.mode }).label : 'the payback mode in use';
      const kinds = Object.keys(p.kinds).filter((k) => p.kinds[k]);
      const front = next(p.id);
      return {
        title: p.name,
        sig: p.id,
        desc: `Scores ${kinds.length ? kinds.map((k) => ({ building: 'buildings', upgrade: 'upgrades', allUpgrades: 'Buy all upgrades' })[k] || k).join(', ') : 'nothing'} by payback period (${mode}) into one queue, with what it keeps as priorities, and the Auto buyer buys what’s next.`,
        rows: [
          ['bulk', p.bulk === 'auto' ? 'auto' : `×${p.bulk}`],
          ['cheap ×100', p.cheapBulk > 0 ? `next 100 under ${p.cheapBulk} s of CpS` : 'off'],
          ['reserve', reserveParts(p.id).length ? reserveParts(p.id).map((x) => x.label).join(', ') : 'none'],
          ['rules', String(p.rules.length)],
          ['front now', front ? front.name : '—'],
          ['in use', p.id === active ? 'yes' : 'no'],
        ],
        note: 'Payback page, Auto buyer.',
      };
    },
  });

  return { init, allUpgrades, buyAllUpgrades, list, find, use, create, update, remove, addRule, setRule, removeRule, moveRule, activeProfile, queue, next, waitingFor, whyText, buyNext, noteBought, before, recentBought, clearBought, BOUGHT_MAX, readiness, budget, keepOf, keepFirst, reserveParts, thingOf, ruleText, whatText, effectText, whenProblem, reserveOf, scoreOf, ippOf, WHATS, EFFECTS, BULKS, BANKS, THRESHOLDS, PLACES, SEEDS, BULK_RULE, GARDEN_BANKS, holdsBack };
})();
