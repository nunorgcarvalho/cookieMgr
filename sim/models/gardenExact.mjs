// The Garden page's gardeners (models/gardenFrequency.mjs) kept in the real game — the check on the
// fast model. The game's own garden code (minigameGarden.js) grows the plants, ticks, ages, kills,
// boosts and mutates; a driver here does what the gardener does, by the same rules the model gives it
// (models/gardenFrequency.mjs's header), through the game's own functions (M.useTool, M.harvest, the
// soil button's rule); and every simulated second the garden's golden cookie frequency bonus and CpS
// multiplier are read off the game (M.effs, what Game.eff() multiplies in). The bookkeeping is the
// model's — a histogram weighted by game time, its mean, the golden zone — so the two line up.
//
// The garden only reads the clock, so it doesn't need the game's 30 frames a second: at fps 1 a
// garden tick comes at most a second late (ticks are 3–15 minutes) and 1000 h take minutes, not hours.
import { createSim } from '../sim.mjs';
import { plotAt } from './gardenData.mjs';
import { gardeners, BIN } from './gardenFrequency.mjs';
import { decayChance } from './garden.mjs';

/**
 * One gardener (an id of gardeners(w, h, tulips)) on a Farm level's plot, `hours` long, in the real
 * game: the same shape as runGarden's result, plus { strays (weeds and mutations cleared), errors }.
 */
