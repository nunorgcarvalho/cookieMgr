// Golden cookie income, computed rather than played: the expected income ÷ baseline (unbuffed CpS +
// `clicks` clicks a second) at a golden cookie frequency multiplier, for one game state — the number
// models/goldenIncome.mjs measures by playing thousands of hours, to a few tenths of a percent in
// seconds instead of ±5–25% in minutes.
//
// Golden cookies are a renewal process: the spawn timer restarts at every click and its chance per
// frame, ((time − min) / (max − min))^5, doesn't depend on what's running, so the wait for the next
// one has a fixed distribution (the game's per-frame chance, worked out exactly). What a click does
// depends on what's running: Dragonflight makes Click frenzy rarer, the last effect is 80% barred
// from coming again, Lucky and chains pay from the buffed CpS. So the effects form a Markov chain
// whose state is what runs at a click — every buff's time left, and the last effect — and the income
// is that chain's expected reward per second (renewal–reward): what CpS, clicks and storm drops earn
// until the next golden cookie, plus what each click pays.
//
// Playing it, income is noisy because it comes mostly from rare stacks (a Click frenzy or
// Dragonflight on top of Frenzy, Dragon Harvest and building specials, worth ×10⁵ and more). Two
// ways round that, both here:
//   - expectedIncome walks the chain, one state per click as the game would reach it, but credits
//     each click its expectation: every effect it could pick (and the 1% second cookie), with what
//     it pays and what the next wait earns, averaged over the wait's exact distribution. A stack is
//     then counted at its odds every time its makings come up, not the few times the dice land on
//     it; what noise is left is the states' own. ~5 µs a click: a million clicks (≈30,000 hours of
//     play at +0%) in a few seconds, ±0.2% at +0%, ±0.5% at +200%. The one the curves use.
//   - exactIncome solves the chain outright (its stationary distribution, by power iteration) on a
//     time grid. No noise at all, but its states multiply as buffs overlap: right for +0% to +50%,
//     out of reach by +100%. The check on the walk.
//
// Everything comes from the game: the timer (getMinTime / getMaxTime), each effect's buff (popped
// for real once, its time and power read back), Lucky's multiplier, what a click is worth with CpS
// buffs on (the mouse upgrades' share of CpS), which effects can come up and how likely (the
// game's own list-building rules in popFunc, enumerated rather than rolled).
//
// Exact but for these, each measured or a rare corner:
//   - building specials: which buildings are boosted is averaged out exactly (every set of k distinct
//     buildings equally likely, a repeat adds time to the one it hits), up to 4 at once;
//   - chains with 3 or more building specials on use their average boost; a storm running when a
//     chain starts ends it at once; a chain from the 1% second cookie runs like any other;
//   - the bank stays at `bank` (cookies): Lucky pays the lower of 15% of it and 15 minutes of CpS,
//     a chain starts from its digits and is capped by half of it; Infinity = never the limit;
//   - exactIncome's grid (`grid` frames, 30 = a second; buffs last whole seconds, so only the wait
//     between golden cookies is split between its two grid neighbors, keeping its mean): 5 s steps
//     are within 0.2% of the limit, a chain's steps a grid step apart;
//   - no wrath cookies (Elder Pledge on, no Scorn), no Sugar blessing.
import { survivalTable, spawnFrame } from './goldenIncome.mjs';
import { makeRng } from '../game/rng.mjs';
import { makePlan } from './grimoire.mjs';

// what a golden cookie can do (Elder Pledge on): the effects popFunc lists
const CHOICES = ['frenzy', 'multiply cookies', 'chain cookie', 'cookie storm', 'everything must go', 'click frenzy', 'building special', 'free sugar lump', 'dragon harvest', 'dragonflight', 'blab'];
// what a spell can bring on top: Force the Hand of Fate's storm drop and its backfires' wrath cookies
// (models/grimoire.mjs), Conjure Baked Goods, Stretch Time and Diminish Ineptitude
const CAST_CHOICES = ['cookie storm drop', 'clot', 'ruin cookies', 'cursed finger', 'blood frenzy'];
const ALL_CHOICES = [...CHOICES, ...CAST_CHOICES];
// what's earned, by part: `spell` is what a spell pays outright (Conjure Baked Goods)
const PARTS = ['cps', 'clicks', 'lucky', 'chain', 'storm', 'spell'];
// what the last effect can be: a storm's drops come at once and stay the last
const LASTS = ['', ...CHOICES.filter((c) => c !== 'cookie storm'), 'cookie storm drop'];
const LAST = Object.fromEntries(LASTS.map((n, i) => [n, i]));
// a storm's drops, a blab and the wrath cookies' effects are never on the list, so they bar nothing,
// like no last effect at all
const lastOf = (choice) => (choice === 'cookie storm' || choice === 'cookie storm drop' || choice === 'blab' ? 0 : LAST[choice] || 0);
// A state: [last, F, H, C, D, S, E, L, X, A, I, J, ...B (descending)] — the last effect and the time
// left (frames) on Frenzy, Dragon Harvest, Click frenzy, Dragonflight, Cookie storm, Elder frenzy,
// Clot, Cursed finger, Magic adept, Magic inept, J (1 right after a Force the Hand of Fate: what a
// spell plan does next) and each building special. E to J only ever come from spells.
const F_ = 1;
const H_ = 2;
const C_ = 3;
const D_ = 4;
const S_ = 5;
const E_ = 6;
const L_ = 7;
const X_ = 8;
const A_ = 9;
const I_ = 10;
const J_ = 11;
const B0 = 12;
export const SLOTS = { F: F_, H: H_, C: C_, D: D_, S: S_, E: E_, L: L_, X: X_, A: A_, I: I_, J: J_, B0 };
const fresh = (last = 0) => {
  const s = new Array(B0).fill(0);
  s[0] = last;
  return s;
};

/**
 * What the model needs from a game, read from it (with the frequency already set on it):
 * { fps, minTime, maxTime, durations (frames) and powers of each buff, building specials' powers,
 * Lucky's multiplier, the click's CpS share, the effect odds' inputs, cps0, click0, clicks, base, bank }.
 */
