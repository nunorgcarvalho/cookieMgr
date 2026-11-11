// Stock market trading: the Stock market autobuyer runs a **trader profile** — algorithmic code
// (features/script.js, with the market's words from features/stocks.js) that says what to buy and
// sell, once a second. Profiles are loaded and unloaded like the garden's, the Pantheon's or the
// Grimoire's: one is in use (the macro runs its code), built-ins can be edited (your edit is kept
// apart, Revert brings the built-in back), Save as new makes one of your own (renamed, deleted).
//
//   trends            Ride the trends: buys the max it can afford of fast-rising stocks, then
//                     slow-rising ones, and sells anything it holds that isn't rising (the
//                     autobuyer's strategy before profiles; trade() below is it in JavaScript)
//   trendsAndPrices   Trends and prices (the default): fast rises bought and held, fast falls sold;
//                     every other trend buys a stock under its resting value and sells it over, by
//                     how far — the thresholds a simulator study found (sim/experiments/
//                     stock-market.mjs: the game's own market code, ~60% more profit)
//
// The macro's choices `buy` and `brokers` (on its card; shift-click flips buy) are variables in
// every profile's code. Saved in the settings section 'stockTrader' ({ active, edits, mine }).
//
// For algorithmic code (and managers: manager.profile(stocks, …)):
//   stocks.profile(profile)        uses a trader profile — its id or name (an action)
//   stocks.profileActive(profile)  whether it's the one in use
//   stocks.activeProfile()         the id of the one in use
//   stocks.profiles()              a list: every trader profile's id
//
// The JavaScript trade() uses the Bank minigame's own buy/sell API (M.buyGood/M.sellGood with the
// amount `10000`, the same sentinel value the game's own "buy max"/"sell max" buttons use —
// verified against minigameMarket.js) rather than computing an affordable amount ourselves.

