// The Auto buyer's purchase history: what it bought is kept in the save (a refresh no longer wipes the
// Manager widget's "last bought"), the last 100, and the Payback page shows it in a Purchase history card —
// when, what, price, the CpS it added, that as a boost, its payback period then, the profile — scrolling.
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const B = CA.AutoBuyer;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1] };
Object.keys(spec).forEach((n, i) => Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false }));
Game.UpgradesInStore = [];
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])) });
Game.CpsAchievements = [];
Game.CalculateGains();
B.update('payback', { cheapBulk: 0, reserve: 0, banks: [] });

// ---- it buys: each purchase kept with what it was then ----
Game.cookies = 1e12;
const cps0 = Game.cookiesPs;
let n = 0;
for (let i = 0; i < 3; i++) n += B.buyNext();
assert(n === 3 && B.recentBought().length === 3, `three bought (${n})`);
const last = B.recentBought()[2]; // the first one bought
assert(last.cps === cps0 && last.income > 0 && last.mode, `CpS and income just before, and the payback mode (${last.cps}, ${last.income}, ${last.mode})`);
assert(Number.isFinite(last.price) && Number.isFinite(last.pp) && last.gain > 0 && last.profile, 'price, payback period, gain, profile');

// ---- the save keeps it: a refresh (a load of the save) brings it back ----
const saved = JSON.parse(CA.Settings.serialize());
assert(Array.isArray(saved.buyerHistory) && saved.buyerHistory.length === 3, 'a section of the save');
B.clearBought();
assert(B.recentBought().length === 0, 'cleared');
CA.Settings.load(JSON.stringify(saved));
const back = B.recentBought();
assert(back.length === 3 && back[2].key === last.key && back[2].pp === last.pp && back[2].cps === last.cps && back[2].t === last.t, 'loaded back as it was');
// never pays back (Infinity) and not known (NaN) survive JSON
const odd = JSON.parse(JSON.stringify(saved));
odd.buyerHistory[0].pp = null;
delete odd.buyerHistory[0].gain;
CA.Settings.load(JSON.stringify(odd));
assert(B.recentBought()[0].pp === Infinity && Number.isNaN(B.recentBought()[0].gain), 'Infinity and NaN kept apart');
// a save without it (another bakery's): empty
const none = { ...saved };
delete none.buyerHistory;
CA.Settings.load(JSON.stringify(none));
assert(B.recentBought().length === 0, 'a save without one: nothing bought');
CA.Settings.load(JSON.stringify(saved));

// ---- the last 100 ----
const many = Array.from({ length: 130 }, (_, i) => ({ ...saved.buyerHistory[0], t: Date.now() - i * 1000 }));
CA.Settings.load(JSON.stringify({ ...saved, buyerHistory: many }));
assert(B.recentBought().length === 100 && B.BOUGHT_MAX === 100, 'at most 100 loaded');
for (let i = 0; i < 3; i++) B.buyNext();
assert(B.recentBought().length === 100 && B.recentBought()[0].t >= many[0].t, 'still 100, the newest first');
CA.Settings.load(JSON.stringify(saved));

// ---- the Payback page's Purchase history card ----
CA.UI.Menu.openPage('payback');
await sleep(50);
const card = () => doc.querySelector('[data-ab-hist]');
assert(card() && card().closest('.ca-card').textContent.includes('Purchase history'), 'a Purchase history card');
const heads = [...card().querySelectorAll('th')].map((th) => th.textContent);
assert(['When', 'What', 'Price', 'CpS', 'Boost', 'PP', 'Profile'].every((h) => heads.includes(h)), `its columns (${heads.join(', ')})`);
const rows = () => card().querySelectorAll('tbody tr');
assert(rows().length === 3, `a row each (${rows().length})`);
const cells = [...rows()[2].querySelectorAll('td')].map((td) => td.textContent);
assert(/^\d\d:\d\d:\d\d$/.test(cells[0]), `when: the time of day (${cells[0]})`);
assert(/^\+.+\/s$/.test(cells[3]) && /^\+[\d.]+%$/.test(cells[4]), `CpS and boost (${cells[3]}, ${cells[4]})`);
assert(cells[5] === CA.Format.payback(last.pp), `payback period then, in short units (${cells[5]})`);
const pct = (last.gain / last.income) * 100;
assert(cells[4] === `+${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}%`, `boost = gain ÷ income (${cells[4]})`);
assert(w.getComputedStyle(card()).overflowY === 'auto', 'it scrolls');

// live: a new purchase lands at the top
B.buyNext();
CA.UI.Pages.get('payback').tick();
assert(rows().length === 4, 'a new purchase shows on the next refresh');

// Clear asks first
const clear = doc.querySelector('[data-ab-act="clear-history"]');
click(w, clear);
assert(B.recentBought().length === 4, 'one click arms it');
click(w, doc.querySelector('[data-ab-act="clear-history"]'));
assert(B.recentBought().length === 0, 'the second clears');
assert(/Nothing bought yet/.test(card().textContent), 'empty');

assert(g.errors.length === 0, `no runtime errors (${g.errors.join('; ')})`);
done();
process.exit();
