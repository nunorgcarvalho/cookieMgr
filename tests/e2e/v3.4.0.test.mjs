// v3.4.0: two replanting gardeners — the Steady replanter (the old Effect maximizer: each plant
// replaced as it dies) and the Full-garden replanter (the whole layout planted and replanted
// together: fertilizer while it grows, clay once most of it is mature) with its soil rule and the
// Golden clover combos profile; "Fertilizer, then clay" now at 0.9. And knobs: the variables at the
// top of a gardener's or soil rule's code as sliders / switches above it, in step with the code,
// with how each shows (kind, range, step, unit, hidden) kept with the algorithm.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
const M = makeGarden(Game); // 12 tiles: x 1–4, y 2–4
await sleep(400);
const G = CA.Garden;
const LY = CA.GardenLayers;
const K = CA.UI.CodeKnobs;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const tiles = [];
for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) tiles.push([x, y]);
const soil = () => M.soilsById[M.soil].key;
const tend = () => {
  M.nextSoil = 0;
  return G.tend();
};
Game.cookies = 1e12;

// ---- the knobs, on their own: variables found, values written back (comments kept)
const src = 'a = 0.5   # a share\nn = 15\nflag = true\nif n > 3:\n  inner = 4\na = 0.9\nx = garden.tickIn()\n';
assert(K.scan(src).map((v) => `${v.name}=${v.value}`).join() === 'a=0.5,n=15,flag=true', 'found: top-level number / true-false lines, the first of each (not indented, not expressions)');
assert(K.setIn(src, 'a', 0.75).split('\n')[0] === 'a = 0.75   # a share' && K.setIn(src, 'a', 0.75).split('\n')[5] === 'a = 0.9', 'set: that line’s value, its comment kept (a later one untouched)');
assert(K.setIn(src, 'flag', false).includes('flag = false') && K.setIn(src, 'n', 20).includes('n = 20'), 'numbers and true/false');
const kinds = (s) => K.scan(s).map((v) => K.specOf(v, {}).kind).join();
assert(kinds('dyingOver = 0.5\nclayAt = 1\nhalf = 0.3\ntickWindow = 15\non = false\n') === 'percent,percent,percent,number,toggle', 'what suits a value: shares are percentages, others number sliders, true/false switches');
const tw = K.specOf({ name: 'tickWindow', value: 15 }, {});
assert(tw.min === 0 && tw.max === 100 && tw.step === 1 && tw.unit === 's', `a number: 0 to a nice top, whole steps, a unit from its name (${JSON.stringify(tw)})`);

// ---- the gardeners and the profile
assert(LY.get('gardener', 'effects').name === 'Steady replanter' && LY.get('gardener', 'cohort').name === 'Full-garden replanter', 'the Steady replanter (was the Effect maximizer) and the Full-garden replanter');
assert(LY.get('soil', 'effects').data.rules.includes('fertilizerAbove = 0.9') && LY.has('soil', 'cohort'), '“Fertilizer, then clay” at 0.9; the “Grow together, then clay” soil rule');
['cohort'].forEach((id) => assert(!G.compileRules(LY.get('gardener', id).data.rules).errors.length && !G.compileRules(LY.get('soil', id).data.rules).errors.length, 'they compile'));
LY.pick('profile', 'goldenCombos');
assert(LY.picked('gardener') === 'cohort' && LY.picked('soil') === 'cohort' && LY.picked('template') === 'fill' && LY.picked('seeds') === 'goldenClover', 'the Golden clover combos profile');
LY.pick('seeds', 'bakerWheat'); // (golden clover isn't unlocked here)

// ---- a round: planted together on fertilizer, held on clay, replanted together
M.soil = 0;
M.nextStep = Date.now() + 10e3; // (v3.4.2: a round is planted in the last seconds before a tick)
tend();
assert(tiles.every(([x, y]) => at(x, y) === 'bakerWheat' && M.plot[y][x][1] === 0) && soil() === 'fertilizer', 'an empty garden: the whole layout planted at once; fertilizer while it grows');
tiles.slice(0, 2).forEach(([x, y]) => set(x, y, 'bakerWheat', 40)); // 2 of 12 mature: under 25%
tend();
assert(soil() === 'fertilizer', '2 of 12 mature: still growing, fertilizer');
tiles.slice(2, 3).forEach(([x, y]) => set(x, y, 'bakerWheat', 40)); // 3 of 12: 25%
tend();
assert(soil() === 'clay', '3 of 12 (25%) mature: clay');
tiles.forEach(([x, y]) => set(x, y, 'bakerWheat', 60)); // all mature
set(1, 2, null); // two died
set(2, 2, null);
set(3, 2, 'meddleweed', 1); // a weed on the layout's tile
tend();
assert(at(1, 2) === null && at(2, 2) === null && at(3, 2) === null && soil() === 'clay', 'plants that die aren’t replanted; a weed is cleared; 9 of 12 mature left: still on clay');
set(4, 2, null); // 8 of 12 left: under 75%
const before = M.harvestLog.length;
M.nextStep = Date.now() + 10e3;
tend();
assert(tiles.every(([x, y]) => at(x, y) === 'bakerWheat' && M.plot[y][x][1] === 0) && M.harvestLog.length - before === 8 && soil() === 'fertilizer', `under 75% left: everything harvested and the whole layout replanted, fertilizer again (${M.harvestLog.length - before} harvested)`);

