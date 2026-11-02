// Achievement info cards: an achievement still to collect on the Stats page's Misc tab shows a card like
// the upgrade one on hover — won or not, the game's description, where you stand on what it counts, what
// the buildings it takes cost, how long the cookies take at your actual income (your CpS until it's recorded), and the milk it adds (with the
// kitten it brings closer). Won ones say so and nothing more; shadow ones add no milk.
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot();
const { window: w, Game } = g;
const doc = w.document;
const CA = w.CookieMgr;
await sleep(300);

const ach = (name, desc, extra) => (Game.Achievements[name] = { name, dname: name, desc, ddesc: desc, icon: [1, 2], won: 0, pool: 'normal', order: Object.keys(Game.Achievements).length, ...extra });
Game.Achievements = {};
const farms = ach('Reap what you sow', 'Have <b>50</b> farms.', { tier: 2 });
Game.Tiers = { 2: { achievUnlock: 50 } };
Object.assign(Game.Objects.Farm, { tieredAchievs: { 2: farms }, plural: 'Farms', basePrice: 1100 });
Game.priceIncrease = 1.15;
const bake = ach('Affluent bakery', 'Bake <b>100 million</b> cookies in one ascension.', { threshold: 1e8 });
Game.BankAchievements = [bake];
ach('Builder', 'Own <b>100</b> buildings.');
ach('Casual baking', 'Bake 1 cookie per second.', { won: 1 });
ach('Third-party', 'Use an <b>add-on</b>.', { pool: 'shadow' });
Game.BuildingsOwned = 25;
Game.cookiesEarned = 4e7;
Game.cookiesPs = 1e4;
Game.cookies = 1e3;
Game.AchievementsOwned = 12;
const kitten = new Game.Upgrade('Kitten helpers', 9e6);
kitten.pool = 'kitten';
Game.Upgrades = { 'Kitten helpers': kitten };
Game.UpgradesByPool = { kitten: [kitten] };

const T = CA.UI.AchievementTip;
const rows = (n) => {
  const d = doc.createElement('div');
  d.innerHTML = T.html(n);
  return { d, r: Object.fromEntries([...d.querySelectorAll('.ca-uptip-row')].map((x) => [x.querySelector('span').textContent, x.querySelector('b').textContent])) };
};

// a building count: where you stand, what the rest costs (red: not in the bank), the milk and the next kitten
let { d, r } = rows('Reap what you sow');
assert(/Not won yet/.test(d.querySelector('.ca-uptip-st').textContent) && /Have 50 farms/.test(d.querySelector('.ca-uptip-desc').textContent), 'not won yet; the game’s description');
const fa = Game.Objects.Farm.amount;
assert(r.Farms === `${fa} of 50`, `farms: ${JSON.stringify(r)}`);
const cost = Object.keys(r).find((k) => /more cost$/.test(k));
assert(cost === `${50 - fa} more cost` && r[cost] === CA.Format.beautify(CA.Payback.sumPrice(Game.Objects.Farm, 50 - fa)) && d.querySelector('.ca-uptip-row b.ca-pp-red'), `what the farms cost, in red (${cost} ${r[cost]})`);
assert(r.Milk === '+4% (unlocks Kitten helpers)', `milk, the kitten it unlocks (13th achievement): ${r.Milk}`);
Game.AchievementsOwned = 10;
assert(rows('Reap what you sow').r.Milk === '+4% (3 more for Kitten helpers)', `3 more for the kitten: ${rows('Reap what you sow').r.Milk}`);

// cookies baked: the time to go at your CpS while too little is recorded…
({ r } = rows('Affluent bakery'));
assert(r['Baked this ascension'] === `${CA.Format.beautify(4e7)} of ${CA.Format.beautify(1e8)}`, `cookies baked: ${r['Baked this ascension']}`);
assert(r['At your CpS'] === '1h 40m to go' && !('By actual income' in r), `6e7 at 1e4/s: ${r['At your CpS']}`);
// …then at your actual income over the Actual income window, like the tooltips
const P = CA.Payback;
const { incomeOver } = P;
P.incomeOver = (secs) => ({ actual: 2e4, secs, window: secs });
({ r } = rows('Affluent bakery'));
assert(r['By actual income'] === `50m to go (${P.actualWindowText()})` && !('At your CpS' in r), `6e7 at 2e4/s actual: ${JSON.stringify(r)}`);
P.incomeOver = incomeOver;
({ r } = rows('Builder'));
assert(r.Buildings === '25 of 100' && !('At your CpS' in r), `buildings: ${r.Buildings}`);

// won: "Won", no rows; shadow: no milk
({ d } = rows('Casual baking'));
assert(/^Won$/.test(d.querySelector('.ca-uptip-st').textContent) && !d.querySelector('.ca-uptip-row'), 'won: no rows');
({ d, r } = rows('Third-party'));
assert(/Shadow/.test(d.querySelector('.ca-uptip-st').textContent) && /^none/.test(r.Milk), `shadow: no milk (${r.Milk})`);

// ---- on hover, in Stats → Misc → Still to collect
CA.UI.Menu.openPage('graphs:misc');
const icons = [...doc.querySelectorAll('[data-page="graphs"] .ca-col-ico')];
const ico = icons.find((x) => x.dataset.achievement === 'Reap what you sow');
assert(ico && ico.dataset.popLive === 'achievement' && !ico.hasAttribute('data-tip'), 'Stats: a missing achievement shows the card');
ico.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
const shown = doc.querySelector('#CookieMgrLayer .ca-float');
assert(shown && shown.style.display === 'block' && /Reap what you sow/.test(shown.querySelector('.ca-uptip b').textContent) && /of 50/.test(shown.textContent), 'hovered: the card in the layer');
CA.UI.Tips.hide();

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
