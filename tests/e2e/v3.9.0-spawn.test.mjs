// v3.9.0: the next golden cookie as statistics, and timer bars on its chart — and switches out of payback:
//   the next golden cookie as statistics — the distribution card on the Stats page (numbers, the
//   chart with its hover readout, percentiles, what moves it and the what-if) (v3.19: the Golden
//   cookies widget and its sparkline are gone)
//   (the distribution itself is checked against the real game in tests/sim/golden-spawn)
//   switches out of payback — no payback period, never the best buy, never bought by the buyers;
//   the Payback page shows them only on request, grayed; the store gives them no block and sorts them last
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const V = (id, ...a) => CA.Script.VALUES.find((v) => v.id === id).get(...a);

// ---- the distribution card
Game.fps = 30;
const lucky = new Game.Upgrade('Lucky day', 1);
lucky.bought = 1;
Game.Has = (n) => n === 'Lucky day';
Game.Upgrades = { 'Lucky day': lucky };
Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 30 * 330, minTime: 30 * 300, maxTime: 30 * 900, spawned: 0, n: 0, spawnConditions: () => true });
const d = CA.Timers.distribution('golden');
assert(d && d.factors.some((x) => x.name === 'Lucky day' && x.k === 0.5) && d.next.min === 150 && d.next.max === 450, `what moves it: Lucky day ×0.5 → next cycle 2m30–7m30 (${d.next.min}–${d.next.max})`);
const wt = d.wait;
assert(wt.soonest === 0 && wt.mean > 0 && wt.median > 0 && wt.mode > 0 && wt.pct(10) <= wt.pct(25) && wt.pct(25) <= wt.median && wt.median <= wt.pct(75) && wt.pct(75) <= wt.pct(90) && wt.pct(90) <= wt.latest, 'percentiles in order, soonest → latest');
assert(Math.abs(wt.pdf.reduce((a, b) => a + b, 0) - wt.cdf[wt.cdf.length - 1]) < 1e-9 && wt.cdf[wt.cdf.length - 1] > 0.998, 'the density sums to the cumulative chance (99.9% drawn)');
assert(wt.hazard > 0 && wt.hazard < 1 && Math.abs(wt.within(1) - wt.hazard) < 1e-9, 'the chance in this second');
CA.UI.Menu.openPage('stats');
const card = () => doc.querySelector('[data-page="graphs"] [data-st-spawn]');
// (v3.14.0 made the card’s chart this cycle’s cumulative chance with a now line — tests/e2e/v3.14.0.test.mjs)
assert(card() && card().querySelector('[data-sp-chart="golden"] .ca-sp-cdf') && card().querySelector('.ca-sp-now'), 'the chart: cumulative chance, the now line');
assert(/Expected wait/.test(card().textContent) && /Wrath chance/.test(card().textContent), 'the numbers: expected wait, wrath chance');
// hover
const svg = card().querySelector('[data-sp-chart]');
svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 150 });
svg.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 320, clientY: 40 }));
assert(card().querySelector('.ca-sp-hover') && /by then/.test(card().querySelector('.ca-sp-hover').textContent), 'hover: the moment under the pointer, its chances');
// what if
click(w, card().querySelector('[data-sp-without][data-name="Lucky day"]'));
assert(card().querySelector('.ca-sp-factor.off') && /without Lucky day: 7m 2[67]s/.test(card().textContent.replace(/\s+/g, ' ')), `what if: without Lucky day, a fresh cycle takes about 7m 27s on average (446.6 s) (${(card().textContent.match(/without Lucky day: [^(]*/) || [''])[0]})`);
// reindeer at Christmas
Game.season = 'christmas';
Game.shimmerTypes.reindeer = Object.assign(Game.shimmerTypes.reindeer || {}, { time: 0, minTime: 30 * 180, maxTime: 30 * 360, spawned: 0, n: 0, spawnConditions: () => Game.season === 'christmas' });
CA.UI.Menu.render();
assert(doc.querySelector('[data-page="graphs"] [data-st-reindeer] [data-sp-chart="reindeer"]'), 'at Christmas: the next reindeer too');
Game.season = '';
// ---- the timer bars, on the chart's axis, and the chance of a golden cookie before each effect ends
Game.buffs = {
  Frenzy: { name: 'Frenzy', time: 30 * 60, maxTime: 30 * 77, multCpS: 7 },
  'Click frenzy': { name: 'Click frenzy', time: 30 * 10, maxTime: 30 * 13, multClick: 777 },
  Clot: { name: 'Clot', time: 30 * 2000, maxTime: 30 * 2000, multCpS: 0.5 },
};
const bw = CA.Timers.distribution('golden').wait;
const eff = CA.Timers.buffsWithGolden();
const fr = eff.find((b) => b.name === 'Frenzy');
assert(fr && Math.abs(fr.golden - bw.within(60)) < 1e-12 && fr.golden > 0 && fr.golden < 1, `Frenzy, 60 s left: a golden cookie before it ends ${(fr.golden * 100).toFixed(1)}% (the chance within 60 s)`);
assert(eff.find((b) => b.name === 'Clot').golden > 0.999, 'an effect outlasting the latest: surely one comes first');
assert(Math.abs(V('buff.goldenChance', 'frenzy') - fr.golden) < 1e-12 && V('buff.goldenChance', 'Dragonflight') === 0, 'the word buff.goldenChance (0 when not running)');
CA.UI.Menu.render();
const lanes = [...card().querySelectorAll('[data-sp-chart="golden"] .ca-sp-lane')];
assert(lanes.length === 3 && lanes.some((l) => l.classList.contains('up')) && lanes.some((l) => l.classList.contains('click')) && lanes.some((l) => l.classList.contains('down')), `the bars: each effect (boost, click, malus) — ${lanes.map((l) => l.getAttribute('class')).join(' | ')}`);
const svgG = card().querySelector('[data-sp-chart="golden"]');
const ax = (s) => 8 + ((640 - 16) * Math.min(900, s)) / 900; // this cycle's axis: 0 → 15 min since the last
const frLane = lanes.find((l) => /Frenzy/.test(l.textContent));
const frW = Number(frLane.querySelector('.left').getAttribute('width'));
const frX = Number(frLane.querySelector('.left').getAttribute('x'));
// (v3.14.0: from when it started — 17 s ago — and the bar gives its multiplier, not the chance)
assert(Math.abs(frX - ax(313)) < 0.05 && Math.abs(frX + frW - ax(390)) < 0.05, `the Frenzy bar runs from when it started (313 s in) to 60 s from now on the chart's own axis (x ${frX.toFixed(1)}–${(frX + frW).toFixed(1)} vs ${ax(313).toFixed(1)}–${ax(390).toFixed(1)})`);
assert(/×7 income/.test(frLane.textContent) && !/golden cookie before it ends/.test(frLane.textContent), 'the bar says its multiplier');
assert(/→/.test(lanes.find((l) => /Clot/.test(l.textContent)).textContent), 'a bar past the chart’s end: an arrow');
assert(Number(svgG.getAttribute('viewBox').split(' ')[3]) === 150 + 3 * 14, 'the chart grows a lane per bar');
Game.buffs = {};
CA.UI.Menu.render();

