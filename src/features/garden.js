// The **auto-gardener**: tends the Garden (Farm minigame) once a second while it's on, as four
// layers you pick separately say (features/gardenLayers.js) — or a profile that picks all four:
//
//   gardener   what it does: algorithmic code, run from the top every pass — the built-in Effect
//              maximizer, Weed collector and Mutation tracker (editable, revertable), or your own
//   soil rule  the code the gardener runs (garden.soilRule()) to pick the soil
//   template   where seeds go: letters (A, B…) on the plot — or the Current garden, what's planted
//   seeds      which seed each letter is
//
// A template and seeds together are the **layout**: the seed each tile should have. This file has
// the garden's words the gardeners are made of (actions and values, which work in any algorithmic
// macro), the Current garden's memory, and the Auto-gardener macro.
//
// The Effect maximizer (the default) does what the auto-gardener always did:
//
//   - in the last `tickWindow` seconds before a garden tick (15 by default):
//       · on the tiles the layout has a seed for, harvests plants that aren't that seed (weeds,
//         mutations, leftovers) — tiles the layout leaves empty it doesn't touch
//       · harvests the layout's own mature plants when the chance that they die of old age on the
//         coming tick is above your threshold (50% by default; 100% = let them die)
//       · replants the tiles it just cleared
//   - any time: plants the layout's seed on every empty tile you can afford; harvests a plant whose
//     seed you haven't unlocked yet as soon as it's mature, which unlocks it; and runs the soil rule
//     (fertilizer while most plants are growing, clay once they're mature — when the game lets you,
//     a 10-minute cooldown)
//
// Why harvest before a plant dies? A harvest of a mature plant unlocks its seed if it's new, counts
// towards the harvest achievements, and some plants pay out on harvest (Bakeberry, Chocoroot, Queenbeet…);
// a plant that dies of old age just disappears (except on Pebbles, which has a 35% chance to unlock
// its seed). The game's own formulas (minigameGarden.js M.logic) give the death chance exactly:
// each tick a plant ages by randomFloor((ageTick + ageTickR·random) × tile boost × dragon boost)
// and dies at 100.

