// Cheap ×100: an Auto buyer profile setting (seconds of unbuffed CpS, default 1, 0: off). A building whose
// next 100 cost less than that — and the budget affords — is bought 100 at a time ahead of the queue,
// whatever its payback period; profiles saved before it get the default.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const B = CA.AutoBuyer;
const P = CA.Payback;

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false }));
Game.UpgradesInStore = [];
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])) });
Game.CpsAchievements = [];
Game.cookies = 1e12;
Game.CalculateGains();
const raw = Game.cookiesPsRaw || Game.unbuffedCps || Game.cookiesPs;
const hundred = (n) => P.sumPrice(Game.Objects[n], 100);

// ---- the setting ----
assert(B.SEEDS.every((s) => s.cheapBulk === 1) && B.list().every((p) => p.cheapBulk === 1), 'seeded profiles: 1 s');
const cut = (hundred('Cursor') + hundred('Grandma')) / 2 / raw; // Cursors' next 100 are under it, Grandmas' aren't
assert(hundred('Cursor') > raw, 'at 1 s nothing here is cheap');
assert(!B.queue().items.some((x) => x.first), 'so nothing jumps the queue');
B.update('payback', { cheapBulk: cut });
let q = B.queue();
const f = q.items[0];
assert(f.key === 'building:Cursor' && f.n === 100 && f.first && f.price === hundred('Cursor'), `a cheap building: its next 100 at the front (${f.label})`);
assert(f.label === '100 × Cursor' && f.rules[0] === `cheap: ×100 under ${cut} s`, `with a badge (${f.rules})`);
// while one is cheap, nothing is measured: the queue is the cheap ones (the rest ranked once none is)
assert(q.fast && f.unmeasured && Number.isNaN(f.pp), 'not measured: bought whatever its payback period');
assert(q.items.filter((x) => x.kind !== 'bank').length === 1 && !q.items.some((x) => x.key === 'building:Grandma'), 'the queue: just the cheap one');
const calls0 = P.calls();
B.queue();
Game.cookies += 1; // a new queue
B.queue();
assert(P.calls() === calls0, `no CpS computed for it (${P.calls() - calls0})`);
Game.cookies -= 1;
B.update('payback', { cheapBulk: 0 });
q = B.queue();
assert(!q.fast && q.items.find((x) => x.key === 'building:Grandma'), 'none cheap: everything ranked as usual');
B.update('payback', { cheapBulk: cut });

// the budget has to afford it
Game.cookies = hundred('Cursor') - 1;
assert(!B.queue().items.some((x) => x.first), 'one it can’t afford: not taken');
B.update('payback', { reserve: 0, banks: [] });
Game.cookies = 1e12;

// rules still apply on top: a cap cuts it down, never holds it back
B.addRule('payback', { what: 'b:Cursor', effect: 'cap', n: 50 });
q = B.queue();
assert(q.items[0].key === 'building:Cursor' && q.items[0].n === 45 && q.items[0].first, `a cap: up to it, still first (${q.items[0].n})`);
B.setRule('payback', B.find('payback').rules.length - 1, { effect: 'never' });
assert(B.queue().held.some((x) => x.key === 'building:Cursor'), 'never: held back');
B.removeRule('payback', B.find('payback').rules.length - 1);

// bought 100 at a time
const before = Game.Objects.Cursor.amount;
assert(B.buyNext() === 1 && Game.Objects.Cursor.amount === before + 100, `buyer.buyNext buys 100 (${Game.Objects.Cursor.amount - before})`);

// 0: off
B.update('payback', { cheapBulk: 0 });
assert(!B.queue().items.some((x) => x.first) && B.find('payback').cheapBulk === 0, '0 switches it off');
B.update('payback', { cheapBulk: -3 });
assert(B.find('payback').cheapBulk === 0, 'never below 0');

// the Auto buyer runs every 0.05 s by default (a speed you set yourself is kept)
assert(CA.Macros.everyOf(CA.Macros.get('autoBuyer')) === 50, 'the Auto buyer: every 50 ms');

// ---- saves ----
const S = CA.Settings;
const saved = JSON.parse(S.serialize());
saved.buyer = { active: 'mine', profiles: [{ id: 'mine', name: 'Mine', kinds: { building: true, upgrade: true, allUpgrades: true }, rules: [] }, { id: 'off', name: 'Off', cheapBulk: 0 }] };
S.load(JSON.stringify(saved));
assert(B.find('mine').cheapBulk === 1, 'a profile saved before it: 1 s');
assert(B.find('off').cheapBulk === 0, 'one saved with it off: stays off');
B.update('mine', { cheapBulk: 2.5 });
S.load(S.serialize());
assert(B.find('mine').cheapBulk === 2.5, 'saved and loaded');

// ---- the Payback page ----
Game.Objects.Cursor.amount = 5;
B.update('mine', { cheapBulk: cut });
CA.UI.Menu.openPage('payback');
await sleep(50);
const doc = w.document;
const input = doc.querySelector('[data-ab-f="cheapBulk"]');
assert(input && Number(input.value) === cut, 'the profile editor shows it');
input.value = '7';
input.dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(50);
assert(B.find('mine').cheapBulk === 7, 'and changes it');
B.update('mine', { cheapBulk: cut });
CA.UI.Menu.render();
await sleep(50);
const badge = doc.querySelector('.ca-ab-queue tr.front .ca-ab-badge');
assert(badge && badge.classList.contains('first') && /×100/.test(badge.textContent), `the queue’s front row has its badge (${badge && badge.textContent})`);

assert(g.errors.length === 0, `no runtime errors (${g.errors.join('; ')})`);
done();
process.exit();
