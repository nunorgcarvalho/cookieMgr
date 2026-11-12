// v3.10.1: the Full-garden replanter replants at the tick by default (replantAtTick = true — the
// simulator's sweep: +56.0% golden cookies against +54.8% at once). The built-in follows the new
// default; a copy you edited (the switch off) keeps its own setting.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const M = makeGarden(Game); // 12 tiles: x 1–4, y 2–4
await sleep(400);
const G = CA.Garden;
const LY = CA.GardenLayers;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const tiles = [];
for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) tiles.push([x, y]);
const tickIn = (s) => (M.nextStep = Date.now() + s * 1000);
const young = () => tiles.filter(([x, y]) => at(x, y) && M.plot[y][x][1] === 0).length;
Game.cookies = 1e12;
LY.pick('profile', 'goldenCombos');
LY.pick('gardener', 'cohort'); // the Full-garden replanter
LY.pick('soil', 'cohort');
LY.pick('seeds', 'bakerWheat');

// ---- the default
assert(/^replantAtTick = true\b/m.test(G.rulesOf()) && !LY.get('gardener', 'cohort').edited, 'the built-in: replantAtTick on by default');
assert(/24 h × 4 seeds/.test(G.rulesOf()) && /\+56\.0%/.test(G.rulesOf()), 'its code says why (the simulator’s sweep)');
assert(/just before the next tick/.test(LY.get('gardener', 'cohort').desc), 'its description too');

// ---- so a due round waits for the tick, the old plants working…
tiles.forEach(([x, y]) => set(x, y, 'bakerWheat', 60));
[[1, 2], [2, 2], [3, 2], [4, 2]].forEach(([x, y]) => set(x, y, null)); // 8 of 12: under 75%
M.soil = 2;
M.nextSoil = 0;
tickIn(600);
const before = M.harvestLog.length;
G.tend();
assert(M.harvestLog.length === before && young() === 0 && M.soilsById[M.soil].key === 'fertilizer', 'a round due: fertilizer, the old plants kept');
tickIn(10);
G.tend();
assert(M.harvestLog.length - before === 8 && young() === 12, '…and replanted in the last seconds before the tick');
// …and the safeguards stay: an empty plot is planted at once
tiles.forEach(([x, y]) => set(x, y, null));
M.nextSoil = 0;
tickIn(600);
G.tend();
assert(young() === 12, 'an empty plot: planted at once');

// ---- a copy you edited keeps its switch (saved and restored)
LY.set('gardener', 'cohort', { ...LY.get('gardener', 'cohort').data, rules: G.rulesOf().replace(/^replantAtTick = true/m, 'replantAtTick = false') });
assert(LY.get('gardener', 'cohort').edited, '(switched off: an edit of the built-in)');
Game.WriteSave();
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: Game.modSaveData.CookieMgr });
makeGarden(g2.Game);
await sleep(400);
const L2 = g2.window.CookieMgr.GardenLayers;
assert(L2.get('gardener', 'cohort').edited && /^replantAtTick = false\b/m.test(L2.get('gardener', 'cohort').data.rules), 'restored: your switch, off, kept');
L2.set('gardener', 'cohort', null);
assert(/^replantAtTick = true\b/m.test(L2.get('gardener', 'cohort').data.rules), 'Revert: the new default');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
