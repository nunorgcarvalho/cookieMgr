// v3.19.1: the next golden cookie chart keeps the effects that ended since the last golden cookie
// left — dimmed, on the same axis, with their multiplier as last seen (CA.Timers.effectsSince);
// those that ended before it don't show. A dashed line at the expected moment with how long until it,
// and the time since the last one on the now line; the golden cookie frequency (× vs nothing helping) —
// on the Stats page and the Next golden cookie widget; the dashed line across at the curve's height at the
// expected moment; the widget's numbers picked one by one in its settings.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);

Game.fps = 30;
Game.Has = () => false;
Game.hasBuff = () => false;
// this cycle: 5–15 min, 4 min in
Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 30 * 240, minTime: 30 * 300, maxTime: 30 * 900, spawned: 0, n: 0, spawnConditions: () => true });
// a Frenzy with 5 s left (it started 72 s ago), and a Click frenzy with 10 s left
Game.buffs = {
  Frenzy: { name: 'Frenzy', time: 30 * 5, maxTime: 30 * 77, multCpS: 7 },
  'Click frenzy': { name: 'Click frenzy', time: 30 * 10, maxTime: 30 * 13, multClick: 777 },
};
const live = CA.Timers.effectsSince(240);
assert(live.length === 2 && live.every((e) => e.running) && live[0].name === 'Frenzy' && Math.abs(live[0].startedAgo - 72) < 1 && Math.abs(live[0].endsIn - 5) < 1, `running, oldest first: ${live.map((e) => `${e.name} ${e.startedAgo.toFixed(0)}s ago → ${e.endsIn.toFixed(0)}s`).join(', ')}`);
assert(live[0].mult === 7, 'the multiplier as seen (no clicking: Frenzy ×7)');

// the Frenzy ends
delete Game.buffs.Frenzy;
const after = CA.Timers.effectsSince(240);
const fr = after.find((e) => e.name === 'Frenzy');
assert(after.length === 2 && fr && !fr.running && fr.endsIn <= 0 && fr.endsIn > -1 && fr.mult === 7, 'ended: kept, not running, ended just now, its multiplier remembered');
assert(after.find((e) => e.name === 'Click frenzy').running, 'the other still running');

CA.UI.Menu.openPage('stats');
const card = () => doc.querySelector('[data-page="graphs"] [data-st-spawn]');
const lanes = () => [...card().querySelectorAll('[data-sp-chart="golden"] .ca-sp-lane')];
const frLane = lanes().find((l) => /Frenzy/.test(l.textContent) && !/Click/.test(l.textContent));
assert(lanes().length === 2 && frLane && frLane.classList.contains('ended') && /×7 income · ended/.test(frLane.textContent) && /ended .* ago/.test(frLane.getAttribute('data-tip')), `the card: the ended Frenzy still drawn, dimmed, “ended” (${frLane && frLane.textContent})`);
const X = (s) => 8 + ((640 - 16) * s) / 900;
const r = frLane.querySelector('.left');
const x = Number(r.getAttribute('x'));
const x2 = x + Number(r.getAttribute('width'));
assert(Math.abs(x - X(240 - 72)) < 1 && Math.abs(x2 - X(240)) < 1, `on the axis: from 2m 48s to now (x ${x.toFixed(1)}–${x2.toFixed(1)} vs ${X(168).toFixed(1)}–${X(240).toFixed(1)})`);
assert(!lanes().find((l) => /Click frenzy/.test(l.textContent)).classList.contains('ended'), 'the running one not dimmed');

// the expected moment, dashed, with how long until it; the time since the last one on the now line
const d = CA.Timers.distribution('golden');
const expLine = card().querySelector('.ca-sp-expect line');
const exp = card().querySelector('.ca-sp-expect text');
const ex = expLine && Number(expLine.getAttribute('x1'));
assert(exp && Math.abs(ex - X(240 + d.wait.mean)) < 0.05 && exp.textContent === `expected · ${CA.Format.span(d.wait.mean)}`, `the expected line at now + the mean wait (${exp && exp.textContent})`);
assert(card().querySelector('.ca-sp-now .ca-sp-since').textContent === CA.Format.span(240), 'the now line says the time since the last one (4m 00s)');
const kids = [...card().querySelector('[data-sp-chart="golden"]').children];
const lastShape = Math.max(...kids.map((k, i) => (k.matches('path, line, rect, circle') || k.querySelector('path, line, rect, circle')) && !k.classList.contains('ca-sp-hover') ? i : -1));
assert(kids.findIndex((k) => k.querySelector && k.querySelector('.ca-sp-since')) > lastShape && kids.findIndex((k) => k.matches('.ca-sp-ylab')) > lastShape, 'the labels come after every line, curve and bar (drawn on top)');
const half = card().querySelector('.ca-sp-half');
const hp = d.cycle.cdf(240 + d.wait.mean);
assert(Math.abs(Number(half.getAttribute('y1')) - (128 - 118 * hp)) < 0.05 && [...card().querySelectorAll('.ca-sp-ylab')].some((t) => t.textContent === `${(hp * 100).toFixed(hp < 0.1 ? 1 : 0)}%`), `the dashed line across meets the expected line on the curve, labeled ${(hp * 100).toFixed(0)}%`);
CA.Settings.set('widgetsShown', true);
CA.UI.Widgets.add('goldenNext');
CA.UI.Widgets.render();
CA.UI.Widgets.tick();
const wg = [...doc.querySelectorAll('#CookieMgrWidgets [data-widget]')].find((x) => /Next golden cookie/.test(x.textContent));
assert(wg && wg.querySelector('.ca-sp-expect line') && /expected/.test(wg.querySelector('.ca-sp-expect text').textContent) && wg.querySelector('.ca-sp-since'), 'the Next golden cookie widget too');

