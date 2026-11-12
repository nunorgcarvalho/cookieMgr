// v2.16.0: the Garden growth chart — snapshots of seed × stage counts, stacked bars colored by
// seed and shaded by stage, the Show choice, merged tooltip rows, unlock markers, persistence.
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
set(1, 2, 'bakerWheat', 5); // bud
set(2, 2, 'bakerWheat', 40); // mature
set(3, 2, 'thumbcorn', 10); // bloom (20 × .5)
await waitFor(() => CA.GardenHistory.list().length >= 1, 6000); // (its first sample, within a second or so)

// ---- snapshots
const H = CA.GardenHistory;
assert(H.list().length === 1, `a first snapshot (${H.list().length})`);
const c0 = H.list()[0].c;
assert(c0['bakerWheat:0'] === 1 && c0['bakerWheat:3'] === 1 && c0['thumbcorn:1'] === 1, `seed:stage counts (${JSON.stringify(c0)})`);
H.sample();
assert(H.list().length === 1, 'nothing changed: no new snapshot');
set(1, 2, 'bakerWheat', 30); // bud → bloom
H.sample();
assert(H.list().length === 2 && H.list()[1].c['bakerWheat:2'] === 1, 'a change: a new snapshot');

// an unlock is logged (and marked on the chart)
M.plants.goldenClover.unlocked = 1;
H.sample();
const ev = CA.EventLog.list(['garden']);
assert(ev.length === 1 && ev[0].title === 'Unlocked Golden clover', `unlock logged (${ev.map((e) => e.title)})`);

// some history: three hours ago a garden of thumbcorn, two hours ago half of it mature
const now = Date.now();
const fr = CA.Recorder.frames();
const aNow = fr.length ? fr[fr.length - 1].a : now;
H.list().unshift({ t: now - 3 * 3600e3, a: aNow - 3 * 3600e3, c: { 'thumbcorn:0': 4 } }, { t: now - 2 * 3600e3, a: aNow - 2 * 3600e3, c: { 'thumbcorn:3': 2, 'thumbcorn:2': 2 } });

// ---- the chart, beside the plot
CA.UI.Menu.openPage('garden');
await sleep(100);
const row = doc.querySelector('[data-page="garden"] .ca-garden-row');
assert(row && row.children.length === 2 && row.querySelector('[data-plot="garden"]'), 'growth chart next to the garden');
const P = CA.UI.Plot.get('garden');
P.tick && P.tick();
let d = P.last();
assert(d && d.data.bars.length > 10, `bars across the window (${d && d.data.bars.length})`);
const keys = d.data.series.map((s) => s.key);
assert(keys.includes('thumbcorn:0') && keys.includes('thumbcorn:3') && keys.includes('bakerWheat:3'), `series per seed × stage (${keys})`);
assert(keys.indexOf('thumbcorn:3') < keys.indexOf('thumbcorn:0'), 'mature at the bottom of each seed');
const sw = (k) => d.data.series.find((s) => s.key === k).color;
assert(sw('thumbcorn:3') === CA.GardenHistory.colorOf('thumbcorn') && sw('thumbcorn:0') !== sw('thumbcorn:3'), 'seed color, darker when young');
assert(d.data.series.find((s) => s.key === 'thumbcorn:3').merge.name === 'Thumbcorn', 'tooltip rows merged per seed');
const early = d.data.bars.find((b) => b.parts['thumbcorn:0'] === 4);
const later = d.data.bars.find((b) => b.parts['thumbcorn:3'] === 2);
assert(early && later && early.x1 <= later.x0, 'step through time: young garden first, then ripening');
assert(d.data.legend.map((l) => l.name).join() === 'Thumbcorn,Baker\'s wheat', `legend per seed (${d.data.legend.map((l) => l.name)})`);
assert(d.data.markers.length === 1, 'unlock marker');
assert(/Plants now\s*3/.test(doc.querySelector('[data-plot="garden"] [data-plot-stats]').textContent), 'stat tiles');

// Show: seeds / stages
CA.Settings.set('plot.garden.by', 'seed');
P.tick && P.tick();
d = P.last();
assert(d.data.series.map((s) => s.key).sort().join() === 'bakerWheat,thumbcorn', 'Seeds: one series per seed');
CA.Settings.set('plot.garden.by', 'stage');
P.tick && P.tick();
d = P.last();
assert(d.data.series.map((s) => s.key).join() === 'stage:3,stage:2,stage:1,stage:0', 'Stages: bud … mature');
CA.Settings.set('plot.garden.by', 'both');

// ---- kept per save
const savedN = H.list().length;
await H.flush();
const g2 = boot({ idb: browser });
makeGarden(g2.Game);
await waitFor(() => g2.window.CookieMgr.GardenHistory.list().length === savedN, 5000);
assert(g2.window.CookieMgr.GardenHistory.list().length === savedN, `history restored (${g2.window.CookieMgr.GardenHistory.list().length})`);

assert(g.errors.length + g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
