// The Manager widget's Auto buyer row: while its stage has the Auto buyer on (even with the Manager macro off),
// a row under the stages shows the last three things it bought and what it buys next — name, price, payback
// period, when, a bar — each picture with a card on hover, refreshed live.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const B = CA.AutoBuyer;
const G = CA.Managers;
const Wd = CA.UI.Widgets;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1] };
Object.keys(spec).forEach((n, i) => Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false }));
Game.UpgradesInStore = [];
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])) });
Game.CpsAchievements = [];
Game.cookies = 0;
Game.CalculateGains();
B.update('payback', { cheapBulk: 0 });

// ---- a stage with the Auto buyer on: the row shows ----
CA.Macros.set('manager', false, { silent: true });
G.goTo(1);
G.step();
assert(!CA.Macros.isOn('manager') && CA.UI.ManagerWidget.runsBuyer(), 'Nunix stage 1 runs the Auto buyer: shown even while the Manager macro is off');
const inst = Wd.add('manager');
Wd.render();
const row = () => doc.querySelector(`[data-widget="${inst.id}"] .ca-mw-p-buyer`);
assert(row(), 'a row of its own');
assert(row().previousElementSibling && row().previousElementSibling.classList.contains('ca-mw-p-stages'), 'right under the stages');
const next = () => row().querySelector('.ca-wbuy-next');
const f = B.next();
assert(f && next() && /Next · /.test(next().innerHTML), `what it buys next (${f && f.label})`);
const text = row().querySelector('.ca-wbuy-text').textContent;
assert(text.includes(f.label) && /PP/.test(text) && /in /.test(text) && row().querySelector('.ca-wbuy-bar'), `beside it: name, price, PP, when, a bar (${text})`);
const card = next().querySelector('.ca-wpop').textContent;
assert(/price/.test(card) && /payback period/.test(card) && /affordable/.test(card) && /in /.test(card), `its card: price, payback period, when (${card})`);
assert(!next().classList.contains('can'), 'not affordable yet');
assert(row().querySelectorAll('.ca-wbuy-past').length === 0 && /nothing bought yet/.test(row().textContent), 'nothing bought yet');

// ---- it buys: the purchases land in the row, live ----
Game.cookies = 1e12;
let n = 0;
for (let i = 0; i < 4; i++) n += B.buyNext();
assert(n === 4 && B.recentBought().length === 4, `four bought (${n})`);
// through the macro's way too: pp.buy of what buyer.next named
const key = CA.Script.VALUES.find((v) => v.id === 'buyer.next').get();
CA.Actions.get('pp.buy').run({ thing: key });
assert(B.recentBought().length === 5 && B.recentBought()[0].key === key, `pp.buy(buyer.next()) counts (${key})`);
Wd.tick();
const past = row().querySelectorAll('.ca-wbuy-past');
assert(past.length === 3, `the last three (${past.length})`);
assert(past[2].classList.contains('hot') && /Bought just now/.test(past[2].innerHTML), 'the newest on the right, flashing');
assert(/paid/.test(past[0].querySelector('.ca-wpop').textContent), 'a past one’s card: what it paid');
assert(next().classList.contains('can'), 'next: affordable now');

// ---- long names stay compact: the next one's full name on hover; Buy all upgrades' card names a few, then how many more ----
assert(row().querySelector('.ca-wbuy-text b').getAttribute('data-tip') === row().querySelector('.ca-wbuy-text b').textContent, 'the next name: its full name on hover');
const nx = B.next;
const many = Array.from({ length: 9 }, (_, i) => `Pure pitch-black chocolate butter biscuit ${i + 1}`);
B.next = (...a) => ({ ...nx(...a), kind: 'allUpgrades', names: many });
Wd.tick();
const covers = next().querySelector('.ca-wbuy-covers');
assert(covers && /biscuit 4,? /.test(`${covers.textContent} `) && !/biscuit 5/.test(covers.textContent) && /and 5 more/.test(covers.textContent), `its card: four names, then 5 more (${covers && covers.textContent})`);
B.next = nx;
Wd.tick();

// ---- click: the Payback page ----
click(w, next());
assert(CA.Settings.get('tab') === 'payback', 'click opens the Payback page');

// ---- a stage without it: no row ----
const eff = G.effective;
G.effective = (m, i) => ({ ...eff(m, i), macros: { golden: 'on' } });
assert(!CA.UI.ManagerWidget.runsBuyer(), 'a stage that leaves the Auto buyer off: no');
Wd.tick();
assert(!row(), 'and no row');
G.effective = eff;
Wd.tick();
assert(row().querySelector('.ca-wbuy-next'), 'back on: shown again');

// ---- a part of its own in the settings ----
inst.stats = ['stages', 'now'];
Wd.tick();
assert(!row(), 'unpicked: not shown');
assert(CA.UI.ManagerWidget.PARTS.some((p) => p.v === 'buyer') && CA.UI.ManagerWidget.DEFAULT_PARTS.includes('buyer'), 'a part, on by default');

assert(g.errors.length === 0, `no runtime errors (${g.errors.join('; ')})`);
done();
process.exit();
