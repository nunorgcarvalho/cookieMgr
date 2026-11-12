// v2.3.0: widgets over the cookie, a button widget per favorite, icon status bar,
// centered moving averages instead of wider bars, bank gains/losses toggles.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { boot, sleep, makeAssert, click } from '../harness/game.mjs';

const { assert, done } = makeAssert();
const browser = { factory: new IDBFactory(), IDBKeyRange };

function fakeLayout(w) {
  const left = w.document.getElementById('sectionLeft');
  Object.defineProperty(left, 'clientWidth', { get: () => 600 });
  Object.defineProperty(left, 'clientHeight', { get: () => 900 });
  const P = w.HTMLElement.prototype;
  const size = (el, framed, bare) => (el.classList && el.classList.contains('ca-w') ? (el.classList.contains('ca-w-bare') ? bare : framed) : 0);
  Object.defineProperty(P, 'offsetWidth', { get() { return size(this, 200, 40); } });
  Object.defineProperty(P, 'offsetHeight', { get() { return size(this, 100, 40); } });
  Object.defineProperty(P, 'offsetLeft', { get() { return parseFloat(this.style.left) || 0; } });
  Object.defineProperty(P, 'offsetTop', { get() { return parseFloat(this.style.top) || 0; } });
}
const mouse = (w, el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));

// a v2.1 save: one Shortcuts widget, two favorites
const v21 = JSON.stringify({
  v: 1,
  options: {},
  hotkeys: {},
  macros: { custom: [], prefs: { golden: { fav: true }, sellAll: { fav: true } } },
  widgets: [
    { id: 'wOld', type: 'shortcuts', x: 0.5, y: 0.25, collapsed: false },
    { id: 'wStats', type: 'stats', x: 0.1, y: 0.6, collapsed: false },
  ],
});
const g = boot({ idb: browser, save: v21 });
const { window: w, Game } = g;
fakeLayout(w);
const CA = w.CookieMgr;
const doc = w.document;
await sleep(300);
CA.UI.Widgets.render();

// ---- the layer sits above the game's big-cookie click target
const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
const m = css.match(/#CookieMgrWidgets\s*\{[^}]*z-index:\s*(\d+)/);
assert(m && Number(m[1]) > 10000 && Number(m[1]) < 20000, `widget layer z-index above #bigCookie (10000), below popups (${m && m[1]})`);

// ---- v2.1 Shortcuts widget → one button per favorite, where it was
const list = () => CA.UI.Widgets.list();
const buttons = () => list().filter((x) => x.type === 'macro');
assert(!list().some((x) => x.type === 'shortcuts'), 'old Shortcuts widget gone');
assert(buttons().map((x) => x.macro).join() === 'golden,sellAll', `a button per favorite (${buttons().map((x) => x.macro)})`);
const b0 = buttons()[0];
assert(Math.abs(b0.x * 560 - 0.5 * 560) < 2 && Math.abs(b0.y * 860 - 0.25 * 860) < 2, 'first button where the old widget was');
assert(list().some((x) => x.type === 'stats'), 'other widgets kept');

// ---- favorite → its own button; un-favorite → gone
CA.Macros.setFav('wrath', true);
assert(buttons().some((x) => x.macro === 'wrath'), 'starring a macro adds its button');
const btnEl = (id) => doc.querySelector(`#CookieMgrWidgets [data-w-trigger="${id}"]`);
assert(btnEl('wrath') && btnEl('wrath').closest('.ca-w-bare'), 'rendered as a bare button');
assert(/Wrath cookies/.test(btnEl('wrath').parentNode.querySelector('.ca-wb-label').textContent), 'name on hover (label)');
assert(!btnEl('wrath').textContent.trim(), 'the button itself is just the icon');
CA.Macros.setFav('wrath', false);
assert(!buttons().some((x) => x.macro === 'wrath') && !btnEl('wrath'), 'un-starring removes it');

// click (no movement) toggles; drag doesn't
const gEl = () => btnEl('golden');
mouse(w, gEl(), 'mousedown', 100, 100);
w.dispatchEvent(new w.MouseEvent('mouseup', {}));
click(w, gEl());
assert(CA.Macros.isOn('golden'), 'click toggles the macro');
CA.UI.Widgets.tick();
assert(gEl().classList.contains('on'), 'lit while on');
const wrap = gEl().closest('[data-widget]');
const left0 = wrap.style.left;
mouse(w, gEl(), 'mousedown', 100, 100);
w.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 160, clientY: 300 }));
w.dispatchEvent(new w.MouseEvent('mouseup', {}));
click(w, gEl());
assert(wrap.style.left !== left0 && CA.Macros.isOn('golden'), 'a drag moves the button without toggling it');
// dragging works with the button over where the cookie is (presses never reach the cookie)
let cookiePresses = 0;
doc.getElementById('sectionLeft').addEventListener('mousedown', () => cookiePresses++);
mouse(w, gEl(), 'mousedown', 160, 300);
w.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 300, clientY: 360 }));
w.dispatchEvent(new w.MouseEvent('mouseup', {}));
assert(cookiePresses === 0, 'presses on widgets don’t reach the cookie');
await sleep(10);

// × on a button un-favorites
click(w, doc.querySelector(`[data-widget="${buttons().find((x) => x.macro === 'sellAll').id}"] [data-w-remove]`));
assert(!CA.Macros.isFav('sellAll') && !buttons().some((x) => x.macro === 'sellAll'), '× un-favorites');