CA.StockTrader = (() => {
  const RISING = [3, 1]; // fast rise, then slow rise — good.mode values (see features/stocks.js)
  const MACRO = 'stockTrader';

  /**
   * Ride the trends' code — the same strategy as trade() below, written with the market's building
   * blocks. Its inputs `buy` and `brokers` are the choices on the autobuyer's card.
   */
  const SOURCE = `# Ride the trends, once a second: hire the stockbrokers you can afford
# (each makes buying 5% cheaper), sell what stopped rising, then buy what's rising.
# buy and brokers are its choices (on its card; shift-click its button flips buy).
# Stock modes: 0 stable · 1 slow rise · 2 slow fall · 3 fast rise · 4 fast fall · 5 chaotic
forever:
  if buy and brokers:
    stocks.hireBrokers()
  # sell anything held that isn't rising
  for good in stocks():
    if stock.held(good) > 0 and stock.mode(good) != 1 and stock.mode(good) != 3:
      stock.sell(good)
  if buy:
    # buy the max you can afford: fast risers first, then slow risers
    for good in stocks():
      if stock.mode(good) == 3:
        stock.buy(good)
    for good in stocks():
      if stock.mode(good) == 1:
        stock.buy(good)
`;

  /** Trends and prices: the thresholds the simulator study found (sim/experiments/stock-market.mjs). */
  const PRICES_SOURCE = `# Trends and prices, once a second: the trend says whether to hold a stock, and how far its price
# is from its resting value (where it drifts back to, stock.resting) says when to buy and sell.
# Fast rises are bought at any price and held; fast falls are sold at once. Every other trend
# buys a stock that far under its resting value and sells it that far over ($ — 1 $ is a second
# of your highest raw CpS). Found with the simulator (the game's own market code, 12 seeds of
# 30 days): about 60% more profit than buying only rising stocks, and it ties up less money.
# buy and brokers are its choices (on its card; shift-click its button flips buy).
# Stock modes: 0 stable · 1 slow rise · 2 slow fall · 3 fast rise · 4 fast fall · 5 chaotic
stableBuyUnder = 30   # stable: buy this far under its resting value…
stableSellOver = 40   # …and sell this far over it
slowRiseBuyUnder = 20   # slow rise: buy this far under…
slowRiseSellOver = 100   # …sell this far over
slowFallBuyUnder = 80   # slow fall: buy only this far under (near the bottom)…
slowFallSellOver = 20   # …sell this far over
chaoticBuyUnder = 10   # chaotic: buy this far under…
chaoticSellOver = 10   # …sell this far over
forever:
  if buy and brokers:
    stocks.hireBrokers()
  # sell: fast falls at once, the others once they're far enough over their resting value
  for good in stocks():
    if stock.held(good) > 0:
      mode = stock.mode(good)
      over = stock.price(good) - stock.resting(good)
      if mode == 4 or (mode == 0 and over > stableSellOver) or (mode == 1 and over > slowRiseSellOver) or (mode == 2 and over > slowFallSellOver) or (mode == 5 and over > chaoticSellOver):
        stock.sell(good)
  if buy:
    # buy the max you can afford: fast risers first, then what's far enough under its resting value
    for good in stocks():
      if stock.mode(good) == 3:
        stock.buy(good)
    for good in stocks():
      mode = stock.mode(good)
      under = stock.resting(good) - stock.price(good)
      if (mode == 0 and under > stableBuyUnder) or (mode == 1 and under > slowRiseBuyUnder) or (mode == 2 and under > slowFallBuyUnder) or (mode == 5 and under > chaoticBuyUnder):
        stock.buy(good)
`;
  const DOLLARS = { kind: 'number', min: 0, max: 150, step: 5, unit: '$' };
  const PRICES_KNOBS = {};
  ['stable', 'slowRise', 'slowFall', 'chaotic'].forEach((k) => {
    PRICES_KNOBS[`${k}BuyUnder`] = DOLLARS;
    PRICES_KNOBS[`${k}SellOver`] = DOLLARS;
  });

  // ---- profiles ------------------------------------------------------------------------------

  const BUILTINS = [
    {
      id: 'trendsAndPrices',
      name: 'Trends and prices',
      desc: 'Fast rises bought and held, fast falls sold; every other trend buys a stock under its resting value and sells it over, by how far — about 60% more profit than riding the trends alone (simulator study).',
      code: PRICES_SOURCE,
      knobs: PRICES_KNOBS,
    },
    {
      id: 'trends',
      name: 'Ride the trends',
      desc: 'Buys the max it can afford of fast-rising stocks, then slow-rising ones, and sells anything it holds that isn’t rising, whatever the price (the autobuyer before profiles).',
      code: SOURCE,
      knobs: {},
    },
  ];
  const DEFAULT = 'trendsAndPrices';
  const SECTION = 'stockTrader';
  let active = DEFAULT;
  let edits = {}; // a built-in's id → { code, knobs } (your version of it)
  let mine = []; // [{ id, name, code, knobs }]
  const changed = () => CA.Events.emit('stockTrader');
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const cleanName = (n, fallback) => String(n == null ? '' : n).trim().slice(0, 40) || fallback;
  const cleanCode = (c) => String(c == null ? '' : c).slice(0, 20000);
  function cleanKnobs(k) {
    const out = {};
    if (!k || typeof k !== 'object') return out;
    Object.keys(k).forEach((name) => {
      if (/^[A-Za-z_]\w*$/.test(name) && k[name] && typeof k[name] === 'object') out[name] = copy(k[name]);
    });
    return out;
  }
  const builtinOf = (id) => BUILTINS.find((b) => b.id === id) || null;
  /** A profile as the pages and the words see it: { id, name, desc, builtin, edited, code, knobs }. */
  function view(x) {
    const b = builtinOf(x.id);
    if (b) {
      const e = edits[b.id];
      return { id: b.id, name: b.name, desc: b.desc, builtin: true, edited: !!e, code: e ? e.code : b.code, knobs: e ? e.knobs : copy(b.knobs) };
    }
    return { id: x.id, name: x.name, desc: '', builtin: false, edited: false, code: x.code, knobs: copy(x.knobs || {}) };
  }
  const list = () => BUILTINS.concat(mine).map(view);
  /** A profile from its id or its name (any case), or null. */
  function find(x) {
    if (x == null || x === '') return null;
    const k = String(x).toLowerCase();
    const all = BUILTINS.concat(mine);
    const it = all.find((p) => p.id === String(x)) || all.find((p) => p.name.toLowerCase() === k);
    return it ? view(it) : null;
  }
  const activeId = () => (find(active) ? active : DEFAULT);
  const current = () => find(activeId());
  const isActive = (x) => {
    const p = find(x);
    return !!p && p.id === activeId();
  };
  /** Puts a profile in use (its id or name): 1 when it changed, 0 when it was already (or there's none). */
  function use(x) {
    const p = find(x);
    if (!p || p.id === activeId()) return 0;
    active = p.id;
    changed();
    return 1;
  }
  /** Sets a profile's code and knobs ({ code, knobs }); a built-in with null: back to how it comes. */
  function set(id, data) {
    const b = builtinOf(id);
    if (b) {
      if (data == null || (data.code === b.code && JSON.stringify(cleanKnobs(data.knobs)) === JSON.stringify(cleanKnobs(b.knobs)))) delete edits[id];
      else edits[id] = { code: cleanCode(data.code), knobs: cleanKnobs(data.knobs) };
    } else {
      const m = mine.find((x) => x.id === id);
      if (!m || data == null) return false;
      m.code = cleanCode(data.code);
      m.knobs = cleanKnobs(data.knobs);
    }
    changed();
    return true;
  }
  /** One of your own, from { code, knobs } — its id. */
  function add(name, data) {
    const id = `t${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
    mine.push({ id, name: cleanName(name, 'My trader'), code: cleanCode(data && data.code), knobs: cleanKnobs(data && data.knobs) });
    changed();
    return id;
  }
  function rename(id, name) {
    const m = mine.find((x) => x.id === id);
    if (!m) return false;
    m.name = cleanName(name, m.name);
    changed();
    return true;
  }
  /** Deletes one of yours (the one in use: the default takes over). */
  function remove(id) {
    const i = mine.findIndex((x) => x.id === id);
    if (i < 0) return false;
    mine.splice(i, 1);
    if (active === id) active = DEFAULT;
    changed();
    return true;
  }
  /** What the autobuyer runs: the code of the profile in use. */
  const sourceOf = () => current().code;

  function serialize() {
    return { active, edits, mine };
  }
  /**
   * Loads the profiles. A save from before profiles (no section): the autobuyer's code, if you had
   * edited it on the Macros page, becomes a profile of yours, in use; otherwise Ride the trends stays
   * in use — what it did before — until you pick another.
   */
  function load(data, whole) {
    edits = {};
    mine = [];
    active = DEFAULT;
    if (data && typeof data === 'object') {
      if (data.edits && typeof data.edits === 'object')
        Object.keys(data.edits).forEach((id) => builtinOf(id) && data.edits[id] && (edits[id] = { code: cleanCode(data.edits[id].code), knobs: cleanKnobs(data.edits[id].knobs) }));
      (Array.isArray(data.mine) ? data.mine : []).forEach((m) => {
        if (m && typeof m.id === 'string' && m.id && !builtinOf(m.id) && !mine.some((x) => x.id === m.id)) mine.push({ id: m.id.slice(0, 40), name: cleanName(m.name, 'My trader'), code: cleanCode(m.code), knobs: cleanKnobs(m.knobs) });
      });
      if (find(data.active)) active = find(data.active).id;
    } else if (whole && typeof whole === 'object' && whole.macros) {
      const p = whole.macros.prefs && whole.macros.prefs[MACRO];
      const src = p && p.custom && typeof p.custom.source === 'string' ? p.custom.source : null;
      if (src && src.trim() && src !== SOURCE) active = add('My stock trader', { code: src, knobs: {} });
      else active = 'trends';
    }
    changed();
  }

  function init() {
    CA.Settings.registerSection(SECTION, { serialize, load, event: 'stockTrader' });
    const V = (id, desc, get, more) => CA.Script.defineValue({ id, desc, get, ...(more || {}) });
    V('stocks.profileActive', 'whether a stock trader profile (its id or name) is the one the autobuyer runs', (x) => isActive(x), { params: ['profile'], bool: true });
    V('stocks.activeProfile', 'the id of the stock trader profile the autobuyer runs', () => activeId());
    V('stocks.profiles', 'a list: the stock trader profiles’ ids', () => list().map((p) => p.id), { list: true });
    CA.Actions.register({
      id: 'stocks.profile',
      name: 'Use a stock trader profile',
      icon: 'stocks',
      group: 'Stock market',
      unit: 'switched',
      params: [{ key: 'profile', label: 'Profile', type: 'select', default: DEFAULT, options: () => list().map((p) => ({ v: p.id, label: p.name })) }],
      describe: (p) => `Use the stock trader profile ${(find(p.profile) || { name: p.profile }).name}`,
      ready: (p) => (find(p.profile) ? { ok: !isActive(p.profile), text: isActive(p.profile) ? 'in use' : '' } : { ok: false, text: 'no such profile' }),
      run: (p) => use(p.profile),
    });
  }

  // a profile's id in code (stocks.profile(trends)…): the code editors' hover cards
  CA.Words.defineKind('profile.stocks', {
    name: 'Stock trader profile',
    info: (id) => {
      const p = find(id);
      if (!p) return null;
      return {
        title: p.name,
        sig: p.id,
        desc: p.desc || 'Yours: what the stock market autobuyer buys and sells, as code.',
        rows: [['in use', isActive(p.id) ? 'yes' : 'no']].concat(p.edited ? [['edited', 'yes']] : []),
        note: 'Stock market page, Trader.',
      };
    },
  });

  /** The same strategy in JavaScript (the stocks.trade action) — the reference the code is tested against. */
  function trade({ buy = true, brokers = true } = {}) {
    const m = CA.Stocks.minigame();
    if (!m) return 0;
    let n = buy && brokers ? hireBrokers() : 0; // first: each broker cuts the overhead on what's bought next
    const goods = m.goodsById.filter((g) => g.active !== false);
    goods.forEach((g) => {
      if (g.stock > 0 && !RISING.includes(g.mode) && m.sellGood(g.id, 10000)) n++;
    });
    if (!buy) return n;
    RISING.forEach((mode) =>
      goods.forEach((g) => {
        if (g.mode === mode && m.buyGood(g.id, 10000)) n++;
      })
    );
    return n;
  }

  /**
   * Hires stockbrokers while there's room for one and you can afford it (minigameMarket.js: at most
   * the highest grandma count this run ÷ 10 + the grandma level; each costs 20 minutes of raw CpS and
   * cuts the overhead on buying goods by 5%). Through the Bank's own Hire button when it's there.
   */
  function hireBrokers() {
    const m = CA.Stocks.minigame();
    if (!m || typeof m.getMaxBrokers !== 'function' || typeof m.getBrokerPrice !== 'function') return 0;
    let n = 0;
    while (n < 100 && m.brokers < m.getMaxBrokers() && Game.cookies >= m.getBrokerPrice()) {
      const before = m.brokers;
      const btn = document.getElementById('bankBrokersBuy');
      if (btn) btn.click();
      if (m.brokers === before) {
        Game.Spend(m.getBrokerPrice());
        m.brokers += 1;
      }
      n++;
    }
    return n;
  }

  /** Sells every stock held. Returns how many stocks were sold. */
  function sellEverything() {
    const m = CA.Stocks.minigame();
    if (!m) return 0;
    let n = 0;
    m.goodsById.forEach((g) => {
      if (g.stock > 0 && m.sellGood(g.id, 10000)) n++;
    });
    return n;
  }

  const setMacro = (on, opts) => CA.Macros.set(MACRO, on, opts);
  const toggle = () => CA.Macros.toggle(MACRO);
  const isOn = () => CA.Macros.isOn(MACRO);

  /** The built-in "Sell all stocks" macro: autobuyer off first, then sell everything. */
  const sellAll = () => CA.Macros.runOnce('sellAll');

  /** Cookies selling everything right now would actually pay out — the same formula the Bank
   *  minigame's own sellGood uses (cookiesPsRawHighest × price × shares, per stock), so this
   *  matches exactly rather than approximating. For a hover preview, not an action. */
  function previewSellAllCookies() {
    const m = CA.Stocks.minigame();
    if (!m) return 0;
    const cpsHighest = (typeof Game !== 'undefined' && Game.cookiesPsRawHighest) || 0;
    let total = 0;
    m.goodsById.forEach((g) => {
      if (g.stock > 0) total += cpsHighest * g.val * g.stock;
    });
    return total;
  }

  /** Hover text for any "Sell all" button: the live cookie payout, or that there's nothing held. */
  function sellAllTitle() {
    const cookies = previewSellAllCookies();
    const beautify = (v) => CA.Format.beautify(v);
    return cookies > 0 ? `Sells for ~${beautify(cookies)} cookies right now` : 'Nothing to sell right now';
  }

  return {
    init,
    SOURCE,
    PRICES_SOURCE,
    BUILTINS,
    DEFAULT,
    list,
    find,
    current,
    activeId,
    isActive,
    use,
    setProfile: set,
    add,
    rename,
    remove,
    sourceOf,
    trade,
    hireBrokers,
    sellEverything,
    set: setMacro,
    toggle,
    isOn,
    sellAll,
    previewSellAllCookies,
    sellAllTitle,
  };
})();
