// v3.14.0: the next golden cookie as this cycle's cumulative chance — the Stats card's chart is the
// time since the last one left (0 → the latest it can come) against the chance one has come by then,
// a dashed line at 50%, a now line sweeping across it; the numbers are the expected wait, the odds so
// far (0% → 100%) and the wrath chance; the percentiles and notes are gone; "Golden cookie frequency
// effects" (was "Making them come sooner"); effects as bars on the same axis, each with what it
// multiplies your income by (CA.Timers.effectiveMult — a click effect at your click rate), no golden
// cookie chance; the Next golden cookie widget draws the same chart.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);

Game.fps = 30;
Game.Has = (n) => n === 'Lucky day';
Game.hasBuff = () => false;
Game.buffs = {};
// this cycle: 5–15 min (fixed when the last left), 6 min in
Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 30 * 360, minTime: 30 * 300, maxTime: 30 * 900, spawned: 0, n: 0, spawnConditions: () => true });

// ---- the curve: from when the last one left
const d = CA.Timers.distribution('golden');
const c = d.cycle;
const fresh = CA.Timers.waitFrom({ time: 0, minTime: 30 * 300, maxTime: 30 * 900 });
assert(c.cdf(0) === 0 && c.cdf(299) === 0 && c.cdf(900) === 1 && c.cdf(2000) === 1, 'the cycle’s cumulative chance: 0 before the soonest, 1 at the latest');
assert([310, 400, 500, 650, 800].every((s) => Math.abs(c.cdf(s) - fresh.within(s)) < 1e-12), 'the same curve as a fresh cycle’s wait (CA.Timers.waitFrom from 0)');
assert([300, 400, 500, 600, 700, 800, 900].every((s, i, a) => !i || c.cdf(s) >= c.cdf(a[i - 1])), 'rising');
assert(Math.abs(c.by - c.cdf(360)) < 1e-12 && c.by > 0 && c.by < 0.01, `the odds so far, 6 min in: ${(c.by * 100).toFixed(3)}%`);

// ---- the card
CA.UI.Menu.openPage('stats');
const card = () => doc.querySelector('[data-page="graphs"] [data-st-spawn]');
const text = () => card().textContent.replace(/\s+/g, ' ');
const svg = () => card().querySelector('[data-sp-chart="golden"]');
assert(svg() && svg().classList.contains('ca-sp-cycle') && svg().querySelector('.ca-sp-cdf') && svg().querySelector('.ca-sp-half') && svg().querySelector('.ca-sp-now line'), 'the chart: the curve, the dashed 50% line, the now line');
assert(!svg().querySelector('.ca-sp-pdf') && !svg().querySelector('.ca-sp-band') && !svg().querySelector('.ca-sp-mean') && !svg().querySelector('.ca-sp-lane.next'), 'no density bars, bands, mean / median ticks or window bar');
const X = (s) => 8 + ((640 - 16) * s) / 900; // 0 → 15 min since the last
const nowX = () => Number(svg().querySelector('.ca-sp-now line').getAttribute('x1'));
assert(Math.abs(nowX() - X(360)) < 0.05, `the now line at 6 min of 15 (x ${nowX()} vs ${X(360).toFixed(2)})`);
const half = svg().querySelector('.ca-sp-half');
const y0 = 150 - 22;
const y1 = 10;
// (v3.19.1: the dashed line across sits at the curve's height at the expected moment, not 50%)
const hp = d.cycle.cdf(d.cycle.elapsed + d.wait.mean);
assert(Math.abs(Number(half.getAttribute('y1')) - (y0 - (y0 - y1) * hp)) < 0.05 && svg().textContent.includes(`${(hp * 100).toFixed(hp < 0.1 ? 1 : 0)}%`), `the dashed line across, at the expected moment's height (${(hp * 100).toFixed(1)}%)`);
const ticks = [...svg().querySelectorAll('.ca-sp-ticks text')].map((t) => t.textContent);
assert(ticks[0] === '0' && ticks[ticks.length - 1] === CA.Format.span(900), `the axis: 0 → the latest (${ticks.join(', ')})`);
assert(/Expected wait/.test(text()) && text().includes(CA.Format.span(d.wait.mean)) && /Odds so far/.test(text()) && /Wrath chance/.test(text()), 'the numbers: expected wait, odds so far, wrath chance');
assert(!/Most likely/.test(text()) && !/soonest/.test(text()) && !/median/.test(text()) && !/This cycle/.test(text()) && !/Next cycle/.test(text()) && !card().querySelector('.ca-sp-legend'), 'no percentiles, within-chips, legend or cycle notes');
assert(/Frequency effects:/.test(text()) && !/Making them come sooner/.test(text()) && card().querySelector('[data-sp-without][data-name="Lucky day"]'), 'Golden cookie frequency effects, as chips');

// ---- time passes: the line sweeps right, the odds so far climb
const before = c.by;
Game.shimmerTypes.golden.time = 30 * 450;
CA.UI.Menu.render();
const by450 = CA.Timers.distribution('golden').cycle.by;
const pc = `${(by450 * 100).toFixed(by450 < 0.1 ? 1 : 0)}%`;
assert(Math.abs(nowX() - X(450)) < 0.05 && by450 > before && by450 > 0.5, `7m 30s in: the line further right, past 50% (${pc})`);
assert(svg().querySelector('.ca-sp-now text').textContent === pc && text().includes(`Odds so far${pc}`), `the line and the tile say ${pc} (${svg().querySelector('.ca-sp-now text').textContent} · ${(text().match(/Odds so far[^o]*/) || [''])[0]})`);

