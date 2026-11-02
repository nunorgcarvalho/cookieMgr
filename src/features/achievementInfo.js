// What an achievement asks and how far along you are — the facts behind cookieMgr's achievement
// info card (ui/achievementTip.js):
//
//   progress   for an achievement that counts something, where you stand: [{ what, have, need, b, rate, actual }]
//              — one line per count (Polymath counts buildings and upgrades), b the building to buy when
//              buying more of one wins it, rate how fast `have` grows by itself (cookies per second: your
//              actual income over the Actual income window, like the tooltips' — your CpS until a minute is
//              recorded; actual true when it is) —
//              from main.js: the cookies-baked and CpS thresholds (Game.BankAchievements, Game.CpsAchievements), each building's count, production and
//              level achievements (tieredAchievs, productionAchievs, levelAchiev10), the game's own checks
//              (handmade cookies, golden cookies, wrinklers, reindeer, ascensions, sugar lumps, buildings
//              and upgrades owned…); [] for one the game's description says it all for
//   status     'won' or 'missing'
//   attrs/ref  the attributes that make an element show the card on hover; an achievement as a name
//
// Nothing here changes the game; nothing reads the seed.

CA.AchievementInfo = (() => {
  const named = (name) => (Game.Achievements || {})[name] || null;
  const objects = () => Object.values(Game.Objects || {});
  const has = (n) => typeof Game.Has === 'function' && !!Game.Has(n);
  const lower = (b) => String(b.plural || b.dname || b.name).toLowerCase();
  const eggs = () => (Game.easterEggs || []).filter((n) => typeof Game.HasUnlocked === 'function' && Game.HasUnlocked(n)).length;

  // [[need, name]] lists of the game's checks (main.js Game.Logic, Game.Ascend, Game.Reincarnate…)
  const HANDMADE = [
    'Clicktastic', 'Clickathlon', 'Clickolympics', 'Clickorama', 'Clickasmic', 'Clickageddon', 'Clicknarok', 'Clickastrophe', 'Clickataclysm', 'The ultimate clickdown',
    'All the other kids with the pumped up clicks', 'One...more...click...', 'Clickety split', "Ain't that a click in the head", "What's not clicking",
  ].map((n, i) => [1000 * Math.pow(100, i), n]);
  const FORFEIT = [
    'Sacrifice', 'Oblivion', 'From scratch', 'Nihilism', 'Dematerialize', 'Nil zero zilch', 'Transcendence', 'Obliterate', 'Negative void', 'To crumbs, you say?', 'You get nothing',
    'Humble rebeginnings', 'The end of the world', "Oh, you're back", 'Lazarus', 'Smurf account', "If at first you don't succeed", 'No more room in hell',
  ].map((n, i) => [1e6 * Math.pow(1000, i), n]);
  const COUNTS = [
    ['golden cookies clicked (all time)', () => Game.goldenClicks || 0, [[1, 'Golden cookie'], [7, 'Lucky cookie'], [27, 'A stroke of luck'], [77, 'Fortune'], [777, 'Leprechaun'], [7777, "Black cat's paw"], [27777, 'Seven horseshoes']]],
    ['wrinklers popped', () => Game.wrinklersPopped || 0, [[1, 'Itchscratcher'], [50, 'Wrinklesquisher'], [200, 'Moistburster']]],
    ['reindeer clicked', () => Game.reindeerClicked || 0, [[1, 'Oh deer'], [50, 'Sleigh of hand'], [200, 'Reindeer sleigher']]],
    ['ascensions', () => Game.resets || 0, [[1, 'Rebirth'], [10, 'Resurrection'], [100, 'Reincarnation'], [1000, 'Endless cycle']]],
    ['sugar lumps harvested', () => Game.lumpsTotal || 0, [[7, 'Dude, sweet'], [30, 'Sugar rush'], [365, "Year's worth of cavities"]]],
    ['times pledged to the elders', () => Game.pledges || 0, [[1, 'Elder nap'], [5, 'Elder slumber']]],
    ['news ticker clicks', () => Game.TickerClicks || 0, [[50, 'Tabloid addiction']]],
    ['grandma types', () => (Game.GrandmaSynergies || []).filter(has).length, [[7, 'Elder'], [14, 'Veteran']]],
    ['kittens', () => ((Game.UpgradesByPool || {}).kitten || []).filter((u) => u.bought).length, [[10, 'Jellicles']]],
    ['heavenly upgrades', () => Object.values(Game.Upgrades || {}).filter((u) => u.pool === 'prestige' && u.bought).length, [[100, 'All the stars in heaven']]],
    ['cookies made from clicking', () => Game.handmadeCookies || 0, HANDMADE],
    ['cookies baked this ascension, forfeited when you ascend', () => Game.cookiesEarned || 0, FORFEIT],
    ['cursors and grandmas', () => ((Game.Objects.Cursor || {}).amount || 0) + ((Game.Objects.Grandma || {}).amount || 0), [[777, 'The elder scrolls']]],
    ['easter eggs found', eggs, [[1, 'The hunt is on'], [7, 'Egging on'], [14, 'Mass Easteria']]],
  ];
  const minOwned = () => objects().reduce((x, o) => Math.min(x, o.amount), Infinity);
  const buildings = () => (Number.isFinite(Game.BuildingsOwned) ? Game.BuildingsOwned : objects().reduce((x, o) => x + o.amount, 0));
  const upgrades = () => Game.UpgradesOwned || 0;
  const MIXED = {
    Polymath: [['buildings', buildings, 4000], ['upgrades', upgrades, 300]],
    'Renaissance baker': [['buildings', buildings, 8000], ['upgrades', upgrades, 400]],
    'Hide & seek champion': [['easter eggs found', eggs, () => (Game.easterEggs || []).length]],
  };

  /** Your actual income over the Actual income window: { actual, cps (the game's CpS, averaged) } — null with under a minute recorded. */
  function actual() {
    const P = CA.Payback;
    const a = P && typeof P.incomeOver === 'function' ? P.incomeOver(P.actualWindow()) : null;
    if (!a || !(a.actual > 0)) return null;
    const r = CA.Recorder.recent(a.window);
    return { actual: a.actual, cps: r && r.cps > 0 ? r.cps : NaN };
  }
  /** Cookies baked a second: your actual income (clicks, golden cookies… all of it) — your CpS until it's recorded. */
  const baked = () => (actual() || { actual: Game.cookiesPs }).actual;
  /** A building's CpS now times how much its CpS was boosted on average over the window (buffs come and go) — 1 until recorded. */
  function buffs() {
    const x = actual();
    return x && x.cps > 0 && Game.cookiesPs > 0 ? x.cps / Game.cookiesPs : 1;
  }

  /** Where you stand on a counting achievement: [{ what, have, need, b, rate, actual }] ([] for one that doesn't count). */
  function progress(name) {
    const a = typeof name === 'object' ? name : named(name);
    if (!a) return [];
    const n = a.name;
    const line = (what, have, need, b, rate) => [{ what, have, need, b: b || null, rate: rate || 0, actual: !!rate && actual() !== null }];
    if ((Game.BankAchievements || []).includes(a)) return line('baked this ascension', Game.cookiesEarned || 0, a.threshold, null, baked());
    if ((Game.CpsAchievements || []).includes(a)) return line('cookies per second (unbuffed)', Game.cookiesPsRaw || 0, a.threshold);
    for (const b of objects()) {
      const t = Object.values(b.tieredAchievs || {}).find((x) => x === a);
      if (t && Game.Tiers && Game.Tiers[t.tier]) return line(lower(b), b.amount, Game.Tiers[t.tier].achievUnlock, b);
      const p = (b.productionAchievs || []).find((x) => x.achiev === a);
      if (p) return line(`cookies made by ${lower(b)}`, b.totalCookies || 0, p.pow, null, (b.storedTotalCps || 0) * (Game.globalCpsMult || 0) * buffs());
      if (b.levelAchiev10 === a) return line(`${b.dname || b.name} level`, b.level || 0, 10);
    }
    const A = CA.Payback.ACHIEVS;
    const cur = A.cursor.find(([, x]) => x === n);
    if (cur && Game.Objects.Cursor) return line(lower(Game.Objects.Cursor), Game.Objects.Cursor.amount, cur[0], Game.Objects.Cursor);
    const min = A.min.find(([, x]) => x === n);
    if (min) return line('of every building (your fewest)', minOwned(), min[0]);
    const total = A.total.find(([, x]) => x === n);
    if (total) return line('buildings', buildings(), total[0]);
    const up = A.upgrades.find(([, x]) => x === n);
    if (up) return line('upgrades', upgrades(), up[0]);
    if (n in MIXED) return MIXED[n].map(([what, have, need]) => ({ what, have: have(), need: typeof need === 'function' ? need() : need, b: null, rate: 0, actual: false }));
    for (const [what, have, list] of COUNTS) {
      const hit = list.find(([, x]) => x === n);
      if (hit) return line(what, have(), hit[0], null, list === FORFEIT ? baked() : 0);
    }
    return [];
  }

  /** Where an achievement stands: 'won' or 'missing'. */
  const status = (a) => (!a ? '' : a.won ? 'won' : 'missing');

  const esc = (s) => CA.Util.escapeHtml(s);
  /** The attributes that make an element show an achievement's info card on hover (ui/tips.js, ui/achievementTip.js). */
  const attrs = (name) => `data-pop-live="achievement" data-achievement="${esc(name)}"`;
  /** An achievement as a hoverable name: its icon, its name — its info card on hover. */
  function ref(name) {
    const a = named(name);
    if (!a) return esc(name);
    return `<span class="ca-upref" ${attrs(a.name)}>${CA.UpgradeInfo.sprite(a.icon, 'ca-upref-ico')}${esc(a.dname || a.name)}</span>`;
  }

  return { progress, status, attrs, ref };
})();