export function goldenParams(Game, { clicks = 20, bank } = {}) {
  const T = Game.shimmerTypes.golden;
  if (Game.elderWrath > 0 || (Game.hasGod && Game.hasGod('scorn'))) throw new Error('wrath cookies are not modeled: Elder Pledge on and no Scorn');
  const keep = { cookies: Game.cookies, earned: Game.cookiesEarned, last: T.last, chain: T.chain, lumps: Game.lumps, clicks: Game.goldenClicks };
  T.chain = 0;
  const minTime = T.getMinTime({ wrath: 0 });
  const maxTime = T.getMaxTime({ wrath: 0 });
  Game.killBuffs();
  Game.CalculateGains();
  const cps0 = Game.cookiesPs;
  const click0 = Game.computedMouseCps;
  // a click with CpS ×7 on: the part of a click that follows CpS (the mouse upgrades)
  Game.gainBuff('frenzy', 1, 7);
  Game.CalculateGains();
  const cpsShare = (Game.computedMouseCps / click0 - 1) / 6;
  const cpsCheck = Game.cookiesPs / cps0;
  Game.killBuffs();
  Game.CalculateGains();
  if (Math.abs(cpsCheck - 7) > 1e-9) throw new Error(`a ×7 CpS buff gave ×${cpsCheck}`);
  // each effect popped for real: its buff's time (frames) and power
  const pop = (type) => {
    Game.cookies = cps0 * 1e12; // Lucky below the bank's cap
    const before = Game.cookiesEarned;
    new Game.shimmer('golden', { type }, 1).pop();
    return Game.cookiesEarned - before;
  };
  const buff = (type, field) => {
    Game.killBuffs();
    pop(type);
    const b = Object.values(Game.buffs)[0];
    const r = { frames: b.time, power: b[field] };
    Game.killBuffs();
    return r;
  };
  const frenzy = buff('frenzy', 'multCpS');
  const harvest = buff('dragon harvest', 'multCpS');
  const clickFrenzy = buff('click frenzy', 'multClick');
  const flight = buff('dragonflight', 'multClick');
  const storm = buff('cookie storm', 'power');
  const special = Object.values(Game.Objects).some((o) => o.amount >= 10) ? buff('building special', 'multCpS') : { frames: 0 };
  // a backfired Force the Hand of Fate's wrath cookie: its effects' buffs, popped for real too
  const wrathBuff = (type, field) => {
    Game.killBuffs();
    Game.CalculateGains();
    new Game.shimmer('golden', { type, wrath: true }, 1).pop();
    const b = Object.values(Game.buffs)[0];
    const r = { frames: b.time, power: b[field] };
    Game.killBuffs();
    return r;
  };
  const elder = wrathBuff('blood frenzy', 'multCpS');
  const clot = wrathBuff('clot', 'multCpS');
  const cursed = wrathBuff('cursed finger', 'power');
  cursed.power /= cps0; // seconds of CpS a click is worth (the CpS then, buffs and all)
  Game.killBuffs();
  Game.CalculateGains();
  const luckyMult = (pop('multiply cookies') - 13) / (cps0 * 900);
  Game.CalculateGains();
  const buildings = Object.values(Game.Objects)
    .filter((o) => o.amount >= 10)
    .map((o) => o.amount / 10 + 1);
  const P = {
    fps: Game.fps,
    minTime,
    maxTime,
    golden: !Game.Has('Golden switch [off]'),
    frenzy,
    harvest,
    clickFrenzy,
    flight,
    storm,
    special: { frames: special.frames, powers: buildings },
    elder,
    clot,
    cursed,
    grimoire: grimoireParams(Game),
    luckyMult,
    cpsShare,
    pChainStorm: Game.cookiesEarned >= 100000 ? 0.03 : 0,
    pFools: Game.season === 'fools' ? 0.05 : 0,
    pLump: Game.canLumps() ? 0.0005 : 0,
    pBuilding: Game.BuildingsOwned >= 10 ? 0.25 : 0,
    pReaper: Math.min(1, Game.auraMult('Reaper of Fields')),
    pFlight: Math.min(1, Game.auraMult('Dragonflight')),
    pExtra: Game.Has('Distilled essence of redoubled luck') ? 0.01 : 0,
    cps0,
    click0,
    clicks,
    base: cps0 + clicks * click0,
    bank: bank == null ? keep.cookies : bank,
  };
  Game.cookies = keep.cookies;
  Game.cookiesEarned = keep.earned;
  Game.lumps = keep.lumps;
  Game.goldenClicks = keep.clicks;
  T.last = keep.last;
  T.chain = keep.chain;
  return P;
}

/**
 * What spells need from a game with the Grimoire (null without it): { magicM, fail (a spell's chance
 * to backfire, no buffs on), costs: { fthof, stretch, adept, conjure }, regen (magic after k frames
 * from an empty bar, to full) }.
 */
function grimoireParams(Game) {
  const M = Game.Objects['Wizard tower'] && Game.Objects['Wizard tower'].minigame;
  if (!M || !M.spells || !Game.Objects['Wizard tower'].amount) return null;
  M.computeMagicM();
  const sp = M.spells;
  const costs = { fthof: M.getSpellCost(sp['hand of fate']), stretch: M.getSpellCost(sp['stretch time']), adept: M.getSpellCost(sp['diminish ineptitude']), conjure: M.getSpellCost(sp['conjure baked goods']) };
  // the game's refill, frame by frame (M.logic): from 0 to a full bar
  const max = M.magicM;
  const regen = [0];
  for (let m = 0; m < max && regen.length < 5e6; ) {
    m = Math.min(max, m + Math.max(0.002, Math.pow(m / Math.max(max, 100), 0.5)) * 0.002);
    regen.push(m);
  }
  const n0 = Game.shimmerTypes.golden.n;
  Game.shimmerTypes.golden.n = 0;
  const fail = M.getFailChance(sp['hand of fate']);
  Game.shimmerTypes.golden.n = n0;
  return { magicM: max, fail, costs, regen: Float64Array.from(regen) };
}

/** The effect a golden cookie picks, given the last one and whether Dragonflight runs: [[choice, p]]. */
export function choiceOdds(P, last, flying) {
  // popFunc's coin flips, each one way or the other
  const flips = [
    [P.pChainStorm, ['chain cookie', 'cookie storm']],
    [P.pFools, ['everything must go']],
    [0.1 * (flying ? 0.05 : 1), ['click frenzy']],
    [P.pBuilding, ['building special']],
    [P.pLump, ['free sugar lump']],
  ];
  const dragonGate = 1 - 0.85 * 0.95; // (non-wrath && r < 0.15) || r < 0.05
  const out = new Map();
  const add = (c, p) => out.set(c, (out.get(c) || 0) + p);
  const finish = (list, p) => {
    // 80% of the time the last effect is struck off the list (when there is one and it's on it)
    const lists = [];
    if (last !== '' && list.includes(last)) {
      lists.push([list.filter((c) => c !== last), 0.8], [list, 0.2]);
    } else lists.push([list, 1]);
    for (const [l, q] of lists)
      for (const [l2, q2] of [
        [l, 1 - 0.0001],
        [[...l, 'blab'], 0.0001],
      ])
        for (const c of l2) add(c, (p * q * q2) / l2.length);
  };
  const walk = (i, list, p) => {
    if (p === 0) return;
    if (i < flips.length) {
      const [q, adds] = flips[i];
      walk(i + 1, [...list, ...adds], p * q);
      walk(i + 1, list, p * (1 - q));
      return;
    }
    // the dragon's: past the gate, Dragon Harvest and Dragonflight each on its own aura's odds
    for (const [gate, pg] of [
      [1, dragonGate],
      [0, 1 - dragonGate],
    ])
      for (const [h, ph] of gate ? [[1, P.pReaper], [0, 1 - P.pReaper]] : [[0, 1]])
        for (const [d, pd] of gate ? [[1, P.pFlight], [0, 1 - P.pFlight]] : [[0, 1]]) {
          const q = p * pg * ph * pd;
          if (!q) continue;
          const l = [...list];
          if (h) l.push('dragon harvest');
          if (d) l.push('dragonflight');
          finish(l, q);
        }
  };
  walk(0, ['frenzy', 'multiply cookies'], 1);
  return [...out].filter(([, p]) => p > 0);
}

// elementary symmetric sums: the average product of the powers of k distinct buildings, every set equally likely
function subsetAverages(pows, kMax) {
  const n = pows.length;
  const e = [1, ...new Array(kMax).fill(0)];
  for (const x of pows) for (let k = kMax; k >= 1; k--) e[k] += e[k - 1] * x;
  const out = [];
  let choose = 1;
  for (let k = 0; k <= kMax; k++) {
    if (k > 0) choose = (choose * (n - k + 1)) / k;
    out.push(k <= n ? e[k] / choose : 0);
  }
  return out;
}
// every k-subset's product, sorted, with prefix sums: E[min(a, b·X)] for Lucky's bank cap
function subsetProducts(pows, kMax) {
  const n = pows.length;
  const lists = [[1]];
  const rec = (k, start, prod, acc) => {
    if (k === 0) return acc.push(prod);
    for (let i = start; i <= n - k; i++) rec(k - 1, i + 1, prod * pows[i], acc);
  };
  for (let k = 1; k <= kMax; k++) {
    const acc = [];
    if (k <= n) rec(k, 0, 1, acc);
    lists.push(acc.sort((a, b) => a - b));
  }
  return lists.map((xs) => {
    const pre = [0];
    for (const x of xs) pre.push(pre[pre.length - 1] + x);
    return { xs, pre };
  });
}
function meanMin(tab, a, b) {
  // E[min(a, b·X)] over the subsets
  const { xs, pre } = tab;
  const n = xs.length;
  if (!n) return 0;
  if (!Number.isFinite(a)) return (b * pre[n]) / n;
  const cut = a / b;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= cut) lo = mid + 1;
    else hi = mid;
  }
  return (b * pre[lo] + a * (n - lo)) / n;
}

/**
 * The model's moving parts for a time grid of `grid` frames (1: exact frames): the state and what
 * happens to it — buffs running out (after), what's earned meanwhile (stretches, earnOver), and a
 * click's outcomes (popOnce, transitions), and a spell's (castOnce). A state is [last, F, H, C, D, S,
 * E, L, X, A, I, J, ...B (descending)] (see SLOTS), times in grid steps.
 */
