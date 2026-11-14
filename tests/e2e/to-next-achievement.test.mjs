// To next achievement: an Auto buyer profile setting (on by default). Beside its bulk, a building is
// measured bought up to the next achievement it wins (within 100), and the queue takes that count when
// its payback period is better — the achievement's milk counted across the whole buy.
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
// milk worth +50% CpS an achievement: one won is clearly worth buying up to
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), milk: 0.5 });
Game.CpsAchievements = [];
Game.Tiers = { 2: { achievUnlock: 50 } };
Game.Achievements['Grandma tier 2'] = { name: 'Grandma tier 2', won: 0, pool: 'normal' };
Game.Objects.Grandma.tieredAchievs = { 2: { name: 'Grandma tier 2', tier: 2 } };
Game.AchievementsOwned = 0;
Object.values(Game.Achievements).forEach((a) => (a.won = 0));
Game.Objects.Grandma.amount = 48; // two short of the Grandma tier at 50
Game.Objects.Farm.amount = 60; // the others: dear
Game.Objects.Cursor.amount = 120;
Game.cookies = 1e12;
Game.CalculateGains();
B.update('payback', { cheapBulk: 0, bulk: 1 });

assert(B.SEEDS.every((s) => s.toAchievement === true) && B.list().every((p) => p.toAchievement === true), 'seeded profiles: on');
const next = P.nextAchievement('Grandma').n;
assert(next === 2, `Grandma: 2 to its next achievement (${next})`);
let q = B.queue();
const gr = q.items.find((x) => x.key === 'building:Grandma');
assert(gr && gr.n === 2 && gr.toAchievement && gr.rules.includes('to next achievement'), `Grandma bought up to it, with a badge (${gr && gr.label}, ${gr && gr.rules})`);
assert(Math.abs(gr.pp - P.parts(gr.price, P.buildingWorth('Grandma', 2)).pp) < 1e-9, 'its PP is the 2’s');
assert(gr.pp < P.parts(P.sumPrice(Game.Objects.Grandma, 1), P.buildingWorth('Grandma', 1)).pp, 'better than ×1');
assert(q.items.filter((x) => x.key === 'building:Grandma').length === 1, 'one Grandma row, not two');
assert(q.items[0].key === 'building:Grandma', `and it leads the queue (${q.items[0].label})`);

// off: the bulk as before
B.update('payback', { toAchievement: false });
q = B.queue();
assert(q.items.find((x) => x.key === 'building:Grandma').n === 1 && !q.items.some((x) => x.toAchievement), 'off: the bulk only');
B.update('payback', { toAchievement: true });

// bought up to it
assert(B.buyNext() === 1 && Game.Objects.Grandma.amount === 50, `buyer.buyNext buys 2 (${Game.Objects.Grandma.amount})`);

// ---- saves ----
const S = CA.Settings;
const saved = JSON.parse(S.serialize());
saved.buyer = { active: 'mine', profiles: [{ id: 'mine', name: 'Mine', rules: [] }, { id: 'off', name: 'Off', toAchievement: false }] };
S.load(JSON.stringify(saved));
assert(B.find('mine').toAchievement === true, 'a profile saved before it: on');
assert(B.find('off').toAchievement === false, 'one saved with it off: stays off');

// ---- the Payback page ----
CA.UI.Menu.openPage('payback');
await sleep(50);
const doc = w.document;
const off = doc.querySelector('[data-ab-toach="0"]');
assert(off, 'the profile editor has the setting');
off.click();
await sleep(50);
assert(B.find('mine').toAchievement === false, 'and changes it');

assert(g.errors.length === 0, `no runtime errors (${g.errors.join('; ')})`);
done();
process.exit();
