// v3.18.0: bank warnings, compact. A purchase that would take the bank below what a Lucky! (red),
// Conjure Baked Goods (orange) or a Lucky! in a Frenzy (yellow) needs gets a small colored "!" on
// its store item — the color of the smallest bank it breaks — and one tooltip line of tags naming
// each bank it breaks and how far under; warnings(price) stays data.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const SI = CA.UI.StoreInsight;
const G = CA.GoldenMath;
const price = (n) => CA.Payback.sumPrice(Game.Objects[n], 1);

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false });
  b.tooltip = () => `<div class="name">${n}</div>`;
  const el = doc.createElement('div');
  el.id = `product${i}`;
  el.innerHTML = `<div class="price" id="productPrice${i}"></div>`;
  doc.body.appendChild(el);
});
const kitten = new Game.Upgrade('Kitten helpers', 5000);
kitten.type = 'upgrade';
Game.UpgradesInStore = [kitten];
const up = doc.createElement('div');
up.id = 'upgrade0';
doc.body.appendChild(up);
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 10, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { 'Kitten helpers': 1.5 } });
Game.buyMode = 1;
Game.buyBulk = 1;
await sleep(700);

const lucky = G.lucky().bank;
const conjure = G.conjure().bank;
const frenzy = G.lucky(true).bank;
assert(lucky < conjure && conjure < frenzy, `the banks, smallest first: ${lucky} < ${conjure} < ${frenzy}`);

// off (the default): nothing
assert(CA.Settings.get('storeWarnings') === false, 'off by default');
Game.cookies = lucky + 50;
SI.paint();
assert(!doc.querySelector('.ca-bank-mark') && !/ca-tt-warn/.test(Game.Objects.Grandma.tooltip()), 'off: no marks, no line');

CA.Settings.set('storeWarnings', true);
// v3.29: warnings are statistics, about an item (a context); priced items via a fake row
const at = (p) => ({ kind: 'building', name: 'Grandma', r: { price: p, bonus: 1, pp: 1 }, t: CA.Payback.table() });
const ids = (ws) => ws.map((x) => x.id.replace('warn', '').toLowerCase()).join();
// just over a Lucky!'s bank: a Grandma (≈100) tips it under, a Cursor (15) doesn't
const ws = SI.warnings(CA.Stats.contextOf('Grandma'));
assert(ws.length === 1 && ws[0].id === 'warnLucky' && ws[0].color === 'red', `structured: ${JSON.stringify(ws.map((x) => x.id))}`);
assert(ws[0].html === `−${CA.Format.beautify(price('Grandma') - 50)}`, `how far under (${ws[0].html})`);
assert(SI.warnings(CA.Stats.contextOf('Cursor')).length === 0, 'a cheaper buy keeps the bank');
await sleep(50);
SI.paint();
const mark = (id) => doc.querySelector(`#${id} > .ca-bank-mark`);
assert(mark('product1') && mark('product1').classList.contains('ca-pp-bg-red'), 'the Grandma: a red mark');
assert(!mark('product0'), 'the Cursor: none');
assert(mark('upgrade0') && mark('upgrade0').classList.contains('ca-pp-bg-red'), 'the upgrade too');
const tip = Game.Objects.Grandma.tooltip();
assert((tip.match(/ca-tt-warn/g) || []).length === 1, 'one line');
assert(/ca-tt-bank-red">Lucky! bank <small>−/.test(tip), 'a red Lucky! tag with how far under');

// over every bank: a buy that breaks all three — one line, three tags, the mark red
Game.cookies = frenzy + 10;
const all = SI.warnings(at(frenzy + 10 - lucky + 1));
assert(ids(all) === 'lucky,conjure,frenzy', `all three, smallest first: ${ids(all)}`);
// a bank only the Frenzy one breaks: yellow
const only = SI.warnings(at(20));
assert(only.length === 1 && only[0].color === 'yellow', 'just over the Frenzy bank: yellow');
// banks you're already under don't warn
Game.cookies = lucky - 1;
assert(SI.warnings(at(1)).length === 0, 'already under every bank: no warnings');

// switching it off clears the marks
Game.cookies = lucky + 50;
SI.paint();
assert(mark('product1'), 'marked again');
CA.Settings.set('storeWarnings', false);
assert(!doc.querySelector('.ca-bank-mark'), 'off: the marks go at once');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
