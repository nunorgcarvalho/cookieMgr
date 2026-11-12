// actual-income window: one Actual income payback mode on one setting, ppActualWindow (minutes: the
// presets 15 min, 30 min, 1 h, 3 h or any typed on the Payback page, 1 minute to a day). The tooltip
// lines by actual income and payback.actualIncome() follow it. The retired Actual, 15 min / 1 h / 3 h
// modes: their names are the one mode, and a save in one keeps its window.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';
import { cpsModel } from '../harness/cps.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);
const P = CA.Payback;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const value = (id, ...args) => CA.Script.VALUES.find((v) => v.id === id).get(...args);

const spec = { Cursor: [15, 0.1], Grandma: [100, 1], Farm: [1100, 8] };
Object.keys(spec).forEach((n, i) => {
  Object.assign(Game.Objects[n], { id: i, basePrice: spec[n][0], free: 0, amount: 5, locked: false });
});
Game.UpgradesInStore = [];
cpsModel(Game, { base: 1000, each: Object.fromEntries(Object.keys(spec).map((n) => [n, spec[n][1]])) });
Game.CpsAchievements = [];
Game.cookies = 50;
Game.CalculateGains();
Game.computedMouseCps = Game.mouseCps();
const RAW = Game.cookiesPsRaw;

// the Recorder, stubbed: the shorter the window, the more you took in (a combo just now)
const R = CA.Recorder;
let recorded = 1e6;
const ratio = (secs) => (secs <= 900 ? 20 : secs <= 3600 ? 8 : secs <= 10800 ? 3 : 5);
R.recent = (secs) => ({ actual: ratio(secs) * RAW, secs: Math.min(secs, recorded), cps: RAW, clickRate: 0 });
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
w.Date.now = Date.now;
const later = () => (offset += 6000); // past the 5 s memo

// ---- one actual mode
assert(P.modes().map((m) => m.id).join() === 'rawCps,cps,cpsClicking,actualIncome', `one actual-income mode (${P.modes().map((m) => m.id)})`);
assert(P.modeOf('actualIncome').label === 'Actual income', 'labeled Actual income');
['actual', 'actual15m', 'actual1h', 'actual3h', 'actualIncome15m', 'actualIncome1h', 'actualIncome3h'].forEach((n) => assert(P.modeOf(n).id === 'actualIncome', `${n} names it`));
assert(['actualIncome15m', 'actualIncome1h', 'actualIncome3h'].every((id) => !CA.Stats.get(id)), 'the fixed-window statistics are gone');

// ---- everything follows the one window
const farm = () => P.table().buildings[1].Farm;
const c = CA.Stats.contextOf('Farm', 'building');
const line = (id) => CA.Stats.run(CA.Stats.get(id), c).value;
[['15', 20], ['60', 8], ['180', 3]].forEach(([mins, k]) => {
  P.setActualWindow(mins);
  CA.Settings.set('ppMode', 'actualIncome');
  later();
  assert(CA.Settings.get('ppActualWindow') === mins && P.actualWindow() === mins * 60, `${mins} min: the window`);
  assert(near(P.income('actual'), k * RAW) && near(value('payback.actualIncome'), k * RAW), `${mins} min: the mode's income and payback.actualIncome()`);
  assert(near(P.actualRatio(), k), `${mins} min: the ratio`);
  const row = farm();
  assert(row.mode === 'actualIncome' && near(row.gain, k * row.bonus), `${mins} min: the gain is ${k}× its raw gain`);
  assert(near(CA.Stats.about(c, () => value('item.paybackIn', 'actual')), row.pp), `${mins} min: item.paybackIn("actual") is the table's`);
  assert(near(CA.Stats.about(c, () => value('item.gainIn', 'actual')), k * row.bonus) && /^\+.+\/s$/.test(line('actualGain')), `${mins} min: the tooltip's Income, actual income line (${line('actualGain')})`);
  assert(near(line('actual'), row.pp), `${mins} min: the tooltip's Payback period, actual income line`);
});
assert(near(value('payback.actualIncome', 15), 20 * RAW), 'payback.actualIncome(minutes) still takes a window of its own');

