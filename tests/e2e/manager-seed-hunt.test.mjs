// A manager's garden profile whose seeds aren't all unlocked (golden clover and nursetulip for the tulip
// combos, after a sacrificed garden): the weed farm alone never grows them, so the profile never went in.
// Meanwhile the manager breeds them with the Mutation hunt, the next recipe on the way whose parents are
// unlocked (Whiskerbloom on the way to Nursetulip…), the weed farm only when weeds bring the next one.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w } = g;
const CA = w.CookieMgr;
await sleep(400);
const G = CA.Managers;
const L = CA.GardenLayers;
CA.Macros.set('manager', false, { silent: true });

const farm = CA.Util.minigame('Farm');
const KEYS = ['bakerWheat', 'thumbcorn', 'cronerice', 'gildmillet', 'clover', 'goldenClover', 'shimmerlily', 'brownMold', 'whiteMildew', 'chocoroot', 'whiteChocoroot', 'whiskerbloom', 'nursetulip'];
const plants = {};
KEYS.forEach((k) => (plants[k] = { name: L.NAMES[k], unlocked: 1 }));
farm.plants = plants;
const lock = (...ks) => ks.forEach((k) => (plants[k].unlocked = 0));
const unlock = (...ks) => ks.forEach((k) => (plants[k].unlocked = 1));
const pending = () => (G.where().pending || []).find((x) => x.kind === 'garden');
const run = (n = 3) => {
  for (let i = 0; i < n; i++) G.step();
};

// Nunix late game, Reindeer: the garden on tulip combos
lock('goldenClover', 'nursetulip', 'whiskerbloom');
G.goTo(2);
run();
assert(L.picked('profile') === 'mutationHunt' && L.picked('seeds') === 'to-clover', `golden clover first: Baker’s wheat × Gildmillet (${L.picked('profile')}, ${L.picked('seeds')})`);
let p = pending();
assert(p && /Golden clover, Nursetulip unlocked/.test(p.waits) && /breeding Golden clover meanwhile/.test(p.waits), `the manager says so: ${p && p.waits}`);

unlock('goldenClover');
run();
assert(L.picked('profile') === 'mutationHunt' && L.picked('seeds') === 'to-whiskerbloom', `then Whiskerbloom, on the way to Nursetulip (${L.picked('seeds')})`);
p = pending();
assert(p && /breeding Whiskerbloom on the way to Nursetulip/.test(p.waits), `waits: ${p && p.waits}`);

unlock('whiskerbloom');
run();
assert(L.picked('seeds') === 'to-nursetulip', `then Whiskerbloom × Whiskerbloom (${L.picked('seeds')})`);

// a step only weeds bring (no brown mold for the chocoroot): the weed farm
lock('whiskerbloom', 'whiteChocoroot', 'chocoroot', 'brownMold');
run();
assert(L.picked('profile') === 'weedFarm', `brown mold missing: the weed farm (${L.picked('profile')})`);
p = pending();
assert(p && /the weed farm meanwhile/.test(p.waits), `waits: ${p && p.waits}`);
// brown mold sprang up (and its chocoroot): White chocoroot next, or White mildew first when it's locked too
unlock('brownMold', 'chocoroot');
run();
assert(L.picked('profile') === 'mutationHunt' && L.picked('seeds') === 'to-whiteChocoroot', `then White chocoroot (${L.picked('seeds')})`);
lock('whiteMildew');
run();
assert(L.picked('seeds') === 'to-whiteMildew', `white mildew from brown mold (${L.picked('seeds')})`);

// all in: the profile goes in, and stays
unlock(...KEYS);
run();
assert(L.picked('profile') === 'tulipCombos' && !L.profileChanged() && !pending(), `every seed unlocked: the tulip combos (${L.picked('profile')})`);

// no garden: the weed farm, waiting for it
delete farm.plot;
assert(L.seedHunt('tulipCombos') === null && L.missingKeys('tulipCombos') === null, 'no garden: nothing to hunt');

CA.Macros.list().forEach((m) => CA.Macros.isOn(m.id) && CA.Macros.set(m.id, false, { silent: true }));
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
