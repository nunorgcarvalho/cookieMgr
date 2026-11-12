// v2.18.0: Garden effects chart (the Garden information figures over time) and an x axis in garden
// ticks for both garden charts.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';
import { makeGarden } from '../harness/gardenStub.mjs';

const { assert, done } = makeAssert();
const browser = { factory: new IDBFactory(), IDBKeyRange };
const g = boot({ idb: browser });
const { window: w, Game } = g;
const M = makeGarden(Game);
const CA = w.CookieMgr;
const doc = w.document;
const set = (x, y, key, age) => (M.plot[y][x] = key ? [M.plants[key].id + 1, age] : [0, 0]);
const effs = (o) => (M.effs = Object.assign({ cps: 1, click: 1, goldenCookieFreq: 1, upgradeCost: 1 }, o));
set(1, 2, 'bakerWheat', 5);
effs({ cps: 1.001 });
await sleep(1600);
const H = CA.GardenHistory;

// ---- effects in the snapshots
assert(H.list().length === 1 && H.list()[0].e.cps === 0.001 && !('click' in H.list()[0].e), `effects recorded, only the non-zero ones (${JSON.stringify(H.list()[0].e)})`);
effs({ cps: 1.004 }); // the wheat grew: its effect with it, plants unchanged
H.sample();
assert(H.list().length === 2, 'an effects change alone makes a snapshot');

// ---- ticks counted
const tick = () => {
  M.nextStep += M.stepT * 1000;
  H.sample();
};
tick();
assert(H.ticks().length === 1 && H.tickNow() === 1, `a garden tick counted (${H.tickNow()})`);
H.sample();
assert(H.ticks().length === 1, 'not twice');
set(2, 2, 'thumbcorn', 5);
effs({ cps: 1.004, click: 1.002 });
H.sample();
assert(H.list()[H.list().length - 1].k === 1, 'snapshots know their tick');
tick();
tick();
set(2, 2, 'thumbcorn', 15);
effs({ cps: 1.01, click: 1.01, upgradeCost: 0.998 });
H.sample();
tick();
assert(H.tickNow() === 4, 'four ticks');

// ---- the effects chart
CA.UI.Menu.openPage('garden');
await sleep(100);
assert(doc.querySelector('[data-plot="gardenEffects"]'), 'Effects chart on the Garden page');
const E = CA.UI.Plot.get('gardenEffects');
E.tick && E.tick();
let d = E.last();
const keys = d.data.series.map((s) => s.key).sort().join();
assert(keys === 'click,cps,upgradeCost', `a line per effect that shows up (${keys})`);
const last = (k) => d.data.lines[k][d.data.lines[k].length - 1].v;
assert(Math.abs(last('cps') - 1) < 1e-9 && Math.abs(last('upgradeCost') + 0.2) < 1e-9, `values in % (cps ${last('cps')}, upgrade costs ${last('upgradeCost')})`);
assert(d.data.series.find((s) => s.key === 'upgradeCost').name === 'upgrade costs (lower is better)', 'cost effects say lower is better');
assert(/CpS\s*\+1%/.test(doc.querySelector('[data-plot="gardenEffects"] [data-plot-stats]').textContent), 'tiles: the biggest effects now');

// ---- the ticks axis (both charts)
CA.Settings.set('plot.garden.axis', 'ticks');
const G2 = CA.UI.Plot.get('garden');
G2.tick && G2.tick();
d = G2.last();
assert(d.data.xAxis && d.data.xAxis.x1 === 5 && d.data.bars.every((b) => b.x1 - b.x0 === 1), `growth: a bar per tick (${d.data.xAxis && d.data.xAxis.x0}–${d.data.xAxis && d.data.xAxis.x1})`);
assert(d.data.xAxis.labels[d.data.xAxis.labels.length - 1].label === 'now', 'labeled back from now');
assert(/2 ticks ago/.test(d.data.xAxis.head(d.data.bars.find((b) => b.tick === 2))), 'tooltip heading in ticks');
const t2 = d.data.bars.find((b) => b.tick === 2);
const t4 = d.data.bars.find((b) => b.tick === 4);
assert(t2.parts['thumbcorn:0'] === 1 && t4.parts['thumbcorn:2'] === 1, 'each tick shows the garden as it was then');
E.tick && E.tick();
assert(E.last().data.xAxis && E.last().data.xAxis.x1 === 5, 'effects chart follows (same x axis setting)');
assert(G2.last().v.custom, 'drawn on the custom axis');

// ---- kept
const n = H.ticks().length;
await H.flush();
const g2 = boot({ idb: browser });
makeGarden(g2.Game);
await waitFor(() => g2.window.CookieMgr.GardenHistory.ticks().length === n);
assert(g2.window.CookieMgr.GardenHistory.ticks().length === n && g2.window.CookieMgr.GardenHistory.tickNow() === 4, 'ticks restored');

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