function noGolden(P) {
  const parts = { cps: P.cps0 / P.base, clicks: (P.clicks * P.click0) / P.base, lucky: 0, chain: 0, storm: 0, spell: 0 };
  return { mult: parts.cps + parts.clicks, parts, golden: 0, effects: {} };
}

function machinery(P, { grid = 1, kMax = 4, shares = false } = {}) {
  const fps = P.fps;
  const unit = grid / fps; // seconds per grid step
  const zero = { cps: 0, clicks: 0, lucky: 0, chain: 0, storm: 0, spell: 0 };
  // a length in frames on the grid: its two neighbors, weighed to keep its mean ([[steps, p]])
  const split = (frames) => {
    const x = frames / grid;
    const lo = Math.floor(x + 1e-9);
    const w = x - lo;
    return w > 1e-9 ? [[lo, 1 - w], [lo + 1, w]] : [[lo, 1]];
  };
  const dF = split(P.frenzy.frames);
  const dH = split(P.harvest.frames);
  const dC = split(P.clickFrenzy.frames);
  const dD = split(P.flight.frames);
  const dS = split(P.storm.frames);
  const dB = split(P.special.frames);
  const pF = P.frenzy.power;
  const pH = P.harvest.power;
  const pC = P.clickFrenzy.power;
  const pD = P.flight.power;
  const wrath = P.elder || { frames: 0, power: 666 };
  const dE = split(wrath.frames);
  const pE = wrath.power;
  const dL = split((P.clot || { frames: 0 }).frames);
  const pL = P.clot ? P.clot.power : 0.5;
  const cursed = P.cursed || { frames: 0, power: 0 };
  const dX = split(cursed.frames);
  const pows = P.special.powers;
  const nB = pows.length;
  const kTop = Math.min(kMax, nB);
  const EB = subsetAverages(pows, kTop);
  const SUB = subsetProducts(pows, kTop);
  const bank = P.bank;
  const chainStep = Math.max(1, Math.round(91 / grid)); // a chain's next cookie: 91 frames on (rounded to the grid)

  const keyOf = (s) => String.fromCharCode.apply(null, s);
  // the CpS multiplier at `at` steps on, but for the building specials (EB / SUB average them)
  const flatMult = (s, at) => (s[X_] > at ? 0 : (s[F_] > at ? pF : 1) * (s[H_] > at ? pH : 1) * (s[E_] > at ? pE : 1) * (s[L_] > at ? pL : 1));
  const specialsAt = (s, at) => {
    let k = 0;
    for (let i = B0; i < s.length; i++) if (s[i] > at) k++;
    return k;
  };
  // cookies a second at `at` steps on: { cps, clicks, storm }, and the mix's key (for shares)
  const rateAt = (s, at) => {
    const k = specialsAt(s, at);
    const m = flatMult(s, at) * EB[k];
    const cps = P.cps0 * m;
    // with Cursed finger on, clicks are worth what the spell set (credited when it came): none here
    const clicks = s[X_] > at ? 0 : P.clicks * P.click0 * (1 - P.cpsShare + P.cpsShare * m) * (s[C_] > at ? pC : 1) * (s[D_] > at ? pD : 1);
    const storm = s[S_] > at ? 0.5 * fps * 240 * P.luckyMult * cps : 0; // a drop each other frame, 1–7 minutes of CpS
    return { cps, clicks, storm, k };
  };
  const comboKey = (s, at, k) => `${+(s[F_] > at)} ${+(s[H_] > at)} ${k} ${+(s[C_] > at)} ${+(s[D_] > at)} ${+(s[S_] > at)}${s[E_] > at || s[L_] > at || s[X_] > at ? ` ${+(s[E_] > at)}${+(s[L_] > at)}${+(s[X_] > at)}` : ''}`;
  // the stretches of a state's future with the same buffs on: [{ from, to, rate, combo }]
  const stretches = (s) => {
    const cuts = new Set([0]);
    for (let i = 1; i < s.length; i++) if (s[i] > 0) cuts.add(s[i]);
    const xs = [...cuts].sort((a, b) => a - b);
    const out = [];
    for (let j = 0; j < xs.length; j++) {
      const at = xs[j];
      const r = rateAt(s, at);
      out.push({ from: at, to: j + 1 < xs.length ? xs[j + 1] : Infinity, rate: r, combo: shares ? comboKey(s, at, r.k) : '' });
    }
    return out;
  };
  const after = (s, t) => {
    const n = [s[0]];
    for (let i = 1; i < B0; i++) n.push(Math.max(0, s[i] - t));
    for (let i = B0; i < s.length; i++) if (s[i] > t) n.push(s[i] - t);
    return n;
  };
  // cookies earned over the next t steps, by part
  const earnOver = (st, t, into, w) => {
    let left = t;
    for (const x of st) {
      if (left <= 0) break;
      const len = Math.min(x.to, t) - x.from;
      if (len <= 0) continue;
      const secs = len * unit * w;
      into.cps += x.rate.cps * secs;
      into.clicks += x.rate.clicks * secs;
      into.storm += x.rate.storm * secs;
      left = t - x.to;
    }
  };

  const odds = new Map();
  const oddsFor = (last, flying) => {
    const k = last * 2 + flying;
    if (!odds.has(k)) odds.set(k, choiceOdds(P, LASTS[last], flying));
    return odds.get(k);
  };

  // what `secs` seconds of the CpS now are worth, capped at `share` of the bank (Lucky's and Conjure
  // Baked Goods' rule), the building specials' boost averaged over which ones they are
  const ofCps = (s, secs, share) => meanMin(SUB[s.length - B0], share * bank, secs * P.cps0 * flatMult(s, 0));
  const lucky = (s) => P.luckyMult * ofCps(s, 900, 0.15) + 13;

  // a chain from this state: [{ steps, p, value }] (value: cookies, given that many steps)
  const chains = new Map();
  const c0 = Number.isFinite(bank) ? 1 + Math.max(0, Math.ceil(Math.log10(bank)) - 10) : 400; // a chain's first digits
  let chainSpan = null; // the most cookies a chain can run to: past that, a buff's time left doesn't matter
  const chainOutcomes = (s) => {
    if (chainSpan === null) {
      // the most CpS there can be makes the longest chain (the cap only grows with CpS)
      const top = [...pows].sort((a, b) => b - a).slice(0, kTop);
      const cap = Math.min(P.cps0 * pF * pH * pE * top.reduce((a, b) => a * b, 1) * 21600, bank * 0.5) * P.luckyMult;
      let steps = 1;
      for (let c = c0; Math.max(7, Math.min(Math.floor((1 / 9) * Math.pow(10, c + 1) * 7 * P.luckyMult), cap)) < cap && steps < 400; c++) steps++;
      chainSpan = steps + 1;
    }
    // a buff matters to a chain only by the step it runs out on
    const at = (x) => Math.min(Math.ceil(x / chainStep), chainSpan);
    const key = `${at(s[F_])},${at(s[H_])},${s[S_] > 0 ? 1 : 0},${at(s[E_])},${at(s[L_])},${at(s[X_])},${s.slice(B0).map(at).join(',')}`;
    if (chains.has(key)) return chains.get(key);
    const rems = s.slice(B0);
    const k = rems.length;
    const byL = new Map();
    const run = (powsOf, weight) => {
      let alive = weight;
      let value = 0;
      for (let j = 1, c = c0; j <= 400; j++, c++) {
        const at = (j - 1) * chainStep;
        let m = flatMult(s, at);
        m *= powsOf(at);
        const cpsB = P.cps0 * m;
        const cap = Math.min(cpsB * 21600, bank * 0.5) * P.luckyMult;
        const pay = (cc) => Math.max(7, Math.min(Math.floor((1 / 9) * Math.pow(10, cc) * 7 * P.luckyMult), cap));
        value += pay(c);
        const forced = pay(c + 1) >= cap || s[S_] > 0; // capped, or a storm drop breaks it
        const pEnd = forced ? 1 : 0.01;
        const e = byL.get(j) || { p: 0, v: 0 };
        e.p += alive * pEnd;
        e.v += alive * pEnd * value;
        byL.set(j, e);
        alive *= 1 - pEnd;
        if (alive < 1e-15 * weight) break;
      }
    };
    if (k === 0) run(() => 1, 1);
    else if (k <= 2) {
      // which buildings: every ordered pick of distinct ones
      const w = k === 1 ? 1 / nB : 1 / (nB * (nB - 1));
      for (let a = 0; a < nB; a++) {
        if (k === 1) run((at) => (rems[0] > at ? pows[a] : 1), w);
        else
          for (let b = 0; b < nB; b++) {
            if (b === a) continue;
            run((at) => (rems[0] > at ? pows[a] : 1) * (rems[1] > at ? pows[b] : 1), w);
          }
      }
    } else
      run((at) => {
        let n = 0;
        for (const r of rems) if (r > at) n++;
        return EB[n];
      }, 1);
    const out = [...byL].map(([steps, e]) => ({ steps, p: e.p, value: e.p ? e.v / e.p : 0 }));
    chains.set(key, out);
    return out;
  };

  // one effect `choice` (picked with probability p) landing on state s: pushes { s, p, parts, secs,
  // golden, choice } for each way it goes. A golden cookie's own (popFunc), forced or not.
  const effect = (s, choice, p, out) => {
    const base = () => {
      const n = [...s];
      n[0] = lastOf(choice);
      n[J_] = 0;
      return n;
    };
    const push = (n, q, parts = null, secs = 0, golden = 1) => out.push({ s: n, p: p * q, parts, secs, golden, choice });
    const gain = (slot, d) => {
      for (const [x, q] of d) {
        const n = base();
        n[slot] += x;
        push(n, q);
      }
    };
    switch (choice) {
      case 'frenzy':
        return gain(F_, dF);
      case 'dragon harvest':
        return gain(H_, dH);
      case 'click frenzy':
        return gain(C_, dC);
      case 'cookie storm':
        return gain(S_, dS);
      case 'blood frenzy':
        return gain(E_, dE);
      case 'clot':
        return gain(L_, dL);
      case 'cursed finger': {
        // CpS stops; each click is worth the CpS then times the buff's seconds, all its clicks credited now
        const secs = cursed.frames / fps;
        const value = P.clicks * secs * cursed.power * P.cps0 * flatMult(s, 0) * EB[specialsAt(s, 0)];
        for (const [x, q] of dX) {
          const n = base();
          n[X_] += x;
          push(n, q, { ...zero, clicks: value });
        }
        return;
      }
      case 'dragonflight':
        for (const [x, q] of dD) {
          const n = base();
          n[D_] += x;
          push(n, 0.2 * q);
          const m = [...n];
          m[C_] = 0; // 80%: Click frenzy ends
          push(m, 0.8 * q);
        }
        return;
      case 'multiply cookies':
        return push(base(), 1, { ...zero, lucky: lucky(s) });
      case 'cookie storm drop':
        // 1–7 minutes of CpS, 4 on average
        return push(base(), 1, { ...zero, storm: 240 * P.luckyMult * P.cps0 * flatMult(s, 0) * EB[specialsAt(s, 0)] });
      case 'building special': {
        const n0 = base();
        if (!nB) {
          for (const [x, q] of dF) push([...n0.slice(0, F_), n0[F_] + x, ...n0.slice(F_ + 1)], q); // no building with 10: a Frenzy instead
          return;
        }
        const rems = n0.slice(B0);
        const k = rems.length;
        const fresh = k >= kTop ? 0 : (nB - k) / nB;
        for (const [x, q] of dB) {
          for (let i = 0; i < k; i++) {
            const r = [...rems];
            r[i] += x;
            r.sort((u, v) => v - u);
            push([...n0.slice(0, B0), ...r], (q * (1 - fresh)) / k);
          }
          if (fresh > 0) push([...n0.slice(0, B0), ...[...rems, x].sort((u, v) => v - u)], q * fresh);
        }
        return;
      }
      case 'chain cookie': {
        const st = stretches(s);
        for (const o of chainOutcomes(s)) {
          const t = (o.steps - 1) * chainStep;
          const parts = { ...zero, chain: o.value };
          earnOver(st, t, parts, 1);
          const n = after(s, t);
          n[0] = LAST['chain cookie'];
          push(n, o.p, parts, t * unit, o.steps);
        }
        return;
      }
      default:
        push(base(), 1); // nothing that pays: everything must go, a sugar lump, a blab, ruin (the bank is held)
    }
  };

  // one golden cookie clicked in state s: [{ s, p, parts, secs, golden, choice }]
  const popOnce = (s) => {
    const out = [];
    for (const [choice, p] of oddsFor(s[0], s[D_] > 0 ? 1 : 0)) effect(s, choice, p, out);
    return out;
  };

  // a click: where it leads ({ posts, extras: [{ s, p }] }, extras: the 1% when a second golden
  // cookie came with it, clicked next, in its own pre state) and what it pays (weighed by p)
  const transitions = (s, extra) => {
    const outs = popOnce(s);
    const res = { posts: new Map(), extras: new Map(), parts: { ...zero }, secs: 0, golden: 0, effects: {} };
    const add = (m, n, p) => {
      const k = keyOf(n);
      const e = m.get(k);
      if (e) e.p += p;
      else m.set(k, { s: n, p });
    };
    for (const o of outs) {
      let p = o.p;
      if (extra && P.pExtra > 0 && o.choice !== 'chain cookie') {
        add(res.extras, o.s, p * P.pExtra);
        p *= 1 - P.pExtra;
      }
      // with a storm still running, its drops make the last effect "cookie storm drop"
      const n = o.s[S_] > 0 ? [lastOf('cookie storm drop'), ...o.s.slice(1)] : o.s;
      add(res.posts, n, p);
      if (o.parts) for (const x in o.parts) res.parts[x] += o.p * o.parts[x];
      res.secs += o.p * o.secs;
      res.golden += o.p * o.golden;
      res.effects[o.choice] = (res.effects[o.choice] || 0) + o.p * (o.choice === 'chain cookie' ? o.golden : 1);
    }
    res.posts = [...res.posts.values()];
    res.extras = [...res.extras.values()];
    return res;
  };

  // what a state earns, on average, over the next `span` frames or until the next golden cookie,
  // whichever comes first — the timer having run `age` frames already, its survival P(T > u) summing
  // to CS[u] (frames on this grid; CS stops at `top`) — weighed by w, added to acc ([cps, clicks,
  // lucky, chain, storm, spell]); returns the seconds it lasts on average (unweighed). Stretches'
  // sums without their objects, for the walk's hot loop.
  const cuts = new Float64Array(32);
  const waitEarn = (s, CS, top, w, acc, combos, age = 0, span = Infinity) => {
    let n = 0;
    for (let i = 1; i < s.length; i++) {
      const v = s[i];
      if (v <= 0) continue;
      let j = n++;
      while (j > 0 && cuts[j - 1] > v) {
        cuts[j] = cuts[j - 1];
        j--;
      }
      cuts[j] = v;
    }
    const norm = age > 0 ? CS[age + 1] - CS[age] : 1; // P(T > age): what's left of the wait
    const end = Math.min(top, age + span);
    let from = 0;
    for (let j = 0; j <= n; j++) {
      const to = j < n ? cuts[j] : Infinity;
      if (to <= from) continue;
      const a = age + from;
      const b = Math.min(age + to, end);
      if (b > a) {
        const secs = ((CS[b] - CS[a]) / norm / fps) * w * grid;
        const k = specialsAt(s, from);
        const m = flatMult(s, from) * EB[k];
        const cps = P.cps0 * m;
        acc[0] += cps * secs;
        if (!(s[X_] > from)) acc[1] += P.clicks * P.click0 * (1 - P.cpsShare + P.cpsShare * m) * (s[C_] > from ? pC : 1) * (s[D_] > from ? pD : 1) * secs;
        if (s[S_] > from) acc[4] += 0.5 * fps * 240 * P.luckyMult * cps * secs;
        if (combos) {
          const key = comboKey(s, from, k);
          combos.set(key, (combos.get(key) || 0) + secs);
        }
      }
      if (age + to >= end) break;
      from = to;
    }
    return ((CS[end] - CS[Math.min(age, top)]) / norm / fps) * grid;
  };

  // ---- spells (models/grimoire.mjs plans them) --------------------------------------------------
  const G = P.grimoire;
  const fthofOdds = new Map();
  // Force the Hand of Fate's golden cookie: [[choice, p]], as its win() builds the list (forced: the
  // last effect doesn't count); its backfire's wrath cookie, as fail() does
  const fthofWin = (flying) => {
    if (fthofOdds.has(flying)) return fthofOdds.get(flying);
    const out = new Map();
    const add = (c, p) => out.set(c, (out.get(c) || 0) + p);
    const pB = P.pBuilding > 0 ? 0.25 : 0;
    for (const [storm, ps] of [[1, 0.1], [0, 0.9]])
      for (const [bs, pb] of [[1, pB], [0, 1 - pB]])
        for (const [drop, pd] of [[1, 0.15], [0, 0.85]])
          for (const [lump, pl] of [[1, 0.0001], [0, 0.9999]]) {
            const q = ps * pb * pd * pl;
            if (!q) continue;
            let l = ['frenzy', 'multiply cookies'];
            if (!flying) l.push('click frenzy');
            if (storm) l.push('cookie storm', 'cookie storm', 'blab');
            if (bs) l.push('building special');
            if (drop) l = ['cookie storm drop'];
            if (lump) l.push('free sugar lump');
            for (const c of l) add(c, q / l.length);
          }
    const r = [...out];
    fthofOdds.set(flying, r);
    return r;
  };
  const fthofFail = (() => {
    const out = new Map();
    const add = (c, p) => out.set(c, (out.get(c) || 0) + p);
    for (const [more, pm] of [[1, 0.1], [0, 0.9]])
      for (const [lump, pl] of [[1, 0.003], [0, 0.997]])
        for (const [blab, pb] of [[1, 0.1], [0, 0.9]]) {
          let l = ['clot', 'ruin cookies'];
          if (more) l.push('cursed finger', 'blood frenzy');
          if (lump) l.push('free sugar lump');
          if (blab) l = ['blab'];
          for (const c of l) add(c, (pm * pl * pb) / l.length);
        }
    return [...out];
  })();
  const failChance = (s) => Math.min(1, G.fail * (s[A_] > 0 ? 0.1 : 1) * (s[I_] > 0 ? 5 : 1));
  const CLOT_SPELL = split(60 * 15 * fps); // Conjure Baked Goods' backfire: a 15-minute clot (its fail())
  /**
   * A spell cast in state s: [{ s, p, parts, secs, golden, choice }] (choice: the golden cookie's effect
   * for Force the Hand of Fate, else the spell's id and whether it worked). Magic is the caller's.
   */
  const castOnce = (s, spell) => {
    const out = [];
    const fail = failChance(s);
    const base = () => {
      const n = [...s];
      n[J_] = 0;
      return n;
    };
    switch (spell) {
      case 'fthof': {
        for (const [c, p] of fthofWin(s[D_] > 0 ? 1 : 0)) effect(s, c, (1 - fail) * p, out);
        for (const [c, p] of fthofFail) effect(s, c, fail * p, out);
        for (const o of out) o.s[J_] = 1; // just cast: what a plan does next
        return out;
      }
      case 'stretch': {
        // every buff +10% of its full time (up to 5 minutes); backfired, −20% of what's left (up to 10)
        const full = [0, dF, dH, dC, dD, dS, dE, dL, dX, [[300 * fps, 1]], [[600 * fps, 1]]].map((d) => (d ? d.reduce((a, [x, q]) => a + x * q, 0) : 0));
        const win = base();
        const lose = base();
        for (let i = 1; i < s.length; i++) {
          if (i === J_ || !(s[i] > 0)) continue;
          const whole = Math.max(s[i], i >= B0 ? P.special.frames / grid : full[i]);
          win[i] = s[i] + Math.round(Math.min((300 * fps) / grid, whole * 0.1));
          lose[i] = Math.max(0, s[i] - Math.round(Math.min((600 * fps) / grid, s[i] * 0.2)));
        }
        out.push({ s: win, p: 1 - fail, parts: null, secs: 0, golden: 0, choice: 'stretch' }, { s: lose, p: fail, parts: null, secs: 0, golden: 0, choice: 'stretch backfired' });
        return out;
      }
      case 'adept': {
        const win = base();
        win[A_] = (300 * fps) / grid;
        win[I_] = 0;
        win[J_] = 2; // just worked: the plan's Force the Hand of Fate comes next
        const lose = base();
        lose[I_] = (600 * fps) / grid;
        lose[A_] = 0;
        out.push({ s: win, p: 1 - fail, parts: null, secs: 0, golden: 0, choice: 'adept' }, { s: lose, p: fail, parts: null, secs: 0, golden: 0, choice: 'adept backfired' });
        return out;
      }
      case 'conjure': {
        // half an hour of CpS (the CpS then), capped at 15% of the bank; backfired, a 15-minute clot
        // and cookies lost from the bank (it's held, and the cookies baked don't change)
        out.push({ s: base(), p: 1 - fail, parts: { ...zero, spell: Math.max(7, ofCps(s, 1800, 0.15)) }, secs: 0, golden: 0, choice: 'conjure' });
        for (const [x, q] of CLOT_SPELL) {
          const n = base();
          n[L_] += x;
          out.push({ s: n, p: fail * q, parts: null, secs: 0, golden: 0, choice: 'conjure backfired' });
        }
        return out;
      }
      default:
        throw new Error(`no spell "${spell}"`);
    }
  };
  return { fps, unit, zero, keyOf, rateAt, stretches, after, earnOver, popOnce, castOnce, transitions, lastOf, waitEarn };
}

