// Prices that scale with CpS look past a short effect: an upgrade priced in minutes of the CpS the game
// shows (Wrinkler ambergris, the garden drops' cookies) or a seed costs 7 times as much in a Frenzy. An
// effect that ends within the Payback option "Wait out effects up to" (600 s) is priced away — payback
// periods, the queue and the garden banks count the price once it's over — and waited out: the Auto buyer
// holds the thing, Buy all upgrades leaves it out. One with longer left is part of the price.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, errors } = g;
const CA = w.CookieMgr;
const M = makeGarden(Game);
M.plotLimits = [[2, 2, 4, 4], [2, 2, 5, 4], [2, 2, 5, 5], [1, 2, 5, 5], [1, 1, 5, 5], [1, 1, 6, 5], [1, 1, 6, 6], [0, 1, 6, 6], [0, 0, 6, 6]];
Game.Objects.Farm.level = 8;
await sleep(400);
const P = CA.Payback;
const B = CA.AutoBuyer;
const value = (id, ...args) => CA.Script.VALUES.find((v) => v.id === id).get(...args);
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

// Wrinkler ambergris: +6% CpS for a minute of CpS (the game's priceFunc); a plain upgrade beside it
const amber = new Game.Upgrade('Wrinkler ambergris', 0);
amber.priceFunc = () => 60 * Game.cookiesPs;
amber.getPrice = function () {
  return this.priceFunc(this);
};
amber.buy = function () {
  if (this.bought || Game.cookies < this.getPrice()) return 0;
  Game.cookies -= this.getPrice();
  return (this.bought = 1);
};
const plain = new Game.Upgrade('Plain cookies', 1e5);
[amber, plain].forEach((u) => Object.assign(u, { type: 'upgrade', unlocked: 1, pool: '' }));
Game.Upgrades = { 'Wrinkler ambergris': amber, 'Plain cookies': plain };
Game.UpgradesInStore = [amber, plain];
cpsModel(Game, { base: 1000, mults: { 'Wrinkler ambergris': 1.06, 'Plain cookies': 1.01 } });
Game.cookies = 1e9;
const fps = Game.fps || 30;
const frenzy = (secs) => {
  Game.buffs = secs ? { Frenzy: { multCpS: 7, time: secs * fps } } : {};
  Game.CalculateGains();
  Game.cookies += 1; // a fresh table and queue (memoized for a moment on the bank)
};

// ---- no effect: today's price
let c = P.upgradeCost(amber);
assert(near(c.price, 6e4) && !c.waits, `no effect: a minute of CpS (${c.price})`);
assert(value('payback.waitingOut') === false && value('payback.effectBoost') === 1 && value('payback.effectWait') === 600, 'the words: not waiting out; boost 1; wait 600 s');

// ---- a Frenzy ending within 10 m: priced away, waited out
frenzy(60);
assert(near(amber.getPrice(), 42e4), 'the game asks 7 times as much in a Frenzy');
c = P.upgradeCost(amber);
assert(near(c.price, 6e4) && c.waits, `1 m of Frenzy left: priced as once it's over (${c.price}), and it waits`);
assert(near(Game.cookiesPs, 7000), 'CpS put back after asking the price');
assert(value('payback.waitingOut') === true && value('payback.effectLeft') === 60 && value('payback.effectBoost') === 7, 'the words: waiting out 60 s of ×7');
assert(near(P.upgradeCost(plain).price, 1e5) && !P.upgradeCost(plain).waits, 'a fixed price: as it is');
const row = P.ranking('upgrade', { all: true }).find((x) => x.name === 'Wrinkler ambergris');
assert(row && row.waits && near(row.price, 6e4), `its payback period counts that price (${row && row.price})`);
assert(P.table().upgrades['Wrinkler ambergris'].waits && near(P.table().upgrades['Wrinkler ambergris'].price, 6e4), 'the store table too');
assert(P.buy(row) === 0 && !amber.bought, 'buying it waits');
let all = P.allUpgrades();
assert(!all.names.includes('Wrinkler ambergris') && all.names.includes('Plain cookies'), `Buy all upgrades leaves it out (${all.names})`);
let q = B.queue('payback');
let held = q.held.find((x) => x.key === 'upgrade:Wrinkler ambergris');
assert(held && /more expensive: waits it out/.test(held.why), `the Auto buyer holds it (${held && held.why})`);
assert(!q.items.some((x) => x.key === 'upgrade:Wrinkler ambergris'), 'not among what it buys');

