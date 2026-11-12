// v3.6.0 (the in-house Cookie Monster, release C): the displays —
// the Payback page (best buy, the building table by ×1 / ×10 / ×100 in payback colors, buying from
// it, the upgrades, the options), the Stats page (bank meters, golden cookie odds, prestige,
// wrinklers, timers, what's left to collect), the store (price colors, upgrade dots, a CookieMgr
// block under the game's tooltips with bank warnings — each with its option), and the Golden
// cookies widget.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);

// ---- the game: buildings priced like main.js, store rows and upgrade crates in the DOM
const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8], Bank: [1.4e6, 1400], 'Wizard tower': [3.3e8, 44000] };
const products = doc.createElement('div');
products.id = 'products';
doc.body.appendChild(products);
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, iconColumn: i });
  b.getPrice = function () {
    return Math.ceil(this.basePrice * Math.pow(1.15, this.amount));
  };
  b.buy = function (k = 1) {
    for (let j = 0; j < k && Game.cookies >= this.getPrice(); j++) {
      Game.cookies -= this.getPrice();
      this.amount++;
    }
  };
  b.tooltip = () => `<div class="name">${n}</div>`;
  const price = doc.createElement('span');
  price.className = 'price';
  price.id = `productPrice${i}`;
  products.appendChild(price);
});
const kitten = new Game.Upgrade('Kitten helpers', 5000);
kitten.icon = [18, 13];
kitten.type = 'upgrade';
Game.UpgradesInStore = [kitten];
const crate = doc.createElement('div');
crate.id = 'upgrade0';
doc.body.appendChild(crate);
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5 } });
Game.cookies = 1e7;
Game.buyMode = 1;
Game.buyBulk = 1;
await sleep(700); // the store's painter runs every half second

// ---- the Payback page
CA.UI.Menu.openPage('payback');
const pg = () => doc.querySelector('[data-page="payback"]');
assert(pg() && /Auto buyer/.test(pg().textContent) && /Kitten helpers/.test(pg().querySelector('[data-ab-buyer]').textContent), 'Payback: the best buy (an upgrade that beats every building) — v3.43: the Auto buyer’s Next');
const cells = pg().querySelectorAll('.ca-pp-cell');
assert(cells.length === 15 && pg().querySelectorAll('.ca-pp-cell.green').length === 1, `a cell per building and amount (${cells.length}), one green: the best building`);
const t = CA.Payback.table();
const g1 = pg().querySelector('.ca-pp-cell[data-pp-buy="Grandma"][data-n="1"]');
assert(g1 && g1.classList.contains(t.buildings[1].Grandma.color) && g1.querySelector('b').textContent === CA.Format.payback(t.buildings[1].Grandma.pp), 'a cell: its color and payback period');
const before = Game.Objects.Grandma.amount;
click(w, pg().querySelector('.ca-pp-cell[data-pp-buy="Grandma"][data-n="10"]'));
assert(Game.Objects.Grandma.amount === before + 10, 'clicking ×10 buys ten');
assert(pg().querySelector('.ca-pp-up.blue[data-pp-up="Kitten helpers"]'), 'the upgrade: blue (better than the best building)');
click(w, pg().querySelector('[data-pp-wrink="all"]'));
assert(CA.Settings.get('ppWrinklers') === 'all', 'option: wrinklers in the bank');
CA.Settings.set('ppWrinklers', 'none');
CA.UI.PaybackPage.sync();

