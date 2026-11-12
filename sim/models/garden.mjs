// Fast garden models: the garden's rules (minigameGarden.js), reduced to what matters for one
// question, so thousands of simulated hours take seconds — for sweeping parameters before trying the
// winner in the exact simulator (sim.mjs: the real game running cookieMgr).
//
// The rules, as the game has them (numbers from gardenData.mjs — the game's own):
//   - each tick a plant ages by randomFloor((ageTick + ageTickR·random) × tile age boost) and dies
//     at 100; a tick lasts the soil's tick minutes (the soil at the tick); switching to a quicker
//     soil pulls the next tick nearer; the soil can change once every 10 minutes
//   - a plant's effect is × 0.1 / 0.25 / 0.5 / 1 by stage (⅓, ⅔, 1 × mature), × the soil's effMult
//     (now), × the tile's power boost (a nursetulip: 1 + 0.2 × soil × its stage, on its 8 neighbors,
//     as of the last tick)

export const stageMult = (p, age) => (age >= p.mature ? 1 : age >= p.mature * 0.666 ? 0.5 : age >= p.mature * 0.333 ? 0.25 : 0.1);
export const randomFloor = (x, rnd = Math.random) => Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0);

/** P(a plant of this age reaches 100 on the next tick) — exact (as cookieMgr's garden.decay). */
export function decayChance(p, age, boost = 1) {
  if (p.immortal) return 0;
  const n = 100 - age;
  if (n <= 0) return 1;
  const a = boost * p.ageTick;
  const b = boost * (p.ageTick + (p.ageTickR || 0));
  const f = (v) => (v >= n ? 1 : v > n - 1 ? v - (n - 1) : 0);
  if (b - a < 1e-9) return f(a);
  const F = (v) => (v <= n - 1 ? 0 : v < n ? (v - n + 1) ** 2 / 2 : 0.5 + (v - n));
  return Math.max(0, Math.min(1, (F(b) - F(a)) / (b - a)));
}

/**
 * One plant, kept on one tile forever, harvested-and-replanted just before a tick when its chance
 * to die on it is over `theta` (theta ≥ 1: never — let it die and replant after): its average
 * effect (mature = 1) and replantings per tick, over `ticks` ticks.
 */
export function plantPolicy(p, theta, ticks = 200000, rnd = Math.random) {
  const die = Array.from({ length: 101 }, (_, a) => decayChance(p, a));
  let age = 0;
  let sum = 0;
  let replants = 0;
  for (let t = 0; t < ticks; t++) {
    if (age >= p.mature && die[Math.min(100, age)] > theta) {
      age = 0;
      replants++;
    }
    age += randomFloor(p.ageTick + p.ageTickR * rnd(), rnd);
    if (age >= 100) {
      age = 0;
      replants++;
      sum += stageMult(p, 0);
    } else sum += stageMult(p, age);
  }
  return { effect: sum / ticks, replantsPerTick: replants / ticks };
}

/** The 8 neighbors of every tile of a w × h plot. */
export function neighbors(w, h) {
  return Array.from({ length: w * h }, (_, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    const out = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
      }
    return out;
  });
}

/**
 * A field of golden clovers ('G') and nursetulips ('N') — `layout`, w × h, row by row — run as
 * cookieMgr's Effect maximizer runs it: every tile replanted as soon as it's empty, mature plants
 * over `dyingOver` likely to die harvested and replanted 15 s before the tick, the soil
 * fertilizer while more than `theta` of the plants are young, else clay (theta < 0: always
 * fertilizer, ≥ 1: always clay). Or, policy 'cohort': the whole field planted together on
 * fertilizer, clay once `matureAt` of it is mature, not replanted until fewer than `below` of
 * the tiles hold a mature plant — then everything is harvested and replanted.
 * Returns the averages: { gc (golden cookie frequency bonus), gc2 (of (1+gc)²), hi (share of the
 * time at +60% or more), cps (CpS multiplier from the nursetulips), fert (share of time on
 * fertilizer), plantings (per hour, by kind) }.
 */