/**
 * The income for a game's parameters (goldenParams), solved exactly on a time grid of `grid` frames:
 * the chain's stationary distribution by power iteration. { mult (income ÷ (base × time)), parts ({
 * cps, clicks, lucky, chain, storm } ÷ base × time), golden (golden cookies an hour, chain cookies
 * included), effects ({ choice: an hour }), shares (with `shares`: the share of time each mix of
 * buffs runs, by key "F H B C D S"), iterations, states }. Its states multiply with the frequency
 * (buffs overlap more): fine at +0%, out of reach by +100% — expectedIncome is the one that scales.
 */
export function exactIncome(P, { grid = 150, tol = 1e-8, maxIter = 1000, prune = 1e-12, kMax = 4, shares = false } = {}) {
  if (!P.golden) return noGolden(P);
  const { unit, keyOf, stretches, after, transitions } = machinery(P, { grid, kMax, shares });
  // time to the next golden cookie, in grid steps (each frame's chance split between its two neighbors)
  const S = survivalTable(P.minTime, P.maxTime);
  const tq = new Map();
  for (let k = 1; k < S.length; k++) {
    const q = S[k - 1] - S[k];
    if (q <= 0) continue;
    const x = k / grid;
    const lo = Math.floor(x);
    const fr = x - lo;
    tq.set(lo, (tq.get(lo) || 0) + q * (1 - fr));
    if (fr > 0) tq.set(lo + 1, (tq.get(lo + 1) || 0) + q * fr);
  }
  const tVals = [...tq.keys()].sort((a, b) => a - b);
  const tProb = tVals.map((t) => tq.get(t));
  const tSum = tProb.reduce((a, b) => a + b, 0);
  for (let i = 0; i < tProb.length; i++) tProb[i] /= tSum;
  // tails: Σ q and Σ q·t from index i on
  const tailQ = new Float64Array(tVals.length + 1);
  const tailQT = new Float64Array(tVals.length + 1);
  for (let i = tVals.length - 1; i >= 0; i--) {
    tailQ[i] = tailQ[i + 1] + tProb[i];
    tailQT[i] = tailQT[i + 1] + tProb[i] * tVals[i];
  }
  const meanT = tailQT[0];

  // The chain, indexed as it's found: states right after a click ("post") lead, by the wait, to
  // states right before the next ("pre"), which lead, by the click, to posts again. Each state's
  // edges and rewards are worked out once, the first time it has any weight; then each round of the
  // power iteration is two sparse sweeps.
  const posts = [];
  const postAt = new Map();
  const pres = [];
  const preAt = new Map();
  const xpres = []; // pre states of a second golden cookie, popped right after the first
  const xpreAt = new Map();
  const postId = (s) => {
    const k = keyOf(s);
    let i = postAt.get(k);
    if (i === undefined) {
      i = posts.length;
      posts.push({ s, built: false });
      postAt.set(k, i);
    }
    return i;
  };
  const preId = (s) => {
    const k = keyOf(s);
    let i = preAt.get(k);
    if (i === undefined) {
      i = pres.length;
      pres.push({ s, built: false });
      preAt.set(k, i);
    }
    return i;
  };
  const xpreId = (s) => {
    const k = keyOf(s);
    let i = xpreAt.get(k);
    if (i === undefined) {
      i = xpres.length;
      xpres.push({ s, built: false, extra: true });
      xpreAt.set(k, i);
    }
    return i;
  };
  const buildPost = (node) => {
    const s = node.s;
    const st = stretches(s);
    const maxRem = st[st.length - 1].from;
    const to = [];
    const q = [];
    const earned = { cps: 0, clicks: 0, storm: 0 };
    let j = 0;
    let I = { cps: 0, clicks: 0, storm: 0 }; // earned up to st[j].from
    const at = (t) => {
      while (st[j].to <= t) {
        const len = (st[j].to - st[j].from) * unit;
        I = { cps: I.cps + st[j].rate.cps * len, clicks: I.clicks + st[j].rate.clicks * len, storm: I.storm + st[j].rate.storm * len };
        j++;
      }
      const len = (t - st[j].from) * unit;
      return { cps: I.cps + st[j].rate.cps * len, clicks: I.clicks + st[j].rate.clicks * len, storm: I.storm + st[j].rate.storm * len };
    };
    let i = 0;
    for (; i < tVals.length && tVals[i] < maxRem; i++) {
      const t = tVals[i];
      const e = at(t);
      for (const k in earned) earned[k] += tProb[i] * e[k];
      to.push(preId(after(s, t)));
      q.push(tProb[i]);
    }
    if (i < tVals.length) {
      // the rest of the waits: everything has run out by then
      const e = at(maxRem);
      const r = st[st.length - 1].rate;
      const extra = (tailQT[i] - tailQ[i] * maxRem) * unit;
      for (const k in earned) earned[k] += tailQ[i] * e[k] + r[k] * extra;
      to.push(preId(fresh(s[0])));
      q.push(tailQ[i]);
    }
    node.to = Int32Array.from(to);
    node.q = Float64Array.from(q);
    node.earned = earned;
    if (shares) {
      // time in each mix of buffs: Σ over stretches of E[the wait's overlap with it]
      node.combos = [];
      for (const x of st) {
        let w = 0;
        for (let i2 = 0; i2 < tVals.length; i2++) {
          const t = tVals[i2];
          if (t > x.from) w += tProb[i2] * (Math.min(t, x.to) - x.from);
        }
        if (w > 0) node.combos.push([x.combo, w * unit]);
      }
    }
    node.built = true;
  };
  const buildPre = (node) => {
    const tr = transitions(node.s, !node.extra);
    node.to = Int32Array.from(tr.posts.map((o) => postId(o.s)));
    node.p = Float64Array.from(tr.posts.map((o) => o.p));
    node.xto = Int32Array.from(tr.extras.map((o) => xpreId(o.s)));
    node.xp = Float64Array.from(tr.extras.map((o) => o.p));
    node.parts = Float64Array.from(PARTS.map((k) => tr.parts[k]));
    node.secs = tr.secs;
    node.golden = tr.golden;
    node.effects = Float64Array.from(CHOICES.map((c) => tr.effects[c] || 0));
    if (shares && tr.secs > 0) node.combo = stretches(node.s)[0].combo; // a chain's seconds, with the state it started from
    node.built = true;
  };

  let mass = [1];
  postId(fresh());
  let prev = NaN;
  let calm = 0;
  let result = null;
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const partsA = new Float64Array(PARTS.length);
    const effectsA = new Float64Array(CHOICES.length);
    let secs = 0;
    let golden = 0;
    const combos = shares ? new Map() : null;
    const preMass = new Float64Array(pres.length + 64);
    let preMassArr = preMass;
    const addPre = (k, m) => {
      if (k >= preMassArr.length) {
        const grown = new Float64Array(Math.max(k + 1, preMassArr.length * 2));
        grown.set(preMassArr);
        preMassArr = grown;
      }
      preMassArr[k] += m;
    };
    const nPost = mass.length;
    for (let i = 0; i < nPost; i++) {
      const m = mass[i];
      if (!m) continue;
      const node = posts[i];
      if (!node.built) buildPost(node);
      secs += m * meanT * unit;
      partsA[0] += m * node.earned.cps;
      partsA[1] += m * node.earned.clicks;
      partsA[4] += m * node.earned.storm;
      const { to, q } = node;
      for (let e = 0; e < to.length; e++) addPre(to[e], m * q[e]);
      if (combos) for (const [k, w] of node.combos) combos.set(k, (combos.get(k) || 0) + m * w);
    }
    const next = new Float64Array(posts.length + 1024);
    let nextArr = next;
    const addPost = (k, m) => {
      if (k >= nextArr.length) {
        const grown = new Float64Array(Math.max(k + 1, nextArr.length * 2));
        grown.set(nextArr);
        nextArr = grown;
      }
      nextArr[k] += m;
    };
    const xMass = new Float64Array(xpres.length + 1024);
    let xArr = xMass;
    const addX = (k, m) => {
      if (k >= xArr.length) {
        const grown = new Float64Array(Math.max(k + 1, xArr.length * 2));
        grown.set(xArr);
        xArr = grown;
      }
      xArr[k] += m;
    };
    const sweep = (list, massOf) => {
      const n = list.length;
      for (let j = 0; j < n; j++) {
        const m = massOf(j);
        if (!m) continue;
        const node = list[j];
        if (!node.built) buildPre(node);
        const np = node.parts;
        for (let k = 0; k < np.length; k++) partsA[k] += m * np[k];
        secs += m * node.secs;
        if (!node.extra) golden += m * node.golden; // golden cookies the timer spawned (as goldenIncome counts them)
        const ne = node.effects;
        for (let k = 0; k < ne.length; k++) if (ne[k]) effectsA[k] += m * ne[k];
        if (combos && node.combo) combos.set(node.combo, (combos.get(node.combo) || 0) + m * node.secs);
        const { to, p, xto, xp } = node;
        for (let e = 0; e < to.length; e++) addPost(to[e], m * p[e]);
        for (let e = 0; e < xto.length; e++) addX(xto[e], m * xp[e]);
      }
    };
    sweep(pres, (j) => (j < preMassArr.length ? preMassArr[j] : 0));
    sweep(xpres, (j) => (j < xArr.length ? xArr[j] : 0));
    // drop what's vanishingly unlikely, keep the total at 1
    let tot = 0;
    const n = Math.min(nextArr.length, posts.length);
    mass = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = nextArr[i];
      if (v >= prune) {
        mass[i] = v;
        tot += v;
      }
    }
    for (let i = 0; i < n; i++) mass[i] /= tot;
    const parts = Object.fromEntries(PARTS.map((k, i) => [k, partsA[i]]));
    const effects = Object.fromEntries(CHOICES.map((c, i) => [c, effectsA[i]]).filter(([, v]) => v > 0));
    const total = partsA.reduce((a, b) => a + b, 0);
    const mult = total / (P.base * secs);
    result = { mult, parts, secs, golden, effects, combos };
    if (Math.abs(mult - prev) <= tol * mult) {
      if (++calm >= 3) break;
    } else calm = 0;
    prev = mult;
  }
  let live = 0;
  for (let i = 0; i < mass.length; i++) if (mass[i]) live++;
  const dist = { size: live };
  const { mult, parts, secs, golden, effects, combos } = result;
  const perHour = 3600 / secs;
  const out = {
    mult,
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v / (P.base * secs)])),
    golden: golden * perHour,
    effects: Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, v * perHour])),
    iterations: iter + 1,
    states: dist.size,
  };
  if (combos) out.shares = Object.fromEntries([...combos].map(([k, v]) => [k, v / secs]).sort((a, b) => b[1] - a[1]));
  return out;
}

