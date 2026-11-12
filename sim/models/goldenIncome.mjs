// Golden cookie income at a golden cookie frequency: how many times a baseline (unbuffed CpS + 20
// clicks a second) a game earns, on average, with golden cookies clicked as they appear — a
// function of the frequency multiplier f (1 = no garden), for one game state (a save: its buildings,
// upgrades, dragon auras, Pantheon, …).
//
// It runs the real game: every golden cookie is the game's own (Game.shimmer, its popFunc picks the
// effect, Game.gainBuff makes the buff, Game.CalculateGains and Game.mouseCps say what it's worth),
// as are the spawn timer's numbers (getMinTime / getMaxTime) and the spawn rule. What it skips is
// the frames in between: between two events (a golden cookie, a buff running out) nothing about the
// income changes, so it jumps from one to the next — the spawn frame drawn at once from the game's
// own per-frame chance, ((time − min) / (max − min))^5, rather than rolled frame by frame — and
// credits CpS and clicks for the whole stretch. That is thousands of times faster than playing every
// frame, so it can run thousands of hours per frequency.
//
// What it assumes, as a well-kept late game: every golden cookie clicked the moment it appears
// (wrath cookies and cookie storm drops too), Elder Pledge on for good (no wrath cookies) unless the
// state says otherwise, clicking `clicks` times a second throughout, no spells, no wrinklers, the
// save's own dragon auras / Pantheon / upgrades / buildings unless the state sets them (gameState,
// applyState), and an empty garden (its golden cookie frequency comes from f; a garden's CpS cost is
// applied on top by the caller). The season stays as it is (the game ends one after 24 h). Seeds and
// other spending are not counted: the bank only grows.
import { createSim } from '../sim.mjs';
import { makeRng } from '../game/rng.mjs';

// The upgrades that change golden cookies themselves (main.js: their timer, how long they and their
// effects last, what they give) — the ones a game state lists; any other upgrade can be set too.
export const GOLDEN_UPGRADES = [
  'Lucky day', 'Serendipity', 'Get lucky', 'Golden goose egg', 'Heavenly luck', 'Lasting fortune', 'Decisive fate',
  'Lucky digit', 'Lucky number', 'Lucky payout', 'Green yeast digestives', 'Dragon fang', 'Distilled essence of redoubled luck',
  'Starspawn', 'Starterror', 'Starlove', 'Startrade', 'Golden switch [off]', 'Gold hoard',
];

/**
 * What a game state is, for golden cookie income — the few things that matter, read from the game:
 * { clicks (a second), elderWrath (0 = Elder Pledge / Covenant … 3 = Grandmapocalypse), season,
 * auras [two names], dragonLevel, gods [diamond, ruby, jade] (ids or ''), buildings { name: count },
 * upgrades { name: owned } (GOLDEN_UPGRADES), clickVsCps (a click's cookies as a share of unbuffed
 * CpS — setting it scales Game.mouseCps), and, read only, cps (unbuffed) and click (a click's cookies) }. Everything else (prestige, kittens, milk,
 * other upgrades) scales CpS and clicks together, so it cancels out of income ÷ baseline — except
 * through clickVsCps.
 */
export function gameState(Game, clicks = 20) {
  const P = Game.Objects.Temple.minigame;
  const auraName = (i) => (Game.dragonAuras[i] ? Game.dragonAuras[i].name : '');
  Game.CalculateGains();
  return {
    clicks,
    elderWrath: Game.elderWrath,
    season: Game.season,
    auras: [auraName(Game.dragonAura), auraName(Game.dragonAura2)].map((n) => (n === 'No aura' ? '' : n)),
    dragonLevel: Game.dragonLevel,
    gods: P ? P.slot.map((id) => (id >= 0 && P.godsById[id] ? Object.keys(P.gods).find((k) => P.gods[k] === P.godsById[id]) : '')) : [],
    buildings: Object.fromEntries(Object.values(Game.Objects).map((o) => [o.name, o.amount])),
    upgrades: Object.fromEntries(GOLDEN_UPGRADES.filter((n) => Game.Upgrades[n]).map((n) => [n, !!Game.Upgrades[n].bought])),
    cps: Game.unbuffedCps,
    click: Game.computedMouseCps,
    clickVsCps: Game.unbuffedCps ? Game.computedMouseCps / Game.unbuffedCps : 0,
  };
}

/**
 * Sets a game state's variables on the game (any of gameState's, but the read-only ones): the
 * game's own numbers change with them (CpS from buildings, building specials' size, auras, gods…).
 */