// ---- a Frenzy with 15 m left (frenzies back to back): part of the price
frenzy(900);
c = P.upgradeCost(amber);
assert(near(c.price, 42e4) && !c.waits, `15 m left: today's price (${c.price})`);
q = B.queue('payback');
assert(q.items.concat(q.held).some((x) => x.key === 'upgrade:Wrinkler ambergris' && !/waits it out/.test(x.why || '')), 'the Auto buyer ranks it at today’s price');
// the option: wait out up to 20 m
CA.Settings.set('ppEffectWait', 1200);
assert(P.upgradeCost(amber).waits && value('payback.effectWait') === 1200, 'Wait out effects up to 1200 s: it waits again');
CA.Settings.set('ppEffectWait', 600);

// ---- the garden: Garden replant bank and the gardener follow the same rule
M.plants.goldenClover.unlocked = 1;
M.plants.nursetulip.unlocked = 1;
CA.GardenLayers.pick('profile', 'tulipCombos');
cpsModel(Game, { base: 1e10 }); // seeds' CpS part well above their floor
frenzy(0);
const layout = CA.Garden.layoutCost();
frenzy(60);
assert(near(CA.Garden.layoutCost(), layout), `a short Frenzy: the Garden replant bank at the price once it's over (${CA.Garden.layoutCost()} vs ${layout})`);
frenzy(900);
assert(near(CA.Garden.layoutCost(), 7 * layout), 'a long one: today’s');
const knobs = CA.GardenLayers.get('gardener', 'tulipRounds').data.knobs;
assert(knobs.waitOutEffects && !('waitOutUpTo' in knobs), 'the gardener’s waitOutEffects follows the option (no knob of its own)');
assert(CA.Script.compile(CA.GardenLayers.get('gardener', 'tulipRounds').data.rules).errors.length === 0, 'the gardener compiles');

// ---- a short effect beside a long one (Oiled-up's 44 s inside an hour of Frenzy): each counts on its own
const boosts = (list) => {
  Game.buffs = Object.fromEntries(list.map(([name, mult, secs]) => [name, { multCpS: mult, time: secs * fps }]));
  Game.CalculateGains();
  Game.cookies += 1;
};
boosts([['Frenzy', 7, 3600], ['Oiled-up', 88, 44]]);
assert(P.waitingOut() && near(P.shortBoost(), 88) && near(value('payback.shortBoost'), 88), `the Oiled-up alone is waited out (short boost ${P.shortBoost()})`);
assert(near(CA.Garden.layoutCost(), 7 * layout), `Garden replant priced with the Frenzy, without the Oiled-up (${CA.Garden.layoutCost() / layout}×)`);
c = P.upgradeCost(amber);
assert(near(c.price, 60 * 7 * Game.unbuffedCps) && c.waits, `ambergris: the Frenzy's price, and it waits the Oiled-up out (${c.price})`);
// the Auto buyer: no garden bank kept, no seeds bought while it runs
B.update('payback', { banks: ['garden', 'gardenRounds'], kinds: { building: true, upgrade: true, garden: true } });
Game.cookies = 1;
q = B.queue('payback');
assert(!q.items.concat(q.held).some((x) => x.kind === 'bank') && B.reserveParts('payback').length === 0, `a short boost: the garden banks keep nothing (${B.reserveParts('payback').map((x) => x.id)})`);
assert(!q.items.some((x) => x.kind === 'garden') && (!q.wait || q.wait.kind !== 'bank'), 'no seeds bought, not saving for the garden');
assert(q.held.filter((x) => x.kind === 'garden').every((x) => x.why), `the seeds are held (${q.held.filter((x) => x.kind === 'garden').map((x) => x.why)})`);
// the gardener waits it out too
assert(/payback\.shortBoost\(\) <= 1/.test(CA.GardenLayers.get('gardener', 'tulipRounds').data.rules), 'the gardener asks payback.shortBoost()');
// the Oiled-up over, the hour of Frenzy left: the banks are back, at the Frenzy's prices
boosts([['Frenzy', 7, 3600]]);
q = B.queue('payback');
assert(!P.waitingOut() && B.reserveParts('payback').map((x) => x.id).join() === 'garden,gardenRounds', 'only a long Frenzy: the garden banks are back');
assert(near(B.reserveParts('payback').find((x) => x.id === 'garden').amount, 7 * layout), 'at today’s price');
boosts([]);
B.update('payback', { banks: [], kinds: { building: true, upgrade: true, garden: false } });

// ---- the option on the Payback page
frenzy(60);
CA.UI.Menu.openPage('payback');
await sleep(50);
const menu = w.document.getElementById('CookieMgrMenu');
const input = menu.querySelector('[data-pp-num="ppEffectWait"]');
assert(input && input.value === '600' && /waiting one out \(1m 00s left\)/.test(menu.textContent), 'Wait out effects up to, on the Payback page, saying it waits one out');
input.value = '30';
input.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(P.effectWait() === 30 && !P.waitingOut(), 'set there: 30 s, so 1 m of Frenzy is part of the price');

assert(errors.length === 0, `no runtime errors (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);
done();
process.exit();