/**
 * The income for a game's parameters (goldenParams), on exact frames, by walking the chain: each
 * click's state is drawn as the game would come to it, but what it's worth is its expectation — every
 * effect it could pick (with the 1% second cookie), each one's payout and what CpS, clicks and storm
 * drops earn until the next golden cookie, averaged over the wait's exact distribution. So the rare
 * stacks (a Click frenzy or Dragonflight landing on Frenzy, Dragon Harvest and building specials)
 * are counted at their odds every time their makings come up, instead of the few times the dice
 * land on them: the noise left is the states' own, a few tenths of a percent over `pops` clicks.
 * Same answer as exactIncome where both run. { mult, se (its standard error, from batches), parts,
 * golden, effects, shares (with `shares`), pops }. `probe(state, outcomes, weight)` sees every click.
 * `timer(seconds)` → { minTime, maxTime, weight }: a frequency that changes over game time (the
 * timer as the game would set it then, and a factor on what's earned, such as a garden's CpS cost).
 *
 * `plan` (models/grimoire.mjs makePlan): spells cast as the plan says, magic refilling as the game
 * refills it. The walk then goes event to event — a golden cookie, or a spell when the plan's moment
 * comes first (the timer keeps running through a spell; a spell's golden cookie doesn't reset it) —
 * and each event is credited its expectation the same way, every outcome with what it earns until the
 * next event. The result also has `casts` ({ spell: an hour }) and `spells` ({ "spell:effect": an
 * hour }, and "why:<combo>" for what each Force the Hand of Fate was cast on).
 */