export function applyState(Game, st = {}) {
  if (st.elderWrath != null) {
    Game.elderWrath = Math.max(0, Math.min(3, Math.round(st.elderWrath)));
    Game.pledgeT = Game.elderWrath ? 0 : 1e15;
  }
  if (st.season != null) Game.season = st.season;
  if (st.dragonLevel != null) Game.dragonLevel = st.dragonLevel;
  if (st.auras) {
    const id = (n) => {
      if (!n) return 0;
      const a = Game.dragonAurasBN[n];
      if (!a) throw new Error(`no dragon aura called "${n}"`);
      return a.id;
    };
    Game.dragonAura = id(st.auras[0]);
    Game.dragonAura2 = id(st.auras[1]);
  }
  if (st.gods) {
    const P = Game.Objects.Temple.minigame;
    if (!P) throw new Error('no Pantheon in this game');
    for (let i = 0; i < 3; i++) {
      const g = st.gods[i];
      if (g === undefined) continue;
      if (!g) {
        if (P.slot[i] >= 0) P.godsById[P.slot[i]].slot = -1;
        P.slot[i] = -1;
        continue;
      }
      if (!P.gods[g]) throw new Error(`no god "${g}" (one of: ${Object.keys(P.gods).join(', ')})`);
      P.slotGod(P.gods[g], i);
    }
  }
  if (st.buildings)
    for (const [name, n] of Object.entries(st.buildings)) {
      const o = Game.Objects[name];
      if (!o) throw new Error(`no building "${name}"`);
      o.amount = Math.max(0, Math.round(n));
    }
  if (st.upgrades)
    for (const [name, on] of Object.entries(st.upgrades)) {
      const u = Game.Upgrades[name];
      if (!u) throw new Error(`no upgrade "${name}"`);
      u.bought = on ? 1 : 0;
    }
  Game.BuildingsOwned = Object.values(Game.Objects).reduce((a, o) => a + o.amount, 0);
  Game.recalculateGains = 1;
  Game.CalculateGains();
}

/**
 * A game ready to measure: the save loaded, buffs and golden cookies cleared, Elder Pledge on (unless
 * `state` says otherwise), the garden emptied (clay), then `state`'s variables set (applyState).
 * Returns { sim, Game, state (gameState after), base, cps, click, at(f, opts) }.
 */
export async function goldenIncomeGame({ save, seed = 1, state = {} } = {}) {
  const sim = await createSim({ seed, save, mgr: false, sampleEvery: 0 });
  sim.run({ seconds: 1 });
  const Game = sim.Game;
  Game.seed = Game.makeSeed(); // never the save's own seed: nothing here may follow its RNG
  Game.killBuffs();
  Game.killShimmers();
  Game.elderWrath = 0;
  Game.pledgeT = 1e15;
  const M = Game.Objects.Farm.minigame;
  if (M) {
    for (let y = 0; y < M.plot.length; y++) for (let x = 0; x < M.plot[y].length; x++) M.plot[y][x] = [0, 0];
    M.soil = M.soils.clay.id;
    M.computeEffs();
  }
  applyState(Game, state);
  // a click worth a set share of CpS: Game.mouseCps scaled (buffs on clicks still apply on top)
  if (state.clickVsCps != null) {
    const ratio = Game.computedMouseCps / Game.unbuffedCps;
    const k = Number(state.clickVsCps) / ratio;
    const mouse0 = Game.mouseCps;
    Game.mouseCps = function () {
      return mouse0.call(Game) * k;
    };
    Game.CalculateGains();
  }
  const clicks = state.clicks != null ? Number(state.clicks) : 20;
  // the frequency multiplier the garden would give: f on top of whatever else the game has
  let freq = 1;
  const eff0 = Game.eff;
  Game.eff = function (name, def) {
    const v = eff0.call(Game, name, def);
    return name === 'goldenCookieFreq' ? v * freq : v;
  };
  const st = gameState(Game, clicks);
  const base = st.cps + clicks * st.click;
  const at = (f, opts) => {
    freq = f;
    return incomeAt(Game, { ...opts, clicks, base });
  };
  return { sim, Game, state: st, base, cps: st.cps, click: st.click, clicks, at };
}