// locked: still clickable, not draggable
CA.Settings.set('widgetsLocked', true);
const wrap2 = gEl().closest('[data-widget]');
const l2 = wrap2.style.left;
mouse(w, gEl(), 'mousedown', 300, 360);
w.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
w.dispatchEvent(new w.MouseEvent('mouseup', {}));
click(w, gEl());
assert(gEl().closest('[data-widget]').style.left === l2 && !CA.Macros.isOn('golden'), 'locked: no drag, click still works');
CA.Settings.set('widgetsLocked', false);

// ---- Running now as an icon status bar
CA.UI.Menu.openPage('widgets');
click(w, doc.querySelector('[data-w-page-add="status"]'));
const bar = () => doc.querySelector('#CookieMgrWidgets .ca-w-status');
assert(bar() && bar().classList.contains('ca-w-bare') && !bar().querySelector('.ca-w-head'), 'status bar is a bare widget');
CA.UI.Widgets.tick();
assert(/idle/.test(bar().textContent), 'idle when nothing runs');
CA.Macros.set('bigCookie', true);
await sleep(300);
CA.UI.Widgets.tick();
const item = bar().querySelector('.ca-wbar-item');
assert(item && item.querySelector('.ca-icon, .ca-icon-ico') && ![...item.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()), 'one icon per running macro, no text');
assert(/Big cookie/.test(item.querySelector('.ca-wpop').textContent) && /\d+ clicks/.test(item.querySelector('.ca-wpop').textContent), 'details in a popup on hover');
assert(item.classList.contains('hot'), 'pulses while working');
CA.UI.Menu.close();
click(w, item);
assert(CA.UI.Menu.isOpen() && CA.Settings.get('tab') === 'clickers', 'click opens the Macros page');
CA.Macros.set('bigCookie', false);

// widgets page
CA.UI.Menu.openPage('widgets');
const pg = doc.querySelector('[data-page="widgets"]');
// v3.6: + the Golden cookies widget
assert(pg.querySelectorAll('.ca-wtile[data-w-page-add], .ca-wtile[data-w-page-remove]').length === 13 && /Macro buttons/.test(pg.textContent), 'Widgets page: thirteen types + macro buttons explained'); // + Manager (Manager widget), Actual income; v3.12: + Golden timeline, Next golden cookie, Effect timers; v3.19: − Golden cookies; v3.24: + Chart, Golden cookie frequency; v3.27: + Statistic; v3.39: the three golden ones → Golden cookies; v3.52: tiles only (Your widgets has a + per kind)

// ---- moving average
const MA = CA.UI.Plot.movingAverage;
const out = MA([0, 1, 2, 3, 4], [1, 1, 1, 1, 1], [0, 0, 9, 0, 0], 1);
assert(out.map((x) => Math.round(x * 100) / 100).join() === '0,3,3,3,0', `centered moving average (${out})`);
const out2 = MA([0, 1, 2], [1, 3, 1], [10, 0, 10], 5);
assert(Math.abs(out2[1] - 4) < 1e-9, 'weighted by seconds covered');

// all charts: Smooth chooser instead of bar widths
setInterval(() => {
  Game.cookies += 100;
  Game.cookiesEarned += 100;
}, 100);
['actual'].forEach((id) => CA.Settings.set(`plot.${id}.win`, 60));
await sleep(3200);
CA.UI.Menu.openPage('graphs');
click(w, doc.querySelector('[data-graph-tab="cookies"]'));
assert(!doc.querySelector('[data-plot-set$=".coarse"]') && doc.querySelector('[data-plot-set="plot.actual.smooth"]'), 'Smooth chips, no bar-width chips');
assert(!doc.querySelector('[data-plot="baked"] [data-plot-set="plot.baked.smooth"]'), 'no smoothing on running totals');
assert(CA.Settings.get('plot.actual.smooth') === 15 && CA.Settings.get('plot.cps.smooth') === 5, 'defaults: actual 15s, CpS 5s');
CA.Settings.set('plot.actual.smooth', 0);
CA.UI.Graphs.tick();
const raw = CA.UI.Plot.get('actual').last().data.bars.map((b) => b.parts.build);
CA.Settings.set('plot.actual.smooth', 3600);
CA.UI.Graphs.tick();
const sm = CA.UI.Plot.get('actual').last();
const smv = sm.data.bars.map((b) => b.parts.build);
assert(sm.data.bars.length === raw.length, 'same bars, not wider ones');
const spread = (a) => Math.max(...a) - Math.min(...a);
assert(spread(smv) <= spread(raw) + 1e-9, `smoothed values vary less (${spread(smv)} ≤ ${spread(raw)})`);

// ---- persist
Game.WriteSave();
const saved = JSON.parse(Game.modSaveData.CookieMgr);
assert(saved.widgets.filter((x) => x.type === 'macro').map((x) => x.macro).join() === 'golden' && saved.widgets.some((x) => x.type === 'status'), 'buttons and status bar saved');
const raw2 = Game.modSaveData.CookieMgr;
w.localStorage.clear();
w.close();
const g2 = boot({ idb: browser, save: raw2 });
fakeLayout(g2.window);
await sleep(300);
const C2 = g2.window.CookieMgr;
assert(C2.UI.Widgets.list().filter((x) => x.type === 'macro').length === 1 && C2.Macros.isFav('golden'), 'restored after a reload');
g2.window.close();

assert(g.errors.length === 0 && g2.errors.length === 0, 'no runtime errors' + (g.errors.length ? `: ${g.errors.slice(0, 3).join(' | ')}` : '') + (g2.errors.length ? `: ${g2.errors[0]}` : ''));
done();
process.exit();