// ---- the knobs above the code, on the Garden page
CA.UI.Menu.openPage('garden');
const card = () => doc.querySelector('[data-page="garden"] [data-gp-rules]');
const q = (s) => card().querySelector(s);
click(w, q('[data-gp-slot="gardener"]'));
const ta = () => q('[data-code-ed="garden"] [data-code]');
const range = (n) => q(`[data-knob="${n}"]`);
const num = (n) => q(`[data-knob-num="${n}"]`);
assert(q('[data-knobs]') && range('replantBelow') && range('replantBelow').min === '0' && range('replantBelow').max === '100' && range('replantBelow').step === '5' && num('replantBelow').value === '75', 'the Full-garden replanter’s knobs: replantBelow as a percentage (0–100% in 5% steps, at 75%)');
assert(q('[data-knob-toggle="unlockNewSeeds"]').classList.contains('on'), 'unlockNewSeeds: a switch, on');
// slider → code
range('replantBelow').value = '60';
range('replantBelow').dispatchEvent(new w.Event('input', { bubbles: true }));
assert(/^replantBelow = 0\.6 {3}# start a new round/m.test(ta().value) && num('replantBelow').value === '60' && /unsaved/.test(q('[data-gp-dhead]').textContent), 'the slider: into its line of the code (comment kept), the box follows, unsaved');
// typed → code
num('replantBelow').value = '72.5';
num('replantBelow').dispatchEvent(new w.Event('change', { bubbles: true }));
assert(/^replantBelow = 0\.725/m.test(ta().value) && num('replantBelow').value === '72.5' && Math.abs(Number(range('replantBelow').value) - 72.5) <= 2.5, 'a value typed in: exact, into the code (the slider moves to its nearest step)');
// switch → code
click(w, q('[data-knob-toggle="unlockNewSeeds"]'));
assert(/^unlockNewSeeds = false/m.test(ta().value) && !q('[data-knob-toggle="unlockNewSeeds"]').classList.contains('on'), 'the switch: true/false in the code');
// code → knobs
ta().value = ta().value.replace('replantBelow = 0.725', 'replantBelow = 0.5') + 'myLimit = 12   # my own number\n';
ta().dispatchEvent(new w.Event('input', { bubbles: true }));
assert(num('replantBelow').value === '50' && range('myLimit') && range('myLimit').max === '50' && num('myLimit').value === '12', 'typing in the code: the knob follows; a new variable gets a knob that suits it');
// how a variable shows: ⚙
click(w, q('[data-knob-cfg="myLimit"]'));
const field = (f) => q(`[data-knob-field="${f}"][data-knob-of="myLimit"]`);
field('max').value = '200';
field('max').dispatchEvent(new w.Event('change', { bubbles: true }));
field('unit').value = 'plants';
field('unit').dispatchEvent(new w.Event('change', { bubbles: true }));
assert(range('myLimit').max === '200' && /plants/.test(q('[data-knob-row="myLimit"]').textContent), '⚙: its range and unit');
const kind = q('[data-knob-kind="myLimit"]');
kind.value = 'hidden';
kind.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(!range('myLimit') && q('[data-knob-unhide="myLimit"]'), 'hidden: off the knobs, listed to bring back');
click(w, q('[data-knob-unhide="myLimit"]'));
assert(range('myLimit') && range('myLimit').max === '50', 'brought back: as suits it again');
click(w, q('[data-gp-act="save"]'));
const saved = LY.get('gardener', 'cohort');
assert(saved.edited && /^replantBelow = 0\.5/m.test(saved.data.rules) && /^myLimit = 12/m.test(saved.data.rules) && saved.data.knobs.replantBelow.kind === 'percent', 'Save: the code, and the knobs with it');
// a knob's look is part of the algorithm: saved, restored
if (!field('max')) click(w, q('[data-knob-cfg="myLimit"]'));
field('max').value = '30';
field('max').dispatchEvent(new w.Event('change', { bubbles: true }));
click(w, q('[data-gp-act="save"]'));
assert(LY.get('gardener', 'cohort').data.knobs.myLimit.max === 30, 'a knob’s range saved with the gardener');
Game.WriteSave();
const g2 = boot({ idb: { factory: new IDBFactory(), IDBKeyRange }, save: Game.modSaveData.CookieMgr });
makeGarden(g2.Game);
await sleep(400);
assert(g2.window.CookieMgr.GardenLayers.get('gardener', 'cohort').data.knobs.myLimit.max === 30, 'restored');
// revert: the built-in, with its knobs
click(w, q('[data-gp-act="revert"]'));
click(w, q('[data-gp-act="revert"]'));
assert(!LY.get('gardener', 'cohort').edited && num('replantBelow').value === '75' && !range('myLimit'), 'Revert: the built-in code and knobs');

// ---- the soil rule's knobs
click(w, q('[data-gp-slot="soil"]'));
assert(num('clayAt') && num('clayAt').value === '25' && range('clayAt').step === '5', 'the soil rule (Grow together, then clay): clayAt as a percentage');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
