// v3.35.0: the store tooltip's lines in color (Price / Affordable green or red; Next achievement in the
// payback color of buying that many; Wins in the item's), a "Next upgrade" line (the next upgrade
// buying more of the building unlocks, and how many more), and CookieMgr's upgrade info card —
// what it does, costs, adds, its payback period, how it unlocks — on hover wherever the add-on
// shows an upgrade (that line, the Stats page's missing upgrades, the Payback page's tiles).
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(400);

// ---- a game with building tiers, a grandma synergy, a kitten
const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  const b = Game.Objects[n];
  Object.assign(b, { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false, single: n.toLowerCase(), plural: `${n.toLowerCase()}s`, tieredUpgrades: {}, tieredAchievs: {}, synergies: [] });
  b.tooltip = () => `<div class="name">${n}</div>`;
});
Game.Tiers = { 1: { name: 'Plain', unlock: 1, achievUnlock: 1 }, 2: { name: 'Berrylium', unlock: 5, achievUnlock: 50 }, 3: { name: 'Blueberrylium', unlock: 25, achievUnlock: 100 } };
Game.SpecialGrandmaUnlock = 15;
Game.Upgrades = {};
const up = (name, price, more) => {
  const u = new Game.Upgrade(name, price);
  Object.assign(u, { type: 'upgrade', pool: '', unlocked: 0, icon: [2, 0], ddesc: `${name} does a thing.<q>a quote</q>`, getPrice: () => price }, more || {});
  Game.Upgrades[name] = u;
  return u;
};
const F = Game.Objects.Farm;
const plain = up('Cheap hoes', 11000, { buildingTie: F, tier: 1, bought: 1, unlocked: 1 });
const berry = up('Fertilizer', 55000, { buildingTie: F, tier: 2, unlocked: 1 });
const blue = up('Cookie trees', 550000, { buildingTie: F, tier: 3 });
[plain, berry, blue].forEach((u) => (F.tieredUpgrades[u.tier] = u));
const farmer = up('Farmer grandmas', 55000, { buildingTie: F });
F.grandma = farmer;
Game.GrandmaSynergies = ['Farmer grandmas'];
const kitten = up('Kitten helpers', 9e9);
up('Heavenly cookies', 3, { pool: 'prestige' });
F.tieredAchievs = { 2: { name: 'Bigger fields', tier: 2 } };
Game.Achievements['Bigger fields'] = { name: 'Bigger fields', won: 0 };
Game.AchievementsOwned = 4;
Game.UpgradesInStore = [berry];
Game.crateTooltip = (me) => `<div class="name">${me.name}</div>`;
cpsModel(Game, { base: 10, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])), mults: { Fertilizer: 1.5, 'Cookie trees': 2, 'Farmer grandmas': 1.2, 'Kitten helpers': 1.1 } });
Game.buyMode = 1;
Game.buyBulk = 1;
await waitFor(() => /ca-tt/.test(Game.Objects.Farm.tooltip()));

const rows = (html) => {
  const d = doc.createElement('div');
  d.innerHTML = html;
  return Object.fromEntries([...d.querySelectorAll('.ca-tt-row')].map((r) => [r.firstChild.textContent, r.querySelector('b')]));
};

CA.UI.StoreInsight.setLines(['bonus', 'actualGain', 'payback', 'actual', 'afford', 'share', 'next', 'nextUpgrade', 'wins']); // the lines before tooltip layouts changed the Default
// ---- colors: affordable now green, not red
Game.cookies = 1e9;
let r = rows(Game.Objects.Farm.tooltip());
assert(r.Affordable && r.Affordable.textContent === 'now' && r.Affordable.className === 'ca-pp-green', `Affordable now: green (${r.Affordable && r.Affordable.className})`);
Game.cookies = 10;
r = rows(Game.Objects.Farm.tooltip());
assert(r.Affordable && r.Affordable.className === 'ca-pp-red' && !/now/.test(r.Affordable.textContent), `not yet: red (${r.Affordable && r.Affordable.textContent})`);
const priceLine = CA.Stats.line(CA.Stats.get('price'), CA.Stats.contextOf('Farm', 'building'));
assert(priceLine && priceLine[2] === 'ca-pp-red', 'Price: red when you can’t afford it');
Game.cookies = 1e9;
assert(CA.Stats.line(CA.Stats.get('price'), CA.Stats.contextOf('Farm', 'building'))[2] === 'ca-pp-green', '… green when you can');