// ---- switches out of payback
const spec = { Cursor: [15, 0.1], Grandma: [100, 1] };
Object.keys(spec).forEach((n, i) => Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5 }));
const kitten = new Game.Upgrade('Kitten helpers', 5000);
const gold = new Game.Upgrade('Golden switch [off]', 10); // +50% CpS for almost nothing — but a switch
gold.pool = 'toggle';
const pledge = new Game.Upgrade('Elder Pledge', 1);
pledge.pool = 'toggle';
Game.UpgradesInStore = [kitten, gold, pledge];
Game.Upgrades = { 'Kitten helpers': kitten, 'Golden switch [off]': gold, 'Elder Pledge': pledge };
Game.Has = (n) => !!(Game.Upgrades[n] && Game.Upgrades[n].bought);
cpsModel(Game, { base: 1000, each: { Cursor: 0.1, Grandma: 1 }, mults: { 'Kitten helpers': 1.2, 'Golden switch [off]': 1.5 } });
Game.cookies = 1e6;
const t = CA.Payback.table();
assert(t.upgrades['Kitten helpers'] && !t.upgrades['Golden switch [off]'] && !t.upgrades['Elder Pledge'] && t.switches.join() === 'Golden switch [off],Elder Pledge', 'switches: not in the payback table, listed apart');
assert(CA.Payback.isSwitch(gold) && !CA.Payback.isSwitch(kitten), 'isSwitch: the toggle pool');
assert(Number.isNaN(V('upgrade.payback', 'Golden switch [off]')) && Number.isNaN(V('upgrade.gain', 'Elder Pledge')) && Number.isFinite(V('upgrade.payback', 'Kitten helpers')), 'upgrade.payback / gain of a switch: NaN');
assert(CA.Payback.best('all').name !== 'Golden switch [off]' && V('pp.best', 'upgrade', false) === 'upgrade:Kitten helpers' && V('best', 'upgrade') === 'Kitten helpers', 'never the best buy (pp.best, best)');
CA.AutoBuyer.use('upgrades'); // v3.43: Best upgrade → the Auto buyer, Upgrades only
CA.Macros.runOnce('autoBuyer');
assert(!gold.bought && !pledge.bought && kitten.bought, 'Best upgrade buys the upgrade, never a switch');
kitten.bought = 0;
CA.Actions.run('buy.best', { kind: 'upgrade' });
assert(!gold.bought && kitten.bought, 'buy.best: the same');
kitten.bought = 0;
Game.CalculateGains();
// the Payback page: hidden by default, grayed on request
CA.UI.Menu.openPage('payback');
const pp = () => doc.querySelector('[data-page="payback"]');
assert(!pp().querySelector('.ca-pp-switch') && pp().querySelector('[data-pp-up="Kitten helpers"]'), 'Payback page: upgrades only, by default');
click(w, pp().querySelector('[data-pp-opt="ppShowSwitches"]'));
assert(CA.Settings.get('ppShowSwitches') === true && pp().querySelectorAll('.ca-pp-switch').length === 2 && !pp().querySelector('.ca-pp-switch[data-pp-up]'), 'the chip: switches shown, grayed, no PP, not buyable from here — and remembered');
click(w, pp().querySelector('[data-pp-opt="ppShowSwitches"]'));
assert(!pp().querySelector('.ca-pp-switch'), 'and hidden again');
// the store: no block on a switch's tooltip, last in the upgrade sort
Game.crateTooltip = (me) => `<div>${me.name}</div>`;
CA.UI.StoreInsight.init && 0; // (already started)
const crates = ['upgrade0', 'upgrade1', 'upgrade2'].map((id) => {
  const el = doc.createElement('div');
  el.id = id;
  doc.body.appendChild(el);
  return el;
});
await sleep(600); // its painter wraps crateTooltip and paints
gold.type = 'upgrade';
kitten.type = 'upgrade';
assert(!/ca-tt/.test(Game.crateTooltip(gold, 'store')) && /ca-tt/.test(Game.crateTooltip(kitten, 'store')), 'the store tooltip: no payback block on a switch');
Game.buyMode = 1; // the store sorts while buying
CA.Settings.set('storeUpgradeSort', true);
CA.UI.StoreInsight.paint();
assert(Number(crates[0].style.order) < Number(crates[1].style.order) && Number(crates[0].style.order) < Number(crates[2].style.order) && !crates[1].querySelector('.ca-pp-updot'), `the store's upgrade sort: the upgrade first, switches last, no dot (${crates.map((c) => c.style.order)})`);
CA.Settings.set('storeUpgradeSort', false);
CA.UI.StoreInsight.paint();
assert(!crates[0].style.order, 'sort off: the game’s order');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
