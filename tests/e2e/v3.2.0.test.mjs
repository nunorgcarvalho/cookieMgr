// v3.2.0: the auto-gardener in two layers, picked separately — a layout (a garden profile, or the
// built-in Current garden: what's planted, kept as it is) and a gardener (its behavior, as code:
// the built-in Effect maximizer, Weed collector and Mutation tracker, or your own). (v3.3: four
// layers and profiles — the page and the save are in v3.3.0's test.)
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const M = makeGarden(Game); // tiles x 1–4, y 2–4
await sleep(400);
const G = CA.Garden;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const clear = () => M.plot.forEach((r) => r.forEach((t) => ((t[0] = 0), (t[1] = 0))));
const soil = () => M.soilsById[M.soil].key;
const tend = () => {
  M.nextSoil = 0;
  return G.tend();
};
Game.cookies = 1e12;

// ---- the built-in gardeners
const list = CA.GardenLayers.list('gardener');
assert(list.map((x) => x.id).join() === 'effects,cohort,tulipRounds,weeds,mutations' && list.every((x) => x.builtin && !x.edited && x.desc), `the built-in gardeners (v3.4: four; v3.40: Tulip and clover rounds) (${list.map((x) => x.name).join(', ')})`);
list.forEach((x) => assert(G.compileRules(G.gardenerRules(x.id)).errors.length === 0, `${x.name}: its code compiles (${JSON.stringify(G.compileRules(G.gardenerRules(x.id)).errors)})`));
assert(G.activeGardener().id === 'effects' && G.rulesOf() === G.defaultRules(), 'the Effect maximizer by default');

// ---- the Current garden: the layout when none is picked
set(1, 2, 'bakerWheat', 5);
set(2, 2, 'thumbcorn', 5);
set(3, 2, 'meddleweed', 5); // a weed: not adopted
const LY = CA.GardenLayers;
assert(LY.picked('profile') === 'maxEffects' && LY.picked('template') === G.CURRENT && LY.picked('seeds') === G.CURRENT && G.active().name === 'Current garden', 'by default (v3.3: the Max effects profile): the Current garden');
const cur = G.active();
assert(cur.plot[2][1] === 'bakerWheat' && cur.plot[2][2] === 'thumbcorn' && cur.plot[2][3] === null, 'it takes what’s planted (not weeds)');
// a plant dies: replanted; an empty tile it didn't have stays empty
set(1, 2, null);
M.nextStep = Date.now() + 200 * 1000;
tend();
assert(at(1, 2) === 'bakerWheat' && at(4, 4) === null, 'a plant that died: replanted; other empty tiles stay empty');
// a mutation that springs up isn't adopted — the Effect maximizer leaves tiles the layout has nothing for
set(4, 2, 'thumbcorn', 0);
M.nextStep = Date.now() + 5000;
tend();
assert(G.active().plot[2][4] === null && at(4, 2) === 'thumbcorn' && at(3, 2) === 'meddleweed', 'a mutation isn’t adopted; tiles it has nothing for are left alone');
// your own clicks are: plant by hand, harvest by hand
M.seedSelected = M.plants.bakerWheat.id;
M.clickTile(4, 4);
M.seedSelected = -1;
M.clickTile(2, 2); // harvests the thumbcorn
assert(G.active().plot[4][4] === 'bakerWheat' && G.active().plot[2][2] === null, 'what you plant or harvest by hand, it follows');
tend();
assert(at(2, 2) === null && at(4, 4) === 'bakerWheat', '…and doesn’t replant what you harvested');

// ---- the Weed collector
clear();
G.useGardener('weeds');
LY.pick('soil', 'fertilizer'); // v3.3: the soil is the soil rule's
set(1, 2, 'meddleweed', 20); // young weed: left to grow
set(2, 2, 'meddleweed', 95); // old: very likely to die on the tick → harvested
set(3, 2, 'goldenClover', 10); // a new seed: grows on
set(4, 2, 'goldenClover', 60); // …mature: harvested (unlocks it)
set(1, 3, 'thumbcorn', 30); // a plant you have: cleared
M.soil = 0;
tend();
assert(soil() === 'fertilizer', 'Weed collector: fertilizer');
assert(at(1, 2) === 'meddleweed' && at(2, 2) === null, 'old meddleweed harvested, young left');
assert(at(3, 2) === 'goldenClover' && at(4, 2) === null && M.plants.goldenClover.unlocked === 1, 'a new seed: grows until mature, then harvested (unlocked)');
assert(at(1, 3) === null && M.plot.flat().filter((t) => t[0]).length === 2, 'what you have: cleared; nothing planted');
assert(G.lastPass().gardener === 'weeds', 'the last pass says which gardener');

// ---- the Mutation tracker, with a profile (the parents): wheat on 1,2 and 3,2
M.plants.goldenClover.unlocked = 0;
clear();
set(1, 2, 'bakerWheat', 5);
set(3, 2, 'bakerWheat', 5);
const parents = G.snapshot('Parents');
assert(LY.picked('profile') === parents.id, 'a profile from the garden: loaded');
G.useGardener('mutations');
LY.pick('soil', 'mutations');
set(3, 2, null);
M.soil = 0;
tend();
assert(at(3, 2) === 'bakerWheat' && soil() === 'fertilizer', 'plants the parents; fertilizer while they grow');
set(1, 2, 'bakerWheat', 40);
set(3, 2, 'bakerWheat', 40);
tend();
assert(soil() === 'fertilizer', 'parents mature but no wood chips (300 farms): fertilizer');
Game.Objects.Farm.amount = 400;
tend();
assert(soil() === 'woodchips', 'with 300 farms: wood chips');
// mutations on the other tiles
set(2, 2, 'thumbcorn', 0); // a seed you have: out at once
set(2, 3, 'goldenClover', 10); // new: kept
set(4, 3, 'goldenClover', 10); // a second one: kept
tend();
assert(at(2, 2) === null && at(2, 3) === 'goldenClover' && at(4, 3) === 'goldenClover', 'a seed you have: cleared at once; a new one: kept');
set(2, 3, 'goldenClover', 55);
tend();
assert(at(2, 3) === null && M.plants.goldenClover.unlocked === 1, 'once mature: harvested (unlocked)');
assert(at(4, 3) === 'goldenClover' && G.compileRules('x = garden.unlockedAgo("goldenClover")').errors.length === 0, 'a copy of a just-unlocked seed: still kept');
set(4, 3, 'goldenClover', 55);
tend();
assert(at(4, 3) === null && at(1, 2) === 'bakerWheat' && at(3, 2) === 'bakerWheat', '…until it’s mature too; the parents stay');

// ---- the values the gardeners use
const ev = (src) => CA.Script.evaluate(CA.Script.compile(`wait until ${src}`).flow[0].cond);
assert(ev('garden.isUnlocked(bakerWheat)').ok && !ev('garden.isUnlocked(elderwort) == false').ok, 'garden.isUnlocked');
assert(ev('garden.unlockedAgo(goldenClover) < 60').ok && ev('garden.unlockedAgo(thumbcorn) > 1000000').ok, 'garden.unlockedAgo: seconds since, huge when never seen');
assert(ev('garden.soilAvailable(woodchips)').ok && ev('garden.soilAvailable(clay)').ok, 'garden.soilAvailable');
assert(ev('garden.layoutYoungShare() == 0').ok, 'garden.layoutYoungShare: the layout’s own plants');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
