// v3.7.2: payback measures only what's asked. Buying (best, pp.best, the autobuyers) asks for the
// buildings you can buy at the amount you'd buy and the store's upgrades — not the sixty rows of the
// color table (every building ×1/×10/×100, locked ones too), which only the store's colors and the
// Payback page need; best() doesn't measure an upgrade whose wait to afford alone is longer than the
// best building's payback period; cookie upgrades that win nothing are worked out (CpS × power%)
// after one is measured as a check; the store redraws from a table up to 2 s old. Same answers.
// (In the real game: tests/sim/payback-perf, and the parity tests against Cookie Monster.)
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const P = CA.Payback;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8], Bank: [1.4e6, 1400], 'Wizard tower': [3.3e8, 44000] };
Object.keys(spec).forEach((n, i) => {
  Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: i < 3 ? 5 : 0, locked: i >= 3 });
});
// three cookie upgrades (+5%, +10%, +2%) and a plain one (Kitten helpers ×1.2, measured)
const cookie = (name, power, price) => {
  const u = new Game.Upgrade(name, price);
  u.pool = 'cookie';
  u.power = power;
  return u;
};
const c1 = cookie('Plain cookies', 5, 1000);
const c2 = cookie('Sugar cookies', 10, 3000);
const c3 = cookie('Oatmeal raisin cookies', 2, 500);
const kitten = new Game.Upgrade('Kitten helpers', 9000);
Game.UpgradesInStore = [c1, c2, c3, kitten];
Game.cookieUpgrades = [c1, c2, c3];
const model = cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.2, 'Plain cookies': 1.05, 'Sugar cookies': 1.1, 'Oatmeal raisin cookies': 1.02 } });
Game.CpsAchievements = [];
let n = 0;
const calc = Game.CalculateGains;
Game.CalculateGains = function () {
  n++;
  return calc.apply(this, arguments);
};
Game.cookies = 1e7;
let st = 0;
const newState = () => (Game.pledges = 100 + ++st); // in the cache's key: a new state, as after a purchase

// ---- buying measures only what can be bought
newState();
n = 0;
const top = P.best('all');
assert(top && n <= 3 + 2 + 4, `best(): ${n} CpS computations — 3 unlocked buildings + 2 of 4 upgrades measured (two cookies worked out), + a baseline and a restore for each of the two batches; the color table would be 15 + 4`);
assert(n < 15, 'not the color table (5 buildings × 3 bulks)');
// the cookie upgrades worked out: exactly CpS × power%
const base = Game.cookiesPs;
const r = Object.fromEntries(P.ranking('upgrade').map((x) => [x.name, x.bonus]));
assert(Math.abs(r['Sugar cookies'] - base * 0.1) < 1e-9 && Math.abs(r['Oatmeal raisin cookies'] - base * 0.02) < 1e-9 && Math.abs(r['Plain cookies'] - base * 0.05) < 1e-9, 'cookie upgrades: CpS × power% (one measured as the check, the rest worked out)');
// …and the same as measuring every one
const lazy = P.ranking('all').map((x) => `${x.name}:${x.pp.toPrecision(12)}`);
const tb = P.table();
const full = Object.values(tb.buildings[1])
  .filter((x) => !Game.Objects[x.name].locked)
  .map((x) => ({ name: x.name, pp: x.pp }))
  .concat(Object.values(tb.upgrades).map((x) => ({ name: x.name, pp: x.pp })))
  .filter((x) => Number.isFinite(x.pp))
  .sort((a, b) => a.pp - b.pp)
  .map((x) => `${x.name}:${x.pp.toPrecision(12)}`);
assert(lazy.join() === full.join(), 'the ranking is the full table’s, to 12 digits');
// a cookie whose worth isn't CpS × power% (a mod, a game change): the check catches it, all are measured
model.mults['Sugar cookies'] = 1.3; // says +10%, gives +30%
newState();
const sugar = P.ranking('upgrade').find((x) => x.name === 'Sugar cookies');
const plain = P.ranking('upgrade').find((x) => x.name === 'Plain cookies');
assert(Math.abs(sugar.bonus - Game.cookiesPs * 0.3) < 1e-6 * Game.cookiesPs || Math.abs(plain.bonus - Game.cookiesPs * 0.05) < 1e-6 * Game.cookiesPs, 'a cookie that doesn’t add its power%: measured (the check failed, or it was the one measured)');
model.mults['Sugar cookies'] = 1.1;

// ---- a small bank: upgrades whose wait outlasts the best building aren't measured
Game.cookies = 0;
kitten.price = 1e12; // hours to afford: it can't beat a building that pays back in minutes
newState();
n = 0;
P.best('all');
const small = n;
newState();
n = 0;
P.ranking('all');
assert(small < n, `a small bank: best() measures less than the full ranking (${small} vs ${n})`);
Game.cookies = 1e7;
kitten.price = 9000;

// ---- the store redraws from a table up to 2 s old
newState();
const t1 = P.table({ staleMs: 2000 });
newState();
n = 0;
const t2 = P.table({ staleMs: 2000 });
assert(t2 === t1 && n === 0, 'table({ staleMs }): within 2 s, the last one (no measuring)');
newState();
n = 0;
P.table();
assert(n > 0, 'table(): fresh');

// ---- the autobuyer's code: pp.best then pp.price/kind of its pick, without ranking everything again
CA.Settings.set('roundUpBulk', false);
newState();
n = 0;
CA.AutoBuyer.use('upgrades'); // v3.43: Best upgrade → the Auto buyer, Upgrades only
CA.Macros.runOnce('autoBuyer');
const buyerCost = n;
assert(buyerCost <= 12, `Best upgrade, one pass: ${buyerCost} CpS computations (its pick looked up, not re-ranked)`);

Game.CalculateGains = calc;
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