// the next achievement: in the payback color of buying that many
r = rows(Game.Objects.Farm.tooltip());
const ach = r['Next achievement'];
const ctx = CA.Stats.contextOf('Farm', 'building');
const want = CA.Stats.about(ctx, () => CA.Script.VALUES.find((v) => v.id === 'item.colorOf').get(45));
assert(ach && /^45 more/.test(ach.textContent) && want && ach.className === `ca-pp-${want}`, `Next achievement: 45 more, in the color of 45 more (${ach && ach.className} vs ${want})`);
assert(CA.Stats.get('wins').color === 'payback', 'Wins: in the payback color');

// ---- the next upgrade
assert(JSON.stringify(CA.UpgradeInfo.next('Farm')) === JSON.stringify({ name: 'Farmer grandmas', more: 10, at: 15 }), `the next: Farmer grandmas, 10 more (${JSON.stringify(CA.UpgradeInfo.next('Farm'))})`);
const nu = r['Next upgrade'];
assert(nu && nu.querySelector('.ca-upref[data-upgrade="Farmer grandmas"][data-pop-live="upgrade"]') && /10 more/.test(nu.textContent), `in the tooltip, hoverable (${nu && nu.innerHTML})`);
Game.Objects.Grandma.amount = 0;
assert(CA.UpgradeInfo.next('Farm').name === 'Cookie trees', 'no grandmas: its grandma doesn’t come from more farms — the next tier does');
assert(CA.Script.VALUES.find((v) => v.id === 'building.toNextUpgrade').get('Farm') === 20, 'words: building.toNextUpgrade');
Game.Objects.Grandma.amount = 5;
F.amount = 30;
blue.unlocked = 1;
assert(CA.UpgradeInfo.next('Farm') === null, 'none left: nothing to show');
F.amount = 5;
blue.unlocked = 0;

// ---- how it unlocks
const req = (n) => CA.UpgradeInfo.requirement(n);
assert(req('Cookie trees').text === '25 farms' && req('Cookie trees').have === 5 && req('Cookie trees').need === 25, `a tier: 25 farms (${JSON.stringify(req('Cookie trees'))})`);
assert(req('Farmer grandmas').text === '15 farms and a grandma', 'a grandma synergy');
assert(/^13 achievements/.test(req('Kitten helpers').text), `a kitten: by achievements (${req('Kitten helpers').text})`);
assert(/heavenly/.test(req('Heavenly cookies').text), 'a heavenly upgrade');

// ---- the card
const T = CA.UI.UpgradeTip;
const card = (n) => {
  const d = doc.createElement('div');
  d.innerHTML = T.html(n);
  return d;
};
let c = card('Cookie trees');
assert(/Locked/.test(c.querySelector('.ca-uptip-st').textContent) && /does a thing/.test(c.querySelector('.ca-uptip-desc').textContent), 'locked: its status, the game’s description');
assert(/Unlocks with25 farms \(5 of 25\)/.test(c.textContent), `how it unlocks, and where you are (${c.textContent})`);
assert(/Payback period/.test(c.textContent) && /if you had it now/.test(c.textContent) && c.querySelector('.ca-uptip-row b[class^="ca-pp-"]'), 'a payback period even locked, in its color');
assert(/Adds\+/.test(c.textContent), 'what it would add');
c = card('Cheap hoes');
assert(/Owned/.test(c.textContent) && /Unlocked by1 farm ✓/.test(c.textContent) && !/Payback/.test(c.textContent), `owned: how it was unlocked, no payback (${c.textContent})`);
c = card('Heavenly cookies');
assert(/heavenly chips/.test(c.textContent), 'heavenly: priced in heavenly chips');

// ---- on hover, wherever the add-on shows an upgrade
CA.UI.Menu.openPage('graphs:misc'); // the collection: on the Stats page's Misc tab since v3.47
const icons = [...doc.querySelectorAll('[data-page="graphs"] .ca-col-ico')];
const kIco = icons.find((x) => x.dataset.upgrade === 'Kitten helpers');
assert(kIco && kIco.dataset.popLive === 'upgrade' && !kIco.hasAttribute('data-tip'), 'Stats: a missing upgrade shows the card');
kIco.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
const shown = () => doc.querySelector('#CookieMgrLayer .ca-float');
assert(shown() && shown().style.display === 'block' && /Kitten helpers/.test(shown().querySelector('.ca-uptip b').textContent), 'hovered: the card in the layer');
assert(kitten && /Unlocks with13 achievements/.test(shown().textContent), 'with how it unlocks');
CA.UI.Tips.hide();
CA.UI.Menu.openPage('payback');
const tile = doc.querySelector('[data-page="payback"] [data-pp-up="Fertilizer"]');
assert(tile && tile.dataset.popLive === 'upgrade' && tile.dataset.upgrade === 'Fertilizer', 'Payback: the store’s upgrades show the card');
tile.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
assert(/In the store/.test(shown().textContent) && /Unlocked by5 farms ✓/.test(shown().textContent), `… in the store, how it unlocked (${shown().textContent})`);

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
