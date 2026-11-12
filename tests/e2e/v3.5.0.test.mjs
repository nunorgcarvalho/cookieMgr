// v3.5.0 (the in-house Cookie Monster, release A): payback periods
// computed by CookieMgr itself (features/payback.js) — bonus income asked of the game (here a CpS
// model), counting the achievements a purchase wins; bulk prices; Cookie Monster's PP formula and
// colors; the options; the code words (pp.*, with the old cm.* names hidden but working);
// buy.best; and the game left exactly as it was.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const P = CA.Payback;
const V = (id, ...args) => CA.Script.VALUES.find((v) => v.id === id).get(...args);

// ---- the game: five buildings priced like main.js, a CpS model with milk (+1% per achievement)
const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8], Bank: [1.4e6, 1400], 'Wizard tower': [3.3e8, 44000] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  b.id = i;
  b.basePrice = spec[n][0];
  b.free = 0;
  b.amount = n === 'Farm' ? 0 : 3;
  b.getPrice = function () {
    return Math.ceil(this.basePrice * Math.pow(1.15, this.amount));
  };
  b.buy = function (k = 1) {
    for (let j = 0; j < k && Game.cookies >= this.getPrice(); j++) {
      Game.cookies -= this.getPrice();
      this.amount++;
    }
  };
});
// Farm's first-of achievement (a tier at 1, like main.js Game.TieredAchievement)
Game.Tiers = { 1: { achievUnlock: 1 } };
Game.Objects.Farm.tieredAchievs = { 1: { name: 'Bought the farm', tier: 1 } };
Game.Achievements['Bought the farm'] = { name: 'Bought the farm', won: 0, pool: 'normal' };
Game.AchievementsOwned = 5;
const kitten = new Game.Upgrade('Kitten helpers', 5000);
const lucky = new Game.Upgrade('Lucky day', 1e9);
Game.UpgradesInStore = [kitten, lucky];
const model = cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5, 'Lucky day': 1.001 }, milk: 0.01 });
Game.cookies = 1e7;
const cpsWith = (extra = {}, ach = Game.AchievementsOwned) => {
  let s = model.base;
  Object.keys(spec).forEach((n) => (s += (Game.Objects[n].amount + (extra[n] || 0)) * spec[n][1]));
  return s * (1 + 0.01 * ach);
};

// ---- bonus income, asked of the game
const t = P.table();
const farm = t.buildings[1].Farm;
assert(Math.abs(farm.bonus - (cpsWith({ Farm: 1 }, 6) - cpsWith())) < 1e-9, `Farm ×1: its CpS and the milk of the achievement it wins (${farm.bonus})`);
assert(farm.won.includes('Bought the farm'), 'the achievement it would win is named');
assert(Math.abs(t.buildings[1].Grandma.bonus - (cpsWith({ Grandma: 1 }) - cpsWith())) < 1e-9, 'Grandma ×1: just its CpS (no achievement)');
assert(Math.abs(t.buildings[10].Cursor.bonus - (cpsWith({ Cursor: 10 }) - cpsWith())) < 1e-9, '×10: ten more');
assert(Math.abs(P.buildingBonus('Grandma', 7) - (cpsWith({ Grandma: 7 }) - cpsWith())) < 1e-9, 'any amount, measured as asked (7 grandmas)');
// prices like main.js getSumPrice
let sum = 0;
for (let i = 3; i < 13; i++) sum += 15 * Math.pow(1.15, i);
assert(t.buildings[10].Cursor.price === Math.ceil(sum) && V('building.priceOf', 'Cursor', 10) === Math.ceil(sum), `×10 price: the sum of the next ten (${t.buildings[10].Cursor.price})`);
// the game as it was
assert(Game.AchievementsOwned === 5 && !Game.Achievements['Bought the farm'].won && Game.Objects.Farm.amount === 0 && Math.abs(Game.cookiesPs - cpsWith()) < 1e-9 && !kitten.bought, 'measuring leaves the game as it was (achievements, amounts, CpS, upgrades)');

