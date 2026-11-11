// Garden in the queue: what the gardener plants next is a thing the Auto buyer ranks and buys — a seed's
// empty tiles while its round grows ("Plant 9 Golden clover"), or a new round once one is due ("Replant
// 22 Golden clover"). Its gain is the golden cookie income the grown plants add (Actual income less CpS +
// clicking, × the garden's golden cookie frequency gain). Garden things may spend the garden's own banks,
// wait out effects that make seeds more expensive, and the clovers wait for the nursetulips. And the Tulip and clover
// rounds gardener fills a clover round's empty tiles while it grows and none of it is mature yet — not later:
// a clover that died would be replanted while the rest still grow, and the round would never end.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, errors } = g;
const CA = w.CookieMgr;
const M = makeGarden(Game);
M.plotLimits = [[2, 2, 4, 4], [2, 2, 5, 4], [2, 2, 5, 5], [1, 2, 5, 5], [1, 1, 5, 5], [1, 1, 6, 5], [1, 1, 6, 6], [0, 1, 6, 6], [0, 0, 6, 6]];
Game.Objects.Farm.level = 8;
await sleep(400);
const B = CA.AutoBuyer;
const G = CA.Garden;
const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false }));
Game.UpgradesInStore = [];
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])) });
Game.CpsAchievements = [];
Game.CalculateGains();
const CPS = Game.cookiesPs;
// income: 50 × CpS actually taken in (49 × CpS of it golden cookies)
CA.Recorder.recent = (secs) => ({ actual: 50 * CPS, secs: Math.min(secs || 600, 3600), cps: CPS, clickRate: 0 });
M.plants.goldenClover.unlocked = 1;
M.plants.nursetulip.unlocked = 1;
G.use('tulipCombos');
M.soil = 2; // clay
M.nextSoil = Date.now() + 600e3;
M.nextStep = Date.now() + 600e3;

const at = (x, y) => (M.plot[y][x][0] ? M.plantsById[M.plot[y][x][0] - 1].key : null);
const set = (x, y, key, age = 0) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const TULIPS = [];
const CLOVERS = [];
for (let y = 1; y <= 5; y++) for (let x = 0; x <= 5; x++) ((y === 2 || y === 4) && x >= 1 && x <= 4 ? TULIPS : CLOVERS).push([x, y]);
const count = (tiles, f) => tiles.filter(([x, y]) => f(x, y)).length;
const CLOVER = 7.5e6 * (CPS / 1000); // 125 min of CpS
/** A clover round planted short: 13 young, 9 empty (cookies short at the time); the tulips grown. */
function stuck() {
  TULIPS.forEach(([x, y]) => set(x, y, 'nursetulip', 70));
  CLOVERS.forEach(([x, y], i) => set(x, y, i < 13 ? 'goldenClover' : null, 10));
}
/** Clovers half mature, half young, a few empty: 10 mature, 3 young, 9 empty. */
function drifting() {
  TULIPS.forEach(([x, y]) => set(x, y, 'nursetulip', 70));
  CLOVERS.forEach(([x, y], i) => set(x, y, i < 13 ? 'goldenClover' : null, i < 10 ? 55 : 10));
}

// ---- what the gardener plants next ----
stuck();
let list = G.plantings();
assert(list.length === 1 && list[0].seed === 'goldenClover' && list[0].n === 9 && !list[0].round, `13 young, 9 empty: plant the 9 (${JSON.stringify(list)})`);
assert(Math.abs(list[0].price - 9 * CLOVER) < 1, 'its price: 9 clovers today');
assert(list[0].freq > 1.15 && list[0].freq < 1.6 && list[0].cps === 1, `golden cookie frequency up (×${list[0].freq.toFixed(3)}), CpS the same`);
// part of it mature already: the empty tiles wait for the next round (filled, the round would never end)
drifting();
assert(G.plantings().length === 0, `10 mature, 3 young, 9 empty: nothing to plant (${JSON.stringify(G.plantings())})`);
// a round due: none young, under 75% mature
CLOVERS.forEach(([x, y], i) => set(x, y, i < 12 ? 'goldenClover' : null, 55));
list = G.plantings();
assert(list.length === 1 && list[0].round && list[0].n === 22 && Math.abs(list[0].price - 22 * CLOVER) < 1, 'a round due: replant all 22');
// mature round, enough of it: nothing (the round waits)
CLOVERS.forEach(([x, y], i) => set(x, y, i < 18 ? 'goldenClover' : null, 55));
assert(G.plantings().length === 0, '18 of 22 mature: the round waits, nothing to plant');

// ---- the gardener fills a round planted short, while none of it is mature ----
drifting();
Game.cookies = 1e15;
G.tend();
assert(count(CLOVERS, (x, y) => at(x, y) === 'goldenClover') === 13, 'part of the round mature: the gardener leaves the 9 empty tiles for the next round');
stuck();
G.tend();
assert(count(CLOVERS, (x, y) => at(x, y) === 'goldenClover') === 22, 'none of it mature: the gardener fills the 9 empty tiles');