// the frequency: × vs nothing helping, every factor counted
assert(d.frequency === 1 && /Multiplier×1/.test(card().textContent.replace(/\s+/g, '')), 'nothing helping: frequency ×1');
Game.Has = (n) => n === 'Lucky day' || n === 'Serendipity' || n === 'Golden goose egg';
Game.eff = (k) => (k === 'goldenCookieFreq' ? 1.03 : 1); // a garden plant's +3%
const f = CA.Timers.distribution('golden').frequency;
const want = 1 / (0.5 * 0.5 * 0.95 * (1 / 1.03));
assert(Math.abs(f - want) < 1e-9 && Math.abs(CA.Script.VALUES.find((v) => v.id === 'golden.frequency').get() - want) < 1e-9, `Lucky day, Serendipity, Golden goose egg, a garden +3%: ×${want.toFixed(2)} (the word golden.frequency too)`);
CA.UI.Menu.render();
assert(card().textContent.replace(/\s+/g, '').includes(`Multiplier×${Math.round(want * 100) / 100}`), 'the Stats card’s Multiplier tile (Frequency until v3.30.0)');
CA.UI.Widgets.tick();
const wg2 = [...doc.querySelectorAll('#CookieMgrWidgets [data-widget]')].find((x) => /Next golden cookie/.test(x.textContent));
assert(/multiplier/i.test(wg2.querySelector('.ca-tl-nums').textContent) && wg2.querySelector('.ca-tl-nums').textContent.includes(`×${Math.round(want * 100) / 100}`), 'and the widget’s numbers');
Game.Has = () => false;
delete Game.eff;

// the widget's numbers, picked in its settings
const inst = CA.UI.Widgets.list().find((x) => x.title === 'Next golden cookie');
const nums = () => [...wg2.ownerDocument.querySelectorAll('#CookieMgrWidgets [data-widget]')].find((x) => /Next golden cookie/.test(x.textContent)).querySelector('.ca-tl-nums');
assert(nums().querySelectorAll('span').length === 6, 'all six numbers by default (the Frequency since v3.30.0)');
inst.nums = ['next', 'frequency'];
CA.UI.Widgets.tick();
assert(nums().querySelectorAll('span').length === 2 && /Expected wait/.test(nums().textContent) && /Multiplier/.test(nums().textContent) && !/Median/.test(nums().textContent), 'two picked: next in and the multiplier (key frequency)');
assert(CA.UI.Widgets.serialize().find((x) => x.title === 'Next golden cookie').nums.join() === 'next,frequency', 'saved with the widget');
inst.nums = [];
CA.UI.Widgets.tick();
assert(!nums(), 'none picked: no numbers row');
CA.UI.Widgets.openSettings(inst.id);
assert(doc.querySelectorAll('[data-w-multi="nums"]').length === 6, 'its settings list the six numbers');
delete inst.nums;
CA.UI.Menu.openPage('stats');

// a golden cookie leaves: a new cycle — what ended before it is gone, what still runs stays
Game.shimmerTypes.golden.time = 0;
CA.UI.Menu.render();
assert(lanes().length === 1 && /Click frenzy/.test(lanes()[0].textContent), 'a new cycle: the ended Frenzy is outside it, the running Click frenzy shows');

// a new Frenzy after the first ended: its own bar
Game.shimmerTypes.golden.time = 30 * 240;
await sleep(1600);
Game.buffs.Frenzy = { name: 'Frenzy', time: 30 * 77, maxTime: 30 * 77, multCpS: 7 };
const two = CA.Timers.effectsSince(240).filter((e) => e.name === 'Frenzy');
assert(two.length === 2 && !two[0].running && two[1].running, 'a second Frenzy after a gap: a second entry');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
