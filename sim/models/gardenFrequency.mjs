// Golden cookie frequency over time, gardener by gardener: a fast model of a golden clover garden
// (with or without nursetulips) kept by one of cookieMgr's gardeners, run for thousands of hours,
// and how its golden cookie frequency bonus is spread over the time — a histogram weighted by game
// time, its mean, and how long the nursetulips stay fully grown (the "golden zone").
//
// The rules are the game's, as models/garden.mjs reduces them (numbers from gardenData.mjs). What
// each gardener does, as the add-on's built-ins do it:
//   clovers 'steady'   the Effect maximizer: a clover replanted as soon as its tile is empty, a mature
//                      one over `dyingOver` likely to die harvested and replanted 15 s before the tick
//   clovers 'cohort'   the Full-garden replanter: all the clovers planted together; a new round once
//                      fewer than `replantBelow` of them are mature — fertilizer first, the old round
//                      kept working until the next tick, the new one planted 15 s before it
//   tulips 'steady'    each nursetulip replanted when it dies, left to grow at its own pace
//   tulips 'cohort'    the nursetulips replanted together, once fewer than half of them are mature
//   soil 'young'       "Fertilizer, then clay": fertilizer while more than `theta` of the plants are young
//   soil 'clovers'     "Grow together, then clay", on the clovers only: fertilizer while a round of
//                      clovers grows, until `clayAt` (a quarter, as the add-on's) of them are mature
//   soil 'both'        as 'clovers', and fertilizer as well while any nursetulip is still growing
//   soil 'clay'        always clay
import { stageMult, randomFloor, decayChance, neighbors, bestNurseLayout } from './garden.mjs';
import { plotAt } from './gardenData.mjs';
import { makeRng } from '../game/rng.mjs';

export const BIN = 0.05; // the histogram's bins: 5 points of golden cookie frequency each
export const FINE = 0.01; // the score's bins (models/gardenScore.mjs): 1 point each

/**
 * One garden, `hours` long: { mean (bonus), cps (CpS multiplier), fert (share of the time on
 * fertilizer), bins (share of the time with the bonus in [k·BIN, (k+1)·BIN)), fine (the same in
 * 1-point bins, each weighed by the CpS multiplier at the time: what models/gardenScore.mjs scores),
 * peak, zone: {
 * share, stretch (h), first (h), cloversMax (share of the zone's time with every clover mature) },
 * plantings: { G, N } per hour }.
 */