export function cloverField(data, { layout, w, h, policy = 'steady', theta = 0.9, dyingOver = 0.5, matureAt = 0.7, below = 0.7, hours = 2000, rnd = Math.random }) {
  const N = w * h;
  const kinds = layout.split('');
  if (kinds.length !== N) throw new Error(`layout has ${kinds.length} tiles, the plot ${N}`);
  const P = { G: data.plants.goldenClover, N: data.plants.nursetulip };
  const SOIL = { fert: { tick: data.soils.fertilizer.tick * 60, mult: data.soils.fertilizer.effMult }, clay: { tick: data.soils.clay.tick * 60, mult: data.soils.clay.effMult } };
  const die = { G: [], N: [] };
  for (const k of ['G', 'N']) for (let a = 0; a <= 100; a++) die[k][a] = decayChance(P[k], a);
  const nb = neighbors(w, h);
  const age = new Array(N).fill(0);
  const alive = new Array(N).fill(true);
  const boost = new Array(N).fill(1);
  let soil = policy === 'cohort' || theta < 0 ? 'fert' : 'clay';
  let nextSoilOK = 0;
  let t = 0;
  let nextStep = SOIL[soil].tick;
  let phase = 'grow';
  const end = hours * 3600;
  let s1 = 0;
  let s2 = 0;
  let hi = 0;
  let cpsInt = 0;
  let fertTime = 0;
  const plantings = { G: 0, N: 0 };
  const share = (f) => {
    let c = 0;
    for (let i = 0; i < N; i++) if (f(i)) c++;
    return c / N;
  };
  const effect = () => {
    const m = SOIL[soil].mult;
    let gc = 0;
    let cps = 1;
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      const s = stageMult(P[kinds[i]], age[i]) * m;
      if (kinds[i] === 'G') gc += 0.03 * s * boost[i];
      else cps *= 1 - 0.02 * s * boost[i]; // boosted by the nursetulips next to it too, as in the game
    }
    return [gc, cps];
  };
  const advance = (to) => {
    if (to <= t) return;
    const [gc, cps] = effect();
    const d = to - t;
    s1 += gc * d;
    s2 += (1 + gc) ** 2 * d;
    if (gc >= 0.6) hi += d;
    cpsInt += cps * d;
    if (soil === 'fert') fertTime += d;
    t = to;
  };
  const setSoil = (want) => {
    if (want === soil || t < nextSoilOK) return;
    soil = want;
    nextSoilOK = t + 600;
    nextStep = Math.min(nextStep, t + SOIL[soil].tick);
  };
  const wantSoil = () => {
    if (policy === 'cohort') return phase === 'grow' ? 'fert' : 'clay';
    if (theta < 0) return 'fert';
    return share((i) => age[i] < P[kinds[i]].mature) > theta ? 'fert' : 'clay';
  };
  const cohortCheck = () => {
    if (policy !== 'cohort') return;
    const mature = share((i) => alive[i] && age[i] >= P[kinds[i]].mature);
    if (phase === 'grow' && mature >= matureAt) phase = 'hold';
    if (phase === 'hold' && mature < below) {
      for (let i = 0; i < N; i++) {
        age[i] = 0;
        alive[i] = true;
        plantings[kinds[i]]++;
      }
      phase = 'grow';
    }
  };
  while (t < end) {
    cohortCheck();
    setSoil(wantSoil());
    if (nextSoilOK > t && nextSoilOK < nextStep - 15 && wantSoil() !== soil) {
      advance(nextSoilOK);
      continue;
    }
    advance(Math.max(t, nextStep - 15));
    // 15 s before the tick
    if (policy === 'steady' && dyingOver < 1)
      for (let i = 0; i < N; i++) {
        const k = kinds[i];
        if (age[i] >= P[k].mature && die[k][Math.min(100, age[i])] > dyingOver) {
          age[i] = 0;
          plantings[k]++;
        }
      }
    cohortCheck();
    setSoil(wantSoil());
    advance(nextStep);
    // the tick: its length from the soil now; the nursetulips' boost from the stages before aging
    nextStep = t + SOIL[soil].tick;
    boost.fill(1);
    for (let i = 0; i < N; i++)
      if (kinds[i] === 'N' && alive[i]) {
        const pm = 1 + 0.2 * SOIL[soil].mult * stageMult(P.N, age[i]);
        for (const j of nb[i]) boost[j] *= pm;
      }
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      const p = P[kinds[i]];
      age[i] += randomFloor(p.ageTick + p.ageTickR * rnd(), rnd);
      if (age[i] >= 100) {
        age[i] = 0;
        if (policy === 'steady') plantings[kinds[i]]++;
        else alive[i] = false;
      }
    }
  }
  return { gc: s1 / t, gc2: s2 / t, hi: hi / t, cps: cpsInt / t, fert: fertTime / t, plantings: { G: plantings.G / (t / 3600), N: plantings.N / (t / 3600) } };
}

/** For k nursetulips on a w × h plot: the placement that boosts the most clovers when all are mature (greedy + swaps, at boost strength s). */
export function bestNurseLayout(w, h, k, s = 1) {
  const N = w * h;
  const nb = neighbors(w, h);
  const score = (l) => {
    let v = 0;
    for (let i = 0; i < N; i++) {
      if (l[i] === 'N') continue;
      let b = 1;
      for (const j of nb[i]) if (l[j] === 'N') b *= 1 + 0.25 * s;
      v += b;
    }
    return v;
  };
  let l = 'G'.repeat(N).split('');
  for (let n = 0; n < k; n++) {
    let best = null;
    for (let i = 0; i < N; i++) {
      if (l[i] === 'N') continue;
      const t = l.slice();
      t[i] = 'N';
      const v = score(t);
      if (!best || v > best.v) best = { v, t };
    }
    l = best.t;
    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < N; a++)
        for (let b = 0; b < N; b++) {
          if (l[a] !== 'N' || l[b] !== 'G') continue;
          const t = l.slice();
          t[a] = 'G';
          t[b] = 'N';
          if (score(t) > score(l) + 1e-9) {
            l = t;
            improved = true;
          }
        }
    }
  }
  return l.join('');
}

export const showLayout = (layout, w) => layout.match(new RegExp(`.{1,${w}}`, 'g')).map((r) => r.split('').join(' ')).join('\n');
