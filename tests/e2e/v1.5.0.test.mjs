// v1.5.0: Graphs page (sub-tabs, plot engine, active time), stock performance, settings icons, sidebar placement.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game, M, goods } = g;
const CA = w.CookieMgr;
const doc = w.document;

// game loop: production, clicks, wobbling stock prices
let tickN = 0;
const loop = setInterval(() => {
  tickN++;
  const p = Game.cookiesPs / 10;
  Game.cookies += p;
  Game.cookiesEarned += p;
  Game.handmadeCookies += 3;
  Game.cookies += 3;
  Game.cookiesEarned += 3;
  goods.forEach((s, i) => (s.val = 10 + i * 5 + Math.sin(tickN / 7 + i) * 3 + tickN * 0.02));
}, 100);

// short windows: there's only a few seconds of data
['cps', 'actual'].forEach((id) => CA.Settings.set(`plot.${id}.win`, 60));
CA.Settings.set('plot.stockperf.win', 60);

await sleep(2300);
M.buyGood(0, 10);
Game.shimmerTypes.golden.popFunc({ gain: 20000 });
Game.cookies -= 5000; // a purchase
await sleep(3300);

// ---- engine unit checks
const P = CA.UI.Plot;
const frames = [
  { t: 1000, a: 1000, dt: 1, earned: 10, cps: 5 },
  { t: 2000, a: 2000, dt: 1, earned: 10, cps: 7 },
  { t: 3000, a: 3000, dt: 1, earned: 10, cps: 9 },
  { t: 20000, a: 18000, dt: 15, earned: 150, cps: 11 },
];
const bars = P.bucketize(frames, 'a', 0, 20000, 2000, ['earned', 'cps']);
assert(bars.reduce((n, b) => n + b.v.earned, 0) === 180, 'bucketize conserves flows');
const coarse = bars[bars.length - 1];
assert(coarse.x1 === 18000 && coarse.n === 1 && coarse.v.cps === 11, `a frame coarser than the bucket gets its own bar (${coarse.x0}-${coarse.x1})`);
assert(bars[0].v.cps === 6 && bars[1].v.cps === 9,`gauges averaged per bucket (${bars.map((b) => b.v.cps)})`);

const fr = CA.Recorder.frames();
const mid = fr[Math.floor(fr.length / 2)];
assert(CA.Recorder.timeAt(mid.a) === mid.t && CA.Recorder.activeAt(mid.t) === mid.a, 'timeAt / activeAt map a frame both ways');

// ---- Graphs page
CA.UI.Menu.openPage('graphs');
await sleep(50);
const subtabs = [...doc.querySelectorAll('[data-graph-tab]')].map((b) => b.dataset.graphTab);
assert(subtabs.join() === 'cookies,income,prestige,golden,whatif,collection,misc', `sub-tabs (${subtabs})`);
const plotsOn = () => [...doc.querySelectorAll('[data-plot]')].map((p) => p.dataset.plot).join();
assert(plotsOn() === 'cps,actual,ledgerCum', `Cookies tab plots (${plotsOn()})`);
CA.UI.Graphs.tick();

const cps = P.get('cps').last();
assert(cps && cps.data.bars.length >= 3, `CpS plot has bars (${cps && cps.data.bars.length})`);
assert(cps.data.bars.some((b) => b.parts.click > 0) && cps.data.lines.base.length > 0, 'CpS bars stack clicking; unbuffed line');
assert(Number.isFinite(cps.data.avg) && cps.data.hlines.length === 1, 'CpS average line');
const table = doc.querySelector('[data-plot="cps"] .ca-table');
assert(table && table.querySelectorAll('tbody tr').length === 7 && table.querySelectorAll('thead th').length === 7, 'stages table: 7 rows × (Now + 5 spans)');
assert(/×\d/.test(table.textContent), 'with ÷ without clicking ratio shown');
assert(doc.querySelectorAll('[data-plot="cps"] .ca-stat').length === 4, 'CpS stat tiles');

const act = P.get('actual').last();
const prod = act.data.bars.reduce((n, b) => n + (b.parts.build || 0) * (b.raw.secs || 0), 0);
const ledgerProd = CA.Recorder.frames().reduce((n, f) => n + (f.lBuild || 0), 0);
assert(prod > 0 && near(prod, ledgerProd, 1e-6), `building CpS bars × seconds = recorded production (${prod} vs ${ledgerProd})`);
assert(act.data.lines.shown.length > 0, 'shown-CpS reference line');

// hover tooltip
const canvas = doc.querySelector('[data-plot="actual"] canvas');
canvas.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 600, clientY: 100 }));
const tip = doc.querySelector('[data-plot-tip="actual"]');
assert(tip.style.display === 'block' && /Building CpS/.test(tip.innerHTML), 'hover tooltip lists categories');

