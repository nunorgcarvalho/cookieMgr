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

// what a golden cookie can do (Elder Pledge on): the effects popFunc lists
const CHOICES = ['frenzy', 'multiply cookies', 'chain cookie', 'cookie storm', 'everything must go', 'click frenzy', 'building special', 'free sugar lump', 'dragon harvest', 'dragonflight', 'blab'];
// what the last effect can be: a storm's drops come at once and stay the last
const PARTS = ['cps', 'clicks', 'lucky', 'chain', 'storm'];
const LASTS = ['', ...CHOICES.filter((c) => c !== 'cookie storm'), 'cookie storm drop'];
const LAST = Object.fromEntries(LASTS.map((n, i) => [n, i]));
// a storm's drops and a blab are never on the list, so they bar nothing, like no last effect at all
const lastOf = (choice) => (choice === 'cookie storm' || choice === 'cookie storm drop' || choice === 'blab' ? 0 : LAST[choice]);

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
 * click's outcomes (popOnce, transitions). A state is [last, F, H, C, D, S, ...B (descending)]: the
 * last effect and the time left on Frenzy, Dragon Harvest, Click frenzy, Dragonflight, Cookie storm
 * and each building special, in grid steps.
 */
function noGolden(P) {
  const parts = { cps: P.cps0 / P.base, clicks: (P.clicks * P.click0) / P.base, lucky: 0, chain: 0, storm: 0 };
  return { mult: parts.cps + parts.clicks, parts, golden: 0, effects: {} };
}