export async function exactGarden(data, { id, level = 8, tulips = [4, 8], hours = 200, seed = 1, fps = 1, onHour } = {}) {
  const { x0, y0, w, h } = plotAt(data, level);
  const g = gardeners(w, h, tulips).find((x) => x.id === id);
  if (!g) throw new Error(`No gardener "${id}"`);
  const o = { clovers: 'steady', tulips: 'steady', soil: 'young', theta: 0.9, dyingOver: 0.5, replantBelow: 0.75, clayAt: 0.25, ...g };

  const sim = await createSim({ seed, fps, mgr: false, sampleEvery: 0 });
  const Game = sim.Game;
  const now = () => sim.clock.now;
  Game.cookies = 1e30;
  Game.Objects.Farm.getFree(300);
  Game.Objects.Farm.level = level;
  Game.LoadMinigames();
  sim.run({ seconds: 1 });
  const M = Game.Objects.Farm.minigame;
  if (!M) throw new Error('The garden did not load');
  ['goldenClover', 'nursetulip'].forEach((k) => M.unlockSeed(M.plants[k]));
  M.computeStepT();

  const kinds = g.layout.split('');
  const XY = kinds.map((_, i) => [x0 + (i % w), y0 + Math.floor(i / w)]);
  const PLANT = { G: M.plants.goldenClover, N: M.plants.nursetulip };
  const Gi = kinds.map((k, i) => (k === 'G' ? i : -1)).filter((i) => i >= 0);
  const Ti = kinds.map((k, i) => (k === 'N' ? i : -1)).filter((i) => i >= 0);
  const tile = (i) => M.plot[XY[i][1]][XY[i][0]];
  const alive = (i) => tile(i)[0] === PLANT[kinds[i]].id + 1;
  const mature = (i) => alive(i) && tile(i)[1] >= PLANT[kinds[i]].mature;
  const share = (idx, f) => (idx.length ? idx.filter(f).length / idx.length : 1);
  const plantings = { G: 0, N: 0 };
  let strays = 0;
  const plant = (i) => {
    Game.cookies = 1e30;
    const [x, y] = XY[i];
    if (M.plot[y][x][0] > 0) M.harvest(x, y, 1);
    if (!M.useTool(PLANT[kinds[i]].id, x, y)) throw new Error(`Couldn't plant ${PLANT[kinds[i]].key} at ${x},${y}`);
    plantings[kinds[i]]++;
  };
  const SOIL = { fert: M.soils.fertilizer.id, clay: M.soils.clay.id };
  // as the game's soil buttons do it: 10 minutes before the soil can change again
  const setSoil = (want) => {
    if (M.soil === SOIL[want] || M.nextSoil > now()) return;
    M.nextSoil = now() + 1000 * 60 * 10;
    M.toCompute = true;
    M.soil = SOIL[want];
    M.computeStepT();
  };
  let cloverRound = 'grow';
  let tulipHold = false;
  const wantSoil = () => {
    if (o.soil === 'clay') return 'clay';
    if (o.soil === 'young') return share([...Gi, ...Ti].filter(alive), (i) => !mature(i)) > o.theta ? 'fert' : 'clay';
    const cloversGrow =
      o.clovers === 'cohort' ? cloverRound === 'due' || (cloverRound === 'grow' && share(Gi, mature) < o.clayAt) : share(Gi, (i) => !mature(i)) > o.theta;
    const tulipsGrow = o.soil === 'both' && Ti.some((i) => alive(i) && !mature(i));
    return cloversGrow || tulipsGrow ? 'fert' : 'clay';
  };
  const rounds = () => {
    if (o.clovers === 'cohort') {
      const m = share(Gi, mature);
      if (cloverRound === 'grow' && m >= o.clayAt) cloverRound = 'hold';
      if (cloverRound === 'hold' && m < o.replantBelow && Gi.every((i) => !alive(i) || mature(i))) cloverRound = 'due';
    }
    if (o.tulips === 'cohort' && Ti.length) {
      const m = share(Ti, mature);
      if (!tulipHold && m >= 0.5) tulipHold = true;
      if (tulipHold && m < 0.5) {
        Ti.forEach(plant);
        tulipHold = false;
      }
    }
  };

  // the first round: everything planted at once
  kinds.forEach((k, i) => k !== '.' && plant(i));
  const bins = [];
  let sGc = 0;
  let sCps = 0;
  let fertT = 0;
  let peak = 0;
  let zoneT = 0;
  let zoneMaxT = 0;
  let zoneRuns = 0;
  let inZone = false;
  let firstZone = null;
  const end = hours * 3600;
  for (let s = 0; s < end; s++) {
    // what the gardener does this second: weeds and mutations on the layout cleared, plants that
    // died replanted (steady), rounds, the soil; in the last 15 s before a tick, the Effect
    // maximizer's harvests of clovers likely to die on it and the Full-garden replanter's new round
    for (let i = 0; i < kinds.length; i++)
      if (kinds[i] !== '.' && tile(i)[0] > 0 && !alive(i)) {
        M.harvest(XY[i][0], XY[i][1], 1);
        strays++;
      }
    if (o.clovers === 'steady') Gi.forEach((i) => !alive(i) && plant(i));
    if (o.tulips === 'steady') Ti.forEach((i) => !alive(i) && plant(i));
    rounds();
    setSoil(wantSoil());
    if (M.nextStep - now() <= 15000) {
      if (o.clovers === 'steady') Gi.forEach((i) => mature(i) && decayChance(PLANT.G, Math.min(100, tile(i)[1])) > o.dyingOver && plant(i));
      if (cloverRound === 'due') {
        Gi.forEach(plant);
        cloverRound = 'grow';
        rounds();
        setSoil(wantSoil());
      }
    }
    if (M.toCompute) M.computeEffs();
    sim.run({ seconds: 1 });
    // the second just played, as the game has it now
    const gc = (M.effs.goldenCookieFreq || 1) - 1;
    const b = Math.floor(gc / BIN + 1e-9);
    bins[b] = (bins[b] || 0) + 1;
    sGc += gc;
    sCps += M.effs.cps || 1;
    if (gc > peak) peak = gc;
    if (M.soil === SOIL.fert) fertT++;
    const zone = Ti.length > 0 && Ti.every(mature);
    if (zone) {
      zoneT++;
      if (Gi.every(mature)) zoneMaxT++;
      if (!inZone) zoneRuns++;
      if (firstZone === null) firstZone = s;
    }
    inZone = zone;
    if (onHour && (s + 1) % 3600 === 0) onHour((s + 1) / 3600, sGc / (s + 1));
  }
  const n = end;
  return {
    mean: sGc / n,
    cps: sCps / n,
    fert: fertT / n,
    peak,
    bins: Array.from({ length: bins.length }, (_, k) => (bins[k] || 0) / n),
    zone: Ti.length ? { share: zoneT / n, stretch: zoneRuns ? zoneT / zoneRuns / 3600 : 0, first: firstZone === null ? null : firstZone / 3600, cloversMax: zoneT ? zoneMaxT / zoneT : 0 } : null,
    plantings: { G: plantings.G / (n / 3600), N: plantings.N / (n / 3600) },
    strays,
    errors: sim.errors().length,
  };
}
