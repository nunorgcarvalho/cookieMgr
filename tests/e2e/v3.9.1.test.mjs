// v3.9.1: the Full-garden replanter plants an empty plot at once (it used to wait for the next
// tick); when a new round is planted is a knob — replantAtTick: false at once, true (the default since v3.10.1)
// fertilizer first and the old plants kept until the last seconds before the tick. And Cookie
// Monster's own suffixes and spacing for long numbers (…SpDe, ODe, NDe, Vi… UCt).
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
const F = CA.Format;
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const tiles = [];
for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) tiles.push([x, y]);
const soil = () => M.soilsById[M.soil].key;
const tickIn = (s) => (M.nextStep = Date.now() + s * 1000);
const young = () => tiles.filter(([x, y]) => at(x, y) && M.plot[y][x][1] === 0).length;
const clear = () => tiles.forEach(([x, y]) => set(x, y, null));
const atTick = (on) => LY.set('gardener', 'cohort', { ...LY.get('gardener', 'cohort').data, rules: LY.get('gardener', 'cohort').data.rules.replace(/^replantAtTick = (true|false)/m, `replantAtTick = ${on}`) });
Game.cookies = 1e12;
LY.pick('profile', 'goldenCombos');
LY.pick('gardener', 'cohort'); // the Full-garden replanter
LY.pick('soil', 'cohort');
LY.pick('seeds', 'bakerWheat');

// ---- the knob: when a new round is planted — at once by default
assert(/^replantAtTick = true\b/m.test(G.rulesOf()) && LY.get('gardener', 'cohort').data.knobs.replantAtTick.kind === 'toggle', 'replantAtTick: a switch, on by default (v3.10.1 — the simulator’s sweep; it was off in v3.9.1)');
assert(/replantAtTick only/.test(G.rulesOf().split('\n').find((l) => /^plantWindow/.test(l))), 'plantWindow says it only matters with replantAtTick');

// ---- an empty plot, the tick 10 minutes away: planted on the first pass — in both modes
for (const mode of [false, true]) {
  atTick(mode);
  clear();
  M.soil = 2;
  M.nextSoil = 0;
  tickIn(600);
  G.tend();
  assert(young() === 12 && soil() === 'fertilizer', `replantAtTick = ${mode}: an empty plot planted at once, on fertilizer (${young()} planted)`);
}

// ---- a round due, with mature plants left
const due = () => {
  tiles.forEach(([x, y]) => set(x, y, 'bakerWheat', 60));
  [[1, 2], [2, 2], [3, 2], [4, 2]].forEach(([x, y]) => set(x, y, null)); // 8 of 12: under 75%
  M.soil = 2;
  M.nextSoil = 0;
  tickIn(600);
};
atTick(false);
due();
let before = M.harvestLog.length;
G.tend();
assert(M.harvestLog.length - before === 8 && young() === 12 && soil() === 'fertilizer', 'at once (replantAtTick off): the 8 left harvested and the whole layout planted now, on fertilizer');
atTick(true);
due();
before = M.harvestLog.length;
G.tend();
assert(M.harvestLog.length === before && young() === 0 && soil() === 'fertilizer', 'replantAtTick: fertilizer, the old plants kept working, the empty tiles waiting with them');
tickIn(10);
G.tend();
assert(M.harvestLog.length - before === 8 && young() === 12, '…then in the last seconds before the tick: everything replanted');
atTick(true);
assert(!LY.get('gardener', 'cohort').edited, '(back to the built-in)');

// ---- Cookie Monster's suffixes (its own lists), with its space
CA.Settings.set('numberFormat', 'abbr'); // the default until v3.17.0
const eq = (got, want, what) => assert(got === want, `${what}: ${JSON.stringify(got)}${got === want ? '' : ` (wanted ${JSON.stringify(want)})`}`);
eq(F.beautify(1.5e6), '1.5 M', 'a space before the suffix');
eq(F.beautify(1e33), '1 De', 'decillion: De');
eq(F.beautify(1e36), '1 UDe', 'undecillion: UDe');
eq(F.beautify(4.56e54), '4.56 SpDe', 'septendecillion: SpDe');
eq(F.beautify(1e57), '1 ODe', 'octodecillion: ODe');
eq(F.beautify(1e60), '1 NDe', 'novemdecillion: NDe');
eq(F.beautify(999.96e57), '1 NDe', '999.96 ODe rolls over to 1 NDe');
eq(F.beautify(1e63), '1 Vi', 'vigintillion: Vi');
eq(F.beautify(1e93), '1 Tr', 'trigintillion: Tr');
eq(F.beautify(1e303), '1 Ct', 'centillion: Ct');
eq(F.beautify(1.5e308), '150 UCt', 'its last, UCt, reaches the largest number there is (~1.8e308)');
eq(F.short(1234), '1.23K', 'short() stays compact (axes): no space');
CA.Settings.set('numberFormat', 'short');
eq(F.beautify(1.5e12), '1.5 Tr', 'short scale: Tr');
eq(F.beautify(1e75), '1 Quattuorvigint', 'short scale: its last, Quattuorvigint');
eq(F.beautify(1e78), '1e78', 'short scale: past it, scientific');
CA.Settings.set('numberFormat', 'metric');
eq(F.beautify(1e24), '1 Y', 'metric: its last, Y');
eq(F.beautify(1e27), '1e27', 'metric: past it, scientific');
CA.Settings.set('numberFormat', 'abbr');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