// ---- any window, kept to whole minutes from 1 to a day
P.setActualWindow(45);
assert(CA.Settings.get('ppActualWindow') === '45', 'a typed window');
assert(CA.Settings.definitions().find((d) => d.key === 'ppActualWindow').choices.map((x) => x.v).join() === '15,30,45,60,180,run', 'the Settings page lists it among the presets');
P.setActualWindow(0);
assert(CA.Settings.get('ppActualWindow') === '1', 'at least a minute');
P.setActualWindow(99999);
assert(CA.Settings.get('ppActualWindow') === '1440', 'at most a day');

// ---- too little recorded: not ready; under the window, what there is
P.setActualWindow(180);
recorded = 30;
later();
assert(P.mode().id === 'cps', 'under a minute recorded: cps until it is');
recorded = 1200;
later();
assert(P.mode().id === 'actualIncome' && near(P.income(), 3 * RAW), '20 minutes recorded: it averages what there is');

// ---- the Payback page: presets and a minutes box in Options, the window on the mode's chip
CA.UI.Menu.openPage('payback');
await sleep(100);
const presets = () => [...doc.querySelectorAll('[data-pp-pick="ppActualWindow"]')];
assert(presets().map((b) => b.textContent).join() === '15m,30m,1h,3h,Since ascension', `the presets (${presets().map((b) => b.textContent)})`);
assert(presets().find((b) => b.classList.contains('on')).dataset.v === '180', 'the one in use is on');
presets()
  .find((b) => b.dataset.v === '15')
  .click();
await sleep(50);
assert(CA.Settings.get('ppActualWindow') === '15', 'clicking a preset sets it');
const chip = () => doc.querySelector('[data-pp-mode="actualIncome"]');
assert(chip().textContent.includes('Actual income · 15m'), `the mode's chip names its window (${chip().textContent})`);
const box = doc.querySelector('[data-pp-window]');
box.value = '90';
box.dispatchEvent(new w.Event('change', { bubbles: true }));
await sleep(50);
assert(CA.Settings.get('ppActualWindow') === '90' && chip().textContent.includes('1.5h'), 'typing minutes sets any window');
assert(!presets().some((b) => b.classList.contains('on')), 'no preset on for a typed window');
CA.UI.Menu.close();

// ---- a save in a retired mode keeps its window, in the one mode; so does a profile ranking by one
Game.WriteSave();
const saved = JSON.parse(Game.modSaveData.CookieMgr);
saved.options.ppMode = 'actualIncome1h';
saved.options.ppActualWindow = '30';
const g2 = boot({ save: JSON.stringify(saved) });
await sleep(300);
const S2 = g2.window.CookieMgr.Settings;
assert(S2.get('ppMode') === 'actualIncome' && S2.get('ppActualWindow') === '60', `Actual, 1 h → Actual income over 1 h (${S2.get('ppMode')}, ${S2.get('ppActualWindow')})`);
assert(g2.errors.length === 0, `no errors (${g2.errors.join(' | ')})`);

saved.options.ppMode = 'cps';
saved.buyer.profiles[0].mode = 'actualIncome3h';
const g3 = boot({ save: JSON.stringify(saved) });
await sleep(300);
const CA3 = g3.window.CookieMgr;
assert(CA3.Settings.get('ppMode') === 'cps' && CA3.Settings.get('ppActualWindow') === '180', 'a profile in Actual, 3 h: the window is 3 h');
assert(CA3.AutoBuyer.list()[0].mode === 'actualIncome', 'and the profile ranks by Actual income');
assert(g3.errors.length === 0, `no errors (${g3.errors.join(' | ')})`);

Date.now = realNow;
w.Date.now = realNow;
assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