function machinery(P, { grid = 1, kMax = 4, shares = false } = {}) {
  const fps = P.fps;
  const unit = grid / fps; // seconds per grid step
  const zero = { cps: 0, clicks: 0, lucky: 0, chain: 0, storm: 0 };
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
  const pows = P.special.powers;
  const nB = pows.length;
  const kTop = Math.min(kMax, nB);
  const EB = subsetAverages(pows, kTop);
  const SUB = subsetProducts(pows, kTop);
  const bank = P.bank;
  const chainStep = Math.max(1, Math.round(91 / grid)); // a chain's next cookie: 91 frames on (rounded to the grid)

  // a state: [last, F, H, C, D, S, ...B (descending)], times in grid steps
  const keyOf = (s) => String.fromCharCode.apply(null, s);
  const cpsMult = (fa, ha, k) => (fa ? pF : 1) * (ha ? pH : 1) * EB[k];
  // cookies a second with these buffs on
  const rates = (fa, ha, k, ca, da, sa) => {
    const m = cpsMult(fa, ha, k);
    const cps = P.cps0 * m;
    const clicks = P.clicks * P.click0 * (1 - P.cpsShare + P.cpsShare * m) * (ca ? pC : 1) * (da ? pD : 1);
    const storm = sa ? 0.5 * fps * 240 * P.luckyMult * cps : 0; // a drop each other frame, 1–7 minutes of CpS
    return { cps, clicks, storm };
  };
  // the stretches of a state's future with the same buffs on: [{ from, to, rate, combo }]
  const stretches = (s) => {
    const cuts = new Set([0]);
    for (let i = 1; i < s.length; i++) if (s[i] > 0) cuts.add(s[i]);
    const xs = [...cuts].sort((a, b) => a - b);
    const out = [];
    for (let j = 0; j < xs.length; j++) {
      const at = xs[j];
      let k = 0;
      for (let i = 6; i < s.length; i++) if (s[i] > at) k++;
      const fa = s[1] > at;
      const ha = s[2] > at;
      const ca = s[3] > at;
      const da = s[4] > at;
      const sa = s[5] > at;
      out.push({ from: at, to: j + 1 < xs.length ? xs[j + 1] : Infinity, rate: rates(fa, ha, k, ca, da, sa), combo: shares ? `${+fa} ${+ha} ${k} ${+ca} ${+da} ${+sa}` : '' });
    }
    return out;
  };
  const after = (s, t) => {
    const n = [s[0]];
    for (let i = 1; i < 6; i++) n.push(Math.max(0, s[i] - t));
    for (let i = 6; i < s.length; i++) if (s[i] > t) n.push(s[i] - t);
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

  const lucky = (s) => {
    const b = 900 * P.cps0 * (s[1] > 0 ? pF : 1) * (s[2] > 0 ? pH : 1);
    return P.luckyMult * meanMin(SUB[s.length - 6], 0.15 * bank, b) + 13;
  };

  // a chain from this state: [{ steps, p, value }] (value: cookies, given that many steps)
  const chains = new Map();
  const c0 = Number.isFinite(bank) ? 1 + Math.max(0, Math.ceil(Math.log10(bank)) - 10) : 400; // a chain's first digits
  let chainSpan = null; // the most cookies a chain can run to: past that, a buff's time left doesn't matter
  const chainOutcomes = (s) => {
    if (chainSpan === null) {
      // the most CpS there can be makes the longest chain (the cap only grows with CpS)
      const top = [...pows].sort((a, b) => b - a).slice(0, kTop);
      const cap = Math.min(P.cps0 * pF * pH * top.reduce((a, b) => a * b, 1) * 21600, bank * 0.5) * P.luckyMult;
      let steps = 1;
      for (let c = c0; Math.max(7, Math.min(Math.floor((1 / 9) * Math.pow(10, c + 1) * 7 * P.luckyMult), cap)) < cap && steps < 400; c++) steps++;
      chainSpan = steps + 1;
    }
    // a buff matters to a chain only by the step it runs out on
    const at = (x) => Math.min(Math.ceil(x / chainStep), chainSpan);
    const key = `${at(s[1])},${at(s[2])},${s[5] > 0 ? 1 : 0},${s.slice(6).map(at).join(',')}`;
    if (chains.has(key)) return chains.get(key);
    const rems = s.slice(6);
    const k = rems.length;
    const byL = new Map();
    const run = (powsOf, weight) => {
      let alive = weight;
      let value = 0;
      for (let j = 1, c = c0; j <= 400; j++, c++) {
        const at = (j - 1) * chainStep;
        let m = (s[1] > at ? pF : 1) * (s[2] > at ? pH : 1);
        m *= powsOf(at);
        const cpsB = P.cps0 * m;
        const cap = Math.min(cpsB * 21600, bank * 0.5) * P.luckyMult;
        const pay = (cc) => Math.max(7, Math.min(Math.floor((1 / 9) * Math.pow(10, cc) * 7 * P.luckyMult), cap));
        value += pay(c);
        const forced = pay(c + 1) >= cap || s[5] > 0; // capped, or a storm drop breaks it
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

  // one golden cookie clicked in state s: [{ s, p, parts, secs, golden, choice }]
  const popOnce = (s) => {
    const out = [];
    for (const [choice, p] of oddsFor(s[0], s[4] > 0 ? 1 : 0)) {
      const base = () => {
        const n = [...s];
        n[0] = lastOf(choice);
        return n;
      };
      const push = (n, q, parts = null, secs = 0, golden = 1) => out.push({ s: n, p: p * q, parts, secs, golden, choice });
      switch (choice) {
        case 'frenzy':
        case 'dragon harvest':
        case 'click frenzy':
        case 'cookie storm': {
          const [slot, d] = { frenzy: [1, dF], 'dragon harvest': [2, dH], 'click frenzy': [3, dC], 'cookie storm': [5, dS] }[choice];
          for (const [x, q] of d) {
            const n = base();
            n[slot] += x;
            push(n, q);
          }
          break;
        }
        case 'dragonflight':
          for (const [x, q] of dD) {
            const n = base();
            n[4] += x;
            push(n, 0.2 * q);
            const m = [...n];
            m[3] = 0; // 80%: Click frenzy ends
            push(m, 0.8 * q);
          }
          break;
        case 'multiply cookies':
          push(base(), 1, { ...zero, lucky: lucky(s) });
          break;
        case 'building special': {
          const n0 = base();
          if (!nB) {
            for (const [x, q] of dF) push([n0[0], n0[1] + x, ...n0.slice(2)], q); // no building with 10: a Frenzy instead
            break;
          }
          const rems = n0.slice(6);
          const k = rems.length;
          const fresh = k >= kTop ? 0 : (nB - k) / nB;
          for (const [x, q] of dB) {
            for (let i = 0; i < k; i++) {
              const r = [...rems];
              r[i] += x;
              r.sort((u, v) => v - u);
              push([...n0.slice(0, 6), ...r], (q * (1 - fresh)) / k);
            }
            if (fresh > 0) push([...n0.slice(0, 6), ...[...rems, x].sort((u, v) => v - u)], q * fresh);
          }
          break;
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
          break;
        }
        default:
          push(base(), 1); // nothing that pays: everything must go, a sugar lump, a blab
      }
    }
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
      const n = o.s[5] > 0 ? [lastOf('cookie storm drop'), ...o.s.slice(1)] : o.s;
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

  // what a state earns, on average, until a wait whose survival P(T > u) sums to CS[u] (frames on
  // this grid; CS stops at `top`), weighed by w, added to acc ([cps, clicks, lucky, chain, storm]):
  // stretches' sums without their objects, for the walk's hot loop
  const cuts = new Float64Array(16);
  const waitEarn = (s, CS, top, w, acc, combos) => {
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
    let from = 0;
    for (let j = 0; j <= n; j++) {
      const to = j < n ? cuts[j] : Infinity;
      if (to <= from) continue;
      const b = Math.min(to, top);
      if (b > from) {
        const secs = ((CS[b] - CS[from]) / fps) * w * grid;
        let k = 0;
        for (let i = 6; i < s.length; i++) if (s[i] > from) k++;
        const m = (s[1] > from ? pF : 1) * (s[2] > from ? pH : 1) * EB[k];
        const cps = P.cps0 * m;
        acc[0] += cps * secs;
        acc[1] += P.clicks * P.click0 * (1 - P.cpsShare + P.cpsShare * m) * (s[3] > from ? pC : 1) * (s[4] > from ? pD : 1) * secs;
        if (s[5] > from) acc[4] += 0.5 * fps * 240 * P.luckyMult * cps * secs;
        if (combos) {
          const key = `${+(s[1] > from)} ${+(s[2] > from)} ${k} ${+(s[3] > from)} ${+(s[4] > from)} ${+(s[5] > from)}`;
          combos.set(key, (combos.get(key) || 0) + secs);
        }
      }
      if (to >= top) break;
      from = to;
    }
  };
  return { fps, unit, zero, keyOf, rates, stretches, after, earnOver, popOnce, transitions, lastOf, waitEarn };
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
      to.push(preId([s[0], 0, 0, 0, 0, 0]));
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
  postId([0, 0, 0, 0, 0, 0]);
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
 */
export function expectedIncome(P, { pops = 1000000, seed = 1, batches = 40, warmup = 2000, kMax = 4, shares = false, probe = null } = {}) {
  if (!P.golden) return { ...noGolden(P), se: 0, pops: 0 };
  const { fps, stretches, after, popOnce, lastOf: lastFor, waitEarn } = machinery(P, { grid: 1, kMax, shares });
  const rnd = makeRng(seed * 7919 + 17);
  // the wait: P(T > u) frame by frame, and its running sum (what a rate earns, on average, before the next one)
  const S = survivalTable(P.minTime, P.maxTime);
  const CS = new Float64Array(S.length + 1);
  for (let u = 0; u < S.length; u++) CS[u + 1] = CS[u] + S[u];
  const meanT = CS[S.length] / fps; // seconds
  const top = S.length;
  const parts = new Float64Array(5); // cps, clicks, lucky, chain, storm (cookies, this batch)
  const combos = shares ? new Map() : null;
  // what the next wait earns from a state just after a click, weighed by w
  const earn = (s, w) => waitEarn(s, CS, top, w, parts, combos);
  const credit = (o, w) => {
    if (!o.parts) return;
    parts[2] += w * o.parts.lucky;
    parts[3] += w * o.parts.chain;
    parts[0] += w * o.parts.cps;
    parts[1] += w * o.parts.clicks;
    parts[4] += w * o.parts.storm;
  };
  // with a storm still running, its drops make the last effect "cookie storm drop"
  const settle = (n) => (n[5] > 0 ? [lastFor('cookie storm drop'), ...n.slice(1)] : n);
  const pick = (outs) => {
    let u = rnd();
    for (const o of outs) if ((u -= o.p) < 0) return o;
    return outs[outs.length - 1];
  };
  const effects = new Map();
  const count = (choice, n) => effects.set(choice, (effects.get(choice) || 0) + n);
  let secs = 0;
  let golden = 0;
  // one walker's click from state s, its sums weighed by w: the state before its next click
  const step = (s, w) => {
    // this click, every way it can go
    const outs = popOnce(s);
    if (probe) probe(s, outs, w);
    secs += w * meanT;
    for (const o of outs) {
      const second = P.pExtra > 0 && o.choice !== 'chain cookie' ? P.pExtra : 0;
      const q = w * o.p;
      credit(o, q);
      earn(settle(o.s), q * (1 - second));
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
    let post = lead.s;
    if (P.pExtra > 0 && lead.choice !== 'chain cookie') {
      // the second golden cookie, 1% of the time: its expectation from the lead drawn (an unbiased share)
      const outs2 = popOnce(lead.s);
      for (const o of outs2) {
        const q = w * P.pExtra * o.p;
        credit(o, q);
        earn(settle(o.s), q);
        secs += q * o.secs;
        count(o.choice, q * (o.choice === 'chain cookie' ? o.golden : 1));
      }
      if (rnd() < P.pExtra) post = pick(outs2).s;
    }
    return after(settle(post), spawnFrame(P.minTime, P.maxTime, 0, rnd()));
  };
  const batch = [];
  const close = () => {
    batch.push({ income: parts.reduce((a, b) => a + b, 0), parts: Float64Array.from(parts), secs, golden, effects: new Map(effects), combos: combos && new Map(combos) });
  };
  const per = Math.max(1, Math.floor(pops / batches));
  let s = [0, 0, 0, 0, 0, 0];
  for (let n = -warmup; n < per * batches; n++) {
    if (n >= 0 && n % per === 0) {
      if (n > 0) close();
      parts.fill(0);
      secs = 0;
      golden = 0;
      effects.clear();
      if (combos) combos.clear();
    }
    s = step(s, 1);
  }
  close();
  // the ratio of sums, and its spread over the batches
  const sum = (f) => batch.reduce((a, b) => a + f(b), 0);
  const T = sum((b) => b.secs);
  const mult = sum((b) => b.income) / (P.base * T);
  const bm = batch.map((b) => b.income / (P.base * b.secs));
  const sd = Math.sqrt(bm.reduce((a, x) => a + (x - mult) ** 2, 0) / (batch.length - 1));
  const out = {
    mult,
    se: sd / Math.sqrt(batch.length),
    parts: Object.fromEntries(PARTS.map((k, i) => [k, sum((b) => b.parts[i]) / (P.base * T)])),
    golden: (sum((b) => b.golden) * 3600) / T,
    effects: Object.fromEntries(CHOICES.map((c) => [c, (sum((b) => b.effects.get(c) || 0) * 3600) / T]).filter(([, v]) => v > 0)),
    pops: per * batches,
  };
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
  const r = opts.method === 'chain' ? { ...exactIncome(P, opts), se: 0 } : expectedIncome(P, opts);
  return { ...r, bank: P.bank };
}
