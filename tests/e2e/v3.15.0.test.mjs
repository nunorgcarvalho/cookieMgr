// v3.15.0: the Effect timers widget redrawn — a slim bar per effect in its own color with the game's
// icon, what it multiplies, the time left, the chance of a golden cookie before it ends; bad effects
// striped; ordered as they started or ending soonest. And every framed widget's Background (Solid,
// Faint, None): see-through ones fade in on hover; saved; Effect timers starts see-through.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const g = boot({ idb: { factory: new IDBFactory(), IDBKeyRange } });
const { window: w, Game } = g;
const CA = w.CookieMgr;
const doc = w.document;
await sleep(400);

Game.fps = 30;
Game.shimmerTypes.golden = Object.assign(Game.shimmerTypes.golden || {}, { time: 30 * 40, minTime: 30 * 30, maxTime: 30 * 120, spawned: 0, n: 0, spawnConditions: () => true });
const B = (name, type, secs, max, icon, more) => ({ name, type: { name: type }, time: secs * 30, maxTime: max * 30, icon, ...more });
Game.buffs = {
  Frenzy: B('Frenzy', 'frenzy', 141, 154, [10, 14], { multCpS: 7 }),
  'Click frenzy': B('Click frenzy', 'click frenzy', 21, 26, [0, 14], { multClick: 777 }),
  Clot: B('Clot', 'clot', 4, 66, [15, 5], { multCpS: 0.5 }),
  Mystery: B('Mystery', 'some mod buff', 30, 60, null, {}),
};

// ---- CA.Timers.buffs: the type and the icon
const fr = CA.Timers.buffs().find((b) => b.name === 'Frenzy');
assert(fr.type === 'frenzy' && fr.icon.join() === '10,14', 'buffs(): the game’s buff type and icon');

CA.Settings.set('widgetsShown', true);
const inst = CA.UI.Widgets.add('effectTimers');
assert(!CA.UI.EffectTimers.html(inst).includes('ca-et-gc'), 'by default: no golden cookie chance');
inst.stats = ['icon', 'mult', 'golden'];
CA.UI.Widgets.render();
CA.UI.Widgets.tick();
const box = () => doc.querySelector(`#CookieMgrWidgets [data-widget="${inst.id}"]`);
const rows = () => [...box().querySelectorAll('.ca-et')];

// ---- the bars
assert(rows().length === 4, 'a bar per effect');
const [r0, r1, r2, r3] = rows();
assert(/Frenzy/.test(r0.textContent) && /×7 CpS/.test(r0.textContent) && /2:21/.test(r0.textContent), 'Frenzy: its name, ×7 CpS, 2:21 left');
assert(/×777 clicks/.test(r1.textContent) && /21s/.test(r1.textContent), 'Click frenzy: ×777 clicks, 21s');
assert(Math.abs(parseFloat(r0.querySelector('.ca-et-bar > i').style.width) - (141 / 154) * 100) < 0.01, 'the bar: the share of its time left');
assert(r0.style.getPropertyValue('--c') === CA.UI.EffectTimers.COLORS.frenzy && r1.style.getPropertyValue('--c') === CA.UI.EffectTimers.COLORS['click frenzy'], 'each effect its own color');
assert(r3.style.getPropertyValue('--c').startsWith('hsl('), 'an unknown effect: a color from its name');
assert(/img\/icons\.png/.test(r0.querySelector('.ca-et-ico i').getAttribute('style')) && /-480px -672px/.test(r0.querySelector('.ca-et-ico i').getAttribute('style')), 'the game’s own icon');
assert(r3.querySelector('.ca-et-ico.none'), 'no icon: a colored dot');
assert(r2.classList.contains('bad') && !r0.classList.contains('bad'), 'Clot: striped as a bad effect');
assert(r2.classList.contains('ending'), 'under 5 s left: marked ending');
const gc = CA.Timers.buffsWithGolden().find((b) => b.name === 'Click frenzy').golden;
assert(r1.querySelector('.ca-et-gc').textContent === `${Math.round(gc * 100)}%`, 'the chance a golden cookie comes before it ends (CA.Timers)');
assert(/golden cookie comes before it ends/.test(r1.dataset.tip) && /×777 clicks/.test(r1.dataset.tip), 'its tip says it all in words');

