// The building store ("shop"; CA.Store is the IndexedDB layer): sorting the building list and
// rounding bulk buys up to the next multiple.
//
// **Sort** — the order the store lists buildings in (ui/storeBar.js lays the rows out in it):
//   default       the game's own order: Cursor, Grandma, Farm…
//   value         best buy first: by payback period color, then payback period (features/payback.js),
//                 for what a click buys now — ×1, ×10, ×100, or to the next multiple with Round to
//                 multiples on (Cookie Monster's "PP of selected bulk mode")
//   achievement   cheapest to reach the building's next achievement first; buildings more than 100
//                 away from one last, in the game's order
// While the store sells, it's the game's order.
//
// **Minimum bulk** — what cookieMgr's buyers (the Auto buyer, buy.best, the Payback page's ranking, the
// store's Best buy sort) buy a building in: ×1, ×10 or ×100 — single purchases out, if you like to buy
// in tens. With Round to multiples on, up to the next multiple of it (37 owned, ×10 → 3, to 40); off,
// exactly that many. "auto" (the default): ×10 with Round to multiples on, else ×1 — as before.
//
// **Round to multiples** — with ×10 or ×100 selected, a click stops at a multiple of it:
//   buying, the next one up: 37 owned, ×10 → buys 3 (to 40); 40 owned → buys 10
//   selling, the next one down: 37 owned, ×10 → sells 7 (to 30); 40 owned → sells 10
// It wraps each building's buy() (the store calls it with no amount) and sell() (the store's sell
// mode calls it with exactly Game.buyBulk), and the two price functions the store shows prices with
// (getSumPrice, getReverseSumPrice). Explicit amounts from anything else are left alone.
//
// **Start at the minimum bulk** — the game starts every session at ×1. With a minimum bulk of ×10 or
// ×100 (set, or auto with Round to multiples), the store starts at it instead (option startAtMinBulk).

