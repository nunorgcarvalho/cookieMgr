// Clay switch: the clover soil rules go to clay once a quarter of a round is mature (clayAt 25%, was 75%) and
// stay on clay until the next round — a clover gone (an empty tile) means the round has grown, so clovers
// dying while a few others still grow don't bring fertilizer back. The Tulip and clover rounds gardener
// fills a clover round's empty tiles only while none of it is mature: later, a clover that died would be
// replanted while the rest grow, the round would never end and the soil would sit on fertilizer.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const CA = g.window.CookieMgr;
const M = makeGarden(g.Game);
M.plotLimits = [[2, 2, 4, 4], [2, 2, 5, 4], [2, 2, 5, 5], [1, 2, 5, 5], [1, 1, 5, 5], [1, 1, 6, 5], [1, 1, 6, 6], [0, 1, 6, 6], [0, 0, 6, 6]];
g.Game.Objects.Farm.level = 8;
await sleep(400);
const LY = CA.GardenLayers;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const soil = () => M.soilsById[M.soil].key;
const TULIPS = [];
const CLOVERS = [];
for (let y = 1; y <= 5; y++) for (let x = 0; x <= 5; x++) ((y === 2 || y === 4) && x >= 1 && x <= 4 ? TULIPS : CLOVERS).push([x, y]);
LY.pick('profile', 'tulipCombos');
/** The soil the rule picks: the tulips mature, `mature` clovers mature, `young` growing, the rest empty. */
function pick(mature, young) {
  TULIPS.forEach(([x, y]) => set(x, y, 'nursetulip', 70));
  CLOVERS.forEach(([x, y], i) => set(x, y, i < mature + young ? 'goldenClover' : null, i < mature ? 55 : 10));
  M.soil = 2;
  M.nextSoil = 0;
  CA.Macros.runPass(CA.Script.compile('garden.soilRule()').flow);
  return soil();
}
for (const id of ['tulips', 'clovers']) {
  LY.pick('soil', id);
  const rule = LY.get('soil', id).data;
  assert(CA.Script.compile(rule.rules).errors.length === 0 && /clayAt = 0\.25/.test(rule.rules), `${id}: compiles, clayAt 25%`);
  assert(pick(0, 22) === 'fertilizer', `${id}: a new round growing: fertilizer`);
  assert(pick(5, 17) === 'fertilizer', `${id}: 5 of 22 mature (under a quarter): fertilizer`);
  assert(pick(6, 16) === 'clay', `${id}: 6 of 22 mature: clay`);
  assert(pick(3, 15) === 'clay', `${id}: 3 mature, 15 growing, 4 gone: clay until the next round`);
  assert(pick(0, 13) === 'fertilizer', `${id}: a round planted short, none of it mature: fertilizer`);
}
// Grow together, then clay (the Full-garden replanter's), on the layout's tiles
LY.pick('profile', 'goldenCombos');
const ALL = [];
for (let y = 1; y <= 5; y++) for (let x = 0; x <= 5; x++) ALL.push([x, y]); // level 8: 6×5
function pickAll(mature, young) {
  ALL.forEach(([x, y], i) => set(x, y, i < mature + young ? 'goldenClover' : null, i < mature ? 55 : 10));
  M.soil = 2;
  M.nextSoil = 0;
  CA.Macros.runPass(CA.Script.compile('garden.soilRule()').flow);
  return soil();
}
assert(LY.picks().soil === 'cohort', `Golden clover combos: Grow together, then clay (${LY.picks().soil})`);
assert(pickAll(7, 23) === 'fertilizer' && pickAll(8, 22) === 'clay', 'cohort: clay from a quarter mature');
assert(pickAll(5, 20) === 'clay', 'cohort: plants gone, a few still growing: clay');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
