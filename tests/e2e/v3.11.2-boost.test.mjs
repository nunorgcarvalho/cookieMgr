// v3.11.2: garden mutation odds only read the garden: the boosts plants give
// their neighbors (M.plotBoost) are the game's to change, at a tick — the odds run the game's own
// computeBoostPlot on a grid of their own and put the game's back, even when it throws.
// (In the real game, with a nursetulip that matured since the last tick: tests/sim/mutations.)
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);

const plants = {
  bakerWheat: { key: 'bakerWheat', name: 'Baker’s wheat', id: 0, mature: 35, ageTick: 7, ageTickR: 2, unlocked: 1 },
  nursetulip: { key: 'nursetulip', name: 'Nursetulip', id: 1, mature: 60, ageTick: 0.5, ageTickR: 2, unlocked: 1 },
};
const plot = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0]));
plot[0][0] = [2, 70]; // a nursetulip, mature now
plot[0][1] = [1, 50];
const grid = (v) => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [1, v, 1]));
let calls = 0;
const M = {
  plants,
  plantsById: [plants.bakerWheat, plants.nursetulip],
  plot,
  soil: 0,
  soilsById: [{ key: 'dirt', weedMult: 1, effMult: 1 }],
  plotBoost: grid(1.02), // what the last tick left (when it was young)
  loopsMult: 1,
  stepT: 300,
  nextStep: Date.now() + 60000,
  getTile: (x, y) => (x < 0 || y < 0 || x > 5 || y > 5 ? [0, 0] : plot[y][x]),
  isTileUnlocked: () => true,
  getMuts: (n, nm) => (nm.bakerWheat >= 1 ? [['bakerWheat', 0.1]] : []),
  // the game's: rebuilds M.plotBoost from the plot as it is (here: the nursetulip, mature, ×1.2 around it)
  computeBoostPlot() {
    calls++;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) M.plotBoost[y][x] = [1, 1.2, 1];
  },
};
Game.Objects.Farm.minigame = M;
Game.auraMult = () => 0;
const live = M.plotBoost;
const rows = live.slice();
const before = JSON.stringify(live);

CA.Mutations.all();
CA.Mutations.tile(1, 1);
assert(calls >= 1, 'the game’s own computeBoostPlot was asked');
assert(M.plotBoost === live && live.every((r, i) => r === rows[i]) && JSON.stringify(M.plotBoost) === before, 'the game’s M.plotBoost: the same arrays, the same numbers');
const next = CA.Mutations.nextBoost(M);
assert(next !== live && next[1][1][1] === 1.2, 'the odds work with the next tick’s boosts, on a grid of their own');
M.computeBoostPlot = () => {
  M.plotBoost[0][0] = 'broken';
  throw new Error('boom');
};
let threw = false;
try {
  CA.Mutations.nextBoost(M);
} catch (e) {
  threw = true;
}
assert(threw && M.plotBoost === live && JSON.stringify(M.plotBoost) === before, 'it throws: the game’s grid put back untouched');
// the garden painter, every second: still nothing changed
delete M.computeBoostPlot;
M.computeBoostPlot = function () {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) M.plotBoost[y][x] = [1, 1.2, 1];
};
await sleep(1100);
assert(M.plotBoost === live && JSON.stringify(M.plotBoost) === before, 'after the painter’s second: still the game’s');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