CA.Garden = (() => {
  const SIZE = 6;
  let current = null; // the Current garden: each tile's plant as remembered ([[key|null × 6] × 6])
  let unlockedAt = {}; // seed → when a harvest by cookieMgr unlocked it (ms)
  const CURRENT = 'current';
  const S = () => CA.Settings;
  const L = () => CA.GardenLayers;
  const changed = () => CA.Events.emit('garden');

  function minigame() {
    const M = CA.Util.minigame('Farm');
    return M && M.plot && M.plantsById ? M : null;
  }

  const unlockedTile = (M, x, y) => (typeof M.isTileUnlocked === 'function' ? M.isTileUnlocked(x, y) : true);
  const plantAt = (M, x, y) => {
    const t = M.plot[y] && M.plot[y][x];
    return t && t[0] > 0 ? M.plantsById[t[0] - 1] || null : null;
  };
  /** Seconds until the next garden tick. */
  const nextTickIn = (M) => (M.nextStep ? Math.max(0, (M.nextStep - Date.now()) / 1000) : Infinity);
  /** The top-left unlocked tile: where a template's top-left cell goes. */
  function originOf(M) {
    if (!M) return [0, 0];
    let ox = SIZE;
    let oy = SIZE;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (unlockedTile(M, x, y)) {
          ox = Math.min(ox, x);
          oy = Math.min(oy, y);
        }
    return ox === SIZE ? [0, 0] : [ox, oy];
  }

  // ---- the chance a plant dies on the next tick -------------------------------------------------

  /**
   * P(the plant on (x, y) reaches age 100 on the next tick). Its growth that tick is
   * randomFloor(v) with v uniform on [a, b] = boost × [ageTick, ageTick + ageTickR]; randomFloor(v)
   * is ⌈v⌉ with probability frac(v), else ⌊v⌋. So with n = 100 − age it dies with probability
   * 1 when v ≥ n, v − (n − 1) when n − 1 < v < n, and 0 below — averaged over v.
   */
  function decayChance(M, x, y) {
    const me = plantAt(M, x, y);
    if (!me || me.immortal) return 0;
    const n = 100 - M.plot[y][x][1];
    if (n <= 0) return 1;
    const tileBoost = M.plotBoost && M.plotBoost[y] && M.plotBoost[y][x] ? M.plotBoost[y][x][0] : 1;
    const dragon = 1 + 0.05 * (typeof Game.auraMult === 'function' ? Game.auraMult('Supreme Intellect') : 0);
    const k = tileBoost * dragon;
    const a = k * me.ageTick;
    const b = k * (me.ageTick + (me.ageTickR || 0));
    const p = (v) => (v >= n ? 1 : v > n - 1 ? v - (n - 1) : 0);
    if (b - a < 1e-9) return p(a);
    // antiderivative of p
    const F = (v) => (v <= n - 1 ? 0 : v < n ? (v - n + 1) ** 2 / 2 : 0.5 + (v - n));
    return Math.max(0, Math.min(1, (F(b) - F(a)) / (b - a)));
  }

  // ---- the Current garden ------------------------------------------------------------------------
  //
  // It remembers each tile's plant: taken from the garden when you pick it, then changed only by
  // your own clicks on the garden (a seed you plant, a plant you harvest) — a plant that dies or is
  // harvested by the gardener is replanted, and a mutation or weed that springs up isn't adopted.

  const emptyPlot = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const keeps = (me) => !!me && !!me.unlocked && !me.weed && !me.fungus;
  /** What's planted, seed by seed, as it is now (any seed, or only ones the Current garden keeps). */
  function plantedNow(M, filter = keeps) {
    const plot = emptyPlot();
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const me = unlockedTile(M, x, y) ? plantAt(M, x, y) : null;
        if (me && filter(me)) plot[y][x] = me.key;
      }
    return plot;
  }
  /** Takes the Current garden afresh (no garden yet: when there is one). */
  function captureCurrent() {
    const M = minigame();
    current = M ? plantedNow(M) : null;
    changed();
  }
  /**
   * Notes what you do by hand on the garden (once per garden; checked every second, so it's on
   * from the start): a click on a tile (planting, harvesting) and the game's Harvest all button.
   */
  function watchClicks(M) {
    if (!M || M.__caWatched || typeof M.clickTile !== 'function') return;
    M.__caWatched = true;
    const note = (x, y) => {
      if (!current) current = plantedNow(M);
      const me = plantAt(M, x, y);
      current[y][x] = keeps(me) ? me.key : null;
    };
    const orig = M.clickTile;
    M.clickTile = function (x, y) {
      const out = orig.apply(this, arguments);
      try {
        note(x, y);
        changed();
      } catch (e) {
        /* the game's click went through; the memory just isn't updated */
      }
      return out;
    };
    if (typeof M.harvestAll === 'function') {
      const all = M.harvestAll;
      M.harvestAll = function () {
        const had = tilesOf(M).filter(([x, y]) => plantAt(M, x, y));
        const out = all.apply(this, arguments);
        try {
          had.forEach(([x, y]) => !plantAt(M, x, y) && note(x, y));
          changed();
        } catch (e) {
          /* as above */
        }
        return out;
      };
    }
  }
  /** The Current garden's memory (taken now if there's none yet). */
  function currentPlot() {
    const M = minigame();
    watchClicks(M);
    if (!current && M) current = plantedNow(M);
    return current || emptyPlot();
  }

  // ---- the layout: the template's letters, each its seed -------------------------------------------

  /** The layout the gardener keeps: { id, name, plot (seed per tile), template, seeds }. */
  function active() {
    const t = L().get('template', L().picked('template'));
    const s = L().get('seeds', L().picked('seeds'));
    const plot = t.id === CURRENT && s.id === CURRENT ? currentPlot() : L().seedPlot(t.data, s.data.map, originOf(minigame()));
    return { id: `${t.id}/${s.id}`, name: t.id === CURRENT && s.id === CURRENT ? 'Current garden' : `${t.name} · ${s.name}`, plot, template: t, seeds: s };
  }

  /**
   * The garden as it is, as a profile of yours: its template (one you have, laid out the same — Fill
   * for one seed everywhere — else a new one), its seeds, the gardener and soil rule picked now. Loaded.
   */
  function snapshot(name) {
    const M = minigame();
    if (!M) return null;
    const nm = String(name || `Garden ${L().list('profile').filter((p) => !p.builtin).length + 1}`).slice(0, 40);
    const got = L().adopt(plantedNow(M, () => true), nm, (x, y) => unlockedTile(M, x, y), originOf(M));
    const id = L().add('profile', nm, { gardener: L().picked('gardener'), soil: L().picked('soil'), template: got.template, seeds: got.seeds });
    L().loadProfile(id);
    return L().get('profile', id);
  }

  // ---- tending ------------------------------------------------------------------------------

  function plant(M, me, x, y) {
    if (!me.unlocked || (typeof M.canPlant === 'function' && !M.canPlant(me))) return false;
    // as M.useTool does, minus the mouse sparkle and sound
    M.plot[y][x] = [me.id + 1, 0];
    M.toRebuild = true;
    Game.Spend(typeof M.getCost === 'function' ? M.getCost(me) : 0);
    return true;
  }

  function setSoil(M, key) {
    const soil = M.soils && M.soils[key];
    if (!soil || M.soil === soil.id || M.freeze || M.nextSoil > Date.now() || M.parent.amount < soil.req) return false;
    // through the game's own button when it's there (it updates its highlight), else as it does
    const btn = document.getElementById(`gardenSoil-${soil.id}`);
    if (btn) btn.click();
    if (M.soil !== soil.id) {
      M.nextSoil = Date.now() + (Game.Has('Turbo-charged soil') ? 1 : 1000 * 60 * 10);
      M.toCompute = true;
      M.soil = soil.id;
      if (typeof M.computeStepT === 'function') M.computeStepT();
    }
    return true;
  }

  // ---- gardeners and soil rules: code ---------------------------------------------------------

  const gardenerRules = (id) => {
    const g = L().get('gardener', id);
    return g ? g.data.rules : '';
  };
  /** The active gardener's code (what the auto-gardener runs). */
  const rulesOf = () => gardenerRules(L().picked('gardener'));
  /** The active soil rule's code. */
  const soilRules = () => L().get('soil', L().picked('soil')).data.rules;
  /** Sets a gardener's code (a built-in: null brings its default back); an id that isn't a gardener's: the active one's. */
  const setRules = (id, src) => L().set('gardener', L().get('gardener', id) ? id : L().picked('gardener'), src == null ? null : { rules: src });
  const defaultRules = () => L().effectsGardener();

  /**
   * Rules saved before v3.1.1 had the soil threshold written into their if (if garden.youngShare() > 0.67:):
   * it becomes a variable at the top, like the default rules had it — the rest of the code as it was.
   */
  function liftSoilThreshold(src) {
    const V = L().FERTILIZER_VAR;
    const re = /^([ \t]*)if garden\.youngShare\(\) > ([0-9.]+)[ \t]*:[ \t]*$/gm;
    const found = [...src.matchAll(re)];
    if (found.length !== 1 || new RegExp(`\\b${V}\\b`).test(src)) return src;
    const value = found[0][2];
    const lines = src.replace(re, `$1if garden.youngShare() > ${V}:`).split('\n');
    // under the rules' heading comment (the comments after it belong to the lines they describe)
    const at = /^\s*#/.test(lines[0] || '') ? 1 : 0;
    lines.splice(at, 0, `${V} = ${value}   # fertilizer while more than this share of the planted tiles is still growing, else clay`);
    return lines.join('\n');
  }
  const compiled = new Map(); // source → { flow, errors }
  function compileRules(src) {
    if (!compiled.has(src)) {
      if (compiled.size > 20) compiled.clear();
      compiled.set(src, CA.Script.compile(src));
    }
    return compiled.get(src);
  }

  // what the auto-gardener's latest pass did, by kind (the actions count into it; the page shows it)
  let acc = null;
  function count(k, n = 1) {
    if (!n) return;
    const now = Date.now();
    if (!acc || now - acc.t > 300) acc = { t: now, harvested: 0, planted: 0, saved: 0, unlocked: 0, soil: 0 };
    acc[k] += n;
    last = { at: now, harvested: acc.harvested, planted: acc.planted, saved: acc.saved, unlocked: acc.unlocked, soil: acc.soil > 0 };
  }
  /** Runs fn(M, layout) on a garden that can be tended, else 0. */
  function withGarden(fn) {
    const M = minigame();
    if (!M || M.freeze) return 0;
    return fn(M, active()) || 0;
  }
  const tilesOf = (M) => {
    const out = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (unlockedTile(M, x, y)) out.push([x, y]);
    return out;
  };
  const wantAt = (p, x, y) => (p.plot[y] && p.plot[y][x]) || null;
  /** M.harvest, noting when it unlocks a seed (garden.unlockedAgo). */
  function harvestTile(M, x, y) {
    const me = plantAt(M, x, y);
    const was = me && me.unlocked;
    const ok = M.harvest(x, y);
    if (ok && me && !was && me.unlocked) {
      unlockedAt[me.key] = Date.now();
      changed();
    }
    return ok;
  }
  const isMature = (M, x, y) => {
    const me = plantAt(M, x, y);
    return !!me && M.plot[y][x][1] >= me.mature;
  };

  let soilWanted = null; // the soil last asked for (garden.soilIs(profile): the soil rule's)
  let soilPass = null; // the soil rule's last run: { t, lines, trace, error, errors, soil }
  /** Runs the soil rule (its own little pass); how many things it did. */
  function runSoilRule() {
    const { flow, errors } = compileRules(soilRules());
    const F = CA.Macros.runPass(flow);
    soilPass = { t: Date.now(), at: F.at, trace: F.trace, lines: F.trace.map((x) => x.line).filter(Boolean), error: F.error, errors: errors || [], soil: L().picked('soil') };
    return F.done;
  }

  const actions = {
    plantEmpty: (only) =>
      withGarden((M, p) => {
        let n = 0;
        tilesOf(M).forEach(([x, y]) => {
          const want = wantAt(p, x, y);
          if (only && want !== only) return;
          if (want && M.plants[want] && !plantAt(M, x, y) && plant(M, M.plants[want], x, y)) n++;
        });
        count('planted', n);
        return n;
      }),
    harvestNew: () =>
      withGarden((M) => {
        let n = 0;
        tilesOf(M).forEach(([x, y]) => {
          const me = plantAt(M, x, y);
          if (me && !me.unlocked && isMature(M, x, y) && harvestTile(M, x, y)) n++;
        });
        count('unlocked', n);
        return n;
      }),
    pullMismatches: (keepNew) =>
      withGarden((M, p) => {
        let n = 0;
        tilesOf(M).forEach(([x, y]) => {
          const me = plantAt(M, x, y);
          if (!me || me.key === wantAt(p, x, y)) return;
          if (keepNew && !me.unlocked) return; // a new seed: harvestNew's
          if (harvestTile(M, x, y)) n++;
        });
        count('harvested', n);
        return n;
      }),
    harvestDying: (threshold) =>
      withGarden((M, p) => {
        let n = 0;
        tilesOf(M).forEach(([x, y]) => {
          const me = plantAt(M, x, y);
          if (me && me.key === wantAt(p, x, y) && isMature(M, x, y) && decayChance(M, x, y) > threshold && harvestTile(M, x, y)) n++;
        });
        count('saved', n);
        return n;
      }),
    harvestMature: () =>
      withGarden((M, p) => {
        let n = 0;
        tilesOf(M).forEach(([x, y]) => {
          const me = plantAt(M, x, y);
          if (me && me.unlocked && me.key === wantAt(p, x, y) && isMature(M, x, y) && harvestTile(M, x, y)) n++;
        });
        count('harvested', n);
        return n;
      }),
    soil: (key) => {
      // "profile": the soil rule's choice (before v3.3, a profile had a soil of its own)
      if (key === 'profile') return withGarden(() => runSoilRule());
      soilWanted = key;
      return withGarden((M) => {
        if (setSoil(M, key)) {
          count('soil');
          return 1;
        }
        return 0;
      });
    },
    soilRule: () => withGarden(() => runSoilRule()),
  };

  /**
   * The layout's tiles (where it has a seed — or, with `only`, that seed) and its own plants on
   * them: { tiles, planted, young, mature }.
   */
  function layoutCensus(only) {
    const M = minigame();
    const c = { tiles: 0, planted: 0, young: 0, mature: 0 };
    if (!M) return c;
    const p = active();
    tilesOf(M).forEach(([x, y]) => {
      if (only && wantAt(p, x, y) !== only) return;
      if (wantAt(p, x, y)) c.tiles++;
      const me = plantAt(M, x, y);
      if (!me || me.key !== wantAt(p, x, y)) return;
      c.planted++;
      if (isMature(M, x, y)) c.mature++;
      else c.young++;
    });
    return c;
  }

  /**
   * Cookies to plant the whole layout from scratch: every tile it has a seed for, at today's seed prices —
   * an effect that ends soon priced away (CA.Payback.waitingOut).
   */
  function layoutCost() {
    const M = minigame();
    if (!M || typeof M.getCost !== 'function') return 0;
    const p = active();
    return tilesOf(M).reduce((sum, [x, y]) => {
      const me = M.plants[wantAt(p, x, y)];
      return me ? sum + seedPrice(M, me, true) : sum;
    }, 0);
  }

  /**
   * The layout's seeds: [{ key, name, n (tiles), missing (tiles without it now), cost (one seed now) }], most
   * tiles first — what a garden replant plants, and what planting would cost now.
   */
  function layoutSeeds() {
    const M = minigame();
    if (!M) return [];
    const p = active();
    const by = {};
    tilesOf(M).forEach(([x, y]) => {
      const k = wantAt(p, x, y);
      const me = k && M.plants[k];
      if (!me) return;
      const e = (by[k] = by[k] || { key: k, name: me.name || k, n: 0, missing: 0, cost: typeof M.getCost === 'function' ? M.getCost(me) : 0 });
      e.n++;
      const at = plantAt(M, x, y);
      if (!at || at.key !== k) e.missing++;
    });
    return Object.values(by).sort((a, b) => b.n - a.n);
  }
  /**
   * How much an effect raises seed prices now: CpS ÷ unbuffed CpS (1: no effect; a Frenzy 7, a
   * Clot 0.5). The game prices a seed in minutes of the CpS it shows, effects counted.
   */
  const priceBoost = () => CA.Payback.effectBoost();
  /** Seconds until the effects that raise seed prices are over (0: none running). */
  const priceBoostLeft = () => CA.Payback.effectLeft();
  /**
   * Whether seeds are more expensive now for a while yet: an effect raises their price and has longer left than
   * the Payback page's "Wait out effects up to" (10 m; frenzies back to back, in long combos) — so they're
   * bought at that price. One that ends sooner is waited out (CA.Payback.waitingOut), even beside a long one.
   */
  const pricesStayUp = () => priceBoost() / CA.Payback.shortBoost() > 1.001;
  /**
   * A seed's price (M.getCost) — with `unbuffed`, once the short effects are over (CA.Payback.shortBoost:
   * those ending within "Wait out effects up to"; a long one stays in the price).
   */
  function seedPrice(M, me, unbuffed) {
    const c = typeof M.getCost === 'function' ? M.getCost(me) : 0;
    const short = unbuffed ? CA.Payback.shortBoost() : 1;
    if (short === 1) return c;
    // the short effects' CpS part divided out; the floor (costM) stays
    return Math.max(c / short, Math.min(c, me.costM || 0));
  }
  /**
   * Cookies to plant a whole round of one seed: every tile the layout has it for, from scratch (none:
   * every seed — layoutCost). `unbuffed`: at the prices without effects.
   */
  function roundCost(seed, unbuffed) {
    const M = minigame();
    if (!M) return 0;
    const p = active();
    return tilesOf(M).reduce((sum, [x, y]) => {
      const k = wantAt(p, x, y);
      const me = k && (!seed || k === seed) ? M.plants[k] : null;
      return me ? sum + seedPrice(M, me, unbuffed) : sum;
    }, 0);
  }
  /**
   * Seeds planted ahead of the rest, as a round of their own (the Tulip and clover rounds gardener's
   * tulips): each boosts the plants around it, so it goes down first.
   */
  const FIRST_SEEDS = ['nursetulip'];
  /** The rounds reserve's default margin: the other seeds' round × this (a quarter on top). */
  const ROUNDS_MARGIN = 1.25;
  /**
   * What the Auto buyer's "Garden rounds" bank keeps (unbuffed prices): a round of the seeds that go
   * first while any of their tiles isn't planted with them, plus `margin` × a round of every other
   * seed of the layout. Seed prices are minutes of CpS, so CpS bought doesn't bring a round any closer
   * (it raises its price as much): the bank goes to the rounds first, the buyer spends what's above.
   */
  function roundsReserve(margin = ROUNDS_MARGIN) {
    const M = minigame();
    if (!M) return 0;
    const p = active();
    const seeds = new Set();
    tilesOf(M).forEach(([x, y]) => wantAt(p, x, y) && seeds.add(wantAt(p, x, y)));
    let keep = 0;
    seeds.forEach((k) => {
      // at the prices once the short effects are over (a long one stays in the price)
      if (!FIRST_SEEDS.includes(k)) keep += Math.max(0, Number(margin) || 0) * roundCost(k, true);
      else if (layoutCensus(k).planted < layoutCensus(k).tiles) keep += roundCost(k, true);
    });
    return keep;
  }

  // ---- planting as purchases (the Auto buyer's queue) ---------------------------------------------

  /** A number the active gardener sets at its top (`replantBelow = 0.75`), else `def`. */
  function gardenerNumber(name, def) {
    const m = new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm').exec(rulesOf() || '');
    return m && Number.isFinite(Number(m[1])) ? Number(m[1]) : def;
  }
  const STAGE_MULT = [0, 0.1, 0.25, 0.5, 1];
  /**
   * The garden's golden cookie frequency and CpS factors for a grid of [seed, stage] (null: empty), on
   * clay — the game's computeBoostPlot and computeEffs (minigameGarden.js), for the plants that move
   * golden cookies (clovers, nursetulips' boost and their −2% CpS, and the few others).
   */
  function effsOf(M, grid) {
    const soil = (M.soils && M.soils.clay && M.soils.clay.effMult) || 1.25;
    const boost = grid.map((row) => row.map(() => 1));
    grid.forEach((row, y) =>
      row.forEach((t, x) => {
        if (!t || t[0] !== 'nursetulip') return;
        const m = soil * STAGE_MULT[t[1]];
        for (let yy = Math.max(0, y - 1); yy < Math.min(SIZE, y + 2); yy++) for (let xx = Math.max(0, x - 1); xx < Math.min(SIZE, x + 2); xx++) if (xx !== x || yy !== y) boost[yy][xx] *= 1 + 0.2 * m;
      })
    );
    let freq = 1;
    let cps = 1;
    grid.forEach((row, y) =>
      row.forEach((t, x) => {
        if (!t) return;
        const m = soil * STAGE_MULT[t[1]] * boost[y][x];
        const k = t[0];
        if (k === 'goldenClover') freq += 0.03 * m;
        else if (k === 'clover' || k === 'shimmerlily' || k === 'greenRot') freq += 0.01 * m;
        else if (k === 'foolBolete') freq += 0.02 * m;
        else if (k === 'drowsyfern') freq *= 1 - 0.1 * m;
        if (k === 'nursetulip' || k === 'queenbeet' || k === 'shriekbulb') cps *= 1 - 0.02 * m;
      })
    );
    return { freq, cps };
  }
  /** The plot as a grid of [seed, stage 4] — every plant counted grown — with `seed` on `tiles` ("x,y" set) too. */
  function grownGrid(M, seed, tiles) {
    const grid = [];
    for (let y = 0; y < SIZE; y++) {
      grid.push([]);
      for (let x = 0; x < SIZE; x++) {
        const me = unlockedTile(M, x, y) ? plantAt(M, x, y) : null;
        grid[y].push(tiles && tiles.has(`${x},${y}`) ? [seed, 4] : me ? [me.key, 4] : null);
      }
    }
    return grid;
  }
  /**
   * What the gardener would plant now, as purchases — one per seed of the layout:
   *   round   a new round is due (none growing, fewer than its replant share mature): the old ones
   *           harvested, every tile of the seed planted
   *   fill    tiles of the seed without it while its round is still growing (or nothing of it is
   *           mature): those tiles planted
   * Each { seed, name, icon, n, price (today's), round, first (a seed that goes first), freq, cps }:
   * freq / cps, the garden's golden cookie frequency and CpS once it's grown, × (against what's
   * planted now, grown).
   */
  function plantings() {
    const M = minigame();
    if (!M) return [];
    const p = active();
    const base = effsOf(M, grownGrid(M));
    return layoutSeeds().flatMap((s) => {
      const me = M.plants[s.key];
      if (!me || !me.unlocked) return [];
      const c = layoutCensus(s.key);
      const first = FIRST_SEEDS.includes(s.key);
      const below = first ? gardenerNumber('tulipReplantBelow', 0.5) : gardenerNumber('replantBelow', 0.75);
      const round = c.planted > 0 && c.young === 0 && c.mature < below * c.tiles;
      const fill = !round && s.missing > 0 && (c.young > 0 || c.mature === 0);
      if (!round && !fill) return [];
      const tiles = new Set();
      tilesOf(M).forEach(([x, y]) => {
        if (wantAt(p, x, y) !== s.key) return;
        const at = plantAt(M, x, y);
        if (round || !at || at.key !== s.key) tiles.add(`${x},${y}`);
      });
      const e = effsOf(M, grownGrid(M, s.key, tiles));
      return [{ seed: s.key, name: s.name, icon: me.icon, n: tiles.size, price: tiles.size * s.cost, round, first, freq: e.freq / base.freq, cps: e.cps / base.cps }];
    });
  }
  /** Plants what plantings() has for a seed (a round: the old ones harvested first); how many it planted. */
  function plantFor(seed) {
    const x0 = plantings().find((x) => x.seed === seed);
    const M = minigame();
    if (!x0 || !M) return 0;
    const p = active();
    let n = 0;
    tilesOf(M).forEach(([x, y]) => {
      if (wantAt(p, x, y) !== seed) return;
      const at = plantAt(M, x, y);
      if (at && (x0.round || at.key !== seed)) harvestTile(M, x, y);
      if (!plantAt(M, x, y) && plant(M, M.plants[seed], x, y)) n++;
    });
    if (n) count('planted', n);
    return n;
  }

  /** Plants on the plot now: { planted, mature, young, empty, off } (empty: unlocked tiles with nothing). */
  function census() {
    const M = minigame();
    const c = { planted: 0, mature: 0, young: 0, empty: 0, off: 0 };
    if (!M) return c;
    const p = active();
    tilesOf(M).forEach(([x, y]) => {
      const me = plantAt(M, x, y);
      if (!me) c.empty++;
      else {
        c.planted++;
        if (isMature(M, x, y)) c.mature++;
        else c.young++;
      }
      if ((me ? me.key : null) !== wantAt(p, x, y)) c.off++;
    });
    return c;
  }

  // The Auto-gardener is a built-in algorithmic macro whose code is the active gardener's
  // (sourceFrom), run from the top every second (pass) while there's a garden to tend (ready).
  // tend() is the same pass by hand — the garden.tend action.
  let last = { at: 0, harvested: 0, planted: 0, saved: 0, unlocked: 0, soil: false };
  let lastPass = null; // { t, at, trace, lines, error, errors, layout, gardener }
  const canTend = () => {
    const M = minigame();
    return !!M && !M.freeze;
  };
  /** After each pass (the gardener's, or tend()'s): where its code went, for the page. */
  function recordPass(F, errors) {
    lastPass = { t: Date.now(), at: F.at, trace: F.trace, lines: F.trace.map((x) => x.line).filter(Boolean), error: F.error, errors: errors || [], layout: active().id, gardener: L().picked('gardener') };
  }
  function tend() {
    if (!canTend()) return 0;
    const { flow, errors } = compileRules(rulesOf());
    const F = CA.Macros.runPass(flow);
    recordPass(F, errors);
    return F.done;
  }

  /** What the current garden looks like against the layout, tile by tile (for the page). */
  function view() {
    const M = minigame();
    if (!M) return null;
    const p = active();
    const tiles = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const open = unlockedTile(M, x, y);
        const me = open ? plantAt(M, x, y) : null;
        const want = p.plot[y] ? p.plot[y][x] : null;
        tiles.push({
          x,
          y,
          open,
          plant: me,
          age: me ? M.plot[y][x][1] : 0,
          want: want && M.plants[want] ? M.plants[want] : null,
          match: (me ? me.key : null) === want,
          decay: me ? decayChance(M, x, y) : 0,
        });
      }
    }
    return { M, profile: p, tiles, next: nextTickIn(M), step: M.stepT || 0, soil: M.soilsById && M.soilsById[M.soil] };
  }

  // ---- save / load ---------------------------------------------------------------------------

  const cleanPlot = (plot) => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (plot && plot[y] && typeof plot[y][x] === 'string' ? plot[y][x] : null)));
  const serialize = () => ({
    ...L().serialize(),
    ...(current ? { current: current.map((r) => r.slice()) } : {}),
    unlockedAt: { ...unlockedAt },
  });
  function load(data) {
    const obj = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    current = obj && Array.isArray(obj.current) ? cleanPlot(obj.current) : null;
    unlockedAt = obj && obj.unlockedAt && typeof obj.unlockedAt === 'object' ? { ...obj.unlockedAt } : {};
    if (obj && obj.v === 3) L().loadV3(obj);
    // before v3.3: profiles were plots of seeds (v3.2: { profiles, gardeners }; before: an array, each with its own rules)
    else if (Array.isArray(data) || (obj && Array.isArray(obj.profiles))) L().migrate(Array.isArray(data) ? data : obj.profiles, obj && obj.gardeners, liftSoilThreshold);
    else L().loadV3({});
    changed();
  }

  const GARDENER = 'gardener';

  function init() {
    CA.Settings.registerSection('garden', { serialize, load, event: 'garden' });
    L().defineOptions();
    // what you do by hand on the garden, noted from the moment it's there (the Current garden)
    setInterval(() => watchClicks(minigame()), 1000);
    S().defineOption({ key: 'gardenThreshold', group: 'garden-hidden', name: 'Harvest before dying at', desc: '', default: 50 });
    S().defineOption({ key: 'gardenLead', group: 'garden-hidden', name: 'Seconds before the tick', desc: '', default: 15 });
    S().defineOption({
      key: 'gardenUnlockNew',
      group: 'garden-hidden',
      icon: 'leaf',
      name: 'Unlock new seeds',
      desc: 'Lets a seed you haven’t unlocked yet grow wherever it appears, and harvests it the moment it’s mature (which unlocks it) — instead of pulling it out as a mismatch.',
      default: true,
    });
    // the garden's words, for the gardeners (and any algorithmic macro)
    const A = CA.Actions.register;
    const seedOptions = () => Object.keys((minigame() || {}).plants || {}).map((k) => ({ v: k, label: minigame().plants[k].name }));
    A({
      id: 'garden.plantEmpty',
      name: 'Plant the layout’s seed on every empty tile',
      icon: 'leaf',
      group: 'Garden',
      unit: 'planted',
      params: [{ key: 'seed', label: 'Only the tiles of', type: 'select', default: '', options: () => [{ v: '', label: 'every seed' }, ...seedOptions()] }],
      run: (p) => actions.plantEmpty((p && p.seed) || ''),
    });
    A({ id: 'garden.harvestNew', name: 'Harvest new seeds once mature (unlocks them)', icon: 'leaf', group: 'Garden', unit: 'unlocked', run: () => actions.harvestNew() });
    A({
      id: 'garden.pullMismatches',
      name: 'Pull out what isn’t the layout’s seed',
      icon: 'leaf',
      group: 'Garden',
      unit: 'pulled',
      params: [{ key: 'keepNew', label: 'Leave seeds you haven’t unlocked', type: 'bool', default: true }],
      run: (p) => actions.pullMismatches(p.keepNew !== false),
    });
    A({
      id: 'garden.harvestDying',
      name: 'Harvest mature plants likely to die on the next tick',
      icon: 'leaf',
      group: 'Garden',
      unit: 'harvested',
      params: [{ key: 'threshold', label: 'Chance to die over', type: 'number', default: 0.5, min: 0 }],
      run: (p) => actions.harvestDying(Number(p.threshold)),
    });
    A({ id: 'garden.harvestMature', name: 'Harvest every mature plant of the layout', icon: 'leaf', group: 'Garden', unit: 'harvested', run: () => actions.harvestMature() });
    const soils = () => ['dirt', 'fertilizer', 'clay', 'pebbles', 'woodchips', 'profile'].map((v) => ({ v, label: v === 'profile' ? 'the soil rule’s' : v }));
    A({
      id: 'garden.soil',
      name: 'Switch the soil (when the game allows)',
      icon: 'leaf',
      group: 'Garden',
      unit: 'switched',
      params: [{ key: 'soil', label: 'Soil', type: 'select', default: 'fertilizer', options: soils }],
      run: (p) => actions.soil(p.soil),
    });
    A({ id: 'garden.soilRule', name: 'Pick the soil, as the soil rule says', icon: 'leaf', group: 'Garden', unit: 'done', run: () => actions.soilRule() });
    CA.Conditions.register({
      id: 'garden.soilIs',
      name: 'The garden’s soil is…',
      icon: 'leaf',
      params: [{ key: 'soil', label: 'Soil', type: 'select', default: 'clay', options: soils }],
      describe: (p) => `the soil is ${p.soil}`,
      test: (p) => {
        const M = minigame();
        const s = M && M.soilsById && M.soilsById[M.soil];
        return !!s && s.key === (p.soil === 'profile' ? soilWanted : p.soil);
      },
    });
    const V = (id, desc, get) => CA.Script.defineValue({ id, desc, get });
    V('garden.tickIn', 'seconds until the next garden tick', () => {
      const M = minigame();
      return M ? Math.round(nextTickIn(M) * 10) / 10 : NaN;
    });
    V('garden.youngShare', 'share of the planted tiles not mature yet (0–1)', () => {
      const c = census();
      return c.planted ? Math.round((c.young / c.planted) * 1000) / 1000 : 0;
    });
    V('garden.matureShare', 'share of the planted tiles that are mature (0–1)', () => {
      const c = census();
      return c.planted ? Math.round((c.mature / c.planted) * 1000) / 1000 : 0;
    });
    V('garden.plants', 'plants on the plot', () => census().planted);
    V('garden.mature', 'mature plants on the plot', () => census().mature);
    V('garden.empty', 'empty tiles', () => census().empty);
    V('garden.offProfile', 'tiles that aren’t as the layout has them', () => census().off);
    V('garden.layoutTiles', 'tiles the layout has a seed for', () => layoutCensus().tiles);
    V('garden.layoutCost', 'cookies to replant the whole layout from scratch (every tile it has a seed for)', () => layoutCost());
    V('garden.priceBoostLeft', 'seconds until the effects that raise seed prices are over (0: none running)', () => Math.round(priceBoostLeft() * 10) / 10);
    V('garden.priceBoost', 'how much effects raise seed prices now: CpS ÷ unbuffed CpS (1: none; a Frenzy 7)', () => Math.round(priceBoost() * 1000) / 1000);
    V('garden.roundsReserve', 'what the Auto buyer’s Garden rounds bank keeps: the nursetulips’ round while they aren’t all planted, plus 1.25 × the other seeds’ round (unbuffed prices)', () => roundsReserve());
    V('garden.layoutMature', 'the layout’s own plants that are mature', () => layoutCensus().mature);
    V('garden.layoutYoung', 'the layout’s own plants still growing', () => layoutCensus().young);
    V('garden.layoutYoungShare', 'share of the layout’s own plants not mature yet (0–1)', () => {
      const c = layoutCensus();
      return c.planted ? Math.round((c.young / c.planted) * 1000) / 1000 : 0;
    });
    // one seed of the layout (a garden of two kinds of rounds: nursetulips and golden clovers)
    const ofSeed = (id, desc, f) => CA.Script.defineValue({ id, desc, params: ['seed'], get: (seed) => f(layoutCensus(String(seed || ''))) });
    ofSeed('garden.seedTiles', 'tiles the layout has this seed for', (c) => c.tiles);
    ofSeed('garden.seedMature', 'the layout’s plants of this seed that are mature', (c) => c.mature);
    ofSeed('garden.seedYoung', 'the layout’s plants of this seed still growing', (c) => c.young);
    CA.Script.defineValue({ id: 'garden.roundCost', desc: 'cookies to plant a whole round of a seed: every tile the layout has it for, at today’s prices (none: every seed)', params: ['seed'], get: (seed) => roundCost(String(seed || '')) });
    CA.Script.defineValue({
      id: 'garden.isUnlocked',
      desc: 'whether you’ve unlocked a seed',
      params: ['seed'],
      bool: true,
      get: (seed) => !!((minigame() || {}).plants || {})[seed] && !!minigame().plants[seed].unlocked,
    });
    CA.Script.defineValue({
      id: 'garden.unlockedAgo',
      desc: 'seconds since a seed was unlocked (a huge number when it’s been long, or never)',
      params: ['seed'],
      get: (seed) => {
        let t = unlockedAt[seed] || 0;
        (CA.EventLog.list(['garden']) || []).forEach((e) => e.data && e.data.seed === seed && e.t > t && (t = e.t));
        return t ? Math.max(0, (Date.now() - t) / 1000) : 1e12;
      },
    });
    CA.Script.defineValue({
      id: 'garden.soilAvailable',
      desc: 'whether you have the farms a soil needs',
      params: ['soil'],
      bool: true,
      get: (soil) => {
        const M = minigame();
        const s = M && M.soils && M.soils[soil];
        return !!s && (M.parent.amount || 0) >= (s.req || 0);
      },
    });

    // tile by tile: a tile is named "x,y" (garden.tiles() lists the ones you can use)
    const at = (fn, none) => (tile) => {
      const M = minigame();
      const [x, y] = String(tile).split(',').map(Number);
      return M && Number.isInteger(x) && Number.isInteger(y) && unlockedTile(M, x, y) ? fn(M, x, y) : none;
    };
    const T = (id, desc, get, bool) => CA.Script.defineValue({ id, desc, params: ['tile'], get, bool });
    const tileOptions = () => {
      const M = minigame();
      return M ? tilesOf(M).map(([x, y]) => ({ v: `${x},${y}`, label: `${x},${y}${plantAt(M, x, y) ? ` — ${plantAt(M, x, y).name}` : ''}` })) : [];
    };
    CA.Script.defineValue({
      id: 'garden.tiles',
      desc: 'a list: every tile you can plant on ("x,y")',
      list: true,
      get: () => {
        const M = minigame();
        return M ? tilesOf(M).map(([x, y]) => `${x},${y}`) : [];
      },
    });
    T('garden.plantAt', 'what grows on a tile (its seed, or "" when empty)', at((M, x, y) => (plantAt(M, x, y) || {}).key || '', ''));
    T('garden.wantAt', 'the layout’s seed for a tile (or "")', at((M, x, y) => wantAt(active(), x, y) || '', ''));
    T('garden.age', 'how far a tile’s plant has grown (its age; 0 when empty)', at((M, x, y) => (plantAt(M, x, y) ? M.plot[y][x][1] : 0), 0));
    T('garden.decay', 'the chance a tile’s plant dies on the next tick (0–1)', at((M, x, y) => (isMature(M, x, y) ? decayChance(M, x, y) : 0), 0));
    T('garden.isMature', 'whether a tile’s plant is mature', at((M, x, y) => isMature(M, x, y), false), true);
    T('garden.isNew', 'whether a tile’s plant is a seed you haven’t unlocked yet', at((M, x, y) => !!plantAt(M, x, y) && !plantAt(M, x, y).unlocked, false), true);
    T('garden.isEmpty', 'whether a tile has nothing growing', at((M, x, y) => !plantAt(M, x, y), false), true);
    T('garden.isOff', 'whether a tile isn’t as the layout has it', at((M, x, y) => ((plantAt(M, x, y) || {}).key || null) !== wantAt(active(), x, y), false), true);
    CA.Script.defineValue({
      id: 'garden.seeds',
      desc: 'a list: every seed you’ve unlocked',
      list: true,
      get: () => Object.keys((minigame() || {}).plants || {}).filter((k) => minigame().plants[k].unlocked),
    });
    CA.Script.defineValue({ id: 'garden.seedCost', desc: 'cookies to plant a seed', params: ['seed'], get: (seed) => {
      const M = minigame();
      const me = M && M.plants[seed];
      return me && typeof M.getCost === 'function' ? M.getCost(me) : NaN;
    } });
    A({
      id: 'garden.harvest',
      name: 'Harvest a tile',
      icon: 'leaf',
      group: 'Garden',
      unit: 'harvested',
      params: [{ key: 'tile', label: 'Tile', type: 'select', default: '', options: tileOptions }],
      run: (p) =>
        withGarden((M) => {
          const [x, y] = String(p.tile).split(',').map(Number);
          if (!Number.isInteger(x) || !Number.isInteger(y) || !plantAt(M, x, y) || !harvestTile(M, x, y)) return 0;
          count('harvested');
          return 1;
        }),
    });
    A({
      id: 'garden.plant',
      name: 'Plant a seed on a tile',
      icon: 'leaf',
      group: 'Garden',
      unit: 'planted',
      params: [
        { key: 'tile', label: 'Tile', type: 'select', default: '', options: tileOptions },
        { key: 'seed', label: 'Seed', type: 'select', default: 'bakerWheat', options: seedOptions },
      ],
      run: (p) =>
        withGarden((M) => {
          const [x, y] = String(p.tile).split(',').map(Number);
          const me = M.plants[p.seed];
          if (!me || !Number.isInteger(x) || !Number.isInteger(y) || !unlockedTile(M, x, y) || plantAt(M, x, y) || !plant(M, me, x, y)) return 0;
          count('planted');
          return 1;
        }),
    });
    CA.Actions.register({
      id: 'garden.tend',
      name: 'Tend the garden (the active gardener, once)',
      icon: 'leaf',
      group: 'Garden',
      unit: 'done',
      available: () => !!minigame(),
      run: () => tend(),
    });
    // its choices on its card: a profile, or any of the four layers (the Garden page's own picks)
    const choice = (layer, label) => ({
      key: layer === 'soil' ? 'soilRule' : layer === 'seeds' ? 'seedSet' : layer,
      label,
      type: 'select',
      default: L().LAYERS[layer].def,
      options: () => L().list(layer).map((x) => ({ v: x.id, label: x.name + (x.edited ? ' (edited)' : '') })),
      get: () => L().picked(layer),
      set: (v) => L().pick(layer, v),
    });
    CA.Macros.addBuiltin({
      id: GARDENER,
      name: 'Auto-gardener',
      desc: 'Tends your garden as four layers say: the gardener (what it does), its soil rule, the template (where seeds go) and the seeds — or a profile that picks all four. Edit them on the Garden page.',
      icon: { sprite: [4, 0], sheet: 'img/gardenPlants.png' }, // mature Baker's wheat
      mode: 'flow',
      pass: true,
      every: 1000,
      sourceFrom: () => rulesOf(),
      inputs: [choice('profile', 'Profile'), choice('gardener', 'Gardener'), choice('soil', 'Soil rule'), choice('template', 'Template'), choice('seeds', 'Seeds')],
      ready: canTend,
      afterPass: (F) => recordPass(F),
      editAt: 'garden',
      defaultKey: '',
      section: 'garden',
    });
  }

  // a few words for the other layers (and the tests) — the layers themselves are CA.GardenLayers
  function use(id) {
    if (id !== CURRENT) return L().loadProfile(id);
    L().pick('template', CURRENT);
    L().pick('seeds', CURRENT);
  }
  return {
    init,
    minigame,
    decayChance,
    snapshot,
    use,
    active,
    CURRENT,
    captureCurrent,
    currentPlot,
    originOf,
    gardenerRules,
    useGardener: (id) => L().pick('gardener', id),
    activeGardener: () => L().get('gardener', L().picked('gardener')),
    tend,
    view,
    last: () => last,
    lastPass: () => lastPass,
    soilPass: () => soilPass,
    rulesOf,
    soilRules,
    setRules,
    defaultRules,
    census,
    layoutCost,
    layoutSeeds,
    plantings,
    plantFor,
    roundCost,
    roundsReserve,
    priceBoost,
    priceBoostLeft,
    pricesStayUp,
    ROUNDS_MARGIN,
    compileRules,
    serialize,
    load,
    GARDENER,
    nextTickIn,
  };
})();
