// A manager's dragon profile after an ascension: the dragon starts over, so while it has one aura slot
// only the profile's first aura fits. The manager keeps the profile coming until all its auras are in:
// once the second slot opens (dragon level 27) the second aura goes in too.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
await sleep(400);
const G = CA.Managers;
const D = CA.Dragon;
const M = CA.Macros;
const name = (s) => (Game.dragonAuras[s] || {}).name;

// the game's auras (ids as in main.js) and 28 levels; switching a slot costs a building
const NAMES = ['No aura', 'Breath of Milk', 'Dragon Cursor', 'Elder Battalion', 'Reaper of Fields', 'Earth Shatterer', 'Master of the Armory', 'Fierce Hoarder', 'Dragon God', 'Arcane Aura', 'Dragonflight', 'Ancestral Metamorphosis', 'Unholy Dominion', 'Epoch Manipulator', 'Mind Over Matter', 'Radiant Appetite', "Dragon's Fortune", "Dragon's Curve", 'Reality Bending', 'Dragon Orbs', 'Supreme Intellect', 'Dragon Guts'];
Game.dragonAuras = {};
NAMES.forEach((n, i) => (Game.dragonAuras[i] = { id: i, name: n, dname: n, pic: [i, 25], desc: '' }));
Game.dragonLevels = Array.from({ length: 28 }, (_, i) => ({ name: `L${i}`, pic: 0, cost: () => false, buy() {}, costStr: () => '' }));
Object.values(Game.Objects).forEach((o) => {
  o.amount = 300;
  o.sacrifice = (n) => (o.amount -= n);
});

M.set('manager', false, { silent: true });
// a dragon after its dragon cookie (level 26): every aura trained, one slot
Game.dragonLevel = 26;
Game.dragonAura = 0;
Game.dragonAura2 = 0;
assert(D.slots() === 1, `one slot at level 26 (${D.slots()})`);

G.goTo(1); // Nunix late game, Drops: dragon profile drops = Mind Over Matter + Dragon Guts
G.step();
assert(name(Game.dragonAura) === 'Mind Over Matter' && !Game.dragonAura2, `slot 1: Mind Over Matter (${name(Game.dragonAura)})`);
assert(D.isActive('drops') && !D.isComplete('drops'), 'in as far as it fits, not complete');
let p = G.where().pending.find((x) => x.kind === 'dragon');
assert(p && /second aura slot/.test(p.waits), `the manager still waits for it: ${p && p.waits}`);

// fully trained: the second slot opens
Game.dragonLevel = D.LAST;
assert(D.slots() === 2, 'two slots at the last level');
G.step();
assert(/mind over matter/i.test(name(Game.dragonAura)) && /dragon guts/i.test(name(Game.dragonAura2)), `both in: ${name(Game.dragonAura)} + ${name(Game.dragonAura2)}`);
assert(D.isComplete('drops') && !G.where().pending.some((x) => x.kind === 'dragon'), 'complete: no longer waiting');

// then it's left alone: an aura switched by hand stays
D.setAura('Radiant Appetite', 2);
G.step();
assert(/radiant appetite/i.test(name(Game.dragonAura2)), `a hand switch stays (${name(Game.dragonAura2)})`);

M.list().forEach((m) => M.isOn(m.id) && M.set(m.id, false, { silent: true }));
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
