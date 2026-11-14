// The Auto buyer without lag: a rule whose "when" reads buyer.budget() (the seeded Buy all upgrades rule)
// works the queue out once, not again inside itself; while a building's next 100 are cheap, nothing is
// measured; the next achievement's count is found trying only the counts that can win one.
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
B.update('payback', { cheapBulk: 0, reserve: 1 });

// ---- a "when" reading buyer.budget(): the queue is worked out once ----
let runs = 0;
const runStat = CA.Script.runStat;
CA.Script.runStat = (...a) => (runs++, runStat(...a));
let seen = null;
B.addRule('payback', { what: 'building', effect: 'weight', k: 2, when: 'buyer.budget() > 0' });
const rawCps = Game.cookiesPsRaw || Game.unbuffedCps || Game.cookiesPs;
let q = B.queue();
CA.Script.runStat = runStat;
const things = q.items.filter((x) => x.kind !== 'bank').length + q.held.length;
// (statistics run too: the payback mode's — a few a thing at most, where it used to be without end)
assert(things >= 3 && runs <= 3 * things, `the queue worked out once (${runs} statistics run for ${things} things)`);
assert(q.items.some((x) => (x.rules || []).includes('weight ×2')), 'and it holds: the rule applies');
// inside the queue, buyer.budget() is the bank less what's kept first (here: 1 min of CpS)
B.setRule('payback', B.find('payback').rules.length - 1, { when: `buyer.budget() == ${Game.cookies - 60 * rawCps}` });
Game.cookies += 1;
Game.cookies -= 1;
B.update('payback', {});
q = B.queue();
seen = q.items.some((x) => (x.rules || []).includes('weight ×2'));
assert(seen, 'buyer.budget() inside the queue: the bank less the reserve');
assert(B.budget('payback') === Game.cookies - q.keep, 'and outside it, as before: the bank less what’s kept ahead of what’s next');
B.removeRule('payback', B.find('payback').rules.length - 1);
B.update('payback', { reserve: 0 });

// ---- cheap ×100: Buy all upgrades a rule puts first still goes ahead ----
Game.Objects.Cursor.amount = 5;
B.update('payback', { cheapBulk: (P.sumPrice(Game.Objects.Cursor, 100) * 1.01) / rawCps });
q = B.queue();
assert(q.fast && q.next && q.next.key === 'building:Cursor' && q.next.n === 100, `a cheap ×100 at the front (${q.next && q.next.label})`);
const c0 = P.calls();
for (let i = 0; i < 5; i++) {
  Game.cookies += 1;
  B.queue();
}
assert(P.calls() === c0, `nothing measured while it's cheap (${P.calls() - c0})`);
assert(B.buyNext() === 1 && Game.Objects.Cursor.amount === 105, 'bought 100');
q = B.queue();
assert(!q.fast, 'none cheap now: the ranking is back');
B.update('payback', { cheapBulk: 1 });

// ---- the next achievement: the same count as trying every one ----
Game.Tiers = { 1: { achievUnlock: 1 }, 2: { achievUnlock: 50 } };
Game.Achievements['Grandma tier 2'] = { name: 'Grandma tier 2', won: 0, pool: 'normal' };
Game.Objects.Grandma.tieredAchievs = { 2: { name: 'Grandma tier 2', tier: 2 } };
Object.values(Game.Achievements).forEach((a) => (a.won = 1));
Game.Achievements['Grandma tier 2'].won = 0;
Game.Objects.Grandma.amount = 13;
assert(P.nextAchievement('Grandma').n === 37, `Grandma at 13: 37 to its tier at 50 (${P.nextAchievement('Grandma').n})`);
assert(g.errors.length === 0, `no runtime errors (${g.errors.join('; ')})`);
done();
process.exit();