CA.Shop = (() => {
  const SORTS = [
    { id: 'default', name: 'Default', icon: 'sortList', desc: 'The game’s own order: Cursor, Grandma, Farm…' },
    { id: 'value', name: 'Best buy', icon: 'dollar', desc: 'Shortest payback period first, for what a click buys now (×1, ×10 or ×100).' },
    { id: 'achievement', name: 'Achievement', icon: 'trophy', desc: 'Cheapest to reach the next building-count achievement first.' },
  ];
  const wrapped = new WeakSet();

  // ---- sort ------------------------------------------------------------------------------

  const canSort = () => true;
  /** The current sort: 'default' | 'value' | 'achievement'. */
  const sort = () => (SORTS.some((s) => s.id === CA.Settings.get('storeSort')) ? CA.Settings.get('storeSort') : 'default');
  function setSort(id) {
    if (!SORTS.some((s) => s.id === id)) return false;
    CA.Settings.set('storeSort', id);
    CA.Events.emit('shop');
    return true;
  }
  /** The buildings in the order the store should list them (names). */
  function order() {
    const all = Object.values(Game.Objects || {}).sort((a, b) => a.id - b.id);
    const s = sort();
    if (s === 'default' || Game.buyMode !== 1) return all.map((b) => b.name);
    if (s === 'achievement') {
      const price = (b) => {
        const x = CA.Payback.nextAchievement(b.name);
        return x.n <= 100 ? x.price : Infinity;
      };
      return all
        .map((b) => ({ b, p: price(b) }))
        .sort((a, b) => (a.p === b.p ? a.b.id - b.b.id : a.p - b.p))
        .map((x) => x.b.name);
    }
    const t = CA.Payback.table({ staleMs: 2000 }); // redrawn every half second: a table up to 2 s old will do
    const C = CA.Payback.COLORS;
    return all
      .map((b) => {
        // what a click buys — or the minimum bulk, when one is set and it's more
        const bulk = Math.max(Game.buyBulk === 10 || Game.buyBulk === 100 ? Game.buyBulk : 1, Number(CA.Settings.get('minBulk')) || 1);
        const n = amountFor(b, bulk) || 1;
        const row = t.buildings[n] && t.buildings[n][b.name];
        const price = row ? row.price : CA.Payback.sumPrice(b, n);
        const v = row ? row.pp : CA.Payback.ppOf(price, CA.Payback.buildingWorth(b.name, n));
        return { b, v, c: C.indexOf(row ? row.color : t.colorOf(v, price)) };
      })
      .sort((a, b) => (a.c === b.c ? a.v - b.v || a.b.id - b.b.id : a.c - b.c))
      .map((x) => x.b.name);
  }

  // ---- round up ---------------------------------------------------------------------------

  const roundUp = () => !!CA.Settings.get('roundUpBulk');
  /** The minimum bulk cookieMgr's buyers buy in: 1, 10 or 100. */
  function minBulk() {
    const v = Number(CA.Settings.get('minBulk'));
    if (v === 1 || v === 10 || v === 100) return v;
    return roundUp() ? 10 : 1; // auto
  }
  /** How many of a building one purchase by cookieMgr's buyers takes (minimum bulk, rounded up with Round to multiples). */
  function buyAmount(b) {
    const m = minBulk();
    if (m === 1) return 1;
    return roundUp() ? m - ((b && b.amount) || 0) % m : m;
  }
  /** How many a store click buys (or sells) now: the bulk amount, or what it takes to reach a multiple of it. */
  function amountFor(b, bulk = Game.buyBulk) {
    if (!roundUp() || (bulk !== 10 && bulk !== 100)) return bulk;
    const over = (b.amount || 0) % bulk;
    if (Game.buyMode === 1) return bulk - over;
    if (Game.buyMode === -1) return over || bulk;
    return bulk;
  }

  function wrap(b) {
    if (!b || wrapped.has(b) || typeof b.buy !== 'function') return;
    const buy = b.buy;
    b.buy = function (amount) {
      return buy.call(this, amount ? amount : amountFor(this));
    };
    if (typeof b.getSumPrice === 'function') {
      const sum = b.getSumPrice;
      b.getSumPrice = function (amount) {
        return sum.call(this, amount === Game.buyBulk && Game.buyMode === 1 ? amountFor(this, amount) : amount);
      };
    }
    if (typeof b.sell === 'function') {
      const sell = b.sell;
      b.sell = function (amount, bypass) {
        return sell.call(this, amount === Game.buyBulk && Game.buyMode === -1 ? amountFor(this, amount) : amount, bypass);
      };
    }
    if (typeof b.getReverseSumPrice === 'function') {
      const rev = b.getReverseSumPrice;
      b.getReverseSumPrice = function (amount) {
        return rev.call(this, amount === Game.buyBulk && Game.buyMode === -1 ? amountFor(this, amount) : amount);
      };
    }
    wrapped.add(b);
  }

  /** Selects the store's ×1 / ×10 / ×100, as its buttons do (without the click sound). */
  function selectBulk(n) {
    Game.buyBulk = n;
    [
      ['storeBulk1', 1],
      ['storeBulk10', 10],
      ['storeBulk100', 100],
      ['storeBulkMax', -1],
    ].forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('selected', v === n);
    });
    Game.storeToRefresh = 1;
  }
  /** At the start of a session: the store at the minimum bulk, when that's ×10 or ×100 and the store is still at its ×1. */
  function startBulk() {
    if (!CA.Settings.get('startAtMinBulk') || Game.buyMode !== 1 || Game.buyBulk !== 1) return false;
    const m = minBulk();
    if (m !== 10 && m !== 100) return false;
    selectBulk(m);
    return true;
  }

  function refreshStore() {
    Object.values(Game.Objects || {}).forEach((b) => b && typeof b.refresh === 'function' && b.refresh());
  }

  function setRoundUp(on) {
    CA.Settings.set('roundUpBulk', !!on);
  }
  const MIN_BULKS = [0, 1, 10, 100];
  /** Sets the minimum bulk: 0 (auto), 1, 10 or 100. */
  function setMinBulk(v) {
    CA.Settings.set('minBulk', MIN_BULKS.includes(Number(v)) ? Number(v) : 0);
  }

  function init() {
    CA.Settings.defineOption({
      key: 'roundUpBulk',
      group: 'store',
      icon: 'plus',
      name: 'Round to multiples',
      desc: 'With ×10 or ×100 selected, buying stops at the next multiple (37 → 40, not 47) and selling at the one below (37 → 30). Also on the store toolbar.',
      default: false,
    });
    CA.Settings.defineOption({
      key: 'minBulk',
      group: 'store',
      icon: 'building',
      name: 'Minimum bulk',
      desc: 'What cookieMgr’s buyers buy a building in (the Auto buyer on auto bulk, the Payback page’s ranking, the Best buy sort): ×1, ×10 or ×100 — with Round to multiples on, up to the next multiple. Auto: ×10 with Round to multiples, else ×1.',
      default: 0,
      choices: [
        { v: 0, label: 'auto' },
        { v: 1, label: '×1' },
        { v: 10, label: '×10' },
        { v: 100, label: '×100' },
      ],
    });
    CA.Settings.defineOption({
      key: 'storeSwitch',
      group: 'store',
      icon: 'toolbar',
      name: 'Store toolbar',
      desc: 'A small toolbar along the bottom of the store: building sort and rounding to multiples.',
      default: true,
    });
    CA.Settings.defineOption({
      key: 'startAtMinBulk',
      group: 'store',
      icon: 'building',
      name: 'Start at the minimum bulk',
      desc: 'The game starts every session at ×1: with a minimum bulk of ×10 or ×100, the store starts at it instead.',
      default: true,
    });
    CA.Settings.defineOption({ key: 'storeSort', group: 'store-hidden', name: 'Building sort', desc: '', default: 'default' });
    Object.values(Game.Objects || {}).forEach(wrap);
    CA.Events.on('settings', (k) => k === 'roundUpBulk' && refreshStore());
    CA.Events.on('settings', (k) => k === 'minBulk' && CA.Events.emit('shop'));
    setTimeout(startBulk, 0); // once the save's settings are in: the game loads them right after init
  }

  return { init, SORTS, canSort, sort, setSort, order, roundUp, setRoundUp, amountFor, minBulk, buyAmount, setMinBulk, MIN_BULKS, startBulk };
})();