export function runGarden(
  data,
  {
    layout,
    w,
    h,
    clovers = 'steady',
    tulips = 'steady',
    soil: soilRule = 'young',
    theta = 0.9,
    dyingOver = 0.5,
    replantBelow = 0.75,
    clayAt = 0.25,
    hours = 1000,
    seed = 1,
  }
) {
  const rnd = makeRng(seed);
  const N = w * h;
  const kinds = layout.split('');
  if (kinds.length !== N) throw new Error(`layout has ${kinds.length} tiles, the plot ${N}`);
  const P = { G: data.plants.goldenClover, N: data.plants.nursetulip };
  const SOIL = {
    fert: { tick: data.soils.fertilizer.tick * 60, mult: data.soils.fertilizer.effMult },
    clay: { tick: data.soils.clay.tick * 60, mult: data.soils.clay.effMult },
  };
  const die = { G: [], N: [] };
  for (const k of ['G', 'N']) for (let a = 0; a <= 100; a++) die[k][a] = decayChance(P[k], a);
  const nb = neighbors(w, h);
  const G = kinds.map((k, i) => (k === 'G' ? i : -1)).filter((i) => i >= 0);
  const T = kinds.map((k, i) => (k === 'N' ? i : -1)).filter((i) => i >= 0);
  const age = new Array(N).fill(0);
  const alive = kinds.map((k) => k !== '.');
  const boost = new Array(N).fill(1);
  const mature = (i) => alive[i] && age[i] >= P[kinds[i]].mature;
  const share = (idx, f) => (idx.length ? idx.filter(f).length / idx.length : 1);
  const plantings = { G: G.length, N: T.length };
  let soil = soilRule === 'clay' ? 'clay' : 'fert';
  let nextSoilOK = 0;
  let t = 0;
  let nextStep = SOIL[soil].tick;
  let cloverRound = 'grow'; // cohort clovers: 'grow' → 'hold' → 'due' (a new round at the next tick)
  let tulipHold = false;
  const end = hours * 3600;

  const wantSoil = () => {
    if (soilRule === 'clay') return 'clay';
    if (soilRule === 'young') return share([...G, ...T], (i) => !mature(i)) > theta ? 'fert' : 'clay';
    const cloversGrow =
      clovers === 'cohort'
        ? cloverRound === 'due' || (cloverRound === 'grow' && share(G, mature) < clayAt)
        : share(G, (i) => !mature(i)) > theta;
    const tulipsGrow = soilRule === 'both' && T.some((i) => alive[i] && !mature(i));
    return cloversGrow || tulipsGrow ? 'fert' : 'clay';
  };
  const setSoil = () => {
    const want = wantSoil();
    if (want === soil || t < nextSoilOK) return;
    soil = want;
    nextSoilOK = t + 600;
    nextStep = Math.min(nextStep, t + SOIL[soil].tick);
  };
  const rounds = () => {
    if (clovers === 'cohort') {
      const m = share(G, mature);
      if (cloverRound === 'grow' && m >= clayAt) cloverRound = 'hold';
      if (cloverRound === 'hold' && m < replantBelow && G.every((i) => !alive[i] || mature(i))) cloverRound = 'due';
    }
    if (tulips === 'cohort' && T.length) {
      const m = share(T, mature);
      if (!tulipHold && m >= 0.5) tulipHold = true;
      if (tulipHold && m < 0.5) {
        T.forEach((i) => ((age[i] = 0), (alive[i] = true)));
        plantings.N += T.length;
        tulipHold = false;
      }
    }
  };

  // the bookkeeping, weighted by time
  const bins = [];
  const fine = [];
  let sGc = 0;
  let sCps = 0;
  let fertT = 0;
  let peak = 0;
  let zoneT = 0;
  let zoneMaxT = 0;
  let zoneRuns = 0;
  let inZone = false;
  let firstZone = null;
  const advance = (to) => {
    if (to <= t) return;
    const m = SOIL[soil].mult;
    let gc = 0;
    let cps = 1;
    for (let i = 0; i < N; i++) {
      if (!alive[i] || kinds[i] === '.') continue;
      const s = stageMult(P[kinds[i]], age[i]) * m;
      if (kinds[i] === 'G') gc += 0.03 * s * boost[i];
      else cps *= 1 - 0.02 * s * boost[i]; // boosted by the nursetulips next to it too, as in the game
    }
    const d = to - t;
    const b = Math.floor(gc / BIN + 1e-9);
    bins[b] = (bins[b] || 0) + d;
    const fb = Math.floor(gc / FINE + 1e-9);
    fine[fb] = (fine[fb] || 0) + d * cps;
    sGc += gc * d;
    sCps += cps * d;
    if (gc > peak) peak = gc;
    if (soil === 'fert') fertT += d;
    // the golden zone: every nursetulip fully grown (and so boosting its neighbors all it can)
    const zone = T.length > 0 && T.every(mature);
    if (zone) {
      zoneT += d;
      if (G.every(mature)) zoneMaxT += d;
      if (!inZone) zoneRuns++;
      if (firstZone === null) firstZone = t;
    }
    inZone = zone;
    t = to;
  };

  while (t < end) {
    rounds();
    setSoil();
    if (nextSoilOK > t && nextSoilOK < nextStep - 15 && wantSoil() !== soil) {
      advance(nextSoilOK);
      continue;
    }
    advance(Math.max(t, nextStep - 15));
    // 15 s before the tick: the Effect maximizer's harvests, the Full-garden replanter's new round
    if (clovers === 'steady')
      for (const i of G)
        if (mature(i) && die.G[Math.min(100, age[i])] > dyingOver) {
          age[i] = 0;
          plantings.G++;
        }
    if (cloverRound === 'due') {
      G.forEach((i) => ((age[i] = 0), (alive[i] = true)));
      plantings.G += G.length;
      cloverRound = 'grow';
    }
    rounds();
    setSoil();
    advance(nextStep);
    // the tick: its length from the soil now; the nursetulips' boost from their stages before aging
    nextStep = t + SOIL[soil].tick;
    boost.fill(1);
    for (const i of T)
      if (alive[i]) {
        const pm = 1 + 0.2 * SOIL[soil].mult * stageMult(P.N, age[i]);
        for (const j of nb[i]) boost[j] *= pm;
      }
    for (let i = 0; i < N; i++) {
      if (!alive[i] || kinds[i] === '.') continue;
      const p = P[kinds[i]];
      age[i] += randomFloor(p.ageTick + p.ageTickR * rnd(), rnd);
      if (age[i] < 100) continue;
      age[i] = 0;
      const cohort = kinds[i] === 'G' ? clovers === 'cohort' : tulips === 'cohort';
      if (cohort) alive[i] = false;
      else plantings[kinds[i]]++;
    }
  }
  const out = Array.from({ length: bins.length }, (_, k) => (bins[k] || 0) / t);
  return {
    mean: sGc / t,
    cps: sCps / t,
    fert: fertT / t,
    peak,
    bins: out,
    fine: Array.from({ length: fine.length }, (_, k) => (fine[k] || 0) / t),
    zone: T.length
      ? {
          share: zoneT / t,
          stretch: zoneRuns ? zoneT / zoneRuns / 3600 : 0,
          first: firstZone === null ? null : firstZone / 3600,
          cloversMax: zoneT ? zoneMaxT / zoneT : 0,
        }
      : null,
    plantings: { G: plantings.G / (t / 3600), N: plantings.N / (t / 3600) },
  };
}