export function expectedIncome(P, { pops = 1000000, seed = 1, batches = 40, warmup = 2000, kMax = 4, shares = false, probe = null, timer = null, plan = null, follow = 120 } = {}) {
  const HORIZON = follow;
  if (!P.golden && !plan) return { ...noGolden(P), se: 0, pops: 0 };
  if (plan && !P.grimoire) throw new Error('a spell plan needs the Grimoire (a Wizard tower with its minigame)');
  const { fps, keyOf, stretches, after, popOnce, castOnce, lastOf: lastFor, waitEarn } = machinery(P, { grid: 1, kMax, shares });
  const rnd = makeRng(seed * 7919 + 17);
  // the wait: P(T > u) frame by frame, and its running sum (what a rate earns, on average, before the next one)
  const tables = new Map();
  const table = (min, max) => {
    const key = `${min},${max}`;
    let t = tables.get(key);
    if (!t) {
      const S = survivalTable(min, max);
      const CS = new Float64Array(S.length + 1);
      for (let u = 0; u < S.length; u++) CS[u + 1] = CS[u] + S[u];
      t = { min, max, CS, top: S.length, meanT: CS[S.length] / fps };
      tables.set(key, t);
    }
    return t;
  };
  // the timer now: fixed, or (with `timer`) set at each click from the game time then, as the game
  // sets it when a golden cookie goes; `cf` scales what's earned (a garden's CpS factor then)
  let tab = P.golden ? table(P.minTime, P.maxTime) : null;
  let cf = 1;
  let now = 0;
  const parts = new Float64Array(PARTS.length); // cps, clicks, lucky, chain, storm, spell (cookies, this batch)
  const combos = shares ? new Map() : null;
  const credit = (o, w0) => {
    if (!o.parts) return;
    const w = w0 * cf;
    for (let i = 0; i < PARTS.length; i++) parts[i] += w * (o.parts[PARTS[i]] || 0);
  };
  // with a storm still running, its drops make the last effect "cookie storm drop"
  const settle = (n) => (n[S_] > 0 ? [lastFor('cookie storm drop'), ...n.slice(1)] : n);
  const pick = (outs) => {
    let u = rnd();
    for (const o of outs) if ((u -= o.p) < 0) return o;
    return outs[outs.length - 1];
  };
  const effects = new Map();
  const count = (choice, n) => effects.set(choice, (effects.get(choice) || 0) + n);
  const spells = new Map();
  const tally = (k, n) => spells.set(k, (spells.get(k) || 0) + n);
  let secs = 0;
  let golden = 0;

  // ---- magic: the game's refill (P.grimoire.regen: magic after k frames from empty) ----
  const R = plan ? P.grimoire.regen : null;
  const top = R ? R.length - 1 : 0;
  const posOf = (m) => {
    if (m >= R[top]) return top;
    let lo = 0;
    let hi = top;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (R[mid] <= m) lo = mid;
      else hi = mid;
    }
    return lo + (m - R[lo]) / (R[hi] - R[lo]);
  };
  const magicAt = (pos) => {
    if (pos >= top) return R[top];
    const k = Math.floor(pos);
    return R[k] + (R[k + 1] - R[k]) * (pos - k);
  };
  const magicAfter = (m, frames) => (frames > 0 ? magicAt(posOf(m) + frames) : m);
  // the plan's next spell from (s, magic m, the timer `age` frames on): { u (frames on), spell, why } or null
  const nextCast = (s, m, age) => {
    if (!plan) return null;
    const horizon = tab ? tab.top - age : Infinity;
    const p0 = posOf(m);
    // nothing casts below the lowest level a rule waits for: start there
    const u0 = m >= plan.levels[0] ? 0 : Math.ceil(posOf(plan.levels[0]) - p0 - 1e-9);
    if (u0 >= horizon) return null;
    const us = [u0];
    for (const L of plan.levels) if (L > m) us.push(Math.ceil(posOf(L) - p0 - 1e-9));
    for (let i = 1; i < s.length; i++) if (s[i] > u0) us.push(s[i]);
    us.sort((a, b) => a - b);
    let last = -1;
    for (const u of us) {
      if (u === last || u < u0) continue;
      if (u >= horizon) break;
      last = u;
      const d = plan.decide(s, u ? magicAt(p0 + u) : m, u);
      if (d) return { u, ...d };
    }
    return null;
  };
  // what a state just after an event earns until the next one, weighed by w (its seconds counted)
  const interval = (s, m, age, w) => {
    if (!tab) {
      // no golden cookies: spells only, and the time to the next one
      const nc = nextCast(s, m, age);
      const span = nc ? Math.max(1, nc.u) : 3600 * fps;
      const acc = new Float64Array(PARTS.length);
      const st = stretches(s);
      const into = { cps: 0, clicks: 0, storm: 0 };
      // earnOver isn't exported; a plain sum over the stretches
      let left = span;
      for (const x of st) {
        if (left <= 0) break;
        const len = Math.min(x.to, span) - x.from;
        if (len <= 0) continue;
        into.cps += (x.rate.cps * len) / fps;
        into.clicks += (x.rate.clicks * len) / fps;
        into.storm += (x.rate.storm * len) / fps;
        left = span - x.to;
      }
      acc[0] = into.cps;
      acc[1] = into.clicks;
      acc[4] = into.storm;
      for (let i = 0; i < PARTS.length; i++) parts[i] += w * cf * acc[i];
      secs += (w * span) / fps;
      return;
    }
    const nc = nextCast(s, m, age);
    const t = waitEarn(s, tab.CS, tab.top, w * cf, parts, combos, age, nc ? nc.u : Infinity);
    if (plan) secs += w * t;
  };

  // the next event from a state just after one: the plan's spell, or the next golden cookie,
  // whichever comes first (drawn) — the state before it ({ s, m, age, kind, why })
  const next = (s1, mPost, age) => {
    const nc = plan ? nextCast(s1, mPost, age) : null;
    const T = tab ? spawnFrame(tab.min, tab.max, age, rnd()) : Infinity;
    if (nc && age + nc.u < T) {
      now += nc.u / fps;
      return { s: after(s1, nc.u), m: magicAfter(mPost, nc.u), age: age + nc.u, kind: nc.spell, why: nc.why };
    }
    if (!tab) throw new Error('nothing happens: no golden cookies and no spell to cast');
    const wait = T - age;
    now += wait / fps;
    return { s: after(s1, wait), m: plan ? magicAfter(mPost, wait) : 0, age: T, kind: 'gold' };
  };
  // one event from the state before it, its sums weighed by w: the state before the next. `branch`: a
  // spell's outcomes each followed on their own while what they bring lasts (below)
  const step = ({ s, m, age, kind, why }, w = 1, branch = true) => {
    let post;
    let mPost = m;
    if (kind === 'gold') {
      // a golden cookie, every way it can go
      if (timer) {
        const tm = timer(now);
        tab = table(tm.minTime, tm.maxTime);
        cf = tm.weight == null ? 1 : tm.weight;
      }
      const outs = popOnce(s);
      if (probe) probe(s, outs, w);
      if (!plan) secs += w * tab.meanT;
      for (const o of outs) {
        const second = P.pExtra > 0 && o.choice !== 'chain cookie' ? P.pExtra : 0;
        const q = w * o.p;
        credit(o, q);
        interval(settle(o.s), plan ? magicAfter(m, o.secs * fps) : 0, 0, q * (1 - second));
        secs += q * o.secs;
        golden += q * o.golden;
        count(o.choice, q * (o.choice === 'chain cookie' ? o.golden : 1));
        if (combos && o.secs) {
          const k = stretches(s)[0].combo;
          combos.set(k, (combos.get(k) || 0) + q * o.secs);
        }
      }
      // the way it went
      const lead = pick(outs);
      post = lead.s;
      if (P.pExtra > 0 && lead.choice !== 'chain cookie') {
        // the second golden cookie, 1% of the time: its expectation from the lead drawn (an unbiased share)
        const outs2 = popOnce(lead.s);
        for (const o of outs2) {
          const q = w * P.pExtra * o.p;
          credit(o, q);
          interval(settle(o.s), plan ? magicAfter(m, (lead.secs + o.secs) * fps) : 0, 0, q);
          secs += q * o.secs;
          count(o.choice, q * (o.choice === 'chain cookie' ? o.golden : 1));
        }
        if (rnd() < P.pExtra) post = pick(outs2).s;
      }
      now += lead.secs;
      if (plan) mPost = magicAfter(m, lead.secs * fps);
      return next(settle(post), mPost, 0);
    }
    // a spell
    const cost = plan.cost(kind);
    mPost = Math.max(0, m - cost);
    const outs = castOnce(s, kind);
    tally(`cast:${kind}`, w);
    if (why) tally(`why:${why}`, w);
    for (const o of outs) {
      credit(o, w * o.p);
      tally(`${kind}:${o.choice}`, w * o.p);
    }
    if (!branch) {
      for (const o of outs) interval(settle(o.s), mPost, age, w * o.p);
      return next(settle(pick(outs).s), mPost, age);
    }
    // Which way a spell goes matters for minutes (a Click frenzy on a combo is most of the income):
    // each distinct outcome is followed on its own, weighed by its odds, until what it brought has run
    // out (every buff then on), and the walk goes on from one of them, picked by its odds — so the
    // spell's luck is counted at its odds every time, not the few times the dice land on it.
    const groups = new Map();
    for (const o of outs) {
      const n = settle(o.s);
      const k = keyOf(n);
      const e = groups.get(k);
      if (e) e.p += o.p;
      else groups.set(k, { s: n, p: o.p });
    }
    const t0 = now;
    const tab0 = tab;
    const cf0 = cf;
    const ends = [];
    for (const gr of groups.values()) {
      // each from the cast's moment and timer (a followed frequency changes it at golden cookies)
      now = t0;
      tab = tab0;
      cf = cf0;
      // followed while what the spell changed lasts, HORIZON s at most (any horizon is unbiased: longer only
      // takes away more of the noise, for more work)
      let horizon = 0;
      for (let i = 1; i < B0; i++) if (i !== J_ && gr.s[i] !== s[i] && gr.s[i] > horizon) horizon = gr.s[i];
      if (gr.s.length !== s.length || gr.s.slice(B0).some((x, i) => x !== s[i + B0])) for (let i = B0; i < gr.s.length; i++) horizon = Math.max(horizon, gr.s[i]);
      const until = t0 + Math.min(horizon, HORIZON * fps) / fps;
      const q = w * gr.p;
      interval(gr.s, mPost, age, q);
      let at = next(gr.s, mPost, age);
      for (let k = 0; k < 64 && now < until; k++) at = step(at, q, false);
      ends.push({ p: gr.p, at, now, tab, cf });
    }
    const end = pick(ends);
    now = end.now;
    tab = end.tab;
    cf = end.cf;
    return end.at;
  };
  const batch = [];
  const close = () => {
    batch.push({ income: parts.reduce((a, b) => a + b, 0), parts: Float64Array.from(parts), secs, golden, effects: new Map(effects), spells: new Map(spells), combos: combos && new Map(combos) });
  };
  const per = Math.max(1, Math.floor(pops / batches));
  let at = { s: fresh(), m: plan ? P.grimoire.magicM : 0, age: 0, kind: tab ? 'gold' : 'conjure' };
  if (!tab) {
    const nc = nextCast(at.s, at.m, 0);
    if (!nc) return { ...noGolden(P), se: 0, pops: 0 };
    at = { ...at, kind: nc.spell, why: nc.why };
  }
  for (let n = -warmup; n < per * batches; n++) {
    if (n >= 0 && n % per === 0) {
      if (n > 0) close();
      parts.fill(0);
      secs = 0;
      golden = 0;
      effects.clear();
      spells.clear();
      if (combos) combos.clear();
    }
    at = step(at);
  }
  close();
  // the ratio of sums, and its spread over the batches
  const sum = (f) => batch.reduce((a, b) => a + f(b), 0);
  const T = sum((b) => b.secs);
  const mult = sum((b) => b.income) / (P.base * T);
  const bm = batch.map((b) => b.income / (P.base * b.secs));
  const sd = Math.sqrt(bm.reduce((a, x) => a + (x - mult) ** 2, 0) / (batch.length - 1));
  const perHour = (key) => {
    const all = new Map();
    for (const b of batch) for (const [k, v] of b[key]) all.set(k, (all.get(k) || 0) + v);
    return new Map([...all].map(([k, v]) => [k, (v * 3600) / T]));
  };
  const eff = perHour('effects');
  const out = {
    mult,
    se: sd / Math.sqrt(batch.length),
    parts: Object.fromEntries(PARTS.map((k, i) => [k, sum((b) => b.parts[i]) / (P.base * T)])),
    golden: (sum((b) => b.golden) * 3600) / T,
    effects: Object.fromEntries(ALL_CHOICES.map((c) => [c, eff.get(c) || 0]).filter(([, v]) => v > 0)),
    pops: per * batches,
  };
  if (plan) {
    const sp = perHour('spells');
    out.casts = Object.fromEntries([...sp].filter(([k]) => k.startsWith('cast:')).map(([k, v]) => [k.slice(5), v]));
    out.spells = Object.fromEntries([...sp].filter(([k]) => !k.startsWith('cast:')).sort((a, b) => b[1] - a[1]));
  }
  if (shares) {
    const all = new Map();
    for (const b of batch) for (const [k, v] of b.combos) all.set(k, (all.get(k) || 0) + v);
    out.shares = Object.fromEntries([...all].map(([k, v]) => [k, v / T]).sort((a, b) => b[1] - a[1]));
  }
  return out;
}

