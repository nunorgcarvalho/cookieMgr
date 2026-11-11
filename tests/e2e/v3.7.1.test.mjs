// v3.7.1: the charts' hover is one readout that follows the x axis — the time, every effect active
// there with what it multiplies and (two or more) all of them combined, then the bar's figures; an
// effect lane or event marker under the cursor adds its details as a section (the lane is
// highlighted), and a stretch the game was off is a one-line note, not a takeover.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, waitFor, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await waitFor(() => CA.Recorder.frames().length >= 3, 6000);

// two effects at once: a Frenzy (×7 CpS) and a Click frenzy (×777 clicks)
Game.buffs.Frenzy = { name: 'Frenzy', dname: 'Frenzy', time: 77 * 30, maxTime: 77 * 30, multCpS: 7, icon: [10, 14] };
Game.buffs['Click frenzy'] = { name: 'Click frenzy', dname: 'Click frenzy', time: 13 * 30, maxTime: 13 * 30, multClick: 777, icon: [0, 14] };
await waitFor(() => CA.History.intervalsIn(0, Date.now() + 1e9).length >= 2, 4000);
await sleep(2300);

CA.UI.Menu.openPage('graphs');
CA.UI.Graphs.tick();
const P = CA.UI.Plot.get('cps');
const canvas = doc.querySelector('[data-plot="cps"] canvas');
const tip = doc.querySelector('[data-plot-tip="cps"]');
const hoverAt = (px, py) => {
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: r.left + px, clientY: r.top + py }));
};
let L = P.layout();
assert(L && L.data.intervals.length === 2 && L.data.intervals.every((iv) => iv.mults), 'the effects are on the chart, each with what it multiplies');

// ---- a point inside both effects: one readout
const both = L.data.intervals.reduce((a, b) => ({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1, L.v.x1) }));
const xMid = (both.x0 + both.x1) / 2;
const pyChart = L.plot.y + 10;
hoverAt(L.xOf(xMid), pyChart);
const html = () => tip.innerHTML;
const text = () => tip.textContent;
assert(tip.style.display === 'block' && /ca-tip-head/.test(html()), 'a readout, headed with the time');
assert(/Frenzy.*×7 CpS/.test(text()) && /Click frenzy.*×777 clicks/.test(text()), `every effect active there, with its multiplier (${text().slice(0, 200)})`);
assert(/Combined.*×7 CpS, ×777 clicks/.test(text()), 'and the two combined: the overall boost');
assert(/Production/.test(text()) && /Clicking|Unbuffed CpS/.test(text()), 'then the bar’s production figures, in the same box');
assert(text().indexOf('Combined') < text().indexOf('Production'), 'effects first, figures after');

// ---- on an effect lane: highlighted, and its details added — the readout stays
L = P.layout();
const lane = L.laneRects.find((r) => r.iv.label === 'Frenzy');
hoverAt(Math.min(lane.x1 - 1, Math.max(lane.x0 + 1, L.xOf(xMid))), (lane.y + lane.y1) / 2);
L = P.layout();
assert(L.hoverIv && L.hoverIv.label === 'Frenzy', 'the lane under the cursor is highlighted');
assert(/Combined/.test(text()) && /Production/.test(text()) && /Lasted/.test(text()), 'the readout keeps everything, plus that effect’s details (how long it lasted)');
assert(tip.querySelector('.ca-tip-row.strong') && /Frenzy/.test([...tip.querySelectorAll('.ca-tip-row.strong')].map((r) => r.textContent).join()), '…its row in the list stands out');

// ---- an event marker: a section, not a takeover
CA.EventLog.add({ type: 'reindeer', title: 'Reindeer popped', text: 'test', cookies: 1000 });
// (a second or so old, so it isn't at the very right edge of the plot)
await sleep(1500);
CA.UI.Graphs.tick();
L = P.layout();
const ev = L.evRects.find((r) => /Reindeer popped/.test(r.m.tip ? r.m.tip() : ''));
assert(ev, '(a reindeer marker on the chart)');
// (just inside the plot: a marker at now sits on its right edge — within its hit width)
hoverAt(Math.min(ev.x, L.plot.x + L.plot.w - 1), ev.y);
assert(/Reindeer popped/.test(text()) && /Production/.test(text()) && tip.querySelectorAll('.ca-tip-sec').length >= 1, 'on a marker: its details as a section of the same readout');

// ---- a stretch the game was off (active-time axis): a quiet note
const fr = CA.Recorder.frames();
const k = Math.floor(fr.length / 2);
for (let i = 0; i < k; i++) fr[i].t -= 60e3; // a minute away between frame k-1 and k
CA.Settings.set('graphActiveTime', true);
CA.UI.Graphs.tick();
L = P.layout();
const gap = L.gapRects[0];
assert(gap && gap.g.away >= 59e3, `the cut-out stretch is found (${gap && gap.g.away})`);
hoverAt(gap.x, pyChart);
assert(/Game off for 1m/.test(text()) && /Production/.test(text()) && !/Not running/.test(text()), 'right on it: the bar’s readout, with a one-line “game off” note');
hoverAt(gap.x + 2, pyChart);
assert(/Production/.test(text()), 'no snapping to the gap line');
CA.Settings.set('graphActiveTime', false);

// ---- the ledger chart (Where cookies come from) gets the same readout
CA.UI.Graphs.tick();
const A = CA.UI.Plot.get('actual');
const LA = A.layout();
const ivA = LA.data.intervals.find((iv) => iv.label === 'Frenzy');
assert(ivA && ivA.mults, 'the ledger chart’s effects carry their multipliers too');
const canvasA = doc.querySelector('[data-plot="actual"] canvas');
const rA = canvasA.getBoundingClientRect();
canvasA.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: rA.left + LA.xOf(Math.min(ivA.x1, LA.v.x1) - 500), clientY: rA.top + LA.plot.y + 10 }));
const tipA = doc.querySelector('[data-plot-tip="actual"]');
assert(/Frenzy.*×7 CpS/.test(tipA.textContent) && /CpS the game shows/.test(tipA.textContent), 'the ledger readout: effects and its figures together');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