/** The gardeners compared, for a w × h plot: golden clovers alone, and with `tulips` nursetulips (each count). */
export function gardeners(w, h, tulips = [4, 8]) {
  const fill = 'G'.repeat(w * h);
  const list = [
    {
      id: 'goldenClovers',
      name: 'Golden clover field',
      desc: 'Golden clover on every tile, each replanted as it dies (Effect maximizer); fertilizer only while nearly all of it is young, clay after.',
      layout: fill,
      clovers: 'steady',
      soil: 'young',
    },
    {
      id: 'goldenCombos',
      name: 'Golden clover combos',
      desc: 'Golden clover on every tile, planted and replanted all together (Full-garden replanter); fertilizer while a round starts growing, clay once a quarter of it is mature, until the next round.',
      layout: fill,
      clovers: 'cohort',
      soil: 'clovers',
    },
  ];
  tulips
    .filter((k) => k > 0 && k < w * h)
    .forEach((k) => {
      const layout = bestNurseLayout(w, h, k);
      list.push({
        id: `tulips${k}`,
        name: `${k} nursetulips + clover combos`,
        desc: `${k} nursetulips, each replanted as it dies and left to grow at its own pace, golden clovers around them replanted all together. The soil follows the clovers only: fertilizer while a round of clovers grows.`,
        layout,
        clovers: 'cohort',
        tulips: 'steady',
        soil: 'clovers',
      });
      list.push({
        id: `tulips${k}Fert`,
        name: `${k} nursetulips + clover combos, fertilizer for the tulips too`,
        desc: `As above, but fertilizer as well while any nursetulip is still growing (quicker ticks, effects ×0.75).`,
        layout,
        clovers: 'cohort',
        tulips: 'steady',
        soil: 'both',
      });
      list.push({
        id: `tulips${k}Together`,
        name: `${k} nursetulips together + clover combos`,
        desc: `As the first, but the nursetulips replanted all together too, once fewer than half of them are mature — so they're mature at the same time.`,
        layout,
        clovers: 'cohort',
        tulips: 'cohort',
        soil: 'clovers',
      });
    });
  return list;
}

/**
 * Every gardener at a Farm level, over `seeds` gardens of `hours` each, pooled: { level, w, h,
 * hours, seeds, bin, results: [{ ...gardener, mean, cps, …, bins }] }. `only`: a list of ids.
 */
export function frequencyStudy(data, { level = 8, hours = 1000, seeds = 3, tulips = [4, 8], only = null } = {}) {
  const { w, h } = plotAt(data, level);
  const list = gardeners(w, h, tulips).filter((g) => !only || only.includes(g.id));
  const results = list.map((g) => {
    const runs = [];
    for (let s = 1; s <= seeds; s++) runs.push(runGarden(data, { ...g, w, h, hours, seed: s }));
    const avg = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const nBins = Math.max(...runs.map((r) => r.bins.length));
    const zone = runs[0].zone
      ? {
          share: avg((r) => r.zone.share),
          stretch: avg((r) => r.zone.stretch),
          first: avg((r) => r.zone.first || 0),
          cloversMax: avg((r) => r.zone.cloversMax),
        }
      : null;
    return {
      ...g,
      mean: avg((r) => r.mean),
      cps: avg((r) => r.cps),
      fert: avg((r) => r.fert),
      peak: Math.max(...runs.map((r) => r.peak)),
      bins: Array.from({ length: nBins }, (_, k) => avg((r) => r.bins[k] || 0)),
      fine: Array.from({ length: Math.max(...runs.map((r) => r.fine.length)) }, (_, k) => avg((r) => r.fine[k] || 0)),
      zone,
      plantings: { G: avg((r) => r.plantings.G), N: avg((r) => r.plantings.N) },
    };
  });
  return { level, w, h, hours, seeds, bin: BIN, results };
}
