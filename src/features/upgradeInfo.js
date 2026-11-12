// What an upgrade is and how you get it — the facts behind cookieMgr's upgrade tooltips (ui/upgradeTip.js):
//
//   requirement   how the game unlocks it, as a sentence ("25 farms", "15 mines and a grandma", "1
//                 billion cookies baked this ascension"…), with where you are when it counts something
//                 (12 of 25) — from main.js: the building tiers (Game.Tiers, UnlockTiered), the grandma
//                 and building synergies, Cursor's fingers, the cookies' bake thresholds (Game.UnlockAt),
//                 the kittens' milk, the mice's handmade cookies, golden cookie clicks, season drops,
//                 research, the garden's drops, heavenly upgrades (bought on ascending)…
//   next          the next upgrade buying more of a building unlocks: { name, more, at } — the
//                 tiered ones, its grandma, its synergies (once everything else they need is there)
//   ref           an upgrade as a hoverable name: its icon and name, marked for the info card on hover
//   worth         what it would add if you bought it now (features/payback.js — measured even when
//                 it isn't in the store yet), its payback period and color
//
// Nothing here changes the game; nothing reads the seed.

CA.UpgradeInfo = (() => {
  const named = (name) => (Game.Upgrades || {})[name] || null;
  const has = (n) => typeof Game.Has === 'function' && !!Game.Has(n);
  const B = (n) => CA.Format.beautify(n);
  const objects = () => Object.values(Game.Objects || {});
  /** "25 farms" ("1 farm"): a count of a building, as the game names it. */
  const count = (b, n) => `${B(n)} ${n === 1 ? String(b.single || b.dname || b.name).toLowerCase() : String(b.plural || b.dname || b.name).toLowerCase()}`;

  const CURSOR = [
    [1, 'Reinforced index finger'], [1, 'Carpal tunnel prevention cream'], [10, 'Ambidextrous'], [25, 'Thousand fingers'], [50, 'Million fingers'], [100, 'Billion fingers'],
    [150, 'Trillion fingers'], [200, 'Quadrillion fingers'], [250, 'Quintillion fingers'], [300, 'Sextillion fingers'], [350, 'Septillion fingers'], [400, 'Octillion fingers'],
    [450, 'Nonillion fingers'], [500, 'Decillion fingers'], [550, 'Undecillion fingers'],
  ];
  const KITTENS = ['Kitten helpers', 'Kitten workers', 'Kitten engineers', 'Kitten overseers', 'Kitten managers', 'Kitten accountants', 'Kitten specialists', 'Kitten experts', 'Kitten consultants', 'Kitten assistants to the regional manager', 'Kitten marketeers', 'Kitten analysts', 'Kitten executives', 'Kitten admins', 'Kitten strategists'];
  const MICE = ['Plastic mouse', 'Iron mouse', 'Titanium mouse', 'Adamantium mouse', 'Unobtainium mouse', 'Eludium mouse', 'Wishalloy mouse', 'Fantasteel mouse', 'Nevercrack mouse', 'Armythril mouse'];
  const BISCUITS = [
    'Milk chocolate butter biscuit', 'Dark chocolate butter biscuit', 'White chocolate butter biscuit', 'Ruby chocolate butter biscuit', 'Lavender chocolate butter biscuit', 'Synthetic chocolate green honey butter biscuit', 'Royal raspberry chocolate butter biscuit',
    'Ultra-concentrated high-energy chocolate butter biscuit', 'Pure pitch-black chocolate butter biscuit', 'Cosmic chocolate butter biscuit', 'Butter biscuit (with butter)', 'Everybutter biscuit', 'Personal biscuit',
  ];
  const GOLDEN = { 'Lucky day': 7, Serendipity: 27, 'Get lucky': 77 };
  const PLANTS = { 'Elderwort biscuits': 'Elderwort', 'Bakeberry cookies': 'Bakeberry', 'Duketater cookies': 'Duketater', 'Green yeast digestives': 'Green rot', 'Wheat slims': "Baker's wheat", 'Fern tea': 'Drowsyfern', 'Ichor syrup': 'Ichorpuff' };
  const AFTER = {
    'Golden switch [off]': 'Golden switch', 'Sugar frenzy': 'Sugar craving', 'Milk selector': 'Classic dairy selection', 'Background selector': 'Basic wallpaper assortment', 'Golden cookie sound selector': 'Golden cookie alert sound', Jukebox: 'Sound test',
    'Shimmering veil [on]': 'Shimmering veil', 'Heavenly cookie stand': 'Heavenly chip secret', 'Heavenly bakery': 'Heavenly cookie stand', 'Heavenly confectionery': 'Heavenly bakery', 'Heavenly key': 'Heavenly confectionery',
  };
  const TEXT = {
    'Heavenly chip secret': 'owning Legacy (a heavenly upgrade), outside Born again',
    'A crumbly egg': '1 million cookies baked this ascension, with How to bake your dragon',
    'A festive hat': '25 cookies baked this ascension, during Christmas',
    "Santa's dominion": 'Santa at his last level (Final Claus)',
    'Dragon cookie': 'training the dragon to Krumblor’s last level (50 of every building)',
    'Bingo center/Research facility': '6 grandmas and the Elder achievement (7 grandma types)',
    'Sacrificial rolling pins': 'pledging to the elders 10 times',
    'Elder Pledge': 'the Grandmapocalypse (One mind researched)',
    'Elder Covenant': 'the Grandmapocalypse (One mind researched)',
    'Revoke Elder Covenant': 'signing the Elder Covenant',
    'Wrinkler ambergris': 'popping a shiny wrinkler',
  };
  const SEASON_DROPS = [
    ['santaDrops', 'a gift from Santa as he levels up (Christmas)'],
    ['reindeerDrops', 'a reindeer’s drop (Christmas)'],
    ['halloweenDrops', 'popping a wrinkler that has eaten (Halloween)'],
    ['easterEggs', 'a golden or wrath cookie’s drop (Easter)'],
    ['heartDrops', 'buying the one before it (Valentine’s day)'],
  ];

  /** The tier of a building upgrade: Game.Tiers[tier] (or null). */
  const tierOf = (u) => (Game.Tiers && u && u.tier !== undefined ? Game.Tiers[u.tier] || null : null);
  /** Whether a building tiered upgrade (Plain, Berrylium…): u.buildingTie, a numbered tier. */
  const isTiered = (u) => !!(u && u.buildingTie && !u.buildingTie2 && Number.isFinite(Number(u.tier)) && tierOf(u) && tierOf(u).unlock > 0 && !(Game.GrandmaSynergies || []).includes(u.name));
  const isGrandma = (u) => !!(u && (Game.GrandmaSynergies || []).includes(u.name) && u.buildingTie);
  const isSynergy = (u) => !!(u && u.buildingTie1 && u.buildingTie2 && tierOf(u));

  /**
   * How the game unlocks an upgrade: { text, have, need } — the sentence, and for one that counts
   * something, where you are (have of need); or { text } alone; null for no such upgrade.
   */
  function requirement(name) {
    const u = typeof name === 'object' ? name : named(name);
    if (!u) return null;
    const n = u.name;
    if (u.pool === 'prestige') {
      const parents = (u.parents || []).map((p) => (typeof p === 'object' ? p : named(p) || (Game.UpgradesById || {})[p])).filter(Boolean);
      return { text: `a heavenly upgrade: bought with heavenly chips when you ascend${parents.length ? `, after ${parents.map((p) => p.dname || p.name).join(' and ')}` : ''}` };
    }
    if (n in TEXT) return { text: TEXT[n] };
    if (n in AFTER) return { text: `owning ${AFTER[n]}` };
    const cur = CURSOR.find(([, x]) => x === n);
    if (cur && Game.Objects.Cursor) return { text: count(Game.Objects.Cursor, cur[0]), have: Game.Objects.Cursor.amount, need: cur[0] };
    if (isGrandma(u)) {
      const b = u.buildingTie;
      const at = Game.SpecialGrandmaUnlock || 15;
      return { text: `${count(b, at)} and a grandma`, have: b.amount, need: at };
    }
    if (isSynergy(u)) {
      const t = tierOf(u);
      const [b1, b2] = [u.buildingTie1, u.buildingTie2];
      return { text: `${count(b1, t.unlock)} and ${count(b2, t.unlock)}${t.req ? `, with ${t.req}` : ''}`, have: Math.min(b1.amount, b2.amount), need: t.unlock };
    }
    if (isTiered(u)) {
      const b = u.buildingTie;
      return { text: count(b, tierOf(u).unlock), have: b.amount, need: tierOf(u).unlock };
    }
    if (u.tier === 'fortune') return { text: 'a fortune on the news ticker, once you own Fortune cookies (a heavenly upgrade)' };
    const k = KITTENS.indexOf(n);
    if (k >= 0) {
      const need = k === 0 ? 13 : k * 25;
      return { text: `${need} achievements (${k === 0 ? 50 : k * 100}% milk)`, have: Game.AchievementsOwned || 0, need };
    }
    const m = MICE.indexOf(n);
    if (m >= 0) {
      const need = 1000 * Math.pow(100, m);
      return { text: `${B(need)} cookies made from clicking`, have: Game.handmadeCookies || 0, need };
    }
    const bi = BISCUITS.indexOf(n);
    if (bi >= 0) {
      const need = 100 + bi * 50;
      return { text: `${need} of every building`, have: objects().reduce((x, o) => Math.min(x, o.amount), Infinity), need };
    }
    if (n in GOLDEN) return { text: `${GOLDEN[n]} golden cookies clicked (all time)`, have: Game.goldenClicks || 0, need: GOLDEN[n] };
    if (n in PLANTS) return { text: `a rare drop from harvesting a mature ${PLANTS[n]} in the garden` };
    const sd = SEASON_DROPS.find(([k]) => Array.isArray(Game[k]) && Game[k].includes(n));
    if (sd) return { text: sd[1] };
    if (u.pool === 'tech') return { text: 'research at the Bingo center, one after another' };
    if (Game.seasons && Object.values(Game.seasons).some((s) => s.trigger === n)) return { text: 'owning Season switcher' };
    if (u.unlockAt) {
      const a = u.unlockAt;
      if (a.cookies !== undefined) {
        const more = [];
        if (a.require) more.push(`with ${a.require}`);
        if (a.season) more.push(`during ${(Game.seasons && Game.seasons[a.season] && Game.seasons[a.season].name) || a.season}`);
        return { text: `${B(a.cookies)} cookies baked this ascension${more.length ? `, ${more.join(', ')}` : ''}`, have: Game.cookiesEarned || 0, need: a.cookies };
      }
      if (a.require) return { text: `owning ${a.require}` };
      if (a.text) return { text: String(a.text) };
    }
    if (u.pool === 'toggle') return { text: 'a switch — the game offers it when it applies' };
    return { text: 'something the game checks for (cookieMgr doesn’t know what)' };
  }

  /** Where an upgrade stands: 'owned', 'store' (unlocked, not bought), 'locked'. */
  const status = (u) => (!u ? '' : u.bought ? 'owned' : u.unlocked ? 'store' : 'locked');

  // ---- the next upgrade a building unlocks ---------------------------------------------------------

  /** The upgrades a building unlocks by count: [{ u, at }] (only those whose other conditions are met). */
  function unlocksOf(b) {
    const out = [];
    const add = (u, at) => u && !u.bought && !u.unlocked && out.push({ u, at });
    if (b.name === 'Cursor') CURSOR.forEach(([at, n]) => add(named(n), at));
    Object.values(b.tieredUpgrades || {}).forEach((u) => isTiered(u) && add(u, tierOf(u).unlock));
    if (b.grandma && Game.Objects.Grandma && Game.Objects.Grandma.amount > 0) add(b.grandma, Game.SpecialGrandmaUnlock || 15);
    (b.synergies || []).forEach((u) => {
      if (!isSynergy(u)) return;
      const t = tierOf(u);
      const other = u.buildingTie1 === b ? u.buildingTie2 : u.buildingTie1;
      if ((!t.req || has(t.req)) && other.amount >= t.unlock) add(u, t.unlock);
    });
    if (b.name === 'Grandma') objects().forEach((o) => o.grandma && o.amount >= (Game.SpecialGrandmaUnlock || 15) && add(o.grandma, 1));
    return out;
  }
  /**
   * The next upgrade buying more of a building unlocks: { name, more, at } — the one needing the
   * fewest more (the cheaper on a tie) — or null.
   */
  function next(name) {
    const b = (Game.Objects || {})[name];
    if (!b) return null;
    const best = unlocksOf(b)
      .filter((x) => x.at > b.amount)
      .sort((x, y) => x.at - y.at || (x.u.getPrice ? x.u.getPrice() : x.u.basePrice) - (y.u.getPrice ? y.u.getPrice() : y.u.basePrice))[0];
    return best ? { name: best.u.name, more: best.at - b.amount, at: best.at } : null;
  }

  // ---- what it's worth -------------------------------------------------------------------------------

  const price = (u) => (typeof u.getPrice === 'function' ? u.getPrice() : u.basePrice || 0);
  /**
   * What it would add bought now: { price, bonus, mouse, gain, pp, color, won } — null for one owned,
   * a heavenly upgrade, a switch.
   */
  function worth(name) {
    const u = typeof name === 'object' ? name : named(name);
    if (!u || u.bought || u.pool === 'prestige' || CA.Payback.isSwitch(u)) return null;
    const w = CA.Payback.upgradeWorth(u.name, undefined, { any: true });
    if (!w) return null;
    const p = price(u);
    const pp = CA.Payback.ppOf(p, w);
    const t = CA.Payback.table({ staleMs: 2000 });
    return { price: p, bonus: w.bonus, mouse: w.mouse, gain: w.gain, pp, color: t.colorOf ? t.colorOf(pp, p) : '', won: w.won || [] };
  }

  // ---- as HTML -------------------------------------------------------------------------------------

  const esc = (s) => CA.Util.escapeHtml(s);
  /** An icon ([x, y] in the game's icons, or [x, y, sheet url]) as a 48px sprite with a class. */
  const sprite = (icon, cls) =>
    icon ? `<span class="${cls}" style="background-image:url(${icon[2] ? icon[2] : CA.Util.res('img/icons.png')});background-position:${-icon[0] * 48}px ${-icon[1] * 48}px"></span>` : '';
  /** The attributes that make an element show an upgrade's info card on hover (ui/tips.js, ui/upgradeTip.js). */
  const attrs = (name) => `data-pop-live="upgrade" data-upgrade="${esc(name)}"`;
  /** An upgrade as a hoverable name: its icon, its name — its info card on hover. */
  function ref(name) {
    const u = named(name);
    if (!u) return esc(name);
    return `<span class="ca-upref" ${attrs(u.name)}>${sprite(u.icon, 'ca-upref-ico')}${esc(u.dname || u.name)}</span>`;
  }

  function init() {
    const V = (id, desc, params, get) => CA.Script.defineValue({ id, desc, params, get });
    V('building.nextUpgrade', 'the next upgrade buying more of a building unlocks ("" when none)', ['building'], (n) => (next(n) || { name: '' }).name);
    V('building.toNextUpgrade', 'how many more of a building unlock its next upgrade (NaN when none)', ['building'], (n) => (next(n) || { more: NaN }).more);
  }

  return { init, requirement, status, next, worth, price, ref, attrs, sprite };
})();