// ---- in the queue ----
stuck();
Game.cookies = 30 * CLOVER;
const combos = B.find('combos');
assert(combos.kinds.garden === true && B.find('payback').kinds.garden === false, 'Golden cookie combos buys garden things; Payback doesn’t');
B.use('combos');
let q = B.queue('combos');
let row = q.items.concat(q.held).find((x) => x.key === 'garden:goldenClover');
assert(row && !row.why && row.label === 'Plant 9 Golden clover', `a queue row: ${row && row.label} ${row && row.why}`);
const gain = 49 * CPS * (G.plantings()[0].freq - 1);
assert(Math.abs(row.gain - gain) < 1e-6 * gain && Math.abs(row.pp - row.price / gain) < 1e-6 * row.pp, `its gain: golden income × the frequency gain (${row.gain} vs ${gain})`);
assert(Number.isFinite(row.score), `scored (${row.score})`);
assert(CA.Script.VALUES.find((v) => v.id === 'buyer.queue').get('combos').includes('garden:goldenClover'), 'buyer.queue lists it');

// bought: the garden's own banks don't hold it back
B.update('combos', { kinds: { building: false, upgrade: false, allUpgrades: false, garden: true }, banks: ['gardenRounds'], roundsMargin: 100 });
Game.cookies = 9 * CLOVER + 1;
q = B.queue('combos');
assert(q.next && q.next.key === 'garden:goldenClover' && !q.wait, `next: the clovers, though the Garden rounds bank isn't covered (${q.next && q.next.key}, waiting for ${q.wait && q.wait.key})`);
assert(B.buyNext('combos') === 1 && count(CLOVERS, (x, y) => at(x, y) === 'goldenClover') === 22, 'buyNext plants the 9');
assert(Game.cookies < CLOVER, 'and pays for them');
B.update('combos', { banks: ['lucky'] });
stuck();
Game.cookies = 1e3;
q = B.queue('combos');
assert(q.wait && q.wait.key === 'bank:lucky', 'another bank still holds it back');
B.update('combos', { banks: ['lucky', 'gardenRounds'], roundsMargin: 1.25 });

// held: no actual income, an effect, the tulips first
Game.cookies = 1e15;
Game.buffs = { Frenzy: { multCpS: 7 } };
Game.CalculateGains();
row = B.queue('combos').held.find((x) => x.key === 'garden:goldenClover');
assert(row && /more expensive/.test(row.why), `a Frenzy ending soon: held (${row && row.why})`);
// a Frenzy with longer left than the gardener waits out (frenzies back to back): today's price, not waited out
Game.buffs = { Frenzy: { multCpS: 7, time: 900 * (Game.fps || 30) } };
Game.CalculateGains();
assert(Math.abs(CA.Script.VALUES.find((v) => v.id === 'garden.priceBoostLeft').get() - 900) < 1, 'garden.priceBoostLeft: 15 min');
Game.cookies += 1; // a new queue (it's memoized for a moment on the bank)
row = B.queue('combos').items.find((x) => x.key === 'garden:goldenClover');
assert(row && Math.abs(row.price - 9 * 7 * CLOVER) < 9 * 7, `15 min of Frenzy left: in the queue at today's price (${row && row.price})`);
assert(Math.abs(row.gain - 49 * CPS * (G.plantings()[0].freq - 1)) < 1e-6 * row.gain, 'its gain counts CpS + clicking without the Frenzy (the Frenzy is golden cookie income)');
assert(Math.abs(G.roundsReserve() - 1.25 * 22 * 7 * CLOVER) < 1e-6 * G.roundsReserve(), 'the Garden rounds bank keeps today’s price too');
Game.cookies = 1e15;
G.tend();
assert(count(CLOVERS, (x, y) => at(x, y) === 'goldenClover') === 22, 'the gardener plants rather than wait it out');
stuck();
Game.buffs = {};
Game.CalculateGains();
TULIPS.forEach(([x, y]) => set(x, y, null));
q = B.queue('combos');
row = q.held.find((x) => x.key === 'garden:goldenClover');
assert(row && /nursetulips go first/.test(row.why), 'tulips to plant: the clovers wait');
assert(q.items.some((x) => x.key === 'garden:nursetulip' && x.label === 'Plant 8 Nursetulip'), 'the tulips are in the queue');

// ---- the profile editor and the queue's row ----
stuck();
CA.UI.Menu.openPage('payback');
await sleep(50);
const menu = w.document.getElementById('CookieMgrMenu');
const chip = menu.querySelector('[data-ab-kind="garden"]');
assert(chip && chip.classList.contains('on'), 'a Garden chip, on');
assert(/Plant 9 Golden clover/.test(menu.textContent) && menu.innerHTML.includes('gardenPlants.png'), 'the row in the queue, with its seed');
chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
assert(B.find('combos').kinds.garden === false, 'the chip turns it off');

// ---- no Actual income yet: held ----
stuck();
CA.Recorder.recent = () => null;
await sleep(5100); // the actual income is read at most every 5 s
B.update('combos', { kinds: { ...B.find('combos').kinds, garden: true } });
row = B.queue('combos').held.find((x) => x.key === 'garden:goldenClover');
assert(row && /Actual income/.test(row.why), `held (${row && row.why})`);

// ---- a save from before: Golden cookie combos with the Garden rounds bank buys garden things ----
const saved = JSON.parse(CA.Settings.serialize());
saved.buyer.profiles = saved.buyer.profiles.map((p) => (p.id === 'combos' ? { ...p, kinds: { building: true, upgrade: true, allUpgrades: true } } : p));
CA.Settings.load(JSON.stringify(saved));
assert(B.find('combos').kinds.garden === true && B.find('payback').kinds.garden === false, 'old Golden cookie combos: garden on');

assert(errors.length === 0, `no runtime errors (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);
done();
process.exit();
