// v3.40.0: the "8 nursetulips together + clover combos" garden profile — two rows of four nursetulips
// (the Two rows of four template, Golden clover + nursetulip seeds), the Tulip and clover rounds
// gardener (the tulips replanted all together once fewer than half are mature, the clovers on rounds
// of their own as the Full-garden replanter does) and the Clovers grow together, then clay soil rule
// (young tulips don't hold fertilizer on). The garden words under it: garden.seedTiles / seedMature /
// seedYoung (seed) and garden.plantEmpty(seed).
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const M = makeGarden(Game);
// the game's plot sizes; Farm level 8: x 0–5, y 1–5 (6×5, Nuno's garden)
M.plotLimits = [[2, 2, 4, 4], [2, 2, 5, 4], [2, 2, 5, 5], [1, 2, 5, 5], [1, 1, 5, 5], [1, 1, 6, 5], [1, 1, 6, 6], [0, 1, 6, 6], [0, 0, 6, 6]];
Game.Objects.Farm.level = 8;
await sleep(400);
const G = CA.Garden;
const LY = CA.GardenLayers;
const S = CA.Script;
const val = (src) => S.evaluate(S.compile(`wait until ${src}`).flow[0].cond).ok;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const age = (x, y) => M.plot[y][x][1];
const TULIPS = [];
const CLOVERS = [];
for (let y = 1; y <= 5; y++) for (let x = 0; x <= 5; x++) ((y === 2 || y === 4) && x >= 1 && x <= 4 ? TULIPS : CLOVERS).push([x, y]);
const tickIn = (s) => (M.nextStep = Date.now() + s * 1000);
const soil = () => M.soilsById[M.soil].key;
const count = (tiles, f) => tiles.filter(([x, y]) => f(x, y)).length;
M.plants.goldenClover.unlocked = 1;
M.plants.nursetulip.unlocked = 1;
Game.cookies = 1e15;

// ---- the profile and its four parts
const prof = LY.get('profile', 'tulipCombos');
assert(prof && prof.builtin && prof.name === '8 nursetulips together + clover combos', 'a built-in profile: 8 nursetulips together + clover combos');
assert(LY.list('profile').some((p) => p.id === 'goldenCombos'), 'next to Golden clover combos');
LY.pick('profile', 'tulipCombos');
const picks = LY.picks();
assert(picks.gardener === 'tulipRounds' && picks.soil === 'tulips' && picks.template === 'tulipRows' && picks.seeds === 'goldenTulips', `it picks Tulip and clover rounds, Tulips grow then clay, Two rows of four, Golden clover + nursetulip (${JSON.stringify(picks)})`);
const plot = G.active().plot;
assert(TULIPS.every(([x, y]) => plot[y][x] === 'nursetulip') && CLOVERS.every(([x, y]) => plot[y][x] === 'goldenClover'), 'level 8: two rows of four nursetulips inside the plot, golden clovers on the other 22 tiles');
assert(plot[0].every((k) => !k), 'nothing on the locked top row');
assert(val('garden.seedTiles(nursetulip) == 8') && val('garden.seedTiles(goldenClover) == 22') && val('garden.layoutTiles() == 30'), 'garden.seedTiles: 8 tulips, 22 clovers');

// ---- an empty plot: everything planted at once, on fertilizer
M.soil = 2;
M.nextSoil = 0;
tickIn(600);
G.tend();
assert(count(TULIPS, (x, y) => at(x, y) === 'nursetulip' && age(x, y) === 0) === 8 && count(CLOVERS, (x, y) => at(x, y) === 'goldenClover' && age(x, y) === 0) === 22, 'an empty plot: the 8 tulips and 22 clovers planted');
assert(soil() === 'fertilizer', 'fertilizer while the clovers grow');
assert(val('garden.seedYoung(nursetulip) == 8') && val('garden.seedMature(nursetulip) == 0'), 'garden.seedYoung / seedMature');

