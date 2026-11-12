// CookieMgr's own payback numbers (src/features/payback.js) against Cookie Monster's, in the real
// game with Cookie Monster loaded as a mod: every building ×1 / ×10 / ×100 and every upgrade in the
// store — bonus income, payback period, color — in several states of the game (early, mid, with
// buildings not owned yet, a Frenzy, a pantheon god, heavenly upgrades).
import { makeAssert } from '../harness/game.mjs';
import { simWithCookieMonster, settle } from '../harness/cmSim.mjs';

const { assert, done } = makeAssert();
const sim = await simWithCookieMonster({ seed: 7 }); // v3.7.2: waits for Cookie Monster's numbers; skips if it can't be downloaded
const { Game, CA } = sim;
const W = sim.game.ctx;
sim.run({ seconds: 3 });
assert(Game.mods.CookieMonster && W.CookieMonsterData, 'Cookie Monster loaded in the simulated game');

const close = (a, b, tol = 1e-6) => (a === b ? true : Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)));
const fmt = (x) => (typeof x === 'number' ? x.toPrecision(6) : String(x));

/**
 * Lets the game award what it has pending (it checks achievements every 5 s — until then Cookie
 * Monster counts their milk in every hypothetical but not in the CpS it compares with, so every
 * bonus is off by the same amount; CookieMgr counts them on both sides) and Cookie Monster refresh,
 * then compares everything.
 */
function compare(label) {
  let n = 0;
  let u = 0;
  // v3.7.2: given up to three refreshes (settle) — Cookie Monster refreshes on its own schedule
  const bad = settle(sim, () => differences((x, y) => ((n = x), (u = y))));
  assert(!bad.length && n >= 60, `${label}: ${n} building rows and ${u} upgrades match Cookie Monster${bad.length ? ` — ${bad.length} differ: ${bad.slice(0, 6).join('; ')}` : ''}`);
}
function differences(counted) {
  const D = W.CookieMonsterData;
  const t = CA.Payback.table();
  const bad = [];
  let n = 0;
  for (const bulk of [1, 10, 100]) {
    const cm = D[`Objects${bulk}`];
    for (const name of Object.keys(Game.Objects)) {
      const a = t.buildings[bulk][name];
      const b = cm[name];
      if (!b) continue;
      n++;
      if (!close(a.bonus, b.bonus)) bad.push(`${name} ×${bulk} bonus ${fmt(a.bonus)} vs CM ${fmt(b.bonus)}`);
      else if (!close(a.pp, b.pp, 1e-5)) bad.push(`${name} ×${bulk} PP ${fmt(a.pp)} vs CM ${fmt(b.pp)}`);
      // b.colour: Cookie Monster's own field name (its spelling, not ours)
      else if (a.color !== String(b.colour).toLowerCase()) bad.push(`${name} ×${bulk} color ${a.color} vs CM ${b.colour}`);
    }
  }
  let u = 0;
  for (const up of Game.UpgradesInStore) {
    const b = D.Upgrades[up.name];
    const a = t.upgrades[up.name];
    if (!b || !a || up.pool === 'toggle' || !(b.bonus > 0)) continue; // CM prices switches and the Pledge its own way
    u++;
    if (!close(a.bonus, b.bonus)) bad.push(`${up.name} bonus ${fmt(a.bonus)} vs CM ${fmt(b.bonus)}`);
    else if (!(a.mouse > 0) && !close(a.pp, b.pp, 1e-5)) bad.push(`${up.name} PP ${fmt(a.pp)} vs CM ${fmt(b.pp)}`);
  }
  counted(n, u);
  return bad;
}

// ---- early: a few cursors and grandmas
Game.cookies = 2000;
Game.buyMode = 1;
Game.Objects.Cursor.buy(5);
Game.Objects.Grandma.buy(3);
compare('early game');

// ---- mid: buildings up the list, some upgrades, many buildings not owned yet (first-of achievements)
Game.cookies = 1e15;
Game.cookiesEarned = 1e15;
[['Cursor', 80], ['Grandma', 60], ['Farm', 50], ['Mine', 40], ['Factory', 30], ['Bank', 20], ['Temple', 10], ['Wizard tower', 5]].forEach(([n, k]) => Game.Objects[n].buy(k));
sim.run({ seconds: 2 });
Game.UpgradesInStore.slice(0, 25).forEach((x) => x.pool !== 'toggle' && x.pool !== 'tech' && x.buy(1));
Game.cookies = 5e9;
compare('mid game');

// ---- near building-count achievements (×10 / ×100 cross them) and the "total buildings" ones
[['Shipment', 48], ['Alchemy lab', 95], ['Portal', 1]].forEach(([n, k]) => {
  Game.cookies = 1e30;
  Game.Objects[n].buy(k);
});
Game.cookies = 3e12;
compare('around achievements');

// ---- a Frenzy (CpS ×7)
Game.gainBuff('frenzy', 77, 7);
compare('in a Frenzy');
Object.values(Game.buffs).forEach((b) => (b.time = 0));
sim.run({ seconds: 1 });

// ---- more of everything, and a big bank
Game.cookies = 1e40;
Game.cookiesEarned = 1e40;
Object.values(Game.Objects).forEach((o) => o.buy(30));
sim.run({ seconds: 2 });
Game.UpgradesInStore.slice(0, 60).forEach((x) => x.pool !== 'toggle' && x.pool !== 'tech' && x.buy(1));
Game.cookies = 1e20;
compare('late game');

// ---- CookieMgr's own copy changes nothing in the game
const before = [Game.cookiesPs, Game.AchievementsOwned, Game.UpgradesOwned, Game.cookiesPsRawHighest, Object.values(Game.Objects).map((o) => o.amount).join()];
CA.Payback.table();
CA.Payback.buildingBonus('Farm', 37);
const after = [Game.cookiesPs, Game.AchievementsOwned, Game.UpgradesOwned, Game.cookiesPsRawHighest, Object.values(Game.Objects).map((o) => o.amount).join()];
assert(JSON.stringify(before) === JSON.stringify(after), 'measuring leaves the game as it was (CpS, achievements, upgrades, highest CpS, buildings)');

assert(sim.game.errors ? sim.game.errors.length === 0 : true, 'no errors in the game');
done();
process.exit();