/**
 * The income at frequency multiplier f for a game made by goldenIncomeGame (models/goldenIncome.mjs):
 * expectedIncome (or, with method "chain", exactIncome) on the parameters read from it. opts: { bank
 * (cookies, held there; default the save's), pops, seed, grid, … }.
 */
export function expectedAt(g, f, opts = {}) {
  g.setFrequency(f);
  const { Game } = g;
  Game.killBuffs();
  Game.killShimmers();
  const P = goldenParams(Game, { clicks: g.clicks, bank: opts.bank });
  if (opts.schedule) {
    // a frequency over game time: schedule(seconds) → { f, cps }, the game's timer at each f (kept)
    const T = Game.shimmerTypes.golden;
    const at = new Map();
    const timerOf = (x) => {
      const k = Math.round(x * 1e4);
      if (!at.has(k)) {
        g.setFrequency(k / 1e4);
        at.set(k, { minTime: T.getMinTime({ wrath: 0 }), maxTime: T.getMaxTime({ wrath: 0 }) });
      }
      return at.get(k);
    };
    opts = {
      ...opts,
      timer: (secs) => {
        const x = opts.schedule(secs);
        return { ...timerOf(x.f), weight: x.cps == null ? 1 : x.cps };
      },
    };
  }
  // spells: a plan's spec (models/grimoire.mjs), the magic bar starting full
  if (opts.grimoire) opts = { ...opts, plan: makePlan(opts.grimoire, P) };
  const r = opts.method === 'chain' ? { ...exactIncome(P, opts), se: 0 } : expectedIncome(P, opts);
  return { ...r, bank: P.bank };
}