// ---- the Stats page
Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 3000, minTime: 9000, maxTime: 27000, spawned: 0, n: 0, spawnConditions: () => true });
CA.UI.Menu.openPage('stats');
const st = () => doc.querySelector('[data-page="graphs"]');
assert(st() && st().querySelectorAll('.ca-meter').length >= 5 && /Lucky!/.test(st().textContent) && /Conjure Baked Goods/.test(st().textContent), 'Stats: the bank meters (Lucky!, chains, Conjure…)');
const lucky = CA.GoldenMath.lucky().bank;
assert(st().querySelector('.ca-meter .ca-meter-top span').textContent === CA.Format.beautify(lucky), 'a meter shows the bank it needs');
// v3.8: the odds strip became a chart of the whole distribution (ui/spawnView.js)
assert(/Next golden cookie/.test(st().textContent) && st().querySelector('[data-sp-chart="golden"] .ca-sp-now') && st().querySelector('.ca-sp-cdf'), 'the next golden cookie, with its odds over time');
// v3.47: the Stats page merged into Graphs (named Stats) — prestige on its Prestige tab, the rest on Misc
CA.UI.Menu.openPage('graphs:prestige');
assert(/If you ascended now/.test(st().textContent), 'prestige (the Prestige tab)');
CA.UI.Menu.openPage('graphs:misc');
assert(/Still to collect/.test(st().textContent) && /Wrinklers/.test(st().textContent) && /Timers/.test(st().textContent), 'what’s left to collect, wrinklers, timers (the Misc tab)');
CA.UI.Menu.openPage('stats');
Game.cookies = lucky * 2;
CA.UI.StatsPage.sync();
assert(st().querySelector('.ca-meter.ok'), 'a bank that covers it: marked');
Game.cookies = 1e7;

// ---- the store: colors, the tooltip block, warnings, the options
CA.UI.StoreInsight.paint();
const colorOf = (i) => [...doc.getElementById(`productPrice${i}`).classList].find((c) => c.startsWith('ca-pp-'));
assert(colorOf(1) === `ca-pp-${CA.Payback.table().buildings[1].Grandma.color}`, `a building’s price in its color (${colorOf(1)})`);
assert(crate.querySelector('.ca-pp-updot.ca-pp-bg-blue'), 'an upgrade’s corner dot');
const tip = Game.Objects.Grandma.tooltip();
assert(/<div class="name">Grandma<\/div>/.test(tip) && /ca-tt/.test(tip) && /Bonus income/.test(tip) && /Payback period/.test(tip) && /Next achievement/.test(tip), 'the building tooltip: the game’s, then CookieMgr’s block');
assert(/Payback period/.test(Game.crateTooltip(kitten, 'store')) && !/ca-tt/.test(Game.crateTooltip(kitten, 'stats')), 'the upgrade tooltip in the store (not elsewhere)');
// a purchase that takes the bank below what a Lucky! needs (warnings: off by default since the tooltip's lines became yours to choose)
CA.Settings.set('storeWarnings', true);
Game.cookies = lucky + Game.Objects['Wizard tower'].getPrice() * 0.5;
const wiz = Game.Objects['Wizard tower'].tooltip();
assert(Game.cookies < Game.Objects['Wizard tower'].getPrice() || /ca-tt-warn/.test(wiz), 'a warning when buying would take the bank below the Lucky! bank');
Game.cookies = lucky + Game.Objects.Grandma.getPrice() / 2; // half a grandma above the Lucky! bank
assert(/ca-tt-warn/.test(Game.Objects.Grandma.tooltip()) && /Lucky!/.test(Game.Objects.Grandma.tooltip()), 'even a cheap one, when it tips the bank under');
CA.Settings.set('storeWarnings', false);
assert(!/ca-tt-warn/.test(Game.Objects.Grandma.tooltip()), 'option off: no warnings');
CA.Settings.set('storeTooltips', false);
assert(!/ca-tt/.test(Game.Objects.Grandma.tooltip()), 'option off: the game’s tooltip alone');
CA.Settings.set('storeColors', false);
CA.UI.StoreInsight.paint();
assert(!colorOf(1) && !crate.querySelector('.ca-pp-updot'), 'option off: no colors, no dots');
['storeWarnings', 'storeTooltips', 'storeColors'].forEach((k) => CA.Settings.set(k, true));
CA.UI.Menu.openPage('settings:store');
assert(['storeColors', 'storeTooltips', 'storeWarnings'].every((k) => doc.querySelector(`[data-page="settings"] [data-key="${k}"]`)), 'the options, in Settings → Store');

// (the Golden cookies widget that was here went in v3.19: the Next golden cookie widget replaces it)

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