// ---- A full bar is: a fresh Frenzy's length — every bar on one scale; longer ones full and outlined
CA.Timers.effectDuration = (n) => (String(n).toLowerCase() === 'frenzy' ? 77 : NaN);
inst.barScale = 'frenzy';
CA.UI.Widgets.tick();
const wOf = (r) => parseFloat(r.querySelector('.ca-et-bar > i').style.width);
assert(wOf(rows()[0]) === 100 && rows()[0].classList.contains('over') && /Longer than a fresh Frenzy \(1m 17s\)/.test(rows()[0].dataset.tip), 'Frenzy with 2:21 left (> 77 s): full and outlined, its tip says why');
assert(/2:21/.test(rows()[0].textContent), '…its timer still the real time left');
assert(Math.abs(wOf(rows()[1]) - (21 / 77) * 100) < 0.01 && !rows()[1].classList.contains('over'), 'Click frenzy: 21 s of 77');
assert(CA.UI.Widgets.serialize().find((x) => x.id === inst.id).barScale === 'frenzy', 'saved');
const sel = (() => {
  CA.UI.Menu.openPage('widgets');
  CA.UI.Widgets.openSettings(inst.id);
  // (v3.41: a tile per scale, with a sample bar, instead of a drop-down)
  return doc.querySelector('[data-w-opt="barScale"]:checked');
})();
assert(sel && /1m 17s/.test(sel.closest('label').querySelector('.ca-wopt-head').textContent) && sel.value === 'frenzy', 'its settings: A full bar is — with today’s Frenzy length');
inst.barScale = 'own';
CA.UI.Widgets.tick();
assert(!rows()[0].classList.contains('over') && Math.abs(wOf(rows()[0]) - (141 / 154) * 100) < 0.01, 'its own length again');

// ---- the golden cookie chart's effect bars: the same colors
const cyc = doc.createElement('div');
cyc.innerHTML = CA.UI.SpawnView.cycleChart('golden', CA.Timers.distribution('golden', 60), CA.Timers.buffs());
const lane = [...cyc.querySelectorAll('.ca-sp-lane.ca-sp-tinted')].find((g) => /Frenzy/.test(g.textContent) && !/Click/.test(g.textContent));
assert(lane && lane.style.getPropertyValue('--c') === CA.UI.EffectTimers.COLORS.frenzy, 'the cycle chart tints each effect in its Effect timers color');

// ---- settings: what to show, the order
inst.stats = ['mult'];
CA.UI.Widgets.tick();
assert(!box().querySelector('.ca-et-ico') && !box().querySelector('.ca-et-gc') && /×7 CpS/.test(rows()[0].textContent), 'Show: multipliers only');
inst.stats = ['bars']; // saved before v3.15
CA.UI.Widgets.tick();
assert(box().querySelector('.ca-et-ico') && !box().querySelector('.ca-et-gc') && /×7/.test(box().textContent), 'an old saved Show: the defaults');
inst.stats = ['icon', 'mult', 'golden'];
inst.sort = 'end';
CA.UI.Widgets.tick();
assert(/Clot/.test(rows()[0].textContent) && /Frenzy/.test(rows()[3].textContent), 'Order: ending soonest first');
// a golden cookie on screen: no chance column
Game.shimmerTypes.golden.spawned = 1;
CA.UI.Widgets.tick();
assert(!box().querySelector('.ca-et-gc'), 'a golden cookie on screen: no chances shown');
Game.shimmerTypes.golden.spawned = 0;

// ---- Background
assert(box().classList.contains('ca-w-clear') && box().style.getPropertyValue('--wbg') === '0', 'Effect timers starts see-through');
const other = CA.UI.Widgets.add('goldenNext');
CA.UI.Widgets.render();
const obox = () => doc.querySelector(`#CookieMgrWidgets [data-widget="${other.id}"]`);
assert(!obox().classList.contains('ca-w-clear'), 'other framed widgets: solid by default');
// from its settings: the Background presets
CA.UI.Menu.openPage('widgets');
CA.UI.Widgets.openSettings(other.id);
const pre = doc.querySelector('[data-w-preset="bg"][data-val="40"]');
assert(pre && doc.querySelectorAll('[data-w-preset="bg"]').length === 3, 'Background in its settings: Solid, Faint, None');
pre.click();
assert(other.bg === 0.4 && obox().classList.contains('ca-w-clear') && obox().style.getPropertyValue('--wbg') === '0.4', 'Faint: see-through at 40%');
const saved = CA.UI.Widgets.serialize();
assert(saved.find((x) => x.id === other.id).bg === 0.4 && saved.find((x) => x.id === inst.id).sort === 'end', 'saved: the background, the order');
CA.UI.Widgets.load(saved);
assert(CA.UI.Widgets.get(other.id).bg === 0.4 && CA.UI.Widgets.get(inst.id).sort === 'end', '…and loaded');
doc.querySelector('[data-w-preset="bg"][data-val="100"]').click();
assert(!obox().classList.contains('ca-w-clear'), 'Solid again');
const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('');
assert(/\.ca-w-clear:hover::before/.test(css) && /\.ca-w-clear > \.ca-w-body \{[^}]*text-shadow/.test(css), 'see-through: fades in on hover, text outlined');

// ---- nothing running
Game.buffs = {};
CA.UI.Widgets.tick();
assert(/No effects running/.test(box().textContent), 'nothing running: says so');

assert(g.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : ''));
done();
process.exit();