// ---- hover
const s = svg();
s.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 150 });
s.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: X(400), clientY: 40 }));
const hov = card().querySelector('.ca-sp-hover');
assert(hov && /after the last/.test(hov.textContent) && hov.textContent.includes(`${(CA.Timers.distribution('golden').cycle.cdf(400) * 100).toFixed(1)}%`), `hover: the moment under the pointer, its chance by then (${hov && hov.textContent})`);

// ---- effects, on the same axis: from when each started to when it ends
Game.buffs = { Frenzy: { name: 'Frenzy', time: 30 * 60, maxTime: 30 * 77, multCpS: 7 } };
CA.UI.Menu.render();
const fr = card().querySelector('.ca-sp-lane.up .left');
assert(fr && Math.abs(Number(fr.getAttribute('x')) - X(433)) < 0.05 && Math.abs(Number(fr.getAttribute('x')) + Number(fr.getAttribute('width')) - X(510)) < 0.05, 'the Frenzy bar: from when it started (17 s ago) to 60 s from now');
const frLane = card().querySelector('.ca-sp-lane.up');
assert(/Frenzy · ×7 income · 1m 00s/.test(frLane.textContent) && !/before it ends/.test(frLane.textContent), `its label: the multiplier and the time left, no golden cookie chance (${frLane.textContent})`);

// ---- a click effect: what it multiplies your income by, at your click rate
const CPS = 100;
Game.unbuffedCps = CPS;
Game.cookiesPs = CPS;
Game.mouseCps = () => {
  let m = 1;
  Object.values(Game.buffs).forEach((b) => b.multClick !== undefined && (m *= b.multClick));
  return (1 + Game.cookiesPs * 0.01) * m; // +1% of CpS a click, × click effects
};
const cf = { name: 'Click frenzy', time: 30 * 10, maxTime: 30 * 13, multClick: 777 };
Game.buffs = { 'Click frenzy': cf };
CA.Payback.clickRate = () => 10;
const want = (CPS + 10 * 2 * 777) / (CPS + 10 * 2); // a click: 1 + 1 = 2 cookies
assert(Math.abs(CA.Timers.effectiveMult('click frenzy').mult - want) < 1e-9, `Click frenzy at 10 clicks/s with 100 CpS and 2 a click: ×${want.toFixed(1)} income`);
assert(Math.abs(CA.Script.VALUES.find((v) => v.id === 'buff.effectiveMult').get('Click frenzy') - want) < 1e-9 && CA.Script.VALUES.find((v) => v.id === 'buff.effectiveMult').get('Frenzy') === 1, 'the word buff.effectiveMult (1 when not running)');
CA.Payback.clickRate = () => 0;
assert(CA.Timers.effectiveMult('Click frenzy').mult === 1, 'not clicking: a click effect adds nothing');
Game.buffs = { Frenzy: { name: 'Frenzy', time: 30 * 60, maxTime: 30 * 77, multCpS: 7 } };
CA.Payback.clickRate = () => 10;
const wantF = (CPS * 7 + 10 * (1 + 7)) / (CPS + 10 * 2); // Frenzy also makes each click's 1% of CpS worth 7×
assert(Math.abs(CA.Timers.effectiveMult('Frenzy').mult - wantF) < 1e-9, `Frenzy with clicking: ×${wantF.toFixed(2)} (the clicks' share of CpS counted)`);
Game.buffs = { 'Click frenzy': cf };
CA.UI.Menu.render();
const cfLane = card().querySelector('.ca-sp-lane.click');
assert(cfLane && cfLane.textContent.includes(`×${Math.round(want)} income`) && /10 clicks\/s/.test(cfLane.getAttribute('data-tip')), `the click effect’s bar: ×${Math.round(want)} income, its tooltip naming the click rate (${cfLane && cfLane.textContent})`);
Game.buffs = { Frenzy: { name: 'Frenzy', time: 30 * 60, maxTime: 30 * 77, multCpS: 7 } };
delete Game.mouseCps;

// ---- what if, without the note it used to live in
CA.UI.Menu.openPage('stats');
card().querySelector('[data-sp-without][data-name="Lucky day"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
assert(/without Lucky day: 7m 2[67]s/.test(text()), 'what if: the wait without Lucky day, under the chips');

// ---- the widgets: Next golden cookie draws this chart; the Golden timeline keeps the wait from now
CA.Settings.set('widgetsShown', true);
['goldenNext', 'goldenTimeline'].forEach((t) => CA.UI.Widgets.add(t));
CA.UI.Widgets.render();
CA.UI.Widgets.tick();
const wEl = (name) => [...doc.querySelectorAll('#CookieMgrWidgets [data-widget]')].find((x) => x.querySelector('.ca-w-title') && x.querySelector('.ca-w-title').textContent === name);
const nx = wEl('Next golden cookie');
assert(nx && nx.querySelector('.ca-sp-cycle .ca-sp-now') && nx.querySelector('.ca-sp-half') && !nx.querySelector('.ca-sp-pdf'), 'Next golden cookie widget: this cycle’s chart, the now line, 50%');
const tl = wEl('Golden timeline');
assert(tl && tl.querySelector('.ca-sp-pdf rect') && !tl.querySelector('.ca-sp-cycle'), 'Golden timeline widget: the wait from now, as before');

// ---- on screen: (since golden-present) the chart holds at the next cycle's beginning, under an overlay
Game.shimmerTypes.golden.spawned = 1;
CA.UI.Menu.render();
assert(/Golden cookie present/.test(text()) && /Wrath chance/.test(text()) && card().querySelector('.ca-sp-held .ca-sp-cycle'), 'on screen: the chart, held under “Golden cookie present”');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