// ---- the clovers mature, the tulips still growing: clay — the tulips don't hold fertilizer on
// (Clovers grow together, then clay; the profile's own soil rule since is Tulips grow, then clay)
LY.pick('soil', 'clovers');
CLOVERS.forEach(([x, y]) => set(x, y, 'goldenClover', 55));
TULIPS.forEach(([x, y]) => set(x, y, 'nursetulip', 20));
M.nextSoil = 0;
G.tend();
assert(soil() === 'clay', 'clovers mature, tulips young: clay');

// ---- the tulips: a dead one isn't replanted while half are mature…
TULIPS.forEach(([x, y], i) => set(x, y, i < 4 ? 'nursetulip' : null, 70));
let before = M.harvestLog.length;
G.tend();
assert(count(TULIPS, (x, y) => !at(x, y)) === 4 && M.harvestLog.length === before, '4 of 8 tulips mature, 4 dead: left as they are');
// …and once fewer than half are, all 8 are planted again together (the clovers untouched)
set(1, 2, null);
G.tend();
assert(count(TULIPS, (x, y) => at(x, y) === 'nursetulip' && age(x, y) === 0) === 8, '3 of 8 mature: the tulips replanted all together');
assert(M.harvestLog.length - before === 3 && M.harvestLog.slice(before).every((h) => /^nursetulip/.test(h)), 'the 3 still alive harvested, nothing else');
assert(count(CLOVERS, (x, y) => at(x, y) === 'goldenClover' && age(x, y) === 55) === 22, 'the clovers untouched');

// ---- the clovers: a round due goes down at once on fertilizer (no end-of-tick window), only the clovers replanted
TULIPS.forEach(([x, y]) => set(x, y, 'nursetulip', 70));
CLOVERS.forEach(([x, y], i) => set(x, y, i < 10 ? null : 'goldenClover', 60)); // 12 of 22: under 75%
M.nextSoil = 0;
tickIn(600);
before = M.harvestLog.length;
G.tend();
assert(soil() === 'fertilizer' && count(CLOVERS, (x, y) => at(x, y) === 'goldenClover' && age(x, y) === 0) === 22, 'a clover round due, 10 minutes before the tick: fertilizer, and the whole clover round planted at once');
assert(M.harvestLog.length - before === 12 && M.harvestLog.slice(before).every((h) => /^goldenClover/.test(h)), 'only the clovers harvested');
assert(count(TULIPS, (x, y) => at(x, y) === 'nursetulip' && age(x, y) === 70) === 8, 'the tulips untouched');

// ---- garden.plantEmpty(seed): only that seed's tiles; garden.plantEmpty(): every tile, as before
TULIPS.forEach(([x, y]) => set(x, y, null));
CLOVERS.forEach(([x, y]) => set(x, y, null));
CA.Macros.runPass(S.compile('garden.plantEmpty(nursetulip)').flow);
assert(count(TULIPS, (x, y) => at(x, y)) === 8 && count(CLOVERS, (x, y) => at(x, y)) === 0, 'garden.plantEmpty(nursetulip): the tulip tiles only');
CA.Macros.runPass(S.compile('garden.plantEmpty()').flow);
assert(count(CLOVERS, (x, y) => at(x, y)) === 22, 'garden.plantEmpty(): the rest too');

// ---- the code says why, and its knobs
const rules = LY.get('gardener', 'tulipRounds').data;
assert(/\+107%/.test(rules.rules) && /CpS ×0\.881/.test(rules.rules), 'the gardener’s code gives the simulated numbers');
assert(rules.knobs.tulipReplantBelow && rules.knobs.replantBelow && !rules.knobs.replantAtTick && !rules.knobs.plantWindow, 'its knobs (no end-of-tick window for the clovers)');
assert(S.compile(rules.rules).errors.length === 0 && S.compile(LY.get('soil', 'clovers').data.rules).errors.length === 0, 'the gardener and soil rule compile');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