// ---- payback periods: wait to afford + price ÷ bonus
const g1 = t.buildings[1].Grandma;
assert(Math.abs(g1.pp - g1.price / g1.bonus) < 1e-9, 'affordable: PP = price ÷ bonus');
const wiz = t.buildings[1]['Wizard tower'];
assert(Math.abs(wiz.pp - ((wiz.price - Game.cookies) / Game.cookiesPs + wiz.price / wiz.bonus)) < 1e-6, 'not affordable yet: + the time to afford it at your CpS');
assert(Math.abs(V('timeTo', wiz.price) - (wiz.price - Game.cookies) / Game.cookiesPs) < 1e-9 && V('timeTo', 10) === 0, 'timeTo(price)');
assert(Math.abs(V('building.payback', 'Grandma') - g1.pp) < 1e-9 && Math.abs(V('building.gain', 'Grandma') - g1.bonus) < 1e-9, 'building.payback / building.gain');

// ---- colors: green the best building; blue an upgrade better than it; gray never pays back
const rows = [1, 10, 100].flatMap((n) => Object.values(t.buildings[n]));
const bestRow = rows.slice().sort((a, b) => a.pp - b.pp)[0];
assert(bestRow.color === 'green' && rows.filter((r) => r.color === 'green').length === 1, `the best building is green (${bestRow.name} ×${bestRow.n})`);
assert(t.upgrades['Kitten helpers'].pp < bestRow.pp && t.upgrades['Kitten helpers'].color === 'blue', 'an upgrade better than any building: blue');
assert(rows.every((r) => r.color !== 'blue'), 'buildings are never blue');
model.each.Bank = 0;
Game.CalculateGains();
assert(P.table().buildings[1].Bank.color === 'gray' && P.table().buildings[1].Bank.pp === Infinity, 'adds nothing: gray, ∞');
model.each.Bank = 1400;
Game.CalculateGains();

// ---- options
CA.Settings.set('ppOnlyBuyable', true);
const tb = P.table();
assert(tb.buildings[1]['Wizard tower'].color === 'red' && tb.buildings[1].Grandma.color !== 'red', 'only buyable: what you can’t afford is red');
CA.Settings.set('ppOnlyBuyable', false);
CA.Settings.set('ppSecondsLowerLimit', 5);
assert(P.table().buildings[1].Cursor.color === 'blue', 'costing under 5 s of CpS: blue');
CA.Settings.set('ppSecondsLowerLimit', 0);

// ---- the code words: pp.*, the cm.* names hidden but working
assert(V('pp.best', 'all', false) === 'upgrade:Kitten helpers' && V('cm.best', 'all', false) === 'upgrade:Kitten helpers', 'pp.best (and the old cm.best) agree');
assert(V('pp.best', 'building', false) === `building:${bestRow.n === 1 ? bestRow.name : P.ranking('building')[0].name}`, 'pp.best(building)');
const lib = CA.Script.library().map((x) => x.id);
assert(lib.includes('pp.best') && lib.includes('pp.buy') && !lib.includes('cm.best') && !lib.includes('cm.buy'), 'the library lists pp.*, not the old names');
assert(V('best', 'upgrade') === 'Kitten helpers', 'best(kind)');
const { flow, errors } = CA.Script.compile('x = cm.best(all, false)\nif x != "" and cm.price(x) <= cookies():\n  cm.buy(x)\n');
assert(!errors.length, 'code written with the old names still compiles');
CA.Macros.runPass(flow);
assert(kitten.bought === 1, '…and runs: the best was bought');
Game.CalculateGains();

// ---- buy.best
const before = Game.Objects.Grandma.amount + Game.Objects.Cursor.amount + Game.Objects.Farm.amount;
const top = P.best('building');
const n = CA.Actions.run('buy.best', { kind: 'building' });
assert(n === 1 && Game.Objects[top.name].amount > 0 && Game.Objects.Grandma.amount + Game.Objects.Cursor.amount + Game.Objects.Farm.amount === before + 1, `buy.best(building): bought ${top.name}`);

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
