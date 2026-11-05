// Golden cookie upgrades: a macro in the Upgrade unlocker that pops golden cookies (wrath ones too) until Lucky day,
// Serendipity and Get lucky are unlocked — so Nunix late game's Drops stage, which leaves golden cookies alone
// (Scorn makes them all wrath cookies), still gets them back after an ascension. A manager already at work whose
// group gained a member sets its stage up again, switching the new one on.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const M = CA.Macros;
const G = CA.Managers;
await sleep(400);

const m = M.get('goldenUpgrades');
assert(m && m.mode === 'flow' && !M.compiledOf(m).errors.length, 'Golden cookie upgrades: code that compiles');
assert(M.get('upgradeUnlocker').members.includes('goldenUpgrades'), 'it’s in the Upgrade unlocker');

// ---- it pops golden and wrath cookies while one of the three isn't unlocked, then stops
const unlocked = new Set();
Game.Has = () => false;
Game.HasUnlocked = (n) => (unlocked.has(n) ? 1 : 0);
let popped = [];
const shimmer = (id, type, wrath) => ({
  id,
  type,
  wrath,
  pop() {
    popped.push(this.id);
    Game.shimmers.splice(Game.shimmers.indexOf(this), 1);
  },
});
const fill = () => (Game.shimmers = [shimmer(1, 'golden', 1), shimmer(2, 'reindeer', 0), shimmer(3, 'golden', 0)]);
fill();
M.runOnce('goldenUpgrades');
assert(popped.sort().join() === '1,3', `none unlocked: golden and wrath cookies popped, not reindeer (${popped})`);
['Lucky day', 'Serendipity'].forEach((n) => unlocked.add(n));
fill();
popped = [];
M.runOnce('goldenUpgrades');
assert(popped.length === 2, 'Get lucky still to come: still pops');
unlocked.add('Get lucky');
fill();
popped = [];
M.runOnce('goldenUpgrades');
assert(popped.length === 0, 'all three unlocked: leaves them alone');
Game.shimmers = [];

// ---- Nunix late game: Drops switches it on (golden and wrath cookies still off)
const N = G.find('nunixLateGame');
const drops = G.effective(N, 0);
assert(drops.macros.upgradeUnlocker === 'on' && drops.macros.golden === 'off' && drops.macros.wrath === 'off', 'Drops: the Upgrade unlocker on, golden and wrath cookies off');

// ---- a manager at work whose group gained a member: its stage sets up again, the new member switched on
Game.resets = 1;
G.use('nunixLateGame');
M.set('manager', true, { silent: true });
await waitFor(() => M.isOn('upgradeUnlocker') && M.isOn('goldenUpgrades'), 3000);
assert(M.isOn('goldenUpgrades') && M.isOn('santa'), 'Drops set up: Golden cookie upgrades on with the rest of the unlocker');
// as a save from before it: the group without it, the macro off
const un = M.get('upgradeUnlocker');
const before = un.members.slice();
un.members = before.filter((id) => id !== 'goldenUpgrades');
await sleep(1200); // a pass: the sig taken with the old members
M.set('goldenUpgrades', false, { silent: true });
un.members = before;
await waitFor(() => M.isOn('goldenUpgrades'), 3000);
assert(M.isOn('goldenUpgrades') && G.where().index === 0, 'the group gained it: Drops sets up again and switches it on');
M.set('manager', false, { silent: true });

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