// P(the spawn timer fires on frame k, k = 1, 2, …), as Game.updateShimmers rolls it each frame:
// the cumulative chance it hasn't yet, per (minTime, maxTime) — a table each, kept.
const survival = new Map();
function survivalTable(min, max) {
  const key = `${min},${max}`;
  let S = survival.get(key);
  if (S) return S;
  S = [1];
  let s = 1;
  for (let k = 1; s > 0; k++) {
    const p = max === min ? (k > min ? 1 : 0) : Math.pow(Math.max(0, (k - min) / (max - min)), 5);
    s *= 1 - Math.min(1, p);
    S.push(s);
  }
  survival.set(key, S);
  return S;
}
/** The frame (counted from the timer's reset) a golden cookie appears on, drawn with u in [0, 1). */
export function spawnFrame(min, max, after, u) {
  const S = survivalTable(min, max);
  // the timer already ran `after` frames without one: draw from what's left
  const target = S[after] * (1 - u);
  let lo = after + 1;
  let hi = S.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (S[mid] <= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * `hours` of play at the frequency set on the game (see goldenIncomeGame): { mult (income ÷ (base ×
 * time)), se (its standard error, from batches), parts ({ cps, clicks, lucky, chain, storm } ÷ base
 * × time), golden (golden cookies an hour), effects ({ choice: count an hour }) }.
 */
export function incomeAt(Game, { hours = 1000, seed = 1, clicks = 20, base, batches = 50 } = {}) {
  const rnd = makeRng(seed * 7919 + 13);
  const fps = Game.fps;
  const T = Game.shimmerTypes.golden;
  Game.killBuffs();
  Game.killShimmers(); // the timer restarts, with today's min / max
  Game.CalculateGains();
  const end = Math.round(hours * 3600 * fps);
  const parts = { cps: 0, clicks: 0, lucky: 0, chain: 0, storm: 0, other: 0 };
  const effects = {};
  const batchLen = end / batches;
  const batchSums = new Array(batches).fill(0);
  let golden = 0;
  let frame = 0;
  let total = 0;
  let cpsRate = Game.cookiesPs;
  let clickRate = clicks * Game.computedMouseCps;
  let next = spawnFrame(T.minTime, T.maxTime, T.time, rnd()) - T.time + frame; // the next spawn, absolute
  const recalc = () => {
    Game.CalculateGains();
    cpsRate = Game.cookiesPs;
    clickRate = clicks * Game.computedMouseCps;
  };
  const credit = (amount, part) => {
    parts[part] += amount;
    total += amount;
    // spread over the batches the stretch covers is not needed: stretches are seconds, batches hours
    batchSums[Math.min(batches - 1, Math.floor(frame / batchLen))] += amount;
  };
  const earnFor = (frames) => {
    if (frames <= 0) return;
    const c = (cpsRate * frames) / fps;
    const k = (clickRate * frames) / fps;
    Game.Earn(c + k);
    credit(c, 'cps');
    credit(k, 'clicks');
  };
  // a buff runs out as Game.updateBuffs ends it
  const dropDead = () => {
    let any = false;
    for (const name of Object.keys(Game.buffs)) {
      const b = Game.buffs[name];
      if (b.time > 0) continue;
      if (b.onDie) b.onDie();
      delete Game.buffs[name];
      any = true;
    }
    return any;
  };
  const pop = (s) => {
    const before = Game.cookiesEarned;
    s.pop();
    const choice = s.force === '' && T.last ? T.last : T.last;
    effects[choice] = (effects[choice] || 0) + 1;
    const got = Game.cookiesEarned - before;
    if (got > 0) {
      const part = choice === 'multiply cookies' ? 'lucky' : choice === 'chain cookie' ? 'chain' : choice === 'cookie storm drop' ? 'storm' : 'other';
      parts[part] += got;
      total += got;
      batchSums[Math.min(batches - 1, Math.floor(frame / batchLen))] += got;
    }
  };

  while (frame < end) {
    const storm = Game.hasBuff('Cookie storm');
    let stop = Math.min(next, end);
    for (const name in Game.buffs) stop = Math.min(stop, frame + Math.max(1, Game.buffs[name].time));
    if (storm) stop = frame + 1; // a storm drops cookies frame by frame
    const d = stop - frame;
    earnFor(d);
    for (const name in Game.buffs) Game.buffs[name].time -= d;
    if (!T.spawned) T.time += d;
    frame = stop;
    let changed = dropDead();
    if (storm && rnd() < 0.5) {
      const drop = new Game.shimmer('golden', { type: 'cookie storm drop' }, 1);
      pop(drop);
      changed = true;
    }
    if (frame === next) {
      // a golden cookie appears (and, with Distilled essence of redoubled luck, 1% of the time a
      // second one), clicked at once
      const lead = new Game.shimmer('golden');
      lead.spawnLead = 1;
      const extra = Game.Has('Distilled essence of redoubled luck') && rnd() < 0.01 ? new Game.shimmer('golden') : null;
      T.spawned = 1;
      golden++;
      pop(lead);
      if (extra) pop(extra);
      dropDead(); // Dragonflight ends a Click frenzy
      // popping the lead reset the timer (die()): time 0, its new min / max
      next = frame + spawnFrame(T.minTime, T.maxTime, 0, rnd());
      changed = true;
    }
    if (changed) recalc();
  }
  const secs = end / fps;
  const per = (x) => x / (base * secs);
  const bm = batchSums.map((x) => x / (base * (secs / batches)));
  const mean = bm.reduce((a, b) => a + b, 0) / batches;
  const sd = Math.sqrt(bm.reduce((a, b) => a + (b - mean) ** 2, 0) / (batches - 1));
  const hrs = secs / 3600;
  return {
    hours: hrs,
    mult: per(total),
    se: sd / Math.sqrt(batches),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, per(v)])),
    golden: golden / hrs,
    effects: Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, v / hrs])),
  };
}