// window chip
click(w, doc.querySelector('[data-plot="cps"] [data-plot-set="plot.cps.win"][data-val="60"]'));
assert(CA.Settings.get('plot.cps.win') === 60, 'window chip sets the plot window');
await sleep(50);
assert(doc.querySelector('[data-plot="cps"] [data-plot-set="plot.cps.win"][data-val="60"]').classList.contains('on'), 'window chip shows pressed');

// smoothing (v2.3: a centered moving average replaced the bar-width chooser)
click(w, doc.querySelector('[data-plot="actual"] [data-plot-set="plot.actual.smooth"][data-val="5"]'));
CA.UI.Graphs.tick();
const act5 = P.get('actual').last();
assert(act5.v.smoothMs === 5000 && act5.data.bars.every((b) => b.x1 - b.x0 <= 1100), `smooth chooser; bars stay narrow (${act5.v.smoothMs}, ${act5.data.bars.map((b) => b.x1 - b.x0)})`);

// active time
click(w, doc.querySelector('[data-plot="cps"] [data-plot-toggle="graphActiveTime"]'));
assert(CA.Settings.get('graphActiveTime') === true, 'Active time chip toggles the global setting');
CA.UI.Graphs.tick();
const cpsA = P.get('cps').last();
assert(cpsA.v.key === 'a' && cpsA.data.bars.length > 0, 'plots switch to the active-time axis');
click(w, doc.querySelector('[data-plot="cps"] [data-plot-toggle="graphActiveTime"]'));

// pause / live
click(w, doc.querySelector('[data-plot="cps"] [data-plot-pause]'));
assert(P.get('cps').isPaused(), 'pause');
click(w, doc.querySelector('[data-plot="cps"] [data-plot-pause]'));
assert(!P.get('cps').isPaused(), 'jump to live');

click(w, doc.querySelector('[data-graph-tab="prestige"]'));
await sleep(50);
assert(plotsOn() === 'prestige,prestigeRate', `Prestige tab plots (${plotsOn()})`);
CA.UI.Graphs.tick();
assert(P.get('prestige').last().data.lines.prestigeTotal.length > 0, 'prestige line');
assert(/Next level in/.test(doc.querySelector('[data-plot="prestige"] [data-plot-stats]').innerHTML), 'prestige stats incl. next level ETA');
assert(CA.Settings.get('graphTab') === 'prestige', 'sub-tab remembered');

// ---- Stock market page
CA.UI.Menu.openPage('stocks');
await sleep(50);
assert(plotsOn() === 'stocks,stockperf', `stock page plots (${plotsOn()})`);
CA.UI.StockGraph.tick();
CA.UI.StockPerf.tick();
const st = P.get('stocks').last();
assert(st.data.lines.value.length > 0 && st.data.lines.cost.length > 0, 'portfolio value + cost lines');
click(w, doc.querySelector('[data-plot="stocks"] [data-plot-set="plot.stocks.mode"][data-val="perStock"]'));
CA.UI.StockGraph.tick();
assert(P.get('stocks').last().data.series.length === 1, 'per-stock view (synced to owned stocks)');
click(w, doc.querySelector('[data-plot="stockperf"] [data-plot-set="plot.stockperf.roll"][data-val="60"]'));
CA.UI.StockPerf.tick();
const perf = P.get('stockperf').last();
assert(perf.data.bars.length > 0 && perf.data.bars.every((b) => Number.isFinite(b.pct)), `performance bars (${perf.data.bars.length})`);

// ---- Settings icons
// v2.15: options are tiles (and chips in the All options index); v3.51: over the Settings page's tabs
const rows = [];
let titled = 0;
for (const tab of ['general', 'store', 'data', 'all']) {
  CA.UI.Menu.openPage(`settings:${tab}`);
  await sleep(50);
  rows.push(...doc.querySelectorAll('#CookieMgrMenu .ca-row-option, #CookieMgrMenu .ca-opt'));
  titled += doc.querySelectorAll('#CookieMgrMenu .ca-card-title .ca-card-ico').length;
}
assert(rows.length > 5 && rows.every((r) => r.querySelector('.ca-row-ico svg, .ca-row-ico .ca-ico-cookie, .ca-opt-ico svg')), `every settings row has an icon (${rows.length})`);
assert(titled >= 5, 'card titles have icons');
assert(doc.querySelector('.ca-index [data-key="graphActiveTime"]'), 'Active time option in the Settings index (v2.15: it lives on the Graphs page)');

// ---- sidebar under the cookie banner
const banner = doc.getElementById('cookies');
banner.getBoundingClientRect = () => ({ top: 80, bottom: 150, height: 70, left: 0, right: 300, width: 300 });
CA.UI.Tab.place();
assert(doc.getElementById('CookieMgrTab').style.top === '164px', `sidebar pinned below the banner (${doc.getElementById('CookieMgrTab').style.top})`);

clearInterval(loop);
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