/**
 * The income curve for a save: incomeAt at each of `fs`, each in its own process (`jobs` at a time),
 * fitted (models/gardenScore.mjs fitCurve). Returns { state (gameState), base, hours, points:
 * [{ f, mult, se, parts, golden, effects }], a, b, c }. `onPoint(point, done, total)` as each comes in.
 */
export async function incomeCurve({ save, state = {}, fs = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3], hours = 2000, seed = 1, jobs = 4, onPoint } = {}) {
  const { spawn } = await import('node:child_process');
  const { fitCurve } = await import('./gardenScore.mjs');
  const worker = new URL('./goldenIncomePoint.mjs', import.meta.url).pathname;
  const points = [];
  let head = null;
  const one = (f, i) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        try {
          if (code !== 0) throw new Error(err.trim().split('\n').pop() || `the income worker exited with ${code}`);
          resolve(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(JSON.stringify({ save, state, f, hours, seed: seed * 1000 + i }));
    });
  let next = 0;
  const run = async () => {
    while (next < fs.length) {
      const i = next++;
      const r = await one(fs[i], i);
      head = head || r.game;
      points.push({ f: fs[i], ...r.point });
      if (onPoint) onPoint(points[points.length - 1], points.length, fs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, fs.length)) }, run));
  points.sort((a, b) => a.f - b.f);
  const { a, b, c } = fitCurve(points);
  return { ...head, hours, points, a, b, c };
}

/** incomeCurve, kept in sim/out/income/ by its inputs, so the same save and state fit once. */
export async function cachedIncomeCurve(opts) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const crypto = await import('node:crypto');
  const { save, state = {}, fs: freqs = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3], hours = 2000, seed = 1 } = opts;
  const key = crypto.createHash('sha1').update(JSON.stringify({ save, state, freqs, hours, seed, v: 1 })).digest('hex').slice(0, 16);
  const dir = new URL('../out/income/', import.meta.url).pathname;
  const file = path.join(dir, `${key}.json`);
  if (!opts.fresh && fs.existsSync(file)) return { ...JSON.parse(fs.readFileSync(file, 'utf8')), cached: true };
  const curve = await incomeCurve(opts);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(curve));
  return curve;
}

/**
 * A game state's variables from command-line words: `--state file.json` (a gameState, or part of one)
 * and any number of `--set key=value` (`clicks=10`, `season=`, `elderWrath=3`, `auras=Reaper of
 * Fields,Radiant Appetite`, `gods=mother,,`, `buildings.You=600`, `upgrades.Lucky day=false`).
 */
export function stateFromArgs(argv, readFile) {
  let state = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--state') state = { ...state, ...JSON.parse(readFile(argv[++i])) };
    if (argv[i] === '--set') {
      const m = String(argv[++i]).match(/^([^=]+)=(.*)$/);
      if (!m) throw new Error(`--set key=value, not "${argv[i]}"`);
      const [k0, k1] = m[1].split('.');
      let v = m[2];
      if (k0 === 'auras' || k0 === 'gods') v = v.split(',').map((x) => x.trim());
      else if (k0 === 'season') v = v.trim();
      else if (v === 'true' || v === 'false') v = v === 'true';
      else if (v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
      if (k1) state[k0] = { ...(state[k0] || {}), [k1]: v };
      else state[k0] = v;
    }
  }
  delete state.cps;
  delete state.click;
  return state;
}
